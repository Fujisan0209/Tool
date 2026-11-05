/*
 * コーチ本体: 記録を再生して今の状態をつくり、問題を出し、答えを受けとって記録します。
 * 画面（server.js）・ターミナル（bin/coach.js quiz）・定期実行（daily.js）は、どれもこれを使います。
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const fsrs = require("./fsrs.js");
const { EloModel } = require("./mastery.js");
const { selectNext } = require("./selector.js");
const grade = require("./grade.js");
const { EventLog, loadDecks, validateItem } = require("./store.js");
const { DAY, dayKey, addDays } = require("./time.js");

const DEFAULT_CONFIG = Object.freeze({
  targetRetention: 0.9, // 思い出せる確率がこれより下がったら復習
  newPerDay: 10, // 1日に出す新しい問題の上限
  relearnGap: 3, // 間違えた問題は、ほかの問題を何問はさんでから出しなおすか
  cooldown: 4, // 一度出した問題を、何問のあいだ出さないか
  dayStartHour: 4, // 学習の1日が切りかわる時刻
  dailyAt: "07:00", // 定期実行の時刻（serve 中に使う）
});

function loadConfig(dataDir) {
  const file = path.join(dataDir, "config.json");
  let user = {};
  if (fs.existsSync(file)) user = JSON.parse(fs.readFileSync(file, "utf8"));
  return { ...DEFAULT_CONFIG, ...user };
}

/** 画面に送る問題。答えと解説は入れません */
function publicItem(item, tagLabels) {
  const { id, tag, type, prompt, code, choices, hint, level, source } = item;
  return { id, tag, tagLabel: tagLabels.get(tag) || tag, type, prompt, code, choices, hint, level, source };
}

function correctAnswerText(item) {
  if (item.type === "choice") return item.choices[item.answer];
  if (item.type === "input") return item.answers[0];
  return item.model;
}

class Coach {
  /**
   * @param {object} o
   * @param {string} o.dataDir     記録を置くフォルダ
   * @param {string[]} o.deckDirs  問題集のフォルダ
   * @param {object} [o.ai]        ai.js の createAi() の結果（なくても動きます）
   * @param {()=>number} [o.clock] テスト用の時計
   * @param {()=>number} [o.rng]   テスト用の乱数
   */
  constructor({ dataDir, deckDirs, ai = null, clock = Date.now, rng = Math.random, config = {} }) {
    this.dataDir = dataDir;
    this.deckDirs = deckDirs;
    this.ai = ai;
    this.clock = clock;
    this.rng = rng;
    fs.mkdirSync(dataDir, { recursive: true });
    this.config = { ...loadConfig(dataDir), ...config };
    this.log = new EventLog(path.join(dataDir, "events.jsonl"));
    this.sessions = new Map();
    this.reload();
  }

  /** 問題集とログを読みなおして、状態を最初から計算します */
  reload() {
    const { items, tagLabels, decks } = loadDecks(this.deckDirs);
    this.decks = decks;
    this.tagLabels = tagLabels;
    this.items = new Map(items.map((it) => [it.id, it]));
    const { events, skipped } = this.log.readAll();
    this.skippedLines = skipped;
    this.events = events;
    this.replay();
  }

  replay() {
    const events = this.events;
    // 1) 先に「あとから効くもの」を集める
    this.suspended = new Set();
    const overrides = new Map();
    this.w = fsrs.DEFAULT_W;
    this.tuned = null;
    this.dailyRuns = new Map();
    for (const ev of events) {
      if (ev.type === "item") {
        try {
          const it = validateItem(ev.item, "AIの問題");
          if (!this.items.has(it.id)) this.items.set(it.id, it);
        } catch { /* 壊れた問題は使わない */ }
      } else if (ev.type === "suspend") {
        if (ev.on === false) this.suspended.delete(ev.itemId);
        else this.suspended.add(ev.itemId);
      } else if (ev.type === "override") {
        overrides.set(ev.attemptId, ev.grade);
      } else if (ev.type === "params" && Array.isArray(ev.w) && ev.w.length === fsrs.DEFAULT_W.length) {
        this.w = ev.w;
        this.tuned = ev;
      } else if (ev.type === "daily") {
        this.dailyRuns.set(ev.date, ev);
      }
    }
    // 2) 答えた記録を時間順に再生する
    this.cards = new Map();
    this.elo = new EloModel();
    this.attempts = [];
    const attempts = events.filter((e) => e.type === "attempt").sort((a, b) => a.at.localeCompare(b.at));
    for (const ev of attempts) {
      const g = overrides.get(ev.id) ?? ev.grade;
      this.applyAttempt({ ...ev, grade: g, overridden: overrides.has(ev.id) });
    }
  }

