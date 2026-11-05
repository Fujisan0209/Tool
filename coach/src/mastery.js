/*
 * 苦手の推定（Elo レーティング）
 *
 * 分野（タグ）ごとの「実力 θ」と、問題ごとの「難しさ b」を持ち、
 *   正解する確率 P = 1 / (1 + e^-(θ - b))
 * と考えます。答えるたびに、予想と結果のずれ (結果 - P) だけ両方を動かします。
 *   - まだ解いていない問題でも「正解できそうな確率」がわかる → ちょうどよい難しさの新問題を選べる
 *   - θ が低い分野 = 苦手な分野
 * 動かす幅は、回数が少ないうちは大きく、だんだん小さくします（不確かさ関数 U(n) = a/(1+b·n)）。
 */
"use strict";

const sigmoid = (x) => 1 / (1 + Math.exp(-x));
const U = (n) => 1.0 / (1 + 0.06 * n);

/** 問題に書かれた level(1〜5) を、最初の難しさ b にします */
function initialItemDifficulty(level) {
  const lv = Number.isFinite(level) ? level : 2;
  return (lv - 2) * 0.6;
}

class EloModel {
  constructor() {
    this.tags = new Map(); // tag → { theta, n }
    this.items = new Map(); // itemId → { b, n }
  }
  tag(tag) {
    if (!this.tags.has(tag)) this.tags.set(tag, { theta: 0, n: 0 });
    return this.tags.get(tag);
  }
  item(item) {
    if (!this.items.has(item.id)) this.items.set(item.id, { b: initialItemDifficulty(item.level), n: 0 });
    return this.items.get(item.id);
  }
  /** この問題に正解できそうな確率 */
  predict(item) {
    return sigmoid(this.tag(item.tag).theta - this.item(item).b);
  }
  /** 結果を反映します。score は 0〜1（部分点もOK） */
  update(item, score) {
    const t = this.tag(item.tag);
    const it = this.item(item);
    const err = score - sigmoid(t.theta - it.b);
    t.theta += U(t.n) * err;
    it.b -= U(it.n) * err;
    t.n++;
    it.n++;
  }
  /** 分野の習熟度：ふつうの難しさ(b=0)の問題に正解できる確率 */
  mastery(tag) {
    return sigmoid(this.tag(tag).theta);
  }
}

module.exports = { EloModel, sigmoid, initialItemDifficulty };
