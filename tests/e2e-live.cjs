// E2E-проверка против ЖИВОГО zakupki.gov.ru: расширение грузится в настоящий
// Chromium и проходит весь боевой путь — fetch из service worker, разбор в
// offscreen, запись seenIds/status, дедупликация на повторной проверке.
//
// Чем отличается от smoke-chrome.cjs: тот скармливает парсеру фикстуру, этот
// реально ходит в интернет. Именно здесь ловится то, что не видно ни юнит-тестам,
// ни смоуку — например отказ портала или смена формата ленты.
//
// В GitHub CI НЕ включён: zakupki.gov.ru доступен только из РФ, а его TLS-сертификат
// выпущен НУЦ Минцифры, которому Chromium не доверяет. Поэтому нужен российский
// прокси, а проверка сертификата в одноразовом контейнере отключается.
// На доверие сертификатам вне контейнера это не влияет.
//
// Запуск:
//   docker run --rm -v "$PWD":/w -v "$PWD/tests":/e2e -w /e2e \
//     -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
//     -e PROXY_SERVER=http://ПРОКСИ:ПОРТ -e PROXY_USER=... -e PROXY_PASS=... \
//     mcr.microsoft.com/playwright:v1.60.0-noble \
//     sh -c 'npm i --silent playwright-core@1.60.0 && xvfb-run -a node e2e-live.cjs'
//
// Ожидаемый результат: первый прогон записывает ~200 id и НЕ шлёт уведомлений,
// второй даёт totalNew=0. Последнее проверено 29.07.2026.

const { chromium } = require('playwright-core');

(async () => {
  const ext = process.env.EXT_DIR || '/w/extension';
  const ctx = await chromium.launchPersistentContext('/tmp/p-' + Date.now(), {
    headless: false,
    proxy: { server: process.env.PROXY_SERVER, username: process.env.PROXY_USER, password: process.env.PROXY_PASS },
    ignoreHTTPSErrors: true,
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--no-sandbox', '--ignore-certificate-errors'],
  });

  const page = await ctx.newPage();
  await page.goto('about:blank');
  for (let i = 0; i < 20 && ctx.serviceWorkers().length === 0; i++) await new Promise(r => setTimeout(r, 500));
  const sw = ctx.serviceWorkers()[0];
  if (!sw) { console.error('service worker не поднялся'); process.exit(1); }
  const extId = new URL(sw.url()).host;
  console.log('extension id:', extId);

  // Триггерим из страницы настроек — ровно так, как это делает кнопка «Проверить сейчас».
  await page.goto(`chrome-extension://${extId}/options.html`);
  const FEED = 'https://zakupki.gov.ru/epz/order/extendedsearch/rss.html?searchString=%D0%BE%D1%85%D1%80%D0%B0%D0%BD%D0%B0&morphology=on&pageNumber=1&fz44=on';

  const first = await page.evaluate(async (feedUrl) => {
    await chrome.storage.local.clear();
    await chrome.storage.local.set({ feeds: [{ id: 'f_live', title: 'Живая лента ЕИС', url: feedUrl, enabled: true }] });
    const res = await chrome.runtime.sendMessage({ type: 'checkNow' });
    const st = await chrome.storage.local.get(null);
    const key = Object.keys(st.status || {})[0];
    return { res, status: st.status?.[key], seenCount: (st.seenIds?.[key] || []).length,
             initialized: !!st.initialized?.[key], recentCount: (st.recent || []).length };
  }, FEED);
  console.log('\n=== ПЕРВЫЙ ПРОГОН (боевой путь: fetch -> offscreen -> storage) ===');
  console.log(JSON.stringify(first, null, 2).slice(0, 900));

  const second = await page.evaluate(async () => {
    const res = await chrome.runtime.sendMessage({ type: 'checkNow' });
    const st = await chrome.storage.local.get(null);
    const key = Object.keys(st.status || {})[0];
    return { totalNew: res.totalNew, errors: res.errors, seenCount: (st.seenIds?.[key] || []).length,
             lastError: st.status?.[key]?.lastError || null };
  });
  console.log('\n=== ВТОРОЙ ПРОГОН (дедупликация) ===');
  console.log(JSON.stringify(second, null, 2));

  await ctx.close();
  const ok = first.res?.ok && (first.res.errors || []).length === 0 && first.seenCount > 0
          && first.initialized && first.status && !first.status.lastError
          && second.totalNew === 0 && (second.errors || []).length === 0;
  console.log(ok ? '\nE2E: OK' : '\nE2E: FAILED');
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
