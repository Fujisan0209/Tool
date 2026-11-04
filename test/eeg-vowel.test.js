// 実行: npm test  （node --test）
// ブラウザ側の計算（eeg-vowel/src/features.js）が、Python（scikit-learn / scipy）で学習・評価した
// 結果と同じ確率を出すことを、配布データに入っている全試行で確かめます。
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const E = require("../eeg-vowel/src/features.js");

const dir = path.join(__dirname, "..", "eeg-vowel", "data");
const demo = JSON.parse(fs.readFileSync(path.join(dir, "demo.json"), "utf8"));
const results = JSON.parse(fs.readFileSync(path.join(dir, "results.json"), "utf8"));

test("Welch のパワースペクトル: 正弦波のピークが正しい周波数に出る", () => {
  const fs_ = 128, x = new Float64Array(512);
  for (let i = 0; i < x.length; i++) x[i] = 10 * Math.sin((2 * Math.PI * 10 * i) / fs_);
  const P = E.welch(x, fs_);
  assert.strictEqual(P.length, 65);
  assert.strictEqual(P.indexOf(Math.max(...P)), 10);
  // パワーの合計（∫P df）≒ 分散 = 振幅^2 / 2
  const total = P.reduce((s, v) => s + v, 0);
  assert.ok(Math.abs(total - 50) < 1, `total=${total}`);
});

test("全試行で Python と同じ確率になる", () => {
  let n = 0;
  for (const s of demo.subjects) {
    assert.strictEqual(s.models.length, 5);
    for (const t of s.trials) {
      const x = E.decodeTrial(t.data, t.scale, demo.channels.length);
      assert.strictEqual(x.length, 6);
      assert.strictEqual(x[0].length, 512);
      const { proba } = E.predict(x, demo.fs, s.models[t.fold]);
      proba.forEach((p, c) => assert.ok(Math.abs(p - t.py[c]) < 1e-4, `被験者${s.subject}: ${p} vs ${t.py[c]}`));
      n++;
    }
  }
  assert.ok(n >= 15 * 5, `試行数 ${n}`);
});

test("評価結果の数字がそろっている", () => {
  const w = results.within;
  assert.strictEqual(w.per_subject.length, 15);
  assert.strictEqual(w.per_subject.reduce((s, p) => s + p.n, 0), w.n);
  assert.strictEqual(w.confusion.flat().reduce((a, b) => a + b, 0), w.n);
  assert.strictEqual(w.confusion.reduce((s, r, i) => s + r[i], 0), w.correct);
  assert.ok(w.p_perm > 0 && w.p_perm <= 1);
  assert.ok(results.checks.length >= 2);
});
