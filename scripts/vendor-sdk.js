// Anthropic の公式 SDK（@anthropic-ai/sdk）を、ブラウザでそのまま読める1ファイルにまとめます。
// できたファイル（spring-test-gen/vendor/anthropic-sdk.js）はリポジトリに入れてあるので、
// SDK のバージョンを上げるときだけ実行してください。  実行: npm run vendor
const path = require("node:path");
const esbuild = require("esbuild");
const root = path.join(__dirname, "..");
const pkg = JSON.parse(require("node:fs").readFileSync(path.join(root, "node_modules/@anthropic-ai/sdk/package.json"), "utf8"));
esbuild
  .build({
    stdin: {
      contents: 'import Anthropic from "@anthropic-ai/sdk"; globalThis.AnthropicSDK = Anthropic;',
      resolveDir: root,
      loader: "js",
    },
    bundle: true,
    minify: true,
    format: "iife",
    platform: "browser",
    target: ["es2020"],
    legalComments: "eof",
    banner: { js: `/* @anthropic-ai/sdk ${pkg.version} (MIT) — npm run vendor で作成 */` },
    outfile: path.join(root, "spring-test-gen", "vendor", "anthropic-sdk.js"),
  })
  .then(() => console.log("作成しました: spring-test-gen/vendor/anthropic-sdk.js", pkg.version))
  .catch(() => process.exit(1));
