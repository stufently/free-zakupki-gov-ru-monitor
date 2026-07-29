import { getState, clearRecent, feedKey } from "./storage.js";

const $ = (sel) => document.querySelector(sel);

document.addEventListener("DOMContentLoaded", render);

$("#check-now").addEventListener("click", async () => {
  setStatus("Проверяю…");
  const res = await chrome.runtime.sendMessage({ type: "checkNow" });
  if (!res || !res.ok) {
    setStatus("Ошибка: " + (res?.error || "неизвестно"));
    return;
  }
  setStatus(res.totalNew > 0 ? `Новых: ${res.totalNew}` : "Новых нет");
  await render();
});

$("#open-options").addEventListener("click", () => chrome.runtime.openOptionsPage());

$("#clear").addEventListener("click", async () => {
  await clearRecent();
  // Не стираем badge напрямую: если какая-то лента сломана, на нём должен
  // остаться красный «!». Пересчёт делает service worker.
  try {
    await chrome.runtime.sendMessage({ type: "refreshBadge" });
  } catch {
    // ignore
  }
  await render();
});

async function render() {
  const state = await getState();
  const list = $("#recent");
  list.innerHTML = "";

  if (state.feeds.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "Нет настроенных лент. Откройте настройки и добавьте RSS-ссылку с zakupki.gov.ru.";
    list.appendChild(li);
    $("#count").textContent = "";
    return;
  }

  // Сломанные ленты показываем ПЕРЕД списком. Раньше отказ фида был неотличим
  // от «ничего нового»: ошибки копились только в консоли service worker'а.
  const broken = state.feeds.filter((f) => {
    if (!f.url || f.enabled === false) return false;
    const st = state.status[feedKey(f)];
    return st && st.lastError;
  });

  for (const feed of broken) {
    const st = state.status[feedKey(feed)];
    const li = document.createElement("li");
    li.className = "problem";
    li.innerHTML = `<div class="title"></div><div class="meta"><span class="feed"></span></div>`;
    li.querySelector(".title").textContent = `⚠ ${feed.title || feed.url}`;
    li.querySelector(".feed").textContent = st.lastError.message;
    li.addEventListener("click", () => chrome.runtime.openOptionsPage());
    list.appendChild(li);
  }

  if (state.recent.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = broken.length
      ? "Новых записей нет. Разберитесь с ошибками выше — возможно, ленты не читаются."
      : "Пока нет новых записей. Расширение проверит ленты по расписанию.";
    list.appendChild(li);
  } else {
    state.recent.forEach((item) => {
      const li = document.createElement("li");
      li.innerHTML = `
        <div class="title"></div>
        <div class="meta"><span class="feed"></span><span class="date"></span></div>
      `;
      li.querySelector(".title").textContent = item.title;
      li.querySelector(".feed").textContent = item.feedTitle || "";
      li.querySelector(".date").textContent = formatDate(item.pubDate || item.foundAt);
      li.addEventListener("click", () => {
        if (item.link) chrome.tabs.create({ url: item.link });
      });
      list.appendChild(li);
    });
  }

  $("#count").textContent = `Лент: ${state.feeds.length}, в списке: ${state.recent.length}`;
}

function setStatus(text) {
  $("#status").textContent = text;
}

function formatDate(s) {
  if (!s) return "";
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}
