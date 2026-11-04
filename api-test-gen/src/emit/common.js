/*
 * 各言語の出力で共通に使う小さな関数。
 */
(function (root) {
  "use strict";
  const isNode = typeof module !== "undefined" && module.exports;
  const { CATEGORIES } = isNode ? require("../cases.js") : root.ApiTestGen.cases;

  const CATEGORY_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.label]));

  // 同じ1文字が長く続く文字列（"aaaa…"）を見つける
  function repeated(str) {
    if (typeof str !== "string" || str.length < 20) return null;
    const ch = str[0];
    return str === ch.repeat(str.length) ? { ch, n: str.length } : null;
  }

  // 値をソースコードの文字列にする。lang: "js" | "py"
  function literal(value, lang, indent, level) {
    indent = indent == null ? 2 : indent;
    level = level || 0;
    const pad = (n) => " ".repeat(indent * n);
    if (value === undefined) return lang === "py" ? "None" : "undefined";
    if (value === null) return lang === "py" ? "None" : "null";
    if (typeof value === "boolean") return lang === "py" ? (value ? "True" : "False") : String(value);
    if (typeof value === "number") return Number.isFinite(value) ? String(value) : lang === "py" ? "None" : "null";
    if (typeof value === "string") {
      const r = repeated(value);
      if (r) return lang === "py" ? `${JSON.stringify(r.ch)} * ${r.n}` : `${JSON.stringify(r.ch)}.repeat(${r.n})`;
      return JSON.stringify(value);
    }
    const key = (k) => (lang === "js" && /^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k));
    const sep = lang === "py" ? ": " : ": ";
    if (Array.isArray(value)) {
      if (!value.length) return "[]";
      const items = value.map((v) => literal(v, lang, indent, level + 1));
      const one = "[" + items.join(", ") + "]";
      if (one.length <= 72 && !one.includes("\n")) return one;
      return "[\n" + items.map((s) => pad(level + 1) + s).join(",\n") + ",\n" + pad(level) + "]";
    }
    const entries = Object.entries(value).filter(([, v]) => v !== undefined);
    if (!entries.length) return "{}";
    const parts = entries.map(([k, v]) => key(k) + sep + literal(v, lang, indent, level + 1));
    const one = lang === "py" ? "{" + parts.join(", ") + "}" : "{ " + parts.join(", ") + " }";
    if (one.length <= 72 && !one.includes("\n")) return one;
    return "{\n" + parts.map((s) => pad(level + 1) + s).join(",\n") + ",\n" + pad(level) + "}";
  }

  function slug(text) {
    return String(text || "")
      .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
      .replace(/[^A-Za-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .toLowerCase();
  }

  function fileBase(title) {
    const s = slug(title).replace(/_/g, "-");
    return s || "api";
  }

  // オペレーションごとにまとめる（出てきた順のまま）
  function groupByOp(cases) {
    const groups = [];
    const map = new Map();
    for (const c of cases) {
      if (!map.has(c.op.key)) {
        const g = { op: c.op, cases: [] };
        map.set(c.op.key, g);
        groups.push(g);
      }
      map.get(c.op.key).cases.push(c);
    }
    return groups;
  }

  function caseName(c) {
    return `${c.id} [${CATEGORY_LABEL[c.category] || c.category}] ${c.title}`;
  }

  function groupName(op) {
    return `${op.method.toUpperCase()} ${op.path}${op.summary ? "  " + op.summary : ""}`;
  }

  // テストで実際に送るリクエスト（メソッドは大文字に）
  function requestFor(c) {
    const r = { method: c.request.method.toUpperCase(), path: c.request.path };
    for (const k of ["pathParams", "query", "headers", "cookies", "auth", "contentType", "body"]) {
      if (c.request[k] !== undefined) r[k] = c.request[k];
    }
    if (r.body === undefined) delete r.contentType;
    return r;
  }

  // 必要な認証方式の環境変数（スキップの判定と説明用）
  function envHint(model) {
    const out = {};
    for (const [name, env] of Object.entries(model.credentialEnv)) out[name] = Object.values(env)[0];
    return out;
  }

  function counts(cases) {
    const out = {};
    for (const c of cases) out[c.category] = (out[c.category] || 0) + 1;
    return CATEGORIES.filter((c) => out[c.id]).map((c) => `${c.label} ${out[c.id]}`).join(" / ");
  }

  const api = { literal, slug, fileBase, groupByOp, caseName, groupName, requestFor, envHint, counts, CATEGORY_LABEL };
  if (isNode) module.exports = api;
  else ((root.ApiTestGen = root.ApiTestGen || {}).emit = root.ApiTestGen.emit || {}).common = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
