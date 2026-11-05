/*
 * 記録の保存
 *
 * いちばん大事な決まり: 「起きたこと」だけを、追記専用のログ（data/events.jsonl）に1行ずつ書く。
 * 記憶の強さや苦手度などの「状態」は保存しません。起動するたびにログを最初から再生して計算します。
 *
 *   - あとからアルゴリズムやパラメータを変えても、過去の記録から全部計算しなおせる
 *   - 自分の記録に合わせてパラメータを調整（tune）できる
 *   - 途中で落ちても、こわれるのは最後の1行だけ（読みとばす）
 *   - 1行 = 1つのJSON なので、テキストエディタや表計算でも読める
 *
 * イベントの種類（すべて id, at(ISO時刻), type を持つ）
 *   attempt   1回答えた      { itemId, rev, sessionId, answer, correct, score, grade, latencyMs, hintUsed, gradedBy, feedback? }
 *   override  評価をなおした  { attemptId, grade }        … 「まぐれ当たりだった」など
 *   suspend   問題を止めた    { itemId, on }              … 「この問題はおかしい」
 *   item      問題を追加した  { item }                    … AI が作った問題
 *   params    パラメータ更新  { w, logLossBefore, logLossAfter, reviews }
 *   daily     定期実行した    { date, dueCount, generated }
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

class EventLog {
  constructor(file) {
    this.file = file;
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }

  /** すべてのイベントを読みます。読めない行（書きかけ・手で壊した行）は数だけ数えて飛ばします */
  readAll() {
    if (!fs.existsSync(this.file)) return { events: [], skipped: 0 };
    const events = [];
    let skipped = 0;
    for (const line of fs.readFileSync(this.file, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const ev = JSON.parse(line);
        if (ev && typeof ev.type === "string" && typeof ev.at === "string") events.push(ev);
        else skipped++;
      } catch {
        skipped++;
      }
    }
    return { events, skipped };
  }

  /** 1件追記して、id と at をつけたイベントを返します */
  append(ev, now = Date.now()) {
    const full = { id: crypto.randomUUID(), at: new Date(now).toISOString(), ...ev };
    let prefix = "";
    if (fs.existsSync(this.file)) {
      const size = fs.statSync(this.file).size;
      if (size > 0) {
        const fd = fs.openSync(this.file, "r");
        const b = Buffer.alloc(1);
        fs.readSync(fd, b, 0, 1, size - 1);
        fs.closeSync(fd);
        if (b[0] !== 0x0a) prefix = "\n"; // 前回が書きかけで終わっていたら、行を分ける
      }
    }
    fs.appendFileSync(this.file, prefix + JSON.stringify(full) + "\n");
    return full;
  }
}

/** 問題の内容から作る短い指紋。問題を書きかえたかどうかを、記録からあとで見分けられます */
function revOf(item) {
  const core = JSON.stringify([item.type, item.prompt, item.code, item.choices, item.answer, item.answers]);
  return crypto.createHash("sha1").update(core).digest("hex").slice(0, 8);
}

/**
 * 問題を1つ確かめて、足りないところを補います。おかしければ Error を投げます。
 * 問題集のファイルでも、AI が作った問題でも、同じチェックを通します。
 */
function validateItem(raw, where = "") {
  const err = (m) => { throw new Error(`${where}${raw && raw.id ? ` (${raw.id})` : ""}: ${m}`); };
  if (!raw || typeof raw !== "object") err("問題がオブジェクトではありません");
  if (!raw.id || typeof raw.id !== "string") err("id がありません");
  if (!raw.tag || typeof raw.tag !== "string") err("tag（分野）がありません");
  if (!raw.prompt || typeof raw.prompt !== "string") err("prompt（問題文）がありません");
  const item = {
    id: raw.id, tag: raw.tag, type: raw.type || "choice", prompt: raw.prompt.trim(),
    code: raw.code || undefined, explanation: raw.explanation || "", hint: raw.hint || undefined,
    level: Number.isFinite(raw.level) ? Math.min(5, Math.max(1, raw.level)) : 2,
    timeSec: raw.timeSec, source: raw.source || "deck",
  };
  if (item.type === "choice") {
    if (!Array.isArray(raw.choices) || raw.choices.length < 2) err("choices（選択肢）が2つ以上必要です");
    const choices = raw.choices.map((c) => String(c));
    if (new Set(choices).size !== choices.length) err("同じ選択肢があります");
    if (!Number.isInteger(raw.answer) || raw.answer < 0 || raw.answer >= choices.length) err("answer が選択肢の番号になっていません");
    item.choices = choices;
    item.answer = raw.answer;
  } else if (item.type === "input") {
    const answers = (Array.isArray(raw.answers) ? raw.answers : [raw.answer]).filter((a) => typeof a === "string" && a.trim());
    if (!answers.length) err("answers（正解の書き方）がありません");
    item.answers = answers;
    item.ignoreCase = !!raw.ignoreCase;
  } else if (item.type === "free") {
    if (!raw.model || typeof raw.model !== "string") err("model（模範解答）がありません");
    item.model = raw.model;
    item.rubric = raw.rubric || undefined;
  } else {
    err(`type は choice / input / free のどれかです（${item.type}）`);
  }
  item.rev = revOf(item);
  return item;
}

/**
 * 問題集（*.json）を読みます。
 * 形: { id, title, tags: { tagId: "表示名" }, items: [ { id, tag, type, prompt, ... } ] }
 * 問題の id は「問題集id/問題id」になります。
 */
function loadDecks(dirs) {
  const items = [];
  const tagLabels = new Map();
  const decks = [];
  for (const dir of dirs) {
    if (!dir || !fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
      const file = path.join(dir, f);
      const deck = JSON.parse(fs.readFileSync(file, "utf8"));
      const deckId = deck.id || path.basename(f, ".json");
      for (const [t, label] of Object.entries(deck.tags || {})) tagLabels.set(t, label);
      const seen = new Set();
      for (const raw of deck.items || []) {
        const item = validateItem({ ...raw, id: `${deckId}/${raw.id}` }, f);
        if (seen.has(item.id)) throw new Error(`${f}: id が重複しています (${item.id})`);
        seen.add(item.id);
        item.deck = deckId;
        items.push(item);
      }
      decks.push({ id: deckId, title: deck.title || deckId, count: seen.size });
    }
  }
  return { items, tagLabels, decks };
}

module.exports = { EventLog, loadDecks, validateItem, revOf };
