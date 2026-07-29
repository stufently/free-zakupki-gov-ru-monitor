// Проверка scripts/cws-deploy.sh против локального мока Chrome Web Store API.
//
// Настоящий Store в тестах недоступен и не должен быть доступен: у него один
// боевой товар, и «проверить выкладку» означало бы выложить. При этом до первого
// релиза скрипт вообще ничем не проверяется, а ломается он тихо — сборка
// зелёная, версия в Store старая. Мок закрывает именно те ветки, которые легко
// сломать рефакторингом: асинхронная обработка пакета, отличие отказа от
// таймаута, коды ошибок и режимы upload-only / publish-only.
//
// Запуск: node cws-deploy.test.mjs

import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../scripts/cws-deploy.sh", import.meta.url));
const PUBLISHER = "pub123";
const ITEM = "abcdefghijklmnopabcdefghijklmnop";

// Файл «расширения» — содержимое неважно, скрипт только передаёт его в тело.
const ZIP = join(mkdtempSync(join(tmpdir(), "cws-test-")), "ext.zip");
writeFileSync(ZIP, "PKfake");

let pass = 0;
const fails = [];

function check(name, ok, detail = "") {
  if (ok) {
    pass++;
    console.log(`  OK  ${name}`);
  } else {
    fails.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  СБОЙ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// Поднимает мок и возвращает его адрес плюс журнал попаданий. `routes` — карта
// «endpoint -> ответ или массив ответов по номеру вызова».
function startMock(routes) {
  const hits = [];
  const counters = {};
  const server = createServer((req, res) => {
    // Тело обязательно вычитываем: иначе curl с -T ждёт, пока его заберут.
    req.resume();
    req.on("end", () => {
      const path = req.url;
      let key = "unknown";
      if (path.endsWith("/token")) key = "token";
      else if (path.endsWith(":upload")) key = "upload";
      else if (path.endsWith(":fetchStatus")) key = "fetchStatus";
      else if (path.endsWith(":publish")) key = "publish";
      hits.push(key);

      const route = routes[key];
      if (!route) {
        res.writeHead(500).end('{"error":"мок не знает такого endpoint"}');
        return;
      }
      const n = counters[key] = (counters[key] || 0) + 1;
      const answer = Array.isArray(route) ? route[Math.min(n - 1, route.length - 1)] : route;
      res.writeHead(answer.status ?? 200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(answer.body ?? {}));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ base: `http://127.0.0.1:${server.address().port}`, hits, server });
    });
  });
}

