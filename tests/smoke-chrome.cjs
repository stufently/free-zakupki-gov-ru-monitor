// Смоук-тест в НАСТОЯЩЕМ Chromium: грузит распакованное расширение и прогоняет
// боевой путь разбора ленты через offscreen-документ.
//
// Зачем отдельно от run.mjs: юнит-тесты подсовывают DOMParser из @xmldom/xmldom
// и поэтому были зелёными всю дорогу, пока расширение 0.1.0 не работало вообще.
// Здесь проверяется то, что полифил принципиально не покрывает:
//   - расширение вообще загружается, манифест валиден, __MSG_ ключи резолвятся;
//   - chrome.runtime.getContexts существует (в отличие от offscreen.hasDocument,
//     который появился только в Chrome 150 при заявленном минимуме 119);
//   - chrome.offscreen.createDocument с причиной DOM_PARSER отрабатывает;
//   - сообщение доходит до offscreen.js и возвращается с разобранным фидом;
//   - путь ошибки: HTML вместо RSS даёт понятное сообщение.
//
// Запуск:
//   docker run --rm -v "$PWD":/w -v "$PWD/tests":/smoke -w /smoke \
//     -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
//     mcr.microsoft.com/playwright:v1.60.0-noble \
//     sh -c 'npm i --silent playwright-core@1.60.0 && xvfb-run -a node smoke-chrome.cjs'
//
// Расширениям нужен headed-режим, поэтому xvfb обязателен.

const { chromium } = require('playwright-core');
const fs = require('fs');

(async () => {
  const ext = process.env.EXT_DIR || '/w/extension';
  const ctx = await chromium.launchPersistentContext('/tmp/prof-' + Date.now(), {
    headless: false,
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--no-sandbox'],
  });

  // Даём расширению установиться и разбудить service worker.
  const page = await ctx.newPage();
  await page.goto('about:blank');
  for (let i = 0; i < 20 && ctx.serviceWorkers().length === 0; i++) {
    await new Promise(r => setTimeout(r, 500));
  }
  const sws = ctx.serviceWorkers();
  console.log('service workers:', sws.map(s => s.url()));
  if (sws.length === 0) {
    // Смотрим, что вообще с расширением: страница ошибок chrome://extensions
    await page.goto('chrome://extensions/');
    const txt = await page.evaluate(() => document.body.innerText).catch(e => 'n/a: ' + e.message);
    console.log('chrome://extensions text:\n', txt.slice(0, 1500));
    await ctx.close();
    process.exit(1);
  }

  const sw = sws[0];
  const xml = fs.readFileSync(require('path').join(__dirname, 'fixtures', 'rss2-basic.xml'), 'utf8');

  const out = await sw.evaluate(async (xml) => {
    const r = { hasDocumentType: typeof chrome.offscreen.hasDocument,
                getContextsType: typeof chrome.runtime.getContexts,
                extName: chrome.runtime.getManifest().name };
    try {
      const before = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
      r.contextsBefore = before.length;
      if (before.length === 0) {
        await chrome.offscreen.createDocument({
          url: 'offscreen.html',
          reasons: [chrome.offscreen.Reason.DOM_PARSER],
          justification: 'smoke test',
        });
      }
      r.contextsAfter = (await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).length;
      r.resp = await chrome.runtime.sendMessage({
        target: 'offscreen', type: 'parseFeed', xml,
        baseUrl: 'https://zakupki.gov.ru/epz/order/extendedsearch/rss.html',
      });
      // Проверяем и путь ошибки: HTML вместо RSS
      r.htmlResp = await chrome.runtime.sendMessage({
        target: 'offscreen', type: 'parseFeed',
        xml: '<!DOCTYPE html><html><head><meta charset="utf-8"><br></head><body>oops</body></html>',
        baseUrl: 'https://zakupki.gov.ru/',
      });
    } catch (e) { r.error = String(e && e.message || e); }
    return r;
  }, xml);

  console.log(JSON.stringify(out, null, 2));
  await ctx.close();

  const ok = out.resp && out.resp.ok && out.resp.result.items.length === 2
    && out.htmlResp && out.htmlResp.ok === false && /HTML/i.test(out.htmlResp.error);
  console.log(ok ? '\nSMOKE: OK' : '\nSMOKE: FAILED');
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
