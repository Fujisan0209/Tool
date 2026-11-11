// 「一人前ロードマップ」の教材がそろっているか、配布用のHTMLが最新かを確かめる
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { buildData, buildHTML } = require("../scripts/course-build");

const data = buildData();
const order = data.stages.flatMap(s => s.lessons);

test("9つの言語に、18 レッスンずつある", () => {
  assert.strictEqual(data.langs.length, 9);
  assert.strictEqual(order.length, 18);
  for (const lang of data.langs) {
    assert.deepStrictEqual(Object.keys(lang.lessons).sort(), [...order].sort(), lang.id);
  }
});

test("動かせるコードには、実際に動かした結果がついている", () => {
  for (const lang of data.langs) {
    for (const no of order) {
      const les = lang.lessons[no];
      const runnable = les.files.some(f => f.main);
      assert.ok(runnable || les.files.every(f => f.shell), `${lang.id}/${no}: 実行するファイルがありません`);
      if (runnable) assert.ok(les.output.length > 0, `${lang.id}/${no}: 出力が空です`);
    }
  }
});

test("クイズの正解が、選択肢の中にある", () => {
  for (const lang of data.langs) {
    for (const no of order) {
      const quiz = lang.lessons[no].quiz || data.lessons[no].quiz;
      assert.strictEqual(quiz.choices.length, 3, `${lang.id}/${no}`);
      assert.ok(quiz.why.length > 10, `${lang.id}/${no}`);
      assert.ok(quiz.answer >= 0 && quiz.answer < quiz.choices.length, `${lang.id}/${no}`);
    }
  }
});

test("dist/ichininmae.html が最新（npm run course:build 済み）", () => {
  const file = path.join(__dirname, "..", "dist", "ichininmae.html");
  assert.strictEqual(fs.readFileSync(file, "utf8"), buildHTML());
});
