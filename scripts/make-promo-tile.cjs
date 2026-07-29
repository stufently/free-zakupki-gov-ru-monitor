// Собирает промо-плитки Chrome Web Store из иконки расширения.
//
// Store принимает две: small 440×280 (без неё расширение не попадает в подборки)
// и marquee 1400×560 (нужна для витринных мест). Обе рендерим одним скриптом с
// общим оформлением — иначе они разъезжаются по стилю при первой же правке.
//
// Рендерим HTML в Chromium, а не рисуем в редакторе: так плитки пересобираются
// одной командой при смене названия или цветов иконки.
//
// Запуск:
//   docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp \
//     -v "$PWD":/w -w /w -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
//     mcr.microsoft.com/playwright:v1.60.0-noble \
//     sh -c 'npm i --silent --no-save playwright-core@1.60.0 && node scripts/make-promo-tile.cjs'

const { chromium } = require('playwright-core');
const { readFileSync, mkdirSync } = require('fs');
const { join } = require('path');

const ROOT = join(__dirname, '..');
const OUT_DIR = join(ROOT, 'docs', 'screenshots', 'store');

// Иконку встраиваем как data-URI: внешние файлы в headless-рендере грузятся
// непредсказуемо, а плитка должна получаться одинаковой при каждом прогоне.
const icon = readFileSync(join(ROOT, 'extension', 'icons', 'icon.svg'), 'utf8');
const iconUri = 'data:image/svg+xml;base64,' + Buffer.from(icon).toString('base64');

// Размеры подписей заданы отдельно для каждой плитки, а не масштабированием
// одного макета: при трёхкратной разнице сторон пропорциональный текст на
// marquee выглядит неряшливо крупным.
const TILES = [
  {
    file: 'promo-440x280.png',
    width: 440, height: 280,
    pad: 34, gap: 14, iconSize: 64, rowGap: 16,
    title: 27, subtitle: 15, host: 13,
  },
  {
    file: 'promo-1400x560.png',
    width: 1400, height: 560,
    pad: 90, gap: 30, iconSize: 168, rowGap: 40,
    title: 76, subtitle: 34, host: 26,
  },
];

const html = (t) => `<!doctype html><meta charset="utf-8"><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: ${t.width}px; height: ${t.height}px; display: flex; flex-direction: column;
    justify-content: center; gap: ${t.gap}px; padding: 0 ${t.pad}px;
    background: linear-gradient(135deg, #1971c2 0%, #0c4a85 100%);
    font-family: "DejaVu Sans", sans-serif; color: #fff;
  }
  .row { display: flex; align-items: center; gap: ${t.rowGap}px; }
  img { width: ${t.iconSize}px; height: ${t.iconSize}px; }
  h1 { font-size: ${t.title}px; line-height: 1.15; font-weight: 700; letter-spacing: -0.4px; }
  p { font-size: ${t.subtitle}px; line-height: 1.4; color: #cfe3f7; }
  .host { font-size: ${t.host}px; color: #9dc4e8; letter-spacing: 0.3px; }
</style>
<div class="row">
  <img src="${iconUri}">
  <h1>Мониторинг<br>госзакупок</h1>
</div>
<p>Уведомления о новых закупках по вашим RSS-лентам — без регистрации и подписок</p>
<div class="host">zakupki.gov.ru · неофициальное расширение</div>`;

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  mkdirSync(OUT_DIR, { recursive: true });

  // finally, а не закрытие в конце: падение на любой из плиток иначе оставило бы
  // процесс Chromium висеть до конца сессии.
  try {
    for (const t of TILES) {
      const page = await browser.newPage({
        viewport: { width: t.width, height: t.height },
        deviceScaleFactor: 1,
      });
      await page.setContent(html(t));
      await page.waitForTimeout(300); // даём шрифтам примениться
      await page.screenshot({ path: join(OUT_DIR, t.file) });
      await page.close();
      console.log(`${t.file} — ${t.width}×${t.height}`);
    }
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error('FATAL:', e); process.exit(1); });
