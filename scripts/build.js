// それぞれのツールの index.html と src/*.js を、1つのHTMLファイルにまとめます。
// できたファイルは、ダブルクリックで開くだけで動きます（メール・USBで配ってもOK）。
// 実行: npm run build
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");

const TARGETS = [
  { dir: ".", out: "dist/java-error-yasashiku.html" },
  { dir: "api-test-gen", out: "dist/api-test-gen.html", before: buildExamples },
];

// API テスト自動生成: examples/ の仕様書を、画面の「サンプル」用の JS にする
function buildExamples(dir) {
  const ex = (name) => fs.readFileSync(path.join(dir, "examples", name), "utf8");
  const data = { library: ex("library.yaml"), todo: ex("todo-swagger2.yaml") };
  const js =
    "// このファイルは npm run build で examples/ から作られます。直接書きかえないでください。\n" +
    "(function (root) {\n" +
    `  (root.ApiTestGen = root.ApiTestGen || {}).examples = ${JSON.stringify(data, null, 2).replace(/\n/g, "\n  ")};\n` +
    "})(typeof globalThis !== \"undefined\" ? globalThis : this);\n";
  fs.writeFileSync(path.join(dir, "src", "examples.js"), js);
}

for (const t of TARGETS) {
  const dir = path.join(root, t.dir);
  if (t.before) t.before(dir);
  let html = fs.readFileSync(path.join(dir, "index.html"), "utf8");
  html = html.replace(/<script src="(src\/[\w./-]+\.js)"><\/script>/g, (_, src) => {
    const js = fs.readFileSync(path.join(dir, src), "utf8").replace(/<\/script/gi, "<\\/script");
    return `<script>\n/* ${src} */\n${js}\n</script>`;
  });
  const out = path.join(root, t.out);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html);
  console.log("作成しました:", path.relative(root, out), `(${Math.round(html.length / 1024)} KB)`);
}
