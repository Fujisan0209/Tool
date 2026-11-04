// 実行: npm test（リポジトリのいちばん上で）
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadSpec, SpecError } = require("../src/spec.js");
const S = require("../src/sample.js");
const { buildCases } = require("../src/cases.js");
const { validateSchema, buildRequest, statusMatches, pickResponseSchema } = require("../src/runtime.js");

const read = (name) => fs.readFileSync(path.join(__dirname, "..", "examples", name), "utf8");

test("OpenAPI 3.0 の YAML を読める", () => {
  const api = loadSpec(read("library.yaml"));
  assert.equal(api.title, "図書館 API");
  assert.equal(api.servers[0].url, "http://localhost:4010/v1");
  assert.deepEqual(api.operations.map((o) => o.key), ["listBooks", "createBook", "getBook", "deleteBook", "createLoan"]);
  const getBook = api.operations.find((o) => o.key === "getBook");
  assert.equal(getBook.parameters[0].name, "bookId"); // パスの階層のパラメータも引きつぐ
  assert.deepEqual(getBook.security, []);
  assert.equal(api.securitySchemes.bearerAuth.kind, "bearer");
  assert.deepEqual(api.warnings, []);
});

test("Swagger 2.0 も読める（body パラメータ・host・apiKey）", () => {
  const api = loadSpec(read("todo-swagger2.yaml"));
  assert.equal(api.servers[0].url, "https://todo.example.com/api");
  const create = api.operations.find((o) => o.key === "createTodo");
  assert.equal(create.requestBody.contentType, "application/json");
  assert.deepEqual(create.requestBody.schema, { $ref: "#/definitions/NewTodo" });
  assert.deepEqual(api.securitySchemes.apiKey, { kind: "apiKey", in: "header", name: "X-API-Key", description: "" });
  const model = buildCases(api);
  assert.ok(model.cases.length > 10);
  assert.equal(model.params.todoId, "3fa85f64-5717-4562-b3fc-2c963f66afa6");
  assert.ok(model.schemaRoot.definitions.Todo, "レスポンスが参照するスキーマを取り出す");
});

test("JSON の仕様書も読める", () => {
  const doc = { openapi: "3.1.0", info: { title: "T", version: "1" }, paths: { "/ping": { get: { responses: { 200: { description: "ok" } } } } } };
  const api = loadSpec(JSON.stringify(doc));
  assert.equal(api.operations[0].key, "get_ping");
});

test("読めない仕様書は、わかりやすいエラーにする", () => {
  assert.throws(() => loadSpec(""), SpecError);
  assert.throws(() => loadSpec("foo: [1, 2"), /YAML として読めませんでした/);
  assert.throws(() => loadSpec("{ bad json"), /JSON として読めませんでした/);
  assert.throws(() => loadSpec("title: hello"), /openapi: か swagger:/);
  assert.throws(() => loadSpec("swagger: '1.2'"), /対応していません/);
});

test("循環参照があっても止まらない", () => {
  const spec = `
openapi: 3.0.0
info: { title: Tree, version: "1" }
paths:
  /nodes:
    post:
      requestBody:
        content:
          application/json:
            schema: { $ref: "#/components/schemas/Node" }
      responses:
        "200":
          description: ok
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Node" }
components:
  schemas:
    Node:
      type: object
      required: [name]
      properties:
        name: { type: string }
        children: { type: array, items: { $ref: "#/components/schemas/Node" } }
`;
  const model = buildCases(loadSpec(spec));
  assert.ok(model.cases.length > 0);
  const body = model.cases[0].request.body;
  assert.equal(body.name, "name");
  assert.deepEqual(validateSchema({ $ref: "#/components/schemas/Node" }, { name: "a", children: [{ name: "b", children: [] }] }, model.schemaRoot), []);
});

