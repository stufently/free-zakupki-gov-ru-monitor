// Проверка интерфейса и побочных эффектов в НАСТОЯЩЕМ браузере: уведомления,
// badge, chrome.alarms, кнопки настроек и popup. Работает на живых данных ЕИС.
//
// Зачем отдельно от e2e-live.cjs: тот проверяет путь данных (fetch → offscreen →
// storage), а здесь то, что данными не проверяется — реально ли создаётся
// уведомление, краснеет ли badge на сломанной ленте, перепланируется ли alarm
// при смене интервала, и делают ли кнопки то, что написано на них.
//
// Требует доступ к zakupki.gov.ru (портал открыт только из РФ) — нужен российский
// прокси. Проверка TLS отключается ТОЛЬКО внутри одноразового контейнера:
// сертификат ЕИС выпущен НУЦ Минцифры, которому Chromium не доверяет.
//
// Запуск:
//   docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp \
//     -v "$PWD":/w -v "$PWD/tests":/t -w /t \
//     -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
//     -e PROXY_SERVER=http://ПРОКСИ:ПОРТ -e PROXY_USER=... -e PROXY_PASS=... \
//     mcr.microsoft.com/playwright:v1.60.0-noble \
//     sh -c 'npm i --silent playwright-core@1.60.0 && xvfb-run -a node ui-live.cjs'

const { chromium } = require('playwright-core');

