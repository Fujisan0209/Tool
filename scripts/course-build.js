// course/ の教材を、1つのHTMLファイル（dist/ichininmae.html）にまとめます。
// 実行: npm run course:build
// コードを書きかえたときは、先に npm run course:run で出力を取りなおしてください。
const fs = require("node:fs");
const path = require("node:path");
const { root, parseLang } = require("./course-lib");
const { STAGES, LESSONS } = require("../course/curriculum");
const LANGS = require("../course/langs");

const TEST_CMD = {
  python: "python3 -m unittest -v main", js: "node --test main.js", ts: "npx tsx --test main.ts",
  ruby: "ruby main.rb", go: "go test -v", rust: "rustc --test main.rs -o tests && ./tests",
};

// そのレッスンのコードを動かすコマンド
function runCommand(lang, les) {
  if (les.mode === "test") return TEST_CMD[lang.id];
  const names = les.files.map(f => f.name);
  if (lang.id === "c" && names.length > 1) {
    return `gcc -Wall ${names.filter(n => n.endsWith(".c")).reverse().join(" ")} -o main && ./main`;
  }
  if (lang.id === "java" && names.length > 1) return "javac *.java && java Main";
  if (names.includes("go.mod")) return "go run .";
  return lang.run;
}

function buildData() {
  const outputs = JSON.parse(fs.readFileSync(path.join(root, "course", "outputs.json"), "utf8"));
  const order = STAGES.flatMap(s => s.lessons);
  const langs = LANGS.map(lang => {
    const lessons = parseLang(lang.id);
    for (const no of order) {
      const les = lessons[no];
      if (!les) throw new Error(`${lang.id}: レッスン ${no} がありません`);
      if (!les.points.length) throw new Error(`${lang.id}/${no}: ポイントがありません`);
      if (LESSONS[no].special && !(les.title && les.goal && les.intro && les.quiz && les.task && les.hint)) {
        throw new Error(`${lang.id}/${no}: title / goal / intro / quiz / task / hint が必要です`);
      }
      if (les.files.some(f => f.main)) {
        const out = outputs[`${lang.id}/${no}`];
        if (out == null) throw new Error(`${lang.id}/${no}: 出力がありません。npm run course:run を実行してください`);
        les.output = out;
        les.run = runCommand(lang, les);
      }
    }
    return { ...lang, lessons };
  });
  return { stages: STAGES, lessons: LESSONS, langs };
}

function buildHTML() {
  const template = fs.readFileSync(path.join(root, "course", "template.html"), "utf8");
  // <script> の中に入れるので、< を < にして、タグとまちがわれないようにする
  const json = JSON.stringify(buildData()).replace(/</g, "\\u003c");
  if (!template.includes("/*__DATA__*/null")) throw new Error("template.html に /*__DATA__*/null がありません");
  return template.replace("/*__DATA__*/null", () => json);
}

module.exports = { buildData, buildHTML };

if (require.main === module) {
  const html = buildHTML();
  fs.mkdirSync(path.join(root, "dist"), { recursive: true });
  const out = path.join(root, "dist", "ichininmae.html");
  fs.writeFileSync(out, html);
  console.log("作成しました:", path.relative(root, out), `(${Math.round(Buffer.byteLength(html) / 1024)} KB)`);
}
