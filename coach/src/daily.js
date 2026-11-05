/*
 * 定期実行（1日1回）
 *
 *   1. 苦手な分野で、まだ解いていない問題が少なくなっていたら、AI に問題を作ってもらう
 *   2. 週に1回、自分の記録に合わせて記憶モデルを調整する（tune.js）
 *   3. 今日の予定とふり返りを data/reports/YYYY-MM-DD.md に書く
 *   4. COACH_WEBHOOK_URL があれば、そこへ通知する（Discord / Slack の Webhook）
 *
 * 同じ日に2回動いても、2回目は何もしません（daily イベントで判定）。--force で強制。
 * 同時に2つ動かないように、data/daily.lock でロックします。
 *
 * 動かし方は2通り:
 *   - OS のスケジューラ（cron / launchd / タスク スケジューラ）から `coach daily` を呼ぶ
 *   - `coach serve` が動いているあいだは startScheduler() が毎分たしかめて、時刻をすぎたら実行
 *     （PC がスリープしていて時刻をのがしても、起きたときに実行します）
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { tuneCoach, MIN_REVIEWS } = require("./tune.js");
const { DAY } = require("./time.js");

const LOCK_STALE_MS = 30 * 60 * 1000;
const UNSEEN_LOW = 3; // まだ解いていない問題がこれより少なければ補充
const GENERATE_PER_TAG = 3;

function acquireLock(file) {
  try {
    fs.writeFileSync(file, String(process.pid), { flag: "wx" });
    return true;
  } catch {
    try {
      if (Date.now() - fs.statSync(file).mtimeMs > LOCK_STALE_MS) {
        fs.rmSync(file, { force: true }); // 前回が途中で落ちて残ったロック
        fs.writeFileSync(file, String(process.pid), { flag: "wx" });
        return true;
      }
    } catch { /* 別のプロセスに取られた */ }
    return false;
  }
}

/** Elo の実力 θ から、正解率75%くらいになる level（1〜5）を求めます */
function levelFor(theta) {
  const b = theta - Math.log(0.75 / 0.25);
  return Math.min(5, Math.max(1, Math.round(b / 0.6 + 2)));
}

function ruleMessage(d) {
  const parts = [];
  if (d.dueNow > 0) parts.push(`まずは復習 ${d.dueNow} 問から。忘れかけているものから順に出します。`);
  const weak = d.tags.filter((t) => t.weak);
  if (weak.length) parts.push(`「${weak[0].label}」がまだ不安定です。今日はここを重点的に出します。`);
  if (!parts.length) parts.push(d.today.newLeft > 0 ? `今日は新しい問題を ${d.today.newLeft} 問すすめましょう。` : "今日の分はありません。ゆっくり休みましょう。");
  if (d.streak >= 2) parts.push(`${d.streak} 日つづいています！`);
  return parts.join("");
}

function pct(x) {
  return x === null || x === undefined ? "-" : `${Math.round(x * 100)}%`;
}

function buildReport(d, { date, message, generated, tuned, errors }) {
  const y = d.history[d.history.length - 2] || { answered: 0, correct: 0 };
  const lines = [
    `# 学習コーチ ${date}`,
    "",
    `> ${message}`,
    "",
    "## 今日の予定",
    `- 復習: **${d.dueNow} 問**`,
    `- 新しい問題: **${d.today.newLeft} 問** まで`,
    `- 連続: ${d.streak} 日`,
    "",
    "## きのう",
    y.answered ? `- ${y.answered} 問、正解 ${y.correct} 問（${pct(y.correct / y.answered)}）` : "- お休み",
    "",
    "## 苦手な分野（習熟度の低い順）",
    ...d.tags.filter((t) => t.attempts > 0).slice(0, 5).map((t) => `- ${t.weak ? "⚠ " : ""}${t.label}: 習熟度 ${pct(t.mastery)}、最近の正解率 ${pct(t.recentAccuracy)}、未出題 ${t.unseen} 問`),
    "",
    "## これから7日の復習",
    ...d.forecast.map((f) => `- ${f.day}: ${f.count} 問`),
  ];
  if (generated.length) lines.push("", "## AI が作った問題", ...generated.map((g) => `- ${g.label}: ${g.added} 問追加${g.rejected ? `（${g.rejected} 問はチェックで不採用）` : ""}`));
  if (tuned) lines.push("", "## 記憶モデルの調整", tuned.changed ? `- 復習 ${tuned.reviews} 件から調整しました（予想のずれ ${tuned.before.toFixed(3)} → ${tuned.after.toFixed(3)}）` : `- ${tuned.reason || "今のパラメータのままが一番合っていました"}`);
  if (errors.length) lines.push("", "## うまくいかなかったこと", ...errors.map((e) => `- ${e}`));
  return lines.join("\n") + "\n";
}

async function notify(url, text, fetchImpl) {
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content: text.slice(0, 1900), text }), // Discord は content、Slack は text を読む
  });
  if (!res.ok) throw new Error(`通知に失敗しました (HTTP ${res.status})`);
}

