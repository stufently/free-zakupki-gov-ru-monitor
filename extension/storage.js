// Обёртка над chrome.storage.local.
// Хранит:
//   feeds[]              — пользовательский список лент с UI-id
//   seenIds{urlKey: [..]} — ID известных записей, ключ = canonical URL ленты
//                          (не feed.id!), чтобы при правке URL автоматически считать
//                          ленту новой и не спамить старыми guid'ами.
//   recent[]             — последние найденные записи (для popup)
//   status{urlKey: {..}} — диагностика последней проверки каждой ленты
//   settings             — расписание и параметры уведомлений

const DEFAULTS = {
  feeds: [],
  seenIds: {},
  initialized: {}, // {urlKey: true} — флаг "первый запуск завершён"
  recent: [],
  // {urlKey: {lastAttemptAt, lastSuccessAt, lastItemCount, lastError:{kind,message,at}}}
  // Без этого фоновые сбои были невидимы: пользователь видел «новых нет»
  // и при упавшем парсере, и при недоверенном TLS-сертификате.
  status: {},
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
    // Якорь на сервер не уходит и ленту не меняет: с ним один и тот же адрес
    // дал бы два ключа, то есть две «разные» ленты с одинаковым содержимым и
    // сдвоенными уведомлениями.
    u.hash = "";
    return u.toString();
  } catch {
    return raw;
  }
}

// Ленты разрешены только с портала закупок. host_permissions сами по себе
// чужой домен не блокируют: fetch на него всё равно уйдёт, просто ответ
// закроет CORS — то есть произвольный адрес из настроек превратился бы в
// сетевой запрос на сторонний сайт. Проверка здесь делает границу настоящей,
// а не декларативной, и даёт понятную ошибку вместо невнятного сетевого сбоя.
export const FEED_HOST = "zakupki.gov.ru";

export function isAllowedFeedUrl(url) {
  let u;
  try {
    u = new URL(String(url || "").trim());
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  // Логин/пароль в адресе ленте не нужны, а выглядят ровно как приём маскировки
  // чужого хоста под нужный. Нестандартный порт — тоже не адрес RSS портала.
  if (u.username || u.password) return false;
  if (u.port && u.port !== "443") return false;
  const h = u.hostname.toLowerCase();
  return h === FEED_HOST || h.endsWith("." + FEED_HOST);
}

export async function getState() {
  const all = await chrome.storage.local.get(null);
  return {
    feeds: all.feeds || DEFAULTS.feeds,
    seenIds: all.seenIds || DEFAULTS.seenIds,
    initialized: all.initialized || DEFAULTS.initialized,
    recent: all.recent || DEFAULTS.recent,
    status: all.status || DEFAULTS.status,
    settings: { ...DEFAULTS.settings, ...(all.settings || {}) },
  };
}

// Мержит патч в диагностику ленты. Читаем-пишем весь объект status целиком:
// проверки лент сериализованы через inFlight в background.js, гонки нет.
export async function setFeedStatus(urlKey, patch) {
  if (!urlKey) return;
  const all = await chrome.storage.local.get("status");
  const status = all.status || {};
  status[urlKey] = { ...(status[urlKey] || {}), ...patch };
  await chrome.storage.local.set({ status });
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
  // Подчищаем seenIds + initialized + status от ключей, которых больше нет среди лент.
  const all = await chrome.storage.local.get(["seenIds", "initialized", "status"]);
  const seen = all.seenIds || {};
  const init = all.initialized || {};
  const status = all.status || {};
  const liveKeys = new Set(deduped.map(feedKey).filter(Boolean));
  const cleanedSeen = {};
  const cleanedInit = {};
  const cleanedStatus = {};
  for (const k of Object.keys(seen)) if (liveKeys.has(k)) cleanedSeen[k] = seen[k];
  for (const k of Object.keys(init)) if (liveKeys.has(k)) cleanedInit[k] = init[k];
  for (const k of Object.keys(status)) if (liveKeys.has(k)) cleanedStatus[k] = status[k];
  await chrome.storage.local.set({
    feeds: deduped,
    seenIds: cleanedSeen,
    initialized: cleanedInit,
    status: cleanedStatus,
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
