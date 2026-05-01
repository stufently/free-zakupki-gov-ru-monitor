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

console.log(`\nPassed: ${pass}`);
console.log(`Failed: ${fail}`);
if (fail > 0) {
  console.log("\nFailures:");
  for (const f of fails) console.log("  - " + f);
  process.exit(1);
}
