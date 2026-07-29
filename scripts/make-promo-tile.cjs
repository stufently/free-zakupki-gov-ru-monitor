// Собирает промо-плитку 440×280 для Chrome Web Store из иконки расширения.
// Плитка необязательна, но без неё расширение не попадает в подборки Store.
//
// Рендерим HTML в Chromium, а не рисуем в графическом редакторе: так плитка
// пересобирается одной командой при смене названия или цветов иконки.
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
const OUT = join(ROOT, 'docs', 'screenshots', 'store', 'promo-440x280.png');

// Иконку встраиваем как data-URI: внешние файлы в headless-рендере грузятся
// непредсказуемо, а плитка должна получаться одинаковой при каждом прогоне.
const icon = readFileSync(join(ROOT, 'extension', 'icons', 'icon.svg'), 'utf8');
const iconUri = 'data:image/svg+xml;base64,' + Buffer.from(icon).toString('base64');

const html = `<!doctype html><meta charset="utf-8"><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 440px; height: 280px; display: flex; flex-direction: column;
    justify-content: center; gap: 14px; padding: 0 34px;
    background: linear-gradient(135deg, #1971c2 0%, #0c4a85 100%);
    font-family: "DejaVu Sans", sans-serif; color: #fff;
  }
  .row { display: flex; align-items: center; gap: 16px; }
  img { width: 64px; height: 64px; }
  h1 { font-size: 27px; line-height: 1.15; font-weight: 700; letter-spacing: -0.4px; }
  p { font-size: 15px; line-height: 1.4; color: #cfe3f7; }
  .host { font-size: 13px; color: #9dc4e8; letter-spacing: 0.3px; }
</style>
<div class="row">
  <img src="${iconUri}">
  <h1>Мониторинг<br>госзакупок</h1>
</div>
<p>Уведомления о новых закупках по вашим RSS-лентам — без регистрации и подписок</p>
<div class="host">zakupki.gov.ru · неофициальное расширение</div>`;

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 440, height: 280 }, deviceScaleFactor: 1 });
  await page.setContent(html);
  await page.waitForTimeout(300); // даём шрифтам примениться
  mkdirSync(join(ROOT, 'docs', 'screenshots', 'store'), { recursive: true });
  await page.screenshot({ path: OUT });
  await browser.close();
  console.log('промо-плитка сохранена:', OUT);
})().catch((e) => { console.error('FATAL:', e); process.exit(1); });
