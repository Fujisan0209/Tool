// 実行: npm test
const test = require("node:test");
const assert = require("node:assert");
const P = require("../src/prompts.js");
const C = require("../src/core.js");

const S4 = { boot: "4", style: "slice", basePackage: "com.example.library" };

// ---------------------------------------------------------------- プロンプト

test("system は設定が同じなら毎回同じ文字列（キャッシュが効く）", () => {
  assert.strictEqual(P.buildSystem(S4), P.buildSystem({ ...S4 }));
  assert.notStrictEqual(P.buildSystem(S4), P.buildSystem({ ...S4, boot: "3.4" }));
});

test("Boot 4 の system は新しいパッケージと @MockitoBean を指示する", () => {
  const s = P.buildSystem(S4);
  assert.match(s, /org\.springframework\.boot\.webmvc\.test\.autoconfigure\.WebMvcTest/);
  assert.match(s, /@MockitoBean/);
  assert.doesNotMatch(s, /`org\.springframework\.boot\.test\.autoconfigure\.web\.servlet\.WebMvcTest`/);
});

test("Boot 3.0 の system は @MockBean と古いパッケージ", () => {
  const s = P.buildSystem({ ...S4, boot: "3.0" });
  assert.match(s, /org\.springframework\.boot\.test\.autoconfigure\.web\.servlet\.WebMvcTest/);
  assert.match(s, /org\.springframework\.boot\.test\.mock\.mockito\.MockBean/);
});

test("結合テストの方式では @SpringBootTest を指示する", () => {
  const s = P.buildSystem({ ...S4, style: "integration" });
  assert.match(s, /SpringBootTest/);
  assert.match(s, /AutoConfigureMockMvc/);
});

test("仕様書ブロックは、コードがあるときだけ existing_code を付ける", () => {
  assert.doesNotMatch(P.buildSpecBlock("spec", ""), /existing_code/);
  assert.match(P.buildSpecBlock("spec", "class A {}"), /<existing_code>[\s\S]*class A \{\}/);
});

test("コードづくりのお願いに、観点ID・パス・件数が入る", () => {
  const cases = [
    { id: "C001", method: "GET", path: "/api/books/{id}", category: "normal", title: "取得できる", given: "", request: "", expectStatus: 200, expect: "title", basis: "spec", specRef: "1." },
    { id: "C002", method: "GET", path: "/api/books/{id}", category: "notfound", title: "404", given: "", request: "", expectStatus: 404, expect: "", basis: "assumption", specRef: "" },
  ];
  const t = P.buildCodeTask(S4, { className: "BookControllerTest", target: "BookController" }, cases);
  assert.match(t, /src\/test\/java\/com\/example\/library\/BookControllerTest\.java/);
  assert.match(t, /\[C001\] 取得できる/);
  assert.match(t, /\[C002\] 404（推測）/);
  assert.match(t, /2 件/);
});

test("観点のスキーマ: 全部の項目が required で、余計な項目を許さない", () => {
  const item = P.PLAN_SCHEMA.properties.cases.items;
  assert.strictEqual(item.additionalProperties, false);
  assert.deepStrictEqual([...item.required].sort(), Object.keys(item.properties).sort());
  assert.deepStrictEqual([...P.PLAN_SCHEMA.required].sort(), Object.keys(P.PLAN_SCHEMA.properties).sort());
});

// ---------------------------------------------------------------- 観点を読む

test("parsePlan: 前後に文があっても JSON を読む", () => {
  const text = 'はい、作りました。\n```json\n{"summary":"s","classes":[{"className":"BookControllerTest","target":"BookController"}],"cases":[{"id":"C001","className":"BookControllerTest","method":"get","path":"/a","category":"normal","title":"t","given":"","request":"","expectStatus":"200","expect":"","basis":"spec","specRef":""}],"questions":[]}\n```';
  const p = C.parsePlan(text);
  assert.strictEqual(p.cases.length, 1);
  assert.strictEqual(p.cases[0].method, "GET");
  assert.strictEqual(p.cases[0].expectStatus, 200);
  assert.strictEqual(p.cases[0].selected, true);
});

test("normalizePlan: ID の重複・抜けを振りなおし、知らないクラスを足す", () => {
  const p = C.normalizePlan({
    classes: [],
    cases: [
      { id: "C001", className: "AControllerTest", category: "weird" },
      { id: "C001", className: "AControllerTest" },
      { id: "x", className: "BControllerTest" },
    ],
  });
  assert.deepStrictEqual(p.cases.map((c) => c.id), ["C001", "C002", "C003"]);
  assert.deepStrictEqual(p.classes.map((c) => c.className), ["AControllerTest", "BControllerTest"]);
  assert.strictEqual(p.cases[0].category, "other");
  assert.strictEqual(C.nextCaseId(p.cases), "C004");
});

test("parsePlan: JSON がなければエラー", () => {
  assert.throws(() => C.parsePlan("ごめんなさい"), /JSON/);
});

// ---------------------------------------------------------------- コードを取り出す

const GOOD = `\`\`\`java
// file: src/test/java/com/example/library/BookControllerTest.java
package com.example.library;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@WebMvcTest(BookController.class)
class BookControllerTest {
    @Autowired MockMvc mvc;
    @MockitoBean BookService service;

    @Test
    @DisplayName("[C001] 存在するIDなら書籍を返す")
    void returnsBook() throws Exception {
        String body = """
            {"title": "{ not a brace }"}
            """;
        mvc.perform(get("/api/books/1")).andExpect(status().isOk());
    }

    @Test
    @DisplayName("[C002] 存在しないIDなら404")
    void returns404() throws Exception {
        mvc.perform(get("/api/books/999")).andExpect(status().isNotFound()); // }
    }
}
\`\`\``;

