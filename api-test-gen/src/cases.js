/*
 * 読み込んだ仕様書から、テストケースの一覧を作ります。
 * ここで作る一覧（言語に依存しない形）を、各言語の出力とブラウザでの実行が使います。
 */
(function (root) {
  "use strict";
  const isNode = typeof module !== "undefined" && module.exports;
  const S = isNode ? require("./sample.js") : root.ApiTestGen.sample;

  const CATEGORIES = [
    { id: "positive", label: "正常系", hint: "仕様どおりのリクエストで成功し、レスポンスが仕様に合う" },
    { id: "boundary", label: "境界値", hint: "最小値・最大値・長さの上限など、ぎりぎり受け付けられる値" },
    { id: "required", label: "必須の欠落", hint: "必須のパラメータやボディの項目を抜く" },
    { id: "invalid", label: "不正な値", hint: "型ちがい・範囲外・enum にない値・長すぎる文字列" },
    { id: "format", label: "形式", hint: "メールアドレスや日付などの形がまちがっている" },
    { id: "auth", label: "認証", hint: "認証情報なしで送ると拒否される" },
    { id: "notFound", label: "存在しないID", hint: "存在しないIDで 404 が返る" },
  ];

  const DEFAULT_OPTIONS = {
    categories: { positive: true, boundary: true, required: true, invalid: true, format: true, auth: true, notFound: true },
    negativeStatus: "spec", // "spec": 仕様に書かれた 400/422、"any4xx": 4xx なら何でもよい
    include: null, // テストするオペレーションの key の配列（null ならすべて）
    params: {}, // パスパラメータの値の上書き
  };

  const SKIP_HEADERS = /^(accept|content-type|authorization)$/i;

  function credentialEnv(securitySchemes) {
    // 認証方式ごとに、環境変数の名前を決める
    const out = {};
    const count = { bearer: 0, basic: 0, apiKey: 0 };
    for (const [name, s] of Object.entries(securitySchemes || {})) {
      if (!count.hasOwnProperty(s.kind)) continue;
      const n = count[s.kind]++;
      const suffix = n === 0 ? "" : "_" + name.replace(/[^A-Za-z0-9]+/g, "_").toUpperCase();
      if (s.kind === "bearer") out[name] = { token: "API_TOKEN" + suffix };
      else if (s.kind === "basic") out[name] = { user: "API_USER" + suffix, password: "API_PASSWORD" + suffix };
      else out[name] = { key: "API_KEY" + suffix };
    }
    return out;
  }

  // オペレーションで使う認証方式を決める
  function securityFor(op, api) {
    const alts = Array.isArray(op.security) ? op.security : [];
    if (!alts.length) return { use: [], required: false };
    const optional = alts.some((a) => a && typeof a === "object" && Object.keys(a).length === 0);
    const usable = alts.find((a) => {
      const names = Object.keys(a || {});
      return names.length && names.every((n) => api.securitySchemes[n] && api.securitySchemes[n].kind !== "unsupported");
    });
    return { use: usable ? Object.keys(usable) : [], required: !optional && !!usable };
  }

  function same(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  function statusText(list) {
    return list.map((c) => c.replace(/XX$/, "xx")).join(" か ");
  }

  function buildCases(api, options) {
    const opt = { ...DEFAULT_OPTIONS, ...(options || {}) };
    const cats = { ...DEFAULT_OPTIONS.categories, ...(opt.categories || {}) };
    const R = api.resolver;
    const params = {}; // パスパラメータの共有の値
    const paramInfo = {}; // 名前 → { schema, ops: [] }
    const cases = [];
    const responses = {}; // op.key → { status: schema }
    const include = opt.include ? new Set(opt.include) : null;
    let seq = 0;
    const nextId = () => "T" + String(++seq).padStart(3, "0");

    for (const op of api.operations) {
      if (include && !include.has(op.key)) continue;
      const label = `${op.method.toUpperCase()} ${op.path}`;
      const sec = securityFor(op, api);

      // レスポンスのスキーマ
      const resMap = {};
      for (const [code, r] of Object.entries(op.responses)) if (r.schema) resMap[code] = r.schema;
      if (Object.keys(resMap).length) responses[op.key] = resMap;
      const codes = Object.keys(op.responses);
      let success = codes.filter((c) => /^2/.test(c));
      if (!success.length) success = ["2XX"];
      const documented = (list) => codes.filter((c) => list.includes(c));
      const badRequest = opt.negativeStatus === "any4xx" ? ["4XX"] : documented(["400", "422"]).length ? documented(["400", "422"]) : ["4XX"];
      const unauthorized = documented(["401", "403"]).length ? documented(["401", "403"]) : ["401", "403"];

      // まず、正しいリクエストを1つ作る
      const base = { method: op.method, path: op.path, query: {}, headers: {}, cookies: {}, auth: sec.use };
      for (const p of op.parameters) {
        if (p.in === "path") {
          if (!(p.name in paramInfo)) paramInfo[p.name] = { schema: p.schema, description: p.description, ops: [] };
          paramInfo[p.name].ops.push(label);
          if (!(p.name in params)) {
            params[p.name] = p.example !== undefined ? p.example : S.sampleValue(p.schema, R, { name: p.name });
          }
          continue;
        }
        if (p.in === "header" && SKIP_HEADERS.test(p.name)) continue;
        const hasExample = p.example !== undefined || S.flatten(p.schema, R).example !== undefined;
        if (!p.required && !hasExample) continue;
        const value = p.example !== undefined ? p.example : S.sampleValue(p.schema, R, { name: p.name });
        if (p.in === "query") base.query[p.name] = value;
        else if (p.in === "header") base.headers[p.name] = value;
        else if (p.in === "cookie") base.cookies[p.name] = value;
      }
      const body = op.requestBody;
      if (body) {
        base.contentType = body.contentType;
        base.body = body.example !== undefined ? body.example : S.sampleValue(body.schema, R, { purpose: "request" });
      }

      const opInfo = { key: op.key, method: op.method, path: op.path, summary: op.summary, label, tags: op.tags };
      const push = (category, title, mutate, expect, extra) => {
        if (!cats[category]) return;
        const req = JSON.parse(JSON.stringify(base));
        if (mutate) mutate(req);
        for (const k of ["query", "headers", "cookies"]) if (!Object.keys(req[k]).length) delete req[k];
        if (!req.auth.length) delete req.auth;
        cases.push({ id: nextId(), op: opInfo, category, title, request: req, expect: { status: expect }, ...(extra || {}) });
      };

      // 1. 正常系
      push("positive", `正しいリクエスト → ${statusText(success)}${success.some((c) => resMap[c]) ? "（レスポンスも仕様どおり）" : ""}`, null, success);

      // 2. パラメータごとのテスト
      for (const p of op.parameters) {
        if (p.in === "header" && SKIP_HEADERS.test(p.name)) continue;
        const where = { query: "クエリ", header: "ヘッダー", path: "パス", cookie: "クッキー" }[p.in] || p.in;
        const slot = { query: "query", header: "headers", cookie: "cookies" }[p.in];
        const setValue = (req, v) => {
          if (p.in === "path") req.pathParams = { ...(req.pathParams || {}), [p.name]: v };
          else req[slot][p.name] = v;
        };
        if (p.required && p.in !== "path") {
          push("required", `${where} ${p.name} を省略 → ${statusText(badRequest)}`, (req) => {
            delete req[slot][p.name];
          }, badRequest, { target: p.name });
        }
        if (p.in !== "path") {
          for (const b of S.boundaryValues(p.schema, R)) {
            if (same(b.value, base[slot][p.name])) continue;
            push("boundary", `${where} ${p.name}：${b.label} → ${statusText(success)}`, (req) => setValue(req, b.value), success, { target: p.name });
          }
        }
        for (const bad of S.invalidValues(p.schema, R, "param")) {
          const expect = p.in === "path" && !badRequest.includes("4XX") ? [...badRequest, "404"] : badRequest;
          push(bad.group, `${where} ${p.name}：${bad.label} → ${statusText(expect)}`, (req) => setValue(req, bad.value), expect, { target: p.name });
        }
        if (p.in === "path" && codes.includes("404")) {
          const missing = S.missingValue(p.schema, R);
          push("notFound", `存在しない ${p.name}（${JSON.stringify(missing)}）→ 404`, (req) => setValue(req, missing), ["404"], { target: p.name });
        }
      }

      // 3. ボディのテスト（いちばん上の階層の項目）
      if (body) {
        const flat = S.chooseVariant(S.flatten(body.schema, R), R, 0);
        const isObject = S.mainType(flat) === "object" && base.body && typeof base.body === "object" && !Array.isArray(base.body);
        if (body.required) {
          push("required", `ボディなし → ${statusText(badRequest)}`, (req) => {
            delete req.body;
          }, badRequest);
        }
        if (isObject) {
          const props = flat.properties || {};
          for (const name of flat.required || []) {
            const ps = props[name] && S.flatten(props[name], R);
            if (ps && ps.readOnly) continue;
            push("required", `ボディ ${name} を省略 → ${statusText(badRequest)}`, (req) => {
              delete req.body[name];
            }, badRequest, { target: name });
          }
          for (const [name, ps0] of Object.entries(props)) {
            const ps = S.flatten(ps0, R);
            if (ps.readOnly) continue;
            for (const b of S.boundaryValues(ps0, R)) {
              if (same(b.value, base.body[name])) continue;
              push("boundary", `ボディ ${name}：${b.label} → ${statusText(success)}`, (req) => {
                req.body[name] = b.value;
              }, success, { target: name });
            }
            const isRequired = (flat.required || []).includes(name);
            for (const bad of S.invalidValues(ps0, R, "body")) {
              // 任意の項目の null は「省略」と同じ扱いをする API が多いので、必須の項目だけ試す
              if (bad.value === null && !isRequired) continue;
              push(bad.group, `ボディ ${name}：${bad.label} → ${statusText(badRequest)}`, (req) => {
                req.body[name] = bad.value;
              }, badRequest, { target: name });
            }
          }
        }
      }

      // 4. 認証
      if (sec.required) {
        push("auth", `認証情報なし → ${statusText(unauthorized)}`, (req) => {
          req.auth = [];
        }, unauthorized);
      }
    }

    // 上書きされた値を使う
    for (const [k, v] of Object.entries(opt.params || {})) if (k in params && v !== "" && v != null) params[k] = v;

    const schemes = {};
    for (const [name, s] of Object.entries(api.securitySchemes)) if (s.kind !== "unsupported") schemes[name] = s;

    return {
      title: api.title,
      apiVersion: api.apiVersion,
      baseUrl: (api.servers[0] && api.servers[0].url) || "http://localhost:3000",
      cases,
      params,
      paramInfo,
      responses,
      schemes,
      credentialEnv: credentialEnv(schemes),
      schemaRoot: collectRefs(api, responses),
    };
  }

  // レスポンスのスキーマが参照している部分だけを、仕様書から取り出す（生成するコードに入れるため）
  function collectRefs(api, responses) {
    const out = {};
    const seen = new Set();
    function setAt(pointer, value) {
      const parts = pointer.replace(/^#\/?/, "").split("/").filter(Boolean).map((p) => decodeURIComponent(p).replace(/~1/g, "/").replace(/~0/g, "~"));
      let cur = out;
      parts.forEach((p, i) => {
        if (i === parts.length - 1) cur[p] = value;
        else cur = cur[p] = cur[p] && typeof cur[p] === "object" ? cur[p] : {};
      });
    }
    function walk(node) {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) return node.forEach(walk);
      if (typeof node.$ref === "string" && node.$ref.startsWith("#") && !seen.has(node.$ref)) {
        seen.add(node.$ref);
        const target = api.resolver.get(node.$ref);
        if (target !== undefined) {
          setAt(node.$ref, target);
          walk(target);
        }
      }
      for (const [k, v] of Object.entries(node)) if (k !== "$ref" && k !== "example" && k !== "examples") walk(v);
    }
    walk(responses);
    return out;
  }

  const api = { buildCases, CATEGORIES, DEFAULT_OPTIONS, credentialEnv };
  if (isNode) module.exports = api;
  else (root.ApiTestGen = root.ApiTestGen || {}).cases = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
