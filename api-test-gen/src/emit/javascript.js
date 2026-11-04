/*
 * Node.js 組みこみのテストランナー（node:test）と fetch を使うテストを書き出します。
 * 追加のインストールは不要です（Node.js 18 以上）。
 */
(function (root) {
  "use strict";
  const isNode = typeof module !== "undefined" && module.exports;
  const C = isNode ? require("./common.js") : root.ApiTestGen.emit.common;
  const RT = isNode ? require("../runtime.js") : root.ApiTestGen.runtime;

  function emitJavaScript(model) {
    const L = (v, level) => C.literal(v, "js", 2, level || 0);
    const file = C.fileBase(model.title) + ".test.js";
    const envNames = Object.values(model.credentialEnv).flatMap((e) => Object.values(e));
    const envExample = envNames.filter((n) => !/PASSWORD/.test(n)).map((n) => `${n}=xxxx `).join("");
    const out = [];
    out.push(`/**
 * ${model.title}${model.apiVersion ? " " + model.apiVersion : ""} のAPIテスト（${model.cases.length}件: ${C.counts(model.cases)}）
 * 「API テスト自動生成」で仕様書から作りました。
 *
 * 実行方法（Node.js 18 以上。追加のインストールは不要です）:
 *   BASE_URL=${model.baseUrl} ${envExample}node --test ${file}
 *
 * - PARAMS の値は、実在するデータのIDなどに書きかえてください。
 * - POST / PUT / PATCH / DELETE のテストはデータを変更します。本番ではなく、テスト用の環境で実行してください。
 * - 認証が必要なテストは、環境変数に認証情報がないとスキップされます。
 */
"use strict";
const { describe, test } = require("node:test");
const assert = require("node:assert/strict");

const BASE_URL = process.env.BASE_URL || ${JSON.stringify(model.baseUrl)};
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS || 15000);

// パスに入れる値（実在するIDなどに書きかえてください）
const PARAMS = ${L(model.params)};
`);
    const creds = {};
    for (const [name, env] of Object.entries(model.credentialEnv)) {
      creds[name] = Object.fromEntries(Object.entries(env).map(([k, v]) => [k, `@@process.env.${v}@@`]));
    }
    out.push(`// 認証情報（環境変数から読みます）
const CREDENTIALS = ${L(creds).replace(/"@@(.*?)@@"/g, "$1")};
const CREDENTIAL_ENV = ${L(C.envHint(model))};
const SCHEMES = ${L(model.schemes)};

// レスポンスの形（仕様書から取り出したもの）
const RESPONSES = ${L(model.responses)};
const SCHEMA_ROOT = ${L(model.schemaRoot)};

// ---------- ここから下は、テストを動かすための関数です ----------

async function send(req) {
  const { url, init } = buildRequest(req, BASE_URL, PARAMS, CREDENTIALS, SCHEMES);
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = text;
  }
  return { status: res.status, headers: res.headers, body, text, url, method: init.method };
}

function expectStatus(res, expected) {
  assert.ok(
    statusMatches(res.status, expected),
    \`ステータスは \${expected.join(" か ")} のはずが \${res.status} でした (\${res.method} \${res.url})\\n\${res.text.slice(0, 500)}\`
  );
}

function expectSchema(res, responses) {
  const schema = pickResponseSchema(res.status, responses);
  if (!schema) return;
  assert.ok(res.body !== undefined, "レスポンスのボディが空です");
  assert.ok(typeof res.body !== "string" || schema.type === "string", "レスポンスが JSON ではありません: " + res.text.slice(0, 200));
  const errors = validateSchema(schema, res.body, SCHEMA_ROOT);
  assert.ok(errors.length === 0, "レスポンスが仕様と違います:\\n  - " + errors.join("\\n  - "));
}

// 認証情報がないときはスキップする（理由の文字列を返す）
function missingCredentials(names) {
  const missing = names.filter((n) => {
    const c = CREDENTIALS[n] || {};
    return !(c.token || c.key || c.user);
  });
  return missing.length ? "環境変数 " + missing.map((n) => CREDENTIAL_ENV[n]).join(", ") + " がないのでスキップ" : false;
}

${RT.buildRequest.toString()}

${RT.validateSchema.toString()}

${RT.statusMatches.toString()}

${RT.pickResponseSchema.toString()}

// ---------- テスト ----------
`);
    for (const g of C.groupByOp(model.cases)) {
      out.push(`describe(${JSON.stringify(C.groupName(g.op))}, () => {`);
      for (const c of g.cases) {
        const req = C.requestFor(c);
        const opts = req.auth && req.auth.length ? `{ skip: missingCredentials(${L(req.auth)}) }, ` : "";
        out.push(`  test(${JSON.stringify(C.caseName(c))}, ${opts}async () => {`);
        out.push(`    const res = await send(${L(req, 2)});`);
        out.push(`    expectStatus(res, ${L(c.expect.status)});`);
        if (model.responses[c.op.key]) out.push(`    expectSchema(res, RESPONSES[${JSON.stringify(c.op.key)}]);`);
        out.push(`  });`);
      }
      out.push(`});\n`);
    }
    return { filename: file, language: "javascript", code: out.join("\n") };
  }

  if (isNode) module.exports = { emitJavaScript };
  else root.ApiTestGen.emit.javascript = emitJavaScript;
})(typeof globalThis !== "undefined" ? globalThis : this);
