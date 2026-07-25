import { getState, setFeeds, setSettings, resetFeed, resetAllFeeds, feedKey } from "./storage.js";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

document.addEventListener("DOMContentLoaded", init);

async function init() {
  const state = await getState();

  $("#interval").value = String(state.settings.intervalMinutes);

  $$(".preset").forEach((btn) => {
    btn.addEventListener("click", () => {
      $("#interval").value = btn.dataset.min;
    });
  });

  if (state.feeds.length === 0) {
    // Никаких предустановленных лент. Юзер сам добавляет URL.
    addFeedRow({ id: newId(), title: "", url: "", enabled: true });
  } else {
    state.feeds.forEach(addFeedRow);
  }

  $("#add-feed").addEventListener("click", () =>
    addFeedRow({ id: newId(), title: "", url: "", enabled: true })
  );

  $("#save").addEventListener("click", save);
  $("#check-now").addEventListener("click", checkNow);
  $("#reset-all").addEventListener("click", async () => {
    if (!confirm("Сбросить состояние всех лент? При следующей проверке вы увидите последние записи из каждой ленты (без уведомлений).")) return;
    await resetAllFeeds();
    setStatus("Состояние всех лент сброшено ✓");
  });
}

function addFeedRow(feed) {
  const tpl = $("#feed-tpl").content.cloneNode(true);
  const row = tpl.querySelector(".feed");
  row.dataset.id = feed.id;
  row.querySelector(".title").value = feed.title || "";
  row.querySelector(".url").value = feed.url || "";
  row.querySelector(".enabled input").checked = feed.enabled !== false;
  row.querySelector(".reset").addEventListener("click", async () => {
    const url = row.querySelector(".url").value.trim();
    if (!url) return;
    const key = feedKey({ url });
    await resetFeed(key);
    setStatus(`Лента «${feed.title || url.slice(0, 40)}» сброшена ✓`);
  });
  row.querySelector(".remove").addEventListener("click", () => row.remove());
  $("#feeds").appendChild(row);
}

async function save() {
  const feeds = $$("#feeds .feed")
    .map((row) => ({
      id: row.dataset.id,
      title: row.querySelector(".title").value.trim(),
      url: row.querySelector(".url").value.trim(),
      enabled: row.querySelector(".enabled input").checked,
    }))
    .filter((f) => f.url);

  let intervalMinutes = parseInt($("#interval").value, 10);
  if (!Number.isFinite(intervalMinutes) || intervalMinutes < 1) intervalMinutes = 10;
  if (intervalMinutes > 10080) intervalMinutes = 10080; // 7 дней

  await setFeeds(feeds);
  await setSettings({ intervalMinutes });
  await chrome.runtime.sendMessage({ type: "reschedule" });
  setStatus("Сохранено ✓");
}

async function checkNow() {
  setStatus("Проверяю…");
  await save();
  const res = await chrome.runtime.sendMessage({ type: "checkNow" });
  if (!res || !res.ok) {
    setStatus("Ошибка: " + (res?.error || "неизвестно"));
    return;
  }
  if (res.errors && res.errors.length > 0) {
    setStatus(`Найдено новых: ${res.totalNew}. Ошибок: ${res.errors.length} (см. консоль).`);
    console.warn("Feed errors:", res.errors);
  } else {
    setStatus(`Готово. Новых записей: ${res.totalNew}.`);
  }
}

function setStatus(text) {
  $("#status").textContent = text;
}

function newId() {
  return "f_" + Math.random().toString(36).slice(2, 10);
}
