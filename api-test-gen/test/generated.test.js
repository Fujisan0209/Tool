// 生成したテストを、モックサーバーに向けて本当に動かして確かめます。
// 仕様どおりのサーバーでは全部合格し、わざとまちがえたサーバーでは不合格になることを確認します。
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile, execFileSync } = require("node:child_process");
const { loadSpec } = require("../src/spec.js");
const { buildCases } = require("../src/cases.js");
const { emitJavaScript } = require("../src/emit/javascript.js");
const { emitPython } = require("../src/emit/python.js");
const { emitPostman } = require("../src/emit/postman.js");
const { runAll } = require("../src/runner.js");
const mock = require("./mock-server.js");

const model = buildCases(loadSpec(fs.readFileSync(path.join(__dirname, "..", "examples", "library.yaml"), "utf8")));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "api-test-gen-"));
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

function run(cmd, args, env) {
  return new Promise((resolve) => {
    const base = { ...process.env };
    delete base.NODE_TEST_CONTEXT; // 外側の node --test の設定を引きつがない
    execFile(cmd, args, { cwd: dir, env: { ...base, ...env }, timeout: 60000 }, (err, stdout, stderr) => {
      resolve({ code: err ? err.code : 0, out: stdout + stderr });
    });
  });
}

async function withServer(bugs, fn) {
  const { server, url } = await mock.start(0, bugs);
  try {
    return await fn(url);
  } finally {
    server.close();
  }
}

const count = (out, key) => Number((new RegExp(`^# ${key} (\\d+)`, "m").exec(out) || [])[1]);

test("JavaScript: 仕様どおりのサーバーで全部合格する", async () => {
  const o = emitJavaScript(model);
  fs.writeFileSync(path.join(dir, o.filename), o.code);
  const r = await withServer([], (url) => run(process.execPath, ["--test", o.filename], { BASE_URL: url, API_TOKEN: mock.TOKEN }));
  assert.equal(count(r.out, "pass"), model.cases.length, r.out.slice(-3000));
  assert.equal(r.code, 0);
});

test("JavaScript: 認証情報がないと、認証が必要なテストはスキップする", async () => {
  const o = emitJavaScript(model);
  fs.writeFileSync(path.join(dir, o.filename), o.code);
  const r = await withServer([], (url) => run(process.execPath, ["--test", o.filename], { BASE_URL: url, API_TOKEN: "" }));
  const needAuth = model.cases.filter((c) => c.request.auth).length;
  assert.equal(count(r.out, "skipped"), needAuth);
  assert.equal(count(r.out, "fail"), 0);
});

test("JavaScript: サーバーのまちがいを見つける", async () => {
  const o = emitJavaScript(model);
  fs.writeFileSync(path.join(dir, o.filename), o.code);
  const r = await withServer(["limit", "total", "auth"], (url) => run(process.execPath, ["--test", o.filename], { BASE_URL: url, API_TOKEN: mock.TOKEN }));
  assert.equal(r.code, 1);
  assert.match(r.out, /必須の項目 "total" がありません/);
  assert.match(r.out, /ステータスは 400 のはずが 200 でした/); // limit=0 や 101 が通ってしまう
  assert.match(r.out, /ステータスは 401 のはずが 201 でした/); // 認証なしで登録できてしまう
});

test("その場で実行（ブラウザと CLI が使う runner）", async () => {
  const ok = await withServer([], (url) => runAll(model, model.cases, { baseUrl: url, credentials: { bearerAuth: { token: mock.TOKEN } } }));
  assert.ok(ok.every((r) => r.pass), JSON.stringify(ok.filter((r) => !r.pass), null, 2));
  const bad = await withServer(["total"], (url) => runAll(model, model.cases, { baseUrl: url, credentials: {} }));
  assert.ok(bad.filter((r) => r.skipped).length > 0);
  assert.ok(bad.some((r) => !r.pass && !r.skipped && r.errors.some((e) => e.includes("total"))));
  const down = await runAll(model, model.cases.slice(0, 1), { baseUrl: "http://127.0.0.1:9", credentials: {} });
  assert.ok(down[0].network && /つながりませんでした/.test(down[0].errors[0]));
});

function hasPytest() {
  try {
    execFileSync("python3", ["-c", "import pytest, requests"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

test("Python: 仕様どおりのサーバーで全部合格し、まちがいも見つける", { skip: !hasPytest() && "pytest と requests がないのでスキップ" }, async () => {
  const o = emitPython(model);
  fs.writeFileSync(path.join(dir, o.filename), o.code);
  const args = ["-m", "pytest", "-q", "-p", "no:cacheprovider", o.filename];
  const good = await withServer([], (url) => run("python3", args, { BASE_URL: url, API_TOKEN: mock.TOKEN }));
  assert.match(good.out, new RegExp(`${model.cases.length} passed`), good.out.slice(-3000));
  const bad = await withServer(["total"], (url) => run("python3", args, { BASE_URL: url, API_TOKEN: mock.TOKEN }));
  assert.match(bad.out, /必須の項目 "total" がありません/);
});

test("Postman: コレクションの形と確認スクリプト", () => {
  const o = emitPostman(model);
  const col = JSON.parse(o.code);
  assert.equal(col.info.schema, "https://schema.getpostman.com/json/collection/v2.1.0/collection.json");
  const items = col.item.flatMap((g) => g.item);
  assert.equal(items.length, model.cases.length);
  assert.ok(col.variable.some((v) => v.key === "bookId" && v.value === "1"));
  assert.ok(col.variable.some((v) => v.key === "apiToken"));
  const getBook = items.find((i) => i.name.startsWith("T") && i.request.url === "{{baseUrl}}/books/{{bookId}}");
  assert.ok(getBook);
  // 確認スクリプトが JavaScript として正しく、Postman の pm を使って判定できる
  const script = col.event[0].script.exec.join("\n");
  const results = [];
  const fakePm = (name, code, body) => ({
    info: { requestName: name },
    response: { code, json: () => body },
    test: (title, fn) => {
      try {
        fn();
        results.push([title, true]);
      } catch (e) {
        results.push([title, false]);
      }
    },
    expect: (v) => ({
      to: {
        be: {
          get true() {
            if (v !== true) throw new Error("x");
            return 0;
          },
          get empty() {
            if (v.length) throw new Error("x");
            return 0;
          },
        },
      },
    }),
  });
  const first = model.cases[0];
  new Function("pm", script)(fakePm(`${first.id} [正常系] x`, 200, { items: [], total: 0 }));
  new Function("pm", script)(fakePm(`${first.id} [正常系] x`, 200, { items: [] }));
  new Function("pm", script)(fakePm(`${first.id} [正常系] x`, 500, {}));
  assert.deepEqual(results.map((r) => r[1]), [true, true, true, false, false]);
});
