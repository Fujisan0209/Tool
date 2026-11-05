#!/usr/bin/env node
/*
 * 学習コーチのコマンド
 *
 *   node bin/coach.js serve      画面を開く（http://127.0.0.1:4310）。毎日の定期実行も自動で
 *   node bin/coach.js quiz [n]   ターミナルで n 問（ふつう10問）
 *   node bin/coach.js daily      定期実行を1回（cron などから呼ぶ）。--force で今日2回目も
 *   node bin/coach.js stats      いまのようす
 *   node bin/coach.js tune       自分の記録で記憶モデルを調整
 *   node bin/coach.js schedule   この PC で毎日動かす設定のしかたを表示
 *
 * 環境変数
 *   COACH_DATA_DIR      記録を置くフォルダ（ふつう coach/data）
 *   COACH_PORT          画面のポート（ふつう 4310）
 *   ANTHROPIC_API_KEY   AI を使うとき
 *   COACH_MODEL         AI のモデル（ふつう claude-opus-5-5）
 *   COACH_WEBHOOK_URL   定期実行のまとめを送る Discord / Slack の Webhook
 */
"use strict";

const path = require("node:path");
const readline = require("node:readline");
const { Coach } = require("../src/engine.js");
const { createAi } = require("../src/ai.js");
const { runDaily, startScheduler } = require("../src/daily.js");
const { tuneCoach } = require("../src/tune.js");
const { createServer } = require("../src/server.js");

const ROOT = path.join(__dirname, "..");
const DATA = path.resolve(process.env.COACH_DATA_DIR || path.join(ROOT, "data"));
const DECKS = [path.join(ROOT, "decks"), path.join(DATA, "decks")];
const pct = (x) => (x === null || x === undefined ? "  - " : `${String(Math.round(x * 100)).padStart(3)}%`);

async function makeCoach() {
  const ai = await createAi();
  return new Coach({ dataDir: DATA, deckDirs: DECKS, ai });
}

function aiLine(coach) {
  return coach.ai.enabled ? `AI: オン（${coach.ai.model}）` : `AI: オフ（${coach.ai.reason}）`;
}

async function serve() {
  const coach = await makeCoach();
  const port = Number(process.env.COACH_PORT) || 4310;
  const server = createServer(coach, { log: (m) => console.error(m) });
  server.listen(port, "127.0.0.1", () => {
    console.log(`学習コーチ: http://127.0.0.1:${port}`);
    console.log(`記録: ${coach.log.file}`);
    console.log(aiLine(coach));
    console.log(`定期実行: 毎日 ${coach.config.dailyAt} すぎ（この画面が動いているあいだ）`);
  });
  startScheduler(coach, {
    onRun: (r) => !r.skipped && console.log(`定期実行しました: ${r.file}`),
    onError: (e) => console.error(`定期実行でエラー: ${e.message}`),
  });
}

async function quiz(n = 10) {
  const coach = await makeCoach();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  // 行を順番に受けとる（貼りつけやパイプで先に届いた行も取りこぼさない）
  const lines = rl[Symbol.asyncIterator]();
  const ask = async (prompt) => {
    process.stdout.write(prompt);
    const { value, done } = await lines.next();
    return done ? "q" : value;
  };
  const session = `cli-${Date.now()}`;
  let done = 0, ok = 0;
  console.log(`${aiLine(coach)}\n（q で終了）\n`);
  try {
    while (done < n) {
      const q = coach.next(session);
      if (!q) { console.log("今日出せる問題はもうありません。おつかれさま！"); break; }
      console.log(`── ${done + 1}/${n}  [${q.item.tagLabel}]  ${q.reason}`);
      console.log(q.item.prompt);
      if (q.item.code) console.log(`\n${q.item.code.replace(/^/gm, "    ")}\n`);
      if (q.item.choices) q.item.choices.forEach((c, i) => console.log(`  ${i + 1}) ${c}`));
      const t0 = Date.now();
      let a = (await ask("> ")).trim();
      if (a === "q") break;
      if (q.item.type === "choice") a = Number(a) - 1;
      let r = await coach.answer({ sessionId: session, itemId: q.item.id, answer: a, latencyMs: Date.now() - t0 });
      if (r.needsSelf) {
        console.log(`\n模範解答:\n${r.model}\n`);
        const s = (await ask("自分で採点してください  1) ○  2) △  3) × > ")).trim();
        r = await coach.answer({ sessionId: session, itemId: q.item.id, answer: a, latencyMs: Date.now() - t0, selfScore: { 1: 1, 2: 0.5, 3: 0 }[s] ?? 0 });
      }
      done++;
      if (r.correct) ok++;
      console.log(r.correct ? "\n○ 正解！" : `\n× ざんねん。正解: ${r.correctAnswer}`);
      if (r.feedback) console.log(`AI: ${r.feedback}`);
      if (r.explanation) console.log(r.explanation);
      console.log(`（評価: ${r.gradeLabel} → 次の復習は約 ${formatDays(r.nextReviewDays)}）\n`);
    }
  } finally {
    rl.close();
  }
  console.log(`${done} 問中 ${ok} 問正解`);
}

