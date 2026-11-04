/*
 * 仕様書（OpenAPI 3.0 / 3.1、Swagger 2.0）を読み込んで、扱いやすい形にそろえます。
 * YAML も JSON も読めます。DOM は使いません（Node でもテストできます）。
 *
 * スキーマの $ref はここでは展開しません（循環参照があっても安全なように）。
 * 必要なときに resolver.deref() で1段ずつたどります。
 */
(function (root) {
  "use strict";
  const isNode = typeof module !== "undefined" && module.exports;
  const yaml = isNode ? require("./vendor/js-yaml.min.js") : root.jsyaml;

  const METHODS = ["get", "post", "put", "patch", "delete", "head", "options", "trace"];

  class SpecError extends Error {}

  function parseText(text) {
    const t = String(text == null ? "" : text).replace(/^﻿/, "").trim();
    if (!t) throw new SpecError("仕様書が空です。OpenAPI（YAML か JSON）を貼りつけてください。");
    let doc;
    if (t[0] === "{" || t[0] === "[") {
      try {
        doc = JSON.parse(t);
      } catch (e) {
        throw new SpecError("JSON として読めませんでした: " + e.message);
      }
    } else {
      try {
        doc = yaml.load(t, { json: true });
      } catch (e) {
        const line = e.mark && typeof e.mark.line === "number" ? `${e.mark.line + 1}行目: ` : "";
        throw new SpecError("YAML として読めませんでした。" + line + (e.reason || e.message));
      }
    }
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
      throw new SpecError("仕様書の形になっていません。いちばん上に openapi: か swagger: が必要です。");
    }
    return doc;
  }

  function decodePointer(p) {
    return decodeURIComponent(p).replace(/~1/g, "/").replace(/~0/g, "~");
  }

  function makeResolver(doc, warnings) {
    const warned = new Set();
    function get(ref) {
      if (typeof ref !== "string") return undefined;
      if (!ref.startsWith("#")) {
        if (!warned.has(ref)) {
          warned.add(ref);
          warnings.push(`外部ファイルへの参照 ${ref} は読めないので、空のスキーマとして扱いました。1つのファイルにまとめた仕様書を使ってください。`);
        }
        return undefined;
      }
      let cur = doc;
      for (const part of ref.replace(/^#\/?/, "").split("/").filter(Boolean)) {
        if (cur == null || typeof cur !== "object") return undefined;
        cur = cur[decodePointer(part)];
      }
      if (cur === undefined && !warned.has(ref)) {
        warned.add(ref);
        warnings.push(`参照先 ${ref} が見つかりませんでした。`);
      }
      return cur;
    }
    function deref(obj) {
      let guard = 0;
      while (obj && typeof obj === "object" && typeof obj.$ref === "string" && guard++ < 50) {
        const target = get(obj.$ref);
        if (target === undefined) return {};
        obj = target;
      }
      return obj;
    }
    return { get, deref, doc };
  }

  // JSON っぽいものを優先して content-type を1つ選ぶ
  function pickMedia(content) {
    if (!content || typeof content !== "object") return null;
    const types = Object.keys(content);
    if (!types.length) return null;
    const order = [
      (t) => /^application\/json\b/i.test(t),
      (t) => /[/+]json\b/i.test(t),
      (t) => /x-www-form-urlencoded/i.test(t),
      (t) => /multipart\/form-data/i.test(t),
      (t) => t === "*/*",
      () => true,
    ];
    for (const ok of order) {
      const hit = types.find(ok);
      if (hit) return { type: hit, media: content[hit] || {} };
    }
    return null;
  }

  function firstExample(media) {
    if (!media) return undefined;
    if (media.example !== undefined) return media.example;
    if (media.examples && typeof media.examples === "object") {
      const first = Object.values(media.examples)[0];
      if (first && typeof first === "object" && "value" in first) return first.value;
    }
    return undefined;
  }

  // ---------- OpenAPI 3.x ----------
  function serversV3(doc) {
    const list = Array.isArray(doc.servers) ? doc.servers : [];
    return list
      .filter((s) => s && typeof s.url === "string")
      .map((s) => {
        let url = s.url;
        const vars = s.variables || {};
        url = url.replace(/\{([^}]+)\}/g, (m, name) =>
          vars[name] && vars[name].default != null ? String(vars[name].default) : m
        );
        return { url, description: s.description || "" };
      });
  }

  function schemesV3(doc, R) {
    const out = {};
    const defs = (doc.components && doc.components.securitySchemes) || {};
    for (const [name, raw] of Object.entries(defs)) {
      const s = R.deref(raw) || {};
      if (s.type === "http" && /^bearer$/i.test(s.scheme || "")) out[name] = { kind: "bearer", description: s.description || "" };
      else if (s.type === "http" && /^basic$/i.test(s.scheme || "")) out[name] = { kind: "basic", description: s.description || "" };
      else if (s.type === "apiKey") out[name] = { kind: "apiKey", in: s.in || "header", name: s.name || "X-API-Key", description: s.description || "" };
      else if (s.type === "oauth2" || s.type === "openIdConnect") out[name] = { kind: "bearer", description: s.description || "", note: s.type };
      else out[name] = { kind: "unsupported", type: s.type || "?" };
    }
    return out;
  }

  function paramV3(raw, R) {
    const p = R.deref(raw) || {};
    let schema = p.schema;
    if (!schema && p.content) {
      const m = pickMedia(p.content);
      schema = m && m.media.schema;
    }
    let example = p.example;
    if (example === undefined && p.examples) {
      const first = Object.values(p.examples)[0];
      if (first && typeof first === "object" && "value" in first) example = first.value;
    }
    return {
      name: String(p.name || ""),
      in: p.in || "query",
      required: p.in === "path" ? true : !!p.required,
      description: p.description || "",
      schema: schema || { type: "string" },
      example,
      style: p.style,
      explode: p.explode,
      deprecated: !!p.deprecated,
    };
  }

  function bodyV3(raw, R) {
    if (!raw) return null;
    const b = R.deref(raw) || {};
    const m = pickMedia(b.content);
    if (!m) return null;
    return {
      required: !!b.required,
      contentType: m.type === "*/*" ? "application/json" : m.type,
      schema: m.media.schema || {},
      example: firstExample(m.media),
      description: b.description || "",
    };
  }

  function responsesV3(raw, R) {
    const out = {};
    for (const [code, r0] of Object.entries(raw || {})) {
      if (!/^([1-5]\d\d|[1-5]XX|default)$/i.test(code)) continue;
      const r = R.deref(r0) || {};
      const m = pickMedia(r.content);
      out[code.toUpperCase()] = {
        description: r.description || "",
        contentType: m ? m.type : null,
        schema: m && m.media.schema ? m.media.schema : null,
      };
    }
    return out;
  }

  // ---------- Swagger 2.0 ----------
  const PARAM_SCHEMA_KEYS = [
    "type", "format", "items", "enum", "default", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum",
    "minLength", "maxLength", "pattern", "minItems", "maxItems", "uniqueItems", "multipleOf",
  ];
  function schemaFromV2Param(p) {
    const s = {};
    for (const k of PARAM_SCHEMA_KEYS) if (p[k] !== undefined) s[k] = p[k];
    if (s.type === "file") {
      s.type = "string";
      s.format = "binary";
    }
    if (!s.type) s.type = "string";
    return s;
  }

  function serversV2(doc) {
    const basePath = doc.basePath || "";
    if (!doc.host) return basePath ? [{ url: basePath, description: "" }] : [];
    const scheme = (Array.isArray(doc.schemes) && doc.schemes.find((s) => s === "https")) || (doc.schemes && doc.schemes[0]) || "https";
    return [{ url: `${scheme}://${doc.host}${basePath}`, description: "" }];
  }

  function schemesV2(doc) {
    const out = {};
    for (const [name, s] of Object.entries(doc.securityDefinitions || {})) {
      if (!s) continue;
      if (s.type === "basic") out[name] = { kind: "basic", description: s.description || "" };
      else if (s.type === "apiKey") out[name] = { kind: "apiKey", in: s.in || "header", name: s.name || "X-API-Key", description: s.description || "" };
      else if (s.type === "oauth2") out[name] = { kind: "bearer", description: s.description || "", note: "oauth2" };
      else out[name] = { kind: "unsupported", type: s.type || "?" };
    }
    return out;
  }

  function pickType(list, fallback) {
    if (!Array.isArray(list) || !list.length) return fallback;
    return list.find((t) => /json/i.test(t)) || list[0];
  }

  // ---------- 共通 ----------
  function mergeParams(pathLevel, opLevel) {
    const map = new Map();
    for (const p of pathLevel) map.set(p.in + ":" + p.name, p);
    for (const p of opLevel) map.set(p.in + ":" + p.name, p);
    return [...map.values()].filter((p) => p.name);
  }

  function makeKey(op, used) {
    let base = op.operationId
      ? String(op.operationId)
      : op.method + op.path.replace(/\{([^}]+)\}/g, "By_$1").replace(/[^A-Za-z0-9]+/g, "_");
    base = base.replace(/[^A-Za-z0-9_$]/g, "_").replace(/^(\d)/, "_$1") || op.method;
    let key = base;
    let n = 2;
    while (used.has(key)) key = base + "_" + n++;
    used.add(key);
    return key;
  }

  function loadSpec(text) {
    const doc = typeof text === "string" ? parseText(text) : text;
    const warnings = [];
    const R = makeResolver(doc, warnings);
    let version;
    if (typeof doc.openapi === "string" && /^3\./.test(doc.openapi)) version = doc.openapi;
    else if (String(doc.swagger) === "2.0") version = "2.0";
    else if (doc.openapi || doc.swagger) {
      throw new SpecError(`このバージョン（${doc.openapi || doc.swagger}）には対応していません。OpenAPI 3.x か Swagger 2.0 を使ってください。`);
    } else {
      throw new SpecError("openapi: か swagger: の行が見つかりません。OpenAPI の仕様書かどうか確かめてください。");
    }
    const v2 = version === "2.0";
    const info = doc.info || {};
    const securitySchemes = v2 ? schemesV2(doc) : schemesV3(doc, R);
    const globalSecurity = Array.isArray(doc.security) ? doc.security : [];

    const operations = [];
    const usedKeys = new Set();
    const paths = doc.paths && typeof doc.paths === "object" ? doc.paths : {};
    for (const [path, item0] of Object.entries(paths)) {
      const item = R.deref(item0) || {};
      const pathParams = Array.isArray(item.parameters) ? item.parameters : [];
      for (const method of METHODS) {
        const op = item[method];
        if (!op || typeof op !== "object") continue;
        const rawParams = Array.isArray(op.parameters) ? op.parameters : [];
        let parameters;
        let requestBody = null;
        let responses;
        if (v2) {
          const all = mergeParams(
            pathParams.map((p) => R.deref(p) || {}),
            rawParams.map((p) => R.deref(p) || {})
          );
          const consumes = op.consumes || doc.consumes;
          const produces = op.produces || doc.produces;
          parameters = [];
          const formProps = {};
          const formRequired = [];
          for (const p of all) {
            if (p.in === "body") {
              requestBody = {
                required: !!p.required,
                contentType: pickType(consumes, "application/json"),
                schema: p.schema || {},
                example: p["x-example"],
                description: p.description || "",
              };
            } else if (p.in === "formData") {
              formProps[p.name] = schemaFromV2Param(p);
              if (p.required) formRequired.push(p.name);
            } else {
              parameters.push({
                name: String(p.name || ""),
                in: p.in || "query",
                required: p.in === "path" ? true : !!p.required,
                description: p.description || "",
                schema: schemaFromV2Param(p),
                example: p["x-example"],
                collectionFormat: p.collectionFormat,
              });
            }
          }
          if (Object.keys(formProps).length) {
            const ct = (consumes || []).find((t) => /multipart|urlencoded/i.test(t)) || "application/x-www-form-urlencoded";
            requestBody = {
              required: formRequired.length > 0,
              contentType: ct,
              schema: { type: "object", properties: formProps, required: formRequired },
              description: "",
            };
          }
          responses = {};
          for (const [code, r0] of Object.entries(op.responses || {})) {
            if (!/^([1-5]\d\d|[1-5]XX|default)$/i.test(code)) continue;
            const r = R.deref(r0) || {};
            responses[code.toUpperCase()] = {
              description: r.description || "",
              contentType: r.schema ? pickType(produces, "application/json") : null,
              schema: r.schema || null,
            };
          }
        } else {
          parameters = mergeParams(pathParams.map((p) => paramV3(p, R)), rawParams.map((p) => paramV3(p, R)));
          requestBody = bodyV3(op.requestBody, R);
          responses = responsesV3(op.responses, R);
        }
        // パスに {xxx} があるのに定義がないパラメータを補う
        for (const m of path.matchAll(/\{([^}]+)\}/g)) {
          if (!parameters.some((p) => p.in === "path" && p.name === m[1])) {
            parameters.push({ name: m[1], in: "path", required: true, description: "", schema: { type: "string" } });
            warnings.push(`${method.toUpperCase()} ${path}: パスの {${m[1]}} が parameters に定義されていないので、文字列として扱いました。`);
          }
        }
        const entry = {
          method,
          path,
          operationId: op.operationId || "",
          summary: op.summary || "",
          description: op.description || "",
          tags: Array.isArray(op.tags) ? op.tags : [],
          deprecated: !!op.deprecated,
          parameters,
          requestBody,
          responses,
          security: Array.isArray(op.security) ? op.security : globalSecurity,
        };
        entry.key = makeKey(entry, usedKeys);
        operations.push(entry);
      }
    }
    if (!operations.length) warnings.push("paths にエンドポイントが1つもありません。");

    return {
      doc,
      resolver: R,
      version,
      title: info.title || "API",
      apiVersion: info.version != null ? String(info.version) : "",
      description: info.description || "",
      servers: v2 ? serversV2(doc) : serversV3(doc),
      securitySchemes,
      operations,
      warnings,
    };
  }

  const api = { loadSpec, parseText, makeResolver, SpecError, METHODS };
  if (isNode) module.exports = api;
  else (root.ApiTestGen = root.ApiTestGen || {}).spec = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
