// Минимальный парсер RSS 2.0 / Atom без внешних зависимостей.
// Работает без DOMParser (недоступен в service worker Chrome MV3).
// Поддерживает: <item> (RSS 2.0), <entry> (Atom), namespaced теги (dc:date и т.п.), CDATA.

export function parseFeed(xmlText) {
  if (!xmlText || !xmlText.trim()) throw new Error("Пустой XML");

  const xml = xmlText.trim();

  if (!/<(?:\?xml|rss|feed|!DOCTYPE)\b/i.test(xml) && !/<channel\b/i.test(xml)) {
    throw new Error("Невалидный XML: не найден корневой элемент RSS/Atom");
  }

  const isAtom = /<feed\b/i.test(xml);
  const channelTitle = extractTagContent(xml, "title") || "RSS";
  const items = [];

  if (!isAtom) {
    const itemBlocks = extractBlocks(xml, "item");
    for (const block of itemBlocks) {
      const link = extractTagContent(block, "link");
      const guid = extractTagContent(block, "guid");
      const id = guid || link || extractTagContent(block, "title");
      items.push({
        id,
        title: extractTagContent(block, "title") || "(без заголовка)",
        link,
        pubDate:
          extractTagContent(block, "pubDate") ||
          extractTagContent(block, "dc:date") ||
          extractTagContent(block, "date"),
        description: stripHtml(extractTagContent(block, "description")),
      });
    }
  }

  const entryBlocks = extractBlocks(xml, "entry");
  for (const block of entryBlocks) {
    const linkEl = extractAtomAlternateLink(block);
    const id = extractTagContent(block, "id") || linkEl || "";
    items.push({
      id,
      title: extractTagContent(block, "title") || "(без заголовка)",
      link: linkEl || "",
      pubDate:
        extractTagContent(block, "updated") ||
        extractTagContent(block, "published") ||
        extractTagContent(block, "dc:date"),
      description: stripHtml(
        extractTagContent(block, "summary") || extractTagContent(block, "content")
      ),
    });
  }

  return { channelTitle, items };
}

function extractBlocks(xml, tagName) {
  const blocks = [];
  const re = new RegExp(
    `<${esc(tagName)}[\\s>][\\s\\S]*?<\\/${esc(tagName)}>`,
    "gi"
  );
  let m;
  while ((m = re.exec(xml)) !== null) blocks.push(m[0]);
  return blocks;
}

function extractTagContent(xml, tagName) {
  const pat = tagName.includes(":")
    ? esc(tagName)
    : `(?:[a-zA-Z_][\\w.-]*:)?${esc(tagName)}`;
  const re = new RegExp(
    `<${pat}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${pat}>`,
    "i"
  );
  const m = re.exec(xml);
  if (!m) return "";
  let text = decodeCDATA(m[1].trim());
  text = decodeEntities(text);
  return text;
}

function decodeCDATA(s) {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}

function extractAtomAlternateLink(block) {
  const fallbacks = [];
  const re = /<link\b([^>]*?)(?:\/?\s*>)/gi;
  let m;
  while ((m = re.exec(block)) !== null) {
    const attrs = m[1];
    const href = attr(attrs, "href");
    const rel = attr(attrs, "rel");
    if (href) {
      if (!rel || rel === "alternate") return href;
      fallbacks.push(href);
    }
  }
  return fallbacks[0] || "";
}

function attr(attrsStr, name) {
  const re = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i");
  const m = attrsStr.match(re);
  return m ? (m[1] ?? m[2] ?? "") : "";
}

function stripHtml(s) {
  if (!s) return "";
  let decoded = s;
  // Двойное кодирование: &amp;nbsp; → &nbsp; → пробел.
  // Первый проход декодирует外层 entities, второй — вложенные.
  if (/&[a-z#0-9]+;/i.test(decoded)) decoded = decodeEntities(decoded);
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
    .replace(/&[a-z]+;|&#39;/gi, (m) => {
      const low = m.toLowerCase();
      return named[low] !== undefined ? named[low] : m;
    })
    .replace(/&#(\d+);/g, (m, n) => safeCP(parseInt(n, 10), m))
    .replace(/&#x([0-9a-f]+);/gi, (m, n) => safeCP(parseInt(n, 16), m));
}

function safeCP(n, fb) {
  if (!Number.isFinite(n) || n < 0 || n > 0x10ffff) return fb;
  try { return String.fromCodePoint(n); } catch { return fb; }
}

function esc(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
