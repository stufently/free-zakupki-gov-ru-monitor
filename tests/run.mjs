// Простой раннер для парсера. Запуск: docker run --rm -v $PWD:/w -w /w node:20-slim node tests/run.mjs
// Использует @xmldom/xmldom для эмуляции DOMParser в Node (в браузере он нативный).

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { DOMParser } from "@xmldom/xmldom";

// Полифил DOMParser в global для импорта rss.js без правок.
globalThis.DOMParser = DOMParser;

const here = dirname(fileURLToPath(import.meta.url));
const { parseFeed } = await import(join(here, "..", "extension", "rss.js"));

let pass = 0;
let fail = 0;
const fails = [];

function assert(cond, msg) {
  if (cond) {
    pass++;
  } else {
    fail++;
    fails.push(msg);
  }
}

function fixture(name) {
  return readFileSync(join(here, "fixtures", name), "utf8");
}

// --- Test 1: RSS 2.0 базовый
{
  const feed = parseFeed(fixture("rss2-basic.xml"));
  assert(feed.channelTitle === "Тестовый фид", "rss2 channel title");
  assert(feed.items.length === 2, `rss2 items count = ${feed.items.length}`);
  assert(feed.items[0].id === "guid-1", "rss2 first guid");
  assert(feed.items[0].title === "Закупка 1", "rss2 first title");
  assert(feed.items[0].link === "https://zakupki.gov.ru/foo/1", "rss2 first link");
  assert(feed.items[0].pubDate === "Fri, 01 May 2026 10:00:00 +0300", "rss2 first pubDate");
}

// --- Test 2: Atom + alternate link + dc:date
{
  const feed = parseFeed(fixture("atom-with-dc-date.xml"));
  assert(feed.channelTitle === "Atom feed", "atom channel title");
  assert(feed.items.length === 1, `atom items count = ${feed.items.length}`);
  assert(feed.items[0].link === "https://example.com/alt", `atom alternate link = ${feed.items[0].link}`);
  assert(feed.items[0].pubDate.startsWith("2026-05-01"), `atom uses dc:date when no updated, got: ${feed.items[0].pubDate}`);
}

// --- Test 3: HTML entities в description
{
  const feed = parseFeed(fixture("rss2-entities.xml"));
  const desc = feed.items[0].description;
  assert(!/&amp;|&lt;|&gt;|&nbsp;/.test(desc), `entities decoded: ${desc}`);
  assert(desc.includes("Закупка №42"), `nbsp/entity decoded text: ${desc}`);
}

// --- Test 4: RSS с dc:date вместо pubDate
{
  const feed = parseFeed(fixture("rss2-dc-date.xml"));
  assert(feed.items[0].pubDate === "2026-04-30T12:00:00Z", `dc:date used: ${feed.items[0].pubDate}`);
}

// --- Test 5: Невалидный XML — пустой ввод
// (Полноценная проверка <parsererror> работает только в браузерном DOMParser;
// xmldom печатает warnings вместо исключений. Поэтому проверяем только пустой ввод.)
{
  let threw = false;
  try {
    parseFeed("");
  } catch (e) {
    threw = true;
  }
  assert(threw, "throws on empty input");
}

// --- Test 6: относительные <link> разворачиваются относительно URL фида.
// До 0.2.0 такая ссылка уезжала в chrome.tabs.create как есть и не открывалась.
{
  const base = "https://zakupki.gov.ru/epz/order/extendedsearch/rss.html?searchString=охрана";
  const feed = parseFeed(fixture("rss2-relative-link.xml"), base);
  assert(
    feed.items[0].link === "https://zakupki.gov.ru/epz/order/notice/view.html?regNumber=0173100007725000123",
    `relative link resolved: ${feed.items[0].link}`
  );
  assert(
    feed.items[1].link === "https://zakupki.gov.ru/epz/order/notice/view.html?regNumber=999",
    `absolute link untouched: ${feed.items[1].link}`
  );
}

// --- Test 7: HTML вместо RSS должен падать с внятной ошибкой, а не давать items=[].
// Молчаливый items=[] помечал ленту инициализированной, и уведомления не приходили никогда.
{
  let msg = "";
  try {
    parseFeed(fixture("html-error-page.xml"));
  } catch (e) {
    msg = String(e.message);
  }
  assert(/HTML/i.test(msg), `HTML page rejected with clear message, got: ${msg}`);
}

// --- Test 8: XML с чужим корнем — тоже ошибка, а не пустая лента
{
  let msg = "";
  try {
    parseFeed(fixture("not-a-feed.xml"));
  } catch (e) {
    msg = String(e.message);
  }
  assert(/RSS|Atom/i.test(msg), `non-feed XML rejected, got: ${msg}`);
}

// --- Test 9: валидный RSS без записей — это НЕ ошибка,
// и заголовок канала берётся из channel, а не из первой записи
{
  const feed = parseFeed(fixture("rss2-empty-channel.xml"));
  assert(feed.items.length === 0, `empty channel yields 0 items, got ${feed.items.length}`);
  assert(feed.channelTitle === "Пустая лента", `channel title from channel: ${feed.channelTitle}`);
}

