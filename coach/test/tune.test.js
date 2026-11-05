const test = require("node:test");
const assert = require("node:assert");
const fsrs = require("../src/fsrs.js");
const { fit, logLoss, tuneCoach } = require("../src/tune.js");
const { seededRng, makeCoach, smallDeck } = require("./helpers.js");

const DAY = 86400000;

/** 「平均より忘れやすい人」の復習記録を作る（本当の安定度は平均の 1/3） */
function forgetfulLearner(nItems = 60, seed = 5) {
  const rng = seededRng(seed);
  const trueW = [...fsrs.DEFAULT_W];
  for (const i of [0, 1, 2, 3]) trueW[i] /= 3;
  trueW[8] -= 0.8;
  const seqs = [];
  const t0 = Date.parse("2026-01-01T12:00:00");
  for (let k = 0; k < nItems; k++) {
    let t = t0 + k * 3600 * 1000, state = null, last = t;
    const seq = [];
    for (let rep = 0; rep < 6; rep++) {
      let grade;
      if (!state) grade = rng() < 0.7 ? 3 : 1;
      else grade = rng() < fsrs.retrievability((t - last) / DAY, state.s, trueW) ? 3 : 1;
      seq.push({ t, grade });
      state = fsrs.step(state, grade, state ? (t - last) / DAY : 0, false, trueW);
      last = t;
      t += Math.max(1, Math.round(fsrs.intervalDays(state.s, 0.9))) * DAY + 3 * 3600 * 1000; // ふつうの設定で計画した間隔
    }
    seqs.push(seq);
  }
  return seqs;
}

test("忘れやすい人の記録で調整すると、予想が当たるようになり、安定度は小さめになる", () => {
  const seqs = forgetfulLearner();
  const res = fit(seqs);
  assert.ok(res.reviews >= 50);
  assert.strictEqual(res.changed, true);
  assert.ok(res.after < res.before * 0.95, `log loss ${res.before} → ${res.after}`);
  assert.ok(res.w[2] < fsrs.DEFAULT_W[2], "「できた」の初期安定度が下がる");
  assert.ok(Math.abs(logLoss(seqs, res.w).loss - res.after) < 1e-12);
});

test("記録が少ないうちは調整しない", () => {
  const res = fit(forgetfulLearner(5));
  assert.strictEqual(res.changed, false);
  assert.match(res.reason, /件から調整/);
});

test("tuneCoach: よくなったら params イベントとして保存し、再生に使う", async () => {
  const { coach, c } = makeCoach({ deck: smallDeck(20) });
  // ほとんど忘れている人: 毎回 2 日あけて、だいたいまちがえる
  const rng = seededRng(9);
  for (let day = 0; day < 8; day++) {
    for (const it of coach.activeItems()) {
      await coach.answer({ sessionId: `d${day}`, itemId: it.id, answer: rng() < 0.35 ? 0 : 1, latencyMs: 8000 });
    }
    c.days(2);
  }
  const res = tuneCoach(coach);
  assert.strictEqual(res.changed, true);
  assert.deepStrictEqual(coach.w, res.w);
  assert.ok(coach.dashboard().tuned);
  assert.strictEqual(coach.events.filter((e) => e.type === "params").length, 1);
});