test("extractFiles: file: の行からパスを取り、その行は本文から消す", () => {
  const files = C.extractFiles("説明\n" + GOOD + "\nおわり", "com.example.library");
  assert.strictEqual(files.length, 1);
  assert.strictEqual(files[0].path, "src/test/java/com/example/library/BookControllerTest.java");
  assert.strictEqual(files[0].name, "BookControllerTest.java");
  assert.match(files[0].code, /^package com\.example\.library;/);
  assert.strictEqual(files[0].partial, false);
});

test("extractFiles: file: がなければ package と class からパスを作る", () => {
  const files = C.extractFiles("```java\npackage a.b;\npublic class FooTest {}\n```", "x");
  assert.strictEqual(files[0].path, "src/test/java/a/b/FooTest.java");
});

test("extractFiles: 閉じていないブロックは partial", () => {
  const files = C.extractFiles("```java\npackage a;\nclass ATest {\n", "a");
  assert.strictEqual(files.length, 1);
  assert.strictEqual(files[0].partial, true);
});

test("extractFiles: SQL のファイルも取り出し、説明用の小さなコードは飛ばす", () => {
  const text = "```bash\n./gradlew test\n```\n```sql\n-- file: src/test/resources/books.sql\nINSERT INTO book VALUES (1);\n```";
  const files = C.extractFiles(text, "a");
  assert.deepStrictEqual(files.map((f) => f.path), ["src/test/resources/books.sql"]);
});

// ---------------------------------------------------------------- 漏れとチェック

test("coverage: DisplayName の観点IDを数える", () => {
  const files = C.extractFiles(GOOD, "com.example.library");
  const cov = C.coverage([{ id: "C001" }, { id: "C002" }, { id: "C003" }], files);
  assert.deepStrictEqual(cov.covered, ["C001", "C002"]);
  assert.deepStrictEqual(cov.missing, ["C003"]);
});

test("lint: よいコードには問題がない（テキストブロックやコメントの { } は数えない）", () => {
  const [f] = C.extractFiles(GOOD, "com.example.library");
  assert.deepStrictEqual(C.lint(f, S4), []);
});

test("lint: Boot 4 で @MockBean・古いパッケージ・JUnit 4 を見つける", () => {
  const code = GOOD.replace("org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest", "org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest")
    .replace("@MockitoBean BookService", "@MockBean BookService")
    .replace("import org.junit.jupiter.api.Test;", "import org.junit.Test;");
  const [f] = C.extractFiles(code, "com.example.library");
  const msgs = C.lint(f, S4).map((p) => p.message).join("\n");
  assert.match(msgs, /webmvc\.test\.autoconfigure/);
  assert.match(msgs, /@MockBean は削除/);
  assert.match(msgs, /JUnit 4/);
});

test("lint: Boot 3.0 で @MockitoBean はエラー、Boot 3.4 で @MockBean は注意", () => {
  const [f] = C.extractFiles(GOOD.replace("org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest", "org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest"), "com.example.library");
  assert.ok(C.lint(f, { ...S4, boot: "3.0" }).some((p) => p.level === "error" && /@MockitoBean/.test(p.message)));
  const g = { ...f, code: f.code.replace("@MockitoBean BookService", "@MockBean BookService") };
  assert.ok(C.lint(g, { ...S4, boot: "3.4" }).some((p) => p.level === "warn" && /非推奨/.test(p.message)));
});

test("lint: かっこの数のずれと、クラス名とファイル名のずれ", () => {
  const [f] = C.extractFiles(GOOD, "com.example.library");
  const broken = { ...f, code: f.code.replace(/}\s*$/, "") };
  assert.ok(C.lint(broken, S4).some((p) => /\{ と \}/.test(p.message)));
  const renamed = { ...f, name: "Other.java" };
  assert.ok(C.lint(renamed, S4).some((p) => /ファイル名/.test(p.message)));
});

test("idsInPlanText: コードブロックの外の表から観点IDを集める", () => {
  const text = "| ID | x |\n| --- | --- |\n| C001 | a |\n| C002 | b |\n```java\n@DisplayName(\"[C009] x\")\n```";
  assert.deepStrictEqual(C.idsInPlanText(text), ["C001", "C002"]);
});

// ---------------------------------------------------------------- 料金と zip

test("estimateCost: キャッシュから読んだ分は安くなる", () => {
  const u = C.addUsage(null, { input_tokens: 1000, output_tokens: 2000, cache_read_input_tokens: 10000, cache_creation_input_tokens: 0 });
  const cost = C.estimateCost("claude-opus-5-5", u);
  assert.ok(Math.abs(cost.usd - (1000 * 4 + 10000 * 0.2 + 2000 * 20) / 1e6) < 1e-9);
  assert.ok(cost.saved > 0);
  assert.strictEqual(C.estimateCost("unknown", u), null);
});

test("crc32 は標準の値", () => {
  assert.strictEqual(C.crc32(new TextEncoder().encode("123456789")).toString(16), "cbf43926");
});

test("makeZip: zip の先頭と終わりの印、ファイル数", () => {
  const zip = C.makeZip([{ path: "a/テスト.java", code: "class A {}" }, { path: "b.sql", code: "x" }], new Date(2026, 10, 4));
  const dv = new DataView(zip.buffer);
  assert.strictEqual(dv.getUint32(0, true), 0x04034b50);
  const end = zip.length - 22;
  assert.strictEqual(dv.getUint32(end, true), 0x06054b50);
  assert.strictEqual(dv.getUint16(end + 10, true), 2);
});
