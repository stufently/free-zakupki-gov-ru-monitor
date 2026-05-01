import { parseFeed } from "./rss.js";
import { getState, markSeen, markInitialized, pushRecent, feedKey } from "./storage.js";

const ALARM_NAME = "zakupki-monitor-poll";

chrome.runtime.onInstalled.addListener(async () => {
  await rescheduleAlarm();
});

chrome.runtime.onStartup.addListener(async () => {
  await rescheduleAlarm();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAME) {
    await checkAllFeeds();
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "checkNow") {
    checkAllFeeds()
      .then((res) => sendResponse({ ok: true, ...res }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true; // async
  }
  if (msg && msg.type === "reschedule") {
    rescheduleAlarm()
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
});

chrome.notifications.onClicked.addListener((notifId) => {
  // notifId = link
  if (notifId && /^https?:\/\//.test(notifId)) {
    chrome.tabs.create({ url: notifId });
  }
  chrome.notifications.clear(notifId);
});

async function rescheduleAlarm() {
  const { settings } = await getState();
  // Chrome alarms: минимум 1 мин для packed extensions, 30 сек для unpacked.
  // Ставим минимум 1, чтобы было одинаково и в dev, и в Chrome Web Store.
  const periodInMinutes = Math.max(1, Number(settings.intervalMinutes) || 10);
  await chrome.alarms.clear(ALARM_NAME);
  await chrome.alarms.create(ALARM_NAME, {
    periodInMinutes,
    delayInMinutes: Math.min(1, periodInMinutes),
  });
}

// Сериализуем фоновые проверки: alarm, manual checkNow и повторные клики не должны
// запускать checkAllFeeds() параллельно — иначе read-modify-write в storage даст
// дубль уведомлений и потерю состояния.
let inFlight = null;

async function checkAllFeeds() {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const state = await getState();
    let totalNew = 0;
    const errors = [];

    let firstFeed = true;
    for (const feed of state.feeds) {
      if (!feed.url || feed.enabled === false) continue;
      // Throttle: не лупим zakupki.gov.ru параллельными запросами.
      // 1.5 сек между фидами — компромисс между скоростью и вежливостью.
      if (!firstFeed) await sleep(1500);
      firstFeed = false;
      try {
        const newItems = await checkFeed(feed, state);
        totalNew += newItems.length;
        if (newItems.length > 0) {
          await notifyNew(feed, newItems, state.settings);
        }
      } catch (e) {
        errors.push({ feedId: feed.id, url: feed.url, error: String(e) });
      }
    }

    if (totalNew > 0) await updateBadge();
    return { totalNew, errors };
  })();
  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

async function checkFeed(feed, state) {
  const resp = await fetch(feed.url, {
    cache: "no-store",
    headers: { "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml" },
  });
  if (!resp.ok) throw new Error("HTTP " + resp.status);
  const xml = await resp.text();
  const parsed = parseFeed(xml);

  const key = feedKey(feed);
  // first-run определяется явным флагом initialized, а не пустотой seenIds.
  // Это важно: пустой фид на первой проверке тоже инициализирует ленту.
  const wasInitialized = !!state.initialized[key];
  const seen = new Set(state.seenIds[key] || []);
  const fresh = parsed.items.filter((it) => it.id && !seen.has(it.id));

  // Помечаем как инициализированную после ЛЮБОЙ успешной проверки (даже если items=0).
  if (!wasInitialized) {
    await markInitialized(key);
    state.initialized[key] = true;
  }

  if (fresh.length === 0) return [];

  const ids = fresh.map((it) => it.id);
  await markSeen(key, ids, state.settings.seenLimit);
  // Обновляем in-memory snapshot, чтобы повторные ленты с тем же canonical key
  // в этом проходе не считали те же item'ы fresh снова.
  state.seenIds[key] = Array.from(new Set([...(state.seenIds[key] || []), ...ids]));

  // Первый запуск — не уведомляем (просто запоминаем текущее состояние).
  if (!wasInitialized) return [];

  const enriched = fresh.map((it) => ({
    feedId: feed.id,
    feedTitle: feed.title || parsed.channelTitle,
    title: it.title,
    link: it.link,
    pubDate: it.pubDate,
    description: it.description,
    foundAt: new Date().toISOString(),
  }));
  await pushRecent(enriched);
  return enriched;
}

async function notifyNew(feed, items, settings) {
  const cap = Math.max(1, Number(settings.notifyMaxAtOnce) || 3);
  const slice = items.slice(0, cap);
  const extra = items.length - slice.length;

  for (const it of slice) {
    await chrome.notifications.create(it.link || `zakupki-${Date.now()}-${Math.random()}`, {
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: feed.title || "Новая запись",
      message: trim(it.title, 200),
      contextMessage: it.pubDate || "",
      priority: 1,
    });
  }

  if (extra > 0) {
    await chrome.notifications.create(`summary-${Date.now()}`, {
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: feed.title || "Мониторинг закупок",
      message: `И ещё ${extra} новых записей. Откройте расширение, чтобы посмотреть.`,
      priority: 0,
    });
  }
}

function trim(s, n) {
  s = s || "";
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function updateBadge() {
  // Показываем количество записей в "recent" — это и есть непрочитанные с прошлого "очистить".
  const { recent } = await getState();
  const count = recent.length;
  const text = count === 0 ? "" : count > 99 ? "99+" : String(count);
  try {
    await chrome.action.setBadgeText({ text });
    if (text) await chrome.action.setBadgeBackgroundColor({ color: "#1971c2" });
  } catch {
    // chrome.action может быть недоступен в тестовых окружениях — игнорируем.
  }
}
