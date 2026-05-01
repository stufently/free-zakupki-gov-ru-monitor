// Обёртка над chrome.storage.local.
// Хранит:
//   feeds[]              — пользовательский список лент с UI-id
//   seenIds{urlKey: [..]} — ID известных записей, ключ = canonical URL ленты
//                          (не feed.id!), чтобы при правке URL автоматически считать
//                          ленту новой и не спамить старыми guid'ами.
//   recent[]             — последние найденные записи (для popup)
//   settings             — расписание и параметры уведомлений

const DEFAULTS = {
  feeds: [],
  seenIds: {},
  initialized: {}, // {urlKey: true} — флаг "первый запуск завершён"
  recent: [],
  settings: {
    intervalMinutes: 10, // default — каждые 10 минут (минимум Chrome alarms = 1 мин)
    maxRecent: 50,
    notifyMaxAtOnce: 3,
    seenLimit: 5000,
  },
};

export function feedKey(feed) {
  // Ключ хранилища seenIds — нормализованный URL.
  // Нормализуем: lowercase только host (path/query case-sensitive), убираем trailing slash в path.
  // При смене URL ключ меняется → лента автоматически считается новой (first-run).
  if (!feed || !feed.url) return "";
  const raw = feed.url.trim();
  try {
    const u = new URL(raw);
    u.hostname = u.hostname.toLowerCase();
    u.pathname = u.pathname.replace(/\/+$/, "") || "/";
    return u.toString();
  } catch {
    return raw;
  }
}

export async function getState() {
  const all = await chrome.storage.local.get(null);
  return {
    feeds: all.feeds || DEFAULTS.feeds,
    seenIds: all.seenIds || DEFAULTS.seenIds,
    initialized: all.initialized || DEFAULTS.initialized,
    recent: all.recent || DEFAULTS.recent,
    settings: { ...DEFAULTS.settings, ...(all.settings || {}) },
  };
}

export async function setFeeds(feeds) {
  // Дедуплицируем feeds по canonical URL (feedKey): если две UI-записи нормализуются
  // к одному URL — оставляем первую, чтобы не насчитать дубли уведомлений.
  const seenKeys = new Set();
  const deduped = [];
  for (const f of feeds) {
    const k = feedKey(f);
    if (!k) continue;
    if (seenKeys.has(k)) continue;
    seenKeys.add(k);
    deduped.push(f);
  }
  // Подчищаем seenIds + initialized от ключей, которых больше нет среди лент.
  const all = await chrome.storage.local.get(["seenIds", "initialized"]);
  const seen = all.seenIds || {};
  const init = all.initialized || {};
  const liveKeys = new Set(deduped.map(feedKey).filter(Boolean));
  const cleanedSeen = {};
  const cleanedInit = {};
  for (const k of Object.keys(seen)) if (liveKeys.has(k)) cleanedSeen[k] = seen[k];
  for (const k of Object.keys(init)) if (liveKeys.has(k)) cleanedInit[k] = init[k];
  await chrome.storage.local.set({
    feeds: deduped,
    seenIds: cleanedSeen,
    initialized: cleanedInit,
  });
}

export async function setSettings(settings) {
  const cur = await getState();
  await chrome.storage.local.set({ settings: { ...cur.settings, ...settings } });
}

export async function markInitialized(urlKey) {
  if (!urlKey) return;
  const all = await chrome.storage.local.get("initialized");
  const init = all.initialized || {};
  if (init[urlKey]) return;
  init[urlKey] = true;
  await chrome.storage.local.set({ initialized: init });
}

export async function markSeen(urlKey, ids, limit) {
  if (!urlKey) return;
  const all = await chrome.storage.local.get("seenIds");
  const seen = all.seenIds || {};
  const cur = new Set(seen[urlKey] || []);
  ids.forEach((i) => i && cur.add(i));
  const arr = Array.from(cur);
  // Усекаем только если реально превысили — для типичных RSS (десятки записей) не сработает.
  // FIFO по порядку добавления (Set сохраняет порядок вставки).
  const cap = Math.max(500, Number(limit) || 5000);
  seen[urlKey] = arr.length > cap ? arr.slice(-cap) : arr;
  await chrome.storage.local.set({ seenIds: seen });
}

export async function pushRecent(entries) {
  const cur = await getState();
  const recent = [...entries, ...cur.recent].slice(0, cur.settings.maxRecent);
  await chrome.storage.local.set({ recent });
}

export async function clearRecent() {
  await chrome.storage.local.set({ recent: [] });
}
