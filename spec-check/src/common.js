/*
 * 共通の小道具: 名前の正規化・あいまい検索・型の読み取りと比較。
 * DOM は使いません（Node でもテストできます）。
 */
(function (root) {
  "use strict";

  /** 大文字小文字と _ - $ の違いを無視した名前（calc_total と calcTotal を同じとみなす） */
  function normName(s) {
    return String(s || "").toLowerCase().replace(/[_\-$\s]/g, "");
  }

  /** 編集距離。max を超えたら途中で打ち切って max+1 を返す */
  function editDistance(a, b, max) {
    if (a === b) return 0;
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev = new Array(b.length + 1);
    let cur = new Array(b.length + 1);
    for (let j = 0; j <= b.length; j++) prev[j] = j;
    for (let i = 1; i <= a.length; i++) {
      cur[0] = i;
      let rowMin = i;
      for (let j = 1; j <= b.length; j++) {
        const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
        if (cur[j] < rowMin) rowMin = cur[j];
      }
      if (rowMin > max) return max + 1;
      [prev, cur] = [cur, prev];
    }
    return prev[b.length];
  }

  /**
   * candidates の中から name にいちばん近いものを返す（なければ null）。
   * 書き方だけ違う（normName が同じ）ものを最優先し、次に打ちまちがいらしいものを探す。
   */
  function closest(name, candidates) {
    const n = normName(name);
    if (!n) return null;
    const limit = n.length <= 4 ? 1 : n.length <= 9 ? 2 : 3;
    let best = null;
    let bestD = limit + 1;
    for (const c of candidates) {
      if (c === name) continue;
      const cn = normName(c);
      if (cn === n) return { name: c, dist: 0 };
      if (Math.abs(cn.length - n.length) > limit) continue;
      const d = editDistance(n, cn, limit);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best ? { name: best, dist: bestD } : null;
  }

  // ---------------------------------------------------------------- 型

  // [おおまかな種類, 細かい種類]。細かい種類が null なら、おおまかな種類だけで比べる
  const BASE_TYPES = {
    int: ["int", "int"], integer: ["int", "int"], long: ["int", "long"], short: ["int", "short"],
    byte: ["int", "byte"], bigint: ["int", "bigint"], biginteger: ["int", "bigint"], uint: ["int", "int"],
    float: ["float", "float"], double: ["float", "double"], decimal: ["float", "decimal"],
    bigdecimal: ["float", "decimal"], number: ["number", null],
    string: ["string", null], str: ["string", null], charsequence: ["string", null], text: ["string", null],
    char: ["char", null], character: ["char", null],
    boolean: ["bool", null], bool: ["bool", null],
    void: ["void", null], none: ["void", null], undefined: ["void", null], never: ["void", null], unit: ["void", null],
    any: ["any", null], object: ["any", null], unknown: ["any", null], t: ["any", null],
    list: ["list", null], arraylist: ["list", null], linkedlist: ["list", null], array: ["list", null],
    collection: ["list", null], iterable: ["list", null], sequence: ["list", null], readonlyarray: ["list", null],
    tuple: ["list", null], stream: ["list", null],
    set: ["set", null], hashset: ["set", null], treeset: ["set", null], linkedhashset: ["set", null], frozenset: ["set", null],
    map: ["map", null], hashmap: ["map", null], treemap: ["map", null], linkedhashmap: ["map", null],
    dict: ["map", null], record: ["map", null], mapping: ["map", null], object_: ["map", null],
    date: ["date", "date"], localdate: ["date", "date"], localdatetime: ["date", "datetime"],
    datetime: ["date", "datetime"], instant: ["date", "datetime"], zoneddatetime: ["date", "datetime"],
    offsetdatetime: ["date", "datetime"], timestamp: ["date", "datetime"],
  };
  // 中身だけを見ればよい入れ物（非同期・Optional）
  const UNWRAP = new Set(["promise", "completablefuture", "future", "mono", "awaitable", "coroutine", "optional", "nullable", "responseentity"]);
  const NULLISH = new Set(["null", "undefined", "none", "nil"]);

  const JA_TYPES = [
    [/^(?:整数|整数値|int型)$/, "int"], [/^(?:長整数)$/, "long"], [/^(?:数値|数)$/, "number"],
    [/^(?:小数|実数|浮動小数点数?|小数値)$/, "double"], [/^(?:文字列|テキスト|文字列型)$/, "string"],
    [/^(?:文字)$/, "char"], [/^(?:真偽値?|論理値|ブール値?|ブーリアン|フラグ)$/, "boolean"],
    [/^(?:なし|無し|ない|-|－|―|ー)$/, "void"], [/^(?:日付)$/, "date"], [/^(?:日時|日付時刻)$/, "datetime"],
    [/^(?:配列|リスト|一覧)$/, "list"], [/^(?:辞書|マップ|連想配列)$/, "map"], [/^(?:集合|セット)$/, "set"],
    [/^(?:任意|オブジェクト)$/, "any"],
  ];

  function splitTop(s, sep) {
    const out = [];
    let depth = 0;
    let cur = "";
    for (const ch of s) {
      if ("<([{".includes(ch)) depth++;
      else if (">)]}".includes(ch)) depth--;
      if (ch === sep && depth === 0) {
        out.push(cur);
        cur = "";
      } else cur += ch;
    }
    out.push(cur);
    return out.map((x) => x.trim()).filter(Boolean);
  }

  /**
   * 型の文字列を読む。lang は "python" / "ts" / "java" / "spec" など。
   * 戻り値: { raw, coarse, fine, name, args, nullable } または null
   */
  function parseType(str, lang) {
    if (str === null || str === undefined) return null;
    let s = String(str).normalize("NFKC").replace(/`/g, "").trim();
    s = s.replace(/^(?:final|const|readonly)\s+/, "").replace(/\s+/g, " ");
    if (!s) return null;
    const raw = s;
    let nullable = false;

    // 日本語: 「文字列のリスト」「整数の配列」
    let m = s.match(/^(.+?)の(?:リスト|配列|一覧)$/);
    if (m) {
      const inner = parseType(m[1], lang);
      return { raw, coarse: "list", fine: null, name: "list", args: inner ? [inner] : [], nullable };
    }
    m = s.match(/^(.+?)(?:リスト|配列)$/);
    if (m && !/^(?:リスト|配列)$/.test(s)) {
      const inner = parseType(m[1], lang);
      if (inner) return { raw, coarse: "list", fine: null, name: "list", args: [inner], nullable };
    }

    if (s.endsWith("?")) {
      nullable = true;
      s = s.slice(0, -1).trim();
    }
    // ユニオン（int | None など）
    const parts = splitTop(s, "|");
    if (parts.length > 1) {
      const rest = parts.filter((p) => !NULLISH.has(p.toLowerCase()));
      if (rest.length < parts.length) nullable = true;
      if (rest.length === 1) s = rest[0];
      else if (rest.length > 1 && rest.every((p) => /^(['"]).*\1$/.test(p)))
        return { raw, coarse: "string", fine: null, name: "string", args: [], nullable };
      else if (rest.length > 1) return { raw, coarse: "other", fine: null, name: rest.map(normName).sort().join("|"), args: [], nullable };
    }
    // 配列 T[] / T...
    if (/(\[\]|\.\.\.)$/.test(s)) {
      const inner = parseType(s.replace(/(\[\]|\.\.\.)$/, ""), lang);
      return { raw, coarse: "list", fine: null, name: "list", args: inner ? [inner] : [], nullable };
    }
    // ジェネリクス Name<...> / Name[...]
    let name = s;
    let args = [];
    m = s.match(/^([\w$.]+)\s*[<[](.*)[>\]]$/);
    if (m) {
      name = m[1];
      args = splitTop(m[2], ",").map((a) => parseType(a.replace(/^\?\s*(?:extends|super)\s+/, ""), lang)).filter(Boolean);
    }
    let key = name.split(".").pop().toLowerCase();
    if (UNWRAP.has(key)) {
      const inner = args[0] || null;
      if (key === "optional" || key === "nullable") nullable = true;
      if (!inner) return { raw, coarse: "any", fine: null, name: "any", args: [], nullable };
      return { ...inner, raw, nullable: nullable || inner.nullable };
    }
    let fromJa = false;
    for (const [re, to] of JA_TYPES) if (re.test(name)) { key = to; fromJa = true; }
    if (key === "object" && lang === "ts") key = "object_";
    let base = BASE_TYPES[key];
    if (base && ((lang === "python" && (key === "int" || key === "float")) || fromJa)) base = [base[0], null];
    if (base && lang === "ts" && key === "object_") base = ["map", null];
    if (!base) return { raw, coarse: "other", fine: null, name: normName(name.split(".").pop()), args, nullable };
    return { raw, coarse: base[0], fine: base[1], name: key, args, nullable };
  }

  const RANK = { same: 0, unknown: 0, minor: 1, diff: 2 };
  function worse(a, b) {
    return RANK[b] > RANK[a] ? b : a;
  }

  /**
   * 2つの型を比べる。"same" | "minor"（細かい違い: int と long など） | "diff" | "unknown"
   */
  function compareTypes(a, b) {
    if (!a || !b) return "unknown";
    if (a.coarse === "any" || b.coarse === "any") return "unknown";
    const num = (t) => t.coarse === "int" || t.coarse === "float" || t.coarse === "number";
    if (a.coarse === "number" || b.coarse === "number") return num(a) && num(b) ? "same" : "diff";
    if (a.coarse !== b.coarse) {
      const pair = [a.coarse, b.coarse].sort().join(",");
      if (pair === "char,string" || pair === "list,set" || pair === "float,int") return pair === "float,int" ? "diff" : "minor";
      return "diff";
    }
    let res = "same";
    if (a.coarse === "other") res = a.name === b.name ? "same" : "diff";
    else if (a.fine && b.fine && a.fine !== b.fine) res = "minor";
    const n = Math.min(a.args.length, b.args.length);
    for (let i = 0; i < n; i++) {
      const r = compareTypes(a.args[i], b.args[i]);
      res = worse(res, r === "unknown" ? "same" : r);
    }
    return res;
  }

  // ---------------------------------------------------------------- 値

  /** 定数の値を比べやすい形にする。"10_000L" → 10000、'abc' → abc */
  function normValue(v) {
    if (v === null || v === undefined) return null;
    let s = String(v).normalize("NFKC").trim().replace(/^`|`$/g, "").trim();
    if (!s) return null;
    const q = s.match(/^(['"])(.*)\1$/s) || s.match(/^「(.*)」$/s);
    if (q) return { kind: "str", v: q[q.length - 1] };
    const lower = s.toLowerCase();
    if (lower === "true" || lower === "false") return { kind: "bool", v: lower };
    if (lower === "null" || lower === "none" || lower === "nil" || lower === "undefined") return { kind: "null", v: "null" };
    const n = s.replace(/[_,]/g, "").replace(/(?<=\d)[lLfFdDn]$/, "");
    if (/^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(n)) return { kind: "num", v: String(Number(n)) };
    if (/^0x[0-9a-f]+$/i.test(n)) return { kind: "num", v: String(parseInt(n, 16)) };
    // 60 * 60 * 24 のような、数字だけの計算式は計算する
    const arith = s.replace(/(?<=\d)_(?=\d)/g, "").replace(/(?<=\d)[lLfFdD]\b/g, "");
    if (/^[\d\s+\-*/().]+$/.test(arith) && /\d\s*[-+*/]\s*[\d(]/.test(arith) && arith.length < 80) {
      try {
        const r = Function('"use strict";return (' + arith + ")")();
        if (typeof r === "number" && isFinite(r)) return { kind: "num", v: String(r) };
      } catch (e) {
        /* 計算できなければ式のまま */
      }
    }
    return { kind: "expr", v: s.replace(/\s+/g, " ") };
  }

  function sameValue(a, b) {
    const x = normValue(a);
    const y = normValue(b);
    if (!x || !y) return null;
    if (x.kind === "expr" || y.kind === "expr") return x.v === y.v ? true : null; // 式どうしは判断しない
    if (x.kind === "str" && y.kind !== "str") return x.v === y.v;
    if (y.kind === "str" && x.kind !== "str") return x.v === y.v;
    return x.kind === y.kind && x.v === y.v;
  }

  /** 識別子らしい文字列か */
  const IDENT = /^[A-Za-z_$][\w$]*$/;

  const api = { normName, editDistance, closest, parseType, compareTypes, normValue, sameValue, splitTop, IDENT };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SpecCheckCommon = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
