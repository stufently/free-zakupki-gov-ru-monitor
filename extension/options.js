import { getState, setSettings, feedKey, isAllowedFeedUrl, FEED_HOST } from "./storage.js";

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

  renderFeeds(state);

  $("#add-feed").addEventListener("click", () =>
    addFeedRow({ id: newId(), title: "", url: "", enabled: true })
  );

  $("#save").addEventListener("click", save);
  $("#check-now").addEventListener("click", checkNow);
  $("#reset-all").addEventListener("click", resetAll);
}

// Полная перерисовка списка лент — только при открытии настроек. После save()
// строки НЕ перерисовываются (обновляются только кнопки «Сбросить» на месте):
// saveFeeds ждёт в общей очереди десятки секунд, и перерисовка молча откатила
// бы всё, что пользователь успел ввести, добавить или удалить за это время.
async function renderFeeds(state) {
  const feeds = $("#feeds");
  feeds.innerHTML = "";
  if (state.feeds.length === 0) {
    // Никаких предустановленных лент. Юзер сам добавляет URL.
    addFeedRow({ id: newId(), title: "", url: "", enabled: true });
  } else {
    state.feeds.forEach((f) => addFeedRow(f, state.status[feedKey(f)]));
  }
  updateCertHelp(state);
}

async function resetAll() {
  if (!confirm("Сбросить состояние всех лент? При следующей проверке вы увидите последние записи из каждой ленты (без уведомлений).")) return;
  // Через service worker: сброс сериализуется с идущей фоновой проверкой.
  const res = await chrome.runtime.sendMessage({ type: "resetAllFeeds" });
  if (!res || !res.ok) {
    setStatus("Ошибка: " + (res?.error || "неизвестно"));
    return;
  }
  setStatus("Состояние всех лент сброшено ✓");
}

function addFeedRow(feed, status) {
  const tpl = $("#feed-tpl").content.cloneNode(true);
  const row = tpl.querySelector(".feed-row");
  row.dataset.id = feed.id;
  row.querySelector(".title").value = feed.title || "";
  row.querySelector(".url").value = feed.url || "";
  row.querySelector(".enabled input").checked = feed.enabled !== false;
  row.querySelector(".remove").addEventListener("click", () => row.remove());
  row.querySelector(".reset").addEventListener("click", onResetClick);
  // Ключ — из СОХРАНЁННОГО объекта ленты, а не из input: по несохранённому
  // URL сбрасывать нечего. Хранится в dataset, а не в замыкании — save()
  // обновляет его на месте, не перерисовывая строки.
  updateResetButton(row, feed);
  renderStatus(row.querySelector(".feed-status"), status, feed.url);
  $("#feeds").appendChild(row);
}

// Синхронизирует кнопку «Сбросить» со строки с сохранённым состоянием ленты.
// Вызывается при отрисовке и после каждого save() — БЕЗ перерисовки строк:
// saveFeeds ждёт в общей очереди (фоновая проверка — это десятки секунд),
// и полная перерисовка молча откатила бы всё, что пользователь успел
// ввести, добавить или удалить за это время.
function updateResetButton(row, savedFeed) {
  const btn = row.querySelector(".reset");
  if (savedFeed && savedFeed.url) {
    row.dataset.resetKey = feedKey(savedFeed);
    btn.disabled = false;
    btn.title = "Забыть состояние ленты: при следующей проверке её текущие записи снова попадут в «Недавние» (без уведомлений)";
  } else {
    delete row.dataset.resetKey;
    btn.disabled = true;
    btn.title = "Сначала сохраните ленту и дождитесь первой проверки";
  }
}

async function onResetClick(event) {
  const row = event.currentTarget.closest(".feed-row");
  const key = row.dataset.resetKey;
  if (!key) return;
  const res = await chrome.runtime.sendMessage({ type: "resetFeed", urlKey: key });
  if (!res || !res.ok) {
    setStatus("Ошибка: " + (res?.error || "неизвестно"));
    return;
  }
  if (!res.changed) {
    setStatus("Нечего сбрасывать: лента ещё не проверялась.");
    return;
  }
  const title = row.querySelector(".title").value.trim() || key.slice(0, 40);
  setStatus(`Лента «${title}» сброшена ✓`);
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

  // Сохранение лент — через service worker: setFeeds делает read-modify-write
  // над seenIds/initialized и должен сериализоваться с фоновыми проверками и
  // сбросами (runSerialized там), иначе параллельный «Сбросить» терялся бы.
  // Очередь может ждать десятки секунд (идёт фоновая проверка) — на это время
  // блокируем форму. Блокировка снимается только в самом конце save():
  // повторное «Сохранить» в промежутке могло бы закончиться раньше первого
  // и перезаписать обновлённые ключи старыми данными.
  $("#save").disabled = true;
  $("#check-now").disabled = true;
  setStatus("Сохраняю…");
  try {
    const res = await chrome.runtime.sendMessage({ type: "saveFeeds", feeds });
    if (!res || !res.ok) {
      setStatus("Ошибка: " + (res?.error || "неизвестно"));
      return false;
    }
    await setSettings({ intervalMinutes });
    await chrome.runtime.sendMessage({ type: "reschedule" });
    // Ленту могли выключить или удалить — badge с ошибкой должен это учесть.
    await chrome.runtime.sendMessage({ type: "refreshBadge" });
    // Обновляем на месте только служебные элементы строк — не перерисовывая
    // их и не трогая введённые значения (см. updateResetButton):
    //   - ключ и кнопку «Сбросить»;
    //   - диагностику проверки — по НОВОМУ ключу: после смены URL старый
    //     .feed-status и подсказка про сертификат относились к прежней ленте.
    const state = await getState();
    $$("#feeds .feed-row").forEach((row) => {
      const saved = feeds.find((f) => f.id === row.dataset.id);
      updateResetButton(row, saved);
      renderStatus(
        row.querySelector(".feed-status"),
        saved && saved.url ? state.status[feedKey(saved)] : null,
        saved && saved.url
      );
    });
    updateCertHelp(state);
    setStatus("Сохранено ✓");
    return true;
  } finally {
    $("#save").disabled = false;
    $("#check-now").disabled = false;
  }
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
