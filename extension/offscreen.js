// Offscreen-документ: разбирает XML нативным DOMParser и отдаёт результат
// в service worker. Существует только потому, что DOMParser недоступен в MV3 SW.
//
// Сюда НЕ уходит ни одного сетевого запроса — fetch делает background.js,
// offscreen получает уже скачанный текст.

import { parseFeed } from "./rss.js";

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  // Сообщения ходят широковещательно по всем контекстам расширения (popup,
  // options, service worker). Отвечаем строго на свои, иначе перехватим чужие.
  if (!msg || msg.target !== "offscreen" || msg.type !== "parseFeed") return;

  try {
    sendResponse({ ok: true, result: parseFeed(msg.xml, msg.baseUrl) });
  } catch (e) {
    sendResponse({ ok: false, error: String((e && e.message) || e) });
  }
  // sendResponse вызван синхронно — канал держать открытым не нужно.
});
