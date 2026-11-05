// index.html・live.html と src/*.js を、それぞれ1つのHTMLファイルにまとめます。
// できたファイルは、ダブルクリックで開くだけで動きます（メール・USBで配ってもOK）。
// 実行: npm run build
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");

const PAGES = [
  ["index.html", "java-error-yasashiku.html"],
  ["live.html", "java-sonoba-check.html"],
];

fs.mkdirSync(path.join(root, "dist"), { recursive: true });
for (const [from, to] of PAGES) {
  let html = fs.readFileSync(path.join(root, from), "utf8");
  html = html.replace(/<script src="(src\/[\w.-]+\.js)"><\/script>/g, (_, src) => {
    const js = fs.readFileSync(path.join(root, src), "utf8").replace(/<\/script/gi, "<\\/script");
    return `<script>\n/* ${src} */\n${js}\n</script>`;
  });
  const out = path.join(root, "dist", to);
  fs.writeFileSync(out, html);
  console.log("作成しました:", path.relative(root, out), `(${Math.round(html.length / 1024)} KB)`);
}
