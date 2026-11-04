// eeg-vowel/index.html・src/*.js・data/*.json を1つのHTMLファイルにまとめます。
// できた dist/eeg-vowel.html はダブルクリックで開くだけで動きます（サーバー不要）。
// 実行: npm run build:eeg
const fs = require("node:fs");
const path = require("node:path");
const here = __dirname;
const root = path.join(here, "..");
let html = fs.readFileSync(path.join(here, "index.html"), "utf8");
html = html.replace(/<script src="(src\/[\w.]+\.js)"><\/script>/g, (_, src) => {
  const js = fs.readFileSync(path.join(here, src), "utf8").replace(/<\/script/gi, "<\\/script");
  return `<script>\n/* ${src} */\n${js}\n</script>`;
});
const data = {
  results: JSON.parse(fs.readFileSync(path.join(here, "data", "results.json"), "utf8")),
  demo: JSON.parse(fs.readFileSync(path.join(here, "data", "demo.json"), "utf8")),
};
const json = JSON.stringify(data).replace(/</g, "\\u003c");
html = html.replace('<script>\n/* src/features.js */', `<script type="application/json" id="eeg-data">${json}</script>\n<script>\n/* src/features.js */`);
fs.mkdirSync(path.join(root, "dist"), { recursive: true });
const out = path.join(root, "dist", "eeg-vowel.html");
fs.writeFileSync(out, html);
console.log("作成しました:", path.relative(root, out), `(${(html.length / 1024 / 1024).toFixed(1)} MB)`);
// Artifact 用（<!-- artifact:start --> から end まで）。引数でパスを渡したときだけ書き出す
if (process.argv[2]) {
  const m = html.match(/<!-- artifact:start -->([\s\S]*)<!-- artifact:end -->/);
  fs.writeFileSync(process.argv[2], m[1].trim() + "\n");
  console.log("Artifact 用:", process.argv[2]);
}
