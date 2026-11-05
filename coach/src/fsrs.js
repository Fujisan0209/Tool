/*
 * 記憶のモデル（FSRS-6）
 *
 * 1問ごとに「安定度 S（日）」と「難しさ D（1〜10）」を持ちます。
 *   - 思い出せる確率 R は、前回からの経過日数 t で下がっていく:  R(t) = (1 + F·t/S)^(-decay)
 *     S は「R が 90% まで下がるのにかかる日数」です（R(S) = 0.9）。
 *   - 答えるたびに、評価（1:だめ 2:むずかしい 3:できた 4:かんたん）で S と D を更新します。
 *
 * 式と初期パラメータは open-spaced-repetition の FSRS-6（ts-fsrs 6.0.0）と同じです。
 * DOM も保存も使わない純粋な関数だけなので、Node でもブラウザでもテストできます。
 */
"use strict";

const AGAIN = 1, HARD = 2, GOOD = 3, EASY = 4;

/** FSRS-6 の初期パラメータ w[0..20]（大勢の学習記録から求められた値） */
const DEFAULT_W = Object.freeze([
  0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796,
  1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542,
]);
const S_MIN = 0.001;
const S_MAX = 36500;

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

function curve(w) {
  const decay = -w[20];
  const factor = Math.pow(0.9, 1 / decay) - 1; // R(S) がちょうど 0.9 になるように決まる
  return { decay, factor };
}

/** 経過 t 日・安定度 S のとき、思い出せる確率 */
function retrievability(t, s, w = DEFAULT_W) {
  if (!(s > 0)) return 0;
  const { decay, factor } = curve(w);
  return Math.pow(1 + (factor * Math.max(0, t)) / s, decay);
}

/** 思い出せる確率が r まで下がるまでの日数（小数） */
function intervalDays(s, r = 0.9, w = DEFAULT_W) {
  const { decay, factor } = curve(w);
  return (s / factor) * (Math.pow(r, 1 / decay) - 1);
}

function initStability(g, w) {
  return clamp(w[g - 1], S_MIN, S_MAX);
}

function initDifficulty(g, w) {
  return w[4] - Math.exp((g - 1) * w[5]) + 1;
}

function nextDifficulty(d, g, w) {
  const delta = -w[6] * (g - 3);
  const damped = d + (delta * (10 - d)) / 9; // 10 に近いほど上がりにくい
  const reverted = w[7] * initDifficulty(EASY, w) + (1 - w[7]) * damped; // 少しずつ平均へ戻す
  return clamp(reverted, 1, 10);
}

function recallStability(d, s, r, g, w) {
  const hard = g === HARD ? w[15] : 1;
  const easy = g === EASY ? w[16] : 1;
  const inc = Math.exp(w[8]) * (11 - d) * Math.pow(s, -w[9]) * (Math.exp((1 - r) * w[10]) - 1);
  return clamp(s * (1 + inc * hard * easy), S_MIN, S_MAX);
}

function forgetStability(d, s, r, w) {
  const sf = w[11] * Math.pow(d, -w[12]) * (Math.pow(s + 1, w[13]) - 1) * Math.exp((1 - r) * w[14]);
  const floor = s / Math.exp(w[17] * w[18]);
  return clamp(floor, S_MIN, clamp(sf, S_MIN, S_MAX));
}

function shortTermStability(s, g, w) {
  let sinc = Math.pow(s, -w[19]) * Math.exp(w[17] * (g - 3 + w[18]));
  if (g >= HARD) sinc = Math.max(sinc, 1);
  return clamp(s * sinc, S_MIN, S_MAX);
}

/**
 * 1回答えたあとの記憶の状態を返します。
 * @param {{s:number,d:number}|null} state  まだ一度も答えていなければ null
 * @param {1|2|3|4} g                       評価
 * @param {number} elapsedDays              前回からの経過日数（小数でよい）
 * @param {boolean} sameDay                 前回と同じ日（学習日）なら true
 */
function step(state, g, elapsedDays, sameDay, w = DEFAULT_W) {
  if (![AGAIN, HARD, GOOD, EASY].includes(g)) throw new Error(`評価は1〜4です: ${g}`);
  if (!state) return { s: initStability(g, w), d: clamp(initDifficulty(g, w), 1, 10) };
  const { s, d } = state;
  const r = retrievability(elapsedDays, s, w);
  let ns;
  if (sameDay) ns = shortTermStability(s, g, w);
  else if (g === AGAIN) ns = forgetStability(d, s, r, w);
  else ns = recallStability(d, s, r, g, w);
  return { s: ns, d: nextDifficulty(d, g, w) };
}

const GRADE_LABEL = { 1: "だめ", 2: "むずかしい", 3: "できた", 4: "かんたん" };

module.exports = {
  AGAIN, HARD, GOOD, EASY, GRADE_LABEL, DEFAULT_W, S_MIN, S_MAX,
  retrievability, intervalDays, step,
};
