#!/usr/bin/env bash
#
# Загружает ZIP расширения в Chrome Web Store и отправляет версию на ревью.
#
# Отдельный скрипт, а не десять строк внутри workflow: то же самое нужно уметь
# запустить руками, когда CI недоступен или надо разобраться, почему выпуск не
# доехал. В workflow остаётся только вызов.
#
# Используется Chrome Web Store API **v2**. V1 (`/chromewebstore/v1.1/`)
# объявлен устаревшим и поддерживается только до 15 октября 2026 года — на нём
# написано большинство готовых GitHub Actions, и они перестанут работать.
#
# Запуск:
#   CWS_PUBLISHER_ID=... CWS_ITEM_ID=... CWS_CLIENT_ID=... \
#   CWS_CLIENT_SECRET=... CWS_REFRESH_TOKEN=... \
#     scripts/cws-deploy.sh dist/free-zakupki-gov-ru-monitor-0.2.1.zip
#
# CWS_UPLOAD=false  — не загружать, только опубликовать уже залитый пакет.
# CWS_PUBLISH=false — только загрузить черновик, не отправлять на ревью.
#
# CWS_API_BASE и CWS_TOKEN_URL переопределяются в тестах (tests/cws-deploy.test.mjs),
# чтобы гонять скрипт против локального мока, а не против настоящего Store.

set -euo pipefail

# Никакого `set -x`: в окружении лежат client_secret и refresh_token, и трассировка
# команд выложила бы их в публичный лог сборки.

ZIP="${1:-}"
API="${CWS_API_BASE:-https://chromewebstore.googleapis.com}"
TOKEN_URL="${CWS_TOKEN_URL:-https://oauth2.googleapis.com/token}"
DO_UPLOAD="${CWS_UPLOAD:-true}"
DO_PUBLISH="${CWS_PUBLISH:-true}"
# Пауза между опросами статуса. Вынесена в переменную только ради тестов: гонять
# мок с настоящими десятисекундными паузами никто не станет.
POLL="${CWS_POLL_SECONDS:-10}"

# Зависшее соединение не должно держать job до общего таймаута GitHub: сборка
# выглядела бы «идущей» часами. Пакет расширения — десятки килобайт, ста
# восьмидесяти секунд хватает с большим запасом.
CURL=(curl -sS --connect-timeout 15 --max-time 180)

die() { echo "::error::$*" >&2; exit 1; }

# Показать ответ Store целиком: по одному угаданному полю причину отказа не
# соберёшь, а лог читает человек.
dump() { jq . "$1" >&2 2>/dev/null || cat "$1" >&2; }

[ "$DO_UPLOAD" = "true" ] || [ "$DO_PUBLISH" = "true" ] \
  || die "CWS_UPLOAD и CWS_PUBLISH оба false — делать нечего"

if [ "$DO_UPLOAD" = "true" ]; then
  [ -n "$ZIP" ] || die "не передан путь к ZIP: scripts/cws-deploy.sh <файл.zip>"
  [ -f "$ZIP" ] || die "файл не найден: $ZIP"
fi

for v in CWS_PUBLISHER_ID CWS_ITEM_ID CWS_CLIENT_ID CWS_CLIENT_SECRET CWS_REFRESH_TOKEN; do
  [ -n "${!v:-}" ] || die "не задана переменная $v (в CI — секрет репозитория)"
done

ITEM="publishers/${CWS_PUBLISHER_ID}/items/${CWS_ITEM_ID}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# ---------------------------------------------------------------- access token

# Долгоживущий refresh_token меняем на короткий access_token. Тело успешного
# ответа не печатаем ни при каких условиях — в нём сам токен.
# --data-urlencode, а не -d: значения приходят из секретов, и одиночный `&`
# внутри токена молча обрезал бы форму на следующем поле.
"${CURL[@]}" -X POST "$TOKEN_URL" \
  --data-urlencode "client_id=${CWS_CLIENT_ID}" \
  --data-urlencode "client_secret=${CWS_CLIENT_SECRET}" \
  --data-urlencode "refresh_token=${CWS_REFRESH_TOKEN}" \
  --data-urlencode "grant_type=refresh_token" \
  -o "$TMP/token.json" || die "запрос токена не ушёл (сеть/DNS/таймаут)"

TOKEN="$(jq -r '.access_token // empty' "$TMP/token.json")"
if [ -z "$TOKEN" ]; then
  ERR="$(jq -r '[.error, .error_description] | map(select(. != null)) | join(": ")' "$TMP/token.json")"
  ERR="${ERR:-неизвестная ошибка}"
  # invalid_grant почти всегда означает не «сломанный секрет», а протухший
  # refresh_token: у OAuth-клиента с consent screen в статусе Testing он живёт
  # ровно 7 дней. Лечится переводом приложения в Production, а не перевыпуском.
  if [ "$(jq -r '.error // empty' "$TMP/token.json")" = "invalid_grant" ]; then
    die "refresh_token недействителен ($ERR). Частая причина: OAuth consent screen остался в статусе Testing — там refresh_token живёт 7 дней. Переведите приложение в Production и получите токен заново."
  fi
  die "не удалось получить access_token: $ERR"
