// 実行: npm test
const test = require("node:test");
const assert = require("node:assert");
const S = require("../game-lab/src/sim.js");

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

test("乱数はシードが同じなら同じ並び", () => {
  const a = S.mulberry32(42), b = S.mulberry32(42);
  for (let i = 0; i < 5; i++) assert.strictEqual(a(), b());
});

test("満足化: 要求水準0なら最初の候補で決める", () => {
  const v = Float64Array.from([30, 90, 10]);
  assert.deepStrictEqual(S.searchOnce(v, 0, 3, "sat", { aspiration: 0, recall: true }), [0, 1]);
});

test("満足化: 誰も届かなければ、戻れるときは最良、戻れないときは最後", () => {
  const v = Float64Array.from([30, 90, 10]);
  assert.deepStrictEqual(S.searchOnce(v, 0, 3, "sat", { aspiration: 95, recall: true }), [1, 3]);
  assert.deepStrictEqual(S.searchOnce(v, 0, 3, "sat", { aspiration: 95, recall: false }), [2, 3]);
});

test("最大化は全部見て最良を選ぶ。戻れないと使えない", () => {
  const v = Float64Array.from([30, 90, 10, 50]);
  assert.deepStrictEqual(S.searchOnce(v, 0, 4, "max", { recall: true }), [1, 4]);
  assert.strictEqual(S.searchOnce(v, 0, 4, "max", { recall: false }), null);
});

test("見送りルール: 見送った中の最良を超えた最初の候補を選ぶ", () => {
  const v = Float64Array.from([40, 60, 50, 70, 99]);
  assert.deepStrictEqual(S.searchOnce(v, 0, 5, "secretary", { skipRatio: 0.4, recall: false }), [3, 4]);
});

test("妥協する満足化: 見るたびに要求水準が下がる", () => {
  const v = Float64Array.from([50, 50, 50]);
  // 要求 80 → 65 → 50 で3つ目に決まる
  assert.deepStrictEqual(S.searchOnce(v, 0, 3, "adapt", { aspiration: 80, drop: 15, recall: true }), [2, 3]);
});

test("探索コストが高いと、満足化が最大化に勝つ", () => {
  const lab = S.runSearchLab({ n: 50, trials: 1000, dist: "uniform", seed: 1, cost: 1, recall: true, aspiration: 80, drop: 1, skipRatio: 0.37 });
  assert.ok(lab.results.sat.net > lab.results.max.net);
  assert.strictEqual(lab.results.max.bestRate, 1);
  assert.strictEqual(lab.sweep.length, 51);
});

test("2×2: 囚人のジレンマの均衡は (裏切り, 裏切り) だけで、パレート最適ではない", () => {
  const A = [[3, 0], [5, 1]], B = [[3, 5], [0, 1]];
  const r = S.analyze2x2(A, B);
  assert.deepStrictEqual(r.nash, [[1, 1]]);
  assert.strictEqual(r.rowDominant, 1);
  assert.strictEqual(r.colDominant, 1);
  assert.ok(!r.pareto.some(([i, j]) => i === 1 && j === 1));
  assert.strictEqual(r.mixed, null);
});

test("2×2: コイン合わせは 1/2 ずつの混合均衡だけ", () => {
  const A = [[1, -1], [-1, 1]], B = [[-1, 1], [1, -1]];
  const r = S.analyze2x2(A, B);
  assert.deepStrictEqual(r.nash, []);
  close(r.mixed.p, 0.5); close(r.mixed.q, 0.5);
});

test("2×2: 鹿狩りは純粋均衡2つと混合均衡1つ", () => {
  const A = [[4, 0], [3, 3]], B = [[4, 3], [0, 3]];
  const r = S.analyze2x2(A, B);
  assert.deepStrictEqual(r.nash, [[0, 0], [1, 1]]);
  close(r.mixed.p, 0.75); close(r.mixed.q, 0.75);
  const br = S.bestResponses(A, B);
  close(br.row.pts[1][0], 0.75);
});

test("レプリケーター: 鹿狩りで鹿側から出発すると (鹿, 鹿) に向かう", () => {
  const A = [[4, 0], [3, 3]], B = [[4, 3], [0, 3]];
  const tr = S.trajectory2(A, B, 0.9, 0.9);
  const [p, q] = tr[tr.length - 1];
  assert.ok(p > 0.99 && q > 0.99);
});

const base = { pay: { T: 5, R: 3, P: 1, S: 0 }, rounds: 10, noise: 0, satAspiration: 2, satAdapt: 0, seed: 7, reps: 1, selfPlay: true };

test("繰り返し囚人のジレンマ: しっぺ返し vs いつも裏切る", () => {
  const [a, b] = S.playMatch("tft", "alld", base, S.mulberry32(1));
  close(a, (0 + 9 * 1) / 10);
  close(b, (5 + 9 * 1) / 10);
});

test("ノイズなしなら しっぺ返し同士・勝てば継続同士は ずっと協力", () => {
  for (const id of ["tft", "wsls", "sat"]) {
    const [a, b, ca] = S.playMatch(id, id, base, S.mulberry32(1));
    close(a, 3); close(b, 3); close(ca, 1);
  }
});

test("勝てば継続は、まちがいのあと2回で協力にもどる", () => {
  // 満足化（要求水準 P と R の間・固定）は 勝てば継続 と同じ動き
  const cfg = { ...base, rounds: 200, noise: 0.05 };
  const w = S.playMatch("wsls", "wsls", cfg, S.mulberry32(3));
  const s = S.playMatch("sat", "sat", cfg, S.mulberry32(3));
  assert.deepStrictEqual(w, s);
});

test("総当たり戦とレプリケーター", () => {
  const ids = S.IPD_STRATEGIES.map((s) => s.id);
  const t = S.tournament(ids, { ...base, rounds: 100, reps: 3 });
  assert.strictEqual(t.M.length, 8);
  const hist = S.evolve(t.M, 100, 0, null);
  assert.strictEqual(hist.length, 101);
  for (const x of hist) close(x.reduce((a, b) => a + b, 0), 1, 1e-9);
  // ノイズなしでは「いつも裏切る」は生き残れない
  const alld = ids.indexOf("alld");
  assert.ok(hist[100][alld] < 0.01);
});

test("空間ゲーム: 全員協力なら全員協力のまま。中央の1人の裏切りは b しだい", () => {
  const S0 = S.spatialCreate(21, { seed: 1, start: "center" });
  S0.g.fill(1);
  assert.strictEqual(S.spatialStep(S0, { b: 1.9, rule: "imitate", aspiration: 0, mutation: 0 }), 1);

  const S1 = S.spatialCreate(21, { seed: 1, start: "center" });
  // b < 9/8 だと、裏切り者 (8b) は となり (8点) には勝つが、その外の協力者 (9点) に負けて広がれない
  close(S.spatialStep(S1, { b: 1.1, rule: "imitate", aspiration: 0, mutation: 0 }), 1 - 1 / 441);
  const S2 = S.spatialCreate(21, { seed: 1, start: "center" });
  // b = 1.9 だと 3×3 に広がる
  close(S.spatialStep(S2, { b: 1.9, rule: "imitate", aspiration: 0, mutation: 0 }), 1 - 9 / 441);
});
