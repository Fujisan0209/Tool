/*
 * スキーマから「正しい値」「境界ちょうどの値」「まちがった値」を作ります。
 * 毎回同じ値になるように、乱数は使いません（テストの結果が再現できるように）。
 */
(function (root) {
  "use strict";
  const isNode = typeof module !== "undefined" && module.exports;

  const MAX_DEPTH = 6;
  const FORMAT_SAMPLES = {
    "date-time": "2024-04-01T09:30:00Z",
    date: "2024-04-01",
    time: "09:30:00",
    email: "taro@example.com",
    "idn-email": "taro@example.com",
    uuid: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    uri: "https://example.com/",
    url: "https://example.com/",
    "uri-reference": "/example",
    hostname: "example.com",
    ipv4: "192.0.2.10",
    ipv6: "2001:db8::10",
    byte: "ZXhhbXBsZQ==",
    binary: "example",
    password: "Passw0rd!",
  };
  const FORMAT_INVALID = {
    "date-time": "2024-13-45T99:00:00",
    date: "2024-13-45",
    email: "not-an-email",
    "idn-email": "not-an-email",
    uuid: "not-a-uuid",
    uri: "not a uri",
    url: "not a url",
    ipv4: "999.1.1",
  };

  function typeList(s) {
    if (s.type === undefined) return [];
    return [].concat(s.type);
  }
  // 値の型を1つに決める（3.1 の ["string","null"] にも対応）
  function mainType(s) {
    const t = typeList(s).filter((x) => x !== "null");
    if (t.length) return t[0];
    if (s.properties || s.additionalProperties) return "object";
    if (s.items) return "array";
    if (Array.isArray(s.enum) && s.enum.length) {
      const v = s.enum.find((x) => x !== null);
      if (typeof v === "number") return Number.isInteger(v) ? "integer" : "number";
      if (typeof v === "boolean") return "boolean";
      return "string";
    }
    if (s.const !== undefined) return typeof s.const === "number" ? "number" : typeof s.const;
    if (s.format && FORMAT_SAMPLES[s.format]) return "string";
    return undefined;
  }

  // $ref をたどり、allOf を1つにまとめた「平らな」スキーマを返す
  function flatten(schema, R, depth) {
    depth = depth || 0;
    let s = R.deref(schema);
    if (s === true || s == null) return {};
    if (typeof s !== "object") return {};
    if (!Array.isArray(s.allOf) || depth > MAX_DEPTH) return s;
    const out = { ...s };
    delete out.allOf;
    out.properties = { ...(s.properties || {}) };
    out.required = [...(s.required || [])];
    for (const part of s.allOf) {
      const f = flatten(part, R, depth + 1);
      Object.assign(out.properties, f.properties || {});
      for (const r of f.required || []) if (!out.required.includes(r)) out.required.push(r);
      for (const [k, v] of Object.entries(f)) {
        if (k === "properties" || k === "required") continue;
        if (out[k] === undefined) out[k] = v;
      }
    }
    if (!Object.keys(out.properties).length) delete out.properties;
    if (!out.required.length) delete out.required;
    return out;
  }

  // oneOf / anyOf は最初の選択肢を使う（共通部分とまとめる）
  function chooseVariant(s, R, depth) {
    const list = Array.isArray(s.oneOf) ? s.oneOf : Array.isArray(s.anyOf) ? s.anyOf : null;
    if (!list || !list.length) return s;
    const first = flatten(list.find((x) => mainType(flatten(x, R, depth)) !== "null") || list[0], R, depth + 1);
    const base = { ...s };
    delete base.oneOf;
    delete base.anyOf;
    return {
      ...first,
      ...base,
      properties: { ...(first.properties || {}), ...(base.properties || {}) },
      required: [...new Set([...(first.required || []), ...(base.required || [])])],
    };
  }

  // ---------- 正規表現からそれに合う文字列を作る（よくある形だけ） ----------
  function sampleFromPattern(pattern) {
    let i = 0;
    const src = pattern;
    function parseAlt() {
      const branches = [parseSeq()];
      while (src[i] === "|") {
        i++;
        branches.push(parseSeq());
      }
      return branches[0];
    }
    function parseSeq() {
      let out = "";
      while (i < src.length && src[i] !== "|" && src[i] !== ")") {
        let atom = parseAtom();
        const q = parseQuant();
        if (q === null) out += atom.one();
        else {
          let s = "";
          for (let k = 0; k < q; k++) s += atom.one(k);
          out += s;
        }
      }
      return out;
    }
    function parseQuant() {
      const c = src[i];
      if (c === "*") { i++; skipLazy(); return 0; }
      if (c === "+") { i++; skipLazy(); return 1; }
      if (c === "?") { i++; skipLazy(); return 0; }
      if (c === "{") {
        const m = /^\{(\d+)(,(\d*))?\}/.exec(src.slice(i));
        if (m) {
          i += m[0].length;
          skipLazy();
          return Number(m[1]);
        }
      }
      return null;
    }
    function skipLazy() { if (src[i] === "?") i++; }
    const lit = (ch) => ({ one: () => ch });
    function escapeAtom(c) {
      if (c === "d") return lit("1");
      if (c === "w") return lit("a");
      if (c === "s") return lit(" ");
      if (c === "D" || c === "W" || c === "S") return lit("-");
      if (c === "b" || c === "B") return lit("");
      if (c === "u") {
        const m = /^[0-9a-fA-F]{4}/.exec(src.slice(i));
        if (m) { i += 4; return lit(String.fromCharCode(parseInt(m[0], 16))); }
      }
      return lit(c);
    }
    function parseAtom() {
      const c = src[i++];
      if (c === "^" || c === "$") return lit("");
      if (c === ".") return lit("a");
      if (c === "\\") return escapeAtom(src[i++]);
      if (c === "(") {
        if (src[i] === "?") {
          // (?:...) (?=...) など
          i++;
          const kind = src[i++];
          if (kind === "<" && src[i] !== "=" && src[i] !== "!") {
            while (i < src.length && src[i] !== ">") i++;
            i++;
          } else if (kind === "=" || kind === "!" || kind === "<") {
            if (kind === "<") i++;
            let depth = 1;
            while (i < src.length && depth) {
              if (src[i] === "\\") i++;
              else if (src[i] === "(") depth++;
              else if (src[i] === ")") depth--;
              i++;
            }
            return lit("");
          }
        }
        const inner = parseAlt();
        if (src[i] === ")") i++;
        return lit(inner);
      }
      if (c === "[") {
        let negate = false;
        if (src[i] === "^") { negate = true; i++; }
        const chars = [];
        let first = true;
        while (i < src.length && (src[i] !== "]" || first)) {
          first = false;
          let ch = src[i++];
          if (ch === "\\") {
            const e = src[i++];
            ch = e === "d" ? "1" : e === "w" ? "a" : e === "s" ? " " : e;
          }
          if (src[i] === "-" && src[i + 1] && src[i + 1] !== "]") {
            i++;
            let end = src[i++];
            if (end === "\\") end = src[i++];
            chars.push([ch, end]);
          } else chars.push([ch, ch]);
        }
        i++;
        if (negate) {
          const banned = (x) => chars.some(([a, b]) => x >= a && x <= b);
          const pick = ["a", "1", "Z", "_", "-", "x"].find((x) => !banned(x)) || "~";
          return lit(pick);
        }
        // 範囲の最初の文字を使い、繰り返すときは少しずつずらす
        return {
          one: (k) => {
            const [a, b] = chars[0] || ["a", "a"];
            const span = b.charCodeAt(0) - a.charCodeAt(0) + 1;
            return String.fromCharCode(a.charCodeAt(0) + ((k || 0) % Math.max(span, 1)));
          },
        };
      }
      return lit(c);
    }
    try {
      return parseAlt();
    } catch (e) {
      return null;
    }
  }

  function safeRegExp(pattern) {
    try {
      return new RegExp(pattern, "u");
    } catch (e) {
      try {
        return new RegExp(pattern);
      } catch (e2) {
        return null;
      }
    }
  }

  function fitLength(str, s) {
    let out = str;
    const min = s.minLength || 0;
    const max = s.maxLength;
    if ([...out].length < min) out = out + "a".repeat(min - [...out].length);
    if (max != null && [...out].length > max) out = [...out].slice(0, max).join("");
    return out;
  }

  function guessByName(name) {
    const n = String(name || "").toLowerCase();
    if (/e-?mail/.test(n)) return "taro@example.com";
    if (/(^|_)(url|uri|website|homepage)$/.test(n) || /url$/.test(n)) return "https://example.com/";
    if (/phone|tel/.test(n)) return "03-1234-5678";
    if (/date$/.test(n) || /_on$/.test(n)) return null;
    return null;
  }

  function sampleString(s, name) {
    let v;
    if (s.format && FORMAT_SAMPLES[s.format]) v = FORMAT_SAMPLES[s.format];
    else v = guessByName(name) || (name ? String(name).replace(/[^A-Za-z0-9]/g, "").toLowerCase() || "example" : "example");
    if (s.pattern) {
      const re = safeRegExp(s.pattern);
      if (re && !re.test(v)) {
        const fromPattern = sampleFromPattern(s.pattern);
        if (fromPattern != null && re.test(fromPattern)) v = fromPattern;
      }
      const fitted = fitLength(v, s);
      if (!re || re.test(fitted)) return fitted;
      return v;
    }
    return fitLength(v, s);
  }

  function bounds(s, integer) {
    let lo = typeof s.minimum === "number" ? s.minimum : null;
    let hi = typeof s.maximum === "number" ? s.maximum : null;
    const step = integer ? 1 : 0.5;
    if (s.exclusiveMinimum === true && lo != null) lo += step;
    if (typeof s.exclusiveMinimum === "number") lo = s.exclusiveMinimum + step;
    if (s.exclusiveMaximum === true && hi != null) hi -= step;
    if (typeof s.exclusiveMaximum === "number") hi = s.exclusiveMaximum - step;
    return { lo, hi };
  }

  function sampleNumber(s, integer) {
    const { lo, hi } = bounds(s, integer);
    let v = integer ? 1 : 1.5;
    if (lo != null && v < lo) v = lo;
    if (hi != null && v > hi) v = hi;
    if (typeof s.multipleOf === "number" && s.multipleOf > 0) {
      const m = s.multipleOf;
      v = Math.ceil(v / m) * m;
      if (hi != null && v > hi) v = Math.floor(hi / m) * m;
      v = Number(v.toFixed(10));
    }
    if (integer) v = Math.round(v);
    return v;
  }

  function sampleValue(schema, R, opts) {
    opts = opts || {};
    const depth = opts.depth || 0;
    const purpose = opts.purpose || "request";
    if (depth > MAX_DEPTH) return null;
    let s = flatten(schema, R, depth);
    if (s.const !== undefined) return clone(s.const);
    if (s.example !== undefined) return clone(s.example);
    if (Array.isArray(s.examples) && s.examples.length) return clone(s.examples[0]);
    if (s.default !== undefined) return clone(s.default);
    if (Array.isArray(s.enum) && s.enum.length) {
      const v = s.enum.find((x) => x !== null);
      return clone(v === undefined ? s.enum[0] : v);
    }
    s = chooseVariant(s, R, depth);
    if (s.example !== undefined) return clone(s.example);
    const t = mainType(s);
    if (t === "string") return sampleString(s, opts.name);
    if (t === "integer") return sampleNumber(s, true);
    if (t === "number") return sampleNumber(s, false);
    if (t === "boolean") return true;
    if (t === "null") return null;
    if (t === "array") {
      let n = Math.max(s.minItems || 0, 1);
      if (s.maxItems != null) n = Math.min(n, s.maxItems);
      if (depth >= 4) n = Math.min(n, s.minItems || 0);
      const items = flatten(s.items || {}, R, depth + 1);
      const out = [];
      for (let k = 0; k < n; k++) {
        let v = sampleValue(items, R, { depth: depth + 1, purpose, name: opts.name });
        if (s.uniqueItems && k > 0) {
          if (Array.isArray(items.enum) && items.enum[k] !== undefined) v = clone(items.enum[k]);
          else if (typeof v === "number") v = v + k;
          else if (typeof v === "string") v = v + k;
        }
        out.push(v);
      }
      return out;
    }
    if (t === "object" || t === undefined) {
      const props = s.properties || {};
      const required = new Set(s.required || []);
      const out = {};
      for (const [name, ps] of Object.entries(props)) {
        const p = flatten(ps, R, depth + 1);
        if (purpose === "request" && p.readOnly) continue;
        if (purpose === "response" && p.writeOnly) continue;
        // 深いところでは必須の項目だけにする（大きくなりすぎないように）
        if (depth >= 2 && !required.has(name)) continue;
        out[name] = sampleValue(ps, R, { depth: depth + 1, purpose, name });
      }
      if (!Object.keys(props).length && s.additionalProperties && typeof s.additionalProperties === "object") {
        out.key = sampleValue(s.additionalProperties, R, { depth: depth + 1, purpose });
      }
      if (t === undefined && !Object.keys(out).length) return "example";
      return out;
    }
    return "example";
  }

  function clone(v) {
    return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
  }

  function fmtNum(n) {
    return String(n);
  }

  /*
   * 受け付けられるはずの「境界ちょうど」の値。
   * [{ label, value }]
   */
  function boundaryValues(schema, R) {
    const s = chooseVariant(flatten(schema, R), R, 0);
    const t = mainType(s);
    const out = [];
    if (Array.isArray(s.enum) && s.enum.length > 1) {
      const last = s.enum[s.enum.length - 1];
      if (last !== null) out.push({ label: `enum の最後の値 ${JSON.stringify(last)}`, value: clone(last) });
      return out;
    }
    if (t === "integer" || t === "number") {
      const integer = t === "integer";
      const { lo, hi } = bounds(s, integer);
      const okMul = (v) => typeof s.multipleOf !== "number" || Math.abs(v / s.multipleOf - Math.round(v / s.multipleOf)) < 1e-9;
      if (lo != null && okMul(lo)) out.push({ label: `最小値ちょうど (${fmtNum(lo)})`, value: lo });
      if (hi != null && okMul(hi) && hi !== lo) out.push({ label: `最大値ちょうど (${fmtNum(hi)})`, value: hi });
    } else if (t === "string" && !s.pattern && !s.format) {
      if (s.minLength > 0) out.push({ label: `最小の長さちょうど (${s.minLength}文字)`, value: "a".repeat(s.minLength) });
      if (s.maxLength != null && s.maxLength !== s.minLength && s.maxLength <= 10000) {
        out.push({ label: `最大の長さちょうど (${s.maxLength}文字)`, value: "a".repeat(s.maxLength) });
      }
    }
    return out;
  }

  /*
   * 受け付けられないはずの値。
   * where: "body"（JSON の中）か "param"（URL やヘッダー。すべて文字列で送られる）
   * [{ group: "invalid"|"format", label, value }]
   */
  function invalidValues(schema, R, where) {
    const s = chooseVariant(flatten(schema, R), R, 0);
    const t = mainType(s);
    const out = [];
    const nullable = s.nullable === true || typeList(s).includes("null");
    const add = (group, label, value) => out.push({ group, label, value });

    if (t === "integer" || t === "number") {
      add("invalid", "数値ではない文字列 \"abc\"", "abc");
      if (t === "integer") add("invalid", "整数ではない値 1.5", where === "param" ? "1.5" : 1.5);
      const integer = t === "integer";
      const { lo, hi } = bounds(s, integer);
      const d = integer ? 1 : 0.5;
      if (lo != null) {
        const v = typeof s.exclusiveMinimum === "number" ? s.exclusiveMinimum : s.exclusiveMinimum === true ? s.minimum : lo - d;
        add("invalid", `最小値 ${fmtNum(lo)} より小さい ${fmtNum(v)}`, v);
      }
      if (hi != null) {
        const v = typeof s.exclusiveMaximum === "number" ? s.exclusiveMaximum : s.exclusiveMaximum === true ? s.maximum : hi + d;
        add("invalid", `最大値 ${fmtNum(hi)} より大きい ${fmtNum(v)}`, v);
      }
      if (Array.isArray(s.enum) && s.enum.length) {
        const nums = s.enum.filter((x) => typeof x === "number");
        if (nums.length) add("invalid", "enum にない値", Math.max(...nums) + 1);
      }
    } else if (t === "boolean") {
      add("invalid", "true/false ではない値 \"maybe\"", "maybe");
    } else if (t === "string") {
      if (where === "body") add("invalid", "文字列ではなく数値 12345", 12345);
      if (Array.isArray(s.enum) && s.enum.length) add("invalid", "enum にない値 \"__invalid__\"", "__invalid__");
      if (s.minLength > 0) add("invalid", `最小の長さ ${s.minLength} より短い (${s.minLength - 1}文字)`, "a".repeat(s.minLength - 1));
      if (s.maxLength != null && s.maxLength <= 10000) {
        add("invalid", `最大の長さ ${s.maxLength} より長い (${s.maxLength + 1}文字)`, "a".repeat(s.maxLength + 1));
      }
      if (s.pattern) {
        const re = safeRegExp(s.pattern);
        const bad = ["!!!", "", "a b c", "0", "ZZZ"].find((x) => re && !re.test(x));
        if (bad !== undefined) add("invalid", `パターン /${s.pattern}/ に合わない ${JSON.stringify(bad)}`, bad);
      }
      if (s.format && FORMAT_INVALID[s.format]) {
        add("format", `${s.format} の形ではない ${JSON.stringify(FORMAT_INVALID[s.format])}`, FORMAT_INVALID[s.format]);
      }
    } else if (t === "array" && where === "body") {
      add("invalid", "配列ではなく文字列", "not-an-array");
      if (s.minItems > 0) add("invalid", `要素が最小数 ${s.minItems} より少ない`, []);
      if (s.maxItems != null && s.maxItems < 1000) {
        const item = sampleValue(s.items || {}, R, {});
        add("invalid", `要素が最大数 ${s.maxItems} より多い`, Array.from({ length: s.maxItems + 1 }, () => clone(item)));
      }
    } else if (t === "object" && where === "body") {
      add("invalid", "オブジェクトではなく文字列", "not-an-object");
    }
    if (where === "body" && !nullable && t && t !== "null") {
      add("invalid", "null", null);
    }
    return out;
  }

  // パスパラメータに入れる「存在しないはずの値」
  function missingValue(schema, R) {
    const s = flatten(schema, R);
    const t = mainType(s);
    if (t === "integer" || t === "number") {
      const { hi } = bounds(s, true);
      return hi != null ? hi : 999999999;
    }
    if (s.format === "uuid") return "00000000-0000-0000-0000-000000000000";
    if (s.pattern) {
      const v = sampleFromPattern(s.pattern);
      const re = safeRegExp(s.pattern);
      if (v && re && re.test(v)) return v.replace(/[0-9]/g, "9");
    }
    return "does-not-exist-404";
  }

  const api = { sampleValue, boundaryValues, invalidValues, missingValue, flatten, mainType, sampleFromPattern, chooseVariant };
  if (isNode) module.exports = api;
  else (root.ApiTestGen = root.ApiTestGen || {}).sample = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
