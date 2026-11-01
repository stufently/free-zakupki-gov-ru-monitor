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
    // Группируем «Недавние» по ленте: при нескольких лентах плоский список
    // перемешивал закупки из разных поисков, и найти нужную было трудно.
    // Ключ — feedId, а НЕ название: у двух лент может совпасть custom title
    // или channelTitle, и тогда они слились бы в одну группу.
    const groups = new Map();
    for (const item of state.recent) {
      const key = item.feedId || "";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }

    let first = true;
    for (const [feedId, items] of groups) {
      // details/summary вместо div + JS-тогглер: сворачивание работает
      // и с клавиатуры (Tab + Enter/Space) без единой строки JS.
      const details = document.createElement("details");
      // Первую (самую свежую) группу раскрываем сразу — иначе список до
      // первого клика выглядит пустым. Остальные свёрнуты: старые записи
      // не мешают видеть свежие.
      if (first) details.open = true;
      first = false;

      // Метка группы — актуальное название ленты из настроек; для записей
      // от удалённой/переименованной ленты — сохранённое в записи.
      const feed = state.feeds.find((f) => f.id === feedId);
      const label = (feed && feed.title) || items[0].feedTitle || "Без названия";

      const header = document.createElement("summary");
      header.className = "group-header";
      header.innerHTML = `<span class="group-title"></span><span class="group-count"></span>`;
      header.querySelector(".group-title").textContent = label;
      header.querySelector(".group-count").textContent = items.length;

      const sublist = document.createElement("ul");
      sublist.className = "group-items";

      for (const item of items) {
        const li = document.createElement("li");
        li.innerHTML = `
          <div class="title"></div>
          <div class="meta"><span class="date"></span></div>
        `;
        li.querySelector(".title").textContent = item.title;
        li.querySelector(".date").textContent = formatDate(item.pubDate || item.foundAt);
        li.addEventListener("click", () => {
          if (item.link) chrome.tabs.create({ url: item.link });
        });
        sublist.appendChild(li);
      }

      const wrapper = document.createElement("li");
      wrapper.className = "group";
      details.appendChild(header);
      details.appendChild(sublist);
      wrapper.appendChild(details);
      list.appendChild(wrapper);
    }
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
