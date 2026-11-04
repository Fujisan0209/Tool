/*
 * ソースコードを読んで「宣言の一覧」を作ります。
 *   Java / JavaScript / TypeScript / Python に対応。
 *   コンパイラではないので、よくある書き方を速く・ゆるく読みます。
 *
 * 1ファイルの結果（CodeModel）:
 *   { file, lang, lines, funcs, types, consts, endpoints, prefixes, words, wordsNorm }
 *     funcs     : { name, owner, params:[{name,type,default,optional,variadic}], returns, private, local, isCtor, file, line }
 *     types     : { name, kind, fields:[{name,type,value,line,static,private}], values:[{name,line}]|null, file, line, private }
 *     consts    : { name, value, owner, file, line }
 *     endpoints : { method, path, handler, file, line }
 *     prefixes  : app.use('/api', ...) などで付く可能性のある先頭パス（ほかのファイルとの照合用）
 *     words     : Map<識別子, 最初に出てきた行>
 */
(function (root) {
  "use strict";

  const { normName } =
    typeof module !== "undefined" && module.exports ? require("./common.js") : root.SpecCheckCommon;

  // ================================================================ 言語の判定

  function langOf(file, text) {
    const ext = (String(file).match(/\.([\w]+)$/) || [])[1];
    if (ext) {
      const e = ext.toLowerCase();
      if (e === "java") return "java";
      if (["ts", "tsx", "mts", "cts"].includes(e)) return "ts";
      if (["js", "jsx", "mjs", "cjs"].includes(e)) return "js";
      if (e === "py" || e === "pyi") return "python";
    }
    return text === undefined ? null : detectLang(text);
  }

  function detectLang(text) {
    const t = String(text).slice(0, 20000);
    let py = 0, java = 0, ts = 0, js = 0;
    if (/^\s*(?:async\s+)?def\s+\w+\s*\(.*\)\s*(?:->.*)?:\s*$/m.test(t)) py += 3;
    if (/^\s*class\s+\w+\s*(?:\(.*\))?\s*:\s*$/m.test(t)) py += 2;
    if (/^\s*(?:from\s+[\w.]+\s+)?import\s+[\w.]+(?:\s+as\s+\w+)?\s*$/m.test(t) && !/;\s*$/m.test(t)) py += 1;
    if (/^\s*@\w+(?:\.\w+)*(?:\(.*\))?\s*$/m.test(t) && py) py += 1;
    if (/\b(?:public|private|protected)\s+(?:static\s+)?(?:final\s+)?[\w<>\[\], ]+\s+\w+\s*\(/.test(t)) java += 3;
    if (/^\s*package\s+[\w.]+;/m.test(t) || /^\s*import\s+[\w.]+(?:\.\*)?;/m.test(t)) java += 3;
    if (/\bSystem\.out\.|\bString\[\]\s+args/.test(t)) java += 2;
    if (/\binterface\s+\w+\s*(?:<[^>]*>)?\s*\{[^}]*\w\??\s*:/.test(t) || /\btype\s+\w+\s*=/.test(t)) ts += 3;
    if (/\(\s*\w+\??\s*:\s*\w+/.test(t) || /\)\s*:\s*[\w<>[\]|]+\s*(?:=>|\{)/.test(t)) ts += 2;
    if (/\b(?:const|let|var)\s+\w+\s*=|=>|\bfunction\b|\bmodule\.exports\b|\brequire\(/.test(t)) js += 2;
    if (/\bexport\s+(?:default\s+)?(?:function|const|class|interface|type)\b/.test(t)) js += 1;
    const best = Math.max(py, java, ts, js);
    if (best === 0) return null;
    if (best === java) return "java";
    if (best === py) return "python";
    if (ts >= 2) return "ts";
    return "js";
  }

  // ================================================================ 字句解析（Java / JS / TS）

  const ID_START = /[\p{L}\p{Nl}$_]/u;
  const ID_PART = /[\p{L}\p{Nl}\p{Mn}\p{Mc}\p{Nd}\p{Pc}$_‌‍]/u;
  const PUNCT3 = ["...", "===", "!=="];
  const PUNCT2 = ["=>", "->", "::", "==", "!=", "<=", "&&", "||", "??", "?.", "++", "--", "+=", "-=", "*=", "/=", "**"];
  const RE_AFTER_WORD = new Set(["return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do", "else", "yield", "await"]);

  function isIdStartCh(c) {
    const x = c.charCodeAt(0);
    if ((x >= 97 && x <= 122) || (x >= 65 && x <= 90) || x === 95 || x === 36) return true;
    return x > 127 && ID_START.test(c);
  }
  function isIdPartCh(c) {
    const x = c.charCodeAt(0);
    if ((x >= 97 && x <= 122) || (x >= 65 && x <= 90) || (x >= 48 && x <= 57) || x === 95 || x === 36) return true;
    return x > 127 && ID_PART.test(c);
  }

  /** トークン: { k: "id"|"num"|"str"|"re"|"p", v, line } */
  function lexC(src, lang) {
    const toks = [];
    const n = src.length;
    let i = 0;
    let line = 1;
    let last = null;
    const push = (k, v, ln) => {
      const t = { k, v, line: ln };
      toks.push(t);
      last = t;
    };
    const countNl = (a, b) => {
      let c = 0;
      for (let k = a; k < b; k++) if (src.charCodeAt(k) === 10) c++;
      return c;
    };
    while (i < n) {
      const c = src[i];
      if (c === "\n") { line++; i++; continue; }
      if (c === " " || c === "\t" || c === "\r" || c === "\f" || c === "\v" || c === " " || c === "﻿" || c === "　") { i++; continue; }
      if (c === "/" && src[i + 1] === "/") {
        while (i < n && src[i] !== "\n") i++;
        continue;
      }
      if (c === "/" && src[i + 1] === "*") {
        const e = src.indexOf("*/", i + 2);
        const end = e < 0 ? n : e + 2;
        line += countNl(i, end);
        i = end;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") {
        const start = i;
        const ln = line;
        if (c === '"' && src.startsWith('"""', i)) {
          const e = src.indexOf('"""', i + 3);
          const end = e < 0 ? n : e + 3;
          line += countNl(i, end);
          i = end;
        } else if (c === "`") {
          i++;
          let depth = 0;
          while (i < n) {
            const ch = src[i];
            if (ch === "\\") { i += 2; continue; }
            if (ch === "\n") line++;
            if (depth === 0 && ch === "`") { i++; break; }
            if (ch === "$" && src[i + 1] === "{") { depth++; i += 2; continue; }
            if (depth > 0 && ch === "{") depth++;
            else if (depth > 0 && ch === "}") depth--;
            i++;
          }
        } else {
          i++;
          while (i < n) {
            const ch = src[i];
            if (ch === "\\") { i += 2; continue; }
            if (ch === c) { i++; break; }
            if (ch === "\n") break;
            i++;
          }
        }
        push("str", src.slice(start, i), ln);
        continue;
      }
      if (c === "/" && lang !== "java") {
        const ok =
          !last ||
          (last.k === "p" && last.v !== ")" && last.v !== "]" && last.v !== "}") ||
          (last.k === "id" && RE_AFTER_WORD.has(last.v));
        if (ok) {
          const start = i;
          i++;
          let inClass = false;
          while (i < n) {
            const ch = src[i];
            if (ch === "\\") { i += 2; continue; }
            if (ch === "\n") break;
            if (inClass) { if (ch === "]") inClass = false; }
            else if (ch === "[") inClass = true;
            else if (ch === "/") { i++; break; }
            i++;
          }
          while (i < n && /[a-z]/i.test(src[i])) i++;
          push("re", src.slice(start, i), line);
          continue;
        }
      }
      if (isIdStartCh(c)) {
        const start = i;
        i++;
        while (i < n && isIdPartCh(src[i])) i++;
        push("id", src.slice(start, i), line);
        continue;
      }
      if (c >= "0" && c <= "9") {
        const start = i;
        while (i < n && /[\w.]/.test(src[i])) {
          if (src[i] === "." && !(src[i + 1] >= "0" && src[i + 1] <= "9")) break;
          i++;
        }
        push("num", src.slice(start, i), line);
        continue;
      }
      const three = src.substr(i, 3);
      if (PUNCT3.includes(three)) { push("p", three, line); i += 3; continue; }
      const two = src.substr(i, 2);
      if (PUNCT2.includes(two)) { push("p", two, line); i += 2; continue; }
      push("p", c, line);
      i++;
    }
    return toks;
  }

  /** ( [ { の対応する閉じかっこの位置 */
  function matchBrackets(toks) {
    const match = new Int32Array(toks.length).fill(-1);
    const stack = [];
    const pair = { ")": "(", "]": "[", "}": "{" };
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (t.k !== "p") continue;
      if (t.v === "(" || t.v === "[" || t.v === "{") stack.push(i);
      else if (pair[t.v]) {
        // 対応がずれていたら、合うところまで戻す（壊れたコードでも止まらない）
        for (let s = stack.length - 1; s >= 0; s--) {
          if (toks[stack[s]].v === pair[t.v]) {
            const open = stack[s];
            stack.length = s;
            match[open] = i;
            match[i] = open;
            break;
          }
        }
      }
    }
    return match;
  }

  // ================================================================ トークン列の小道具

  function makeCursor(toks, match) {
    const isP = (i, v) => toks[i] !== undefined && toks[i].k === "p" && toks[i].v === v;
    const isId = (i, v) => toks[i] !== undefined && toks[i].k === "id" && (v === undefined || toks[i].v === v);
    const close = (i, end) => (match[i] >= 0 ? match[i] : end);

    function join(a, b) {
      let out = "";
      for (let i = a; i < b; i++) {
        const t = toks[i];
        const prev = toks[i - 1];
        if (i > a) {
          const word = t.k !== "p";
          const prevWord = prev.k !== "p";
          if ((word && prevWord) || prev.v === "," || (prev.v === "?" && word && /^(?:extends|super)$/.test(t.v))) out += " ";
          else if (["|", "&", "=", "=>"].includes(t.v) || ["|", "&", "=", "=>"].includes(prev.v)) out += " ";
        }
        out += t.v;
      }
      return out;
    }

    /** < ... > を飛ばす（ジェネリクス） */
    function skipAngles(i, end) {
      let depth = 0;
      for (let j = i; j < end; j++) {
        const t = toks[j];
        if (t.k !== "p") continue;
        if (t.v === "<") depth++;
        else if (t.v === ">") {
          depth--;
          if (depth === 0) return j + 1;
        } else if (t.v === "(" || t.v === "[" || t.v === "{") j = close(j, end);
        else if (t.v === ";" || t.v === ")" || t.v === "}") return j;
      }
      return end;
    }

    /** [a, b) を、かっこの外にある , で分ける */
    function splitCommas(a, b) {
      const parts = [];
      let s = a;
      let angle = 0;
      for (let j = a; j < b; j++) {
        const t = toks[j];
        if (t.k !== "p") continue;
        if (t.v === "(" || t.v === "[" || t.v === "{") j = Math.min(close(j, b), b - 1);
        else if (t.v === "<") angle++;
        else if (t.v === ">" && angle > 0) angle--;
        else if (t.v === "," && angle === 0) {
          if (j > s) parts.push([s, j]);
          s = j + 1;
        }
      }
      if (b > s) parts.push([s, b]);
      return parts;
    }

    /** @Annotation(...) / @decorator(...) を読む。{ name, args:[a,b]|null, end } */
    function readAnnotation(i, end) {
      if (!isP(i, "@") || !isId(i + 1)) return null;
      let j = i + 1;
      let name = toks[j].v;
      j++;
      while (isP(j, ".") && isId(j + 1)) {
        name = toks[j + 1].v;
        j += 2;
      }
      let args = null;
      if (isP(j, "(")) {
        const c = close(j, end);
        args = [j + 1, c];
        j = c + 1;
      }
      return { name, args, end: j };
    }

    /** 文字列リテラルの中身 */
    function strVal(t) {
      if (!t || t.k !== "str") return null;
      const v = t.v;
      if (v.startsWith('"""')) return v.slice(3, -3);
      return v.slice(1, -1);
    }

    return { toks, match, isP, isId, close, join, skipAngles, splitCommas, readAnnotation, strVal };
  }

  function joinPath(a, b) {
    const x = String(a || "").trim();
    const y = String(b || "").trim();
    if (!x) return y || "/";
    if (!y) return x;
    return (x.replace(/\/+$/, "") + "/" + y.replace(/^\/+/, "")).replace(/\/{2,}/g, "/");
  }

  const isUpperConst = (s) => /^[A-Z][A-Z0-9_]*$/.test(s) && /[A-Z]/.test(s) && s.length >= 2;

  // ================================================================ Java

  const JAVA_MODS = new Set(["public", "protected", "private", "static", "final", "abstract", "synchronized", "native", "transient", "volatile", "default", "strictfp", "sealed"]);
  const SPRING = { GetMapping: "GET", PostMapping: "POST", PutMapping: "PUT", DeleteMapping: "DELETE", PatchMapping: "PATCH", RequestMapping: null };
  const JAXRS = new Set(["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"]);

  function parseJava(toks, match, model, loose) {
    const C = makeCursor(toks, match);
    const { isP, isId, close, join, skipAngles, splitCommas, readAnnotation, strVal } = C;

    function annPaths(ann) {
      if (!ann.args) return [];
      const out = [];
      let key = null;
      let depth = 0;
      for (let j = ann.args[0]; j < ann.args[1]; j++) {
        if (isP(j, "{")) depth++;
        else if (isP(j, "}")) depth--;
        else if (isP(j, ",") && depth === 0) key = null;
        else if (isId(j) && isP(j + 1, "=")) key = toks[j].v;
        else if (toks[j].k === "str" && (!key || key === "value" || key === "path")) out.push(strVal(toks[j]));
      }
      return out;
    }
    function annMethods(ann) {
      if (!ann.args) return [];
      const out = [];
      for (let j = ann.args[0]; j < ann.args[1]; j++)
        if (isId(j, "RequestMethod") && isP(j + 1, ".") && isId(j + 2)) out.push(toks[j + 2].v);
      return out;
    }
    function classPrefix(anns) {
      for (const a of anns) if (a.name === "RequestMapping" || a.name === "Path") return annPaths(a)[0] || "";
      return "";
    }

    function params(a, b) {
      const out = [];
      for (const [s0, e] of splitCommas(a, b)) {
        let s = s0;
        for (;;) {
          const an = readAnnotation(s, e);
          if (an) { s = an.end; continue; }
          if (isId(s, "final")) { s++; continue; }
          break;
        }
        let nameIdx = -1;
        for (let j = e - 1; j >= s; j--) if (toks[j].k === "id") { nameIdx = j; break; }
        if (nameIdx < 0) continue;
        let variadic = false;
        for (let j = s; j < nameIdx; j++) if (isP(j, "...")) variadic = true;
        let type = join(s, nameIdx);
        if (nameIdx + 1 < e && isP(nameIdx + 1, "[")) type += "[]";
        out.push({ name: toks[nameIdx].v, type: type || null, default: null, optional: false, variadic });
      }
      return out;
    }

    function routes(anns, owner, handler, line) {
      const prefix = owner ? owner.prefixChain : "";
      let jaxMethod = null;
      let jaxPath = null;
      for (const a of anns) {
        if (a.name in SPRING) {
          const methods = SPRING[a.name] ? [SPRING[a.name]] : annMethods(a);
          const paths = annPaths(a);
          for (const m of methods.length ? methods : ["ANY"])
            for (const p of paths.length ? paths : [""])
              model.endpoints.push({ method: m, path: joinPath(prefix, p), handler, file: model.file, line });
        } else if (JAXRS.has(a.name)) jaxMethod = a.name;
        else if (a.name === "Path") jaxPath = annPaths(a)[0] || "";
      }
      if (jaxMethod) model.endpoints.push({ method: jaxMethod, path: joinPath(prefix, jaxPath || ""), handler, file: model.file, line });
    }

    function parseType(i, end, owner, anns, mods) {
      let kind;
      if (isP(i, "@")) { kind = "annotation"; i++; } else kind = toks[i].v;
      const nameTok = toks[i + 1];
      let j = i + 2;
      if (isP(j, "<")) j = skipAngles(j, end);
      let recordParams = null;
      if (kind === "record" && isP(j, "(")) {
        recordParams = params(j + 1, close(j, end));
        j = close(j, end) + 1;
      }
      while (j < end && !isP(j, "{") && !isP(j, ";")) j++;
      const type = {
        name: nameTok.v, kind, fields: [], values: kind === "enum" ? [] : null,
        file: model.file, line: nameTok.line, owner: owner ? owner.name : null,
        private: mods.has("private"),
      };
      const cp = classPrefix(anns);
      const op = owner ? owner.prefixChain : "";
      type.prefixChain = cp || op ? joinPath(op, cp) : "";
      model.types.push(type);
      if (recordParams) for (const p of recordParams) type.fields.push({ name: p.name, type: p.type, value: null, line: nameTok.line, static: false, private: false });
      if (isP(j, "{")) {
        const c = close(j, end);
        let k = j + 1;
        if (kind === "enum") k = enumBody(k, c, type);
        members(k, c, type, kind === "interface");
        return c + 1;
      }
      return j + 1;
    }

    function enumBody(k, end, type) {
      while (k < end) {
        const an = readAnnotation(k, end);
        if (an) { k = an.end; continue; }
        if (isId(k)) {
          type.values.push({ name: toks[k].v, line: toks[k].line });
          k++;
          if (isP(k, "(")) k = close(k, end) + 1;
          if (isP(k, "{")) k = close(k, end) + 1;
        }
        if (isP(k, ",")) { k++; continue; }
        if (isP(k, ";")) { k++; break; }
        break;
      }
      return k;
    }

    function members(start, end, owner, inInterface) {
      let i = start;
      while (i < end) {
        if (isP(i, ";")) { i++; continue; }
        if (!owner && (isId(i, "package") || isId(i, "import"))) {
          while (i < end && !isP(i, ";")) i++;
          i++;
          continue;
        }
        const anns = [];
        for (;;) {
          if (isP(i, "@") && isId(i + 1, "interface")) break;
          const an = readAnnotation(i, end);
          if (!an) break;
          anns.push(an);
          i = an.end;
        }
        const mods = new Set();
        while (isId(i) && JAVA_MODS.has(toks[i].v)) mods.add(toks[i++].v);
        if (i >= end) break;
        if ((isId(i) && /^(?:class|interface|enum|record)$/.test(toks[i].v) && isId(i + 1)) || (isP(i, "@") && isId(i + 1, "interface"))) {
          i = parseType(i, end, owner, anns, mods);
          continue;
        }
        if (isP(i, "{")) { i = close(i, end) + 1; continue; }
        if (!owner && !loose) { i++; continue; }

        // メソッドかフィールドかを、最初に出てくる ( = ; { で決める
        let j = i;
        let angle = 0;
        let found = -1;
        while (j < end) {
          const x = toks[j];
          if (x.k === "p") {
            if (x.v === "<") angle++;
            else if (x.v === ">") angle = Math.max(0, angle - 1);
            else if (x.v === "[") j = close(j, end);
            else if (angle === 0 && (x.v === "(" || x.v === "=" || x.v === ";" || x.v === "{" || x.v === "}")) { found = j; break; }
          }
          j++;
        }
        if (found < 0) break;
        const f = toks[found].v;
        if (f === "}") { i = found + 1; continue; }
        if (f === "{") { i = close(found, end) + 1; continue; }
        if (f === "(") {
          const nameIdx = found - 1;
          const c = close(found, end);
          let k = c + 1;
          while (k < end && !isP(k, "{") && !isP(k, ";") && !isP(k, "}")) k++;
          if (nameIdx >= i && isId(nameIdx)) {
            let ts = i;
            if (isP(ts, "<")) ts = skipAngles(ts, nameIdx);
            const typeStr = join(ts, nameIdx);
            const name = toks[nameIdx].v;
            const isCtor = !typeStr && owner && name === owner.name;
            if ((typeStr && !/[=(]/.test(typeStr)) || isCtor) {
              model.funcs.push({
                name, owner: owner ? owner.name : null, params: params(found + 1, c),
                returns: isCtor ? null : typeStr, private: mods.has("private"),
                static: mods.has("static"), local: false, isCtor: !!isCtor,
                file: model.file, line: toks[nameIdx].line, lang: "java",
              });
              routes(anns, owner, name, toks[nameIdx].line);
            }
          }
          i = isP(k, "{") ? close(k, end) + 1 : k + 1;
          continue;
        }
        // フィールド（int a = 1, b;）
        let s = i;
        let stmtEnd = -1;
        let firstType = null;
        for (;;) {
          let nameEnd = s;
          while (nameEnd < end && !isP(nameEnd, "=") && !isP(nameEnd, ",") && !isP(nameEnd, ";")) {
            if (isP(nameEnd, "<")) { nameEnd = Math.max(skipAngles(nameEnd, end), nameEnd + 1); continue; }
            if (isP(nameEnd, "(") || isP(nameEnd, "[") || isP(nameEnd, "{")) nameEnd = close(nameEnd, end);
            nameEnd++;
          }
          let nameIdx = nameEnd - 1;
          while (nameIdx > s && isP(nameIdx, "]") && isP(nameIdx - 1, "[")) nameIdx -= 2;
          if (nameIdx < s || !isId(nameIdx)) {
            let e = s;
            while (e < end && !isP(e, ";")) {
              if (isP(e, "(") || isP(e, "[") || isP(e, "{")) e = close(e, end);
              e++;
            }
            stmtEnd = e;
            break;
          }
          if (s === i) firstType = join(i, nameIdx) || null;
          let v = nameEnd;
          let value = null;
          if (isP(v, "=")) {
            let e = v + 1;
            while (e < end && !isP(e, ",") && !isP(e, ";")) {
              if (isP(e, "(") || isP(e, "[") || isP(e, "{")) e = close(e, end);
              e++;
            }
            value = join(v + 1, e);
            v = e;
          }
          const fname = toks[nameIdx].v;
          const field = {
            name: fname, type: firstType, value, line: toks[nameIdx].line,
            static: mods.has("static") || inInterface, private: mods.has("private"),
          };
          if (owner) owner.fields.push(field);
          if (value !== null && isUpperConst(fname) && (inInterface || (mods.has("static") && mods.has("final")) || !owner))
            model.consts.push({ name: fname, value, owner: owner ? owner.name : null, file: model.file, line: field.line });
          if (isP(v, ",")) { s = v + 1; continue; }
          stmtEnd = v;
          break;
        }
        i = Math.max(stmtEnd + 1, i + 1);
      }
    }

    members(0, toks.length, null, false);
  }

  // ================================================================ JavaScript / TypeScript

  const TS_MODS = new Set(["public", "private", "protected", "static", "readonly", "abstract", "async", "override", "declare", "accessor", "export", "default"]);
  const HTTP_FUNCS = new Set(["get", "post", "put", "delete", "patch", "all", "head", "options"]);
  const NEST = { Get: "GET", Post: "POST", Put: "PUT", Delete: "DELETE", Patch: "PATCH", All: "ANY", Head: "HEAD", Options: "OPTIONS" };
  const CONTINUE_OPS = new Set(["|", "&", ",", ":", "=>", "(", "<", "=", ".", "?", "+", "-", "*", "&&", "||", "??"]);

  function parseJs(toks, match, model, lang) {
    const C = makeCursor(toks, match);
    const { isP, isId, close, join, skipAngles, splitCommas, readAnnotation, strVal } = C;
    const N = toks.length;
    const exported = new Set();
    const routerPrefix = new Map();
    const pendingRoutes = [];

    /** 型注釈などの終わり（stop の記号か、改行で文が終わったところ） */
    function scanEnd(k, end, stops) {
      let angle = 0;
      for (let j = k; j < end; j++) {
        const t = toks[j];
        if (j > k && t.line > toks[j - 1].line && angle === 0) {
          const prev = toks[j - 1];
          if (!(prev.k === "p" && CONTINUE_OPS.has(prev.v)) && !(t.k === "p" && (t.v === "|" || t.v === "&" || t.v === "." || t.v === "?."))) return j;
        }
        if (t.k !== "p") continue;
        if (t.v === "(" || t.v === "[" || t.v === "{") {
          if (angle === 0 && stops.has(t.v)) return j;
          j = close(j, end);
          continue;
        }
        if (t.v === "<") { angle++; continue; }
        if (t.v === ">" && angle > 0) { angle--; continue; }
        if (angle === 0 && (stops.has(t.v) || t.v === ")" || t.v === "]" || t.v === "}")) return j;
      }
      return end;
    }

    function params(a, b) {
      const out = [];
      const props = [];
      for (const [s0, e] of splitCommas(a, b)) {
        let s = s0;
        let prop = false;
        for (;;) {
          const an = readAnnotation(s, e);
          if (an) { s = an.end; continue; }
          if (isId(s) && /^(?:public|private|protected|readonly|override)$/.test(toks[s].v) && (isId(s + 1) || isP(s + 1, "{"))) { prop = true; s++; continue; }
          break;
        }
        let variadic = false;
        if (isP(s, "...")) { variadic = true; s++; }
        let name;
        if (isP(s, "{") || isP(s, "[")) { name = isP(s, "{") ? "{…}" : "[…]"; s = close(s, e) + 1; }
        else if (isId(s)) { name = toks[s].v; s++; }
        else if (isId(s, "this")) { s++; continue; }
        else continue;
        if (name === "this") continue;
        let optional = false;
        if (isP(s, "?")) { optional = true; s++; }
        let type = null;
        let def = null;
        if (isP(s, ":")) {
          let t = s + 1;
          let angle = 0;
          while (t < e) {
            if (isP(t, "<")) angle++;
            else if (isP(t, ">") && angle) angle--;
            else if (isP(t, "=") && angle === 0) break;
            else if (isP(t, "(") || isP(t, "[") || isP(t, "{")) t = close(t, e);
            t++;
          }
          type = join(s + 1, t);
          s = t;
        }
        if (isP(s, "=")) { def = join(s + 1, e); optional = true; }
        const p = { name, type, default: def, optional, variadic };
        out.push(p);
        if (prop) props.push(p);
      }
      return { list: out, props };
    }

    function returnsAfter(k, end) {
      if (!isP(k, ":")) return { type: null, next: k };
      const e = scanEnd(k + 1, end, new Set(["{", ";", "=>", ","]));
      return { type: join(k + 1, e) || null, next: e };
    }

    function addFunc(name, owner, plist, returns, line, extra) {
      const f = {
        name, owner, params: plist, returns, private: /^[_#]/.test(name), static: false,
        local: false, isCtor: false, file: model.file, line, lang, ...extra,
      };
      model.funcs.push(f);
      return f;
    }

    function addRoute(method, path, line, handler) {
      model.endpoints.push({ method, path, handler: handler || null, file: model.file, line });
    }

    /** interface / type の { ... } の中身 */
    function typeMembers(open, c, type) {
      let k = open + 1;
      while (k < c) {
        if (isP(k, ";") || isP(k, ",")) { k++; continue; }
        if (isId(k, "readonly") && (isId(k + 1) || toks[k + 1].k === "str")) k++;
        if (isP(k, "[")) { k = scanEnd(close(k, c) + 1, c, new Set([";", ","])); continue; }
        const nameTok = toks[k];
        if (!nameTok || (nameTok.k !== "id" && nameTok.k !== "str")) { k++; continue; }
        const name = nameTok.k === "str" ? strVal(nameTok) : nameTok.v;
        k++;
        let optional = false;
        if (isP(k, "?")) { optional = true; k++; }
        if (isP(k, "(") || isP(k, "<")) {
          if (isP(k, "<")) k = skipAngles(k, c);
          if (!isP(k, "(")) continue;
          const pc = close(k, c);
          const ps = params(k + 1, pc).list;
          const r = returnsAfter(pc + 1, c);
          addFunc(name, type.name, ps, r.type, nameTok.line, { iface: true });
          k = r.next;
          continue;
        }
        if (isP(k, ":")) {
          const e = scanEnd(k + 1, c, new Set([";", ","]));
          type.fields.push({ name, type: join(k + 1, e) + (optional ? " | undefined" : ""), value: null, line: nameTok.line, static: false, private: false, optional });
          k = e;
          continue;
        }
        k++;
      }
    }

    function classBody(open, c, type, decorators) {
      let prefix = "";
      for (const d of decorators) if (d.name === "Controller") prefix = firstStr(d) || "";
      type.prefixChain = prefix;
      let k = open + 1;
      while (k < c) {
        if (isP(k, ";") || isP(k, ",")) { k++; continue; }
        const decs = [];
        for (;;) {
          const an = readAnnotation(k, c);
          if (!an) break;
          decs.push(an);
          k = an.end;
        }
        const mods = new Set();
        while (isId(k) && (TS_MODS.has(toks[k].v) || toks[k].v === "get" || toks[k].v === "set") &&
          !(isP(k + 1, "(") || isP(k + 1, "=") || isP(k + 1, ":") || isP(k + 1, "?") || isP(k + 1, ";") || isP(k + 1, "<"))) {
          mods.add(toks[k].v);
          k++;
        }
        if (isP(k, "*")) k++;
        if (isId(k, "static") && isP(k + 1, "{")) { k = close(k + 1, c) + 1; continue; }
        let priv = mods.has("private") || mods.has("protected");
        if (isP(k, "#") && isId(k + 1)) { priv = true; k++; }
        if (isP(k, "[")) {
          // [Symbol.iterator]() {} などの計算されたキーは飛ばす
          k = close(k, c) + 1;
          if (isP(k, "(")) {
            const r = returnsAfter(close(k, c) + 1, c);
            k = isP(r.next, "{") ? close(r.next, c) + 1 : r.next;
          } else k = scanEnd(k, c, new Set([";"]));
          continue;
        }
        const nameTok = toks[k];
        k++;
        if (!nameTok) break;
        if (nameTok.k !== "id" && nameTok.k !== "str") {
          if (nameTok.k === "p" && (nameTok.v === "(" || nameTok.v === "{" || nameTok.v === "[")) k = close(k - 1, c) + 1;
          continue;
        }
        const name = nameTok.k === "str" ? strVal(nameTok) : nameTok.v;
        if (isP(k, "?") || isP(k, "!")) k++;
        if (isP(k, "(") || isP(k, "<")) {
          if (isP(k, "<")) k = skipAngles(k, c);
          if (!isP(k, "(")) continue;
          const pc = close(k, c);
          const ps = params(k + 1, pc);
          const r = returnsAfter(pc + 1, c);
          const isCtor = name === "constructor";
          if (mods.has("get") || mods.has("set")) {
            if (mods.has("get") && !type.fields.some((f) => f.name === name))
              type.fields.push({ name, type: r.type, value: null, line: nameTok.line, static: mods.has("static"), private: priv, accessor: true });
          } else {
            addFunc(name, type.name, ps.list, r.type, nameTok.line, { private: priv || /^_/.test(name), static: mods.has("static"), isCtor, async: mods.has("async") });
          }
          if (isCtor) for (const p of ps.props) type.fields.push({ name: p.name, type: p.type, value: null, line: nameTok.line, static: false, private: false });
          for (const d of decs) if (d.name in NEST) addRoute(NEST[d.name], joinPath(type.prefixChain, firstStr(d) || ""), nameTok.line, name);
          k = r.next;
          if (isP(k, "{")) k = close(k, c) + 1;
          continue;
        }
        // プロパティ
        let ftype = null;
        if (isP(k, ":")) {
          const e = scanEnd(k + 1, c, new Set(["=", ";"]));
          ftype = join(k + 1, e);
          k = e;
        }
        let value = null;
        if (isP(k, "=")) {
          const e = scanEnd(k + 1, c, new Set([";"]));
          const fn = arrowAt(k + 1, e);
          if (fn) {
            addFunc(name, type.name, fn.params, fn.returns, nameTok.line, { private: priv || /^_/.test(name), static: mods.has("static") });
            k = e;
            continue;
          }
          value = join(k + 1, e);
          k = e;
        }
        type.fields.push({ name, type: ftype, value, line: nameTok.line, static: mods.has("static"), private: priv });
        if (value !== null && mods.has("static") && isUpperConst(name)) model.consts.push({ name, value, owner: type.name, file: model.file, line: nameTok.line });
      }
    }

    function firstStr(an) {
      if (!an || !an.args) return null;
      for (let j = an.args[0]; j < an.args[1]; j++) if (toks[j].k === "str") return strVal(toks[j]);
      return null;
    }

    /** k から始まるのが関数式（function / アロー）なら、その引数などを返す */
    function arrowAt(k, end) {
      let j = k;
      if (isId(j, "async")) j++;
      if (isId(j, "function")) {
        j++;
        if (isP(j, "*")) j++;
        if (isId(j)) j++;
        if (!isP(j, "(")) return null;
        const pc = close(j, end);
        const r = returnsAfter(pc + 1, N);
        return { params: params(j + 1, pc).list, returns: r.type, body: isP(r.next, "{") ? r.next : -1 };
      }
      if (isP(j, "<")) j = skipAngles(j, end);
      if (isP(j, "(")) {
        const pc = close(j, N);
        const r = returnsAfter(pc + 1, N);
        if (!isP(r.next, "=>")) return null;
        return { params: params(j + 1, pc).list, returns: r.type, body: isP(r.next + 1, "{") ? r.next + 1 : -1 };
      }
      if (isId(j) && isP(j + 1, "=>"))
        return { params: [{ name: toks[j].v, type: null, default: null, optional: false, variadic: false }], returns: null, body: isP(j + 2, "{") ? j + 2 : -1 };
      return null;
    }

    // 関数の中は「ローカル」（仕様にない、と言わない）
    const bodyEnds = [];
    let exportNext = false;
    let pendingDecorators = [];

    for (let i = 0; i < N; i++) {
      while (bodyEnds.length && i > bodyEnds[bodyEnds.length - 1]) bodyEnds.pop();
      const local = bodyEnds.length > 0;
      const t = toks[i];

      if (t.k === "p") {
        if (t.v === "@" && isId(i + 1)) {
          const an = readAnnotation(i, N);
          if (an) { pendingDecorators.push(an); i = an.end - 1; continue; }
        }
        if (t.v === ";" || t.v === "}") exportNext = false;
        continue;
      }
      if (t.k !== "id") continue;
      const v = t.v;
      const prevDot = i > 0 && (isP(i - 1, ".") || isP(i - 1, "?."));

      if (v === "export" && !prevDot) {
        exportNext = true;
        if (isP(i + 1, "{")) {
          const c = close(i + 1, N);
          for (const [s] of splitCommas(i + 2, c)) if (isId(s)) exported.add(toks[s].v);
          i = c;
          exportNext = false;
        }
        continue;
      }
      if (v === "default" && exportNext) continue;
      if ((v === "async" || v === "declare" || v === "abstract") && !prevDot) continue;

      // function name(...)
      if (v === "function" && !prevDot) {
        let j = i + 1;
        if (isP(j, "*")) j++;
        if (isId(j) && isP(j + 1, "(") || (isId(j) && isP(j + 1, "<"))) {
          const name = toks[j].v;
          let p = j + 1;
          if (isP(p, "<")) p = skipAngles(p, N);
          const pc = close(p, N);
          const r = returnsAfter(pc + 1, N);
          addFunc(name, null, params(p + 1, pc).list, r.type, toks[j].line, { local, exported: exportNext });
          if (exportNext) exported.add(name);
          if (isP(r.next, "{")) bodyEnds.push(close(r.next, N));
          i = r.next;
        } else if (isP(j, "(")) {
          const pc = close(j, N);
          const r = returnsAfter(pc + 1, N);
          if (isP(r.next, "{")) bodyEnds.push(close(r.next, N));
          i = r.next;
        }
        exportNext = false;
        continue;
      }

      // const name = ...
      if ((v === "const" || v === "let" || v === "var") && !prevDot && isId(i + 1)) {
        const nameTok = toks[i + 1];
        const name = nameTok.v;
        let j = i + 2;
        if (isP(j, ":")) j = scanEnd(j + 1, N, new Set(["=", ";"]));
        if (!isP(j, "=")) { exportNext = false; continue; }
        const vs = j + 1;
        const fn = arrowAt(vs, N);
        if (fn) {
          addFunc(name, null, fn.params, fn.returns, nameTok.line, { local, exported: exportNext });
          if (exportNext) exported.add(name);
          if (fn.body >= 0) bodyEnds.push(close(fn.body, N));
          exportNext = false;
          continue;
        }
        let objOpen = -1;
        if (isP(vs, "{")) objOpen = vs;
        else if (isId(vs, "Object") && isP(vs + 1, ".") && isId(vs + 2, "freeze") && isP(vs + 3, "(") && isP(vs + 4, "{")) objOpen = vs + 4;
        if (objOpen >= 0 && /^[A-Z]/.test(name)) {
          const oc = close(objOpen, N);
          const keys = [];
          for (const [s] of splitCommas(objOpen + 1, oc))
            if ((isId(s) || toks[s].k === "str") && isP(s + 1, ":")) keys.push({ name: isId(s) ? toks[s].v : strVal(toks[s]), line: toks[s].line, value: toks[s + 2] ? toks[s + 2].v : null });
          if (keys.length && keys.every((k) => isUpperConst(k.name)))
            model.types.push({ name, kind: "enum", fields: [], values: keys.map((k) => ({ name: k.name, line: k.line })), file: model.file, line: nameTok.line, private: false, local });
        }
        const r = routerCall(vs);
        if (r !== null) routerPrefix.set(name, r);
        if (isUpperConst(name) && !local) {
          const e = scanEnd(vs, N, new Set([";", ","]));
          let value = join(vs, e).replace(/\s+as\s+const$/, "");
          model.consts.push({ name, value, owner: null, file: model.file, line: nameTok.line });
          if (exportNext) exported.add(name);
        }
        exportNext = false;
        continue;
      }

      // class Name { ... }
      if (v === "class" && !prevDot) {
        let j = i + 1;
        const nameTok = isId(j) && !/^(?:extends|implements)$/.test(toks[j].v) ? toks[j] : null;
        while (j < N && !isP(j, "{")) j++;
        if (j >= N) continue;
        const c = close(j, N);
        if (nameTok) {
          const type = { name: nameTok.v, kind: "class", fields: [], values: null, file: model.file, line: nameTok.line, private: false, local };
          model.types.push(type);
          if (exportNext) exported.add(nameTok.v);
          classBody(j, c, type, pendingDecorators);
        }
        pendingDecorators = [];
        bodyEnds.push(c);
        i = j;
        exportNext = false;
        continue;
      }

      if (lang === "ts" && v === "interface" && !prevDot && isId(i + 1)) {
        const nameTok = toks[i + 1];
        let j = i + 2;
        while (j < N && !isP(j, "{")) j++;
        if (j >= N) continue;
        const c = close(j, N);
        const type = { name: nameTok.v, kind: "interface", fields: [], values: null, file: model.file, line: nameTok.line, private: false, local };
        model.types.push(type);
        typeMembers(j, c, type);
        i = c;
        exportNext = false;
        continue;
      }

      if (lang === "ts" && v === "type" && !prevDot && isId(i + 1) && (isP(i + 2, "=") || isP(i + 2, "<"))) {
        const nameTok = toks[i + 1];
        let j = i + 2;
        if (isP(j, "<")) j = skipAngles(j, N);
        if (!isP(j, "=")) continue;
        j++;
        if (isP(j, "|")) j++;
        if (isP(j, "{")) {
          const c = close(j, N);
          const type = { name: nameTok.v, kind: "type", fields: [], values: null, file: model.file, line: nameTok.line, private: false, local };
          model.types.push(type);
          typeMembers(j, c, type);
          i = c;
        } else if (toks[j] && toks[j].k === "str") {
          const values = [];
          let k = j;
          while (toks[k] && toks[k].k === "str") {
            values.push({ name: strVal(toks[k]), line: toks[k].line });
            if (isP(k + 1, "|")) k += 2;
            else break;
          }
          model.types.push({ name: nameTok.v, kind: "enum", fields: [], values, file: model.file, line: nameTok.line, private: false, local, literal: true });
          i = k;
        }
        exportNext = false;
        continue;
      }

      if (v === "enum" && !prevDot && isId(i + 1) && isP(i + 2, "{")) {
        const nameTok = toks[i + 1];
        const c = close(i + 2, N);
        const values = [];
        for (const [s, e] of splitCommas(i + 3, c)) {
          if (!isId(s) && toks[s].k !== "str") continue;
          values.push({ name: isId(s) ? toks[s].v : strVal(toks[s]), line: toks[s].line, value: isP(s + 1, "=") ? join(s + 2, e) : null });
        }
        model.types.push({ name: nameTok.v, kind: "enum", fields: [], values, file: model.file, line: nameTok.line, private: false, local });
        i = c;
        exportNext = false;
        continue;
      }

      // exports.name = function ... / module.exports = { a, b }
      if (v === "module" && isP(i + 1, ".") && isId(i + 2, "exports")) {
        if (isP(i + 3, "=") && isP(i + 4, "{")) {
          const c = close(i + 4, N);
          for (const [s] of splitCommas(i + 5, c)) if (isId(s)) exported.add(toks[s].v);
          i = c;
        } else if (isP(i + 3, "=") && isId(i + 4)) exported.add(toks[i + 4].v);
        continue;
      }
      if (v === "exports" && !prevDot && isP(i + 1, ".") && isId(i + 2) && isP(i + 3, "=")) {
        exported.add(toks[i + 2].v);
        const fn = arrowAt(i + 4, N);
        if (fn) {
          addFunc(toks[i + 2].v, null, fn.params, fn.returns, toks[i + 2].line, { local: false, exported: true });
          if (fn.body >= 0) bodyEnds.push(close(fn.body, N));
        }
        continue;
      }
      // Foo.prototype.bar = function () {}
      if (isP(i + 1, ".") && isId(i + 2, "prototype") && isP(i + 3, ".") && isId(i + 4) && isP(i + 5, "=")) {
        const fn = arrowAt(i + 6, N);
        if (fn) {
          addFunc(toks[i + 4].v, v, fn.params, fn.returns, toks[i + 4].line, { local: false });
          if (fn.body >= 0) bodyEnds.push(close(fn.body, N));
        }
        continue;
      }

      // ルーティング: app.get('/path', ...) / router.route('/x').get(...)
      if (isP(i + 1, ".") && isId(i + 2)) {
        const fnName = toks[i + 2].v;
        if (fnName === "use" && isP(i + 3, "(") && toks[i + 4] && toks[i + 4].k === "str" && isP(i + 5, ",")) {
          const p = strVal(toks[i + 4]);
          if (p.startsWith("/")) {
            model.prefixes.push(p);
            if (isId(i + 6) && (isP(i + 7, ")") || isP(i + 7, ","))) pendingRoutes.push({ router: toks[i + 6].v, prefix: p });
          }
          continue;
        }
        if (fnName === "route" && isP(i + 3, "(") && toks[i + 4] && toks[i + 4].k === "str") {
          const path = strVal(toks[i + 4]);
          let k = close(i + 3, N) + 1;
          while (isP(k, ".") && isId(k + 1) && HTTP_FUNCS.has(toks[k + 1].v) && isP(k + 2, "(")) {
            addRoute(toks[k + 1].v === "all" ? "ANY" : toks[k + 1].v.toUpperCase(), path, toks[k + 1].line, null);
            model.endpoints[model.endpoints.length - 1].router = v;
            k = close(k + 2, N) + 1;
          }
          continue;
        }
        if (HTTP_FUNCS.has(fnName) && isP(i + 3, "(") && toks[i + 4] && toks[i + 4].k === "str" && isP(i + 5, ",")) {
          const path = strVal(toks[i + 4]);
          if (path.startsWith("/") || path === "*") {
            addRoute(fnName === "all" ? "ANY" : fnName.toUpperCase(), path, toks[i + 4].line, null);
            model.endpoints[model.endpoints.length - 1].router = v;
          }
        }
      }
      if (v !== "export") exportNext = exportNext && /^(?:async|default|declare|abstract)$/.test(v);
    }

    /** express.Router() / Router({ ... }) / new Hono() など: 戻り値は先頭パス（なければ ""） */
    function routerCall(k) {
      let j = k;
      if (isId(j, "new")) j++;
      if (isId(j) && isP(j + 1, ".") && isId(j + 2)) j += 2;
      if (isId(j) && /^(?:Router|express|Hono|createRouter)$/.test(toks[j].v) && isP(j + 1, "(")) return "";
      return null;
    }

    // 同じファイルの app.use('/api', router) を、router のルートに付ける
    for (const pr of pendingRoutes) {
      if (!routerPrefix.has(pr.router)) continue;
      for (const ep of model.endpoints) if (ep.router === pr.router) ep.path = joinPath(pr.prefix, ep.path);
    }
    for (const f of model.funcs) if (!f.owner && exported.size && !f.local) f.exported = exported.has(f.name) || f.exported;
    model.exported = exported;
  }

  // ================================================================ Python

  /** Python を「論理行」に分ける（かっこの中の改行・\ 続き・複数行文字列をまとめる） */
  function pyLogical(src) {
    const out = [];
    const n = src.length;
    let i = 0;
    let line = 1;
    let buf = "";
    let depth = 0;
    let indent = 0;
    let start = 1;
    let fresh = true;
    while (i < n) {
      if (fresh) {
        let ind = 0;
        let j = i;
        while (j < n && (src[j] === " " || src[j] === "\t")) { ind += src[j] === "\t" ? 4 : 1; j++; }
        if (src[j] === "\n" || src[j] === "#" || j >= n || src[j] === "\r") {
          while (j < n && src[j] !== "\n") j++;
          i = j + 1;
          line++;
          continue;
        }
        indent = ind;
        start = line;
        i = j;
        fresh = false;
      }
      const c = src[i];
      if (c === "#") {
        while (i < n && src[i] !== "\n") i++;
        continue;
      }
      if (c === '"' || c === "'") {
        const triple = src.startsWith(c + c + c, i);
        const q = triple ? c + c + c : c;
        let j = i + q.length;
        let content = "";
        while (j < n) {
          if (src[j] === "\\") { content += src.substr(j, 2); j += 2; continue; }
          if (src.startsWith(q, j)) { j += q.length; break; }
          if (src[j] === "\n") {
            if (!triple) break;
            line++;
            content += "\\n";
            j++;
            continue;
          }
          content += src[j];
          j++;
        }
        buf += triple ? '"' + content.replace(/"/g, '\\"') + '"' : c + content + c;
        i = j;
        continue;
      }
      if (c === "(" || c === "[" || c === "{") depth++;
      else if (c === ")" || c === "]" || c === "}") depth = Math.max(0, depth - 1);
      if (c === "\\" && src[i + 1] === "\n") { buf += " "; i += 2; line++; continue; }
      if (c === "\n") {
        line++;
        i++;
        if (depth > 0) { buf += " "; continue; }
        if (buf.trim()) out.push({ text: buf.trim(), indent, line: start });
        buf = "";
        fresh = true;
        continue;
      }
      if (c !== "\r") buf += c;
      i++;
    }
    if (buf.trim()) out.push({ text: buf.trim(), indent, line: start });
    return out;
  }

  /** 文字列とかっこを考えて、, で分ける */
  function splitPy(s) {
    const out = [];
    let depth = 0;
    let cur = "";
    let q = null;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (q) {
        cur += ch;
        if (ch === "\\") { cur += s[++i] || ""; continue; }
        if (ch === q) q = null;
        continue;
      }
      if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
      if ("([{".includes(ch)) depth++;
      else if (")]}".includes(ch)) depth--;
      if (ch === "," && depth === 0) { out.push(cur.trim()); cur = ""; continue; }
      cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }

  function closeParen(s, open) {
    let depth = 0;
    let q = null;
    for (let i = open; i < s.length; i++) {
      const ch = s[i];
      if (q) {
        if (ch === "\\") i++;
        else if (ch === q) q = null;
        continue;
      }
      if (ch === '"' || ch === "'") q = ch;
      else if ("([{".includes(ch)) depth++;
      else if (")]}".includes(ch)) {
        depth--;
        if (depth === 0) return i;
      }
    }
    return s.length;
  }

  function pyParams(str) {
    const out = [];
    for (const part of splitPy(str)) {
      if (part === "/" || part === "*") continue;
      let m = part.match(/^(\*{1,2})\s*([A-Za-z_]\w*)\s*(?::\s*(.+))?$/);
      if (m) {
        out.push({ name: m[2], type: m[3] || null, default: null, optional: true, variadic: true });
        continue;
      }
      m = part.match(/^([A-Za-z_]\w*)\s*(?::\s*([^=]+?))?\s*(?:=\s*([\s\S]+))?$/);
      if (m) out.push({ name: m[1], type: m[2] ? m[2].trim() : null, default: m[3] !== undefined ? m[3].trim() : null, optional: m[3] !== undefined, variadic: false });
    }
    return out;
  }

  const unq = (s) => {
    const m = String(s).match(/^[rbuf]*(['"])(.*)\1$/is);
    return m ? m[2] : null;
  };

  function parsePython(src, model) {
    const lines = pyLogical(src);
    const scopes = [];
    let decorators = [];
    const routerPrefix = new Map();

    for (const L of lines) {
      while (scopes.length && L.indent <= scopes[scopes.length - 1].indent) scopes.pop();
      const t = L.text;
      const top = scopes[scopes.length - 1] || null;

      if (t.startsWith("@")) {
        decorators.push(t.slice(1).trim());
        continue;
      }
      let m = t.match(/^(async\s+)?def\s+([A-Za-z_]\w*)\s*\(/);
      if (m) {
        const open = t.indexOf("(", m[0].length - 1);
        const c = closeParen(t, open);
        const rest = t.slice(c + 1);
        const rm = rest.match(/^\s*(?:->\s*([^:]+?))?\s*:/);
        const owner = top && top.kind === "class" ? top.type : null;
        let ps = pyParams(t.slice(open + 1, c));
        const isStatic = decorators.some((d) => d === "staticmethod");
        if (!isStatic && ps[0] && /^(?:self|cls)$/.test(ps[0].name)) ps = ps.slice(1);
        const name = m[2];
        const f = {
          name, owner: owner ? owner.name : null, params: ps, returns: rm && rm[1] ? rm[1].trim() : null,
          private: /^_(?!_)/.test(name) || (owner && owner.private), static: isStatic, local: !!(top && top.kind === "def"),
          isCtor: name === "__init__", file: model.file, line: L.line, lang: "python", async: !!m[1],
        };
        if (decorators.includes("property") && owner) {
          if (!owner.fields.some((x) => x.name === name)) owner.fields.push({ name, type: f.returns, value: null, line: L.line, static: false, private: f.private, accessor: true });
        } else model.funcs.push(f);
        for (const d of decorators) pyRoute(d, name, L.line);
        scopes.push({ kind: "def", indent: L.indent, func: f, owner });
        decorators = [];
        continue;
      }
      m = t.match(/^class\s+([A-Za-z_]\w*)\s*(?:\((.*)\))?\s*:/);
      if (m) {
        const bases = m[2] || "";
        const isEnum = /\b(?:Enum|IntEnum|StrEnum|Flag|IntFlag)\b/.test(bases);
        const type = {
          name: m[1], kind: isEnum ? "enum" : "class", fields: [], values: isEnum ? [] : null,
          file: model.file, line: L.line, private: /^_/.test(m[1]), local: !!(top && top.kind === "def"),
          owner: top && top.kind === "class" ? top.type.name : null,
        };
        model.types.push(type);
        scopes.push({ kind: "class", indent: L.indent, type });
        decorators = [];
        continue;
      }
      decorators = [];

      if (top && top.kind === "class") {
        m = t.match(/^([A-Za-z_]\w*)\s*(?::\s*([^=]+?))?\s*(?:=(?!=)\s*(.+))?$/);
        if (m && (m[2] || m[3] !== undefined)) {
          const type = top.type;
          if (type.values) {
            if (!/^_/.test(m[1])) type.values.push({ name: m[1], line: L.line, value: m[3] || null });
          } else {
            type.fields.push({ name: m[1], type: m[2] ? m[2].trim() : null, value: m[3] !== undefined ? m[3].trim() : null, line: L.line, static: !m[2], private: /^_/.test(m[1]) });
            if (m[3] !== undefined && isUpperConst(m[1])) model.consts.push({ name: m[1], value: m[3].trim(), owner: type.name, file: model.file, line: L.line });
          }
        }
        continue;
      }
      if (top && top.kind === "def") {
        // self.x = ... はクラスのフィールド（__init__ の中だけ見る）
        const fn = scopes.find((s) => s.kind === "def" && s.owner);
        if (fn && fn.func.isCtor) {
          m = t.match(/^self\.([A-Za-z_]\w*)\s*(?::\s*([^=]+?))?\s*=(?!=)\s*(.+)$/);
          if (m && !fn.owner.fields.some((x) => x.name === m[1])) {
            const p = fn.func.params.find((x) => x.name === m[3].trim());
            fn.owner.fields.push({ name: m[1], type: m[2] ? m[2].trim() : p ? p.type : null, value: m[3].trim(), line: L.line, static: false, private: /^_/.test(m[1]) });
          }
        }
        continue;
      }
      // モジュールの一番外側
      m = t.match(/^([A-Za-z_]\w*)\s*(?::\s*([^=]+?))?\s*=(?!=)\s*(.+)$/);
      if (m) {
        const r = m[3].match(/^(?:\w+\.)?(APIRouter|Blueprint)\s*\((.*)\)\s*$/);
        if (r) {
          const pm = r[2].match(/(?:url_)?prefix\s*=\s*([rbuf]*(['"]).*?\2)/);
          routerPrefix.set(m[1], pm ? unq(pm[1]) : "");
        } else if (isUpperConst(m[1])) model.consts.push({ name: m[1], value: m[3].trim(), owner: null, file: model.file, line: L.line });
        continue;
      }
      m = t.match(/\.(?:include_router|register_blueprint)\s*\(\s*([\w.]+)\s*,.*?(?:url_)?prefix\s*=\s*([rbuf]*(['"]).*?\3)/);
      if (m) model.prefixes.push(unq(m[2]));
    }

    function pyRoute(d, handler, line) {
      const m = d.match(/^([\w.]+)\.(get|post|put|delete|patch|head|options|route|api_route|websocket)\s*\(\s*(?:path\s*=\s*|rule\s*=\s*)?([rbuf]*(['"])(.*?)\4)?(.*)$/is);
      if (!m) return;
      const path = m[5] !== undefined ? m[5] : "";
      let methods;
      if (m[2] === "route" || m[2] === "api_route") {
        const mm = (m[6] || "").match(/methods\s*=\s*[[(]([^\])]*)[\])]/);
        methods = mm ? (mm[1].match(/(['"])(.*?)\1/g) || []).map((x) => x.slice(1, -1).toUpperCase()) : ["GET"];
      } else methods = [m[2] === "websocket" ? "WS" : m[2].toUpperCase()];
      const prefix = routerPrefix.get(m[1]) || "";
      for (const me of methods) model.endpoints.push({ method: me, path: joinPath(prefix, path), handler, file: model.file, line });
    }
  }

  // ================================================================ 入口

  const WORD = /[A-Za-z_$][\w$]*/g;

  function collectWords(text, model) {
    const words = model.words;
    const lines = model.lines;
    for (let ln = 0; ln < lines.length; ln++) {
      const l = lines[ln];
      if (l.length > 4000) continue;
      WORD.lastIndex = 0;
      let m;
      while ((m = WORD.exec(l))) if (!words.has(m[0])) words.set(m[0], ln + 1);
    }
  }

  /**
   * 1つのファイルを読む。
   * opts.loose = true のとき（仕様書の中のコード例）は、クラスの外に書かれたメソッドも読む。
   */
  function parseCode(text, file, opts) {
    const o = opts || {};
    const src = String(text || "").replace(/\r\n?/g, "\n");
    const lang = o.lang || langOf(file || "", src) || "js";
    const model = {
      file: file || "(貼りつけ)", lang, lines: src.split("\n"),
      funcs: [], types: [], consts: [], endpoints: [], prefixes: [], words: new Map(), exported: new Set(),
    };
    try {
      if (lang === "python") parsePython(src, model);
      else {
        const toks = lexC(src, lang);
        const match = matchBrackets(toks);
        if (lang === "java") parseJava(toks, match, model, !!o.loose);
        else parseJs(toks, match, model, lang);
      }
    } catch (e) {
      model.error = String(e && e.message ? e.message : e);
    }
    if (!o.skipWords) collectWords(src, model);
    return model;
  }

  const api = { parseCode, langOf, detectLang, lexC, pyLogical, joinPath };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SpecCheckCode = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
