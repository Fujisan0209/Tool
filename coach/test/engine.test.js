const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { Coach } = require("../src/engine.js");
const { makeCoach, smallDeck, clock, seededRng } = require("./helpers.js");

async function answerNext(coach, correct, session = "s", latencyMs = 8000) {
  const q = coach.next(session);
  const r = await coach.answer({ sessionId: session, itemId: q.item.id, answer: correct ? 0 : 1, latencyMs });
  return { q, r };
}

test("出す問題には答えを入れない", () => {
  const { coach } = makeCoach();
  const q = coach.next("s");
  assert.strictEqual(q.item.answer, undefined);
  assert.strictEqual(q.item.explanation, undefined);
  assert.ok(q.item.choices);
});

test("答えるとログに1行ふえ、読みなおしても同じ状態になる（状態は保存せずログから再生）", async () => {
  const { coach, root, c } = makeCoach();
  for (let i = 0; i < 5; i++) await answerNext(coach, i % 2 === 0);
  c.days(3);
  for (let i = 0; i < 3; i++) await answerNext(coach, true, "s2");
  const lines = fs.readFileSync(path.join(root, "data", "events.jsonl"), "utf8").trim().split("\n");
  assert.strictEqual(lines.length, 8);
  const again = new Coach({ dataDir: path.join(root, "data"), deckDirs: [path.join(root, "decks")], clock: c, rng: seededRng(1) });
  assert.deepStrictEqual([...again.cards.entries()], [...coach.cards.entries()]);
  assert.deepStrictEqual(again.dashboard().tags, coach.dashboard().tags);
});

test("ログの最後の行がこわれていても読める。次の追記は新しい行から", async () => {
  const { coach, root, c } = makeCoach();
  await answerNext(coach, true);
  const file = path.join(root, "data", "events.jsonl");
  fs.appendFileSync(file, '{"type":"attempt","itemId":"d/a1"'); // 書きかけで落ちた
  const again = new Coach({ dataDir: path.join(root, "data"), deckDirs: [path.join(root, "decks")], clock: c });
  assert.strictEqual(again.skippedLines, 1);
  assert.strictEqual(again.attempts.length, 1);
  await answerNext(again, true);
  const fresh = new Coach({ dataDir: path.join(root, "data"), deckDirs: [path.join(root, "decks")], clock: c });
  assert.strictEqual(fresh.attempts.length, 2);
  assert.strictEqual(fresh.skippedLines, 1);
});

test("何日もたつと復習が出る。まちがえた問題は同じセッションでもう一度出る", async () => {
  const { coach, c } = makeCoach();
  const first = await answerNext(coach, false);
  for (let i = 0; i < 3; i++) await answerNext(coach, true);
  const q = coach.next("s");
  assert.strictEqual(q.item.id, first.q.item.id);
  assert.strictEqual(q.kind, "relearn");
  c.days(20);
  const later = coach.next("new-session");
  assert.strictEqual(later.kind, "due");
});

test("1日の新しい問題の上限を守り、日がかわるとまた出る", async () => {
  const { coach, c } = makeCoach({ config: { newPerDay: 2 } });
  await answerNext(coach, true);
  await answerNext(coach, true);
  assert.strictEqual(coach.dashboard().today.newLeft, 0);
  const q = coach.next("s");
  assert.ok(q === null || q.kind !== "new");
  c.days(1);
  assert.strictEqual(coach.dashboard().today.newLeft, 2);
});

test("「まぐれだった」で評価をなおすと、安定度も苦手度も計算しなおす", async () => {
  const { coach } = makeCoach();
  const { q, r } = await answerNext(coach, true);
  const before = coach.cards.get(q.item.id).s;
  coach.override(r.attemptId, 1);
  assert.ok(coach.cards.get(q.item.id).s < before);
  assert.ok(coach.elo.mastery(q.item.tag) < 0.5);
});

test("おかしい問題を止めると出なくなり、もどすとまた出る", () => {
  const { coach } = makeCoach({ deck: smallDeck(1, ["a"]) });
  coach.suspend("d/a0");
  assert.strictEqual(coach.next("s"), null);
  coach.suspend("d/a0", false);
  assert.strictEqual(coach.next("s").item.id, "d/a0");
});

test("問題の追加: チェックを通ったものだけ。同じ問題文は追加しない", () => {
  const { coach } = makeCoach();
  const { added, rejected } = coach.addItems([
    { id: "ai/x1", tag: "a", type: "choice", prompt: "新しい問題", choices: ["p", "q"], answer: 1 },
    { id: "ai/x2", tag: "a", type: "choice", prompt: "答えの番号がおかしい", choices: ["p", "q"], answer: 5 },
    { id: "ai/x3", tag: "a", type: "choice", prompt: "a の問題 0", choices: ["p", "q"], answer: 0 },
    { id: "ai/x4", tag: "a", type: "input", prompt: "答えがない", answers: [] },
  ]);
  assert.deepStrictEqual(added.map((a) => a.id), ["ai/x1"]);
  assert.strictEqual(rejected.length, 3);
  assert.strictEqual(coach.items.get("ai/x1").source, "ai");
});

test("記述問題: AI がなければ模範解答を見せて自己採点", async () => {
  const deck = { id: "d", tags: { a: "A" }, items: [{ id: "f", tag: "a", type: "free", prompt: "説明して", model: "模範" }] };
  const { coach } = makeCoach({ deck });
  const r1 = await coach.answer({ itemId: "d/f", answer: "こたえ" });
  assert.deepStrictEqual(r1, { needsSelf: true, model: "模範" });
  assert.strictEqual(coach.attempts.length, 0, "採点が決まるまで記録しない");
  const r2 = await coach.answer({ itemId: "d/f", answer: "こたえ", selfScore: 0.5 });
  assert.strictEqual(r2.gradedBy, "self");
  assert.strictEqual(r2.grade, 2);
});

test("記述問題: AI があれば AI が採点", async () => {
  const deck = { id: "d", tags: { a: "A" }, items: [{ id: "f", tag: "a", type: "free", prompt: "説明して", model: "模範" }] };
  const ai = { enabled: true, gradeFree: async () => ({ score: 0.9, feedback: "よくできました" }) };
  const { coach } = makeCoach({ deck, ai });
  const r = await coach.answer({ itemId: "d/f", answer: "こたえ", latencyMs: 60000 });
  assert.strictEqual(r.correct, true);
  assert.strictEqual(r.gradedBy, "ai");
  assert.strictEqual(r.feedback, "よくできました");
});

test("ダッシュボード: 連続日数・予報・苦手", async () => {
  const { coach, c } = makeCoach();
  for (let d = 0; d < 3; d++) {
    for (let i = 0; i < 4; i++) await answerNext(coach, true, `day${d}`);
    c.days(1);
  }
  c.advance(-86400000 + 3600000); // 最後の日の中にもどる
  const dash = coach.dashboard();
  assert.strictEqual(dash.streak, 3);
  assert.strictEqual(dash.forecast.length, 7);
  assert.strictEqual(dash.history.length, 14);
  assert.strictEqual(dash.totals.attempts, 12);
});

test("同梱の問題集（Java の基本）が読める", () => {
  const { loadDecks } = require("../src/store.js");
  const { items, tagLabels } = loadDecks([path.join(__dirname, "..", "decks")]);
  assert.ok(items.length >= 40);
  for (const it of items) assert.ok(tagLabels.has(it.tag), `${it.id} の分野名がない`);
});