fi

AUTH=(-H "Authorization: Bearer $TOKEN")

# -------------------------------------------------------------------- загрузка

if [ "$DO_UPLOAD" = "true" ]; then
  echo "Загружаем $(basename "$ZIP") в item ${CWS_ITEM_ID}"

  # -T заставляет curl слать тело файлом, -X POST перекрывает подразумеваемый им
  # PUT — так этот вызов описан в документации Store.
  CODE="$("${CURL[@]}" -X POST -T "$ZIP" "${AUTH[@]}" \
    -o "$TMP/upload.json" -w '%{http_code}' \
    "${API}/upload/v2/${ITEM}:upload")" || die "запрос загрузки не ушёл (сеть/DNS/таймаут)"

  if [ "$CODE" != "200" ]; then
    dump "$TMP/upload.json"
    die "загрузка не удалась, HTTP $CODE"
  fi

  STATE="$(jq -r '.uploadState // empty' "$TMP/upload.json")"

  # Store обрабатывает пакет асинхронно: сразу приходит IN_PROGRESS, и публиковать
  # в этот момент нечего. Дожидаемся конца обработки, иначе выпуск «прошёл» бы в
  # логе, а в Store не доехал.
  #
  # Откуда взято последнее известное состояние — нужно для диагностики: отказ
  # после асинхронной обработки приезжает в fetchStatus, и печатать в этом случае
  # первый ответ загрузки значит показать устаревшее «всё хорошо».
  LAST="$TMP/upload.json"
  TRIES=0
  while [ "$STATE" = "IN_PROGRESS" ] && [ "$TRIES" -lt 30 ]; do
    TRIES=$((TRIES + 1))
    echo "Store ещё обрабатывает пакет (попытка $TRIES/30), ждём ${POLL} с"
    sleep "$POLL"
    CODE="$("${CURL[@]}" "${AUTH[@]}" -o "$TMP/status.json" -w '%{http_code}' \
      "${API}/v2/${ITEM}:fetchStatus")" || die "запрос статуса не ушёл (сеть/DNS/таймаут)"
    # Без проверки кода 401 или 429 превратился бы в пустой uploadState, то есть
    # в «пакет не принят» — диагноз, уводящий чинить совсем не то.
    if [ "$CODE" != "200" ]; then
      dump "$TMP/status.json"
      die "не удалось запросить статус загрузки, HTTP $CODE"
    fi
    LAST="$TMP/status.json"
    STATE="$(jq -r '.lastAsyncUploadState // empty' "$LAST")"
  done

  # Исчерпанные попытки — это не отказ, а «мы не дождались». Разница важна: в
  # первом случае надо чинить пакет, во втором — просто проверить дашборд.
  [ "$STATE" = "IN_PROGRESS" ] && die "Store не закончил обработку за 5 минут. Пакет, скорее всего, дойдёт сам — проверьте дашборд, прежде чем перезапускать выкладку."

  if [ "$STATE" != "SUCCEEDED" ]; then
    dump "$LAST"
    die "пакет не принят, uploadState=${STATE:-пусто}"
  fi

  echo "Пакет принят, crxVersion=$(jq -r '.crxVersion // "?"' "$TMP/upload.json")"
else
  echo "CWS_UPLOAD=$DO_UPLOAD — загрузку пропускаем, публикуем уже залитый пакет."
fi

if [ "$DO_PUBLISH" != "true" ]; then
  echo "CWS_PUBLISH=$DO_PUBLISH — черновик загружен, на ревью не отправляем."
  exit 0
fi

# ------------------------------------------------------------------ публикация

CODE="$("${CURL[@]}" -X POST "${AUTH[@]}" \
  -H "Content-Type: application/json" \
  -d '{}' \
  -o "$TMP/publish.json" -w '%{http_code}' \
  "${API}/v2/${ITEM}:publish")" || die "запрос публикации не ушёл (сеть/DNS/таймаут)"

if [ "$CODE" != "200" ]; then
  dump "$TMP/publish.json"
  die "публикация не удалась, HTTP $CODE"
fi

echo "Отправлено на ревью, state=$(jq -r '.state // "?"' "$TMP/publish.json")"

# Предупреждения не валят выпуск, но и молчать о них нельзя: там приезжает,
# например, сообщение о том, что версия уйдёт в долгую проверку. Печатаем объект
# целиком, а не отдельное поле: схема Warning в документации не раскрыта, и
# выборка по угаданному имени поля тихо показывала бы пустоту.
WARN="$(jq -c '.warningInfo // empty' "$TMP/publish.json")"
[ -n "$WARN" ] && echo "::warning::Chrome Web Store: $WARN"

exit 0
