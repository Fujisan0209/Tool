/*
 * Postman のコレクション（v2.1）を書き出します。Newman でもそのまま実行できます。
 * 確認のスクリプトはコレクションに1つだけ置き、リクエストの名前の先頭（T001 など）で期待する結果を探します。
 */
(function (root) {
  "use strict";
  const isNode = typeof module !== "undefined" && module.exports;
  const C = isNode ? require("./common.js") : root.ApiTestGen.emit.common;
  const RT = isNode ? require("../runtime.js") : root.ApiTestGen.runtime;

  const camel = (env) => env.toLowerCase().replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());

  function str(v) {
    if (v == null) return "";
    if (typeof v === "object") return JSON.stringify(v);
    return String(v);
  }
  const enc = (v) => encodeURIComponent(str(v));

  function emitPostman(model) {
    const file = C.fileBase(model.title) + ".postman_collection.json";
    const variables = [{ key: "baseUrl", value: model.baseUrl }];
    for (const [k, v] of Object.entries(model.params)) variables.push({ key: k, value: str(v) });
    const credVar = {}; // scheme → { token: "apiToken" }
    for (const [name, env] of Object.entries(model.credentialEnv)) {
      credVar[name] = {};
      for (const [k, e] of Object.entries(env)) {
        credVar[name][k] = camel(e);
        variables.push({ key: camel(e), value: "", type: "secret" });
      }
    }

    function authFor(names) {
      const headers = [];
      let auth = { type: "noauth" };
      for (const name of names || []) {
        const s = model.schemes[name];
        const v = credVar[name] || {};
        if (!s) continue;
        if (s.kind === "bearer") auth = { type: "bearer", bearer: [{ key: "token", value: `{{${v.token}}}`, type: "string" }] };
        else if (s.kind === "basic") {
          auth = {
            type: "basic",
            basic: [
              { key: "username", value: `{{${v.user}}}`, type: "string" },
              { key: "password", value: `{{${v.password}}}`, type: "string" },
            ],
          };
        } else if (s.kind === "apiKey") {
          if (s.in === "cookie") headers.push({ key: "Cookie", value: `${s.name}={{${v.key}}}` });
          else {
            auth = {
              type: "apikey",
              apikey: [
                { key: "key", value: s.name, type: "string" },
                { key: "value", value: `{{${v.key}}}`, type: "string" },
                { key: "in", value: s.in === "query" ? "query" : "header", type: "string" },
              ],
            };
          }
        }
      }
      return { auth, headers };
    }

    function requestFor(c) {
      const r = c.request;
      const path = r.path.replace(/\{([^}]+)\}/g, (_, name) =>
        r.pathParams && name in r.pathParams ? enc(r.pathParams[name]) : `{{${name}}}`
      );
      const query = [];
      for (const [k, v] of Object.entries(r.query || {})) {
        if (Array.isArray(v)) v.forEach((x) => query.push({ key: k, value: str(x) }));
        else query.push({ key: k, value: str(v) });
      }
      const qs = query.map((q) => `${enc(q.key)}=${enc(q.value)}`).join("&");
      const { auth, headers } = authFor(r.auth);
      for (const [k, v] of Object.entries(r.headers || {})) headers.push({ key: k, value: str(v) });
      const cookies = Object.entries(r.cookies || {}).map(([k, v]) => `${k}=${enc(v)}`);
      if (cookies.length) headers.push({ key: "Cookie", value: cookies.join("; ") });
      headers.push({ key: "Accept", value: "application/json" });
      const req = {
        method: r.method.toUpperCase(),
        auth,
        header: headers,
        url: `{{baseUrl}}${path}${qs ? "?" + qs : ""}`,
      };
      if (r.body !== undefined) {
        const ct = r.contentType || "application/json";
        if (/x-www-form-urlencoded/i.test(ct) && r.body && typeof r.body === "object") {
          req.body = { mode: "urlencoded", urlencoded: Object.entries(r.body).map(([k, v]) => ({ key: k, value: str(v) })) };
        } else if (/multipart/i.test(ct) && r.body && typeof r.body === "object") {
          req.body = { mode: "formdata", formdata: Object.entries(r.body).map(([k, v]) => ({ key: k, value: str(v), type: "text" })) };
        } else {
          headers.unshift({ key: "Content-Type", value: ct });
          req.body = {
            mode: "raw",
            raw: typeof r.body === "string" && !/json/i.test(ct) ? r.body : JSON.stringify(r.body, null, 2),
            options: { raw: { language: /json/i.test(ct) ? "json" : "text" } },
          };
        }
      }
      return req;
    }

    const expect = {};
    for (const c of model.cases) expect[c.id] = { status: c.expect.status, op: c.op.key };

    const script = `// 「API テスト自動生成」が作った確認用のスクリプトです。
// リクエスト名の先頭の番号（T001 など）で、期待するステータスとレスポンスの形を探します。
const EXPECT = ${JSON.stringify(expect)};
const RESPONSES = ${JSON.stringify(model.responses)};
const SCHEMA_ROOT = ${JSON.stringify(model.schemaRoot)};

${RT.validateSchema.toString()}

${RT.statusMatches.toString()}

${RT.pickResponseSchema.toString()}

const exp = EXPECT[pm.info.requestName.split(" ")[0]];
if (exp) {
  const ok = statusMatches(pm.response.code, exp.status);
  pm.test("ステータスが " + exp.status.join(" か "), function () {
    pm.expect(ok, "実際のステータス: " + pm.response.code).to.be.true;
  });
  const schema = ok ? pickResponseSchema(pm.response.code, RESPONSES[exp.op]) : null;
  if (schema) {
    pm.test("レスポンスが仕様どおり", function () {
      let body;
      try {
        body = pm.response.json();
      } catch (e) {
        pm.expect.fail("レスポンスが JSON ではありません");
      }
      const errors = validateSchema(schema, body, SCHEMA_ROOT);
      pm.expect(errors, errors.join("\\n")).to.be.empty;
    });
  }
}`;

    const collection = {
      info: {
        name: `${model.title}${model.apiVersion ? " " + model.apiVersion : ""} テスト`,
        description:
          `「API テスト自動生成」で仕様書から作ったテストです（${model.cases.length}件: ${C.counts(model.cases)}）。\n\n` +
          `- コレクションの変数 baseUrl と、認証情報（${Object.values(credVar).flatMap((v) => Object.values(v)).join(", ") || "なし"}）を設定してから実行してください。\n` +
          `- パスの変数（${Object.keys(model.params).join(", ") || "なし"}）は、実在するIDに書きかえてください。\n` +
          `- POST / PUT / PATCH / DELETE はデータを変更します。テスト用の環境で実行してください。\n\n` +
          `Newman で実行: newman run ${file} --env-var baseUrl=${model.baseUrl}`,
        schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
      },
      variable: variables,
      event: [{ listen: "test", script: { type: "text/javascript", exec: script.split("\n") } }],
      item: C.groupByOp(model.cases).map((g) => ({
        name: C.groupName(g.op),
        item: g.cases.map((c) => ({ name: C.caseName(c), request: requestFor(c) })),
      })),
    };
    return { filename: file, language: "json", code: JSON.stringify(collection, null, 2) };
  }

  if (isNode) module.exports = { emitPostman };
  else root.ApiTestGen.emit.postman = emitPostman;
})(typeof globalThis !== "undefined" ? globalThis : this);