test("作った正しい値は、元のスキーマに合う", () => {
  const api = loadSpec(read("library.yaml"));
  const R = api.resolver;
  for (const name of ["BookInput", "Loan", "Error"]) {
    const schema = { $ref: "#/components/schemas/" + name };
    const value = S.sampleValue(schema, R);
    assert.deepEqual(validateSchema(schema, value, api.doc), [], name);
  }
  const schemas = [
    { type: "string", pattern: "^[A-Z]{3}-\\d{4}$" },
    { type: "string", pattern: "^(foo|bar)_[a-z0-9]+$", minLength: 6 },
    { type: "string", format: "email" },
    { type: "integer", minimum: 10, maximum: 20, multipleOf: 5 },
    { type: "number", exclusiveMinimum: 0, maximum: 1 },
    { type: "array", items: { type: "string", enum: ["a", "b", "c"] }, minItems: 2, uniqueItems: true },
    { type: ["string", "null"], maxLength: 3 },
    { oneOf: [{ type: "object", required: ["kind"], properties: { kind: { const: "cat" } } }, { type: "string" }] },
  ];
  for (const schema of schemas) {
    const value = S.sampleValue(schema, R);
    assert.deepEqual(validateSchema(schema, value, {}), [], JSON.stringify(schema) + " → " + JSON.stringify(value));
  }
});

test("作ったまちがった値は、元のスキーマに合わない", () => {
  const api = loadSpec(read("library.yaml"));
  const R = api.resolver;
  const schemas = [
    { type: "integer", minimum: 1, maximum: 100 },
    { type: "string", minLength: 2, maxLength: 5, enum: ["ab", "abc"] },
    { type: "string", pattern: "^97[89]-\\d{10}$" },
    { type: "string", format: "date" },
    { type: "array", items: { type: "integer" }, minItems: 1, maxItems: 2 },
    { type: "number", exclusiveMaximum: 10 },
  ];
  for (const schema of schemas) {
    const bad = S.invalidValues(schema, R, "body");
    assert.ok(bad.length > 0);
    for (const b of bad) {
      assert.notDeepEqual(validateSchema(schema, b.value, {}), [], `${JSON.stringify(schema)} に ${JSON.stringify(b.value)}（${b.label}）`);
    }
  }
});

test("正規表現から合う文字列を作れる", () => {
  for (const p of ["^\\d{3}-\\d{4}$", "^[a-z]+@[a-z]+\\.com$", "^(?:JP|US)[0-9]{2}$", "^[A-F0-9]{8}$", "^v\\d+\\.\\d+(\\.\\d+)?$"]) {
    const v = S.sampleFromPattern(p);
    assert.match(v, new RegExp(p), p);
  }
});

test("テストケース: 図書館 API から期待どおりの種類が作られる", () => {
  const model = buildCases(loadSpec(read("library.yaml")));
  const by = (cat) => model.cases.filter((c) => c.category === cat);
  assert.equal(by("positive").length, 5);
  assert.equal(by("auth").length, 3); // 認証が必要な POST /books, DELETE, POST /loans
  assert.equal(by("notFound").length, 2); // 404 が書かれている GET と DELETE
  const ids = model.cases.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
  // 正常系のリクエストは認証つき、認証のテストは認証なし
  const createPositive = model.cases.find((c) => c.op.key === "createBook" && c.category === "positive");
  assert.deepEqual(createPositive.request.auth, ["bearerAuth"]);
  assert.deepEqual(createPositive.expect.status, ["201"]);
  assert.equal(createPositive.request.body.id, undefined, "readOnly の id は送らない");
  const noAuth = model.cases.find((c) => c.op.key === "createBook" && c.category === "auth");
  assert.equal(noAuth.request.auth, undefined);
  assert.deepEqual(noAuth.expect.status, ["401"]);
  // 必須の項目を抜いたケース
  const missingTitle = model.cases.find((c) => c.category === "required" && c.target === "title");
  assert.ok(!("title" in missingTitle.request.body));
  assert.deepEqual(missingTitle.expect.status, ["400"]);
  // 境界値
  const limitMax = model.cases.find((c) => c.category === "boundary" && c.target === "limit" && c.request.query.limit === 100);
  assert.deepEqual(limitMax.expect.status, ["200"]);
});

