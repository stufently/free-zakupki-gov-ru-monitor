# Карточка Chrome Web Store

Готовые тексты и ассеты для публикации. Копировать в поля формы как есть.

Все картинки, которые просит форма, лежат в одной папке
[`docs/screenshots/store/`](screenshots/store/):

| Файл | Что это | Чем пересобрать |
|---|---|---|
| `1-nastroyki.png`, `2-popup.png`, `3-diagnostika.png` | скриншоты 1280×800, сняты с работающего расширения на живых данных портала | `scripts/make-screenshots.cjs` |
| `store-icon-128.png` | иконка карточки: рисунок 96×96 в холсте 128×128 | `scripts/make-icons.cjs` |
| `promo-440x280.png` | small-плитка, без неё расширение не попадает в подборки | `scripts/make-promo-tile.cjs` |
| `promo-1400x560.png` | marquee-плитка для витринных мест | `scripts/make-promo-tile.cjs` |

Иконка карточки намеренно отличается от `extension/icons/icon128.png`: Google
просит для квадратной иконки рисунок 96×96 с прозрачными полями по 16 пикселей,
потому что в витрине иконки выравниваются по визуальному весу и full-bleed
квадрат выглядит крупнее соседних. Иконкам расширения эти поля не нужны — в
панели браузера отступы свои.

