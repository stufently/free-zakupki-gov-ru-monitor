// Собирает PNG-иконки расширения из icons/icon.svg.
//
// Появился после находки: лежавшие в репозитории PNG были чёрно-белые
// (16-bit greyscale) и не имели ничего общего с синим icon.svg — их когда-то
// положили руками и больше не трогали. Иконка 128×128 идёт главной картинкой
// карточки в Chrome Web Store, то есть расхождение было видно всем.
//
// Рендерим в Chromium, а не конвертируем утилитой: SVG содержит градиент и
// текст, и именно браузерный рендер совпадает с тем, что увидит пользователь.
//
// Запуск:
//   docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp \
//     -v "$PWD":/w -w /w -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
//     mcr.microsoft.com/playwright:v1.60.0-noble \
//     sh -c 'npm i --silent --no-save playwright-core@1.60.0 && node scripts/make-icons.cjs'

const { chromium } = require('playwright-core');
const { readFileSync, writeFileSync, mkdirSync } = require('fs');
const { join } = require('path');

const ROOT = join(__dirname, '..');
const ICONS = join(ROOT, 'extension', 'icons');
const STORE = join(ROOT, 'docs', 'screenshots', 'store');

// 16/32/48/128 — набор, который рекомендует Chrome: 16 для favicon страниц
// расширения, 32 для Windows, 48 для страницы управления, 128 для установки и
// витрины Store.
const SIZES = [16, 32, 48, 128];

const svg = readFileSync(join(ICONS, 'icon.svg'), 'utf8');

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  // finally, а не закрытие в конце: падение на любом из размеров иначе оставило
  // бы процесс Chromium висеть до конца сессии.
  try {
    const page = await browser.newPage({ deviceScaleFactor: 1 });

    for (const size of SIZES) {
      await page.setViewportSize({ width: size, height: size });
      await page.setContent(
        `<style>*{margin:0;padding:0}html,body{background:transparent}
         svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
      );
      // omitBackground — у иконки скруглённые углы, и они должны остаться
      // прозрачными, иначе на тёмной теме появится белая рамка.
      const buf = await page.screenshot({ omitBackground: true });
      writeFileSync(join(ICONS, `icon${size}.png`), buf);
      console.log(`icon${size}.png — ${buf.length} байт`);
    }

    // Иконка карточки Store — отдельный файл, а не копия icon128.png.
    // Google просит для квадратной иконки рисунок 96×96 внутри 128×128, то есть
    // 75% ширины с прозрачными полями: в витрине иконки выравниваются по
    // визуальному весу, и full-bleed квадрат выглядит крупнее соседей.
    // Иконкам расширения эти поля не нужны — в панели браузера отступы свои.
    await page.setViewportSize({ width: 128, height: 128 });
    await page.setContent(
      `<style>*{margin:0;padding:0}html,body{background:transparent}
       body{display:flex;align-items:center;justify-content:center;width:128px;height:128px}
       svg{display:block;width:96px;height:96px}</style>${svg}`,
    );
    const store = await page.screenshot({ omitBackground: true });
    mkdirSync(STORE, { recursive: true });
    writeFileSync(join(STORE, 'store-icon-128.png'), store);
    console.log(`store-icon-128.png — рисунок 96×96 в холсте 128×128`);
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error('FATAL:', e); process.exit(1); });
