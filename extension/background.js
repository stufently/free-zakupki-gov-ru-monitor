// Service worker MV3. ВНИМАНИЕ: здесь нет DOM API — ни DOMParser, ни document.
// Разбор XML вынесен в offscreen-документ (offscreen.js), сюда приходит уже
// структурированный результат. Прямой импорт rss.js отсюда сломает расширение.

import {
  getState,
  markSeen,
  markInitialized,
  pushRecent,
  setFeedStatus,
  feedKey,
  isAllowedFeedUrl,
  FEED_HOST,
} from "./storage.js";

const ALARM_NAME = "zakupki-monitor-poll";
const OFFSCREEN_PATH = "offscreen.html";

// Один зависший fetch не должен блокировать очередь остальных лент.
const FETCH_TIMEOUT_MS = 30000;
// RSS-фиды весят десятки килобайт. 5 МБ — заведомо аномалия (HTML-заглушка,
// подменённый ответ), парсить такое смысла нет.
const MAX_FEED_BYTES = 5 * 1024 * 1024;

chrome.runtime.onInstalled.addListener(async () => {
  await rescheduleAlarm();
});

chrome.runtime.onStartup.addListener(async () => {
  await rescheduleAlarm();
  await updateBadge();
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
  // Badge считается по recent + наличию сломанных лент, поэтому пересчитывать его
  // должен только service worker. UI, меняющий состояние (очистка списка,
  // выключение или удаление ленты), просит пересчёт, а не правит badge сам —
  // иначе «!» об ошибке пропадал после «Очистить» и не возвращался.
  if (msg && msg.type === "refreshBadge") {
    updateBadge()
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

// --- offscreen: единственный способ добраться до DOMParser из MV3 ---

let creatingOffscreen = null;

// ВНИМАНИЕ: НЕ использовать chrome.offscreen.hasDocument() — он появился только
// в Chrome 150, а манифест допускает Chrome 119. На старых версиях это undefined,
// вызов падает TypeError'ом, и расширение не работает вовсе.
// chrome.runtime.getContexts() доступен с Chrome 116 и покрывает весь диапазон.
async function hasOffscreenDocument() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_PATH)],
  });
  return contexts.length > 0;
}

async function ensureOffscreen() {
  // Сначала ждём уже идущее создание, потом проверяем наличие: иначе параллельные
  // вызовы разойдутся и второй упадёт на "single offscreen document".
  if (creatingOffscreen) {
    await creatingOffscreen;
    return;
  }
  if (await hasOffscreenDocument()) return;
  if (!creatingOffscreen) {
    creatingOffscreen = chrome.offscreen
      .createDocument({
        url: OFFSCREEN_PATH,
        reasons: [chrome.offscreen.Reason.DOM_PARSER],
        justification: "Разбор XML RSS/Atom-лент: DOMParser недоступен в service worker.",
      })
      .catch((e) => {
        // Документ успели создать параллельно — это не ошибка.
        if (!/single offscreen document/i.test(String(e))) throw e;
      })
      .finally(() => {
        creatingOffscreen = null;
      });
  }
  await creatingOffscreen;
}

// Ответ обязан прийти за отведённое время. Без этого зависший offscreen-документ
// подвешивает не одну ленту, а всё расширение: checkAllFeeds сериализован через
// inFlight, и промис, который никогда не резолвится, навсегда блокирует очередь
// последующих проверок — включая ручную кнопку «Проверить сейчас».
const PARSE_TIMEOUT_MS = 15000;

function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

function askOffscreen(xml, baseUrl) {
  return withTimeout(
    chrome.runtime.sendMessage({ target: "offscreen", type: "parseFeed", xml, baseUrl }),
    PARSE_TIMEOUT_MS,
    `Парсер не ответил за ${PARSE_TIMEOUT_MS / 1000} с`
  );
}

