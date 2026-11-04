// 各ツールの index.html と src/*.js を、それぞれ1つのHTMLファイルにまとめます。
// できたファイルは、ダブルクリックで開くだけで動きます（メール・USBで配ってもOK）。
// 実行: npm run build
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");

const TARGETS = [
  { dir: ".", out: "java-error-yasashiku.html" },
  { dir: "game-lab", out: "game-lab.html" },
];

fs.mkdirSync(path.join(root, "dist"), { recursive: true });
for (const { dir, out } of TARGETS) {
  const base = path.join(root, dir);
  let html = fs.readFileSync(path.join(base, "index.html"), "utf8");
  html = html.replace(/<script src="(src\/[\w.]+\.js)"><\/script>/g, (_, src) => {
    const js = fs.readFileSync(path.join(base, src), "utf8").replace(/<\/script/gi, "<\\/script");
    return `<script>\n/* ${src} */\n${js}\n</script>`;
  });
  const file = path.join(root, "dist", out);
  fs.writeFileSync(file, html);
  console.log("作成しました:", path.relative(root, file), `(${Math.round(html.length / 1024)} KB)`);
}
