const test = require("node:test");
const assert = require("node:assert");
const f = require("../src/fsrs.js");

test("安定度 S の日数がたつと、思い出せる確率はちょうど 90%", () => {
  for (const s of [0.5, 3, 40]) assert.ok(Math.abs(f.retrievability(s, s) - 0.9) < 1e-9);
  assert.strictEqual(f.retrievability(0, 5), 1);
  assert.ok(f.retrievability(10, 5) < f.retrievability(5, 5));
});

test("目標 90% の復習間隔は S と同じ。目標を上げると間隔は短くなる", () => {
  assert.ok(Math.abs(f.intervalDays(7, 0.9) - 7) < 1e-9);
  assert.ok(f.intervalDays(7, 0.95) < 7);
  assert.ok(Math.abs(f.retrievability(f.intervalDays(7, 0.8), 7) - 0.8) < 1e-9);
});

test("はじめての評価: 安定度は w0〜w3、かんたんほど長い", () => {
  const ss = [1, 2, 3, 4].map((g) => f.step(null, g, 0, false).s);
  assert.deepStrictEqual(ss, f.DEFAULT_W.slice(0, 4));
  const ds = [1, 2, 3, 4].map((g) => f.step(null, g, 0, false).d);
  assert.ok(ds[0] > ds[1] && ds[1] > ds[2] && ds[2] > ds[3], "だめ のほうが難しい");
});

test("期限に思い出せたら安定度がのび、忘れたら下がる", () => {
  const st = { s: 5, d: 5 };
  const good = f.step(st, f.GOOD, 5, false);
  const hard = f.step(st, f.HARD, 5, false);
  const easy = f.step(st, f.EASY, 5, false);
  const again = f.step(st, f.AGAIN, 5, false);
  assert.ok(easy.s > good.s && good.s > hard.s && hard.s > st.s);
  assert.ok(again.s < st.s);
  assert.ok(again.d > st.d && easy.d < st.d);
});

test("忘れかけて思い出したほうが、のびが大きい（望ましい困難）", () => {
  const st = { s: 5, d: 5 };
  assert.ok(f.step(st, f.GOOD, 10, false).s > f.step(st, f.GOOD, 2, false).s);
});

test("同じ日の復習は短期の式（できた なら少し、だめ なら下がる）", () => {
  const st = { s: 2, d: 5 };
  assert.ok(f.step(st, f.GOOD, 0.01, true).s >= st.s);
  assert.ok(f.step(st, f.AGAIN, 0.01, true).s < st.s);
});

test("評価は1〜4だけ", () => {
  assert.throws(() => f.step(null, 5, 0, false));
});