// --- Test 10: в RSS-фиде разбираются только <item>; <entry> игнорируется.
// Раньше обе ветки выполнялись всегда и могли давать фантомные записи.
{
  const feed = parseFeed(fixture("rss2-with-stray-entry.xml"));
  assert(feed.items.length === 1, `RSS parses only <item>, got ${feed.items.length}`);
  assert(feed.items[0].id === "real-1", `real item kept: ${feed.items[0].id}`);
  assert(
    !feed.items.some((i) => i.id === "phantom-1"),
    "stray <atom:entry> is not treated as an item"
  );
  assert(
    feed.channelTitle === "RSS с посторонним entry",
    `channel title not confused by atom:link: ${feed.channelTitle}`
  );
}

// --- Test 11: заголовок канала не подменяется заголовком первой записи
{
  const feed = parseFeed(fixture("rss2-basic.xml"));
  assert(feed.channelTitle === "Тестовый фид", `channel title stable: ${feed.channelTitle}`);
  assert(feed.channelTitle !== feed.items[0].title, "channel title != first item title");
}

// --- Test 12: НАСТОЯЩАЯ HTML-страница (невалидная как XML) тоже распознаётся.
// Предыдущая фикстура была намеренно XML-корректной и не проверяла главный случай:
// у реального HTML5 незакрытые <meta>/<br>/<img>, и DOMParser отдал бы
// бесполезное «Невалидный XML» вместо понятного объяснения.
{
  let msg = "";
  try {
    parseFeed(fixture("html-real-page.html.xml"));
  } catch (e) {
    msg = String(e.message);
  }
  assert(/HTML-страницу/i.test(msg), `real HTML5 page detected before XML parsing, got: ${msg}`);
}

// --- Test 13: <item>, вложенный в содержимое записи, не становится отдельной записью.
// getElementsByTagName обходит всё поддерево, поэтому обход переведён на прямых потомков.
{
  const feed = parseFeed(fixture("rss2-nested-item.xml"));
  assert(feed.items.length === 1, `nested <item> ignored, got ${feed.items.length} items`);
  assert(feed.items[0].id === "real-1", `outer item kept: ${feed.items[0].id}`);
  assert(!feed.items.some((i) => i.id === "phantom-1"), "nested item is not a separate entry");
}

// --- Test 14: RSS 1.0 (RDF), где item лежат рядом с channel, а не внутри него
{
  const feed = parseFeed(fixture("rdf-rss1.xml"));
  assert(feed.channelTitle === "Лента RSS 1.0", `rdf channel title: ${feed.channelTitle}`);
  assert(feed.items.length === 1, `rdf items count = ${feed.items.length}`);
  assert(feed.items[0].title === "Закупка из RDF-ленты", `rdf item title: ${feed.items[0].title}`);
  assert(feed.items[0].pubDate === "2026-07-20T09:00:00Z", `rdf dc:date: ${feed.items[0].pubDate}`);
}

// --- Test 15: лента без XML-пролога, у которой в описании встречается <html>,
// не должна отвергаться как HTML-страница
{
  const feed = parseFeed(fixture("rss2-no-prolog-html-mention.xml"));
  assert(feed.items.length === 1, `feed without prolog still parsed, got ${feed.items.length}`);
  assert(feed.channelTitle === "Лента без XML-пролога", `channel title: ${feed.channelTitle}`);
}

// --- Test 16: РЕАЛЬНАЯ лента ЕИС (снята 29.07.2026 через российский прокси).
// До 0.2.0 парсер вообще не проверялся на живых данных — только на придуманных
// фикстурах, из-за чего отказ 0.1.0 прожил три месяца незамеченным.
{
  const base = "https://zakupki.gov.ru/epz/order/extendedsearch/rss.html?searchString=охрана";
  const feed = parseFeed(fixture("real-eis-rss.xml"), base);

  assert(feed.items.length === 5, `real feed items = ${feed.items.length}`);

  // В лентах ЕИС <guid> нет вообще, поэтому идентичность держится на <link>
  // с regNumber. Если это сломается, дедупликация начнёт слать дубли уведомлений.
  assert(
    feed.items.every((i) => i.id && i.id === i.link),
    "real feed: id falls back to <link> (no <guid> in EIS feeds)"
  );
  assert(
    feed.items.every((i) => /^https:\/\/zakupki\.gov\.ru\/.*regNumber=\d+/.test(i.link)),
    "real feed: every link is absolute and carries regNumber"
  );
  assert(
    new Set(feed.items.map((i) => i.id)).size === feed.items.length,
    "real feed: ids are unique — no dedup collisions"
  );
  assert(
    feed.items.every((i) => i.pubDate && !isNaN(new Date(i.pubDate).getTime())),
    "real feed: pubDate present and parseable"
  );
  // description приходит с двойным кодированием (&lt;b&gt;), после разбора
  // не должно остаться ни тегов, ни entity — иначе они полезут в уведомление.
  assert(
    feed.items.every((i) => !/<[a-z/]/i.test(i.description || "")),
    "real feed: no HTML tags left in description"
  );
  assert(
    feed.items.every((i) => !/&(lt|gt|amp|nbsp|quot);/.test(i.description || "")),
    "real feed: no leftover entities in description"
  );
  assert(
    feed.channelTitle === "Результаты поиска в реестре заказов и закупок",
    `real feed channel title: ${feed.channelTitle}`
  );
}

console.log(`\nPassed: ${pass}`);
console.log(`Failed: ${fail}`);
if (fail > 0) {
  console.log("\nFailures:");
  for (const f of fails) console.log("  - " + f);
  process.exit(1);
}
