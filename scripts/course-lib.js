// course/langs/*.txt を読んで、レッスンごとのデータにします。
//
// 書き方:
//   === 01            レッスン番号
//   title: ...        （言語ごとのレッスンだけ）題名・ねらい・説明・クイズ・課題
//   - ポイント
//   --- main          ここからコード。main は実行するファイル。ほかは「--- greet.py」のようにファイル名を書く
//   --- main 名前      実行するファイルに、別の名前をつける
//   --- shell         実行しないコマンドの一覧
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const LANG_IDS = ["c", "python", "java", "js", "ts", "php", "ruby", "go", "rust"];
const MAIN_FILE = {
  c: "main.c", python: "main.py", java: "Main.java", js: "main.js", ts: "main.ts",
  php: "main.php", ruby: "main.rb", go: "main.go", rust: "main.rs"
};

function parseLang(id) {
  const text = fs.readFileSync(path.join(root, "course", "langs", id + ".txt"), "utf8");
  const lessons = {};
  let cur = null, file = null;
  for (const line of text.split("\n")) {
    let m;
    if ((m = /^=== (\d\d)\s*$/.exec(line))) {
      cur = lessons[m[1]] = { points: [], files: [] }; file = null;
    } else if ((m = /^--- (\S+)(?: (\S+))?\s*$/.exec(line))) {
      // 「--- main 名前」と書くと、実行するファイルに別の名前をつけられる
      file = { name: m[1] === "main" ? (m[2] || MAIN_FILE[id]) : m[1], main: m[1] === "main", shell: m[1] === "shell", lines: [] };
      cur.files.push(file);
    } else if (file) {
      file.lines.push(line);
    } else if (cur) {
      if ((m = /^- (.+)$/.exec(line))) cur.points.push(m[1]);
      else if ((m = /^(title|goal|intro|task|hint|mode): (.+)$/.exec(line))) cur[m[1]] = m[2];
      else if ((m = /^quiz: (.+)$/.exec(line))) {
        const p = m[1].split(" ;; ");   // 質問 ;; 選択肢… ;; 正解の番号 ;; 理由
        cur.quiz = { q: p[0], choices: p.slice(1, -2), answer: Number(p[p.length - 2]) - 1, why: p[p.length - 1] };
      } else if (line.trim()) throw new Error(`${id}.txt: 読めない行です: ${line}`);
    }
  }
  for (const les of Object.values(lessons)) {
    for (const f of les.files) {
      f.code = f.lines.join("\n").replace(/^\n+/, "").replace(/\s+$/, "");
      delete f.lines;
    }
  }
  return lessons;
}

module.exports = { root, LANG_IDS, MAIN_FILE, parseLang };
