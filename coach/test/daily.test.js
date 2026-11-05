const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const { runDaily, isDue, levelFor } = require("../src/daily.js");
const { makeCoach, smallDeck, clock } = require("./helpers.js");

async function makeWeak(coach, tag, n = 4) {
  for (let i = 0; i < n; i++) await coach.answer({ sessionId: "w", itemId: `d/${tag}${i % 2}`, answer: 1, latencyMs: 5000 });
}

test("1日1回: レポートを書き、同じ日の2回目は何もしない（--force なら動く）", async () => {
  const { coach } = makeCoach();
  const r1 = await runDaily(coach, { webhookUrl: "" });
  assert.strictEqual(r1.skipped, false);
  assert.ok(fs.existsSync(r1.file));
  assert.match(r1.report, /## 今日の予定/);
  const r2 = await runDaily(coach, { webhookUrl: "" });
  assert.strictEqual(r2.skipped, true);
  const r3 = await runDaily(coach, { webhookUrl: "", force: true });
  assert.strictEqual(r3.skipped, false);
});

test("苦手な分野で未出題が少ないと、AI に問題を作らせて追加する（おかしい問題は不採用）", async () => {
  const calls = [];
  const ai = {
    enabled: true,
    generateItems: async (o) => {
      calls.push(o);
      return [
        { id: `ai/${o.tag}-1`, tag: o.tag, type: "choice", prompt: `${o.tag} の新問題`, choices: ["p", "q", "r", "s"], answer: 0 },
        { id: `ai/${o.tag}-2`, tag: o.tag, type: "choice", prompt: "こわれた問題", choices: ["p"], answer: 0 },
      ];
    },
    coachMessage: async () => "がんばろう！",
  };
  const { coach } = makeCoach({ deck: smallDeck(2), ai });
  await makeWeak(coach, "b");
  const r = await runDaily(coach, { webhookUrl: "" });
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].tag, "b");
  assert.ok(calls[0].mistakes.length > 0, "まちがえた問題を AI にわたす");
  assert.ok(coach.items.has("ai/b-1"));
  assert.ok(!coach.items.has("ai/b-2"));
  assert.match(r.report, /がんばろう！/);
  assert.match(r.report, /1 問追加（1 問はチェックで不採用）/);
});

test("AI が失敗しても、レポートは作る", async () => {
  const ai = { enabled: true, generateItems: async () => { throw new Error("混み合っています"); }, coachMessage: async () => { throw new Error("x"); } };
  const { coach } = makeCoach({ deck: smallDeck(2), ai });
  await makeWeak(coach, "a");
  const r = await runDaily(coach, { webhookUrl: "" });
  assert.strictEqual(r.skipped, false);
  assert.match(r.report, /うまくいかなかったこと[\s\S]*混み合っています/);
});

test("Webhook に通知する", async () => {
  const { coach } = makeCoach();
  const sent = [];
  await runDaily(coach, { webhookUrl: "https://example.test/hook", fetchImpl: async (url, init) => { sent.push([url, JSON.parse(init.body)]); return { ok: true }; } });
  assert.strictEqual(sent.length, 1);
  assert.match(sent[0][1].content, /学習コーチ/);
  assert.strictEqual(sent[0][1].text, sent[0][1].text);
});

test("serve 中のスケジューラ: 時刻をすぎていて今日まだなら実行", async () => {
  const c = clock(new Date(2026, 10, 5, 6, 59).getTime());
  const { coach } = makeCoach({ c, config: { dailyAt: "07:00" } });
  assert.strictEqual(isDue(coach), false);
  c.advance(60 * 1000);
  assert.strictEqual(isDue(coach), true);
  await runDaily(coach, { webhookUrl: "" });
  assert.strictEqual(isDue(coach), false);
  c.days(1);
  assert.strictEqual(isDue(coach), true, "翌日はまた実行（スリープで時刻をのがしても、起きたら実行）");
});

test("ロック中は実行しない", async () => {
  const { coach } = makeCoach();
  fs.writeFileSync(require("node:path").join(coach.dataDir, "daily.lock"), "999");
  const r = await runDaily(coach, { webhookUrl: "" });
  assert.strictEqual(r.skipped, true);
  assert.match(r.reason, /ほかの定期実行/);
});

test("苦手な分野ほど、やさしい level の問題を作らせる", () => {
  assert.ok(levelFor(1) < levelFor(2));
  assert.ok(levelFor(2) < levelFor(3));
  assert.strictEqual(levelFor(-10), 1);
  assert.strictEqual(levelFor(10), 5);
});
