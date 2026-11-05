const test = require("node:test");
const assert = require("node:assert");
const { selectNext, scoreCandidates } = require("../src/selector.js");
const { EloModel } = require("../src/mastery.js");
const { seededRng } = require("./helpers.js");

const DAY = 86400000;
const NOW = Date.parse("2026-11-05T10:00:00");
const cfg = { targetRetention: 0.9, newPerDay: 10, relearnGap: 3, cooldown: 4 };
const items = ["a", "b", "c"].flatMap((t) => [0, 1, 2].map((i) => ({ id: `${t}${i}`, tag: t, type: "choice", level: i + 1 })));
const ctx = (over = {}) => ({ items, cards: new Map(), elo: new EloModel(), now: NOW, config: cfg, newToday: 0, session: [], rng: seededRng(3), ...over });

test("思い出せる確率が目標を下まわった問題（復習）は、新しい問題より先", () => {
  const cards = new Map([["c2", { s: 2, d: 5, last: NOW - 10 * DAY }]]);
  const pick = selectNext(ctx({ cards }));
  assert.strictEqual(pick.item.id, "c2");
  assert.strictEqual(pick.kind, "due");
  assert.match(pick.reason, /復習/);
});

test("復習は、忘れかけているものから", () => {
  const cards = new Map([
    ["a0", { s: 5, d: 5, last: NOW - 7 * DAY }], // R ≈ 0.87
    ["b0", { s: 5, d: 5, last: NOW - 40 * DAY }], // R ≈ 0.6
  ]);
  assert.strictEqual(selectNext(ctx({ cards })).item.id, "b0");
});

test("まだ覚えている問題は出さず、新しい問題を出す。1日の上限をこえたら新しい問題は出さない", () => {
  const cards = new Map([["a0", { s: 30, d: 5, last: NOW - DAY }]]);
  assert.strictEqual(selectNext(ctx({ cards })).kind, "new");
  const kinds = scoreCandidates(ctx({ cards, newToday: 10 })).map((c) => c.kind);
  assert.ok(!kinds.includes("new"));
  assert.deepStrictEqual([...new Set(kinds)], ["practice"], "上限後は おさらい だけ");
});

test("間違えた問題は、ほかの問題を relearnGap 問はさんでから、もう一度出す", () => {
  const session = [{ itemId: "a0", tag: "a", correct: false }, { itemId: "b0", tag: "b", correct: true }, { itemId: "c0", tag: "c", correct: true }];
  assert.ok(!scoreCandidates(ctx({ session })).some((c) => c.item.id === "a0"), "まだ早い");
  session.push({ itemId: "b1", tag: "b", correct: true });
  const pick = selectNext(ctx({ session }));
  assert.strictEqual(pick.item.id, "a0");
  assert.strictEqual(pick.kind, "relearn");
});

test("同じ分野がつづかないように、まぜて出す", () => {
  const session = [{ itemId: "a0", tag: "a", correct: true }];
  assert.notStrictEqual(selectNext(ctx({ session })).item.tag, "a");
});

test("苦手な分野の新しい問題を優先し、その中でもやさしめの問題を選ぶ", () => {
  const elo = new EloModel();
  Object.assign(elo.tag("b"), { theta: -1.5, n: 6 });
  Object.assign(elo.tag("a"), { theta: 1.0, n: 6 });
  const pick = selectNext(ctx({ elo }));
  assert.strictEqual(pick.item.tag, "b");
  assert.strictEqual(pick.item.id, "b0", "いちばんやさしい level 1");
  assert.match(pick.reason, /苦手/);
});

test("ちょうどよい難しさ: 正解できそうな確率が 75% に近い新問題が選ばれやすい", () => {
  const elo = new EloModel();
  Object.assign(elo.tag("a"), { theta: 1.7, n: 3 }); // level3 (b=0.6) で P≈0.75
  const only = items.filter((i) => i.tag === "a");
  const pick = selectNext(ctx({ elo, items: only }));
  assert.strictEqual(pick.item.id, "a2");
});

test("出せる問題がないときは null", () => {
  const cards = new Map(items.map((i) => [i.id, { s: 100, d: 5, last: NOW }]));
  const session = items.slice(0, 5).map((i) => ({ itemId: i.id, tag: i.tag, correct: true }));
  const rest = items.slice(5).map((i) => ({ itemId: i.id, tag: i.tag, correct: true }));
  assert.strictEqual(selectNext(ctx({ cards, session: [...session, ...rest] })), null);
});
