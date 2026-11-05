/*
 * 型のあつかい（その場チェック用）。
 *   型は { n: 名前, a: 型引数[] | null, d: 配列の次元 } で表します。わからない型は null です。
 *   ClassDB は、自分で書いたクラスと JDK のクラス（jdk-data.js）を同じように調べるための入れ物です。
 */
(function (root) {
  "use strict";

  const DATA =
    typeof module !== "undefined" && module.exports ? require("./jdk-data.js") : root.JavaJdkData;

  const PRIMS = new Set(["boolean", "byte", "short", "int", "long", "char", "float", "double", "void"]);
  const NUM_RANK = { byte: 1, short: 2, char: 2, int: 3, long: 4, float: 5, double: 6 };
  const BOX = {
    boolean: "Boolean", byte: "Byte", short: "Short", int: "Integer", long: "Long", char: "Character",
    float: "Float", double: "Double",
  };
  const UNBOX = Object.fromEntries(Object.entries(BOX).map(([k, v]) => [v, k]));

  const T = (n, a, d) => ({ n, a: a || null, d: d || 0 });
  const NULL = T("null");
  const STRING = T("String");
  const INT = T("int");
  const BOOLEAN = T("boolean");

  const isPrim = (t) => !!t && t.d === 0 && PRIMS.has(t.n);
  const isNumeric = (t) => !!t && t.d === 0 && NUM_RANK[t.n] !== undefined;
  const isIntegral = (t) => !!t && t.d === 0 && (t.n === "int" || t.n === "long" || t.n === "short" || t.n === "byte" || t.n === "char");
  const isBool = (t) => !!t && t.d === 0 && t.n === "boolean";
  const isString = (t) => !!t && t.d === 0 && t.n === "String";
  const isArray = (t) => !!t && t.d > 0;
  const isRef = (t) => !!t && !isPrim(t);
  const unboxed = (t) => (t && t.d === 0 && UNBOX[t.n] ? T(UNBOX[t.n]) : t);
  const boxed = (t) => (t && t.d === 0 && BOX[t.n] ? T(BOX[t.n]) : t);
  const numLike = (t) => isNumeric(unboxed(t));
  const boolLike = (t) => isBool(unboxed(t));
  const elem = (t) => (t && t.d > 0 ? T(t.n, t.a, t.d - 1) : null);
  const same = (a, b) => !!a && !!b && str(a) === str(b);

  function str(t) {
    if (!t) return "?";
    let s = t.n;
    if (t.a && t.a.length) s += "<" + t.a.map(str).join(", ") + ">";
    return s + "[]".repeat(t.d);
  }

  /** 二項演算の数値の型（int + long → long など） */
  function promote(a, b) {
    const x = unboxed(a);
    const y = unboxed(b);
    if (!isNumeric(x) || !isNumeric(y)) return null;
    const r = Math.max(NUM_RANK[x.n], NUM_RANK[y.n], 3);
    return T(r === 3 ? "int" : r === 4 ? "long" : r === 5 ? "float" : "double");
  }

  /** "Map.Entry<K,V>[]" のような文字列を型にする */
  function parseSig(s) {
    let i = 0;
    function one() {
      let n = "";
      while (i < s.length && /[\w.$]/.test(s[i])) n += s[i++];
      let a = null;
      if (s[i] === "<") {
        i++;
        a = [];
        while (i < s.length && s[i] !== ">") {
          a.push(one());
          if (s[i] === ",") i++;
        }
        i++;
      }
      let d = 0;
      while (s.startsWith("[]", i)) {
        d++;
        i += 2;
      }
      if (s.startsWith("...", i)) {
        d++;
        i += 3;
      }
      return T(n, a, d);
    }
    return one();
  }

  /** 型変数（E, K, V ...）を置きかえる。わからない型変数があれば null */
  function subst(t, map, tvars) {
    if (!t) return null;
    if (tvars.has(t.n)) {
      const r = map[t.n];
      if (!r) return null;
      return t.d ? T(r.n, r.a, r.d + t.d) : r;
    }
    if (!t.a) return t;
    const a = [];
    for (const x of t.a) {
      const y = subst(x, map, tvars);
      if (!y) return T(t.n, null, t.d);
      a.push(y);
    }
    return T(t.n, a, t.d);
  }

  /* ------------------------------------------------------------------ */
  /* クラスの入れ物                                                      */
  /* ------------------------------------------------------------------ */

  // パッケージ → クラス名、クラス名 → パッケージ
  const PKG_CLASSES = {};
  const CLASS_PKGS = {};
  for (const [pkg, names] of Object.entries(DATA.PACKAGES)) {
    const set = new Set(names ? names.split(" ") : []);
    PKG_CLASSES[pkg] = set;
    for (const n of set) (CLASS_PKGS[n] = CLASS_PKGS[n] || []).push(pkg);
  }
  const JAVA_LANG = PKG_CLASSES["java.lang"];

  function parseMethodSig(s) {
    const st = s.startsWith("s;");
    if (st) s = s.slice(2);
    let th = [];
    const bang = s.indexOf("!");
    if (bang >= 0) {
      th = s.slice(bang + 1).split(",");
      s = s.slice(0, bang);
    }
    const colon = s.indexOf(":");
    const ps = s.slice(0, colon);
    const ret = s.slice(colon + 1);
    const params = ps ? ps.split(",") : [];
    const varargs = params.length > 0 && params[params.length - 1].endsWith("...");
    return {
      static: st,
      params: params.map(parseSig),
      varargs,
      ret: ret ? parseSig(ret) : null,
      throws: th,
    };
  }

  const jdkCache = new Map();
  /** JDK のクラスを、自分のクラスと同じ形にする */
  function jdkClass(name) {
    if (jdkCache.has(name)) return jdkCache.get(name);
    const d = DATA.CLASSES[name];
    if (!d) {
      jdkCache.set(name, null);
      return null;
    }
    const rec = {
      name,
      pkg: d.p,
      user: false,
      kind: d.k === "i" ? "interface" : d.k === "e" ? "enum" : d.k === "a" ? "abstract" : "class",
      sup: d.sup || (d.k === "i" || name === "Object" ? null : "Object"),
      ifs: d.ifs || [],
      tp: d.tp || [],
      fields: new Map(),
      methods: new Map(),
      ctors: (d.c || []).map((c) => {
        const bang = c.indexOf("!");
        const ps = bang >= 0 ? c.slice(0, bang) : c;
        const params = ps ? ps.split(",") : [];
        return {
          params: params.map(parseSig),
          varargs: params.length > 0 && params[params.length - 1].endsWith("..."),
          throws: bang >= 0 ? c.slice(bang + 1).split(",") : [],
        };
      }),
      complete: true,
    };
    for (const [fname, ft] of Object.entries(d.f || {})) {
      const st = ft.startsWith("s;");
      rec.fields.set(fname, { type: parseSig(st ? ft.slice(2) : ft), static: st, final: st, owner: name });
    }
    for (const [mname, sigs] of Object.entries(d.m || {})) {
      rec.methods.set(mname, sigs.map((s) => Object.assign(parseMethodSig(s), { name: mname, owner: name })));
    }
    jdkCache.set(name, rec);
    return rec;
  }

  /** 例外の型の親をたどる */
  function excParent(name, userClasses) {
    const u = userClasses && userClasses.get(name);
    if (u) return u.sup || "Object";
    const e = DATA.EXCEPTIONS[name];
    return e ? e[0] : null;
  }
  /** チェック例外か（true / false / わからない null） */
  function isChecked(name, userClasses) {
    let n = name;
    for (let k = 0; k < 20 && n; k++) {
      if (n === "RuntimeException" || n === "Error") return false;
      if (n === "Exception" || n === "Throwable") return true;
      n = excParent(n, userClasses);
    }
    return null;
  }
  /** a は b の子（または同じ）例外か */
  function excIsA(a, b, userClasses) {
    let n = a;
    for (let k = 0; k < 20 && n; k++) {
      if (n === b) return true;
      n = excParent(n, userClasses);
    }
    return n ? null : false;
  }

  /* ------------------------------------------------------------------ */
  /* 型の互換性                                                          */
  /* ------------------------------------------------------------------ */

  function makeDB(userClasses, resolveSimple) {
    // resolveSimple(name) → 自分のクラス or JDK のクラス or null
    const get = (name) => (name ? resolveSimple(name) : null);

    /** すべての親クラス・インタフェース。わからない親があれば complete=false */
    function supers(name) {
      const out = new Set();
      let complete = true;
      const stack = [name];
      while (stack.length) {
        const n = stack.pop();
        if (out.has(n)) continue;
        out.add(n);
        const r = get(n);
        if (!r) {
          if (n !== "Object") complete = false;
          continue;
        }
        if (r.unknownSuper) complete = false;
        if (r.sup) stack.push(r.sup);
        else if (r.kind !== "interface" && n !== "Object") stack.push("Object");
        for (const i of r.ifs) stack.push(i);
        if (r.kind === "interface") stack.push("Object");
      }
      return { set: out, complete };
    }

    /** from を to に入れられるか: true / false / null（わからない） */
    function isSubtype(from, to) {
      if (!from || !to) return null;
      if (to.n === "Object" && to.d === 0) return true;
      if (from.d !== to.d) {
        if (from.d > to.d && to.d === 0 && (to.n === "Cloneable" || to.n === "Serializable")) return true;
        if (from.d > to.d && to.n === "Object") return true;
        if (from.d > 0 && to.d > 0 && from.d > to.d && to.n === "Object") return true;
        return false;
      }
      if (from.d > 0) {
        if (isPrim(T(from.n)) || isPrim(T(to.n))) return from.n === to.n;
        return isSubtype(T(from.n, from.a), T(to.n, to.a));
      }
      if (from.n === to.n) return true;
      if (isPrim(from) || isPrim(to)) return false;
      // Map.Entry と Entry のような書き方のちがい
      const last = (n) => n.slice(n.lastIndexOf(".") + 1);
      if (last(from.n) === last(to.n)) return true;
      const r = get(from.n);
      if (!r) return null;
      const s = supers(from.n);
      if (s.set.has(to.n)) return true;
      // 自分のクラスと同じ名前の JDK のクラスなど、名前だけでは決めきれない
      return s.complete ? false : null;
    }

    function assignable(to, from, constInt) {
      if (!to || !from) return true;
      if (to.n === "void" || from.n === "void") return from.n === to.n ? true : false;
      if (from.n === "null") return !isPrim(to);
      if (isPrim(to) && isPrim(from)) {
        if (to.n === from.n) return true;
        if (to.n === "boolean" || from.n === "boolean") return false;
        // 定数は byte / short / char に入る（範囲内なら）
        if (constInt !== undefined && constInt !== null && (from.n === "int" || from.n === "char" || from.n === "short" || from.n === "byte")) {
          const v = constInt;
          if (to.n === "byte") return v >= -128 && v <= 127;
          if (to.n === "short") return v >= -32768 && v <= 32767;
          if (to.n === "char") return v >= 0 && v <= 65535;
        }
        if (from.n === "char") return ["int", "long", "float", "double"].includes(to.n);
        if (to.n === "char") return false;
        return NUM_RANK[from.n] < NUM_RANK[to.n] || (from.n === "byte" && to.n === "short");
      }
      if (isPrim(from)) {
        // ボクシング
        if (constInt !== undefined && constInt !== null && (to.n === "Character" || to.n === "Byte" || to.n === "Short")) return true;
        return isSubtype(boxed(from), to) !== false;
      }
      if (isPrim(to)) {
        // アンボクシング
        const u = unboxed(from);
        if (isPrim(u)) return assignable(to, u);
        const r = get(from.n);
        if (!r && from.d === 0 && !JAVA_LANG.has(from.n)) return null;
        return false;
      }
      return isSubtype(from, to) !== false;
    }

    /** 比べられるか（== / !=） */
    function comparable(a, b) {
      if (!a || !b) return true;
      if (a.n === "null" || b.n === "null") return !(isPrim(a) && a.n !== "null") && !(isPrim(b) && b.n !== "null");
      if (numLike(a) && numLike(b) && (isPrim(a) || isPrim(b))) return true;
      if (boolLike(a) && boolLike(b) && (isPrim(a) || isPrim(b))) return true;
      if (isPrim(a) || isPrim(b)) return false;
      return isSubtype(a, b) !== false || isSubtype(b, a) !== false;
    }

    /** メソッドを親までたどって探す */
    function findMethods(typeName, name) {
      const out = [];
      let complete = true;
      const seen = new Set();
      const stack = [typeName];
      while (stack.length) {
        const n = stack.shift();
        if (!n || seen.has(n)) continue;
        seen.add(n);
        const r = get(n);
        if (!r) {
          complete = false;
          continue;
        }
        if (!r.complete) complete = false;
        const ms = r.methods.get(name);
        if (ms) for (const m of ms) if (!out.some((o) => sameParams(o, m))) out.push(m);
        if (r.sup) stack.push(r.sup);
        else if (n !== "Object") stack.push("Object");
        for (const i of r.ifs) stack.push(i);
      }
      return { list: out, complete };
    }
    function findField(typeName, name) {
      let complete = true;
      const seen = new Set();
      const stack = [typeName];
      while (stack.length) {
        const n = stack.shift();
        if (!n || seen.has(n)) continue;
        seen.add(n);
        const r = get(n);
        if (!r) {
          complete = false;
          continue;
        }
        if (!r.complete) complete = false;
        const f = r.fields.get(name);
        if (f) return { field: f, complete: true };
        if (r.sup) stack.push(r.sup);
        for (const i of r.ifs) stack.push(i);
      }
      return { field: null, complete };
    }
    /** そのクラスで使えるメソッド名・フィールド名（もしかして？用） */
    function memberNames(typeName, wantStatic) {
      const names = new Set();
      const seen = new Set();
      const stack = [typeName];
      while (stack.length) {
        const n = stack.shift();
        if (!n || seen.has(n)) continue;
        seen.add(n);
        const r = get(n);
        if (!r) continue;
        for (const [k, ms] of r.methods) if (wantStatic === undefined || ms.some((m) => m.static === wantStatic || !wantStatic)) names.add(k);
        for (const [k, f] of r.fields) if (wantStatic === undefined || f.static === wantStatic || !wantStatic) names.add(k);
        if (r.sup) stack.push(r.sup);
        else if (n !== "Object") stack.push("Object");
        for (const i of r.ifs) stack.push(i);
      }
      return names;
    }

    /** レシーバの型引数から、型変数の置きかえ表を作る */
    function typeVarMap(recvType, ownerName) {
      const map = {};
      const tvars = new Set();
      const owner = get(ownerName);
      const recv = recvType && get(recvType.n);
      if (owner) for (const v of owner.tp) tvars.add(v);
      if (recv && recvType.a) {
        recv.tp.forEach((v, i) => {
          if (recvType.a[i]) map[v] = recvType.a[i];
        });
      }
      return { map, tvars };
    }

    return { supers, isSubtype, assignable, comparable, findMethods, findField, memberNames, typeVarMap, get };
  }

  function sameParams(a, b) {
    if (a.params.length !== b.params.length) return false;
    for (let i = 0; i < a.params.length; i++) if (str(a.params[i]) !== str(b.params[i])) return false;
    return true;
  }

  /** 引数の数が合うか */
  function arityOk(sig, n) {
    if (sig.varargs) return n >= sig.params.length - 1;
    return n === sig.params.length;
  }

  /** 型変数などの「なんでも入る」引数の型か */
  function isTypeVarLike(t, knownNames) {
    return !!t && !PRIMS.has(t.n) && !knownNames(t.n);
  }

  const api = {
    T, NULL, STRING, INT, BOOLEAN, PRIMS, BOX, UNBOX, NUM_RANK,
    isPrim, isNumeric, isIntegral, isBool, isString, isArray, isRef, unboxed, boxed, numLike, boolLike, elem, same,
    str, promote, parseSig, subst, jdkClass, makeDB, arityOk, sameParams, isTypeVarLike,
    isChecked, excIsA, PKG_CLASSES, CLASS_PKGS, JAVA_LANG, DATA,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.JavaTypes = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
