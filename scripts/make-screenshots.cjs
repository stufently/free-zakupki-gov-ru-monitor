// Пересъёмка скриншотов для README и карточки Chrome Web Store.
// Грузит расширение в настоящий Chromium, наполняет его ЖИВЫМИ данными
// с zakupki.gov.ru и снимает три экрана в docs/screenshots/.
//
// Требует доступ к zakupki.gov.ru — портал открыт только из РФ, поэтому нужен
// российский прокси. Проверка TLS отключается ТОЛЬКО внутри одноразового
// контейнера: сертификат ЕИС выпущен НУЦ Минцифры, которому Chromium не доверяет.
//
// Запуск:
//   docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp \
//     -v "$PWD":/w -v "$PWD/scripts":/s -w /s \
//     -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
//     -e PROXY_SERVER=http://ПРОКСИ:ПОРТ -e PROXY_USER=... -e PROXY_PASS=... \
//     mcr.microsoft.com/playwright:v1.60.0-noble \
//     sh -c 'npm i --silent playwright-core@1.60.0 && xvfb-run -a node make-screenshots.cjs'
//
// Затем подрезать пустые поля снизу:
//   python3 -c "from PIL import Image,ImageChops; ..."  (см. docs/screenshots/)
//
// Тонкость: чтобы popup был не пустым, после инициализации лент сбрасывается
// ТОЛЬКО seenIds. Если сбросить ещё и initialized, прогон снова считается
// первым, а он по замыслу не уведомляет и не наполняет список.

const { chromium } = require('playwright-core');
(async () => {
  const ext = '/w/extension';
  const ctx = await chromium.launchPersistentContext('/tmp/s-' + Date.now(), {
    headless: false,
    proxy: { server: process.env.PROXY_SERVER, username: process.env.PROXY_USER, password: process.env.PROXY_PASS },
    ignoreHTTPSErrors: true, viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2,
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--no-sandbox', '--ignore-certificate-errors'],
  });
  const page = await ctx.newPage();
  await page.goto('about:blank');
  for (let i = 0; i < 20 && ctx.serviceWorkers().length === 0; i++) await new Promise(r => setTimeout(r, 500));
  const extId = new URL(ctx.serviceWorkers()[0].url()).host;

  const q = (s) => encodeURIComponent(s);
  const FEEDS = [
    { id: 'f1', title: 'Охрана объектов, 44-ФЗ', url: `https://zakupki.gov.ru/epz/order/extendedsearch/rss.html?searchString=${q('охрана')}&morphology=on&pageNumber=1&fz44=on`, enabled: true },
    { id: 'f2', title: 'Программное обеспечение', url: `https://zakupki.gov.ru/epz/order/extendedsearch/rss.html?searchString=${q('программное обеспечение')}&morphology=on&pageNumber=1&fz44=on`, enabled: true },
  ];

  await page.goto(`chrome-extension://${extId}/options.html`);
  const out = await page.evaluate(async (feeds) => {
    await chrome.storage.local.clear();
    await chrome.storage.local.set({ feeds, settings: { intervalMinutes: 10, maxRecent: 12, notifyMaxAtOnce: 1, seenLimit: 5000 } });
    await chrome.runtime.sendMessage({ type: 'checkNow' });          // инициализация
    await chrome.storage.local.set({ seenIds: {} });                  // initialized оставляем!
    const res = await chrome.runtime.sendMessage({ type: 'checkNow' });// теперь записи «новые»
    const st = await chrome.storage.local.get(null);
    return { totalNew: res.totalNew, errors: res.errors.length, recent: (st.recent || []).length };
  }, FEEDS);
  console.log('данные:', JSON.stringify(out));

  await page.goto(`chrome-extension://${extId}/options.html`);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: '/w/docs/screenshots/options.png' });

  const pop = await ctx.newPage();
  await pop.setViewportSize({ width: 360, height: 520 });
  await pop.goto(`chrome-extension://${extId}/popup.html`);
  await pop.waitForTimeout(1500);
  await pop.screenshot({ path: '/w/docs/screenshots/popup.png' });

  // Состояние сетевой ошибки — то, что увидит пользователь без сертификата Минцифры
  await page.evaluate(async (feeds) => {
    const key = feeds[0].url;
    await chrome.storage.local.set({ feeds: [feeds[0]], status: { [key]: {
      lastAttemptAt: new Date().toISOString(),
      lastError: { kind: 'network', message: 'Не удалось соединиться с сервером (сеть, DNS или TLS)', hint: 'cert', at: new Date().toISOString() } } } });
  }, FEEDS);
  await page.goto(`chrome-extension://${extId}/options.html`);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: '/w/docs/screenshots/options-cert-error.png' });
  await ctx.close();
  console.log('готово');
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
