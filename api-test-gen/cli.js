#!/usr/bin/env node
// コマンドラインから使うとき: node cli.js <仕様書> [オプション]
// 使い方は --help で表示します。
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { loadSpec, SpecError } = require("./src/spec.js");
const { buildCases, CATEGORIES } = require("./src/cases.js");
const { emitJavaScript } = require("./src/emit/javascript.js");
const { emitPython } = require("./src/emit/python.js");
const { emitPostman } = require("./src/emit/postman.js");
const { runAll } = require("./src/runner.js");

const HELP = `API テスト自動生成

使い方:
  node cli.js <仕様書.yaml|json> [オプション]

オプション:
  -f, --format <種類>   js / py / postman / all（すでに all）。カンマで複数指定できます
  -o, --out <フォルダ>  書き出す先（すでに ./generated）
  --base-url <URL>      テストするサーバーの URL（すでに仕様書の servers の最初）
  --param 名前=値       パスに入れる値（例: --param bookId=42）。何回でも書けます
  --only <種類>         作るテストの種類をしぼる（例: --only positive,required）
  --skip <種類>         作らないテストの種類（例: --skip format,boundary）
  --loose               異常系は 4xx なら何でも合格にする
  --run                 ファイルを書き出さず、その場で実行して結果を表示する
                        認証情報は環境変数 API_TOKEN / API_KEY / API_USER / API_PASSWORD から読みます
  -h, --help            この説明を表示する

テストの種類: ${CATEGORIES.map((c) => `${c.id}（${c.label}）`).join(" ")}
`;

function parseArgs(argv) {
  const a = { formats: ["all"], out: "generated", params: {}, only: null, skip: [], loose: false, run: false, file: null };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) fail(`${v} のあとに値が必要です`);
      return argv[++i];
    };
    if (v === "-h" || v === "--help") a.help = true;
    else if (v === "-f" || v === "--format") a.formats = next().split(",");
    else if (v === "-o" || v === "--out") a.out = next();
    else if (v === "--base-url") a.baseUrl = next();
    else if (v === "--param") {
      const [k, ...rest] = next().split("=");
      a.params[k] = rest.join("=");
    } else if (v === "--only") a.only = next().split(",");
    else if (v === "--skip") a.skip = next().split(",");
    else if (v === "--loose") a.loose = true;
    else if (v === "--run") a.run = true;
    else if (v.startsWith("-")) fail(`知らないオプションです: ${v}`);
    else a.file = v;
  }
  return a;
}

function fail(msg) {
  console.error("エラー: " + msg);
  process.exit(2);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.file) {
    console.log(HELP);
    process.exit(args.help ? 0 : 2);
  }
  let text;
  try {
    text = fs.readFileSync(args.file, "utf8");
  } catch (e) {
    fail(`仕様書が読めませんでした: ${args.file}`);
  }
  let api;
  try {
    api = loadSpec(text);
  } catch (e) {
    if (e instanceof SpecError) fail(e.message);
    throw e;
  }
  const ids = CATEGORIES.map((c) => c.id);
  for (const c of [...(args.only || []), ...args.skip]) if (!ids.includes(c)) fail(`テストの種類 ${c} はありません（${ids.join(", ")}）`);
  const categories = Object.fromEntries(ids.map((id) => [id, (args.only ? args.only.includes(id) : true) && !args.skip.includes(id)]));
  const model = buildCases(api, { categories, negativeStatus: args.loose ? "any4xx" : "spec", params: coerce(args.params) });
  if (args.baseUrl) model.baseUrl = args.baseUrl;
  for (const w of api.warnings) console.warn("注意: " + w);
  console.log(`${model.title} ${model.apiVersion}: ${api.operations.length} 個のエンドポイントから ${model.cases.length} 件のテストを作りました`);

  if (args.run) return run(model);

  const all = args.formats.includes("all");
  const outputs = [];
  if (all || args.formats.includes("js")) outputs.push(emitJavaScript(model));
  if (all || args.formats.includes("py")) outputs.push(emitPython(model));
  if (all || args.formats.includes("postman")) outputs.push(emitPostman(model));
  if (!outputs.length) fail("--format は js / py / postman / all のどれかにしてください");
  fs.mkdirSync(args.out, { recursive: true });
  for (const o of outputs) {
    const p = path.join(args.out, o.filename);
    fs.writeFileSync(p, o.code);
    console.log("  書き出しました: " + p);
  }
}

// --param の値は、数字なら数値として扱う
function coerce(params) {
  const out = {};
  for (const [k, v] of Object.entries(params)) out[k] = /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v;
  return out;
}

async function run(model) {
  const env = process.env;
  const credentials = {};
  for (const [name, vars] of Object.entries(model.credentialEnv)) {
    credentials[name] = Object.fromEntries(Object.entries(vars).map(([k, e]) => [k, env[e]]));
  }
  const baseUrl = env.BASE_URL || model.baseUrl;
  console.log(`実行先: ${baseUrl}\n`);
  const color = process.stdout.isTTY;
  const paint = (code, s) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
  const results = await runAll(model, model.cases, { baseUrl, credentials }, (r, c) => {
    const mark = r.skipped ? paint(33, "SKIP") : r.pass ? paint(32, " OK ") : paint(31, "FAIL");
    console.log(`${mark} ${c.id} ${c.op.label}  ${c.title}${r.status ? `  [${r.status}, ${r.ms}ms]` : ""}`);
    if (!r.pass && !r.skipped) for (const e of r.errors) console.log("       " + e);
  });
  const pass = results.filter((r) => r.pass).length;
  const skip = results.filter((r) => r.skipped).length;
  const failCount = results.length - pass - skip;
  console.log(`\n合格 ${pass} / 不合格 ${failCount} / スキップ ${skip}`);
  process.exit(failCount ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