function formatDays(d) {
  if (d < 1 / 24) return `${Math.max(1, Math.round(d * 24 * 60))} 分後`;
  if (d < 1) return `${Math.round(d * 24)} 時間後`;
  if (d < 60) return `${Math.round(d)} 日後`;
  return `${Math.round(d / 30)} か月後`;
}

async function stats() {
  const coach = await makeCoach();
  const d = coach.dashboard();
  console.log(`今日 (${d.today.day}): ${d.today.answered} 問 / 正解 ${d.today.correct}   復習待ち ${d.dueNow} 問   新しい問題 あと ${d.today.newLeft} 問   連続 ${d.streak} 日`);
  console.log(`問題 ${d.totals.items}（解いた ${d.totals.seen}、AI作 ${d.totals.aiItems}、停止 ${d.totals.suspended}）  解答 ${d.totals.attempts} 回   ${aiLine(coach)}`);
  if (d.skippedLines) console.log(`※ 記録の中に読めない行が ${d.skippedLines} 行ありました（とばしています）`);
  console.log("\n分野                     習熟度  最近の正解率  解いた/全部");
  for (const t of d.tags) {
    console.log(`${t.weak ? "⚠" : " "} ${t.label.padEnd(20, "　").slice(0, 12)}  ${t.attempts ? pct(t.mastery) : "  - "}     ${pct(t.recentAccuracy)}       ${t.seen}/${t.items}`);
  }
  console.log("\nこれから7日の復習: " + d.forecast.map((f) => `${f.day.slice(5)} ${f.count}`).join("  "));
}

async function tune() {
  const coach = await makeCoach();
  const r = tuneCoach(coach);
  if (r.changed) console.log(`調整しました（復習 ${r.reviews} 件、予想のずれ ${r.before.toFixed(4)} → ${r.after.toFixed(4)}）`);
  else console.log(r.reason || `今のパラメータのままが一番合っていました（復習 ${r.reviews} 件）`);
}

async function daily(args) {
  const coach = await makeCoach();
  const r = await runDaily(coach, { force: args.includes("--force") });
  if (r.skipped) console.log(r.reason || `今日 (${r.date}) はもう実行ずみです（--force で再実行）`);
  else {
    process.stdout.write(r.report);
    console.log(`\n保存しました: ${r.file}`);
    if (r.errors.length) process.exitCode = 1;
  }
}

function schedule() {
  const node = process.execPath;
  const script = path.join(ROOT, "bin", "coach.js");
  const env = `COACH_DATA_DIR="${DATA}"`;
  console.log(`毎朝 7:00 に定期実行する設定です。使っている OS のものを1つ選んでください。
（APIキーや Webhook を使うときは、同じように環境変数をつけてください）

■ macOS / Linux（cron）: crontab -e で次の1行を足す
0 7 * * * ${env} "${node}" "${script}" daily >> "${path.join(DATA, "daily.log")}" 2>&1

■ macOS（launchd）: ~/Library/LaunchAgents/local.study-coach.plist を作って launchctl load
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>local.study-coach</string>
  <key>ProgramArguments</key><array><string>${node}</string><string>${script}</string><string>daily</string></array>
  <key>EnvironmentVariables</key><dict><key>COACH_DATA_DIR</key><string>${DATA}</string></dict>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>7</integer><key>Minute</key><integer>0</integer></dict>
  <key>StandardOutPath</key><string>${path.join(DATA, "daily.log")}</string>
  <key>StandardErrorPath</key><string>${path.join(DATA, "daily.log")}</string>
</dict></plist>
（launchd は、スリープ中で時刻をのがしても、起きたときに実行してくれます）

■ Windows（タスク スケジューラ）: コマンドプロンプトで
schtasks /Create /SC DAILY /ST 07:00 /TN "StudyCoach" /TR "\\"${node}\\" \\"${script}\\" daily"

■ どれも使わない場合
\`node bin/coach.js serve\` を動かしておけば、毎日 ${"07:00"} すぎに自動で実行します（時刻は data/config.json の dailyAt）。
同じ日に何回呼ばれても、実行するのは1回だけです。`);
}

const HELP = `使い方: node bin/coach.js <コマンド>
  serve      画面を開く（http://127.0.0.1:4310）
  quiz [n]   ターミナルで n 問
  daily      定期実行を1回（--force で再実行）
  stats      いまのようす
  tune       自分の記録で記憶モデルを調整
  schedule   毎日動かす設定のしかた`;

async function main() {
  const [cmd = "serve", ...args] = process.argv.slice(2);
  const cmds = { serve, quiz: () => quiz(Number(args[0]) || 10), daily: () => daily(args), stats, tune, schedule };
  if (!cmds[cmd]) { console.log(HELP); process.exitCode = cmd === "help" || cmd === "--help" ? 0 : 1; return; }
  await cmds[cmd]();
}

main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
