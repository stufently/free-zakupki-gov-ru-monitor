import { getState, setFeeds, setSettings, feedKey, isAllowedFeedUrl, FEED_HOST } from "./storage.js";

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
    state.feeds.forEach((f) => addFeedRow(f, state.status[feedKey(f)]));
  }
  updateCertHelp(state);

  $("#add-feed").addEventListener("click", () =>
    addFeedRow({ id: newId(), title: "", url: "", enabled: true })
  );

  $("#save").addEventListener("click", save);
  $("#check-now").addEventListener("click", checkNow);
}

function addFeedRow(feed, status) {
  const tpl = $("#feed-tpl").content.cloneNode(true);
  const row = tpl.querySelector(".feed-row");
  row.dataset.id = feed.id;
  row.querySelector(".title").value = feed.title || "";
  row.querySelector(".url").value = feed.url || "";
  row.querySelector(".enabled input").checked = feed.enabled !== false;
  row.querySelector(".remove").addEventListener("click", () => row.remove());
  renderStatus(row.querySelector(".feed-status"), status, feed.url);
  $("#feeds").appendChild(row);
}

// Показываем состояние последней проверки прямо под лентой. До 0.2.0 фоновые
// ошибки не отображались нигде: сломанная лента выглядела как «новых записей нет».
function renderStatus(el, status, url) {
  el.className = "feed-status";
  // У пустой, только что добавленной строки состояния быть не может.
  if (!url) {
    el.textContent = "";
    return;
  }
  if (!status || (!status.lastAttemptAt && !status.lastSuccessAt)) {
    el.textContent = "Ещё не проверялась.";
    return;
  }
  if (status.lastError) {
    el.classList.add("error");
    el.textContent = `Ошибка: ${status.lastError.message} (${formatDate(status.lastError.at)})`;
    return;
  }
  el.classList.add("ok");
  const count = Number.isFinite(status.lastItemCount) ? `, записей в ленте: ${status.lastItemCount}` : "";
  el.textContent = `Проверена ${formatDate(status.lastSuccessAt || status.lastAttemptAt)}${count}.`;
}

function updateCertHelp(state) {
  const hasNetworkError = state.feeds.some((f) => {
    const st = state.status[feedKey(f)];
    return st && st.lastError && st.lastError.hint === "cert";
  });
  $("#cert-help").hidden = !hasNetworkError;
}

async function save() {
  const feeds = $$("#feeds .feed-row")
    .map((row) => ({
      id: row.dataset.id,
      title: row.querySelector(".title").value.trim(),
      url: row.querySelector(".url").value.trim(),
      enabled: row.querySelector(".enabled input").checked,
    }))
    .filter((f) => f.url);

  // Чужой адрес отсекаем здесь, а не после первой проверки: так пользователь
  // видит причину сразу, и запрос на сторонний сайт не уходит вовсе.
  const wrong = feeds.filter((f) => !isAllowedFeedUrl(f.url));
  if (wrong.length > 0) {
    setStatus(`Ссылка должна вести на https://${FEED_HOST} — не сохранено: ${wrong[0].url}`);
    return false;
  }

  let intervalMinutes = parseInt($("#interval").value, 10);
  if (!Number.isFinite(intervalMinutes) || intervalMinutes < 1) intervalMinutes = 10;
  if (intervalMinutes > 10080) intervalMinutes = 10080; // 7 дней

  await setFeeds(feeds);
  await setSettings({ intervalMinutes });
  await chrome.runtime.sendMessage({ type: "reschedule" });
  // Ленту могли выключить или удалить — badge с ошибкой должен это учесть.
  await chrome.runtime.sendMessage({ type: "refreshBadge" });
  setStatus("Сохранено ✓");
  return true;
}

async function checkNow() {
  setStatus("Проверяю…");
  // Не сохранилось — значит адрес не с портала; сообщение уже показано.
  if ((await save()) !== true) return;
  const res = await chrome.runtime.sendMessage({ type: "checkNow" });
  if (!res || !res.ok) {
    setStatus("Ошибка: " + (res?.error || "неизвестно"));
    return;
  }

  // Перерисовываем статусы: проверка только что записала свежую диагностику.
  const state = await getState();
  $$("#feeds .feed-row").forEach((row) => {
    const url = row.querySelector(".url").value.trim();
    if (!url) return;
    renderStatus(row.querySelector(".feed-status"), state.status[feedKey({ url })], url);
  });
  updateCertHelp(state);

  if (res.errors && res.errors.length > 0) {
    setStatus(`Новых записей: ${res.totalNew}. Лент с ошибкой: ${res.errors.length} — подробности под лентой.`);
  } else {
    setStatus(`Готово. Новых записей: ${res.totalNew}.`);
  }
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

function newId() {
  return "f_" + Math.random().toString(36).slice(2, 10);
}
