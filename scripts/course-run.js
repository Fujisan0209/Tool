// 教材のコードをすべて本当に動かして、出力を course/outputs.json に保存します。
// 実行: npm run course:run            （全部）
//       npm run course:run -- python  （1つの言語だけ）
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execSync } = require("node:child_process");
const { root, LANG_IDS, parseLang } = require("./course-lib");

const RUN = {
  c: "gcc -Wall -Wextra -o app *.c && ./app",
  python: "python3 main.py",
  java: "javac -encoding UTF-8 *.java && java -Dstdout.encoding=UTF-8 Main",
  js: "node main.js",
  ts: "node --experimental-strip-types main.ts",
  php: "php main.php",
  ruby: "ruby main.rb",
  go: "if [ -f go.mod ]; then go run .; else go run *.go; fi",
  rust: "rustc -o app main.rs && ./app"
};
// mode: test のレッスン（テストの道具を使う）。時間など毎回変わる部分は取りのぞきます。
const TEST = {
  python: { cmd: "python3 -m unittest -v main 2>&1", fix: s => s.replace(/in \d+\.\d+s/, "in 0.001s") },
  js: { cmd: "node --test --test-reporter=spec main.js 2>&1", fix: nodeTest },
  ts: { cmd: "node --experimental-strip-types --test --test-reporter=spec main.ts 2>&1", fix: nodeTest },
  ruby: { cmd: "ruby main.rb", fix: s => s.split("\n").filter(l => /runs, .*assertions/.test(l)).join("\n") },
  go: { cmd: "go test -v 2>&1", fix: s => s.replace(/\(\d+\.\d+s\)/g, "(0.00s)").replace(/^ok\s+example\s+.*$/m, "ok") },
  rust: { cmd: "rustc --test -o app main.rs && ./app --test-threads=1", fix: s => s.replace(/finished in [\d.]+s/, "finished in 0.00s").replace(/\n{2,}/g, "\n") }
};
function nodeTest(s) {
  return s.split("\n").filter(l => /^[✔✖]|^ℹ (tests|pass|fail) /.test(l)).map(l => l.replace(/ \([\d.]+ms\)/, "")).join("\n");
}

const outFile = path.join(root, "course", "outputs.json");
const outputs = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, "utf8")) : {};
const only = process.argv.slice(2);
let failed = 0, ran = 0;
const env = { ...process.env, LC_ALL: "C.UTF-8", NO_COLOR: "1", FORCE_COLOR: "0" };
delete env.JAVA_TOOL_OPTIONS;

for (const id of LANG_IDS) {
  if (only.length && !only.includes(id)) continue;
  const lessons = parseLang(id);
  for (const [no, les] of Object.entries(lessons)) {
    const key = `${id}/${no}`;
    if (!les.files.some(f => f.main)) { delete outputs[key]; continue; }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `course-${id}-${no}-`));
    for (const f of les.files) {
      fs.mkdirSync(path.dirname(path.join(dir, f.name)), { recursive: true });
      fs.writeFileSync(path.join(dir, f.name), f.code + "\n");
    }
    const t = les.mode === "test" ? TEST[id] : null;
    try {
      let out = execSync(t ? t.cmd : RUN[id], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env });
      if (t) out = t.fix(out);
      outputs[key] = out.replace(/^\n+/, "").replace(/\s+$/, "");
      ran++;
    } catch (e) {
      failed++;
      console.error(`✖ ${key}\n${e.stdout || ""}${e.stderr || e.message}`);
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(`${id}: ${Object.keys(lessons).length} レッスン`);
}
fs.writeFileSync(outFile, JSON.stringify(outputs, null, 1) + "\n");
console.log(`実行: ${ran}  失敗: ${failed}`);
process.exit(failed ? 1 : 0);
