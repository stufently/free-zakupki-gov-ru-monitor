// Минимальный парсер RSS 2.0 / Atom без внешних зависимостей.
// Поддерживает: <item> (RSS 2.0), <entry> (Atom), namespaced теги (dc:date, atom:link и т.п.).

export function parseFeed(xmlText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, "application/xml");
  // В браузерном DOMParser ошибки возвращаются как <parsererror>; в xmldom (для тестов) —
  // парсер кидает исключение или возвращает null/empty. Проверяем оба пути.
  const errNodes = doc.getElementsByTagName("parsererror");
  if (errNodes && errNodes.length > 0) {
    throw new Error("Невалидный XML: " + (errNodes[0].textContent || "").slice(0, 200));
  }

  const root = doc.documentElement;
  if (!root) throw new Error("Пустой XML");

  const channelTitle =
    findText(root, "channel", "title") ||
    findText(root, null, "title") ||
    "RSS";

  const items = [];

  // RSS 2.0: channel > item
  forEachByLocalName(root, "item", (node) => {
    const link = findText(node, null, "link");
    const guid = findText(node, null, "guid");
    const id = guid || link || findText(node, null, "title");
    items.push({
      id,
      title: findText(node, null, "title") || "(без заголовка)",
      link,
      pubDate:
        findText(node, null, "pubDate") ||
        findText(node, "dc", "date") ||
        findText(node, null, "date"),
      description: stripHtml(findText(node, null, "description")),
    });
  });

  // Atom: feed > entry
  forEachByLocalName(root, "entry", (node) => {
    const linkEl = findAtomAlternateLink(node);
    const id = findText(node, null, "id") || (linkEl ? linkEl.getAttribute("href") : "");
    items.push({
      id,
      title: findText(node, null, "title") || "(без заголовка)",
      link: linkEl ? linkEl.getAttribute("href") : "",
      pubDate:
        findText(node, null, "updated") ||
        findText(node, null, "published") ||
        findText(node, "dc", "date"),
      description: stripHtml(
        findText(node, null, "summary") || findText(node, null, "content")
      ),
    });
  });

  return { channelTitle, items };
}

// Ищет первый descendant-элемент по localName (опционально с префиксом),
// возвращает текст. Игнорирует namespace URI — матчится по local name.
function findText(root, prefix, localName) {
  const node = findElement(root, prefix, localName);
  if (!node) return "";
  // Декодируем entities через innerHTML/textContent — DOMParser сам всё разворачивает.
  return (node.textContent || "").trim();
}

function findElement(root, prefix, localName) {
  const want = prefix ? `${prefix}:${localName}` : localName;
  const nodes = root.getElementsByTagName(want);
  if (nodes.length > 0) return nodes[0];
  // Fallback: ищем по localName, игнорируя префикс.
  if (!prefix) {
    const all = root.getElementsByTagName("*");
    for (let i = 0; i < all.length; i++) {
    const n = all[i];
      if (n.localName === localName) return n;
    }
  }
  return null;
}

function forEachByLocalName(root, localName, fn) {
  const all = root.getElementsByTagName("*");
  for (let i = 0; i < all.length; i++) {
    const n = all[i];
    if (n.localName === localName) fn(n);
  }
}

// Atom: <link rel="alternate" href="..."> или первый <link href="..."> без rel.
function findAtomAlternateLink(entry) {
  const links = entry.getElementsByTagName("*");
  let fallback = null;
  for (let i = 0; i < links.length; i++) {
    const n = links[i];
    if (n.localName !== "link") continue;
    const rel = n.getAttribute("rel");
    if (!rel || rel === "alternate") {
      if (n.hasAttribute("href")) return n;
    }
    if (!fallback && n.hasAttribute("href")) fallback = n;
  }
  return fallback;
}

function stripHtml(s) {
  if (!s) return "";
  // DOMParser декодирует entities внутри CDATA/text. Но если description пришёл
  // как escaped HTML (двойное кодирование) — раскодируем основные именованные/числовые entities.
  let decoded = s;
  if (/&[a-z#0-9]+;/i.test(decoded)) decoded = decodeEntities(decoded);
  return decoded.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim().slice(0, 500);
}

function decodeEntities(s) {
  const named = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&apos;": "'",
    "&nbsp;": " ",
    "&laquo;": "«",
    "&raquo;": "»",
    "&mdash;": "—",
    "&ndash;": "–",
    "&hellip;": "…",
    "&#39;": "'",
  };
  return s
    .replace(/&[a-z]+;|&#39;/gi, (m) => (named[m] !== undefined ? named[m] : m))
    .replace(/&#(\d+);/g, (m, n) => safeFromCodePoint(parseInt(n, 10), m))
    .replace(/&#x([0-9a-f]+);/gi, (m, n) => safeFromCodePoint(parseInt(n, 16), m));
}

// String.fromCodePoint выбрасывает RangeError на > 0x10FFFF и на NaN.
// Робастно глотаем — вернём исходную последовательность, чтобы не уронить парсер.
function safeFromCodePoint(n, fallback) {
  if (!Number.isFinite(n) || n < 0 || n > 0x10ffff) return fallback;
  try {
    return String.fromCodePoint(n);
  } catch {
    return fallback;
  }
}
