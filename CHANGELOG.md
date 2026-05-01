# Changelog

## 0.1.0 — 2026-05-01

Первый публичный релиз.

- Chrome MV3 расширение для мониторинга RSS-лент zakupki.gov.ru
- Service worker с `chrome.alarms` для периодической проверки
- Настройки: список лент (CRUD), кастомный интервал в минутах (1 минута – 7 дней, по умолчанию 10 минут) + presets
- Уведомления через `chrome.notifications`, клик открывает страницу закупки
- Badge text с количеством непрочитанных записей
- Popup со списком последних найденных записей
- Локальное хранилище (`chrome.storage.local`), без внешних запросов кроме fetch RSS
- Парсер RSS 2.0 и Atom без зависимостей, namespace-aware (поддержка dc:date)
- inFlight guard на concurrent проверки + троттлинг 1.5 сек между фидами
- Дедупликация лент по canonical URL
- Явный флаг `initialized` для корректного first-run при пустых фидах
- GitHub Actions: автоматическая сборка ZIP и публикация в Releases по тегу `v*`
- Fixture-тесты на парсер (14 assertions)
