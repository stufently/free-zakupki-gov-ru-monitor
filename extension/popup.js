import { getState, clearRecent } from "./storage.js";

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
  try {
    await chrome.action.setBadgeText({ text: "" });
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

  if (state.recent.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "Пока нет новых записей. Расширение проверит ленты по расписанию.";
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
