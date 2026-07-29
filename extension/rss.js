// Минимальный парсер RSS 2.0 / Atom / RSS 1.0 (RDF) поверх нативного DOMParser.
//
// ВАЖНО: DOMParser НЕ существует в service worker MV3 (там ServiceWorkerGlobalScope
// без DOM API). Поэтому этот модуль исполняется в offscreen-документе — см.
// offscreen.js и ensureOffscreen() в background.js. Импортировать его напрямую
// из background.js нельзя: будет ReferenceError на каждой проверке ленты.
//
// baseUrl — URL, с которого фид был скачан. Нужен, чтобы разворачивать
// относительные <link> в абсолютные (иначе chrome.tabs.create получит мусор).

export function parseFeed(xmlText, baseUrl) {
  if (!xmlText || !xmlText.trim()) throw new Error("Пустой ответ: сервер не вернул содержимого");

  // HTML распознаём ДО разбора. Реальная HTML5-страница (с <meta>, <br>,
  // незакрытыми тегами) невалидна как XML, поэтому DOMParser вернул бы
  // <parsererror> и пользователь увидел бы бесполезное «Невалидный XML»
  // вместо понятного «портал отдал страницу вместо ленты».
  if (looksLikeHtml(xmlText)) {
    throw new Error(
      "Сервер вернул HTML-страницу вместо RSS. Проверьте ссылку — она должна открывать XML с тегами <channel> и <item>."
    );
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, "application/xml");
  // В браузерном DOMParser ошибки возвращаются как <parsererror>; в xmldom (для тестов) —
  // парсер печатает warnings и отдаёт частичный документ. Проверяем оба пути:
  // невалидную структуру ловит проверка корневого элемента ниже.
  const errNodes = doc.getElementsByTagName("parsererror");
  if (errNodes && errNodes.length > 0) {
    throw new Error("Невалидный XML: " + (errNodes[0].textContent || "").trim().slice(0, 200));
  }

  const root = doc.documentElement;
  if (!root) throw new Error("Пустой XML");

  const rootName = (root.localName || "").toLowerCase();

  if (rootName === "html") {
    throw new Error(
      "Сервер вернул HTML-страницу вместо RSS. Проверьте ссылку — она должна открывать XML с тегами <channel> и <item>."
    );
  }
  if (rootName !== "rss" && rootName !== "feed" && rootName !== "rdf") {
    throw new Error(`Не похоже на RSS или Atom: корневой элемент <${root.nodeName}>`);
  }

  const isAtom = rootName === "feed";
  const channelTitle = findChannelTitle(root, isAtom) || "RSS";
  const items = [];

  // Обходим ТОЛЬКО прямых потомков контейнера. getElementsByTagName ищет по всему
  // поддереву, поэтому <item>, вложенный в чужое содержимое записи (например
  // в content:encoded с настоящей разметкой), становился отдельной записью.
  if (isAtom) {
    // Atom: feed > entry
    eachDirectChild(root, "entry", (node) => {
      const link = resolveUrl(findAtomAlternateHref(node), baseUrl);
      const id = findText(node, null, "id") || link;
      items.push({
        id,
        title: findText(node, null, "title") || "(без заголовка)",
        link,
        pubDate:
          findText(node, null, "updated") ||
          findText(node, null, "published") ||
          findText(node, "dc", "date"),
        description: stripHtml(
          findText(node, null, "summary") || findText(node, null, "content")
        ),
      });
    });
  } else {
    // RSS 2.0: channel > item. RSS 1.0 (RDF): item лежат рядом с channel, под корнем.
    // Раньше <entry> искались и здесь тоже — из-за чего Atom-разметка, попавшая
    // внутрь описания, порождала фантомные записи. Теперь ветки взаимоисключающие.
    const containers = [];
    const channel = firstChildByLocalName(root, "channel");
    if (channel) containers.push(channel);
    if (rootName === "rdf") containers.push(root);

    const visit = (node) => {
      const link = resolveUrl(findText(node, null, "link"), baseUrl);
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
    };

    for (const container of containers) eachDirectChild(container, "item", visit);
  }

  return { channelTitle, items };
}

