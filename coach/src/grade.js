/*
 * 採点と、記憶モデルに渡す評価（1〜4）の自動判定
 *
 * 問題の種類
 *   choice … 選択肢から1つ選ぶ。answer は正解の番号（0から）
 *   input  … 短く書いて答える。answers のどれかと同じなら正解（空白・全角半角の違いは気にしない）
 *   free   … 文章で説明する。AI が採点（AI を使わないときは、模範解答を見て自分で ○△× をつける）
 */
"use strict";

const { AGAIN, HARD, GOOD, EASY } = require("./fsrs.js");

/** 比べるための正規化: 全角→半角(NFKC)、空白をすべて取る、全角/半角の引用符をそろえる */
function normalize(s, { ignoreCase = false } = {}) {
  let t = String(s ?? "").normalize("NFKC").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, "");
  if (ignoreCase) t = t.toLowerCase();
  return t;
}

/**
 * 答えを採点します。
 * @returns {{ correct: boolean|null, score: number|null, needs: null|"ai"|"self" }}
 *   free 問題は correct=null で返し、needs に「だれが採点するか」を入れます。
 */
function check(item, answer) {
  switch (item.type) {
    case "choice": {
      const ok = Number(answer) === item.answer;
      return { correct: ok, score: ok ? 1 : 0, needs: null };
    }
    case "input": {
      const opt = { ignoreCase: !!item.ignoreCase };
      const a = normalize(answer, opt);
      const ok = a.length > 0 && item.answers.some((x) => normalize(x, opt) === a);
      return { correct: ok, score: ok ? 1 : 0, needs: null };
    }
    case "free":
      return { correct: null, score: null, needs: "ai" };
    default:
      throw new Error(`知らない問題の種類です: ${item.type}`);
  }
}

/** 答えるのにかかる目安の秒数 */
function expectedSeconds(item) {
  if (item.timeSec) return item.timeSec;
  return { choice: 20, input: 30, free: 120 }[item.type] || 30;
}

/**
 * 結果から、記憶モデル用の評価を決めます。
 *   まちがい → 1 だめ
 *   ヒントを見た・部分点・時間がかかった → 2 むずかしい
 *   すばやく正解（初めての選択問題は、まぐれもあるので除く） → 4 かんたん
 *   それ以外の正解 → 3 できた
 */
function autoGrade(item, { score, latencyMs = 0, hintUsed = false, firstTime = false }) {
  if (score < 0.5) return AGAIN;
  if (hintUsed || score < 0.8) return HARD;
  const exp = expectedSeconds(item) * 1000;
  if (latencyMs > exp * 1.5) return HARD;
  if (latencyMs > 0 && latencyMs < exp * 0.35 && !(firstTime && item.type === "choice")) return EASY;
  return GOOD;
}

module.exports = { normalize, check, autoGrade, expectedSeconds };