  applyAttempt(ev) {
    const t = Date.parse(ev.at);
    const item = this.items.get(ev.itemId);
    const card = this.cards.get(ev.itemId);
    const firstTime = !card;
    const rec = { ...ev, t, tag: item ? item.tag : null, firstTime, day: dayKey(t, this.config.dayStartHour) };
    if (card) rec.recallBefore = fsrs.retrievability((t - card.last) / DAY, card.s, this.w);
    this.attempts.push(rec);
    if (!item) return rec; // 問題集から消された問題: 記録は残すが、モデルには使わない
    const elapsed = card ? (t - card.last) / DAY : 0;
    const sameDay = card ? dayKey(card.last, this.config.dayStartHour) === rec.day : false;
    const next = fsrs.step(card ? { s: card.s, d: card.d } : null, ev.grade, elapsed, sameDay, this.w);
    this.cards.set(ev.itemId, {
      ...next,
      last: t,
      reps: (card ? card.reps : 0) + 1,
      lapses: (card ? card.lapses : 0) + (card && ev.grade === fsrs.AGAIN ? 1 : 0),
    });
    // 「まぐれ当たり」と直された答えは、苦手の推定でも不正解として数える
    const score = ev.grade === fsrs.AGAIN ? 0 : Number.isFinite(ev.score) ? ev.score : ev.correct ? 1 : 0;
    this.elo.update(item, score);
    return rec;
  }

  activeItems() {
    return [...this.items.values()].filter((it) => !this.suspended.has(it.id));
  }

  today() {
    return dayKey(this.clock(), this.config.dayStartHour);
  }

  newToday() {
    const today = this.today();
    return this.attempts.filter((a) => a.firstTime && a.day === today).length;
  }

  recallNow(itemId, now = this.clock()) {
    const c = this.cards.get(itemId);
    return c ? fsrs.retrievability((now - c.last) / DAY, c.s, this.w) : null;
  }

  dueItems(now = this.clock()) {
    return this.activeItems().filter((it) => {
      const r = this.recallNow(it.id, now);
      return r !== null && r < this.config.targetRetention;
    });
  }

  session(id) {
    if (!this.sessions.has(id)) this.sessions.set(id, []);
    return this.sessions.get(id);
  }

  /** 次の問題を選びます。出す問題がなければ null */
  next(sessionId = "default") {
    const pick = selectNext({
      items: this.activeItems(), cards: this.cards, elo: this.elo, now: this.clock(),
      config: this.config, newToday: this.newToday(), session: this.session(sessionId),
      rng: this.rng, tagLabels: this.tagLabels, w: this.w,
    });
    if (!pick) return null;
    return { item: publicItem(pick.item, this.tagLabels), kind: pick.kind, reason: pick.reason, prob: pick.prob };
  }

