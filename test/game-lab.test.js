// 実行: npm test  （node --test）
// game-lab/src/sim.js（満足化・ゲーム理論の計算部分）のテスト
const test = require("node:test");
const assert = require("node:assert");
const S = require("../game-lab/src/sim.js");

test("同じ seed なら同じ乱数", () => {
  const a = S.rng(42), b = S.rng(42);
  for (let i = 0; i < 5; i++) assert.strictEqual(a(), b());
});

test("満足化: 願望水準以上の最初の候補で止まる", () => {
  const T = { n: 5, trials: 1, truth: [10, 40, 80, 90, 20], seen: [10, 40, 80, 90, 20] };
  assert.deepStrictEqual(S.searchOnce(T, 0, { kind: "satisfice", aspiration: 50 }, false), { looked: 3, pick: 2 });
  // だれも届かない: 戻れないなら最後、戻れるなら一番よいもの
  assert.deepStrictEqual(S.searchOnce(T, 0, { kind: "satisfice", aspiration: 95 }, false), { looked: 5, pick: 4 });
  assert.deepStrictEqual(S.searchOnce(T, 0, { kind: "satisfice", aspiration: 95 }, true), { looked: 5, pick: 3 });
  // 妥協: 1つ見るごとに 20 下げる → 3番目(しきい値 55)で 80 を取る … 2番目はしきい値 75 で 40 は届かない
  assert.deepStrictEqual(S.searchOnce(T, 0, { kind: "satisfice", aspiration: 95, drop: 20 }, false), { looked: 3, pick: 2 });
  assert.deepStrictEqual(S.searchOnce(T, 0, { kind: "maximize" }, false), { looked: 5, pick: 3 });
});

test("最適停止: 一様分布・コスト0・2択なら最初のしきい値は 50", () => {
  const { thresholds } = S.optimalThresholds(2, 0, "uniform");
  assert.ok(Math.abs(thresholds[0] - 50) < 1.5, String(thresholds[0]));
  assert.strictEqual(thresholds[1], -Infinity);
});

test("最適停止は、どの固定の願望水準よりも（ほぼ）よい", () => {
  const p = { n: 30, trials: 3000, dist: "uniform", noise: 0, seed: 3, cost: 1, aspiration: 70, drop: 0, recall: false, exampleIndex: 0 };
  const out = S.runSatisficing(p);
  assert.ok(out.results.optimal.net >= out.sweep.best.net - 0.8, `${out.results.optimal.net} vs ${out.sweep.best.net}`);
  // 探索コストがあると、全部見る最大化は満足化の最善に負ける
  assert.ok(out.sweep.best.net > out.results.maximize.net);
});

test("2×2: 囚人のジレンマの均衡は (裏切り, 裏切り) だけで、パレート最適ではない", () => {
  const an = S.analyze2x2(S.GAMES.pd);
  assert.deepStrictEqual(an.nash, [[1, 1]]);
  assert.strictEqual(an.dominant.row, 1);
  assert.strictEqual(an.dominant.col, 1);
  assert.ok(!an.pareto.some(([i, j]) => i === 1 && j === 1));
  assert.strictEqual(an.mixed, null);
});

test("2×2: コイン合わせは純粋均衡なし、混合均衡は 1/2", () => {
  const an = S.analyze2x2(S.GAMES.pennies);
  assert.strictEqual(an.nash.length, 0);
  assert.ok(Math.abs(an.mixed.p - 0.5) < 1e-12 && Math.abs(an.mixed.q - 0.5) < 1e-12);
});

test("2×2: タカとハトの混合均衡はタカ V/C", () => {
  const an = S.analyze2x2(S.GAMES.hawkdove);
  assert.ok(Math.abs(an.mixed.p - 4 / 6) < 1e-12);
  assert.strictEqual(an.nash.length, 2);
});

test("レプリケーター: 囚人のジレンマでは裏切りへ向かう", () => {
  const path = S.replicatorPath(S.GAMES.pd, 0.9, 0.9);
  const [p, q] = path[path.length - 1];
  assert.ok(p < 0.05 && q < 0.05);
});

test("くり返し囚人のジレンマ: しっぺ返し vs いつも裏切り（ノイズなし）", () => {
  const P = { T: 5, R: 3, P: 1, S: 0 };
  const res = S.tournament({ ids: ["tft", "alld", "allc"], payoff: P, rounds: 100, reps: 1 });
  const [tft, alld, allc] = [0, 1, 2];
  assert.strictEqual(res.M[tft][tft], 3);
  assert.ok(Math.abs(res.M[tft][alld] - 0.99) < 1e-9); // 最初だけ S、あとは P
  assert.ok(Math.abs(res.M[alld][tft] - 1.04) < 1e-9);
  assert.strictEqual(res.M[alld][allc], 5);
});

test("パブロフは願望水準 R の満足化と同じ動き", () => {
  const P = { T: 5, R: 3, P: 1, S: 0 };
  const a = S.tournament({ ids: ["wsls", "sat", "rand"], payoff: P, rounds: 200, noise: 0.05, reps: 3, aspiration: 3, seed: 7 });
  // 同じ相手（でたらめ）に対して、ほぼ同じ得点
  assert.ok(Math.abs(a.M[0][2] - a.M[1][2]) < 0.15, `${a.M[0][2]} ${a.M[1][2]}`);
});

test("進化: 割合の合計は 1 のまま", () => {
  const P = { T: 5, R: 3, P: 1, S: 0 };
  const res = S.tournament({ ids: ["tft", "alld", "allc", "rand"], payoff: P, rounds: 50, reps: 2 });
  const hist = S.evolve(res.M, [0.25, 0.25, 0.25, 0.25], 50);
  for (const x of hist) assert.ok(Math.abs(x.reduce((s, v) => s + v, 0) - 1) < 1e-9);
});

test("空間ゲーム: 全員協力なら（突然変異なしで）変わらない", () => {
  const L = 10;
  const g = S.spatialInit(L, "random", 1, 1);
  const { next, pay } = S.spatialStep(g, L, { b: 1.8 }, S.rng(1));
  assert.ok(next.every((v) => v === 1));
  assert.ok(pay.every((v) => v === 9));
});

test("空間ゲーム: 協力者の中の1人の裏切り者は、b が大きいと広がる", () => {
  const L = 21;
  let g = S.spatialInit(L, "single", 0, 1);
  const r = S.rng(1);
  for (let t = 0; t < 3; t++) g = S.spatialStep(g, L, { b: 1.9 }, r).next;
  const d = g.reduce((s, v) => s + (v ? 0 : 1), 0);
  assert.ok(d > 1, String(d));
});
