/*
 * テストケースをその場で実行します（ブラウザでも Node.js でも動きます）。
 */
(function (root) {
  "use strict";
  const isNode = typeof module !== "undefined" && module.exports;
  const RT = isNode ? require("./runtime.js") : root.ApiTestGen.runtime;

  function missingCredentials(c, ctx) {
    const creds = ctx.credentials || {};
    return (c.request.auth || []).filter((n) => {
      const v = creds[n] || {};
      return !(v.token || v.key || v.user);
    });
  }

  async function runCase(c, model, ctx) {
    const missing = missingCredentials(c, ctx);
    if (missing.length) {
      return { id: c.id, skipped: true, pass: false, status: null, ms: 0, errors: [`認証情報（${missing.join(", ")}）が入力されていないのでスキップしました`] };
    }
    const started = Date.now();
    const { url, init } = RT.buildRequest(c.request, ctx.baseUrl, ctx.params || model.params, ctx.credentials || {}, model.schemes);
    const result = { id: c.id, url, method: init.method, pass: false, status: null, ms: 0, errors: [], bodyPreview: "" };
    const fetchFn = ctx.fetch || fetch;
    let controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), ctx.timeoutMs || 15000) : null;
    try {
      const res = await fetchFn(url, controller ? { ...init, signal: controller.signal } : init);
      const text = await res.text();
      result.status = res.status;
      result.ms = Date.now() - started;
      result.bodyPreview = text.slice(0, 2000);
      let body;
      try {
        body = text ? JSON.parse(text) : undefined;
      } catch (e) {
        body = text;
      }
      const ok = RT.statusMatches(res.status, c.expect.status);
      if (!ok) result.errors.push(`ステータスは ${c.expect.status.join(" か ")} のはずが ${res.status} でした`);
      const schema = ok ? RT.pickResponseSchema(res.status, model.responses[c.op.key]) : null;
      if (schema) {
        if (body === undefined) result.errors.push("レスポンスのボディが空です");
        else if (typeof body === "string" && schema.type !== "string") result.errors.push("レスポンスが JSON ではありません");
        else result.errors.push(...RT.validateSchema(schema, body, model.schemaRoot).map((e) => "レスポンスが仕様と違います: " + e));
      }
      result.pass = result.errors.length === 0;
    } catch (e) {
      result.ms = Date.now() - started;
      if (e && e.name === "AbortError") result.errors.push(`${Math.round((ctx.timeoutMs || 15000) / 1000)}秒たっても返事がありませんでした`);
      else {
        result.errors.push(
          "つながりませんでした。URL がまちがっていないか、サーバーが動いているかを確かめてください。" +
            (isNode ? "" : "ブラウザから実行するときは、API が CORS を許可している必要があります。") +
            (e && e.message ? `（${e.message}）` : "")
        );
      }
      result.network = true;
    } finally {
      if (timer) clearTimeout(timer);
    }
    return result;
  }

  // 1件ずつ順番に実行する（データを変えるテストがあるので、並列にはしない）
  async function runAll(model, cases, ctx, onResult) {
    const results = [];
    for (const c of cases) {
      if (ctx.signal && ctx.signal.aborted) break;
      const r = await runCase(c, model, ctx);
      results.push(r);
      if (onResult) onResult(r, c);
    }
    return results;
  }

  const api = { runCase, runAll };
  if (isNode) module.exports = api;
  else (root.ApiTestGen = root.ApiTestGen || {}).runner = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
