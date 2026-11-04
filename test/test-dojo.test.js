// 実行: npm test
const test = require("node:test");
const assert = require("node:assert");
const { EXERCISES, mutantCode, mutantDiff } = require("../test-dojo/src/exercises.js");
const R = require("../test-dojo/src/runner.js");

function evaluate(ex, tests) {
  return R.evaluate({ code: ex.code, names: ex.names, tests, mutants: ex.mutants.map((_, i) => mutantCode(ex, i)) });
}

for (const ex of EXERCISES) {
  test(`${ex.title}: バグ入り版はどれも正しいコードと書きかえ1か所だけちがう`, () => {
    ex.mutants.forEach((_, i) => {
      const code = mutantCode(ex, i);
      assert.notStrictEqual(code, ex.code);
      const d = mutantDiff(ex, i);
      assert.ok(d.before.length + d.after.length > 0);
    });
  });

  test(`${ex.title}: 模範解答は正しいコードで全部通り、すべてのバグを見つけて100点`, () => {
    const ev = evaluate(ex, ex.solution);
    assert.ok(!ev.error, ev.error && ev.error.message);
    for (const t of ev.correct) assert.ok(t.pass, `${t.name}: ${t.message}`);
    ev.mutants.forEach((m, i) => assert.ok(m.killed, `見逃し: ${ex.mutants[i].from} → ${ex.mutants[i].to}`));
    assert.strictEqual(R.score(ex, ev).total, 100);
  });

  test(`${ex.title}: 最初のテストは正しいコードで通り、満点にはならない`, () => {
    const ev = evaluate(ex, ex.starter);
    assert.ok(ev.correct.every((t) => t.pass));
    const s = R.score(ex, ev);
    assert.ok(s.total < 100 && s.killed < ex.mutants.length, `${ex.id}: ${s.total}`);
  });
}

test("toBe のヒント: 型ちがい・配列", () => {
  const r = R.runSuite("function f(){ return 7; }", ["f"], `test("型", () => { expect(f()).toBe("7"); });`);
  assert.match(r.tests[0].message, /型がちがいます/);
  const r2 = R.runSuite("function f(){ return [1]; }", ["f"], `test("配列", () => { expect(f()).toBe([1]); });`);
  assert.match(r2.tests[0].message, /toEqual/);
});

test("toThrow に関数を渡し忘れると、書き方を教える", () => {
  const r = R.runSuite("function f(){ throw new RangeError('x'); }", ["f"], `test("例外", () => { expect(f()).toThrow(); });`);
  assert.strictEqual(r.tests[0].pass, false);
  assert.match(r.tests[0].message, /toThrow\(\)/);
});

test("toThrow はクラス・文字列・正規表現でしぼれる。not も使える", () => {
  const r = R.runSuite("function f(x){ if (x) throw new RangeError('範囲外です'); return 1; }", ["f"], `
    test("a", () => { expect(() => f(1)).toThrow(RangeError); });
    test("b", () => { expect(() => f(1)).toThrow("範囲外"); });
    test("c", () => { expect(() => f(1)).toThrow(/範囲/); });
    test("d", () => { expect(() => f(0)).not.toThrow(); });
    test("e", () => { expect(() => f(1)).toThrow(TypeError); });
  `);
  assert.deepStrictEqual(r.tests.map((t) => t.pass), [true, true, true, true, false]);
});

test("toEqual・toBeCloseTo・toContain・toHaveLength・not", () => {
  const r = R.runSuite("const x = 1;", ["x"], `
    test("a", () => { expect({ a: [1, 2] }).toEqual({ a: [1, 2] }); });
    test("b", () => { expect(0.1 + 0.2).toBeCloseTo(0.3); });
    test("c", () => { expect([1, 2, 3]).toContain(2); expect("abc").toHaveLength(3); });
    test("d", () => { expect(1).not.toBe(2); expect([1]).not.toEqual([2]); });
    test("e", () => { expect(1).toBeAwesome(); });
  `);
  assert.deepStrictEqual(r.tests.map((t) => t.pass), [true, true, true, true, false]);
  assert.match(r.tests[4].message, /という書き方はありません/);
});

test("describe でまとめた名前、書きまちがい、テストの外の expect", () => {
  const r = R.runSuite("const x = 1;", ["x"], `describe("グループ", () => { test("中身", () => { expect(x).toBe(1); }); });`);
  assert.strictEqual(r.tests[0].name, "グループ › 中身");
  assert.match(R.runSuite("const x = 1;", ["x"], `test("a", () => { expect(x).toBe(1); ;`).error.message, /SyntaxError/);
  assert.match(R.runSuite("const x = 1;", ["x"], `expect(x).toBe(2);`).error.message, /test\(\.\.\.\) の中/);
});

test("採点: 正しいコードで失敗するテストは減点、名前と expect の数も見る", () => {
  const ex = EXERCISES[0];
  const ev = evaluate(ex, `
    test("test1", () => { expect(fizzBuzz(3)).toBe("Buzz"); });
    test("test1", () => { fizzBuzz(5); });
  `);
  const s = R.score(ex, ev);
  assert.strictEqual(s.invalid, 1);
  assert.strictEqual(s.penalty, 10);
  assert.strictEqual(s.killed, 0);
  assert.strictEqual(s.parts.names, 0);
  assert.strictEqual(s.total, 0);
});

test("採点: 失敗するテストはバグ発見に数えない", () => {
  const ex = EXERCISES[0];
  // わざと必ず失敗するテスト → 正しいコードでも失敗するので、無効
  const ev = evaluate(ex, `test("いつも失敗", () => { expect(1).toBe(2); });`);
  assert.strictEqual(R.score(ex, ev).killed, 0);
});

test("ランク", () => {
  assert.strictEqual(R.rank(100).mark, "花丸");
  assert.strictEqual(R.rank(0).mark, "可");
});