  /**
   * 答えを採点して記録します。
   * free 問題で AI が使えず selfScore もないときは { needsSelf: true, model } を返します
   * （模範解答を見せて、自分で ○(1) △(0.5) ×(0) をつけてもらう）。
   */
  async answer({ sessionId = "default", itemId, answer, latencyMs = 0, hintUsed = false, selfScore }) {
    const item = this.items.get(itemId);
    if (!item) throw new Error(`問題が見つかりません: ${itemId}`);
    let { correct, score, needs } = grade.check(item, answer);
    let gradedBy = "auto";
    let feedback;
    if (needs) {
      if (Number.isFinite(selfScore)) {
        score = Math.min(1, Math.max(0, selfScore));
        gradedBy = "self";
      } else if (this.ai && this.ai.enabled) {
        try {
          const r = await this.ai.gradeFree(item, answer);
          score = r.score;
          feedback = r.feedback;
          gradedBy = "ai";
        } catch (e) {
          return { needsSelf: true, model: item.model, aiError: e.message };
        }
      } else {
        return { needsSelf: true, model: item.model };
      }
      correct = score >= 0.5;
    }
    const firstTime = !this.cards.has(itemId);
    const g = grade.autoGrade(item, { score, latencyMs, hintUsed, firstTime });
    const ev = this.log.append({
      type: "attempt", itemId, rev: item.rev, sessionId, answer, correct, score, grade: g,
      latencyMs: Math.round(latencyMs), hintUsed: !!hintUsed, gradedBy, ...(feedback ? { feedback } : {}),
    }, this.clock());
    this.events.push(ev);
    this.applyAttempt(ev);
    this.session(sessionId).push({ itemId, tag: item.tag, correct });
    return {
      attemptId: ev.id, correct, score, grade: g, gradeLabel: fsrs.GRADE_LABEL[g],
      nextReviewDays: fsrs.intervalDays(this.cards.get(itemId).s, this.config.targetRetention, this.w),
      correctAnswer: correctAnswerText(item), answerIndex: item.type === "choice" ? item.answer : undefined,
      explanation: item.explanation, feedback, gradedBy,
    };
  }

  /** 評価をなおします（例: まぐれ当たりだったので「だめ」に） */
  override(attemptId, g) {
    if (![1, 2, 3, 4].includes(g)) throw new Error("評価は1〜4です");
    if (!this.events.some((e) => e.type === "attempt" && e.id === attemptId)) throw new Error("その記録はありません");
    this.events.push(this.log.append({ type: "override", attemptId, grade: g }, this.clock()));
    this.replay();
    const at = this.attempts.find((a) => a.id === attemptId);
    const card = at && this.cards.get(at.itemId);
    // セッション内の結果も合わせる（だめ にしたら、あとでもう一度出る）
    if (at) for (const h of this.session(at.sessionId)) if (h.itemId === at.itemId) h.correct = g !== fsrs.AGAIN;
    return { nextReviewDays: card ? fsrs.intervalDays(card.s, this.config.targetRetention, this.w) : null };
  }

  suspend(itemId, on = true) {
    if (!this.items.has(itemId)) throw new Error(`問題が見つかりません: ${itemId}`);
    this.events.push(this.log.append({ type: "suspend", itemId, on }, this.clock()));
    this.replay();
  }

  /** 問題を追加します（AI が作った問題など）。おかしい問題は追加せず、理由を返します */
  addItems(rawItems, source = "ai") {
    const added = [], rejected = [];
    for (const raw of rawItems) {
      try {
        const it = validateItem({ ...raw, source }, "追加する問題");
        if (this.items.has(it.id)) throw new Error("同じ id の問題がもうあります");
        const dup = [...this.items.values()].some((x) => x.prompt === it.prompt && x.code === it.code);
        if (dup) throw new Error("同じ問題文の問題がもうあります");
        this.events.push(this.log.append({ type: "item", item: it }, this.clock()));
        this.items.set(it.id, it);
        added.push(it);
      } catch (e) {
        rejected.push(e.message);
      }
    }
    return { added, rejected };
  }

  async explain(attemptId) {
    const at = this.attempts.find((a) => a.id === attemptId);
    if (!at) throw new Error("その記録はありません");
    const item = this.items.get(at.itemId);
    if (!this.ai || !this.ai.enabled) throw new Error("AI が使えません（ANTHROPIC_API_KEY を設定してください）");
    return this.ai.explain(item, at.answer, at.correct, this.tagLabels.get(item.tag) || item.tag);
  }

