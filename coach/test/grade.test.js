const test = require("node:test");
const assert = require("node:assert");
const g = require("../src/grade.js");

test("正規化: 全角・空白・大文字小文字", () => {
  assert.strictEqual(g.normalize(" ａ ｂ　c "), "abc");
  assert.strictEqual(g.normalize("System.out.println( x );"), "System.out.println(x);");
  assert.strictEqual(g.normalize("ABC", { ignoreCase: true }), "abc");
});

test("choice / input の採点", () => {
  const c = { type: "choice", choices: ["a", "b"], answer: 1 };
  assert.strictEqual(g.check(c, 1).correct, true);
  assert.strictEqual(g.check(c, "1").correct, true);
  assert.strictEqual(g.check(c, 0).correct, false);
  const i = { type: "input", answers: ["5", "5回"] };
  assert.strictEqual(g.check(i, "５").correct, true);
  assert.strictEqual(g.check(i, "5 回").correct, true);
  assert.strictEqual(g.check(i, "").correct, false);
  const cs = { type: "input", answers: ["String"] };
  assert.strictEqual(g.check(cs, "string").correct, false, "Java は大文字小文字を区別する");
  assert.strictEqual(g.check({ ...cs, ignoreCase: true }, "string").correct, true);
  assert.strictEqual(g.check({ type: "free", model: "x" }, "y").needs, "ai");
});

test("評価の自動判定", () => {
  const it = { type: "input" }; // 目安 30 秒
  assert.strictEqual(g.autoGrade(it, { score: 0 }), 1);
  assert.strictEqual(g.autoGrade(it, { score: 1, latencyMs: 15000, hintUsed: true }), 2);
  assert.strictEqual(g.autoGrade(it, { score: 0.6, latencyMs: 15000 }), 2);
  assert.strictEqual(g.autoGrade(it, { score: 1, latencyMs: 60000 }), 2, "時間がかかった");
  assert.strictEqual(g.autoGrade(it, { score: 1, latencyMs: 15000 }), 3);
  assert.strictEqual(g.autoGrade(it, { score: 1, latencyMs: 5000 }), 4, "すばやく正解");
  const ch = { type: "choice" };
  assert.strictEqual(g.autoGrade(ch, { score: 1, latencyMs: 2000, firstTime: true }), 3, "初めての選択問題は、まぐれもあるので かんたん にしない");
  assert.strictEqual(g.autoGrade(ch, { score: 1, latencyMs: 2000, firstTime: false }), 4);
});
