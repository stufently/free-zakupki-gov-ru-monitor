// Гард против регрессии, из-за которой расширение не работало до 0.2.0.
//
// В MV3 service worker нет DOM API: DOMParser/document/window там не существуют
// ни в одной версии Chrome. Прямой вызов падает с ReferenceError на каждой
// проверке ленты, а ошибка глушится общим catch — расширение молча ничего не делает.
// Парсер обязан жить в offscreen-документе.
//
// Запуск: node check-sw.mjs

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const extDir = join(here, "..", "extension");

const problems = [];

// Вырезает комментарии, строковые литералы и regexp'ы, оставляя только код.
// Без этого проверка спотыкается о собственные комментарии вида "здесь нет document".
export function stripNonCode(src) {
  let out = "";
  let i = 0;
  // Предыдущий значимый символ — нужен, чтобы отличить деление от начала regexp.
  let prevSignificant = "";

  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];

    if (c === "/" && next === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && next === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      i++;
      while (i < src.length) {
        if (src[i] === "\\") { i += 2; continue; }
        if (src[i] === quote) { i++; break; }
        i++;
      }
      out += '""';
      prevSignificant = '"';
      continue;
    }
    // Начало regexp-литерала: '/' после оператора или открывающей скобки.
    if (c === "/" && (prevSignificant === "" || "(,=:[!&|?{};+-*%~^".includes(prevSignificant))) {
      i++;
      let inClass = false;
      while (i < src.length) {
        if (src[i] === "\\") { i += 2; continue; }
        if (src[i] === "[") inClass = true;
        else if (src[i] === "]") inClass = false;
        else if (src[i] === "/" && !inClass) { i++; break; }
        else if (src[i] === "\n") break;
        i++;
      }
      while (i < src.length && /[a-z]/.test(src[i])) i++; // флаги
      out += "//";
      prevSignificant = "/";
      continue;
    }

    out += c;
    if (!/\s/.test(c)) prevSignificant = c;
    i++;
  }
  return out;
}

// Убирает только комментарии, строки оставляет — для проверок,
// которым как раз нужно заглянуть внутрь строкового литерала (пути импорта).
export function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

function check() {
  const manifest = JSON.parse(readFileSync(join(extDir, "manifest.json"), "utf8"));
  const swName = manifest.background && manifest.background.service_worker;
  if (!swName) {
    problems.push("в manifest.json не объявлен background.service_worker");
    return;
  }

  const swSource = readFileSync(join(extDir, swName), "utf8");
  const code = stripNonCode(swSource);

  const banned = [
    [/\bnew\s+DOMParser\b/, "new DOMParser()"],
    [/\bDOMParser\s*\./, "DOMParser.*"],
    [/\bdocument\s*\./, "document.*"],
    [/\bwindow\s*\./, "window.*"],
    [/\bXMLHttpRequest\b/, "XMLHttpRequest"],
    [/\blocalStorage\b/, "localStorage"],
  ];
  for (const [re, label] of banned) {
    if (re.test(code)) {
      problems.push(`${swName} использует ${label} — в MV3 service worker этого нет. Перенесите в offscreen-документ.`);
    }
  }

  // Проверка совместимости с minimum_chrome_version. chrome.offscreen.hasDocument()
  // появился только в Chrome 150: на заявленных 119+ это undefined и TypeError
  // при первой же проверке ленты. Аналог, доступный с Chrome 116, —
  // chrome.runtime.getContexts().
  const minChrome = parseInt(manifest.minimum_chrome_version, 10);
  if (/\boffscreen\s*\.\s*hasDocument\b/.test(code) && (!Number.isFinite(minChrome) || minChrome < 150)) {
    problems.push(
      `${swName} вызывает chrome.offscreen.hasDocument(), доступный только с Chrome 150, ` +
        `а manifest.minimum_chrome_version = ${manifest.minimum_chrome_version}. ` +
        `Используйте chrome.runtime.getContexts() (Chrome 116+).`
    );
  }
  if (/\bruntime\s*\.\s*getContexts\b/.test(code) && (!Number.isFinite(minChrome) || minChrome < 116)) {
    problems.push(
      `${swName} вызывает chrome.runtime.getContexts() (Chrome 116+), ` +
        `а manifest.minimum_chrome_version = ${manifest.minimum_chrome_version}.`
    );
  }

  // Путь импорта проверяем по исходнику: в code строковые литералы уже вырезаны,
  // и "./rss.js" там просто не осталось бы.
  if (/\bfrom\s*["'][^"']*\brss\.js["']/.test(stripComments(swSource))) {
    problems.push(`${swName} импортирует rss.js напрямую — парсер должен вызываться через offscreen-документ.`);
  }

  for (const f of ["offscreen.html", "offscreen.js"]) {
    if (!existsSync(join(extDir, f))) problems.push(`нет файла extension/${f}`);
  }
  if (!(manifest.permissions || []).includes("offscreen")) {
    problems.push('в manifest.json нет разрешения "offscreen"');
  }

  // Локали: каждый __MSG_key__ должен существовать, иначе Chrome не загрузит расширение.
  const locale = manifest.default_locale;
  if (locale) {
    const msgPath = join(extDir, "_locales", locale, "messages.json");
    if (!existsSync(msgPath)) {
      problems.push(`нет файла ${msgPath}`);
    } else {
      const messages = JSON.parse(readFileSync(msgPath, "utf8"));
      const used = new Set(
        [...JSON.stringify(manifest).matchAll(/__MSG_([A-Za-z0-9_]+)__/g)].map((m) => m[1])
      );
      for (const key of used) {
        if (!(key in messages)) problems.push(`в _locales/${locale}/messages.json нет ключа "${key}"`);
      }
    }
  }
}

// Самопроверка: гард обязан ловить именно тот код, который сломал 0.1.0.
function selfTest() {
  const bad = 'import { parseFeed } from "./rss.js";\nconst doc = new DOMParser().parseFromString(x, "application/xml");';
  const stripped = stripNonCode(bad);
  if (!/\bnew\s+DOMParser\b/.test(stripped)) {
    problems.push("САМОПРОВЕРКА: гард не распознаёт new DOMParser — проверка бесполезна");
  }
  if (!/\bfrom\s*["'][^"']*\brss\.js["']/.test(stripComments(bad))) {
    problems.push("САМОПРОВЕРКА: гард не распознаёт импорт rss.js — проверка бесполезна");
  }
  const decoy = '// здесь нет document. и нет new DOMParser\nconst re = /single offscreen document/i;\nconst s = "document.title";';
  if (/\bdocument\s*\./.test(stripNonCode(decoy))) {
    problems.push("САМОПРОВЕРКА: гард срабатывает на комментариях/строках — будут ложные падения");
  }
  // Комментарий, упоминающий импорт, не должен считаться импортом.
  if (/\bfrom\s*["'][^"']*\brss\.js["']/.test(stripComments('// не импортируйте from "./rss.js" здесь'))) {
    problems.push("САМОПРОВЕРКА: упоминание импорта в комментарии считается импортом");
  }
}

selfTest();
check();

if (problems.length > 0) {
  console.error("Проверка service worker'а не пройдена:\n");
  for (const p of problems) console.error("  - " + p);
  process.exit(1);
}
console.log("check-sw: OK — service worker свободен от DOM API, offscreen на месте, локали целы.");