  /** 分野ごとのようす。習熟度の低い順 */
  tagStats(now = this.clock()) {
    const since = now - 14 * DAY;
    const map = new Map();
    for (const it of this.activeItems()) {
      if (!map.has(it.tag)) map.set(it.tag, { tag: it.tag, label: this.tagLabels.get(it.tag) || it.tag, items: 0, seen: 0, unseen: 0, attempts: 0, recent: 0, recentCorrect: 0 });
      const s = map.get(it.tag);
      s.items++;
      if (this.cards.has(it.id)) s.seen++; else s.unseen++;
    }
    for (const a of this.attempts) {
      const s = a.tag && map.get(a.tag);
      if (!s) continue;
      s.attempts++;
      if (a.t >= since) { s.recent++; if (a.correct && a.grade !== fsrs.AGAIN) s.recentCorrect++; }
    }
    return [...map.values()].map((s) => {
      const e = this.elo.tag(s.tag);
      const mastery = this.elo.mastery(s.tag);
      return { ...s, mastery, recentAccuracy: s.recent ? s.recentCorrect / s.recent : null, weak: e.n >= 3 && mastery < 0.6 };
    }).sort((a, b) => (a.attempts ? a.mastery : 2) - (b.attempts ? b.mastery : 2));
  }

  /** 画面のダッシュボード用のまとめ */
  dashboard() {
    const now = this.clock();
    const today = this.today();
    const byDay = new Map();
    for (const a of this.attempts) {
      if (!byDay.has(a.day)) byDay.set(a.day, { answered: 0, correct: 0 });
      const d = byDay.get(a.day);
      d.answered++;
      if (a.correct && a.grade !== fsrs.AGAIN) d.correct++;
    }
    const history = [];
    for (let i = 13; i >= 0; i--) {
      const k = addDays(today, -i);
      history.push({ day: k, ...(byDay.get(k) || { answered: 0, correct: 0 }) });
    }
    let streak = 0;
    for (let k = byDay.has(today) ? today : addDays(today, -1); byDay.has(k); k = addDays(k, -1)) streak++;
    // これから7日の復習の予定
    const forecast = Array.from({ length: 7 }, (_, i) => ({ day: addDays(today, i), count: 0 }));
    for (const it of this.activeItems()) {
      const c = this.cards.get(it.id);
      if (!c) continue;
      const due = c.last + fsrs.intervalDays(c.s, this.config.targetRetention, this.w) * DAY;
      const k = due <= now ? today : dayKey(due, this.config.dayStartHour);
      const slot = forecast.find((f) => f.day === k);
      if (slot) slot.count++;
    }
    const t = byDay.get(today) || { answered: 0, correct: 0 };
    const newToday = this.newToday();
    const active = this.activeItems();
    return {
      today: { day: today, ...t, newDone: newToday, newLeft: Math.max(0, Math.min(this.config.newPerDay - newToday, active.filter((i) => !this.cards.has(i.id)).length)) },
      dueNow: this.dueItems(now).length,
      streak,
      history,
      forecast,
      tags: this.tagStats(now),
      totals: { items: active.length, seen: active.filter((i) => this.cards.has(i.id)).length, attempts: this.attempts.length, suspended: this.suspended.size, aiItems: active.filter((i) => i.source === "ai").length },
      config: this.config,
      ai: { enabled: !!(this.ai && this.ai.enabled), model: this.ai && this.ai.model },
      tuned: this.tuned ? { at: this.tuned.at, reviews: this.tuned.reviews, logLossBefore: this.tuned.logLossBefore, logLossAfter: this.tuned.logLossAfter } : null,
      lastDaily: [...this.dailyRuns.values()].sort((a, b) => b.date.localeCompare(a.date))[0] || null,
      skippedLines: this.skippedLines,
    };
  }
}

module.exports = { Coach, DEFAULT_CONFIG, publicItem };
