// 各ツールの index.html と、そこから読みこむ .js を1つのHTMLファイルにまとめます。
// できたファイルは、ダブルクリックで開くだけで動きます（メール・USBで配ってもOK）。
// 実行: npm run build
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");

const TOOLS = [
  { dir: ".", out: "java-error-yasashiku.html" },
  { dir: "spring-test-gen", out: "spring-test-gen.html" },
];

fs.mkdirSync(path.join(root, "dist"), { recursive: true });
for (const t of TOOLS) {
  const base = path.join(root, t.dir);
  let html = fs.readFileSync(path.join(base, "index.html"), "utf8");
  html = html.replace(/<script src="((?:src|vendor)\/[\w.-]+\.js)"><\/script>/g, (_, src) => {
    const js = fs.readFileSync(path.join(base, src), "utf8").replace(/<\/script/gi, "<\\/script");
    return `<script>\n/* ${src} */\n${js}\n</script>`;
  });
  const out = path.join(root, "dist", t.out);
  fs.writeFileSync(out, html);
  console.log("作成しました:", path.relative(root, out), `(${Math.round(html.length / 1024)} KB)`);
}