async function parseFeedOffscreen(xml, baseUrl) {
  await ensureOffscreen();
  let resp;
  try {
    resp = await askOffscreen(xml, baseUrl);
    if (!resp) throw new Error("Парсер не ответил");
  } catch (first) {
    // Документ мог зависнуть или быть выгружен. Просто позвать ensureOffscreen()
    // мало: зависший документ по-прежнему числится живым и будет использован
    // повторно. Поэтому сначала закрываем принудительно, потом создаём заново.
    try {
      await chrome.offscreen.closeDocument();
    } catch {
      // Документа уже нет — это нормально.
    }
    await ensureOffscreen();
    resp = await askOffscreen(xml, baseUrl);
    if (!resp) throw first;
  }
  if (!resp.ok) throw new Error(resp.error || "Ошибка разбора фида");
  return resp.result;
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

      const key = feedKey(feed);
      const at = new Date().toISOString();
      await setFeedStatus(key, { lastAttemptAt: at });

      try {
        const newItems = await checkFeed(feed, state, key);
        totalNew += newItems.length;
        await setFeedStatus(key, { lastSuccessAt: at, lastError: null });

        if (newItems.length > 0) {
          // Сбой уведомлений — это НЕ сбой ленты: записи уже сохранены и видны
          // в popup. Мешать их в общий catch значило бы врать про состояние фида.
          try {
            await notifyNew(feed, newItems, state.settings);
          } catch (e) {
            console.warn("Не удалось показать уведомление:", e);
          }
        }
      } catch (e) {
        const err = describeError(e);
        errors.push({ feedId: feed.id, url: feed.url, ...err });
        await setFeedStatus(key, { lastError: { ...err, at } });
      }
    }

    await updateBadge();
    return { totalNew, errors };
  })();
  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

async function checkFeed(feed, state, key) {
  const xml = await fetchFeedText(feed.url);
  const parsed = await parseFeedOffscreen(xml, feed.url);

  // first-run определяется явным флагом initialized, а не пустотой seenIds.
  // Это важно: пустой фид на первой проверке тоже инициализирует ленту.
  const wasInitialized = !!state.initialized[key];
  const seen = new Set(state.seenIds[key] || []);
  const fresh = parsed.items.filter((it) => it.id && !seen.has(it.id));

  await setFeedStatus(key, { lastItemCount: parsed.items.length });

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

  // description намеренно НЕ сохраняем: он не показывается ни в popup, ни в
  // уведомлении, а это самое объёмное поле записи. Хранить содержимое страниц
  // портала «на всякий случай» незачем — ни пользователю, ни ревью Store.
  const enriched = fresh.map((it) => ({
    feedId: feed.id,
    feedTitle: feed.title || parsed.channelTitle,
    title: it.title,
    link: it.link,
    pubDate: it.pubDate,
    foundAt: new Date().toISOString(),
  }));
  await pushRecent(enriched);
  return enriched;
}

async function fetchFeedText(url) {
  // Проверяем ДО запроса: иначе адрес из настроек ушёл бы на любой сайт.
  if (!isAllowedFeedUrl(url)) throw new ForbiddenUrlError(url);

  const ctrl = new AbortController();
  // Таймер снимаем ТОЛЬКО после чтения тела. Если снять его сразу после
  // получения заголовков, медленное или бесконечное тело зависнет навсегда,
  // а вместе с ним — вся очередь проверок: checkAllFeeds сериализован inFlight.
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    let resp;
    try {
      resp = await fetch(url, {
        cache: "no-store",
        // Именно "follow", а не "error"/"manual". Запрет переадресации закрыл бы
        // и внутренние переходы портала (смена пути, добавление слеша) — ленты
        // сломались бы у всех разом. Уход с портала ловится ниже по resp.url:
        // ответ чужого хоста не читается и не разбирается. Остаточный риск —
        // один GET без cookie на адрес из редиректа, и он возможен только если
        // сам портал начнёт перенаправлять RSS наружу.
        redirect: "follow",
        // Лента публичная, cookie для неё не нужны. Пользователь может быть
        // авторизован на портале, и его сессионная cookie не должна уходить
        // с каждой фоновой проверкой. Значение по умолчанию ("same-origin")
        // при кросс-ориджин запросе тоже их не шлёт, но оно неявное: строка
        // здесь фиксирует поведение и делает его проверяемым.
        credentials: "omit",
        signal: ctrl.signal,
        headers: { Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" },
      });
    } catch (e) {
      if (e && e.name === "AbortError") throw e;
      // Помечаем сетевой сбой прямо на границе fetch. Классифицировать по
      // `instanceof TypeError` в общем обработчике нельзя: под это подпадёт
      // любой внутренний TypeError и будет выдан за проблему с сертификатом.
      throw new NetworkError(String((e && e.message) || e));
    }

    // Редирект мог увести с портала: проверка адреса до запроса этого не ловит,
    // переходы выполняет сам браузер. resp.url — финальный адрес после всех
    // переходов; если он не с портала, ответ не читаем и не разбираем.
    if (resp.url && !isAllowedFeedUrl(resp.url)) throw new ForbiddenUrlError(resp.url);

    if (!resp.ok) throw new HttpError(resp.status, resp.statusText);

    const declared = Number(resp.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_FEED_BYTES) {
      throw new Error(`Ответ слишком большой (${Math.round(declared / 1024)} КБ) — это не похоже на RSS`);
    }

    // Читаем в буфер, чтобы посчитать РЕАЛЬНЫЕ байты: у resp.text() длина строки
    // в символах, а кириллица в UTF-8 занимает по два байта на символ.
    let buf;
    try {
      buf = await resp.arrayBuffer();
    } catch (e) {
      if (e && e.name === "AbortError") throw e;
      throw new NetworkError(String((e && e.message) || e));
    }
    if (buf.byteLength > MAX_FEED_BYTES) {
      throw new Error(`Ответ слишком большой (${Math.round(buf.byteLength / 1024)} КБ) — это не похоже на RSS`);
    }
    return decodeBody(buf, resp.headers.get("content-type"));
  } finally {
    clearTimeout(timer);
  }
}

