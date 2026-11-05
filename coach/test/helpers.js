// テスト用の道具: 一時フォルダ・動かせる時計・決まった乱数・小さな問題集
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Coach } = require("../src/engine.js");

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "coach-test-"));
}

function clock(start = Date.parse("2026-11-05T10:00:00")) {
  let t = start;
  const c = () => t;
  c.advance = (ms) => { t += ms; };
  c.days = (d) => { t += d * 86400000; };
  c.set = (ms) => { t = ms; };
  return c;
}

function seededRng(seed = 1) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

function writeDeck(dir, deck) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${deck.id}.json`), JSON.stringify(deck));
}

/** タグ a, b, c に choice 問題を n 問ずつ */
function smallDeck(n = 4, tags = ["a", "b", "c"]) {
  const items = [];
  for (const t of tags) for (let i = 0; i < n; i++) items.push({ id: `${t}${i}`, tag: t, prompt: `${t} の問題 ${i}`, choices: ["x", "y", "z"], answer: 0, level: 2 });
  return { id: "d", title: "テスト", tags: Object.fromEntries(tags.map((t) => [t, `分野${t}`])), items };
}

function makeCoach({ deck = smallDeck(), c = clock(), ai = null, config = {} } = {}) {
  const root = tmpdir();
  writeDeck(path.join(root, "decks"), deck);
  const coach = new Coach({ dataDir: path.join(root, "data"), deckDirs: [path.join(root, "decks")], clock: c, rng: seededRng(7), ai, config });
  return { coach, root, c };
}

module.exports = { tmpdir, clock, seededRng, writeDeck, smallDeck, makeCoach };