Загружать в Store нужно ZIP из [релиза](https://github.com/stufently/free-zakupki-gov-ru-monitor/releases),
а не архив репозитория: в нём `manifest.json` лежит в корне, как того требует
Store, и нет тестов с документацией. Сборка v0.2.1 проверена загрузкой в
Chromium — расширение из этого архива поднимается и работает.

---

## Название (максимум 75 символов)

```
Бесплатный мониторинг госзакупок (zakupki.gov.ru)
```

## Краткое описание (максимум 132 символа)

```
Уведомления о новых закупках с zakupki.gov.ru через RSS. Без регистрации, без подписки, без сторонних серверов.
```

*110 символов.*

## Категория

Productivity (Продуктивность). Язык — русский.

## Про название с доменом в скобках

В названии стоит `zakupki.gov.ru` — домен государственного портала. Правила
Store запрещают вводить пользователя в заблуждение об авторстве и
принадлежности, поэтому первой строкой описания идёт прямая оговорка, что
расширение неофициальное и с оператором портала не связано. Убирать домен из
названия не нужно — он описывает, с чем расширение работает, а не выдаёт его за
продукт портала; но оговорка должна остаться на видном месте, а не в конце.

---

## Подробное описание

```
Неофициальное расширение. Не связано с оператором ЕИС, Казначейством России и Минфином, ничьи товарные знаки не представляет. Работает с открытыми RSS-лентами портала.

Расширение следит за RSS-лентами zakupki.gov.ru и присылает уведомление, когда появляется новая закупка. Без регистрации, без платных тарифов и без передачи ваших поисковых фильтров куда-либо на сторону.

⚠️ ВАЖНО, ПРОЧИТАЙТЕ ДО УСТАНОВКИ

С 4 июля 2026 года zakupki.gov.ru работает на TLS-сертификате НУЦ Минцифры России. Chrome, Edge и Brave этому сертификату по умолчанию не доверяют. Если у вас не установлены российские корневые сертификаты, портал не откроется ни в браузере, ни для расширения — ленты просто не будут читаться.

Проверить просто: откройте zakupki.gov.ru в обычной вкладке. Если страница открывается без предупреждения о безопасности — всё в порядке. Если браузер ругается на сертификат, установите корневые сертификаты по официальной инструкции gosuslugi.ru/crt либо пользуйтесь Яндекс.Браузером или Атомом, где они уже встроены.

Это ограничение самого портала, а не расширения, и обойти его изнутри браузера невозможно. Расширение честно показывает такую ошибку вместо того, чтобы молча ничего не находить.

ЧТО УМЕЕТ

• Уведомления о новых закупках. Опрос лент с настраиваемым интервалом — от 1 минуты до недели, по умолчанию 10 минут. Клик по уведомлению открывает страницу закупки.
• Любые разделы портала. Работает с расширенным поиском, реестром контрактов, реестром жалоб ФАС, РНП и планами-графиками — везде, где сайт даёт кнопку RSS.
• Без дублей. Каждая запись запоминается, поэтому повторных уведомлений об одной закупке не будет даже после перезапуска браузера.
• Видно, что происходит. Под каждой лентой написано, когда она проверялась и сколько в ней записей. Если лента сломалась — расширение скажет об этом прямо, а не сделает вид, что новостей нет.
• Несколько лент независимо. Отдельно по регионам, отдельно по ОКПД, отдельно по конкретным заказчикам.

ПРИВАТНОСТЬ

Расширение не собирает сведений о вас и ничего не передаёт ни разработчику, ни рекламным и сторонним сервисам: запрос уходит только на сам портал закупок. Никакой аналитики, никаких сторонних серверов. Ссылки на ленты и найденные закупки хранятся локально, в chrome.storage.local, и стираются вместе с расширением. Сетевые запросы уходят только на zakupki.gov.ru и только по тем адресам, которые вы добавили сами: адрес проверяется в коде, cookie не отправляются. Полный текст — в политике конфиденциальности.

Исходный код открыт: github.com/stufently/free-zakupki-gov-ru-monitor (лицензия MIT).

КАК НАЧАТЬ

1. Откройте zakupki.gov.ru и настройте расширенный поиск под свою задачу.
2. Под результатами нажмите кнопку RSS и скопируйте адрес ссылки.
3. Вставьте её в настройки расширения и сохраните.

Первая проверка запоминает текущие записи и не шлёт уведомлений — это нормально. Оповещения начнут приходить со следующей проверки.

ОГРАНИЧЕНИЯ, О КОТОРЫХ ЛУЧШЕ ЗНАТЬ ЗАРАНЕЕ

• Расширение работает только при запущенном браузере. Это ограничение Manifest V3, а не недоработка: service worker живёт, пока живёт Chrome. Для мониторинга 24/7 нужен сервер.
• Для торгов в реальном времени лучше подойдёт платный сервис. Расширение решает задачу «видеть новые лоты по нескольким сохранённым поискам», а не «отреагировать за секунды».
• В RSS попадают не все поля закупки. Фильтры по типу обеспечения, динамике цены и группировке по ОКПД2 портал в ленту не отдаёт.
```

---

## Обоснование разрешений

Форма ревью требует объяснить каждое разрешение отдельно. Поля вкладки Privacy
видит только ревьюер Store, а не пользователь, поэтому текст в них английский —
как и в Test instructions. По-русски заполняется лишь то, что попадает в карточку.

**Single purpose description:**

```
The extension monitors RSS feeds of zakupki.gov.ru, the Russian public procurement portal, and notifies the user when a new procurement notice appears in a feed they added themselves. That is its only function: it has no accounts, no server, no analytics, and does nothing on any other website.
```

**Permission justification** — по одному полю на разрешение:

| Поле | Текст |
|---|---|
| `alarms justification` | `chrome.alarms` schedules the periodic feed check at the interval the user picks on the options page. Without a timer the extension cannot learn about new procurement notices while its popup is closed. Used for nothing else. |
| `notifications justification` | A desktop notification about a new procurement notice is the extension's main output; the popup list and the badge counter show the same findings inside the browser. A notification is created only for feed entries that were not seen before, and clicking it opens that entry's link — only if the link is `http`/`https`. |
| `storage justification` | `chrome.storage.local` holds the user's own list of feed URLs, the polling interval, the IDs of feed entries already processed (this is what prevents announcing the same procurement twice), the recent findings shown in the popup (title, link and publication date of each entry) and the last check result per feed for the diagnostics panel. Nothing from that storage is uploaded anywhere; the extension's only outbound request is fetching a feed the user added. |
| `offscreen justification` | A downloaded feed is XML and has to be parsed with `DOMParser`, which does not exist in a Manifest V3 service worker. The extension opens an offscreen document with reason `DOM_PARSER` only to parse that XML string. The offscreen document makes no network requests and renders nothing visible. |
| `Host permission justification` | The extension fetches RSS feeds from `zakupki.gov.ru`, the Russian public procurement portal — the only site it is meant to talk to. A URL the user adds is validated against that domain and rejected otherwise, and requests go out with `credentials: "omit"`. Redirects are followed so that the portal's own internal moves keep working, but the final URL is re-checked: if a portal response redirects outside the portal, the response is discarded without being read or parsed. No content scripts are injected — the host permission is used only for `fetch()` from the service worker. |

Предупреждение формы «Due to the Host Permission, your extension may require an
in-depth review» — ожидаемое и не ошибка: любое `host_permissions` включает
углублённую проверку. Именно поэтому Test instructions (ниже) заполнять
обязательно, хотя формально поле необязательное.

**Remote code** — отвечать «No, I am not using remote code». Весь код лежит в
пакете; из сети приходят только XML-данные ленты, которые парсятся как данные и
никогда не исполняются.

---

## Раскрытие данных (Data Usage)

⚠️ **«Ничего не собираем» здесь — неверный ответ, хотя данные никуда не уходят.**
Google требует раскрывать обработку данных **и при чисто локальном хранении**:
[User Data FAQ, вопрос 3](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)
— «Extensions are required to disclose how they handle user data, even when data
is processed or stored locally on a user's device». А «website content and
resources» прямо назван пользовательскими данными в вопросе 4. Расширение
сохраняет заголовки, ссылки и даты закупок из ленты, то есть содержимое страниц
портала — значит эту категорию надо отметить, иначе декларация расходится с кодом.

В форме «Privacy practices» отмечать так:

- **Содержимое сайтов (Website content) — да.** Пояснение: «Сохраняются заголовки, ссылки и даты записей из RSS-лент портала госзакупок, которые пользователь добавил сам. Хранятся локально в `chrome.storage.local`, наружу не передаются, нужны для показа списка найденного и чтобы не уведомлять дважды об одной закупке».
- Личная информация, данные о здоровье, финансовая информация, аутентификация, персональные сообщения, местоположение, история просмотров, действия пользователя — **не собирается**.
- Три обязательные декларации — подтвердить все:
  - данные не продаются и не передаются третьим сторонам;
  - данные не используются для целей, не связанных с основной функцией;
  - данные не используются для оценки кредитоспособности и не передаются кредитным организациям.

Наружу расширение действительно ничего не отправляет: единственный сетевой
запрос — `fetch` на адрес ленты, который пользователь добавил сам, с
`credentials: "omit"` и проверкой домена. Проверяется по исходникам в
`extension/background.js` и `extension/storage.js`.

**Политика конфиденциальности.** Форма требует URL — вставлять этот:

```
https://github.com/stufently/free-zakupki-gov-ru-monitor/blob/main/docs/privacy-policy.md
```

Текст лежит в [`docs/privacy-policy.md`](privacy-policy.md). Страница публичная и
постоянная, отдельный хостинг не нужен.

---

## Инструкция для ревьюера (Test instructions)

Поле необязательное по форме, но здесь оно решающее: ревьюер почти наверняка
находится вне России, портал ему не откроется, и без пояснения расширение
выглядит нерабочим. Текст на английском — его читает ревьюер, а не пользователь:

```
IMPORTANT — the target website is geo-restricted and uses a Russian government TLS certificate.

zakupki.gov.ru is the Russian public procurement portal. It is reachable only from Russian IP addresses, and since 2026-07-04 it serves a TLS certificate issued by the Russian Ministry of Digital Development CA, which Chrome does not trust by default. From outside Russia the extension will therefore show a network error for every feed — this is the portal's restriction, not a malfunction, and the extension reports it explicitly instead of failing silently.

What the extension does: the user pastes an RSS URL from the portal's own search page; the extension polls it on a schedule and shows a desktop notification for each new procurement notice. No account, no server, no analytics.

How to test the logic without portal access:
1. Open the options page and add any URL — a non-zakupki.gov.ru address is rejected with a visible message, because the extension only ever talks to that one domain.
2. Add a zakupki.gov.ru URL and press "Проверить сейчас" ("Check now"). Outside Russia this shows a network error under the feed, with a hint about the certificate.
3. All parsing happens in an offscreen document (DOM_PARSER) because Manifest V3 service workers have no DOMParser. The offscreen document makes no network requests.

Sample feed URL (works from a Russian IP):
https://zakupki.gov.ru/epz/order/extendedsearch/rss.html?searchString=охрана&morphology=on&pageNumber=1&fz44=on

Source code: https://github.com/stufently/free-zakupki-gov-ru-monitor
```

---

## Автоматическая выкладка новой версии (CI)

После bump'а `version` в манифесте workflow [`release.yml`](../.github/workflows/release.yml)
собирает ZIP, публикует GitHub Release и **сам заливает сборку в Store**, отправляя
её на ревью. Логика вынесена в [`scripts/cws-deploy.sh`](../scripts/cws-deploy.sh) —
её же можно запустить руками, если CI недоступен.

Пока секреты не заданы, шаг выкладки печатает `notice` и завершается успешно:
до появления аккаунта разработчика релизы не должны краснеть.

### Что важно знать заранее

- **Используется API v2** (`chromewebstore.googleapis.com/v2`). V1
  (`/chromewebstore/v1.1/`) объявлен устаревшим и работает **только до 15 октября
  2026 года** — на нём написано большинство готовых GitHub Actions для Store, и
  после этой даты они перестанут работать.
- **Сам товар заводится только руками.** API v2 умеет загрузить версию в уже
  существующий товар и опубликовать его, но создать товар и заполнить карточку с
  полями Privacy — нет. Один раз это делается в дашборде, дальше автоматика
  справляется сама, включая первую отправку на ревью.
- **Consent screen должен быть в статусе Production.** Если оставить `Testing`,
  `refresh_token` протухнет ровно через 7 дней, и выкладка начнёт падать с
  `invalid_grant`. Скрипт распознаёт этот случай и пишет причину прямо в лог.
- **Публикация идёт с текущими настройками видимости.** Если менять видимость в
  дашборде, API не сможет публиковать, пока хотя бы раз не опубликуете вручную.

### Секреты репозитория

`Settings → Secrets and variables → Actions → New repository secret`:

| Секрет | Где взять |
|---|---|
| `CWS_PUBLISHER_ID` | Дашборд Store, раздел **Publisher → Settings**. |
| `CWS_ITEM_ID` | ID расширения — в адресе карточки в дашборде, 32 буквы. |
| `CWS_CLIENT_ID` | Google Cloud Console → Credentials → OAuth client ID (тип **Web application**). |
| `CWS_CLIENT_SECRET` | Там же, рядом с client ID. |
| `CWS_REFRESH_TOKEN` | Через [OAuth Playground](https://developers.google.com/oauthplayground) — порядок ниже. |

### Как получить `CWS_REFRESH_TOKEN`

Шаги 1–3 уже выполнены 29.07.2026 — заново их делать не нужно. В Google Cloud
заведён проект `zakupki-monitor-store`: Chrome Web Store API включён, consent
screen типа External переведён **в Production**, создан OAuth-клиент
`zakupki-monitor CI release` (Web application) с redirect URI на OAuth Playground.

1. В [Google Cloud Console](https://console.cloud.google.com) создать проект и
   включить в нём **Chrome Web Store API**.
2. OAuth consent screen: тип **External**, заполнить обязательные поля и
   **опубликовать приложение (Production)** — иначе токен проживёт 7 дней.
3. Credentials → Create credentials → OAuth client ID → **Web application**,
   в Authorized redirect URIs добавить `https://developers.google.com/oauthplayground`.
4. Открыть [OAuth Playground](https://developers.google.com/oauthplayground),
   шестерёнка → «Use your own OAuth credentials», вставить client ID и secret.
5. В поле своих scope вписать `https://www.googleapis.com/auth/chromewebstore`,
   нажать «Authorize APIs» и войти **тем аккаунтом, которому принадлежит
   расширение** (он может отличаться от владельца проекта в Cloud Console).
6. «Exchange authorization code for tokens» → скопировать `refresh_token`.

### Ручной запуск

Вкладка Actions → Release → Run workflow, выпадающий список «Что сделать»:

| Режим | Когда нужен |
|---|---|
| `upload-and-publish` | По умолчанию. То же, что происходит само после bump'а версии. |
| `upload-only` | Залить черновик и посмотреть его в дашборде глазами до отправки на ревью. |
| `publish-only` | Пакет уже принят, а публикация упала. Повторная загрузка той же версии была бы отклонена как неувеличенная, поэтому повторяется только публикация. |

---

## Чек-лист перед отправкой на ревью

- [ ] Аккаунт разработчика Chrome Web Store (разовый взнос $5).
- [ ] Двухфакторная аутентификация на аккаунте разработчика — без неё публикация не откроется.
- [ ] Заполнить «Test instructions» для ревьюера (текст ниже) — иначе он увидит нерабочее расширение и отклонит.
- [x] Все картинки формы — в `docs/screenshots/store/`, таблица в начале документа. Иконка карточки, три скриншота, обе промо-плитки.
- [x] Ссылка на политику конфиденциальности — [`docs/privacy-policy.md`](privacy-policy.md).
- [ ] Проверить актуальность версии в `extension/manifest.json` — она же уйдёт в Store.
- [ ] Прогнать `tests/e2e-live.cjs` против живого портала (нужен доступ из РФ).

**Про ожидания.** Ревью для нового аккаунта разработчика может идти от нескольких
дней до пары недель. Набор разрешений минимальный, удалённого кода нет,
host_permissions ограничены одним доменом — по этим признакам придирок быть не должно.

**Про отзывы.** Главный риск не в ревью, а в оценках: пользователи без установленных
российских сертификатов увидят нечитающиеся ленты и поставят низкую оценку за
проблему, которую расширение не создаёт и не может починить. Поэтому предупреждение
про сертификат стоит первым абзацем описания, а не в конце.
