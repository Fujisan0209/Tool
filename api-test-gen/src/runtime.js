/*
 * テストを「実行するとき」に使う関数です。
 * ブラウザでの実行と、生成した JavaScript / Postman のテストの両方で、この同じ関数を使います
 * （生成するときに関数の中身をそのまま書き出します）。
 * そのため、それぞれの関数は外の変数を使わず、引数だけで動くようにしてあります。
 */
(function (root) {
  "use strict";

  // レスポンスがスキーマに合っているか調べ、合わないところを日本語の文の配列で返す
  function validateSchema(schema, value, rootDoc) {
    var errors = [];
    var MAX_ERRORS = 20;
    function decode(p) {
      return decodeURIComponent(p).replace(/~1/g, "/").replace(/~0/g, "~");
    }
    function resolve(s) {
      var guard = 0;
      while (s && typeof s === "object" && typeof s.$ref === "string" && guard++ < 32) {
        var cur = rootDoc;
        var parts = s.$ref.replace(/^#\/?/, "").split("/");
        for (var i = 0; i < parts.length; i++) {
          if (!parts[i]) continue;
          cur = cur == null ? undefined : cur[decode(parts[i])];
        }
        s = cur === undefined ? {} : cur;
      }
      return s;
    }
    function kind(v) {
      if (v === null) return "null";
      if (Array.isArray(v)) return "array";
      if (typeof v === "number") return Number.isInteger(v) ? "integer" : "number";
      return typeof v;
    }
    function typeOk(t, v) {
      var k = kind(v);
      return t === k || (t === "number" && k === "integer");
    }
    function same(a, b) {
      return JSON.stringify(a) === JSON.stringify(b);
    }
    function show(v) {
      var s = JSON.stringify(v);
      if (s === undefined) s = String(v);
      return s.length > 60 ? s.slice(0, 57) + "..." : s;
    }
    function push(path, msg) {
      if (errors.length < MAX_ERRORS) errors.push(path + ": " + msg);
    }
    var FORMATS = {
      "date-time": /^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?([Zz]|[+-]\d{2}:?\d{2})?$/,
      date: /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/,
      email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
      uuid: /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
      ipv4: /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/,
    };
    function passes(s, v, path, depth) {
      var saved = errors;
      errors = [];
      check(s, v, path, depth);
      var ok = errors.length === 0;
      errors = saved;
      return ok;
    }
    function check(s0, v, path, depth) {
      if (depth > 64) return;
      var s = resolve(s0);
      if (s === true || s == null) return;
      if (s === false) return push(path, "この場所には値があってはいけません");
      if (typeof s !== "object") return;
      var types = s.type === undefined ? null : [].concat(s.type);
      if (v === null && (s.nullable === true || (types && types.indexOf("null") >= 0))) return;
      if (types && !types.some(function (t) { return typeOk(t, v); })) {
        return push(path, "型は " + types.join(" か ") + " のはずが " + kind(v) + " でした (" + show(v) + ")");
      }
      if (Array.isArray(s.enum) && !s.enum.some(function (e) { return same(e, v); })) {
        push(path, "決められた値 (" + s.enum.map(show).join(", ") + ") のどれでもありません: " + show(v));
      }
      if (s.const !== undefined && !same(s.const, v)) push(path, show(s.const) + " のはずが " + show(v) + " でした");
      if (typeof v === "string") {
        var len = Array.from(v).length;
        if (typeof s.minLength === "number" && len < s.minLength) push(path, s.minLength + "文字以上のはずが " + len + "文字でした");
        if (typeof s.maxLength === "number" && len > s.maxLength) push(path, s.maxLength + "文字以下のはずが " + len + "文字でした");
        if (typeof s.pattern === "string") {
          var re = null;
          try { re = new RegExp(s.pattern, "u"); } catch (e) { try { re = new RegExp(s.pattern); } catch (e2) { re = null; } }
          if (re && !re.test(v)) push(path, "パターン /" + s.pattern + "/ に合いません: " + show(v));
        }
        if (s.format && FORMATS[s.format] && !FORMATS[s.format].test(v)) push(path, s.format + " の形ではありません: " + show(v));
      }
      if (typeof v === "number") {
        if (typeof s.minimum === "number" && (s.exclusiveMinimum === true ? v <= s.minimum : v < s.minimum)) {
          push(path, (s.exclusiveMinimum === true ? s.minimum + " より大きい" : s.minimum + " 以上の") + "はずが " + v + " でした");
        }
        if (typeof s.maximum === "number" && (s.exclusiveMaximum === true ? v >= s.maximum : v > s.maximum)) {
          push(path, (s.exclusiveMaximum === true ? s.maximum + " より小さい" : s.maximum + " 以下の") + "はずが " + v + " でした");
        }
        if (typeof s.exclusiveMinimum === "number" && v <= s.exclusiveMinimum) push(path, s.exclusiveMinimum + " より大きいはずが " + v + " でした");
        if (typeof s.exclusiveMaximum === "number" && v >= s.exclusiveMaximum) push(path, s.exclusiveMaximum + " より小さいはずが " + v + " でした");
        if (typeof s.multipleOf === "number" && s.multipleOf > 0) {
          var q = v / s.multipleOf;
          if (Math.abs(q - Math.round(q)) > 1e-9) push(path, s.multipleOf + " の倍数ではありません: " + v);
        }
      }
      if (Array.isArray(v)) {
        if (typeof s.minItems === "number" && v.length < s.minItems) push(path, "要素が " + s.minItems + " 個以上のはずが " + v.length + " 個でした");
        if (typeof s.maxItems === "number" && v.length > s.maxItems) push(path, "要素が " + s.maxItems + " 個以下のはずが " + v.length + " 個でした");
        if (s.uniqueItems === true) {
          var seen = {};
          for (var u = 0; u < v.length; u++) {
            var key = JSON.stringify(v[u]);
            if (seen[key]) { push(path, "同じ要素が重なっています: " + show(v[u])); break; }
            seen[key] = true;
          }
        }
        if (s.items && typeof s.items === "object" && !Array.isArray(s.items)) {
          for (var n = 0; n < v.length && errors.length < MAX_ERRORS; n++) check(s.items, v[n], path + "[" + n + "]", depth + 1);
        }
      }
      if (v && typeof v === "object" && !Array.isArray(v)) {
        var props = s.properties || {};
        if (Array.isArray(s.required)) {
          for (var r = 0; r < s.required.length; r++) {
            var name = s.required[r];
            if (Object.prototype.hasOwnProperty.call(v, name)) continue;
            var ps = props[name] ? resolve(props[name]) : null;
            if (ps && ps.writeOnly) continue; // 書きこみ専用の項目はレスポンスに出なくてよい
            push(path, "必須の項目 \"" + name + "\" がありません");
          }
        }
        var keys = Object.keys(v);
        for (var k = 0; k < keys.length && errors.length < MAX_ERRORS; k++) {
          var kname = keys[k];
          var sub = path + "." + kname;
          if (Object.prototype.hasOwnProperty.call(props, kname)) check(props[kname], v[kname], sub, depth + 1);
          else if (s.additionalProperties === false) push(path, "仕様にない項目 \"" + kname + "\" があります");
          else if (s.additionalProperties && typeof s.additionalProperties === "object") check(s.additionalProperties, v[kname], sub, depth + 1);
        }
        if (typeof s.minProperties === "number" && keys.length < s.minProperties) push(path, "項目が " + s.minProperties + " 個以上のはずが " + keys.length + " 個でした");
        if (typeof s.maxProperties === "number" && keys.length > s.maxProperties) push(path, "項目が " + s.maxProperties + " 個以下のはずが " + keys.length + " 個でした");
      }
      if (Array.isArray(s.allOf)) for (var a = 0; a < s.allOf.length; a++) check(s.allOf[a], v, path, depth + 1);
      var alts = Array.isArray(s.oneOf) ? s.oneOf : Array.isArray(s.anyOf) ? s.anyOf : null;
      if (alts) {
        var hit = false;
        for (var b = 0; b < alts.length && !hit; b++) if (passes(alts[b], v, path, depth + 1)) hit = true;
        if (!hit) push(path, (s.oneOf ? "oneOf" : "anyOf") + " の選択肢のどれにも当てはまりません");
      }
      if (s.not && passes(s.not, v, path, depth + 1)) push(path, "not で禁止された形になっています");
    }
    check(schema, value, "$", 0);
    return errors;
  }

  // テストケースのリクエストを、fetch に渡せる URL と設定に変える
  function buildRequest(req, baseUrl, params, credentials, schemes) {
    params = params || {};
    credentials = credentials || {};
    schemes = schemes || {};
    function enc(v) {
      return encodeURIComponent(v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));
    }
    function b64(text) {
      var bytes = unescape(encodeURIComponent(text));
      if (typeof btoa === "function") return btoa(bytes);
      return Buffer.from(text, "utf8").toString("base64");
    }
    var path = String(req.path).replace(/\{([^}]+)\}/g, function (_, name) {
      var has = req.pathParams && Object.prototype.hasOwnProperty.call(req.pathParams, name);
      return enc(has ? req.pathParams[name] : params[name]);
    });
    var url = String(baseUrl || "").replace(/\/+$/, "") + path;
    var qs = [];
    var headers = {};
    var cookies = [];
    function addQuery(k, v) {
      if (v === undefined) return;
      if (Array.isArray(v)) v.forEach(function (x) { qs.push(enc(k) + "=" + enc(x)); });
      else if (v && typeof v === "object") Object.keys(v).forEach(function (sub) { qs.push(enc(k + "[" + sub + "]") + "=" + enc(v[sub])); });
      else qs.push(enc(k) + "=" + enc(v));
    }
    Object.keys(req.query || {}).forEach(function (k) { addQuery(k, req.query[k]); });
    Object.keys(req.headers || {}).forEach(function (k) {
      var v = req.headers[k];
      if (v !== undefined) headers[k] = Array.isArray(v) ? v.join(",") : String(v);
    });
    Object.keys(req.cookies || {}).forEach(function (k) { cookies.push(k + "=" + enc(req.cookies[k])); });
    (req.auth || []).forEach(function (name) {
      var s = schemes[name];
      var c = credentials[name] || {};
      if (!s) return;
      if (s.kind === "bearer" && c.token) headers["Authorization"] = "Bearer " + c.token;
      else if (s.kind === "basic" && c.user) headers["Authorization"] = "Basic " + b64(c.user + ":" + (c.password || ""));
      else if (s.kind === "apiKey" && c.key) {
        if (s.in === "query") qs.push(enc(s.name) + "=" + enc(c.key));
        else if (s.in === "cookie") cookies.push(s.name + "=" + enc(c.key));
        else headers[s.name] = c.key;
      }
    });
    if (cookies.length) headers["Cookie"] = cookies.join("; ");
    if (!headers["Accept"]) headers["Accept"] = "application/json";
    var init = { method: String(req.method).toUpperCase(), headers: headers };
    if (req.body !== undefined) {
      var ct = req.contentType || "application/json";
      if (/json/i.test(ct)) {
        init.body = JSON.stringify(req.body);
        headers["Content-Type"] = ct;
      } else if (/x-www-form-urlencoded/i.test(ct) && req.body && typeof req.body === "object") {
        init.body = Object.keys(req.body).map(function (k) { return enc(k) + "=" + enc(req.body[k]); }).join("&");
        headers["Content-Type"] = ct;
      } else if (/multipart\/form-data/i.test(ct) && typeof FormData === "function" && req.body && typeof req.body === "object") {
        var fd = new FormData();
        Object.keys(req.body).forEach(function (k) {
          var v = req.body[k];
          fd.append(k, v && typeof v === "object" ? JSON.stringify(v) : String(v));
        });
        init.body = fd; // Content-Type は区切り文字つきで自動で付く
      } else {
        init.body = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
        headers["Content-Type"] = ct;
      }
    }
    return { url: url + (qs.length ? (url.indexOf("?") >= 0 ? "&" : "?") + qs.join("&") : ""), init: init };
  }

  // 期待するステータス（"200" や "4XX"）に当てはまるか
  function statusMatches(status, expected) {
    var code = String(status);
    return expected.some(function (e) {
      e = String(e).toUpperCase();
      return e === code || (e.length === 3 && e.slice(1) === "XX" && e[0] === code[0]);
    });
  }

  // 実際のステータスに対応するレスポンスのスキーマを探す（"201" → "2XX" → "default" の順）
  function pickResponseSchema(status, responses) {
    if (!responses) return null;
    var code = String(status);
    if (responses[code]) return responses[code];
    if (responses[code[0] + "XX"]) return responses[code[0] + "XX"];
    return responses["DEFAULT"] || responses["default"] || null;
  }

  const api = { validateSchema, buildRequest, statusMatches, pickResponseSchema };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else (root.ApiTestGen = root.ApiTestGen || {}).runtime = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