test("テストケース: 種類としぼりこみのオプション", () => {
  const api = loadSpec(read("library.yaml"));
  const only = buildCases(api, { categories: { positive: true, boundary: false, required: false, invalid: false, format: false, auth: false, notFound: false } });
  assert.equal(only.cases.length, 5);
  const one = buildCases(api, { include: ["getBook"], negativeStatus: "any4xx" });
  assert.ok(one.cases.every((c) => c.op.key === "getBook"));
  assert.ok(one.cases.filter((c) => c.category === "invalid").every((c) => c.expect.status.join() === "4XX"));
  const withParam = buildCases(api, { params: { bookId: 42 } });
  assert.equal(withParam.params.bookId, 42);
});

test("スキーマの確認: よくあるまちがいを見つける", () => {
  const schema = {
    type: "object",
    required: ["id", "name", "secret"],
    additionalProperties: false,
    properties: {
      id: { type: "integer" },
      name: { type: "string", nullable: true },
      secret: { type: "string", writeOnly: true },
      tags: { type: "array", items: { type: "string" }, maxItems: 1 },
    },
  };
  assert.deepEqual(validateSchema(schema, { id: 1, name: null }, {}), []);
  const errors = validateSchema(schema, { id: "1", tags: ["a", 2], extra: true }, {});
  assert.equal(errors.length, 5, errors.join("\n"));
  assert.ok(errors.some((e) => e.includes('"name"')));
  assert.ok(errors.some((e) => e.includes("$.tags[1]")));
  assert.ok(errors.some((e) => e.includes('"extra"')));
});

test("リクエストの組み立て: パス・クエリ・認証・ボディ", () => {
  const { url, init } = buildRequest(
    { method: "post", path: "/books/{id}/x", query: { q: "猫 犬", tag: ["a", "b"] }, auth: ["k", "b"], body: { a: 1 } },
    "https://api.example.com/v1/",
    { id: "a/b" },
    { k: { key: "KEY" }, b: { token: "TOKEN" } },
    { k: { kind: "apiKey", in: "query", name: "api_key" }, b: { kind: "bearer" } }
  );
  assert.equal(url, "https://api.example.com/v1/books/a%2Fb/x?q=%E7%8C%AB%20%E7%8A%AC&tag=a&tag=b&api_key=KEY");
  assert.equal(init.method, "POST");
  assert.equal(init.headers.Authorization, "Bearer TOKEN");
  assert.equal(init.headers["Content-Type"], "application/json");
  assert.equal(init.body, '{"a":1}');
  const basic = buildRequest({ method: "get", path: "/", auth: ["x"] }, "", {}, { x: { user: "u", password: "p" } }, { x: { kind: "basic" } });
  assert.equal(basic.init.headers.Authorization, "Basic dTpw");
});

test("ステータスの判定", () => {
  assert.ok(statusMatches(201, ["200", "201"]));
  assert.ok(statusMatches(404, ["4XX"]));
  assert.ok(!statusMatches(500, ["4XX"]));
  assert.deepEqual(pickResponseSchema(422, { "4XX": 1, DEFAULT: 2 }), 1);
  assert.deepEqual(pickResponseSchema(500, { "4XX": 1, DEFAULT: 2 }), 2);
});

test("src/examples.js が examples/ と同じ（npm run build し忘れの確認）", () => {
  const code = fs.readFileSync(path.join(__dirname, "..", "src", "examples.js"), "utf8");
  const sandbox = {};
  new Function("globalThis", code)(sandbox);
  assert.equal(sandbox.ApiTestGen.examples.library, read("library.yaml"));
  assert.equal(sandbox.ApiTestGen.examples.todo, read("todo-swagger2.yaml"));
});
