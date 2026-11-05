/*
 * 次に出す問題を選ぶ
 *
 * すべての問題に点数をつけて、いちばん高いものを出します。点数は4つの「種類」の土台点に、
 * 理由ごとの加点・減点を足したものです。
 *
 *   種類        土台  いつ候補になるか
 *   ---------  ----  ---------------------------------------------------------------
 *   relearn     3    このセッションで間違えた問題（ほかの問題を relearnGap 問はさんでから）
 *   due         2    思い出せる確率 R が目標（ふつう90%）より下がった問題 … 間隔反復
 *   new         1    まだ解いていない問題（1日の上限 newPerDay まで）
 *   practice    0    上の3つがないときの「おさらい」（苦手な分野・忘れかけの問題）
 *
 *   加点・減点
 *   - due:      目標からどれだけ下がったか（忘れかけほど先に）
 *   - 苦手:      分野の習熟度が低いほど加点（Elo の θ。習熟度 80% 以上なら加点なし）
 *   - ちょうどよい難しさ: 新問題は「正解できそうな確率」が 75% に近いほど加点
 *                （むずかしすぎず、かんたんすぎない問題がいちばん身につく）
 *   - カリキュラム: 新問題は問題集の前のほうを少し優先
 *   - まぜる:    直前と同じ分野は減点（同じ分野を続けるより、まぜたほうが定着する）
 *   - 少しだけランダム（毎回まったく同じ順番にならないように）
 */
"use strict";

const { retrievability } = require("./fsrs.js");
const { DAY } = require("./time.js");

const TARGET_P = 0.75;

/**
 * @param {object} ctx
 * @param {object[]} ctx.items      出題できる問題（停止したものは除く）。並び順 = カリキュラム順
 * @param {Map} ctx.cards           itemId → { s, d, last, reps, lapses }（解いたことがある問題だけ）
 * @param {import('./mastery').EloModel} ctx.elo
 * @param {number} ctx.now
 * @param {object} ctx.config       { targetRetention, newPerDay, relearnGap, cooldown }
 * @param {number} ctx.newToday     今日すでに出した新問題の数
 * @param {object[]} ctx.session    このセッションで答えた順の [{ itemId, tag, correct }]
 * @param {()=>number} [ctx.rng]
 * @param {Map|object} [ctx.tagLabels]
 */
function scoreCandidates(ctx) {
  const { items, cards, elo, now, config, session = [], newToday = 0 } = ctx;
  const rng = ctx.rng || Math.random;
  const w = ctx.w;
  const label = (t) => (ctx.tagLabels && (ctx.tagLabels.get ? ctx.tagLabels.get(t) : ctx.tagLabels[t])) || t;
  const target = config.targetRetention;
  const cooldown = config.cooldown ?? 4;
  const relearnGap = config.relearnGap ?? 3;

  // セッションの中での位置（何問前に出たか）と、最後の結果
  const lastPos = new Map();
  const lastCorrect = new Map();
  const misses = new Map();
  session.forEach((h, i) => {
    lastPos.set(h.itemId, session.length - i); // 1 = 直前
    lastCorrect.set(h.itemId, h.correct);
    if (!h.correct) misses.set(h.itemId, (misses.get(h.itemId) || 0) + 1);
  });
  const prevTag1 = session.length ? session[session.length - 1].tag : null;
  const prevTag2 = session.length > 1 ? session[session.length - 2].tag : null;

  // 苦手度 0〜1: 習熟度 80% 以上なら 0、0% なら 1（まだ解いていない分野は 0）
  // 「苦手」と表示するのは、3問以上解いてからにする（1問まちがえただけで苦手あつかいしない）
  const sure = (tag) => elo.tag(tag).n >= 3;
  const weak = (tag) => (elo.tag(tag).n === 0 ? 0 : Math.min(1, Math.max(0, (0.8 - elo.mastery(tag)) / 0.8)));
  const out = [];
  const n = items.length;

  items.forEach((item, idx) => {
    const ago = lastPos.get(item.id);
    const card = cards.get(item.id);
    let kind, score, reason, prob;

    if (ago !== undefined && lastCorrect.get(item.id) === false) {
      if (ago <= relearnGap && items.length > relearnGap) return; // まだ間をあける
      if (misses.get(item.id) >= 3) return; // 3回まちがえたら今日はやめて、また別の日に
      kind = "relearn";
      score = 3;
      prob = card ? retrievability((now - card.last) / DAY, card.s, w) : elo.predict(item);
      reason = "さっき間違えた問題に、もう一度チャレンジ";
    } else if (ago !== undefined && ago <= cooldown) {
      return; // ついさっき出したばかり
    } else if (card) {
      const r = retrievability((now - card.last) / DAY, card.s, w);
      prob = r;
      if (r < target) {
        kind = "due";
        score = 2 + 2 * (target - r) + 0.5 * weak(item.tag);
        reason = `復習のタイミングです（いま思い出せる確率 ${Math.round(r * 100)}%）`;
      } else {
        if (ago !== undefined) return; // おさらいは、このセッションでまだ出していない問題だけ
        kind = "practice";
        score = 0.6 * weak(item.tag) + 0.4 * (1 - r);
        reason = sure(item.tag) && weak(item.tag) > 0.4
          ? `今日の分はおわり！苦手な「${label(item.tag)}」をおさらい`
          : `今日の分はおわり！忘れかけの問題をおさらい`;
      }
    } else {
      if (newToday >= config.newPerDay) return;
      kind = "new";
      prob = elo.predict(item);
      const fit = Math.max(0, 1 - Math.abs(prob - TARGET_P) / 0.5);
      const wk = weak(item.tag);
      score = 1 + 0.8 * wk + 0.5 * fit + 0.2 * (1 - idx / Math.max(1, n));
      reason = sure(item.tag) && wk > 0.4
        ? `苦手な「${label(item.tag)}」の新しい問題（正解できそうな確率 ${Math.round(prob * 100)}%）`
        : `新しい問題「${label(item.tag)}」（正解できそうな確率 ${Math.round(prob * 100)}%）`;
    }

    if (item.tag === prevTag1) score -= 0.5;
    else if (item.tag === prevTag2) score -= 0.25;
    score += rng() * 0.05;
    out.push({ item, kind, score, reason, prob });
  });

  out.sort((a, b) => b.score - a.score);
  return out;
}

/** 次の1問。出せる問題がなければ null */
function selectNext(ctx) {
  return scoreCandidates(ctx)[0] || null;
}

module.exports = { selectNext, scoreCandidates, TARGET_P };
