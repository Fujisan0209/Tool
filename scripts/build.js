// 画面の HTML と src/*.js を、1つの HTML ファイルにまとめます。
// できたファイルは、ダブルクリックで開くだけで動きます（メール・USBで配ってもOK）。
// 実行: npm run build
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");

const TARGETS = [
  { html: "index.html", out: "dist/java-error-yasashiku.html" },
  { html: "spec-check/index.html", out: "dist/spec-zure-checker.html" },
];

fs.mkdirSync(path.join(root, "dist"), { recursive: true });
for (const t of TARGETS) {
  const dir = path.dirname(path.join(root, t.html));
  let html = fs.readFileSync(path.join(root, t.html), "utf8");
  html = html.replace(/<script src="(src\/[\w.]+\.js)"><\/script>/g, (_, src) => {
    const js = fs.readFileSync(path.join(dir, src), "utf8").replace(/<\/script/gi, "<\\/script");
    return `<script>\n/* ${src} */\n${js}\n</script>`;
  });
  const out = path.join(root, t.out);
  fs.writeFileSync(out, html);
  console.log("作成しました:", path.relative(root, out), `(${Math.round(html.length / 1024)} KB)`);
}