// Признаки HTML-страницы в сыром тексте, до разбора XML.
// Маркер HTML засчитываем, только если он идёт РАНЬШЕ корневого тега ленты:
// иначе фид без XML-пролога, у которого в описании первой записи встретился
// <html>, был бы отвергнут целиком.
function looksLikeHtml(src) {
  const head = src.slice(0, 1000).toLowerCase();
  if (/<\?xml/.test(head)) return false; // XML-пролог — точно не HTML-страница
  const htmlAt = head.search(/<!doctype\s+html|<html[\s>]/);
  if (htmlAt === -1) return false;
  const feedAt = head.search(/<(rss|feed|rdf:rdf)[\s>]/);
  return feedAt === -1 || htmlAt < feedAt;
}

// Перебирает только прямых потомков с нужным localName.
function eachDirectChild(parent, localName, fn) {
  const kids = parent.childNodes || [];
  // Копируем в массив: fn не меняет дерево, но childNodes — живая коллекция.
  const found = [];
  for (let i = 0; i < kids.length; i++) {
    const n = kids[i];
    if (n.nodeType === 1 && n.localName === localName) found.push(n);
  }
  found.forEach(fn);
}

// Заголовок канала берём строго из прямых детей channel/feed.
// Раньше брался первый <title> во всём документе — на пустом канале это молча
// подставляло заголовок первой записи.
function findChannelTitle(root, isAtom) {
  if (isAtom) return directChildText(root, "title");
  const channel = firstChildByLocalName(root, "channel");
  if (channel) return directChildText(channel, "title");
  // RSS 1.0 (RDF): channel лежит в другом namespace, но структура та же.
  return directChildText(root, "title");
}

function firstChildByLocalName(node, localName) {
  const kids = node.childNodes || [];
  for (let i = 0; i < kids.length; i++) {
    const n = kids[i];
    if (n.nodeType === 1 && n.localName === localName) return n;
  }
  return null;
}

function directChildText(node, localName) {
  const el = firstChildByLocalName(node, localName);
  return el ? (el.textContent || "").trim() : "";
}

// Разворачивает относительный href в абсолютный относительно URL фида.
// Отдаём исходную строку, если распарсить не удалось — пусть лучше запись
// откроется криво, чем потеряется совсем.
function resolveUrl(href, baseUrl) {
  const s = (href || "").trim();
  if (!s) return "";
  try {
    return new URL(s, baseUrl || undefined).toString();
  } catch {
    return s;
  }
}

// Ищет первый descendant-элемент по localName (опционально с префиксом),
// возвращает текст. Игнорирует namespace URI — матчится по local name.
function findText(root, prefix, localName) {
  const node = findElement(root, prefix, localName);
  if (!node) return "";
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

// Atom: <link rel="alternate" href="..."> или первый <link href="..."> без rel.
function findAtomAlternateHref(entry) {
  const links = entry.getElementsByTagName("*");
  let fallback = "";
  for (let i = 0; i < links.length; i++) {
    const n = links[i];
    if (n.localName !== "link") continue;
    const rel = n.getAttribute("rel");
    const href = n.getAttribute("href");
    if (!href) continue;
    if (!rel || rel === "alternate") return href;
    if (!fallback) fallback = href;
  }
  return fallback;
}

function stripHtml(s) {
  if (!s) return "";
  // DOMParser уже развернул entities внутри CDATA/text. Но zakupki.gov.ru нередко
  // отдаёт description с двойным кодированием (&amp;nbsp;) — тогда после первого
  // прохода остаётся ещё один уровень. Больше двух проходов не делаем: иначе
  // литеральный текст вида "&amp;amp;" схлопывается в "&" и искажает содержимое.
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
    .replace(/&[a-z]+;|&#39;/gi, (m) => {
      const low = m.toLowerCase();
      return named[low] !== undefined ? named[low] : m;
    })
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
