// 実行: npm test
// test/live/ok … 正しいプログラム。エラーも注意も出ないこと。
// test/live/ng … まちがいのあるプログラム。行末の「// <<error:ID」「// <<warn:ID」の行に、そのIDの指摘が出ること。
//                ほかの行には何も出ないこと（エラーの連鎖・誤検出がないこと）。
// javac があれば、本物の javac とも答え合わせをします（ok はコンパイルが通る / ng は同じ行でエラー）。
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { check } = require("../src/checker.js");

const root = path.join(__dirname, "live");
const list = (sub) =>
  fs.readdirSync(path.join(root, sub)).filter((f) => f.endsWith(".java")).sort().map((f) => path.join(root, sub, f));

function fileNameOf(src) {
  const m = src.match(/\/\/\s*file:\s*(\S+\.java)/);
  return m ? m[1] : "Main.java";
}

/** 行末の印を読む */
function marks(src) {
  const out = { error: new Set(), warn: new Set(), javacLine: null };
  src.split("\n").forEach((line, i) => {
    for (const m of line.matchAll(/<<(error|warn):([\w-]+)/g)) out[m[1]].add(`${m[2]}@${i + 1}`);
    if (line.includes("<<javac")) out.javacLine = i + 1;
  });
  return out;
}

function got(src) {
  const r = check(src, { fileName: fileNameOf(src), debug: true });
  const error = new Set();
  const warn = new Set();
  for (const d of r.diags) (d.sev === "error" ? error : warn).add(`${d.id}@${d.line}`);
  return { error, warn, diags: r.diags };
}

const show = (s) => [...s].sort().join(", ") || "(なし)";

for (const f of list("ok")) {
  test(`ok/${path.basename(f)} は何も指摘されない`, () => {
    const src = fs.readFileSync(f, "utf8");
    const g = got(src);
    assert.deepStrictEqual(
      g.diags.map((d) => `${d.sev} ${d.id}@${d.line}: ${d.msg}`),
      [],
      "正しいコードなのに指摘が出た"
    );
  });
}

for (const f of list("ng")) {
  test(`ng/${path.basename(f)}`, () => {
    const src = fs.readFileSync(f, "utf8");
    const want = marks(src);
    const g = got(src);
    assert.strictEqual(show(g.error), show(want.error), "エラー");
    assert.strictEqual(show(g.warn), show(want.warn), "注意");
    for (const d of g.diags) {
      assert.ok(d.msg && d.fix, `msg と fix がある: ${d.id}`);
      assert.ok(!/undefined|null|NaN|\[object/.test(d.msg + d.fix), `変な文字が混ざっていない: ${d.msg} / ${d.fix}`);
    }
  });
}

test("quick fix を当てると、その指摘が消える", () => {
  for (const f of list("ng")) {
    const src = fs.readFileSync(f, "utf8");
    const g = got(src);
    const d = g.diags.find((x) => x.edits && x.sev === "error");
    if (!d) continue;
    let fixed = src;
    for (const e of [...d.edits].sort((a, b) => b.s - a.s)) fixed = fixed.slice(0, e.s) + e.text + fixed.slice(e.e);
    const after = check(fixed, { fileName: fileNameOf(src) });
    const same = after.diags.find((x) => x.id === d.id && x.s === d.s && x.sev === "error");
    assert.ok(!same, `${path.basename(f)}: 直したのに ${d.id}@${d.line} が残る\n${fixed}`);
  }
});

test("書きかけのコードでも止まらない（1文字ずつ入力）", () => {
  const src = fs.readFileSync(path.join(root, "ok", "classes.java"), "utf8");
  for (let i = 0; i <= src.length; i += 7) check(src.slice(0, i));
  for (let i = 0; i < src.length; i += 13) check(src.slice(0, i) + src.slice(i + 5));
});

let javac = null;
try {
  const out = execFileSync("java", [path.join(__dirname, "JavacCheck.java"), root], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 120000 });
  javac = JSON.parse(out);
} catch (e) {
  javac = null;
}

test("本物の javac と答え合わせ", { skip: javac ? false : "javac が見つからないのでスキップ" }, () => {
  for (const r of javac) {
    const name = path.relative(root, r.file);
    const src = fs.readFileSync(r.file, "utf8");
    const want = marks(src);
    if (name.startsWith("ok")) {
      assert.ok(r.ok, `${name} は javac でコンパイルできるはず: ${JSON.stringify(r.errors)}`);
      continue;
    }
    if (!want.error.size) {
      assert.ok(r.ok, `${name} は「注意」だけなので javac は通るはず: ${JSON.stringify(r.errors)}`);
      continue;
    }
    assert.ok(!r.ok, `${name} は javac でもエラーになるはず`);
    const firstWant = want.javacLine || Math.min(...[...want.error].map((x) => Number(x.split("@")[1])));
    assert.strictEqual(r.errors[0].line, firstWant, `${name}: javac の最初のエラー行`);
  }
});