// Декодируем с учётом charset из Content-Type. resp.text() делает то же самое,
// но нам нужен доступ к байтам ради лимита размера, поэтому повторяем вручную.
function decodeBody(buf, contentType) {
  const m = /charset=["']?([\w-]+)/i.exec(contentType || "");
  const charset = m ? m[1] : "utf-8";
  try {
    return new TextDecoder(charset).decode(buf);
  } catch {
    // Неизвестная кодировка в заголовке — не повод ронять ленту.
    return new TextDecoder("utf-8").decode(buf);
  }
}

class HttpError extends Error {
  constructor(status, statusText) {
    super(`HTTP ${status}${statusText ? " " + statusText : ""}`);
    this.status = status;
  }
}

// Сбой на транспортном уровне: DNS, offline, блокировка, недоверенный TLS.
// Различить их из расширения нельзя — fetch отдаёт одинаковый TypeError.
class NetworkError extends Error {}

// Адрес вне портала закупок. Запрос не отправляется вообще.
class ForbiddenUrlError extends Error {
  constructor(url) {
    super(`Адрес не с ${FEED_HOST}: ${url}`);
  }
}

// Раскладывает исключение на машинно-читаемый kind + человеческий текст.
// Специально НЕ утверждаем, что это сертификат: fetch отдаёт неотличимый
// TypeError на DNS, offline, firewall и на недоверенный TLS. Формулировка
// вероятностная, решение оставляем пользователю.
function describeError(e) {
  const raw = String((e && e.message) || e);

  if (e && e.name === "AbortError") {
    return { kind: "timeout", message: `Превышено время ожидания (${FETCH_TIMEOUT_MS / 1000} с)` };
  }
  if (e instanceof ForbiddenUrlError) {
    return {
      kind: "url",
      message: `Ссылка должна вести на https://${FEED_HOST} — запрос не отправлен`,
    };
  }
  if (e instanceof HttpError || /^HTTP \d/.test(raw)) {
    return { kind: "http", message: raw };
  }
  if (e instanceof NetworkError) {
    return {
      kind: "network",
      message: "Не удалось соединиться с сервером (сеть, DNS или TLS)",
      hint: "cert",
    };
  }
  // Сбой моста в offscreen — это наша внутренняя проблема, а не кривой фид.
  // Иначе такая ошибка выглядела бы для пользователя как «плохой RSS».
  if (/establish connection|offscreen|receiving end/i.test(raw)) {
    return { kind: "internal", message: "Не удалось запустить парсер: " + raw };
  }
  return { kind: "parse", message: raw };
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
  // Если при этом какая-то активная лента сломана — badge краснеет: молчаливый
  // отказ ленты выглядел точно так же, как "новых нет".
  const { recent, feeds, status } = await getState();
  const count = recent.length;
  const broken = feeds.some(
    (f) => f.url && f.enabled !== false && status[feedKey(f)] && status[feedKey(f)].lastError
  );

  let text = count === 0 ? "" : count > 99 ? "99+" : String(count);
  if (broken && !text) text = "!";

  try {
    await chrome.action.setBadgeText({ text });
    if (text) {
      await chrome.action.setBadgeBackgroundColor({ color: broken ? "#c92a2a" : "#1971c2" });
    }
  } catch {
    // chrome.action может быть недоступен в тестовых окружениях — игнорируем.
  }
}