const R = [];
const ok = (name, cond, detail = '') => R.push([!!cond, name, detail]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Между проверками, которые ходят в сеть, делаем паузу: серия быстрых запросов
// к порталу приводит к отказам, и тест начинает падать не по делу.
const POLITE_MS = 2500;

(async () => {
  const ext = process.env.EXT_DIR || '/w/extension';
  const ctx = await chromium.launchPersistentContext('/tmp/ui-' + Date.now(), {
    headless: false,
    proxy: { server: process.env.PROXY_SERVER, username: process.env.PROXY_USER, password: process.env.PROXY_PASS },
    ignoreHTTPSErrors: true,
    viewport: { width: 1280, height: 900 },
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--no-sandbox', '--ignore-certificate-errors'],
  });

  const page = await ctx.newPage();
  await page.goto('about:blank');
  for (let i = 0; i < 20 && ctx.serviceWorkers().length === 0; i++) await sleep(500);
  const sw = ctx.serviceWorkers()[0];
  if (!sw) { console.error('service worker не поднялся'); process.exit(1); }
  const extId = new URL(sw.url()).host;

  const FEED = 'https://zakupki.gov.ru/epz/order/extendedsearch/rss.html?searchString=%D0%BE%D1%85%D1%80%D0%B0%D0%BD%D0%B0&morphology=on&pageNumber=1&fz44=on';
  await page.goto(`chrome-extension://${extId}/options.html`);

  // ---------- ПЕРВЫЙ ЗАПУСК: запоминает, но не уведомляет ----------
  const first = await page.evaluate(async (url) => {
    await chrome.storage.local.clear();
    await chrome.storage.local.set({ feeds: [{ id: 'f1', title: 'Охрана, 44-ФЗ', url, enabled: true }] });
    const res = await chrome.runtime.sendMessage({ type: 'checkNow' });
    await new Promise((r) => setTimeout(r, 800));
    const st = await chrome.storage.local.get(null);
    return {
      errors: res.errors, status: st.status?.[url], seen: (st.seenIds?.[url] || []).length,
      initialized: !!st.initialized?.[url], recent: (st.recent || []).length,
      notifs: Object.keys(await chrome.notifications.getAll()).length,
    };
  }, FEED);

  // Если портал не ответил, дальше проверять нечего — отличаем это от логической ошибки.
  if (first.errors.length > 0 || !first.status || first.status.lastError) {
    console.error('Портал не ответил, тест не может продолжаться:', JSON.stringify(first.status || first.errors));
    await ctx.close();
    process.exit(2);
  }
  ok('первый запуск не шлёт уведомлений', first.notifs === 0 && first.recent === 0, JSON.stringify({ notifs: first.notifs, recent: first.recent }));
  ok('первый запуск запоминает записи', first.seen > 0 && first.initialized, `seen=${first.seen}, initialized=${first.initialized}`);
  ok('в статусе видно число записей', first.status.lastItemCount > 0, `lastItemCount=${first.status.lastItemCount}`);

  await sleep(POLITE_MS);

  // ---------- УВЕДОМЛЕНИЯ И BADGE ----------
  const run = await page.evaluate(async () => {
    await chrome.storage.local.set({ seenIds: {} }); // initialized НЕ трогаем: иначе прогон снова «первый»
    await chrome.storage.local.set({ settings: { intervalMinutes: 10, maxRecent: 20, notifyMaxAtOnce: 2, seenLimit: 5000 } });
    const res = await chrome.runtime.sendMessage({ type: 'checkNow' });
    await new Promise((r) => setTimeout(r, 900));
    return { totalNew: res.totalNew, errors: res.errors, notifs: Object.keys(await chrome.notifications.getAll()) };
  });
  ok('уведомления создаются', run.errors.length === 0 && run.notifs.length > 0, `${run.notifs.length} шт. при notifyMaxAtOnce=2`);
  ok('уведомлений не больше лимита плюс сводка', run.notifs.length <= 3, String(run.notifs.length));
  ok('id уведомления — ссылка на закупку, клик её и откроет',
     run.notifs.some((id) => /^https:\/\/zakupki\.gov\.ru\/.*regNumber=/.test(id)), run.notifs[0] || '');

  const badge = await sw.evaluate(() => chrome.action.getBadgeText({}));
  ok('badge показывает количество найденного', badge !== '' && badge !== '0', `text="${badge}"`);

  // ---------- РАСПИСАНИЕ ----------
  const alarms = await sw.evaluate(() => chrome.alarms.getAll());
  ok('alarm заведён ровно один', alarms.length === 1, JSON.stringify(alarms.map((a) => a.name)));
  ok('период alarm совпадает с настройкой', alarms[0]?.periodInMinutes === 10, String(alarms[0]?.periodInMinutes));

  // ---------- POPUP ----------
  const pop = await ctx.newPage();
  await pop.setViewportSize({ width: 360, height: 600 });
  await pop.goto(`chrome-extension://${extId}/popup.html`);
  await pop.waitForTimeout(800);
  ok('popup отрисовал найденные записи', (await pop.locator('#recent li').count()) > 0);
  ok('счётчик в подвале заполнен', /Лент: 1/.test((await pop.locator('#count').textContent()) || ''));

  await pop.locator('#clear').click();
  await pop.waitForTimeout(900);
  const cleared = await pop.evaluate(async () => ({
    recent: ((await chrome.storage.local.get('recent')).recent || []).length,
    empty: !!document.querySelector('#recent li.empty'),
  }));
  ok('«Очистить» опустошает список', cleared.recent === 0 && cleared.empty, JSON.stringify(cleared));
  ok('badge сбрасывается вместе со списком', (await sw.evaluate(() => chrome.action.getBadgeText({}))) === '');

  // ---------- НАСТРОЙКИ ----------
  await page.goto(`chrome-extension://${extId}/options.html`);
  await page.waitForTimeout(700);

  await page.locator('.preset[data-min="30"]').click();
  ok('пресет проставляет интервал', (await page.locator('#interval').inputValue()) === '30');

  const before = await page.locator('#feeds .feed-row').count();
  await page.locator('#add-feed').click();
  ok('«Добавить ленту» добавляет строку', (await page.locator('#feeds .feed-row').count()) === before + 1);

  await page.locator('#feeds .feed-row').last().locator('.title').fill('Вторая лента');
  await page.locator('#feeds .feed-row').last().locator('.url').fill('https://zakupki.gov.ru/epz/order/extendedsearch/rss.html?searchString=test');
  await page.locator('#save').click();
  await page.waitForTimeout(900);
  const saved = await page.evaluate(async () => {
    const st = await chrome.storage.local.get(['feeds', 'settings']);
    return { feeds: st.feeds.length, interval: st.settings.intervalMinutes };
  });
  ok('сохранение записало обе ленты', saved.feeds === 2, `лент: ${saved.feeds}`);
  ok('сохранение записало интервал', saved.interval === 30, String(saved.interval));
  ok('alarm перепланирован под новый интервал',
     (await sw.evaluate(() => chrome.alarms.getAll()))[0]?.periodInMinutes === 30);
  ok('под лентой виден статус проверки',
     /Проверена|записей/.test((await page.locator('#feeds .feed-row').first().locator('.feed-status').textContent()) || ''));

  await page.locator('#feeds .feed-row').last().locator('.remove').click();
  await page.locator('#save').click();
  await page.waitForTimeout(700);
  ok('«Удалить» и сохранение убирают ленту',
     (await page.evaluate(async () => (await chrome.storage.local.get('feeds')).feeds.length)) === 1);

  // ---------- СЛОМАННАЯ ЛЕНТА ----------
  const BAD = 'https://zakupki.gov.ru/nope-does-not-exist.rss';
  const broken = await page.evaluate(async (bad) => {
    await chrome.storage.local.clear();
    await chrome.storage.local.set({ feeds: [{ id: 'bad', title: 'Заведомо битая лента', url: bad, enabled: true }] });
    await chrome.runtime.sendMessage({ type: 'checkNow' });
    await new Promise((r) => setTimeout(r, 800));
    const st = await chrome.storage.local.get('status');
    return st.status?.[bad]?.lastError || null; // ключ берём по URL, а не «первый попавшийся»
  }, BAD);
  ok('ошибка ленты записана, а не проглочена', !!broken, JSON.stringify(broken));
  ok('ошибка классифицирована как HTTP', broken?.kind === 'http', `${broken?.kind}: ${broken?.message}`);
  ok('сломанная лента даёт красный badge «!»',
     (await sw.evaluate(() => chrome.action.getBadgeText({}))) === '!');

  const pop2 = await ctx.newPage();
  await pop2.setViewportSize({ width: 360, height: 600 });
  await pop2.goto(`chrome-extension://${extId}/popup.html`);
  await pop2.waitForTimeout(800);
  ok('popup показывает сломанную ленту отдельной строкой',
     (await pop2.locator('#recent li.problem').count()) === 1,
     ((await pop2.locator('#recent li.problem .meta').first().textContent()) || '').trim());

  await ctx.close();

  console.log('\n================ РЕЗУЛЬТАТЫ ================');
  let bad = 0;
  for (const [c, n, d] of R) { if (!c) bad++; console.log(`${c ? '  OK  ' : '  FAIL'}  ${n}${d ? `  [${d}]` : ''}`); }
  console.log(bad ? `\nПРОВАЛЕНО: ${bad} из ${R.length}` : `\nВСЁ ПРОШЛО: ${R.length}/${R.length}`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('FATAL:', e); process.exit(1); });
