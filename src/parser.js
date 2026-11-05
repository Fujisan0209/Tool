/*
 * Java の構文解析（その場チェック用）。
 * 書きかけ・まちがいのあるコードでも、できるところまで木（AST）を作ります。
 * まちがいは 1 か所につき 1 つだけ報告し、次の文から読み直します（エラーが連鎖しないように）。
 *
 * ノードはすべて { k: 種類, s: 開始位置, e: 終了位置, ... } の形です。
 */
(function (root) {
  "use strict";

  const PRIMS = new Set(["boolean", "byte", "short", "int", "long", "char", "float", "double"]);
  const MODS = new Set([
    "public", "protected", "private", "static", "abstract", "final", "native", "synchronized",
    "transient", "volatile", "strictfp", "default",
  ]);
  const ASSIGN_OPS = new Set(["=", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "<<=", ">>=", ">>>="]);
  const BIN_PREC = {
    "||": 3, "&&": 4, "|": 5, "^": 6, "&": 7, "==": 8, "!=": 8,
    "<": 9, ">": 9, "<=": 9, ">=": 9, instanceof: 9,
    "<<": 10, ">>": 10, ">>>": 10, "+": 11, "-": 11, "*": 12, "/": 12, "%": 12,
  };
  // 文の先頭に来る予約語
  const STMT_KW = new Set([
    "if", "for", "while", "do", "switch", "return", "break", "continue", "throw", "try", "synchronized",
    "assert", "else", "case", "default", "catch", "finally",
  ]);
  const BAIL = { bail: true };

  function parse(src, lexed) {
    const T = lexed.tokens.filter((t) => t.t !== "bad");
    for (let i = 0; i < T.length; i++) {
      const t = T[i];
      t.i = i;
      t.nl = i === 0 || /[\n\r]/.test(src.slice(T[i - 1].e, t.s));
    }

    // ( [ { の対応（先読み用）
    const match = new Int32Array(T.length).fill(-1);
    {
      const st = [];
      const OPEN = { ")": "(", "]": "[", "}": "{" };
      for (let i = 0; i < T.length; i++) {
        const t = T[i];
        if (t.t !== "op") continue;
        if (t.v === "(" || t.v === "[" || t.v === "{") st.push(i);
        else if (OPEN[t.v]) {
          let j = st.length - 1;
          while (j >= 0 && T[st[j]].v !== OPEN[t.v]) j--;
          if (j >= 0) {
            match[st[j]] = i;
            match[i] = st[j];
            st.length = j;
          }
        }
      }
    }

    const errors = [];
    const skips = []; // エラーのあと読み飛ばした範囲
    let p = 0;
    let lastErrEnd = -1;
    let quietUntil = -1; // 閉じていない文字列のあとは、しばらくエラーを出さない
    const classStack = []; // いま読んでいるクラスの名前

    /* ---------------- 小さな道具 ---------------- */
    const at = (k) => T[Math.min(p + (k || 0), T.length - 1)];
    const cur = () => T[p];
    const prev = () => T[p > 0 ? p - 1 : 0];
    const isOp = (v, k) => {
      const t = at(k);
      return t.t === "op" && t.v === v;
    };
    const isKw = (v, k) => {
      const t = at(k);
      return t.t === "kw" && t.v === v;
    };
    const isId = (k) => at(k).t === "id";
    const isIdV = (v, k) => at(k).t === "id" && at(k).v === v;
    const isEOF = () => T[p].t === "eof";
    function eat(v) {
      const t = T[p];
      if ((t.t === "op" || t.t === "kw") && t.v === v) {
        p++;
        return t;
      }
      return null;
    }
    // > を組み合わせて >> >>> >= >>= を作る（ジェネリクスの > と区別するため）
    function gtOp() {
      if (!isOp(">")) return null;
      let k = 1;
      let v = ">";
      while (k < 3 && isOp(">", k) && at(k).s === at(k - 1).e) {
        v += ">";
        k++;
      }
      if (isOp("=", k) && at(k).s === at(k - 1).e) {
        v += "=";
        k++;
      } else if (isOp("==", k) && at(k).s === at(k - 1).e && v === ">") {
        return null;
      }
      return { v, n: k };
    }
    const node = (k, s, props) => Object.assign({ k, s, e: s }, props);
    const fin = (n) => {
      n.e = Math.max(n.s, prev().e);
      return n;
    };

    function report(s, e, id, msg, fix, edits, sev) {
      if (s <= lastErrEnd && sev !== "warn") return;
      if (s <= quietUntil && sev !== "warn") return;
      errors.push({ s, e, id, msg, fix, edits: edits || null, sev: sev || "error" });
      if (sev !== "warn") lastErrEnd = Math.max(e, s);
    }
    function warn(s, e, id, msg, fix, edits) {
      errors.push({ s, e, id, msg, fix, edits: edits || null, sev: "warn" });
    }

    const tokText = (t) => (t.t === "eof" ? "ファイルの終わり" : `「${t.v.length > 12 ? t.v.slice(0, 12) + "…" : t.v}」`);
    const isValueTok = (t) =>
      t.t === "id" || t.t === "num" || t.t === "str" || t.t === "chr" ||
      (t.t === "kw" && (t.v === "true" || t.v === "false" || t.v === "null" || t.v === "this" || t.v === "new"));

    /** 「;」がないときの処理。次の行から新しい文が始まっていれば、; があることにして読み続ける */
    function semi() {
      if (eat(";")) return;
      const t = cur();
      const pr = prev();
      const looksNewStmt =
        t.t === "eof" || isOp("}") || t.nl ||
        (t.t === "kw" && t.v !== "instanceof") ||
        (t.t === "id" && (isId(1) || isOp(".", 1) || isOp("(", 1) || isOp("=", 1) || isOp("<", 1) || isOp("[", 1)));
      if (looksNewStmt) {
        report(pr.s, pr.e, "missing-semicolon", "「;」がない", "文の終わりに ; を書く", [{ s: pr.e, e: pr.e, text: ";" }]);
        return;
      }
      unexpected(t, "statement");
      throw BAIL;
    }

    /** 予想外のトークン */
    function unexpected(t, ctx) {
      const pr = prev();
      if (isValueTok(t) && (pr.t === "str" || t.t === "str") && (isValueTok(pr) || isOp(")", -1))) {
        report(pr.e, t.s, "missing-plus", "「+」が抜けている？", "文字列とつなげるなら間に + を書く", [{ s: pr.e, e: pr.e, text: " +" }]);
        return;
      }
      if (isValueTok(t) && (isValueTok(pr) || (pr.t === "op" && (pr.v === ")" || pr.v === "]")))) {
        report(t.s, t.e, "missing-operator", "演算子か「,」が抜けている？", `${tokText(pr)} と ${tokText(t)} の間に + や , が要る`);
        return;
      }
      if (t.t === "op" && (t.v === ")" || t.v === "]")) {
        report(t.s, t.e, "extra-paren", `「${t.v}」が多い`, `余分な ${t.v} を消す（かっこの数を数える）`, [{ s: t.s, e: t.e, text: "" }]);
        return;
      }
      if (t.t === "eof") {
        report(pr.s, pr.e, "unexpected-eof", "途中でファイルが終わっている", "書きかけの文を最後まで書く");
        return;
      }
      if (ctx === "statement" && t.t === "op" && t.v === "=" && isOp("=", -1)) {
        report(t.s, t.e, "unexpected", "「=」が多い", "比較は ==、代入は = の1つ");
        return;
      }
      report(t.s, t.e, "unexpected", `ここに ${tokText(t)} は書けない`, "前後の書き方を見直す");
    }

    /** v がないときのエラー */
    function expect(v, what) {
      const t = eat(v);
      if (t) return t;
      const c = cur();
      const pr = prev();
      if (v === ";") {
        semi();
        return null;
      }
      if (v === ")" || v === "]" || v === "}") {
        if (isValueTok(c) && !c.nl && (pr.t === "str" || c.t === "str" || isValueTok(pr))) {
          unexpected(c);
          throw BAIL;
        }
        report(pr.s, pr.e, "missing-" + (v === ")" ? "paren" : v === "]" ? "bracket" : "brace"),
          `「${v}」が足りない`, `${what ? what + "の最後に" : "ここに"} ${v} を書く`, [{ s: pr.e, e: pr.e, text: v }]);
        throw BAIL;
      }
      if (v === "(") {
        report(c.s, c.e, "missing-open-paren", `${what || ""}のあとに「(」が要る`, `${what || ""} ( … ) の形で書く`);
        throw BAIL;
      }
      if (v === "{") {
        report(c.s, c.e, "missing-open-brace", `${what || "ここ"}に「{」が要る`, `{ … } で囲んで書く`);
        throw BAIL;
      }
      if (v === ":") {
        report(c.s, c.e, "missing-colon", "「:」が要る", "case 値: の形で書く");
        throw BAIL;
      }
      unexpected(c);
      throw BAIL;
    }

    function ident(what) {
      const t = cur();
      if (t.t === "id") {
        p++;
        return t;
      }
      if (t.t === "kw" && !PRIMS.has(t.v) && t.v !== "true" && t.v !== "false" && t.v !== "null") {
        report(t.s, t.e, "keyword-as-name", `「${t.v}」は予約語なので名前に使えない`, "ほかの名前にする");
        p++;
        return { t: "id", v: t.v, s: t.s, e: t.e, bad: true };
      }
      if (t.t === "num") {
        report(t.s, t.e, "bad-name", "名前は数字から始められない", "英字から始まる名前にする");
        throw BAIL;
      }
      report(t.s, t.e, "missing-name", `${what || "名前"}が要る`, `${what || "名前"}を書く`);
      throw BAIL;
    }

    /* ---------------- 読み飛ばし（エラーのあと） ---------------- */
    function syncStatement() {
      const startP = p;
      try {
        syncStatement0();
      } finally {
        if (p > startP) skips.push({ s: T[startP].s, e: T[p - 1].e });
        else skips.push({ s: T[startP].s, e: T[startP].e });
      }
    }
    function syncStatement0() {
      const startP = p;
      while (!isEOF()) {
        const t = cur();
        if (t.t === "op") {
          if (t.v === ";") {
            p++;
            return;
          }
          if (t.v === "}") {
            if (p === startP) p++;
            return;
          }
          if ((t.v === "(" || t.v === "[" || t.v === "{") && match[p] > p) {
            const wasBrace = t.v === "{";
            p = match[p] + 1;
            if (wasBrace) return;
            continue;
          }
        }
        if (p > startP && t.nl) return;
        p++;
      }
    }
    function syncMember() {
      const startP = p;
      try {
        syncMember0();
      } finally {
        skips.push({ s: T[startP].s, e: T[Math.max(startP, p - 1)].e });
      }
    }
    function syncMember0() {
      const startP = p;
      while (!isEOF()) {
        const t = cur();
        if (t.t === "op") {
          if (t.v === ";") {
            p++;
            return;
          }
          if (t.v === "}") {
            if (p === startP) p++;
            return;
          }
          if ((t.v === "(" || t.v === "[" || t.v === "{") && match[p] > p) {
            const wasBrace = t.v === "{";
            p = match[p] + 1;
            if (wasBrace) return;
            continue;
          }
        }
        if (p > startP && t.nl && (t.t === "kw" && (MODS.has(t.v) || t.v === "class" || t.v === "void" || PRIMS.has(t.v)))) return;
        p++;
      }
    }

    /* ---------------- 型 ---------------- */

    /** 型を読む。読めなければ null（p は戻す）。エラーは出さない */
    function tryType(allowVar) {
      const save = p;
      const t = typeNoErr(allowVar);
      if (!t) p = save;
      return t;
    }
    function typeNoErr() {
      skipAnnotations();
      const t = cur();
      let ty;
      if (t.t === "kw" && PRIMS.has(t.v)) {
        p++;
        ty = { k: "Type", name: t.v, prim: true, args: null, dims: 0, s: t.s, e: t.e };
      } else if (t.t === "kw" && t.v === "void") {
        p++;
        ty = { k: "Type", name: "void", prim: true, args: null, dims: 0, s: t.s, e: t.e };
      } else if (t.t === "id") {
        p++;
        let name = t.v;
        let args = null;
        if (isOp("<")) {
          args = typeArgs();
          if (!args) return null;
        }
        while (isOp(".") && (at(1).t === "id" || isOp("@", 1))) {
          p++;
          skipAnnotations();
          if (!isId()) return null;
          name += "." + cur().v;
          p++;
          if (isOp("<")) {
            args = typeArgs();
            if (!args) return null;
          }
        }
        ty = { k: "Type", name, prim: false, args, dims: 0, s: t.s, e: prev().e };
      } else return null;
      while (isOp("[") && isOp("]", 1)) {
        p += 2;
        ty.dims++;
      }
      if (isOp("@")) {
        const save = p;
        skipAnnotations();
        if (isOp("[") && isOp("]", 1)) {
          while (isOp("[") && isOp("]", 1)) {
            p += 2;
            ty.dims++;
          }
        } else p = save;
      }
      ty.e = prev().e;
      return ty;
    }
    function typeArgs() {
      // < ... > 。> が >> になっていても大丈夫
      const lt = cur();
      p++;
      const args = [];
      if (isOp(">")) {
        p++;
        args.diamond = true;
        args.s = lt.s;
        return args;
      }
      for (;;) {
        skipAnnotations();
        if (isOp("?")) {
          const q = cur();
          p++;
          let bound = null;
          if (isKw("extends") || isKw("super")) {
            p++;
            bound = typeNoErr();
            if (!bound) return null;
          }
          args.push({ k: "Type", name: "?", wildcard: true, bound, prim: false, args: null, dims: 0, s: q.s, e: prev().e });
        } else {
          const a = typeNoErr();
          if (!a) return null;
          args.push(a);
        }
        if (isOp(",")) {
          p++;
          continue;
        }
        if (isOp(">")) {
          p++;
          break;
        }
        return null;
      }
      args.s = lt.s;
      return args;
    }
    function typeOrErr(what) {
      const t = tryType();
      if (t) return t;
      const c = cur();
      report(c.s, c.e, "missing-type", `${what || "型"}が要る`, "int や String などの型を書く");
      throw BAIL;
    }
    function skipAnnotations() {
      const list = [];
      while (isOp("@") && !isKw("interface", 1)) {
        const s = cur().s;
        p++;
        let name = "";
        if (isId()) {
          name = cur().v;
          p++;
          while (isOp(".") && isId(1)) {
            p += 2;
            name = prev().v;
          }
        }
        if (isOp("(") && match[p] > p) p = match[p] + 1;
        list.push({ name, s, e: prev().e });
      }
      return list;
    }
    function typeParams() {
      // <T extends Comparable<T>, U>
      if (!isOp("<")) return null;
      const out = [];
      p++;
      for (;;) {
        skipAnnotations();
        const n = ident("型パラメータ名");
        const tp = { name: n.v, bounds: [] };
        if (eat("extends")) {
          tp.bounds.push(typeOrErr());
          while (eat("&")) tp.bounds.push(typeOrErr());
        }
        out.push(tp);
        if (eat(",")) continue;
        if (isOp(">")) {
          p++;
          break;
        }
        expect(">");
      }
      return out;
    }

    /* ---------------- 修飾子 ---------------- */
    function modifiers() {
      const mods = { list: [], annos: [], s: cur().s };
      for (;;) {
        const t = cur();
        if (t.t === "op" && t.v === "@" && !isKw("interface", 1)) {
          mods.annos.push(...skipAnnotations());
          continue;
        }
        if (t.t === "kw" && MODS.has(t.v)) {
          // switch の default: とまちがえないように
          if (t.v === "default" && (isOp(":", 1) || isOp("->", 1))) break;
          if (mods.list.includes(t.v)) report(t.s, t.e, "dup-modifier", `「${t.v}」が2回ある`, "1つ消す", [{ s: t.s, e: t.e, text: "" }]);
          mods.list.push(t.v);
          p++;
          continue;
        }
        if (t.t === "id" && (t.v === "sealed" || t.v === "non") && (isKw("class", 1) || isKw("interface", 1) || isKw("abstract", 1) || isOp("-", 1))) {
          if (t.v === "non") p += 3;
          else p++;
          continue;
        }
        break;
      }
      return mods;
    }

    /* ---------------- ファイル全体 ---------------- */
    function compilationUnit() {
      const cu = { k: "Unit", s: 0, e: src.length, pkg: null, imports: [], types: [], stray: [] };
      try {
        const save = p;
        skipAnnotations();
        if (isKw("package")) {
          const s = cur().s;
          p++;
          const name = qualifiedName();
          cu.pkg = { name, s, e: prev().e };
          semi();
        } else p = save;
      } catch (e) {
        if (e !== BAIL) throw e;
        syncStatement();
      }
      while (isKw("import")) {
        try {
          const s = cur().s;
          p++;
          const isStatic = !!eat("static");
          let name = qualifiedName(true);
          let star = false;
          if (name.endsWith(".*")) {
            star = true;
            name = name.slice(0, -2);
          }
          const imp = { k: "Import", name, star, static: isStatic, s, e: prev().e };
          semi();
          imp.e = prev().e;
          cu.imports.push(imp);
        } catch (e) {
          if (e !== BAIL) throw e;
          syncStatement();
        }
      }
      while (!isEOF()) {
        if (eat(";")) continue;
        const start = p;
        try {
          const mods = modifiers();
          if (isKw("class") || isKw("interface") || isKw("enum") || isRecordStart() || (isOp("@") && isKw("interface", 1))) {
            cu.types.push(typeDecl(mods));
            continue;
          }
          if (isKw("import")) {
            const t = cur();
            report(t.s, t.e, "import-position", "import はファイルの先頭に書く", "class より上に移動する");
            p++;
            qualifiedName(true);
            semi();
            continue;
          }
          if (isKw("package")) {
            const t = cur();
            report(t.s, t.e, "package-position", "package はファイルのいちばん上に書く", "1行目に移動する");
            p++;
            qualifiedName();
            semi();
            continue;
          }
          // クラスの外にあるもの
          const t = cur();
          if (isOp("}")) {
            report(t.s, t.e, "extra-brace", "「}」が多い", "対応する { がない。余分な } を消す", [{ s: t.s, e: t.e, text: "" }]);
            p++;
            continue;
          }
          // メソッドや文がクラスの外にある
          p = start;
          const m = member(null, true);
          if (m) cu.stray.push(m);
        } catch (e) {
          if (e !== BAIL) throw e;
          if (p === start) p++;
          syncMember();
        }
      }
      return cu;
    }

    function qualifiedName(allowStar) {
      let name = ident("名前").v;
      while (isOp(".")) {
        p++;
        if (allowStar && isOp("*")) {
          p++;
          return name + ".*";
        }
        name += "." + ident("名前").v;
      }
      return name;
    }

    function isRecordStart() {
      return isIdV("record") && isId(1) && (isOp("(", 2) || isOp("<", 2));
    }

    /* ---------------- クラス ---------------- */
    function typeDecl(mods) {
      const s = mods.list.length || mods.annos.length ? mods.s : cur().s;
      let kind;
      if (eat("class")) kind = "class";
      else if (eat("interface")) kind = "interface";
      else if (eat("enum")) kind = "enum";
      else if (isOp("@")) {
        p += 2;
        kind = "annotation";
      } else {
        p++;
        kind = "record";
      }
      const nameTok = ident("クラス名");
      const cls = {
        k: "Class", kind, name: nameTok.v, nameTok, mods, s, e: s, tparams: null, ext: null, impls: [],
        members: [], consts: [], comps: null, bodyS: 0,
      };
      if (isOp("<")) cls.tparams = typeParams();
      if (kind === "record") {
        expect("(", "record 名");
        cls.comps = [];
        if (!isOp(")")) {
          do {
            const pm = modifiers();
            const ty = typeOrErr();
            if (eat("...")) ty.dims++, (ty.varargs = true);
            const n = ident("名前");
            cls.comps.push({ k: "Param", mods: pm, type: ty, name: n.v, nameTok: n, s: ty.s, e: n.e });
          } while (eat(","));
        }
        expect(")", "record の部品");
      }
      if (eat("extends")) {
        if (kind === "interface") {
          do cls.impls.push(typeOrErr()); while (eat(","));
        } else {
          cls.ext = typeOrErr("親クラス");
          if (isOp(",")) {
            const c = cur();
            report(c.s, c.e, "multi-extends", "extends できるクラスは1つだけ", "2つ目以降は implements（インタフェース）にする");
            while (eat(",")) typeOrErr();
          }
        }
      }
      if (eat("implements")) {
        do cls.impls.push(typeOrErr("インタフェース")); while (eat(","));
      }
      if (isIdV("permits")) {
        p++;
        do typeOrErr(); while (eat(","));
      }
      if (!isOp("{")) {
        const c = cur();
        const pr = prev();
        if (isOp("(") && kind === "class") {
          report(c.s, c.e, "class-paren", "クラス名のあとに ( ) は書かない", "public class Main { の形にする");
          if (match[p] > p) p = match[p] + 1;
        } else {
          report(pr.s, pr.e, "missing-open-brace", "クラスの「{」がない", `${cls.name} のあとに { を書く`, [{ s: pr.e, e: pr.e, text: " {" }]);
        }
        if (!isOp("{")) {
          cls.e = prev().e;
          return cls;
        }
      }
      const open = cur();
      p++;
      cls.bodyS = open.s;
      classStack.push(cls);
      try {
        if (kind === "enum") enumConstants(cls);
        classBody(cls);
      } finally {
        classStack.pop();
      }
      if (isOp("}")) {
        cls.bodyE = cur().e;
        p++;
      }
      cls.e = prev().e;
      return cls;
    }

    function enumConstants(cls) {
      while (!isEOF() && !isOp(";") && !isOp("}")) {
        try {
          skipAnnotations();
          const n = ident("定数名");
          const c = { name: n.v, nameTok: n, args: null, body: null, s: n.s, e: n.e };
          if (isOp("(")) c.args = args();
          if (isOp("{")) {
            const anon = { k: "Class", kind: "class", name: "", anon: true, members: [], consts: [], mods: { list: [], annos: [] }, s: cur().s, impls: [], ext: null };
            p++;
            classStack.push(anon);
            try {
              classBody(anon);
            } finally {
              classStack.pop();
            }
            expect("}");
            c.body = anon;
          }
          c.e = prev().e;
          cls.consts.push(c);
          if (!eat(",")) break;
        } catch (e) {
          if (e !== BAIL) throw e;
          syncMember();
        }
      }
      eat(";");
    }

    function classBody(cls) {
      while (!isEOF() && !isOp("}")) {
        if (eat(";")) continue;
        const start = p;
        try {
          const m = member(cls, false);
          if (m) cls.members.push(m);
        } catch (e) {
          if (e !== BAIL) throw e;
          if (p === start) p++;
          syncMember();
        }
      }
    }

    /** クラスのメンバー1つ。outside=true はクラスの外 */
    function member(cls, outside) {
      const start = p;
      const st = cur();
      // 初期化ブロック
      if (isOp("{") || (isKw("static") && isOp("{", 1))) {
        const isStatic = !!eat("static");
        const body = block();
        if (outside) report(st.s, st.s + 1, "outside-class", "クラスの外に { } がある", "class の { } の中に入れる");
        return { k: "Init", static: isStatic, body, s: st.s, e: body.e };
      }
      const mods = modifiers();
      const s = mods.list.length || mods.annos.length ? mods.s : cur().s;
      if (isKw("class") || isKw("interface") || isKw("enum") || isRecordStart() || (isOp("@") && isKw("interface", 1))) {
        return typeDecl(mods);
      }
      // 文がクラスの中（メソッドの外）にある
      const t = cur();
      if (t.t === "kw" && STMT_KW.has(t.v) && t.v !== "synchronized" && t.v !== "default") {
        return strayStatement(start, outside);
      }
      let tparams = null;
      if (isOp("<")) tparams = typeParams();
      const enclosing = cls ? cls.name : "";
      // コンストラクタ（または戻り値の型を忘れたメソッド）
      if (isId() && isOp("(", 1)) {
        const nameTok = cur();
        const close = match[p + 1];
        const after = close > 0 ? T[close + 1] : null;
        const looksDecl = after && ((after.t === "op" && (after.v === "{" || after.v === ";")) || (after.t === "kw" && after.v === "throws"));
        if (!looksDecl) return strayStatement(start, outside);
        if (outside || nameTok.v !== enclosing) {
          if (!outside && nameTok.v.toLowerCase() === enclosing.toLowerCase()) {
            report(nameTok.s, nameTok.e, "ctor-name", "コンストラクタ名がクラス名とちがう", `大文字・小文字も同じ ${enclosing} にする`, [{ s: nameTok.s, e: nameTok.e, text: enclosing }]);
          } else if (!outside) {
            report(nameTok.s, nameTok.e, "missing-return-type", "戻り値の型がない", "名前の前に void（返さないとき）や int などを書く", [{ s: nameTok.s, e: nameTok.s, text: "void " }]);
            p++;
            return methodRest(mods, tparams, { k: "Type", name: "?", unknown: true, prim: false, args: null, dims: 0, s: nameTok.s, e: nameTok.s }, nameTok, s, outside);
          }
        }
        p++;
        return methodRest(mods, tparams, null, nameTok, s, outside);
      }
      // record のコンパクトコンストラクタ  Name {
      if (cls && cls.kind === "record" && isIdV(enclosing) && isOp("{", 1)) {
        const nameTok = cur();
        p++;
        const body = block();
        return { k: "Method", ctor: true, compact: true, mods, tparams, ret: null, name: nameTok.v, nameTok, params: [], throws: [], body, s, e: body.e };
      }
      const save = p;
      const ty = tryType();
      if (!ty) {
        if (isEOF()) {
          throw BAIL;
        }
        return strayStatement(start, outside);
      }
      if (!isId()) {
        // System.out.println(...); や x = 5; など
        p = save;
        return strayStatement(start, outside);
      }
      const nameTok = cur();
      p++;
      if (isOp("(")) return methodRest(mods, tparams, ty, nameTok, s, outside);
      // フィールド
      if (outside) {
        report(nameTok.s, nameTok.e, "outside-class", "クラスの外に変数がある", "class の { } の中に入れる");
      }
      const f = { k: "Field", mods, type: ty, vars: [], s, e: s };
      p--;
      varDeclarators(f.vars, ty);
      semi();
      return fin(f);
    }

    /** メソッドの外にある文：文として読んで、エラーにする */
    function strayStatement(start, outside) {
      p = start;
      const st = cur();
      const stmt = statement();
      const msg = outside ? "命令がクラスの外にある" : "命令がメソッドの外にある";
      const fix = outside ? "class の中の、main などのメソッドの { } の中に書く" : "main などのメソッドの { } の中に書く";
      report(st.s, Math.max(st.e, stmt.e), outside ? "outside-class" : "statement-outside-method", msg, fix);
      return { k: "Stray", stmt, s: stmt.s, e: stmt.e };
    }

    function methodRest(mods, tparams, ret, nameTok, s, outside) {
      const m = {
        k: "Method", ctor: ret === null, mods, tparams, ret, name: nameTok.v, nameTok, params: [], throws: [],
        body: null, s, e: s, outside,
      };
      m.params = params();
      while (isOp("[") && isOp("]", 1)) {
        p += 2;
        if (ret) ret.dims++;
      }
      if (eat("throws")) {
        do m.throws.push(typeOrErr("例外")); while (eat(","));
      }
      if (isKw("default")) {
        p++;
        if (isOp("{")) arrayInit();
        else expr();
      }
      if (isOp("{")) {
        m.body = block();
      } else if (isOp(";")) {
        m.semiTok = cur();
        p++;
      } else {
        const c = cur();
        const pr = prev();
        report(pr.s, pr.e, "missing-open-brace", "メソッドの「{」がない", ") のあとに { を書く", [{ s: pr.e, e: pr.e, text: " {" }]);
        throw BAIL;
      }
      if (outside) report(nameTok.s, nameTok.e, "outside-class", "メソッドがクラスの外にある", "class の { } の中に入れる（} が多くないか確認）");
      return fin(m);
    }

    function params() {
      const open = expect("(", "メソッド名");
      const list = [];
      if (eat(")")) return list;
      for (;;) {
        const pm = modifiers();
        const pstart = cur();
        // 型を書き忘れた引数: foo(x, y)
        if (isId() && (isOp(",", 1) || isOp(")", 1))) {
          report(pstart.s, pstart.e, "param-type", "引数に型がない", `int ${pstart.v} のように型を書く`, [{ s: pstart.s, e: pstart.s, text: "int " }]);
          p++;
          list.push({ k: "Param", mods: pm, type: { k: "Type", name: "?", prim: false, dims: 0, s: pstart.s, e: pstart.e, unknown: true }, name: pstart.v, nameTok: pstart, s: pstart.s, e: pstart.e });
        } else {
          const ty = typeOrErr("引数の型");
          if (isIdV("this") || isKw("this")) {
            p++;
          } else {
            let varargs = false;
            if (eat("...")) {
              varargs = true;
              ty.dims++;
            }
            const n = ident("引数名");
            while (isOp("[") && isOp("]", 1)) {
              p += 2;
              ty.dims++;
            }
            list.push({ k: "Param", mods: pm, type: ty, name: n.v, nameTok: n, varargs, s: ty.s, e: n.e });
          }
        }
        if (eat(",")) continue;
        if (eat(")")) break;
        if (isOp(";") || isOp("{")) {
          const pr = prev();
          report(pr.s, pr.e, "missing-paren", "「)」が足りない", ") を書く", [{ s: pr.e, e: pr.e, text: ")" }]);
          break;
        }
        expect(")");
      }
      void open;
      return list;
    }

    function varDeclarators(out, ty) {
      do {
        const n = ident("変数名");
        let dims = 0;
        while (isOp("[") && isOp("]", 1)) {
          p += 2;
          dims++;
        }
        const v = { k: "Var", name: n.v, nameTok: n, type: ty, dims, init: null, s: n.s, e: n.e };
        if (isOp("=")) {
          p++;
          v.init = isOp("{") ? arrayInit() : expr();
        } else if (isOp("==")) {
          const t = cur();
          report(t.s, t.e, "eq-in-decl", "「==」は比べる記号", "値を入れるなら = にする", [{ s: t.s, e: t.e, text: "=" }]);
          p++;
          v.init = expr();
        } else if (isOp("(")) {
          const t = cur();
          report(n.s, t.e, "method-in-method", "メソッドの中にメソッドは作れない", "前のメソッドの } が足りないかも。メソッドはクラスの直下に書く");
          throw BAIL;
        }
        v.e = prev().e;
        out.push(v);
      } while (eat(","));
    }

    function arrayInit() {
      const s = cur().s;
      p++;
      const elems = [];
      while (!isOp("}") && !isEOF()) {
        elems.push(isOp("{") ? arrayInit() : expr());
        if (!eat(",")) break;
      }
      expect("}", "配列の { }");
      return { k: "ArrayInit", elems, s, e: prev().e };
    }

    /* ---------------- 文 ---------------- */
    function block() {
      const open = cur();
      expect("{");
      const b = { k: "Block", stmts: [], s: open.s, e: open.e };
      blockStatements(b.stmts, (t) => t.t === "op" && t.v === "}");
      if (isOp("}")) {
        b.closeS = cur().s;
        p++;
      } else if (isEOF()) {
        b.unclosed = true;
      }
      b.e = prev().e;
      return b;
    }

    function blockStatements(out, stop) {
      while (!isEOF() && !stop(cur())) {
        const start = p;
        try {
          const st = statement(out);
          if (st) out.push(st);
        } catch (e) {
          if (e !== BAIL) throw e;
          if (p === start) p++;
          syncStatement();
          out.push({ k: "Error", s: T[start].s, e: prev().e });
        }
      }
    }

    function isLocalVarDecl() {
      const t = cur();
      if (t.t === "kw" && PRIMS.has(t.v)) return !isOp(".", 1);
      if (t.t === "kw" && t.v === "final") return true;
      if (t.t === "op" && t.v === "@") return true;
      if (t.t !== "id") return false;
      if (t.v === "var" && isId(1)) return true;
      const save = p;
      const ty = typeNoErr();
      const ok = ty && isId() && !isOp("->", 1);
      p = save;
      return !!ok;
    }

    function statement(siblings) {
      const t = cur();
      const s = t.s;
      if (t.t === "op") {
        if (t.v === "{") return block();
        if (t.v === ";") {
          p++;
          return { k: "Empty", s, e: t.e };
        }
      }
      // ローカルクラス（@注釈 や final が付いていることもある）
      if ((t.t === "op" && t.v === "@") || (t.t === "kw" && (t.v === "final" || t.v === "abstract" || t.v === "static" || t.v === "strictfp"))) {
        const save = p;
        const mods = modifiers();
        if (isKw("class") || isKw("interface") || isKw("enum") || isRecordStart() || (isOp("@") && isKw("interface", 1))) {
          return { k: "LocalClass", decl: typeDecl(mods), s, e: prev().e };
        }
        p = save;
        if (t.v !== "static") return localVar();
      }
      if (t.t === "kw") {
        switch (t.v) {
          case "if": return ifStmt();
          case "while": return whileStmt();
          case "do": return doStmt();
          case "for": return forStmt();
          case "return": {
            p++;
            const r = { k: "Return", expr: null, s, e: t.e };
            if (!isOp(";") && !isOp("}") && !(cur().nl && !isValueTok(cur()) && !isOp("(") && !isOp("-") && !isOp("!"))) r.expr = expr();
            semi();
            return fin(r);
          }
          case "break":
          case "continue": {
            p++;
            const r = { k: t.v === "break" ? "Break" : "Continue", label: null, s, e: t.e };
            if (isId() && !cur().nl) r.label = T[p++].v;
            semi();
            return fin(r);
          }
          case "throw": {
            p++;
            const r = { k: "Throw", expr: expr(), s };
            semi();
            return fin(r);
          }
          case "try": return tryStmt();
          case "switch": {
            const sw = switchRest(false);
            if (isOp(".") || isOp(";")) {
              // switch 式を文として使っている（ほとんど無い）
              eat(";");
            }
            return sw;
          }
          case "synchronized": {
            if (isOp("(", 1)) {
              p++;
              expect("(");
              const lock = expr();
              expect(")");
              const body = block();
              return { k: "Sync", lock, body, s, e: body.e };
            }
            break;
          }
          case "assert": {
            p++;
            const a = { k: "Assert", cond: expr(), msg: null, s };
            if (eat(":")) a.msg = expr();
            semi();
            return fin(a);
          }
          case "else": {
            elseWithoutIf(siblings);
            p++;
            if (isKw("if")) return ifStmt();
            return statement();
          }
          case "case":
          case "default":
            if (t.v === "case" || isOp(":", 1) || isOp("->", 1)) {
              report(t.s, t.e, "case-outside-switch", `${t.v} は switch の中だけで使える`, "switch (…) { } の中に書く（} が多くないか確認）");
              throw BAIL;
            }
            break;
          case "catch":
          case "finally":
            report(t.s, t.e, "catch-without-try", `${t.v} の前に try がない`, "try { … } のすぐあとに書く");
            throw BAIL;
          case "class":
          case "interface":
          case "enum":
            return { k: "LocalClass", decl: typeDecl(modifiers()), s, e: prev().e };
          case "static":
            report(t.s, t.e, "method-in-method", "メソッドの中で static は使えない", "前のメソッドの } が足りないかも。メソッドはクラスの直下に書く");
            throw BAIL;
          case "void":
            if (isId(1) && isOp("(", 2)) {
              report(t.s, at(1).e, "method-in-method", "メソッドの中にメソッドは作れない", "前のメソッドの } が足りないかも。メソッドはクラスの直下に書く");
              throw BAIL;
            }
            break;
          case "public":
          case "private":
          case "protected": {
            const save = p;
            modifiers();
            if (isKw("class") || isKw("interface") || isKw("enum")) {
              report(t.s, t.e, "local-class-modifier", `メソッドの中のクラスに ${t.v} は付けられない`, `${t.v} を消すか、クラスをメソッドの外に出す`);
              return { k: "LocalClass", decl: typeDecl({ list: [], annos: [], s: t.s }), s, e: prev().e };
            }
            p = save;
            report(t.s, t.e, "method-in-method", `メソッドの中で ${t.v} は使えない`, "前のメソッドの } が足りないかも。変数なら public などを消す");
            throw BAIL;
          }
        }
      }
      if (t.t === "id") {
        if (t.v === "yield" && !isOp("=", 1) && !isOp("(", 1) && !isOp(".", 1) && !isOp("[", 1) && !isOp("++", 1) && !isOp("--", 1)) {
          p++;
          const y = { k: "Yield", expr: expr(), s };
          semi();
          return fin(y);
        }
        if (isRecordStart()) return { k: "LocalClass", decl: typeDecl(modifiers()), s, e: prev().e };
        if (isOp(":", 1) && !isOp("::", 1)) {
          p += 2;
          const body = statement();
          return { k: "Labeled", label: t.v, stmt: body, s, e: body.e };
        }
      }
      if (isLocalVarDecl()) return localVar();
      // 式の文
      const e = expr();
      const st = { k: "ExprStmt", expr: e, s };
      checkStatementExpr(e);
      semi();
      return fin(st);
    }

    function elseWithoutIf(siblings) {
      const t = cur();
      const last = siblings && siblings[siblings.length - 1];
      const last2 = siblings && siblings[siblings.length - 2];
      if (last && last.k === "If" && last.then.k === "Empty") {
        report(t.s, t.e, "else-without-if", "else の前に if がない", "if (…) のすぐあとの ; を消す");
      } else if (last2 && last2.k === "If" && !last2.els && last2.then.k !== "Block") {
        report(t.s, t.e, "else-without-if", "else の前に if がない", "if の中が2行以上なら { } で囲む");
      } else {
        report(t.s, t.e, "else-without-if", "else の前に if がない", "if の } と else の間に、ほかの文がないか確認");
      }
    }

    function checkStatementExpr(e) {
      if (!e) return;
      switch (e.k) {
        case "Assign":
        case "Call":
        case "New":
        case "Error":
          return;
        case "Unary":
          if (e.op === "++" || e.op === "--") return;
          break;
        case "Binary":
          if (e.op === "==") {
            report(e.s, e.e, "not-a-statement", "比べただけで何もしていない", "値を入れるなら = を1つにする", e.opS != null ? [{ s: e.opS, e: e.opS + 2, text: "=" }] : null);
            return;
          }
          break;
        case "Name":
        case "Field":
          if (/^(println|print|printf)$/.test(e.name || "")) {
            report(e.s, e.e, "not-a-statement", "メソッドを呼ぶには ( ) が要る", `${e.name}( … ) と書く`);
            return;
          }
          break;
      }
      report(e.s, e.e, "not-a-statement", "これだけでは命令にならない", "代入（=）やメソッド呼び出しにする");
    }

    function localVar() {
      const s = cur().s;
      const mods = modifiers();
      const ty = typeOrErr();
      const d = { k: "Local", mods, type: ty, vars: [], s };
      varDeclarators(d.vars, ty);
      semi();
      return fin(d);
    }

    function parenCond(what) {
      // if / while の ( 条件 )
      if (!isOp("(")) {
        const t = cur();
        const c = expr();
        report(t.s, c.e, "cond-paren", `${what} の条件は ( ) で囲む`, `${what} (条件) の形にする`, [
          { s: c.s, e: c.s, text: "(" },
          { s: c.e, e: c.e, text: ")" },
        ]);
        return c;
      }
      const open = cur();
      p++;
      if (isOp(")")) {
        const c = cur();
        report(open.s, c.e, "empty-cond", `${what} の ( ) の中に条件がない`, "x > 0 のような条件を書く");
        p++;
        return { k: "Error", s: open.s, e: c.e };
      }
      const c = expr();
      if (!isOp(")")) {
        const t = cur();
        const pr = prev();
        if (isOp("{") || t.nl) {
          report(pr.s, pr.e, "missing-paren", "「)」が足りない", "条件の最後に ) を書く", [{ s: pr.e, e: pr.e, text: ")" }]);
          return c;
        }
        expect(")");
      }
      p++;
      c.parenS = open.s;
      return c;
    }

    function emptyBodyWarn(st, what) {
      if (st.k === "Empty" && !cur().nl) return;
      if (st.k === "Empty") {
        warn(st.s, st.e, "empty-body", `${what} (…) のあとに ; がある`, `; を消す（${what} の中身が空になっている）`, [{ s: st.s, e: st.e, text: "" }]);
      }
    }

    function ifStmt() {
      const s = cur().s;
      p++;
      const cond = parenCond("if");
      const semiTok = isOp(";") ? cur() : null;
      const then = statement();
      if (semiTok) warn(semiTok.s, semiTok.e, "empty-body", "if (…) のあとに ; がある", "; を消す（条件に関係なく次の行が動く）", [{ s: semiTok.s, e: semiTok.e, text: "" }]);
      const n = { k: "If", cond, then, els: null, s };
      if (isKw("else")) {
        p++;
        n.els = statement();
      }
      return fin(n);
    }

    function whileStmt() {
      const s = cur().s;
      p++;
      const cond = parenCond("while");
      const semiTok = isOp(";") ? cur() : null;
      const body = statement();
      if (semiTok) warn(semiTok.s, semiTok.e, "empty-body", "while (…) のあとに ; がある", "; を消す（無限ループになることがある）", [{ s: semiTok.s, e: semiTok.e, text: "" }]);
      return fin({ k: "While", cond, body, s });
    }

    function doStmt() {
      const s = cur().s;
      p++;
      const body = statement();
      if (!isKw("while")) {
        const c = cur();
        report(c.s, c.e, "do-while", "do { } のあとに while (条件); が要る", "} のあとに while (条件); を書く");
        throw BAIL;
      }
      p++;
      const cond = parenCond("while");
      semi();
      return fin({ k: "DoWhile", body, cond, s });
    }

    function forStmt() {
      const s = cur().s;
      p++;
      const open = cur();
      if (!isOp("(")) expect("(", "for");
      // for (int i = 0, i < 10, i++) のまちがい
      const close = match[p];
      if (close > p) {
        let depth = 0;
        let semis = 0;
        let colon = false;
        for (let k = p + 1; k < close; k++) {
          const t = T[k];
          if (t.t === "op") {
            if (t.v === "(" || t.v === "[" || t.v === "{") depth++;
            else if (t.v === ")" || t.v === "]" || t.v === "}") depth--;
            else if (depth === 0 && t.v === ";") semis++;
            else if (depth === 0 && t.v === ":") colon = true;
          }
        }
        if (semis === 1 && !colon) {
          report(open.s, T[close].e, "for-header", "for の ( ) の中は ; で3つに区切る", "for (int i = 0; i < 10; i++) の形にする");
          skips.push({ s: open.s, e: T[close].e });
          p = close + 1;
          const body = statement();
          return fin({ k: "For", init: [], cond: null, update: [], body, s, broken: true });
        }
        if (semis === 0 && !colon) {
          report(open.s, T[close].e, "for-header", "for の ( ) の中は ; で区切る", "for (int i = 0; i < 10; i++) の形にする（, ではなく ;）");
          skips.push({ s: open.s, e: T[close].e });
          p = close + 1;
          const body = statement();
          return fin({ k: "For", init: [], cond: null, update: [], body, s, broken: true });
        }
      }
      p++;
      // 拡張 for
      const save = p;
      if (!isOp(";")) {
        const mods = modifiers();
        const ty = tryType();
        if (ty && isId() && isOp(":", 1)) {
          const n = cur();
          p += 2;
          const iter = expr();
          expect(")", "for の ( )");
          const semiTok = isOp(";") ? cur() : null;
          const body = statement();
          if (semiTok) warn(semiTok.s, semiTok.e, "empty-body", "for (…) のあとに ; がある", "; を消す（くり返す中身が空になっている）", [{ s: semiTok.s, e: semiTok.e, text: "" }]);
          return fin({ k: "ForEach", mods, type: ty, name: n.v, nameTok: n, iter, body, s });
        }
        void mods;
      }
      p = save;
      const init = [];
      if (!isOp(";")) {
        if (isLocalVarDecl()) {
          const ls = cur().s;
          const mods = modifiers();
          const ty = typeOrErr();
          const d = { k: "Local", mods, type: ty, vars: [], s: ls };
          varDeclarators(d.vars, ty);
          init.push(fin(d));
        } else {
          do init.push({ k: "ExprStmt", expr: expr(), s: cur().s }); while (eat(","));
        }
      }
      expect(";");
      let cond = null;
      if (!isOp(";")) cond = expr();
      expect(";");
      const update = [];
      if (!isOp(")")) {
        do {
          const e = expr();
          update.push({ k: "ExprStmt", expr: e, s: e.s, e: e.e });
        } while (eat(","));
      }
      expect(")", "for の ( )");
      const semiTok = isOp(";") ? cur() : null;
      const body = statement();
      if (semiTok) warn(semiTok.s, semiTok.e, "empty-body", "for (…) のあとに ; がある", "; を消す（くり返す中身が空になっている）", [{ s: semiTok.s, e: semiTok.e, text: "" }]);
      return fin({ k: "For", init, cond, update, body, s });
    }

    function tryStmt() {
      const s = cur().s;
      p++;
      const n = { k: "Try", res: [], block: null, catches: [], fin: null, s };
      if (isOp("(")) {
        p++;
        while (!isOp(")") && !isEOF()) {
          if (isLocalVarDecl()) {
            const rs = cur().s;
            const mods = modifiers();
            const ty = typeOrErr();
            const nt = ident("変数名");
            expect("=");
            const init = expr();
            n.res.push({ k: "Local", mods, type: ty, vars: [{ k: "Var", name: nt.v, nameTok: nt, type: ty, dims: 0, init, s: nt.s, e: prev().e }], s: rs, e: prev().e });
          } else {
            const e = expr();
            n.res.push({ k: "ExprStmt", expr: e, s: e.s, e: e.e });
          }
          if (!eat(";")) break;
        }
        expect(")", "try の ( )");
      }
      n.block = block();
      while (isKw("catch")) {
        const cs = cur().s;
        p++;
        expect("(", "catch");
        const mods = modifiers();
        const types = [typeOrErr("例外の型")];
        while (eat("|")) types.push(typeOrErr("例外の型"));
        let nameTok;
        if (isOp(")")) {
          const c = cur();
          report(c.s, c.e, "catch-name", "catch に変数名がない", "catch (Exception e) のように名前を書く", [{ s: c.s, e: c.s, text: " e" }]);
          nameTok = { v: "e", s: c.s, e: c.s };
        } else nameTok = ident("変数名");
        expect(")", "catch の ( )");
        const body = block();
        n.catches.push({ mods, types, name: nameTok.v, nameTok, body, s: cs, e: body.e });
      }
      if (eat("finally")) n.fin = block();
      if (!n.catches.length && !n.fin && !n.res.length) {
        report(s, s + 3, "try-alone", "try には catch か finally が要る", "try { … } のあとに catch (Exception e) { … } を書く");
      }
      return fin(n);
    }

    /** switch 文・switch 式 */
    function switchRest(isExpr) {
      const s = cur().s;
      p++;
      let sel;
      if (isOp("(")) {
        p++;
        sel = expr();
        expect(")", "switch の ( )");
      } else {
        sel = parenCond("switch");
      }
      expect("{", "switch (…) のあと");
      const sw = { k: isExpr ? "SwitchExpr" : "Switch", sel, cases: [], arrow: null, s };
      while (!isOp("}") && !isEOF()) {
        const t = cur();
        const c = { labels: [], isDefault: false, guard: null, body: [], arrow: false, s: t.s, e: t.e };
        try {
          if (isKw("default")) {
            p++;
            c.isDefault = true;
          } else if (isKw("case")) {
            p++;
            do {
              if (isKw("default")) {
                p++;
                c.isDefault = true;
              } else c.labels.push(caseLabel());
            } while (eat(","));
            if (isIdV("when")) {
              p++;
              c.guard = expr();
            }
          } else {
            report(t.s, t.e, "switch-body", "switch の中は case か default から書く", "case 値: の形にする");
            throw BAIL;
          }
          if (eat("->")) {
            c.arrow = true;
            if (isOp("{")) c.body = [block()];
            else if (isKw("throw")) c.body = [statement()];
            else {
              const e = expr();
              c.body = [{ k: "ExprStmt", expr: e, s: e.s, e: e.e, arrowExpr: true }];
              semi();
            }
          } else {
            if (!isOp(":")) {
              const pr = prev();
              report(pr.s, pr.e, "missing-colon", "case のあとに「:」がない", "case 値: のように : を書く", [{ s: pr.e, e: pr.e, text: ":" }]);
              if (!isOp(";")) throw BAIL;
            }
            p++;
            blockStatements(c.body, (tk) => (tk.t === "kw" && (tk.v === "case" || (tk.v === "default" && (T[tk.i + 1].v === ":" || T[tk.i + 1].v === "->")))) || (tk.t === "op" && tk.v === "}"));
          }
        } catch (e) {
          if (e !== BAIL) throw e;
          syncStatement();
        }
        c.e = prev().e;
        if (sw.arrow === null) sw.arrow = c.arrow;
        else if (sw.arrow !== c.arrow) report(c.s, c.s + 4, "switch-mixed", "-> と : がまざっている", "どちらか一方にそろえる");
        sw.cases.push(c);
      }
      expect("}", "switch の { }");
      return fin(sw);
    }

    function caseLabel() {
      // 型パターン: case String s ->   レコードパターン: case Point(int x, int y) ->
      const save = p;
      const pat = tryPattern();
      if (pat) return pat;
      p = save;
      return ternary();
    }
    function tryPattern() {
      const save = p;
      const mods = modifiers();
      void mods;
      const ty = tryType();
      if (!ty) {
        p = save;
        return null;
      }
      if (isId() && !(isIdV("when") && !isId(1) && !isOp("->", 1))) {
        const n = cur();
        p++;
        return { k: "Pattern", type: ty, name: n.v, nameTok: n, s: ty.s, e: n.e };
      }
      if (isOp("(") && !ty.prim) {
        p++;
        const subs = [];
        while (!isOp(")") && !isEOF()) {
          const sp = tryPattern();
          if (!sp) {
            p = save;
            return null;
          }
          subs.push(sp);
          if (!eat(",")) break;
        }
        if (!eat(")")) {
          p = save;
          return null;
        }
        let nameTok = null;
        if (isId() && !isIdV("when")) nameTok = T[p++];
        return { k: "RecordPattern", type: ty, subs, name: nameTok && nameTok.v, nameTok, s: ty.s, e: prev().e };
      }
      p = save;
      return null;
    }

    /* ---------------- 式 ---------------- */
    function isLambdaStart() {
      if (isId() && isOp("->", 1)) return true;
      return isOp("(") && match[p] > p && T[match[p] + 1] && T[match[p] + 1].v === "->" && T[match[p] + 1].t === "op";
    }

    function expr() {
      if (isLambdaStart()) return lambda();
      const lhs = ternary();
      const t = cur();
      if (t.t === "op") {
        let op = null;
        let n = 1;
        if (ASSIGN_OPS.has(t.v)) op = t.v;
        else if (t.v === ">") {
          const g = gtOp();
          if (g && ASSIGN_OPS.has(g.v)) {
            op = g.v;
            n = g.n;
          }
        }
        if (op) {
          const opTok = t;
          p += n;
          if (!isAssignable(lhs)) {
            report(lhs.s, opTok.e, "bad-assign-target", "= の左側には変数を書く", op === "=" && (lhs.k === "Binary" || lhs.k === "Literal") ? "比べるなら == にする" : "値を入れたい変数を左に書く");
          }
          const rhs = isOp("{") ? arrayInitInExpr() : expr();
          return { k: "Assign", op, target: lhs, value: rhs, s: lhs.s, e: rhs.e, opS: opTok.s };
        }
      }
      return lhs;
    }
    function arrayInitInExpr() {
      const t = cur();
      report(t.s, t.e, "array-init-assign", "{ } で配列を作れるのは宣言のときだけ", "new int[]{ … } のように new を付ける");
      return arrayInit();
    }
    function isAssignable(e) {
      return e.k === "Name" || e.k === "Field" || e.k === "Index" || e.k === "Error" || (e.k === "Paren" && isAssignable(e.expr));
    }

    function lambda() {
      const s = cur().s;
      const ps = [];
      if (isId()) {
        const n = cur();
        ps.push({ name: n.v, nameTok: n, type: null });
        p++;
      } else {
        p++;
        while (!isOp(")") && !isEOF()) {
          modifiers();
          if (isId() && (isOp(",", 1) || isOp(")", 1))) {
            const n = cur();
            ps.push({ name: n.v, nameTok: n, type: null });
            p++;
          } else {
            const ty = typeOrErr();
            if (eat("...")) ty.dims++;
            const n = ident("引数名");
            ps.push({ name: n.v, nameTok: n, type: ty });
          }
          if (!eat(",")) break;
        }
        expect(")");
      }
      expect("->");
      const body = isOp("{") ? block() : expr();
      return { k: "Lambda", params: ps, body, s, e: body.e };
    }

    function ternary() {
      const c = binary(3);
      if (isOp("?")) {
        p++;
        const a = expr();
        if (!isOp(":")) {
          const t = cur();
          report(t.s, t.e, "ternary-colon", "? のあとに「:」がない", "条件 ? 値1 : 値2 の形にする");
          throw BAIL;
        }
        p++;
        const b = isLambdaStart() ? lambda() : ternary();
        return { k: "Cond", cond: c, a, b, s: c.s, e: b.e };
      }
      return c;
    }

    function binOpHere() {
      const t = cur();
      if (t.t === "kw" && t.v === "instanceof") return { v: "instanceof", n: 1 };
      if (t.t !== "op") return null;
      if (t.v === ">") {
        const g = gtOp();
        if (!g || ASSIGN_OPS.has(g.v)) return null;
        return g;
      }
      if (BIN_PREC[t.v]) return { v: t.v, n: 1 };
      return null;
    }

    function binary(minPrec) {
      let left = unary();
      for (;;) {
        const op = binOpHere();
        if (!op) break;
        const prec = BIN_PREC[op.v];
        if (prec < minPrec) break;
        const opTok = cur();
        p += op.n;
        if (op.v === "instanceof") {
          const isFinal = !!eat("final");
          void isFinal;
          const save = p;
          const pat = tryPattern();
          let right;
          if (pat) right = pat;
          else {
            p = save;
            right = typeOrErr("型");
          }
          left = { k: "InstanceOf", expr: left, target: right, s: left.s, e: prev().e };
          continue;
        }
        // = のつもりで =< や => と書いた
        if (isOp("=") && cur().s === prev().e && (op.v === "<" || op.v === ">")) {
          const t = cur();
          report(opTok.s, t.e, "bad-operator", `「${op.v}=」の順に書く`, `${op.v}= にする（=${op.v} ではない）`);
        }
        if (isEOF() || isOp(")") || isOp(";") || isOp(",") || isOp("}") || isOp("]")) {
          const t = cur();
          report(opTok.s, opTok.e + op.n - 1, "missing-operand", `「${op.v}」のあとに値がない`, "値か変数を書く");
          throw BAIL;
        }
        const right = binary(prec + 1);
        left = { k: "Binary", op: op.v, l: left, r: right, s: left.s, e: right.e, opS: opTok.s };
      }
      return left;
    }

    function unary() {
      const t = cur();
      if (t.t === "op") {
        if (t.v === "+" || t.v === "-" || t.v === "!" || t.v === "~" || t.v === "++" || t.v === "--") {
          p++;
          const e = unary();
          return { k: "Unary", op: t.v, prefix: true, expr: e, s: t.s, e: e.e };
        }
        if (t.v === "(") {
          const c = tryCast();
          if (c) return c;
        }
      }
      return postfix(primary());
    }

    function tryCast() {
      const save = p;
      p++;
      const ty = tryType();
      if (!ty || !isOp(")")) {
        p = save;
        return null;
      }
      p++;
      const nx = cur();
      let ok;
      if (ty.prim) {
        ok = !(nx.t === "op" && (nx.v === ")" || nx.v === ";" || nx.v === "," || nx.v === "." || nx.v === "]" || nx.v === "}" || nx.v === "?" || nx.v === ":" || BIN_PREC[nx.v] && nx.v !== "+" && nx.v !== "-") || nx.t === "eof");
        if (ty.name === "void") ok = false;
      } else {
        ok =
          nx.t === "id" || nx.t === "num" || nx.t === "str" || nx.t === "chr" ||
          (nx.t === "kw" && ["this", "super", "new", "true", "false", "null", "switch", ...PRIMS].includes(nx.v)) ||
          (nx.t === "op" && (nx.v === "(" || nx.v === "!" || nx.v === "~"));
        // (a) -> ラムダは除く
      }
      if (!ok) {
        p = save;
        return null;
      }
      const e = isLambdaStart() ? lambda() : unary();
      return { k: "Cast", type: ty, expr: e, s: T[save].s, e: e.e };
    }

    function args() {
      const open = cur();
      p++;
      const list = [];
      if (eat(")")) return list;
      for (;;) {
        if (isOp(",")) {
          const t = cur();
          report(t.s, t.e, "missing-expression", "「,」の前に値がない", "値を書くか、余分な , を消す");
          p++;
          continue;
        }
        list.push(expr());
        if (eat(",")) {
          if (isOp(")")) {
            const t = prev();
            report(t.s, t.e, "trailing-comma", "「,」のあとに値がない", "余分な , を消す", [{ s: t.s, e: t.e, text: "" }]);
            p++;
            return list;
          }
          continue;
        }
        if (eat(")")) return list;
        const t = cur();
        const pr = prev();
        if (t.t === "op" && (t.v === ";" || t.v === "{" || t.v === "}") || t.t === "eof" || (t.nl && !isValueTok(t))) {
          report(pr.s, pr.e, "missing-paren", "「)」が足りない", "( に対応する ) を書く", [{ s: pr.e, e: pr.e, text: ")" }]);
          list.closeMissing = true;
          return list;
        }
        unexpected(t);
        void open;
        throw BAIL;
      }
    }

    function primary() {
      const t = cur();
      const s = t.s;
      switch (t.t) {
        case "num":
          p++;
          return { k: "Literal", type: t.numType, raw: t.v, s, e: t.e };
        case "str":
          p++;
          if (t.open) quietUntil = Math.max(quietUntil, at(0).e);
          return { k: "Literal", type: "String", raw: t.v, s, e: t.e, text: !!t.text, bad: !!t.open };
        case "chr":
          p++;
          return { k: "Literal", type: "char", raw: t.v, s, e: t.e, bad: !!t.err };
        case "id": {
          // ジェネリクス付きの型 + ::   ImmutableMap.Builder<K, V>::new
          if (isOp(".", 1) || isOp("<", 1)) {
            const save = p;
            const ty = tryType();
            if (ty && ty.args && isOp("::")) return { k: "TypeRef", type: ty, s, e: ty.e };
            p = save;
          }
          p++;
          if (isOp("(")) {
            const a = args();
            return { k: "Call", target: null, name: t.v, nameTok: t, args: a, s, e: prev().e };
          }
          // 型名に続く [] .class   String[].class
          if (isOp("[") && isOp("]", 1)) {
            p--;
            const ty = typeOrErr();
            if (isOp(".") && isKw("class", 1)) {
              p += 2;
              return { k: "ClassLit", type: ty, s, e: prev().e };
            }
            if (isOp("::")) return { k: "TypeRef", type: ty, s, e: ty.e };
            report(ty.s, ty.e, "unexpected", "ここに型は書けない", "書き方を見直す");
            throw BAIL;
          }
          return { k: "Name", name: t.v, tok: t, s, e: t.e };
        }
        case "kw":
          switch (t.v) {
            case "true":
            case "false":
              p++;
              return { k: "Literal", type: "boolean", raw: t.v, s, e: t.e };
            case "null":
              p++;
              return { k: "Literal", type: "null", raw: t.v, s, e: t.e };
            case "this":
              p++;
              if (isOp("(")) return { k: "Call", target: null, name: "this", ctorCall: true, nameTok: t, args: args(), s, e: prev().e };
              return { k: "This", s, e: t.e };
            case "super":
              p++;
              if (isOp("(")) return { k: "Call", target: null, name: "super", ctorCall: true, nameTok: t, args: args(), s, e: prev().e };
              if (isOp("::")) return { k: "Super", s, e: t.e };
              if (!isOp(".")) {
                report(t.s, t.e, "unexpected", "super のあとには . か ( が要る", "super.メソッド() の形にする");
                throw BAIL;
              }
              return { k: "Super", s, e: t.e };
            case "new":
              return newExpr(null);
            case "switch":
              return switchRest(true);
            default:
              if (PRIMS.has(t.v) || t.v === "void") {
                const ty = typeOrErr();
                if (isOp(".") && isKw("class", 1)) {
                  p += 2;
                  return { k: "ClassLit", type: ty, s, e: prev().e };
                }
                if (isOp("::")) return { k: "TypeRef", type: ty, s, e: ty.e };
                if (isId()) {
                  report(t.s, cur().e, "decl-here", "ここで変数は宣言できない", "宣言は文の先頭で int x = …; のように書く");
                } else if (isOp("(")) {
                  report(t.s, t.e, "bad-cast", `${t.v} に変えるなら (${t.v}) と書く`, `(${t.v}) x のように ( ) で囲む`);
                } else report(t.s, t.e, "unexpected", `ここに型「${t.v}」は書けない`, "書き方を見直す");
                throw BAIL;
              }
          }
          break;
        case "op":
          if (t.v === "(") {
            p++;
            if (isOp(")")) {
              const c = cur();
              report(t.s, c.e, "missing-expression", "( ) の中が空っぽ", "( ) の中に値を書く");
              p++;
              return { k: "Error", s, e: c.e };
            }
            const inner = expr();
            if (!isOp(")")) {
              const c = cur();
              const pr = prev();
              if (isOp(";") || isOp("{") || isOp("}") || c.nl || c.t === "eof") {
                report(pr.s, pr.e, "missing-paren", "「)」が足りない", "( に対応する ) を書く", [{ s: pr.e, e: pr.e, text: ")" }]);
                return { k: "Paren", expr: inner, s, e: pr.e };
              }
              unexpected(c);
              throw BAIL;
            }
            p++;
            return { k: "Paren", expr: inner, s, e: prev().e };
          }
          if (t.v === "{") {
            report(t.s, t.e, "array-init-assign", "{ } で配列を作れるのは宣言のときだけ", "new int[]{ … } のように new を付ける");
            return arrayInit();
          }
          if (t.v === "@") {
            skipAnnotations();
            return primary();
          }
          break;
      }
      // 値が来るはずの場所に、ちがうものがある
      const pr = prev();
      if (pr.t === "op" && (BIN_PREC[pr.v] || ASSIGN_OPS.has(pr.v)) && (t.t === "op" || t.t === "eof")) {
        report(pr.s, pr.e, "missing-operand", `「${pr.v}」のあとに値がない`, "値か変数を書く");
      } else if (t.t === "op" && (t.v === ";" || t.v === ")" || t.v === ",")) {
        report(t.s, t.e, "missing-expression", "値（式）がない", "ここに値や変数を書く");
      } else if (t.t === "eof") {
        report(pr.s, pr.e, "unexpected-eof", "途中でファイルが終わっている", "書きかけの文を最後まで書く");
      } else if (t.t === "op" && t.v === "=" && pr.t === "op" && (pr.v === "!" )) {
        report(pr.s, t.e, "bad-operator", "「!=」はくっつけて書く", "! と = の間のスペースを消す");
      } else if (t.t === "op" && t.v === ">" && pr.t === "op" && pr.v === "=") {
        report(pr.s, t.e, "bad-operator", "「=>」という記号はない", "以上なら >=、ラムダなら -> にする");
      } else {
        unexpected(t);
      }
      throw BAIL;
    }

    function newExpr(outer) {
      const s = cur().s;
      p++;
      skipAnnotations();
      if (isOp("<")) typeArgs();
      const t = cur();
      let ty;
      if (t.t === "kw" && PRIMS.has(t.v)) {
        p++;
        ty = { k: "Type", name: t.v, prim: true, args: null, dims: 0, s: t.s, e: t.e };
      } else if (t.t === "id") {
        p++;
        let name = t.v;
        let targs = null;
        if (isOp("<")) {
          targs = typeArgs();
          if (!targs) {
            report(t.s, t.e, "bad-generics", "< > の書き方がおかしい", "new ArrayList<>() のように書く");
            throw BAIL;
          }
        }
        while (isOp(".") && isId(1)) {
          p++;
          name += "." + cur().v;
          p++;
          if (isOp("<")) targs = typeArgs();
        }
        ty = { k: "Type", name, prim: false, args: targs, dims: 0, s: t.s, e: prev().e };
      } else {
        report(t.s, t.e, "new-type", "new のあとにはクラス名を書く", "new Scanner(System.in) のように書く");
        throw BAIL;
      }
      if (isOp("[")) {
        // 配列
        const dims = [];
        let total = 0;
        while (isOp("[")) {
          p++;
          if (isOp("]")) {
            p++;
            dims.push(null);
          } else {
            dims.push(expr());
            expect("]", "配列の大きさ");
          }
          total++;
        }
        let init = null;
        if (isOp("{")) {
          if (dims.some((d) => d)) {
            const c = cur();
            report(c.s, c.e, "array-size-and-init", "大きさと { } は両方書けない", "new int[]{1, 2} か new int[2] のどちらかにする");
          }
          init = arrayInit();
        } else if (dims[0] === null) {
          const c = cur();
          report(ty.s, prev().e, "array-size", "配列の大きさがない", "new int[5] のように [ ] に大きさを書く");
          void c;
        }
        const aty = Object.assign({}, ty, { dims: total });
        return { k: "NewArray", type: aty, dims, init, s, e: prev().e };
      }
      if (!isOp("(")) {
        const pr = prev();
        report(pr.s, pr.e, "new-paren", "new クラス名 のあとに ( ) が要る", `${ty.name}() のように ( ) を付ける`, [{ s: pr.e, e: pr.e, text: "()" }]);
        return { k: "New", type: ty, args: [], body: null, outer, s, e: pr.e, noParen: true };
      }
      const a = args();
      let body = null;
      if (isOp("{")) {
        const anon = { k: "Class", kind: "class", name: "", anon: true, members: [], consts: [], mods: { list: [], annos: [] }, s: cur().s, impls: [], ext: ty };
        p++;
        classStack.push(anon);
        try {
          classBody(anon);
        } finally {
          classStack.pop();
        }
        expect("}");
        anon.e = prev().e;
        body = anon;
      }
      return { k: "New", type: ty, args: a, body, outer, s, e: prev().e };
    }

    function postfix(e) {
      for (;;) {
        const t = cur();
        if (t.t !== "op") break;
        if (t.v === ".") {
          p++;
          const n = cur();
          if (n.t === "id") {
            p++;
            if (isOp("(")) {
              const a = args();
              e = { k: "Call", target: e, name: n.v, nameTok: n, args: a, s: e.s, e: prev().e };
            } else {
              e = { k: "Field", target: e, name: n.v, nameTok: n, s: e.s, e: n.e };
            }
            continue;
          }
          if (n.t === "kw") {
            if (n.v === "new") {
              e = newExpr(e);
              continue;
            }
            if (n.v === "class") {
              p++;
              e = { k: "ClassLit", type: { k: "Type", name: exprToName(e), prim: false, dims: 0, s: e.s, e: e.e }, s: e.s, e: n.e };
              continue;
            }
            if (n.v === "this" || n.v === "super") {
              p++;
              e = { k: n.v === "this" ? "This" : "Super", qualifier: e, s: e.s, e: n.e };
              if (n.v === "super" && isOp("(")) e = { k: "Call", target: null, name: "super", ctorCall: true, nameTok: n, args: args(), s: e.s, e: prev().e };
              continue;
            }
          }
          if (n.t === "op" && n.v === "<") {
            typeArgs();
            const m = ident("メソッド名");
            const a = isOp("(") ? args() : [];
            e = { k: "Call", target: e, name: m.v, nameTok: m, args: a, s: e.s, e: prev().e };
            continue;
          }
          if (n.t === "num" && /^\.\d/.test(n.v)) break;
          const pr = prev();
          if (n.nl || n.t === "op" || n.t === "eof") {
            report(pr.s, pr.e, "dot-end", "「.」のあとに名前がない", ". のあとにメソッド名などを書く");
          } else {
            report(n.s, n.e, "dot-end", `「.」のあとに ${tokText(n)} は書けない`, ". のあとにはメソッド名などを書く");
          }
          throw BAIL;
        }
        if (t.v === "[") {
          p++;
          if (isOp("]")) {
            const c = cur();
            report(t.s, c.e, "empty-index", "[ ] の中に番号がない", "a[0] のように番号を書く");
            p++;
            e = { k: "Index", arr: e, index: { k: "Error", s: c.s, e: c.s }, s: e.s, e: c.e };
            continue;
          }
          const idx = expr();
          expect("]", "配列の番号");
          e = { k: "Index", arr: e, index: idx, s: e.s, e: prev().e };
          continue;
        }
        if (t.v === "++" || t.v === "--") {
          if (t.nl) break;
          p++;
          e = { k: "Unary", op: t.v, prefix: false, expr: e, s: e.s, e: t.e };
          continue;
        }
        if (t.v === "::") {
          p++;
          if (isOp("<")) typeArgs();
          const n = cur();
          if (n.t === "id" || (n.t === "kw" && n.v === "new")) {
            p++;
            e = { k: "MethodRef", target: e, name: n.v, s: e.s, e: n.e };
            continue;
          }
          report(n.s, n.e, "unexpected", ":: のあとにはメソッド名を書く", "String::valueOf のように書く");
          throw BAIL;
        }
        break;
      }
      return e;
    }

    function exprToName(e) {
      if (e.k === "Name") return e.name;
      if (e.k === "Field") return exprToName(e.target) + "." + e.name;
      return "?";
    }

    const unit = compilationUnit();
    return { unit, errors, skips, tokens: T, match };
  }

  const api = { parse, PRIMS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.JavaParser = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
