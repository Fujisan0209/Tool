// 実行: npm test  （node --test）
// fixtures/ の中身は、本物の javac / java (OpenJDK 21) が出したエラーです。
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { analyze } = require("../src/analyzer.js");
const { RULES } = require("../src/rules.js");

// fixture名 → 最初のエラーに期待するルールID（と、あれば2つ目以降）
const EXPECT = {
  semi: ["semicolon-expected"],
  sym: ["cannot-find-symbol"],
  scanner: ["cannot-find-symbol", "cannot-find-symbol"],
  strcase: ["cannot-find-symbol"],
  incompat: ["incompatible-types"],
  lossy: ["lossy-conversion"],
  fname: ["public-class-filename"],
  eof: ["reached-eof"],
  ret: ["missing-return"],
  init: ["not-initialized"],
  unreach: ["unreachable"],
  unclosed: ["unclosed-string"],
  static: ["static-context"],
  dup: ["already-defined"],
  unrep: ["unreported-exception"],
  apply: ["cannot-be-applied"],
  badop: ["bad-operand"],
  zen: ["fullwidth-space", "not-a-statement"],
  cls: ["class-expected"],
  rettype: ["return-type-required"],
  elseif: ["else-without-if"],
  deref: ["cannot-dereference"],
  notstmt: ["not-a-statement"],
  paren: ["token-expected"],
  ident: ["symbol-expected"],
  illstart: ["illegal-start"],
  arr: ["array-required"],
  charlit: ["char-literal"],
  multi: ["incompatible-types", "cannot-find-symbol"],
  npe: ["null-pointer"],
  aioobe: ["array-index"],
  sioobe: ["string-index"],
  list: ["list-index"],
  zero: ["divide-by-zero"],
  nfe: ["number-format"],
  ime: ["input-mismatch"],
  nse: ["no-such-element"],
  cce: ["class-cast"],
  so: ["stack-overflow"],
  cme: ["concurrent-modification"],
  fnf: ["file-not-found-runtime"],
  nofile: ["javac-file-not-found"],
  nomain: ["main-class-not-found"],
  nomethod: ["main-method-not-found"],
  cmd: ["command-not-found"],
};

const dir = path.join(__dirname, "fixtures");
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".txt"));

test("すべての fixture に期待値がある", () => {
  for (const f of files) assert.ok(EXPECT[f.split(".")[0]], `EXPECT に ${f} がありません`);
});

for (const f of files) {
  const name = f.split(".")[0];
  test(`${f} → ${EXPECT[name].join(", ")}`, () => {
    const text = fs.readFileSync(path.join(dir, f), "utf8");
    const { items, unknown } = analyze(text);
    assert.strictEqual(unknown, false);
    EXPECT[name].forEach((id, i) => assert.strictEqual(items[i] && items[i].id, id, `items[${i}]`));
    for (const it of items) {
      assert.ok(it.title && it.what, "タイトルと説明がある");
      assert.ok(!/undefined|NaN/.test(it.title + it.what), `undefined が混ざっていない: ${it.title} / ${it.what}`);
    }
  });
}

test("細かい情報を取り出せる", () => {
  const read = (f) => fs.readFileSync(path.join(dir, f), "utf8");

  const sym = analyze(read("sym.ja.txt")).items[0];
  assert.match(sym.title, /変数「cont」/);
  assert.deepStrictEqual(sym.location, { file: "Main.java", line: 1 });
  assert.ok(sym.snippet.code.includes("println(cont)"));

  const sc = analyze(read("scanner.en.txt")).items[0];
  assert.ok(sc.fixes.some((x) => x.includes("import java.util.Scanner;")));

  const str = analyze(read("strcase.en.txt")).items[0];
  assert.ok(str.fixes[0].includes("`String`"));

  const inc = analyze(read("incompat.ja.txt")).items[0];
  assert.match(inc.title, /String 型は int 型/);
  assert.ok(inc.fixes.some((x) => x.includes("Integer.parseInt")));

  const lossy = analyze(read("lossy.ja.txt")).items[0];
  assert.match(lossy.title, /double を int/);

  const a = analyze(read("aioobe.run.txt")).items[0];
  assert.match(a.what, /長さは 3/);
  assert.deepStrictEqual(a.location, { method: "Main.main", file: "Main.java", line: 1 });

  const nse = analyze(read("nse.run.txt")).items[0];
  assert.strictEqual(nse.location.method, "Main.main", "java.base の行は飛ばして自分のコードを指す");

  const nfe = analyze(read("nfe.run.txt")).items[0];
  assert.match(nfe.title, /「abc」/);

  const paren = analyze(read("paren.ja.txt")).items[0];
  assert.match(paren.title, /閉じかっこ/);
});

test("わからないエラーは unknown になる", () => {
  const r = analyze("Main.java:3: error: something very unusual happened");
  assert.strictEqual(r.unknown, true);
  assert.strictEqual(r.items[0].id, "unknown");
  assert.strictEqual(analyze("").items.length, 0);
});

test("ルールIDは重複しない", () => {
  const ids = RULES.map((r) => r.id);
  assert.strictEqual(new Set(ids).size, ids.length);
});