/**
 * @param {import('./engine').Coach} coach
 * @param {object} [o]
 * @returns {Promise<{ skipped: boolean, date: string, file?: string, report?: string }>}
 */
async function runDaily(coach, { force = false, webhookUrl = process.env.COACH_WEBHOOK_URL, fetchImpl = globalThis.fetch } = {}) {
  coach.reload(); // 画面から答えた分も読みこむ
  const date = coach.today();
  const reportDir = path.join(coach.dataDir, "reports");
  const file = path.join(reportDir, `${date}.md`);
  if (!force && coach.dailyRuns.has(date)) return { skipped: true, date, file };
  const lock = path.join(coach.dataDir, "daily.lock");
  if (!acquireLock(lock)) return { skipped: true, date, reason: "ほかの定期実行が動いています" };
  try {
    const errors = [];
    const generated = [];
    const ai = coach.ai && coach.ai.enabled ? coach.ai : null;

    // 1) 苦手な分野の問題を補充
    if (ai) {
      const targets = coach.tagStats().filter((t) => t.weak && t.unseen < UNSEEN_LOW).slice(0, 2);
      const since = coach.clock() - 30 * DAY;
      for (const t of targets) {
        try {
          const examples = coach.activeItems().filter((it) => it.tag === t.tag);
          const mistakes = coach.attempts
            .filter((a) => a.tag === t.tag && !a.correct && a.t >= since)
            .slice(-4)
            .map((a) => {
              const it = coach.items.get(a.itemId);
              return { prompt: it.prompt, answer: it.type === "choice" ? it.choices[Number(a.answer)] : a.answer };
            });
          const raw = await ai.generateItems({ tag: t.tag, tagLabel: t.label, count: GENERATE_PER_TAG, level: levelFor(coach.elo.tag(t.tag).theta), examples, mistakes });
          const { added, rejected } = coach.addItems(raw, "ai");
          generated.push({ tag: t.tag, label: t.label, added: added.length, rejected: rejected.length });
          for (const r of rejected) errors.push(`AI の問題を不採用: ${r}`);
        } catch (e) {
          errors.push(`「${t.label}」の問題づくり: ${e.message}`);
        }
      }
    }

    // 2) 週に1回、記憶モデルを調整
    let tuned = null;
    const lastTune = coach.tuned ? Date.parse(coach.tuned.at) : 0;
    const reviews = coach.attempts.filter((a) => !a.firstTime).length;
    if (reviews >= MIN_REVIEWS && coach.clock() - lastTune >= 7 * DAY) tuned = tuneCoach(coach);

    // 3) まとめ
    const d = coach.dashboard();
    let message = ruleMessage(d);
    if (ai) {
      try {
        const weak = d.tags.filter((t) => t.attempts > 0).slice(0, 3).map((t) => `${t.label}（習熟度 ${pct(t.mastery)}）`).join("、");
        message = await ai.coachMessage(`今日の復習 ${d.dueNow} 問、新しい問題 ${d.today.newLeft} 問まで。連続 ${d.streak} 日。苦手そうな分野: ${weak || "まだわからない"}。直近14日の解答数: ${d.history.reduce((s, h) => s + h.answered, 0)} 問。`);
      } catch (e) {
        errors.push(`コーチのひとこと: ${e.message}`);
      }
    }
    const report = buildReport(d, { date, message, generated, tuned, errors });
    fs.mkdirSync(reportDir, { recursive: true });
    fs.writeFileSync(file, report);

    // 4) 通知
    if (webhookUrl) {
      try {
        await notify(webhookUrl, report, fetchImpl);
      } catch (e) {
        errors.push(e.message);
      }
    }

    coach.events.push(coach.log.append({ type: "daily", date, dueCount: d.dueNow, generated: generated.reduce((s, g) => s + g.added, 0), errors: errors.length }, coach.clock()));
    coach.replay();
    return { skipped: false, date, file, report, errors };
  } finally {
    fs.rmSync(lock, { force: true });
  }
}

/** いま実行すべきか（設定の時刻をすぎていて、今日まだ実行していない） */
function isDue(coach, now = coach.clock()) {
  const [h, m] = String(coach.config.dailyAt || "07:00").split(":").map(Number);
  const d = new Date(now);
  const after = d.getHours() * 60 + d.getMinutes() >= h * 60 + (m || 0);
  return after && !coach.dailyRuns.has(coach.today());
}

/** serve 中の簡易スケジューラ。毎分たしかめます。止めるときは返り値の関数を呼ぶ */
function startScheduler(coach, { onRun = () => {}, onError = () => {}, intervalMs = 60 * 1000 } = {}) {
  let running = false;
  const tick = async () => {
    if (running || !isDue(coach)) return;
    running = true;
    try {
      onRun(await runDaily(coach));
    } catch (e) {
      onError(e);
    } finally {
      running = false;
    }
  };
  tick();
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}

module.exports = { runDaily, isDue, startScheduler, levelFor, buildReport };
