/*
 * 自分の記録に合わせて、記憶モデルのパラメータを調整する
 *
 * 最初のパラメータは「大勢の平均」です。人によって、忘れる速さはちがいます。
 * ログには「何日あけて、思い出せたかどうか」がすべて残っているので、
 *   予想した確率 R と、実際の結果（思い出せた=1 / だめ=0）のずれ（log loss）
 * がいちばん小さくなるように、いくつかのパラメータを少しずつ動かして探します（座標探索）。
 *
 * 動かすのは影響の大きいものだけです:
 *   w0〜w3  はじめて答えたときの安定度（評価ごと）
 *   w8      思い出せたときに安定度がどれだけのびるか
 *   w11     忘れたあとに安定度がどこまで下がるか
 *   w20     忘却曲線のカーブの形
 * データが少ないうちは調整しません（MIN_REVIEWS 件から）。
 */
"use strict";

const fsrs = require("./fsrs.js");
const { DAY, dayKey } = require("./time.js");

const MIN_REVIEWS = 50;
const TUNABLE = { 0: [0.001, 100], 1: [0.001, 100], 2: [0.001, 100], 3: [0.001, 100], 8: [0, 4.5], 11: [0.001, 5], 20: [0.1, 0.8] };
const FACTORS = [0.5, 0.7, 0.85, 1.15, 1.4, 2];

/** 問題ごとの [{ t, grade }] の列にします（時間順） */
function sequences(attempts, knownItem = () => true) {
  const map = new Map();
  for (const a of attempts) {
    if (!knownItem(a.itemId)) continue;
    if (!map.has(a.itemId)) map.set(a.itemId, []);
    map.get(a.itemId).push({ t: a.t, grade: a.grade });
  }
  for (const s of map.values()) s.sort((x, y) => x.t - y.t);
  return [...map.values()];
}

/** パラメータ w での平均 log loss（小さいほど予想が当たっている）と、評価に使った復習の数 */
function logLoss(seqs, w, dayStartHour = 4) {
  let loss = 0, n = 0;
  for (const seq of seqs) {
    let state = null, last = 0;
    for (const { t, grade } of seq) {
      const sameDay = state && dayKey(last, dayStartHour) === dayKey(t, dayStartHour);
      if (state && !sameDay) {
        const r = Math.min(1 - 1e-6, Math.max(1e-6, fsrs.retrievability((t - last) / DAY, state.s, w)));
        const y = grade > fsrs.AGAIN ? 1 : 0;
        loss += -(y * Math.log(r) + (1 - y) * Math.log(1 - r));
        n++;
      }
      state = fsrs.step(state, grade, state ? (t - last) / DAY : 0, !!sameDay, w);
      last = t;
    }
  }
  return { loss: n ? loss / n : NaN, n };
}

/** 座標探索。改善が1%未満なら元のパラメータのまま */
function fit(seqs, { w0 = fsrs.DEFAULT_W, rounds = 4, dayStartHour = 4 } = {}) {
  const base = logLoss(seqs, w0, dayStartHour);
  if (base.n < MIN_REVIEWS) return { w: [...w0], before: base.loss, after: base.loss, reviews: base.n, changed: false, reason: `復習の記録が ${base.n} 件です（${MIN_REVIEWS} 件から調整します）` };
  let w = [...w0];
  let best = base.loss;
  for (let r = 0; r < rounds; r++) {
    let improved = false;
    for (const [k, [lo, hi]] of Object.entries(TUNABLE)) {
      const i = Number(k);
      for (const f of FACTORS) {
        const cand = [...w];
        cand[i] = Math.min(hi, Math.max(lo, w[i] * f));
        if (cand[i] === w[i]) continue;
        const l = logLoss(seqs, cand, dayStartHour).loss;
        if (l < best - 1e-9) { best = l; w = cand; improved = true; }
      }
    }
    if (!improved) break;
  }
  const changed = best < base.loss * 0.99;
  return { w: changed ? w : [...w0], before: base.loss, after: changed ? best : base.loss, reviews: base.n, changed };
}

/** コーチの記録で調整して、よくなったら params イベントとして保存します */
function tuneCoach(coach) {
  const seqs = sequences(coach.attempts, (id) => coach.items.has(id));
  // いつも「大勢の平均」から探しなおす（前回の調整結果に引きずられないように）
  const res = fit(seqs, { dayStartHour: coach.config.dayStartHour });
  if (res.changed) {
    coach.events.push(coach.log.append({ type: "params", w: res.w, logLossBefore: res.before, logLossAfter: res.after, reviews: res.reviews }, coach.clock()));
    coach.replay();
  }
  return res;
}

module.exports = { sequences, logLoss, fit, tuneCoach, MIN_REVIEWS };