function run(base, env = {}) {
  return new Promise((resolve) => {
    const child = spawn("bash", [SCRIPT, ZIP], {
      env: {
        ...process.env,
        CWS_API_BASE: base,
        CWS_TOKEN_URL: `${base}/token`,
        CWS_POLL_SECONDS: "0",
        CWS_PUBLISHER_ID: PUBLISHER,
        CWS_ITEM_ID: ITEM,
        CWS_CLIENT_ID: "id",
        CWS_CLIENT_SECRET: "secret",
        CWS_REFRESH_TOKEN: "refresh",
        ...env,
      },
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => resolve({ code, out }));
  });
}

const OK_TOKEN = { body: { access_token: "ya29.test", expires_in: 3600 } };

async function scenario(name, routes, env, assert) {
  console.log(`\n${name}`);
  const mock = await startMock(routes);
  const res = await run(mock.base, env);
  mock.server.close();
  assert(res, mock.hits);
}

await scenario(
  "1. Обычный выпуск: пакет принят сразу, версия ушла на ревью",
  {
    token: OK_TOKEN,
    upload: { body: { uploadState: "SUCCEEDED", crxVersion: "0.2.1" } },
    publish: { body: { state: "PENDING_REVIEW" } },
  },
  {},
  ({ code, out }, hits) => {
    check("выходит с нулём", code === 0, `код ${code}`);
    check("сообщает о ревью", out.includes("Отправлено на ревью"));
    check("показывает версию из ответа", out.includes("0.2.1"));
    check("вызывает upload и publish", hits.includes("upload") && hits.includes("publish"));
  },
);

await scenario(
  "2. Асинхронная обработка: IN_PROGRESS, затем SUCCEEDED",
  {
    token: OK_TOKEN,
    upload: { body: { uploadState: "IN_PROGRESS" } },
    fetchStatus: [
      { body: { lastAsyncUploadState: "IN_PROGRESS" } },
      { body: { lastAsyncUploadState: "SUCCEEDED" } },
    ],
    publish: { body: { state: "PENDING_REVIEW" } },
  },
  {},
  ({ code, out }, hits) => {
    check("дожидается конца обработки", code === 0, `код ${code}`);
    check("опрашивает статус, пока идёт обработка", hits.filter((h) => h === "fetchStatus").length === 2);
    check("публикует только после SUCCEEDED", hits.indexOf("publish") > hits.lastIndexOf("fetchStatus"));
    check("не молчит про ожидание", out.includes("ещё обрабатывает"));
  },
);

await scenario(
  "3. Отказ после асинхронной обработки виден целиком",
  {
    token: OK_TOKEN,
    upload: { body: { uploadState: "IN_PROGRESS" } },
    fetchStatus: {
      body: { lastAsyncUploadState: "FAILED", itemError: [{ error_detail: "Version already exists" }] },
    },
  },
  {},
  ({ code, out }, hits) => {
    check("падает", code === 1, `код ${code}`);
    check("называет состояние", out.includes("FAILED"));
    // Раньше здесь печатался первый ответ загрузки, где всё «хорошо».
    check("показывает причину из fetchStatus", out.includes("Version already exists"));
    check("на ревью не отправляет", !hits.includes("publish"));
  },
);

await scenario(
  "4. HTTP-ошибка загрузки не выдаётся за отказ пакета",
  { token: OK_TOKEN, upload: { status: 400, body: { error: { message: "Bad package" } } } },
  {},
  ({ code, out }, hits) => {
    check("падает", code === 1, `код ${code}`);
    check("называет HTTP-код", out.includes("HTTP 400"));
    check("показывает ответ Store", out.includes("Bad package"));
    check("на ревью не отправляет", !hits.includes("publish"));
  },
);

await scenario(
  "5. 401 при опросе статуса — это не «пакет не принят»",
  {
    token: OK_TOKEN,
    upload: { body: { uploadState: "IN_PROGRESS" } },
    fetchStatus: { status: 401, body: { error: { message: "Invalid Credentials" } } },
  },
  {},
  ({ code, out }) => {
    check("падает", code === 1, `код ${code}`);
    check("называет HTTP-код", out.includes("HTTP 401"));
    check("не выдаёт за отказ пакета", !out.includes("пакет не принят"));
  },
);

await scenario(
  "6. Протухший refresh_token объясняется, а не просто ломается",
  { token: { status: 400, body: { error: "invalid_grant", error_description: "Token has been expired or revoked." } } },
  {},
  ({ code, out }, hits) => {
    check("падает", code === 1, `код ${code}`);
    check("подсказывает про статус Testing", out.includes("Testing"));
    check("до загрузки дело не доходит", !hits.includes("upload"));
  },
);

await scenario(
  "7. upload-only: черновик залит, на ревью не отправлен",
  { token: OK_TOKEN, upload: { body: { uploadState: "SUCCEEDED", crxVersion: "0.2.1" } } },
  { CWS_PUBLISH: "false" },
  ({ code }, hits) => {
    check("выходит с нулём", code === 0, `код ${code}`);
    check("загружает", hits.includes("upload"));
    check("не публикует", !hits.includes("publish"));
  },
);

await scenario(
  "8. publish-only: повторная публикация уже принятого пакета",
  { token: OK_TOKEN, publish: { body: { state: "PENDING_REVIEW" } } },
  { CWS_UPLOAD: "false" },
  ({ code, out }, hits) => {
    check("выходит с нулём", code === 0, `код ${code}`);
    check("не загружает повторно", !hits.includes("upload"));
    check("публикует", hits.includes("publish"));
    check("сообщает о ревью", out.includes("Отправлено на ревью"));
  },
);

await scenario(
  "9. Предупреждения Store не теряются",
  {
    token: OK_TOKEN,
    upload: { body: { uploadState: "SUCCEEDED" } },
    publish: { body: { state: "PENDING_REVIEW", warningInfo: { warnings: [{ detail: "Долгая проверка" }] } } },
  },
  {},
  ({ code, out }) => {
    check("выпуск не валится из-за предупреждения", code === 0, `код ${code}`);
    check("предупреждение видно в логе", out.includes("Долгая проверка"));
  },
);

console.log(`\nPassed: ${pass}`);
console.log(`Failed: ${fails.length}`);
if (fails.length > 0) {
  console.log("\nFailures:");
  for (const f of fails) console.log("  - " + f);
  process.exit(1);
}
