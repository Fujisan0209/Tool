/*
 * Java その場チェック：コードを調べて、まちがい（diag）の一覧を返します。
 *
 *   check(src, { fileName }) → { diags, tokens, comments, ms }
 *   diag = { s, e, line, col, sev: "error" | "warn", id, msg, fix, edits: [{ s, e, text }] | null }
 *
 * 方針: 「確実にコンパイルエラーになるもの」だけを error にします。
 *       実行時エラーやバグになりやすいものは warn（注意）。自信がないときは何も言いません。
 */
(function (root) {
  "use strict";

  const isNode = typeof module !== "undefined" && module.exports;
  const L = isNode ? require("./lexer.js") : root.JavaLexer;
  const P = isNode ? require("./parser.js") : root.JavaParser;
  const Ty = isNode ? require("./types.js") : root.JavaTypes;
  const { T, str } = Ty;

  const MAX_DIAGS = 200;

  /* ------------------------------------------------------------------ */
  /* 小さな道具                                                          */
  /* ------------------------------------------------------------------ */

  function lineIndex(src) {
    const starts = [0];
    for (let i = 0; i < src.length; i++) if (src.charCodeAt(i) === 10) starts.push(i + 1);
    return {
      starts,
      lineOf(pos) {
        let lo = 0;
        let hi = starts.length - 1;
        while (lo < hi) {
          const mid = (lo + hi + 1) >> 1;
          if (starts[mid] <= pos) lo = mid;
          else hi = mid - 1;
        }
        return lo;
      },
    };
  }

  /** 文字の入れかえも1回と数える編集距離 */
  function editDistance(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    const d = [];
    for (let i = 0; i <= a.length; i++) d.push([i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      let rowMin = Infinity;
      for (let j = 1; j <= b.length; j++) {
        const c = a[i - 1] === b[j - 1] ? 0 : 1;
        let v = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2][j - 2] + 1);
        d[i][j] = v;
        rowMin = Math.min(rowMin, v);
      }
      if (rowMin > max) return max + 1;
    }
    return d[a.length][b.length];
  }

  /** いちばん近い名前（大文字小文字ちがい → 1〜2文字ちがい） */
  function suggest(name, candidates) {
    const lower = name.toLowerCase();
    let best = null;
    let bestD = Infinity;
    for (const c of candidates) {
      if (!c || c === name) continue;
      if (c.toLowerCase() === lower) return { name: c, caseOnly: true };
      if (name.length <= 1 || c.length <= 1) continue;
      const max = name.length <= 3 ? 1 : 2;
      const dist = editDistance(lower, c.toLowerCase(), max);
      if (dist <= max && dist < bestD) {
        bestD = dist;
        best = c;
      }
    }
    return best ? { name: best, caseOnly: false } : null;
  }

  const KW_CLASSES = new Set(["Boolean", "Byte", "Short", "Long", "Float", "Double", "Void", "Class", "Enum", "Record", "Character"]);
  const INTERFACE_IMPL = {
    List: "ArrayList", Map: "HashMap", Set: "HashSet", Queue: "ArrayDeque", Deque: "ArrayDeque", Collection: "ArrayList",
  };
  // よく使うインタフェースの、作らないといけないメソッド
  const ABSTRACT_OF = {
    Runnable: ["run"], Comparable: ["compareTo"], Comparator: ["compare"], Iterable: ["iterator"],
    ActionListener: ["actionPerformed"], AutoCloseable: ["close"], Closeable: ["close"],
    KeyListener: ["keyPressed", "keyReleased", "keyTyped"],
    MouseListener: ["mouseClicked", "mousePressed", "mouseReleased", "mouseEntered", "mouseExited"],
  };
  // パッケージのあるファイルでも、import 忘れをエラーにする定番のクラス
  const COMMON_JDK = new Set(["Scanner", "ArrayList", "List", "HashMap", "Map", "Random", "Arrays", "HashSet", "Set", "LinkedList", "Collections", "Iterator", "BufferedReader", "InputStreamReader", "IOException", "FileReader", "FileWriter", "PrintWriter", "LocalDate", "Stack", "ArrayDeque", "TreeMap", "Queue", "Deque"]);
  const LIST_LIKE = new Set(["List", "ArrayList", "LinkedList", "Collection", "Set", "HashSet", "TreeSet", "LinkedHashSet", "Vector", "Stack", "Queue", "Deque", "ArrayDeque", "PriorityQueue"]);
  const ITERABLE_ELEM = new Set([...LIST_LIKE, "Iterable", "SequencedCollection", "SequencedSet", "SortedSet", "NavigableSet", "AbstractList", "AbstractCollection", "AbstractSet"]);
  const IMMUTABLE_STR = new Set(["toUpperCase", "toLowerCase", "trim", "strip", "replace", "replaceAll", "concat", "substring", "repeat", "stripLeading", "stripTrailing"]);
  const SCANNER_TOKEN = new Set(["nextInt", "nextDouble", "nextLong", "next", "nextBoolean", "nextFloat", "nextShort", "nextByte"]);

  /* ------------------------------------------------------------------ */
  /* メイン                                                              */
  /* ------------------------------------------------------------------ */

  function check(src, opts) {
    const t0 = Date.now();
    opts = opts || {};
    const fileName = opts.fileName || "Main.java";
    const lines = lineIndex(src);
    const lexed = L.lex(src);
    const diags = [];
    const seen = new Set();
    const add = (d) => {
      const key = d.s + ":" + d.id;
      if (seen.has(key)) return;
      seen.add(key);
      diags.push(d);
    };

    for (const p of lexed.problems) add(p);
    keywordCase(lexed, add);

    const brace = braceCheck(lexed.tokens, src, lines);
    let parsed = null;
    try {
      parsed = P.parse(src, lexed);
    } catch (e) {
      if (opts.debug) throw e;
    }

    if (brace) {
      add(brace.diag);
      if (parsed) {
        const CASCADE = new Set(["missing-brace", "extra-brace", "unexpected-eof", "outside-class", "statement-outside-method", "method-in-method", "missing-paren", "case-outside-switch", "else-without-if", "catch-without-try"]);
        for (const e of parsed.errors) if (e.s < brace.pos && !CASCADE.has(e.id)) add(e);
      }
    } else if (parsed) {
      for (const e of parsed.errors) add(e);
      try {
        semantic(src, parsed, add, { fileName, lines, debug: opts.debug });
      } catch (e) {
        if (opts.debug) throw e;
      }
    }

    // 位置でならべ、1つの位置に複数あるときはエラーを先に
    diags.sort((a, b) => a.s - b.s || (a.sev === b.sev ? 0 : a.sev === "error" ? -1 : 1));
    const out = diags.slice(0, MAX_DIAGS);
    for (const d of out) {
      d.line = lines.lineOf(d.s) + 1;
      d.col = d.s - lines.starts[d.line - 1] + 1;
      if (d.e < d.s) d.e = d.s;
      if (!d.edits) d.edits = null;
    }
    return { diags: out, tokens: lexed.tokens, comments: lexed.comments, ms: Date.now() - t0 };
  }

  /** Public や Int のように、予約語を大文字で書いたもの */
  function keywordCase(lexed, add) {
    const declared = new Set();
    const toks = lexed.tokens;
    for (let i = 1; i < toks.length; i++) {
      if (toks[i - 1].t === "kw" && (toks[i - 1].v === "class" || toks[i - 1].v === "interface" || toks[i - 1].v === "enum")) declared.add(toks[i].v);
    }
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (t.t !== "id") continue;
      const lower = t.v.toLowerCase();
      if (lower === t.v || !L.KEYWORDS.has(lower) || KW_CLASSES.has(t.v) || declared.has(t.v) || lower === "_") continue;
      // Public / Int のように先頭だけ大文字のものだけ（TRUE や instanceOf は定数・メソッド名）
      if (t.v !== lower[0].toUpperCase() + lower.slice(1)) continue;
      if (Ty.JAVA_LANG.has(t.v)) continue;
      const prev = toks[i - 1];
      const next = toks[i + 1];
      if (prev && prev.t === "op" && (prev.v === "." || prev.v === "::")) continue;
      if (next && next.t === "op" && (next.v === "." || next.v === "::")) continue;
      add({
        s: t.s, e: t.e, sev: "error", id: "keyword-case",
        msg: `「${t.v}」は小文字で書く`, fix: `「${lower}」にする（Java は大文字・小文字を区別する）`,
        edits: [{ s: t.s, e: t.e, text: lower }],
      });
      t.t = "kw";
      t.v = lower;
    }
  }

  /** { } の数を調べ、足りない・多い場所を字下げから推測する */
  function braceCheck(tokens, src, lines) {
    const st = [];
    const pairs = [];
    let extra = null;
    for (const t of tokens) {
      if (t.t !== "op") continue;
      if (t.v === "{") st.push(t);
      else if (t.v === "}") {
        if (!st.length) {
          if (!extra) extra = t;
          continue;
        }
        pairs.push([st.pop(), t]);
      }
    }
    if (!extra && !st.length) return null;

    const indentAt = (pos) => {
      const ln = lines.lineOf(pos);
      let w = 0;
      for (let i = lines.starts[ln]; i < src.length; i++) {
        const c = src[i];
        if (c === " ") w++;
        else if (c === "\t") w += 4 - (w % 4);
        else break;
      }
      return w;
    };
    const firstOnLine = (t) => /^[ \t]*$/.test(src.slice(lines.starts[lines.lineOf(t.s)], t.s));
    const checkable = pairs.filter(([o, c]) => firstOnLine(c) && lines.lineOf(o.s) !== lines.lineOf(c.s));
    const isBad = ([o, c]) => indentAt(o.s) !== indentAt(c.s);

    if (st.length) {
      // } が足りない
      const sorted = checkable.slice().sort((a, b) => a[1].s - b[1].s);
      const cand = sorted.find(isBad);
      let target = st[st.length - 1];
      if (cand) {
        const before = sorted.filter((pr) => pr[1].s < cand[0].s);
        const okStyle = before.filter((pr) => !isBad(pr)).length >= before.length * 0.8;
        if (okStyle) target = cand[0];
      }
      const edits = [];
      if (target === st[st.length - 1]) {
        let text = "";
        for (let i = st.length - 1; i >= 0; i--) text += "\n" + " ".repeat(indentAt(st[i].s)) + "}";
        const end = src.replace(/\s+$/, "").length;
        edits.push({ s: end, e: end, text });
      }
      return {
        pos: target.s,
        diag: {
          s: target.s, e: target.e, sev: "error", id: "missing-brace",
          msg: st.length > 1 && target === st[st.length - 1] ? `「}」が ${st.length} 個足りない` : "この「{」を閉じる「}」がない",
          fix: target === st[st.length - 1] ? "ブロックの終わりに } を書く" : "このブロックの終わりに } を書く（字下げをそろえると見つけやすい）",
          edits: edits.length ? edits : null,
        },
      };
    }
    // } が多い
    const sorted = checkable.filter((pr) => pr[1].s < extra.s).sort((a, b) => a[1].s - b[1].s);
    const cand = sorted.find(isBad);
    let target = extra;
    if (cand) {
      const before = sorted.filter((pr) => pr[1].s < cand[1].s);
      if (before.filter((pr) => !isBad(pr)).length >= before.length * 0.8) target = cand[1];
    }
    return {
      pos: target.s,
      diag: {
        s: target.s, e: target.e, sev: "error", id: "extra-brace",
        msg: "「}」が多い", fix: target === extra ? "対応する { がない。余分な } を消す" : "この } が多いかも（字下げと合っていない）",
        edits: target === extra ? [{ s: target.s, e: target.e, text: "" }] : null,
      },
    };
  }

  /* ------------------------------------------------------------------ */
  /* 意味のチェック                                                      */
  /* ------------------------------------------------------------------ */

  function semantic(src, parsed, add, opts) {
    const unit = parsed.unit;
    const skips = parsed.skips || [];
    const hasErrIn = (s, e) => skips.some((r) => r.s >= s && r.s <= e);

    const err = (s, e, id, msg, fix, edits) => add({ s, e, sev: "error", id, msg, fix, edits: edits || null });
    const warn = (s, e, id, msg, fix, edits) => add({ s, e, sev: "warn", id, msg, fix, edits: edits || null });
    const text = (n) => src.slice(n.s, n.e);

    /* ---------- import ---------- */
    const single = new Map(); // 単純名 → パッケージ
    const stars = [];
    const staticImps = [];
    let unknownStar = false;
    let unknownStaticStar = false;
    for (const im of unit.imports) {
      if (im.static) {
        const parts = im.name.split(".");
        if (im.star) {
          staticImps.push({ cls: parts[parts.length - 1], member: null });
          if (!Ty.DATA.CLASSES[parts[parts.length - 1]]) unknownStaticStar = true;
        } else staticImps.push({ cls: parts[parts.length - 2], member: parts[parts.length - 1] });
        continue;
      }
      if (im.star) {
        stars.push(im.name);
        if (!Ty.PKG_CLASSES[im.name]) {
          unknownStar = true;
          if (/^javax?\./.test(im.name) && !Ty.DATA.ALL_PKGS.has(im.name) && !Ty.DATA.CLASSES[im.name.slice(im.name.lastIndexOf(".") + 1)]) checkImportPackage(im, im.name, null);
        }
        continue;
      }
      const dot = im.name.lastIndexOf(".");
      const pkg = im.name.slice(0, dot);
      const cls = im.name.slice(dot + 1);
      single.set(cls, pkg);
      const known = Ty.PKG_CLASSES[pkg];
      if (known && !known.has(cls)) {
        // java.util.Scaner など
        const sg = suggest(cls, known);
        const where = Ty.CLASS_PKGS[cls];
        if (where) {
          err(im.s, im.e, "bad-import", `${pkg} に ${cls} はない`, `import ${where[0]}.${cls}; にする`, [{ s: im.s, e: im.e, text: `import ${where[0]}.${cls}` }]);
        } else if (sg) {
          err(im.s, im.e, "bad-import", `${pkg} に ${cls} はない`, `もしかして ${sg.name}？`, [{ s: im.s, e: im.e, text: `import ${pkg}.${sg.name}` }]);
        } else {
          err(im.s, im.e, "bad-import", `${pkg} に ${cls} はない`, "クラス名のつづりを確認");
        }
      } else if (!known && /^javax?\./.test(pkg) && !Ty.DATA.ALL_PKGS.has(pkg) && !/^[A-Z]/.test(pkg.slice(pkg.lastIndexOf(".") + 1))) {
        checkImportPackage(im, pkg, cls);
      }
    }
    function checkImportPackage(im, pkg, cls) {
      const lower = pkg.toLowerCase();
      const realPkg = [...Ty.DATA.ALL_PKGS].find((p) => p.toLowerCase() === lower);
      if (realPkg) {
        err(im.s, im.e, "bad-import", `パッケージ名は ${realPkg}`, "大文字・小文字を確認", [{ s: im.s, e: im.e, text: `import ${realPkg}.${cls || "*"}` }]);
        return;
      }
      const sg = suggest(pkg, [...Ty.DATA.ALL_PKGS]);
      if (sg && !sg.name.startsWith(pkg + ".") && !pkg.startsWith(sg.name + ".")) err(im.s, im.e, "bad-import", `パッケージ ${pkg} はない`, `もしかして ${sg.name}？`, [{ s: im.s, e: im.e, text: `import ${sg.name}.${cls || "*"}` }]);
    }
    // import を足す場所
    const importInsert = (() => {
      if (unit.imports.length) {
        const last = unit.imports[unit.imports.length - 1];
        const nl = src.indexOf("\n", last.e);
        return { pos: nl < 0 ? src.length : nl + 1, pre: nl < 0 ? "\n" : "", post: "" };
      }
      if (unit.pkg) {
        const nl = src.indexOf("\n", unit.pkg.e);
        return { pos: nl < 0 ? src.length : nl + 1, pre: nl < 0 ? "\n\n" : "\n", post: "" };
      }
      // 先頭のコメントのあと
      let pos = 0;
      const m = src.match(/^(?:\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*\n))*/);
      if (m) pos = m[0].length;
      return { pos, pre: "", post: "\n" };
    })();
    const importEdit = (fq) => [{ s: importInsert.pos, e: importInsert.pos, text: `${importInsert.pre}import ${fq};\n${importInsert.post}` }];

    const packaged = !!unit.pkg;
    const neverReturns = new Set();

    /* ---------- クラスを集める ---------- */
    const user = new Map();
    const allRecs = [];
    const anonRecs = new Map();
    const ambiguous = new Set(); // 同じ名前の入れ子クラスが2つ以上
    function makeRec(node, outer, opt) {
      const r = {
        name: node.anon ? `$anon${anonRecs.size + 1}` : node.name, node, user: true, outer, local: !!opt.local, anon: !!node.anon,
        kind: node.kind === "class" && node.mods && node.mods.list.includes("abstract") ? "abstract" : node.kind,
        isStaticNested: !!(outer && !opt.local && (node.mods.list.includes("static") || node.kind !== "class" || (outer.kind === "interface"))),
        declaredInStatic: !!opt.inStatic,
        sup: null, ifs: [], tp: (node.tparams || []).map((x) => x.name), fields: new Map(), methods: new Map(), ctors: [],
        complete: true, abstractMethods: [],
      };
      r.hasOuterInstance = !!outer && !r.isStaticNested && !(r.local && opt.inStatic);
      if (node.anon) anonRecs.set(r.name, r);
      allRecs.push(r);
      return r;
    }
    function collect(node, outer, opt) {
      const r = makeRec(node, outer, opt);
      if (!node.anon && !opt.local) {
        if (user.has(node.name) && !outer) {
          err(node.nameTok.s, node.nameTok.e, "dup-class", `クラス「${node.name}」が2つある`, "どちらかの名前を変える");
        }
        if (!user.has(node.name)) user.set(node.name, r);
        else if (outer || user.get(node.name).outer) ambiguous.add(node.name);
      }
      node.rec = r;
      for (const m of node.members) {
        if (m.k === "Class") collect(m, r, { inStatic: false });
      }
      for (const c of node.consts || []) {
        if (!c.body) continue;
        c.body.enumOwner = r;
        collect(c.body, r, { local: true, inStatic: true });
      }
      return r;
    }
    for (const c of unit.types) collect(c, null, {});

    const localTypes = new Map(); // ローカルクラス（名前の解決用、出てきた順に登録）

    /** 単純名 → クラス情報（自分のクラス or JDK） */
    function recOf(name) {
      if (!name) return null;
      if (ambiguous.has(name)) return null;
      const u = anonRecs.get(name) || localTypes.get(name) || user.get(name);
      if (u) return u;
      if (name.includes(".")) {
        const last = name.slice(name.lastIndexOf(".") + 1);
        const uu = user.get(last);
        if (uu) return uu;
        return Ty.jdkClass(name);
      }
      const imp = single.get(name);
      const j = Ty.jdkClass(name);
      if (j && imp && imp !== j.pkg) return null;
      return j;
    }
    const db = Ty.makeDB(user, recOf);

    /* ---------- 型の名前 ---------- */
    const unknownTypeReported = new Set();
    function classKnown(name) {
      if (localTypes.has(name) || user.has(name)) return true;
      if (single.has(name)) return true;
      if (Ty.JAVA_LANG.has(name)) return true;
      for (const p of stars) if (Ty.PKG_CLASSES[p] && Ty.PKG_CLASSES[p].has(name)) return true;
      return false;
    }
    /** 型の名前を調べる。わからないときは報告して、名前はそのまま返す */
    function resolveTypeName(name, node, tvars, report) {
      if (tvars && tvars.has(name)) return null;
      if (name.includes(".")) {
        const first = name.split(".")[0];
        if (/^[a-z]/.test(first)) {
          const dot = name.lastIndexOf(".");
          const pkg = name.slice(0, dot);
          const last = name.slice(dot + 1);
          if (user.has(last) || ambiguous.has(last) || localTypes.has(last)) return null;
          if (Ty.PKG_CLASSES[pkg] && Ty.PKG_CLASSES[pkg].has(last)) return last;
          // java.util.Map.Entry のような入れ子
          const d2 = pkg.lastIndexOf(".");
          const outerCls = pkg.slice(d2 + 1);
          if (Ty.PKG_CLASSES[pkg.slice(0, d2)] && Ty.DATA.CLASSES[outerCls + "." + last]) return outerCls + "." + last;
          return null;
        }
        if (classKnown(first) || Ty.DATA.CLASSES[name]) {
          if (Ty.DATA.CLASSES[name]) return name;
          // 自分のクラスの入れ子  Outer.Inner
          const last = name.slice(name.lastIndexOf(".") + 1);
          const inner = user.get(last);
          if (inner && !ambiguous.has(last) && inner.outer && inner.outer.name === name.split(".").slice(-2)[0]) return last;
          return null;
        }
        if (report !== false) reportUnknownType(first, node.s, node.s + first.length);
        return null;
      }
      if (single.has(name)) {
        const from = single.get(name);
        const outerCls = from.slice(from.lastIndexOf(".") + 1);
        if (/^[A-Z]/.test(outerCls) && Ty.DATA.CLASSES[outerCls + "." + name]) return outerCls + "." + name;
        if (!user.has(name) && !localTypes.has(name) && !(Ty.PKG_CLASSES[from] && Ty.PKG_CLASSES[from].has(name))) return null;
      }
      if (classKnown(name)) return name;
      if (unknownStar) return name;
      if (report !== false) reportUnknownType(name, node.s, node.s + name.length);
      return null;
    }
    function reportUnknownType(name, s, e) {
      const key = name + "@" + s;
      if (unknownTypeReported.has(key)) return;
      unknownTypeReported.add(key);
      const pkgs = Ty.CLASS_PKGS[name];
      if (pkgs && !Ty.JAVA_LANG.has(name)) {
        const fq = `${pkgs[0]}.${name}`;
        if (!packaged || COMMON_JDK.has(name)) {
          err(s, e, "missing-import", `「${name}」の import がない`, `ファイルの先頭に import ${fq}; を書く`, importEdit(fq));
        } else {
          warn(s, e, "missing-import", `「${name}」の import がない？`, `JDK の ${name} なら import ${fq}; を書く（同じパッケージのクラスなら OK）`, importEdit(fq));
        }
        return;
      }
      if (name === "bool" || name === "Bool") {
        err(s, e, "unknown-type", `「${name}」という型はない`, "true/false の型は boolean", [{ s, e, text: "boolean" }]);
        return;
      }
      const cands = [...user.keys(), ...localTypes.keys(), ...Ty.JAVA_LANG, ...Ty.PKG_CLASSES["java.util"], ...Ty.PKG_CLASSES["java.io"], "int", "double", "boolean", "char", "long"];
      const sg = suggest(name, cands);
      if (packaged && !(sg && sg.caseOnly)) return;
      if (sg && !sg.caseOnly && editDistance(name.toLowerCase(), sg.name.toLowerCase(), 2) > 1) {
        warn(s, e, "unknown-type", `クラス「${name}」が見つからない`, `もしかして「${sg.name}」？（別のファイルのクラスなら OK）`, [{ s, e, text: sg.name }]);
        return;
      }
      if (sg) {
        const pk = !user.has(sg.name) && !Ty.JAVA_LANG.has(sg.name) && Ty.CLASS_PKGS[sg.name] && !classKnown(sg.name);
        err(s, e, "unknown-type", sg.caseOnly ? `「${name}」→「${sg.name}」（大文字・小文字）` : `クラス「${name}」はない`,
          sg.caseOnly ? `「${sg.name}」と書く` : `もしかして「${sg.name}」？${pk ? `（import ${Ty.CLASS_PKGS[sg.name][0]}.${sg.name}; も要る）` : ""}`,
          [{ s, e, text: sg.name }]);
        return;
      }
      warn(s, e, "unknown-type", `クラス「${name}」が見つからない`, "別のファイルにないなら、つづりか import を確認");
    }

    /** 型の AST → 型 */
    function typeOf(tn, tvars) {
      if (!tn || tn.unknown) return null;
      if (Ty.PRIMS.has(tn.name)) return T(tn.name, null, tn.dims);
      if (tn.name === "var") return null;
      const n = resolveTypeName(tn.name, tn, tvars);
      if (n === null) return null;
      let args = null;
      if (tn.args && tn.args.length) {
        args = [];
        for (const a of tn.args) {
          if (a.wildcard) {
            if (a.bound) typeOf(a.bound, tvars);
            args.push(null);
            continue;
          }
          if (a.prim && a.dims === 0) {
            const box = Ty.BOX[a.name];
            err(a.s, a.e, "generic-prim", `< > の中に ${a.name} は書けない`, `${box} を使う`, box ? [{ s: a.s, e: a.e, text: box }] : null);
            args.push(box ? T(box) : null);
            continue;
          }
          args.push(typeOf(a, tvars));
        }
        if (args.some((x) => !x)) args = null;
      }
      return T(n, args, tn.dims);
    }

    /* ---------- クラスのメンバーを登録 ---------- */
    function tvarsOf(rec, extra) {
      const s = new Set();
      for (let r = rec; r; r = r.outer) for (const v of r.tp) s.add(v);
      if (extra) for (const v of extra) s.add(v);
      return s;
    }
    function registerMembers(r) {
      const node = r.node;
      const tv = tvarsOf(r);
      if (node.anon && node.enumOwner) {
        r.sup = node.enumOwner.name;
      } else if (node.anon) {
        const st = node.ext ? typeOf(node.ext, tv) : null;
        const sr = st && recOf(st.n);
        if (sr && sr.kind === "interface") r.ifs = [st.n];
        else if (st) r.sup = st.n;
        if (!st) r.unknownSuper = true;
      } else {
        if (node.ext) {
          const st = typeOf(node.ext, tv);
          if (st) r.sup = st.n;
          else r.unknownSuper = true;
          const sr = st && recOf(st.n);
          if (sr && sr.kind === "interface") {
            err(node.ext.s, node.ext.e, "extends-interface", `「${st.n}」はインタフェース`, "extends ではなく implements を使う");
          }
          if (st && st.n === r.name && !node.ext.name.includes(".")) err(node.ext.s, node.ext.e, "extends-self", "自分自身を extends している", "親クラスの名前を確認");
        }
        for (const it of node.impls) {
          const t = typeOf(it, tv);
          if (!t) r.unknownSuper = true;
          if (t) {
            r.ifs.push(t.n);
            const ir = recOf(t.n);
            if (ir && ir.kind !== "interface" && node.kind !== "interface") {
              err(it.s, it.e, "implements-class", `「${t.n}」はクラス`, "implements ではなく extends を使う");
            }
          }
        }
        if (node.kind === "enum") r.sup = "Enum";
        if (node.kind === "record") r.sup = "Record";
      }
      const isIface = r.kind === "interface" || r.kind === "annotation";
      // フィールド
      for (const m of node.members) {
        if (m.k !== "Field") continue;
        const ft = typeOf(m.type, tv);
        for (const v of m.vars) {
          if (r.fields.has(v.name)) {
            err(v.nameTok.s, v.nameTok.e, "dup-field", `フィールド「${v.name}」が2つある`, "どちらかの名前を変える");
            continue;
          }
          const vt = ft && v.dims ? T(ft.n, ft.a, ft.d + v.dims) : ft;
          r.fields.set(v.name, {
            name: v.name, type: vt, static: isIface || m.mods.list.includes("static"), final: isIface || m.mods.list.includes("final"),
            private: m.mods.list.includes("private"), hasInit: !!v.init, owner: r.name, rec: r, kind: "field", decl: v,
          });
        }
      }
      for (const c of node.consts || []) {
        r.fields.set(c.name, { name: c.name, type: T(r.name), static: true, final: true, hasInit: true, owner: r.name, rec: r, kind: "field" });
      }
      if (node.comps) {
        for (const c of node.comps) {
          const ct = typeOf(c.type, tv);
          r.fields.set(c.name, { name: c.name, type: ct, static: false, final: true, private: true, hasInit: true, owner: r.name, rec: r, kind: "field" });
          addMethod(r, { name: c.name, params: [], varargs: false, ret: ct, static: false, throws: [], owner: r.name, auto: true });
        }
        r.ctors.push({ params: node.comps.map((c) => typeOf(c.type, tv)), varargs: false, throws: [], auto: true });
      }
      if (node.kind === "enum") {
        addMethod(r, { name: "values", params: [], varargs: false, ret: T(r.name, null, 1), static: true, throws: [], owner: r.name });
        addMethod(r, { name: "valueOf", params: [T("String")], varargs: false, ret: T(r.name), static: true, throws: [], owner: r.name });
      }
      // メソッド
      for (const m of node.members) {
        if (m.k !== "Method") continue;
        const mtv = tvarsOf(r, (m.tparams || []).map((x) => x.name));
        const params = m.params.map((p) => typeOf(p.type, mtv));
        const throwsN = m.throws.map((t) => (typeOf(t, mtv) || {}).n).filter(Boolean);
        const varargs = m.params.length > 0 && !!m.params[m.params.length - 1].varargs;
        const isStatic = m.mods.list.includes("static");
        const hasBody = !!m.body;
        const abstract = m.mods.list.includes("abstract") || (isIface && !hasBody && !isStatic && !m.mods.list.includes("default") && !m.mods.list.includes("private"));
        if (m.ctor) {
          if (m.compact) continue;
          const sig = { params, varargs, throws: throwsN, node: m, private: m.mods.list.includes("private") };
          if (r.ctors.some((c) => !c.auto && sameSig(c.params, params))) {
            err(m.nameTok.s, m.nameTok.e, "dup-method", "同じ引数のコンストラクタが2つある", "引数の型か数を変える");
          }
          r.ctors = r.ctors.filter((c) => !(c.auto && sameSig(c.params, params)));
          r.ctors.push(sig);
          continue;
        }
        const ret = m.ret ? typeOf(m.ret, mtv) : null;
        const sig = {
          name: m.name, params, varargs, ret, static: isStatic, private: m.mods.list.includes("private"), abstract, throws: throwsN,
          owner: r.name, node: m, tvars: (m.tparams || []).map((x) => x.name),
        };
        const exist = r.methods.get(m.name) || [];
        const dup = exist.find((x) => !x.auto && sameSig(x.params, params));
        if (dup) {
          err(m.nameTok.s, m.nameTok.e, "dup-method", `メソッド「${m.name}」が2つある（引数も同じ）`, "名前か引数を変える");
        }
        if (exist.some((x) => x.auto && sameSig(x.params, params))) r.methods.set(m.name, exist.filter((x) => !(x.auto && sameSig(x.params, params))));
        addMethod(r, sig);
        if (abstract) r.abstractMethods.push(sig);
      }
      if (!r.ctors.length && r.kind !== "interface") r.ctors.push({ params: [], varargs: false, throws: [], auto: true });
    }
    function addMethod(r, sig) {
      const list = r.methods.get(sig.name) || [];
      list.push(sig);
      r.methods.set(sig.name, list);
    }
    function sameSig(a, b) {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) {
        if (!a[i] || !b[i]) return false;
        if (a[i].n !== b[i].n || a[i].d !== b[i].d) return false;
      }
      return true;
    }
    for (const r of allRecs.slice()) registerMembers(r);
    // 親クラスがわかるか
    function computeComplete(r, depth) {
      if (depth > 20 || r.unknownSuper) return false;
      const chain = [r.sup, ...r.ifs].filter(Boolean);
      for (const n of chain) {
        const s = recOf(n);
        if (!s) return false;
        if (s.user && !computeComplete(s, depth + 1)) return false;
      }
      return true;
    }
    for (const r of allRecs) r.complete = computeComplete(r, 0);

    const topOf = (r) => {
      while (r && r.outer) r = r.outer;
      return r;
    };

    /* ---------- スコープ ---------- */
    let varId = 0;
    function Scope(parent, kind) {
      this.parent = parent;
      this.kind = kind;
      this.vars = new Map();
    }
    Scope.prototype.lookup = function (name) {
      for (let s = this; s; s = s.parent) {
        const v = s.vars.get(name);
        if (v) return v;
      }
      return null;
    };
    /** 同じメソッドの中で、同じ名前のローカル変数があるか */
    Scope.prototype.lookupLocalInMethod = function (name) {
      for (let s = this; s; s = s.parent) {
        const v = s.vars.get(name);
        if (v && v.kind !== "pattern") return v;
        if (s.kind === "method" || s.kind === "class") return null;
      }
      return null;
    };
    Scope.prototype.visibleNames = function () {
      const out = [];
      for (let s = this; s; s = s.parent) for (const k of s.vars.keys()) out.push(k);
      return out;
    };

    /* ---------- 各メソッドを調べる ---------- */
    // M: { rec, static, chain, ret, ctor, lambda, node, tryStack, throws, uncertain, hasErrors, locals, declaredNames, scanner }

    function availOuter(M) {
      // chain[k] で this が使えるか
      const out = [];
      let ok = !M.static;
      for (let k = 0; k < M.chain.length; k++) {
        out.push(ok);
        const r = M.chain[k];
        ok = ok && r.hasOuterInstance;
      }
      return out;
    }
    function classChain(rec) {
      const c = [];
      for (let r = rec; r; r = r.outer) c.push(r);
      return c;
    }

    function declare(sc, M, nameTok, name, type, kind, extra) {
      if (!name || name === "_") return null;
      if (kind !== "pattern" && kind !== "field") {
        const prev = sc.lookupLocalInMethod(name);
        if (prev && !(prev.kind === "pattern")) {
          const ed = extra && extra.dupEdit;
          err(nameTok.s, nameTok.e, "dup-var", `変数「${name}」はもう宣言されている`,
            ed ? "値を入れ直すなら、型（int など）を消して代入にする" : "別の名前にする", ed || null);
        }
      }
      const v = Object.assign({ id: ++varId, name, type, kind, final: false, hasInit: true, declS: nameTok.s, declE: nameTok.e }, extra || {});
      delete v.dupEdit;
      sc.vars.set(name, v);
      if (M && kind !== "pattern") {
        if (!M.declaredNames.has(name)) M.declaredNames.set(name, nameTok.s);
      }
      if (M) M.locals.push(v);
      return v;
    }

    function newMethodCtx(rec, opt) {
      return Object.assign(
        {
          rec, static: false, chain: classChain(rec), ret: null, ctor: false, lambda: false, node: null, tryStack: [],
          throws: [], uncertain: false, hasErrors: false, locals: [], declaredNames: new Map(), scanner: new Map(),
          checkExc: true, allNames: null, labels: [],
        },
        opt
      );
    }

    function walkClass(r, outerScope, outerM) {
      const node = r.node;
      const cscope = new Scope(outerScope, "class");
      const tv = tvarsOf(r);
      const isIface = r.kind === "interface";

      // @Override / 作るべきメソッド
      checkClassRules(r);

      for (const m of node.members) {
        try {
          if (m.k === "Field") {
            const isStatic = isIface || m.mods.list.includes("static");
            const M = newMethodCtx(r, { static: isStatic, field: true, checkExc: false });
            if (outerM) M.outerScope = true;
            const ft = typeOf(m.type, tv);
            for (const v of m.vars) {
              if (!v.init) continue;
              const vt = ft && v.dims ? T(ft.n, ft.a, ft.d + v.dims) : ft;
              initCheck(vt, v.init, cscope, M, m.type);
            }
          } else if (m.k === "Method") {
            walkMethod(r, m, cscope);
          } else if (m.k === "Init") {
            const M = newMethodCtx(r, { static: m.static, init: true, checkExc: false });
            const sc = new Scope(cscope, "method");
            walkBlock(m.body, sc, M);
          } else if (m.k === "Class") {
            walkClass(m.rec, cscope, null);
          } else if (m.k === "Stray") {
            // メソッドの外の文はエラー済み
          }
        } catch (e) {
          if (opts.debug) throw e;
        }
      }
      for (const c of node.consts || []) {
        if (c.args) {
          const M = newMethodCtx(r, { static: true, checkExc: false });
          for (const a of c.args) expr(a, cscope, M);
          checkCtorArgs(r, c.args, c.nameTok, cscope, M, null);
        }
        if (c.body) walkClass(c.body.rec, cscope, null);
      }
    }

    function checkClassRules(r) {
      const node = r.node;
      const nameTok = node.nameTok || { s: node.s, e: node.s + 1 };
      // abstract メソッドを持つ普通のクラス
      if (r.kind === "class") {
        for (const m of node.members) {
          if (m.k === "Method" && m.mods.list.includes("abstract")) {
            err(m.nameTok.s, m.nameTok.e, "abstract-in-class", "abstract メソッドは abstract クラスにだけ書ける", `class ${r.name} に abstract を付ける`);
          }
        }
      }
      for (const m of node.members) {
        if (m.k !== "Method") continue;
        const isIface = r.kind === "interface" || r.kind === "annotation";
        const mods = m.mods.list;
        if (!m.body && !m.ctor && !isIface && !mods.includes("abstract") && !mods.includes("native")) {
          const after = m.semiTok ? parsed.tokens.find((t) => t.s >= m.semiTok.e) : null;
          if (after && after.t === "op" && after.v === "{") {
            err(m.semiTok.s, m.semiTok.e, "missing-body", "メソッドの ( ) のあとに ; がある", "; を消す", [{ s: m.semiTok.s, e: m.semiTok.e, text: "" }]);
          } else {
            err(m.nameTok.s, m.nameTok.e, "missing-body", "メソッドに { } がない", "( ) のあとに { … } を書く");
          }
        }
        if (m.body && isIface && !mods.includes("default") && !mods.includes("static") && !mods.includes("private")) {
          err(m.nameTok.s, m.nameTok.e, "interface-body", "インタフェースのメソッドに { } がある", "default を付けるか、{ } を消して ; にする");
        }
        if (m.ctor && m.body && r.kind !== "class" && r.kind !== "abstract" && r.kind !== "enum" && r.kind !== "record") {
          // interface にコンストラクタ
          err(m.nameTok.s, m.nameTok.e, "interface-ctor", "インタフェースにコンストラクタは作れない", "class にする");
        }
        // @Override
        if (m.mods.annos.some((a) => a.name === "Override") && !m.ctor) {
          const supers = [r.sup || "Object", ...r.ifs];
          if (!r.sup && r.kind !== "interface") supers.push("Object");
          let complete = true;
          const found = [];
          for (const sname of supers) {
            const res = db.findMethods(sname, m.name);
            if (!res.complete) complete = false;
            found.push(...res.list);
          }
          const sr = supers.map(recOf);
          if (sr.some((x) => !x) || !r.complete) complete = false;
          if (complete && !found.length) {
            const names = new Set();
            for (const sname of supers) for (const n of db.memberNames(sname)) names.add(n);
            const sg = suggest(m.name, [...names]);
            err(m.nameTok.s, m.nameTok.e, "override-none", `親に「${m.name}」というメソッドはない`,
              sg ? `もしかして「${sg.name}」？` : "@Override を消すか、名前を確認",
              sg ? [{ s: m.nameTok.s, e: m.nameTok.e, text: sg.name }] : null);
          } else if (complete && !found.some((f) => f.params.length === m.params.length || f.varargs)) {
            err(m.nameTok.s, m.nameTok.e, "override-params", `親の「${m.name}」と引数の数がちがう`, `引数を ${found[0].params.length} 個にする`);
          }
        }
      }
      // インタフェースのメソッドを作っていない（定数ごとに { } で作る enum は除く）
      if ((r.kind === "class" || r.kind === "enum" || r.kind === "record") && !(node.consts || []).some((c) => c.body)) {
        const need = [];
        const visit = (name, seen) => {
          if (!name || seen.has(name)) return;
          seen.add(name);
          const s = recOf(name);
          if (!s || !s.user) return;
          if (s.kind === "interface" || s.kind === "abstract") for (const am of s.abstractMethods) need.push(am);
          if (s.sup) visit(s.sup, seen);
          for (const i of s.ifs) visit(i, seen);
        };
        for (const i of r.ifs) {
          const s = recOf(i);
          if (s && !s.user && ABSTRACT_OF[i] && s.kind === "interface") for (const n of ABSTRACT_OF[i]) need.push({ name: n, params: null, owner: i });
        }
        const seen = new Set();
        if (r.sup) visit(r.sup, seen);
        for (const i of r.ifs) visit(i, seen);
        const missing = [];
        for (const am of need) {
          const res = db.findMethods(r.name, am.name);
          const impl = res.list.some((x) => {
            if (x.abstract) return false;
            if (am.params !== null && x.params.length !== am.params.length) return false;
            const o = recOf(x.owner);
            if (!o) return true;
            if (o.kind !== "interface") return true;
            return !!(x.node && x.node.body);
          });
          if (!impl && res.complete !== false && !missing.some((x) => x.name === am.name)) missing.push(am);
        }
        if (missing.length && r.complete) {
          const m0 = missing[0];
          err(nameTok.s, nameTok.e, "not-implemented", `「${m0.name}」メソッドを作る必要がある（${m0.owner}）`,
            missing.length > 1 ? `ほかにも ${missing.map((x) => x.name).join(", ")} が要る` : `${r.anon ? "{ } " : r.name + " "}の中に ${m0.name} メソッドを書く`);
        }
      }
    }

    function walkMethod(r, m, cscope) {
      const isStatic = m.mods.list.includes("static");
      const mtv = tvarsOf(r, (m.tparams || []).map((x) => x.name));
      const ret = m.ctor ? T("void") : m.ret ? typeOf(m.ret, mtv) : null;
      const M = newMethodCtx(r, {
        static: isStatic, ret, ctor: m.ctor, node: m, mtv,
        throws: m.throws.map((t) => (typeOf(t, mtv) || {}).n).filter(Boolean),
        hasErrors: m.body ? hasErrIn(m.body.s, m.body.e) : false,
      });
      const sc = new Scope(cscope, "method");
      for (const p of m.params) {
        const pt = typeOf(p.type, mtv);
        declare(sc, M, p.nameTok, p.name, pt, "param", { final: p.mods && p.mods.list.includes("final") });
      }
      if (m.compact && r.node.comps) {
        for (const c of r.node.comps) declare(sc, M, c.nameTok, c.name, r.fields.get(c.name) && r.fields.get(c.name).type, "param");
      }
      if (m.ret && m.ret.name === "void" && m.ret.dims) err(m.ret.s, m.ret.e, "void-array", "void の配列は作れない", "戻り値の型を確認");
      if (!m.body) return;
      M.allNames = collectLocalNames(m.body);
      walkBlock(m.body, sc, M, true);
      flowMethod(m, M);
    }

    function collectLocalNames(body) {
      const names = new Map();
      walkAst(body, (n) => {
        if (n.k === "Local") for (const v of n.vars) if (!names.has(v.name)) names.set(v.name, v.nameTok.s);
        if (n.k === "ForEach" && !names.has(n.name)) names.set(n.name, n.nameTok.s);
      });
      return names;
    }

    /* ---------- 文 ---------- */
    function walkBlock(b, sc, M, sameScope) {
      const inner = sameScope ? sc : new Scope(sc, "block");
      for (const st of b.stmts) stmt(st, inner, M, b.stmts);
    }

    function stmt(st, sc, M, siblings) {
      if (!st) return;
      switch (st.k) {
        case "Block":
          walkBlock(st, sc, M);
          return;
        case "Local":
          localDecl(st, sc, M);
          return;
        case "ExprStmt": {
          if (st.expr) {
            st.expr.discard = true;
            expr(st.expr, sc, M);
            unusedStringResult(st.expr, sc, M);
          }
          return;
        }
        case "If":
          cond(st.cond, sc, M, "if");
          stmt(st.then, new Scope(sc, "block"), M);
          if (st.els) stmt(st.els, new Scope(sc, "block"), M);
          return;
        case "While":
          cond(st.cond, sc, M, "while");
          if (!siblings || siblings[siblings.length - 1] === st) infiniteLoopCheck(st);
          loopNoChange(st);
          stmt(st.body, new Scope(sc, "block"), M);
          return;
        case "DoWhile":
          stmt(st.body, new Scope(sc, "block"), M);
          cond(st.cond, sc, M, "while");
          return;
        case "For": {
          const fs = new Scope(sc, "block");
          for (const i of st.init) stmt(i, fs, M);
          if (st.cond) cond(st.cond, fs, M, "for");
          for (const u of st.update) stmt(u, fs, M);
          forChecks(st, fs);
          stmt(st.body, new Scope(fs, "block"), M);
          return;
        }
        case "ForEach": {
          const it = expr(st.iter, sc, M);
          const fs = new Scope(sc, "block");
          let vt = st.type.name === "var" ? null : typeOf(st.type, M.mtv || tvarsOf(M.rec));
          const et = iterElem(it, st);
          if (st.type.name === "var") vt = et;
          else if (vt && et && !db.assignable(vt, et)) {
            err(st.type.s, st.type.e, "foreach-type", `要素は ${str(et)} 型`, `${str(et)} ${st.name} にする`, [{ s: st.type.s, e: st.type.e, text: str(et) }]);
          }
          declare(fs, M, st.nameTok, st.name, vt, "local", { final: st.mods && st.mods.list.includes("final") });
          stmt(st.body, new Scope(fs, "block"), M);
          return;
        }
        case "Return": {
          let t = null;
          if (st.expr) t = expr(st.expr, sc, M, M.ret);
          if (M.lambda || M.init || M.field) return;
          if (M.ctor || (M.ret && M.ret.n === "void" && M.ret.d === 0)) {
            if (st.expr) {
              err(st.expr.s, st.expr.e, "return-value-void", M.ctor ? "コンストラクタは値を返せない" : "void のメソッドは値を返せない",
                M.ctor ? "return; にするか、return を消す" : "return; にするか、戻り値の型を void 以外にする");
            }
          } else if (M.node && M.node.ret && !st.expr) {
            err(st.s, st.e, "return-missing-value", "return に返す値がない", `return 値; の形にする（${str(M.ret)} 型）`);
          } else if (st.expr && M.ret) {
            assignCheck(M.ret, t, st.expr, "return");
            intDivisionHint(M.ret, st.expr, sc, M);
          }
          return;
        }
        case "Throw": {
          const t = expr(st.expr, sc, M);
          if (t && db.assignable(T("Throwable"), t) === false) {
            err(st.expr.s, st.expr.e, "throw-type", "throw できるのは例外だけ", "throw new Exception(\"…\"); のように書く");
          }
          if (st.expr.k === "New" && t && M.checkExc && !M.lambda) excCheck(t.n, st.expr, M);
          return;
        }
        case "Try": {
          const ts = new Scope(sc, "block");
          const catchTypes = [];
          const cts = st.catches.map((c) => c.types.map((t) => typeOf(t, tvarsOf(M.rec))));
          for (const list of cts) for (const t of list) catchTypes.push(t ? t.n : "Throwable");
          M.tryStack.push(catchTypes);
          for (const r of st.res) stmt(r, ts, M);
          walkBlock(st.block, ts, M);
          M.tryStack.pop();
          st.catches.forEach((c, i) => {
            const cs = new Scope(sc, "block");
            const t0 = cts[i].length === 1 ? cts[i][0] : T("Exception");
            for (let k = 0; k < cts[i].length; k++) {
              const ct = cts[i][k];
              if (ct && db.assignable(T("Throwable"), ct) === false) err(c.types[k].s, c.types[k].e, "catch-type", `「${ct.n}」は例外ではない`, "Exception などの例外のクラスを書く");
            }
            declare(cs, M, c.nameTok, c.name, t0, "catch");
            walkBlock(c.body, cs, M, true);
          });
          if (st.fin) walkBlock(st.fin, sc, M);
          return;
        }
        case "Switch":
          switchStmt(st, sc, M);
          return;
        case "Break":
        case "Continue":
        case "Empty":
          return;
        case "Labeled":
          stmt(st.stmt, sc, M);
          return;
        case "Sync":
          expr(st.lock, sc, M);
          walkBlock(st.body, sc, M);
          return;
        case "Assert":
          cond(st.cond, sc, M, "assert");
          if (st.msg) expr(st.msg, sc, M);
          return;
        case "Yield":
          expr(st.expr, sc, M);
          return;
        case "LocalClass": {
          const d = st.decl;
          const r = collect(d, M.rec, { local: true, inStatic: M.static });
          if (localTypes.has(d.name) || user.has(d.name)) ambiguous.add(d.name);
          localTypes.set(d.name, r);
          registerAll(r);
          walkClass(r, sc, M);
          return;
        }
        case "Error":
          M.hasErrors = true;
          return;
        default:
          return;
      }
    }

    function registerAll(r) {
      registerMembers(r);
      r.complete = computeComplete(r, 0);
      for (const m of r.node.members) if (m.k === "Class" && m.rec) registerAll(m.rec);
    }

    function localDecl(st, sc, M) {
      const isVar = st.type.name === "var" && !st.type.args && st.type.dims === 0;
      const tv = M.mtv || tvarsOf(M.rec);
      const base = isVar ? null : typeOf(st.type, tv);
      if (st.type.name === "void") err(st.type.s, st.type.e, "void-var", "void 型の変数は作れない", "int や String などの型にする");
      for (const v of st.vars) {
        let vt = base && v.dims ? T(base.n, base.a, base.d + v.dims) : base;
        if (isVar) {
          if (!v.init) err(v.nameTok.s, v.nameTok.e, "var-no-init", "var には最初の値が要る", `var ${v.name} = 値; の形にする`);
          else if (v.init.k === "ArrayInit") err(v.init.s, v.init.e, "var-array", "var で { } は使えない", "int[] のように型を書く");
          else if (v.init.k === "Literal" && v.init.type === "null") err(v.init.s, v.init.e, "var-null", "var に null は入れられない", "型を書く（String など）");
        }
        const dupEdit = st.vars.length === 1 && v.init ? [{ s: st.s, e: v.nameTok.s, text: "" }] : null;
        const info = declare(sc, M, v.nameTok, v.name, vt, "local", {
          final: st.mods.list.includes("final"), hasInit: !!v.init, dupEdit,
        });
        if (v.init) {
          const t = initCheck(vt, v.init, sc, M, st.type, isVar);
          if (isVar && info) info.type = t && t.n !== "null" ? t : null;
          // 配列の長さ（範囲外チェック用）
          if (info && v.init.k === "NewArray" && v.init.dims.length === 1 && v.init.dims[0] && v.init.dims[0].k === "Literal" && v.init.dims[0].type === "int") info.arrLen = Number(v.init.dims[0].raw.replace(/_/g, ""));
          else if (info && v.init.k === "NewArray" && v.init.init) info.arrLen = v.init.init.elems.length;
          else if (info && v.init.k === "ArrayInit") info.arrLen = v.init.elems.length;
        }
        v.info = info;
      }
    }

    /** 宣言の初期値・フィールドの初期値 */
    function initCheck(vt, init, sc, M, typeNode, isVar) {
      if (init.k === "ArrayInit") {
        if (vt && vt.d === 0) {
          err(init.s, init.e, "array-init-nonarray", `${str(vt)} は配列ではないので { } は使えない`, `配列なら ${str(vt)}[] にする`, typeNode ? [{ s: typeNode.e, e: typeNode.e, text: "[]" }] : null);
          for (const el of init.elems) expr(el, sc, M);
          return vt;
        }
        arrayInitCheck(vt, init, sc, M);
        return vt;
      }
      const t = expr(init, sc, M, vt);
      if (!isVar) {
        assignCheck(vt, t, init, "init");
        intDivisionHint(vt, init, sc, M);
      }
      return t;
    }
    function arrayInitCheck(vt, init, sc, M) {
      const et = vt ? Ty.elem(vt) : null;
      for (const el of init.elems) {
        if (el.k === "ArrayInit") arrayInitCheck(et, el, sc, M);
        else {
          const t = expr(el, sc, M, et);
          assignCheck(et, t, el, "elem");
        }
      }
    }

    function iterElem(it, st) {
      if (!it) return null;
      if (it.d > 0) return Ty.elem(it);
      if (Ty.isPrim(it)) {
        err(st.iter.s, st.iter.e, "foreach-iter", `${str(it)} は1つずつ取り出せない`, "for (型 x : ここ) には配列かリストを書く");
        return null;
      }
      if (it.n === "String") {
        err(st.iter.s, st.iter.e, "foreach-string", "文字列はそのまま for で回せない", `${text(st.iter)}.toCharArray() にする（char で受ける）`, [{ s: st.iter.e, e: st.iter.e, text: ".toCharArray()" }]);
        return T("char");
      }
      if (ITERABLE_ELEM.has(it.n)) return it.a && it.a[0] ? it.a[0] : null;
      if (it.n === "Map" || it.n === "HashMap" || it.n === "TreeMap" || it.n === "LinkedHashMap") {
        err(st.iter.s, st.iter.e, "foreach-map", "Map はそのまま for で回せない", `${text(st.iter)}.keySet() や .entrySet() にする`);
        return null;
      }
      return null;
    }

    function unusedStringResult(e, sc, M) {
      if (e.k !== "Call" || !e.target || !IMMUTABLE_STR.has(e.name) || !e.recvType || !Ty.isString(e.recvType)) return;
      const tgt = text(e.target);
      const assignable = e.target.k === "Name" || e.target.k === "Field";
      warn(e.s, e.e, "unused-result", `${e.name}() の結果を使っていない`, assignable ? `文字列は変わらない。${tgt} = ${tgt}.${e.name}(…); にする` : "文字列は変わらない。結果を変数に入れる",
        assignable ? [{ s: e.s, e: e.s, text: `${tgt} = ` }] : null);
    }

    function switchStmt(st, sc, M) {
      const selT = expr(st.sel, sc, M);
      const sel = Ty.unboxed(selT);
      if (selT && (Ty.isBool(sel) || sel.n === "long" || sel.n === "double" || sel.n === "float") && st.cases.every((c) => c.labels.every((l) => l.k !== "Pattern" && l.k !== "RecordPattern"))) {
        err(st.sel.s, st.sel.e, "switch-type", `switch に ${str(selT)} は使えない`, "int・char・String・enum にするか、if 文を使う");
      }
      const selRec = selT && selT.d === 0 ? recOf(selT.n) : null;
      const isEnum = !!selRec && selRec.kind === "enum";
      const seenLabels = new Map();
      const shared = new Scope(sc, "block");
      for (const c of st.cases) {
        const cs = st.arrow ? new Scope(sc, "block") : shared;
        for (const l of c.labels) {
          if (l.k === "Pattern" || l.k === "RecordPattern") {
            bindPattern(l, cs, M);
            continue;
          }
          const enumLike = !selT || isEnum || (!Ty.isPrim(Ty.unboxed(selT)) && !Ty.isString(selT));
          if (l.k === "Name" && enumLike) {
            if (isEnum && !selRec.fields.has(l.name) && selRec.complete) {
              const sg = suggest(l.name, [...selRec.fields.keys()]);
              err(l.s, l.e, "enum-case", `${selT.n} に「${l.name}」はない`, sg ? `もしかして「${sg.name}」？` : "定数の名前を確認", sg ? [{ s: l.s, e: l.e, text: sg.name }] : null);
            }
            continue;
          }
          if (l.k === "Literal" && l.type === "null") continue;
          const lt = expr(l, sc, M);
          if (selT && lt && !isEnum) {
            const ok = db.assignable(sel && Ty.isPrim(sel) ? sel : selT, lt, constIntOf(l));
            if (!ok) {
              const hint = Ty.isString(lt) && sel.n === "char" ? `'${unquote(l)}' と ' で囲む` : Ty.isString(selT) && lt.n === "char" ? `"${unquote(l)}" と " で囲む` : `${str(selT)} 型の値を書く`;
              err(l.s, l.e, "case-type", `case の値の型がちがう（${str(lt)}）`, hint);
            }
          }
          if (l.k === "Literal") {
            const key = l.raw;
            if (seenLabels.has(key)) err(l.s, l.e, "dup-case", `case ${key} が2回ある`, "どちらかを消すか値を変える");
            seenLabels.set(key, true);
          }
        }
        if (c.guard) cond(c.guard, cs, M, "when");
        for (const b of c.body) stmt(b, cs, M);
      }
      // break 忘れ（次の case に続けて進む）
      if (st.k === "Switch" && !st.arrow) {
        for (let i = 0; i < st.cases.length - 1; i++) {
          const body = st.cases[i].body;
          if (!body.length) continue;
          const last = body[body.length - 1];
          if (endsAbruptly(last)) continue;
          // 条件つきで return / break しているなら、わざと下へ流している
          let jumps = false;
          walkAst(body, (x) => {
            if (x.k === "Break" || x.k === "Return" || x.k === "Throw" || x.k === "Continue") jumps = true;
            return jumps ? false : undefined;
          });
          if (jumps) continue;
          const next = st.cases[i + 1];
          if (/fall|drop|そのまま|続け/i.test(src.slice(last.e, next.s))) continue;
          const ls = src.lastIndexOf("\n", last.s) + 1;
          const indent = src.slice(ls, last.s).match(/^[ \t]*/)[0];
          warn(next.s, next.s + (src.startsWith("default", next.s) ? 7 : 4), "switch-fallthrough", "前の case に break がない（ここも続けて動く）",
            "前の case の終わりに break; を書く", [{ s: last.e, e: last.e, text: "\n" + indent + "break;" }]);
        }
      }
    }
    function endsAbruptly(s) {
      if (!s) return false;
      switch (s.k) {
        case "Break": case "Return": case "Throw": case "Continue": case "Yield":
          return true;
        case "Block":
          return endsAbruptly(s.stmts[s.stmts.length - 1]);
        case "If":
          return !!s.els && endsAbruptly(s.then) && endsAbruptly(s.els);
        case "ExprStmt":
          return s.expr && s.expr.k === "Call" && s.expr.name === "exit";
        case "While": case "For": case "DoWhile": {
          const c = s.k === "For" ? s.cond : s.cond;
          return (!c || (unparen(c).k === "Literal" && unparen(c).raw === "true")) && !hasExit(s.body, 0);
        }
        case "Try":
          return endsAbruptly(s.block) && s.catches.every((c) => endsAbruptly(c.body));
        case "Switch":
          return false;
      }
      return false;
    }
    function unquote(l) {
      return l.raw.slice(1, -1);
    }
    function bindPattern(pat, sc, M) {
      if (pat.k === "Pattern") {
        const t = typeOf(pat.type, M.mtv || tvarsOf(M.rec));
        declare(sc, M, pat.nameTok, pat.name, t, "pattern");
      } else if (pat.k === "RecordPattern") {
        typeOf(pat.type, M.mtv || tvarsOf(M.rec));
        for (const s of pat.subs) bindPattern(s, sc, M);
        if (pat.nameTok) declare(sc, M, pat.nameTok, pat.name, null, "pattern");
      }
    }

    /** if / while などの条件 */
    function cond(e, sc, M, what) {
      if (!e) return;
      const inner = e.k === "Paren" ? e.expr : e;
      if (inner.k === "Assign" && inner.op === "=") {
        const t = expr(inner, sc, M);
        if (t && Ty.boolLike(t)) {
          warn(inner.s, inner.e, "assign-in-cond", "「=」は代入（比べていない）", "比べるなら == にする", [{ s: inner.opS, e: inner.opS + 1, text: "==" }]);
        } else {
          err(inner.s, inner.e, "assign-in-cond", "比べるのは「==」（= は代入）", "= を == にする", [{ s: inner.opS, e: inner.opS + 1, text: "==" }]);
        }
        return;
      }
      const t = expr(e, sc, M, Ty.BOOLEAN);
      if (t && !Ty.boolLike(t)) {
        let fix = "x > 0 のような true / false になる式にする";
        if (Ty.numLike(t)) fix = `例: ${text(e)} > 0 や ${text(e)} == 1`;
        if (Ty.isString(t)) fix = `例: ${text(e)}.equals("…") や !${text(e)}.isEmpty()`;
        err(e.s, e.e, "cond-type", `${what} の条件が true / false ではない（${str(t)}）`, fix);
      }
    }

    function forChecks(st, fs) {
      if (!st.cond || st.cond.k !== "Binary") return;
      const c = st.cond;
      // i <= arr.length
      if (c.op === "<=") {
        const r = c.r;
        const isLen = (r.k === "Field" && r.name === "length") || (r.k === "Call" && (r.name === "size" || r.name === "length") && r.args.length === 0);
        if (isLen) {
          warn(c.s, c.e, "off-by-one", "<= だと最後に範囲外になる", "< にする（番号は 0 〜 長さ-1）", [{ s: c.opS, e: c.opS + 2, text: "<" }]);
        }
      }
      // for (i = 0; i < 10; i--)
      if (c.l.k === "Name" && st.update.length === 1) {
        const u = st.update[0].expr;
        let dir = 0;
        if (u && u.k === "Unary" && u.expr.k === "Name" && u.expr.name === c.l.name) dir = u.op === "++" ? 1 : u.op === "--" ? -1 : 0;
        if (u && u.k === "Assign" && u.target.k === "Name" && u.target.name === c.l.name && u.value.k === "Literal") dir = u.op === "+=" ? 1 : u.op === "-=" ? -1 : 0;
        if ((dir === -1 && (c.op === "<" || c.op === "<=")) || (dir === 1 && (c.op === ">" || c.op === ">="))) {
          const better = dir === -1 ? "++" : "--";
          warn(u.s, u.e, "for-direction", `${c.l.name} が条件と逆に動いて、終わらない`, `${c.l.name}${better} にする（または条件の向きを確認）`,
            u.k === "Unary" ? [{ s: u.s, e: u.e, text: `${c.l.name}${better}` }] : null);
        }
      }
      void fs;
    }

    const unparen = (x) => (x && x.k === "Paren" ? unparen(x.expr) : x);

    /** while (i < 10) { … } の中で i が変わらない */
    function loopNoChange(st) {
      const c = unparen(st.cond);
      if (!c || c.k === "Literal") return;
      const names = new Set();
      let ok = true;
      walkAst(c, (x) => {
        if (x.k === "Name") {
          if (!x.ref || x.ref.kind === "field") ok = false;
          names.add(x.name);
        } else if (["Call", "Field", "Index", "Assign", "New", "Lambda", "SwitchExpr", "InstanceOf"].includes(x.k) || (x.k === "Unary" && (x.op === "++" || x.op === "--"))) ok = false;
        return undefined;
      });
      if (!ok || !names.size) return;
      let changed = false;
      walkAst(st.body, (x) => {
        if (changed) return false;
        if (x.k === "Assign") {
          const t = unparen(x.target);
          if (t.k === "Name" && names.has(t.name)) changed = true;
        } else if (x.k === "Unary" && (x.op === "++" || x.op === "--")) {
          const t = unparen(x.expr);
          if (t.k === "Name" && names.has(t.name)) changed = true;
        } else if (x.k === "Return" || x.k === "Throw" || x.k === "Break") changed = true;
        else if (x.k === "Call" && (x.name === "exit" || (!x.target && neverReturns.has(x.name)))) changed = true;
        else if (x.k === "LocalClass" || (x.k === "New" && x.body)) return false;
        return undefined;
      });
      if (changed) return;
      const list = [...names];
      warn(st.s, st.cond.e + (src[st.cond.e] === ")" ? 1 : 0), "loop-no-change", `${list.map((n) => `「${n}」`).join("")}がループの中で変わらず、終わらない`,
        `ループの中で ${list[0]} を変える（${list[0]}++ など）`);
    }

    function infiniteLoopCheck(st) {
      const c = st.cond && st.cond.k === "Paren" ? st.cond.expr : st.cond;
      if (!c || c.k !== "Literal" || c.raw !== "true") return;
      if (hasExit(st.body, 0)) return;
      warn(st.s, st.s + 5, "infinite-loop", "while (true) から抜ける break がない", "終わる条件のところで break; を書く");
    }
    function hasExit(n, depth) {
      let found = false;
      walkAst(n, (x, d) => {
        if (found) return false;
        if (x.k === "Return" || x.k === "Throw") found = true;
        else if (x.k === "Break" && (x.label || d === 0)) found = true;
        else if (x.k === "Call" && (x.name === "exit" || (!x.target && neverReturns.has(x.name)))) found = true;
        else if (x.k === "Lambda" || x.k === "LocalClass" || (x.k === "New" && x.body)) return false;
        return undefined;
      }, depth);
      return found;
    }

    /* ---------- 式 ---------- */
    function constIntOf(e) {
      if (!e) return null;
      if (e.k === "Paren") return constIntOf(e.expr);
      if (e.k === "Literal" && (e.type === "int" || e.type === "char")) {
        if (e.type === "char") return e.raw.length === 3 ? e.raw.charCodeAt(1) : null;
        const v = L.intValue(e.raw);
        return v === null ? null : Number(v);
      }
      if (e.k === "Unary" && e.op === "-") {
        const v = constIntOf(e.expr);
        return v === null ? null : -v;
      }
      if (e.k === "Binary" && ["+", "-", "*", "/", "%", "<<", ">>", "&", "|", "^"].includes(e.op)) {
        const a = constIntOf(e.l);
        const b = constIntOf(e.r);
        if (a === null || b === null) return null;
        switch (e.op) {
          case "+": return a + b;
          case "-": return a - b;
          case "*": return a * b;
          case "/": return b === 0 ? null : Math.trunc(a / b);
          case "%": return b === 0 ? null : a % b;
          case "<<": return a << b;
          case ">>": return a >> b;
          case "&": return a & b;
          case "|": return a | b;
          case "^": return a ^ b;
        }
      }
      if (e.k === "Cast" && e.type.prim && e.type.dims === 0 && ["int", "char", "short", "byte"].includes(e.type.name)) return constIntOf(e.expr);
      if (e.k === "Name" && e.ref && e.ref.final && e.ref.constVal !== undefined) return e.ref.constVal;
      return null;
    }

    /** 代入できるかを調べて、できなければわかりやすく報告 */
    /** 定数の式かもしれない（final の変数・定数だけでできている） */
    function maybeConstExpr(e) {
      let ok = true;
      walkAst(e, (x) => {
        if (!ok) return false;
        if (x.k === "Name") {
          if (!(x.ref && x.ref.final)) ok = false;
        } else if (x.k === "Field") {
          return false;
        } else if (["Call", "New", "NewArray", "Index", "Assign", "Lambda", "InstanceOf", "SwitchExpr"].includes(x.k)) ok = false;
        else if (x.k === "Unary" && (x.op === "++" || x.op === "--")) ok = false;
        return undefined;
      });
      return ok;
    }

    function assignCheck(to, from, e, ctx) {
      if (!to || !from) return true;
      const ci = constIntOf(e);
      if (ci === null && Ty.isPrim(to) && ["byte", "short", "char"].includes(to.n) && ["int", "char", "short", "byte"].includes(from.n) && from.d === 0 && maybeConstExpr(e)) return true;
      const ok = db.assignable(to, from, ci);
      if (ok !== false) return true;
      mismatch(to, from, e, ctx);
      return false;
    }
    function mismatch(to, from, e, ctx) {
      const s = e.s;
      const en = e.e;
      const where = ctx === "return" ? "戻り値" : ctx === "arg" ? "引数" : "";
      const toS = str(to);
      const fromS = str(from);
      const lit = e.k === "Literal" ? e : null;
      const head = (x) => `${where ? where + "：" : ""}${x}`;
      if (from.n === "null" && Ty.isPrim(to)) {
        err(s, en, "type-mismatch", head(`null は ${toS} に入れられない`), `${Ty.BOX[to.n] || "参照"} 型にするか、0 などを入れる`);
        return;
      }
      if (Ty.isString(from) && to.d === 0 && Ty.numLike(to)) {
        const prim = Ty.unboxed(to).n;
        if (lit && /^"[+-]?\d+(\.\d+)?"$/.test(lit.raw)) {
          err(s, en, "type-mismatch", head(`文字列は ${toS} に入れられない`), `" " を外して ${lit.raw.slice(1, -1)} にする`, [{ s, e: en, text: lit.raw.slice(1, -1) }]);
          return;
        }
        const conv = prim === "double" ? "Double.parseDouble" : prim === "long" ? "Long.parseLong" : prim === "float" ? "Float.parseFloat" : "Integer.parseInt";
        const ed = prim === "int" || prim === "double" || prim === "long" ? [{ s, e: s, text: `${conv}(` }, { s: en, e: en, text: ")" }] : null;
        err(s, en, "type-mismatch", head(`文字列（String）は ${toS} に入れられない`), `数にするなら ${conv}(…) で変換する`, ed);
        return;
      }
      if (Ty.isString(to) && from.d === 0 && (Ty.isPrim(from) || Ty.UNBOX[from.n])) {
        if (lit && lit.type === "char") {
          err(s, en, "type-mismatch", head("char（'…'）は String に入れられない"), `"${lit.raw.slice(1, -1)}" と " で囲む`, [{ s, e: en, text: `"${lit.raw.slice(1, -1)}"` }]);
          return;
        }
        if (lit && lit.type !== "String") {
          err(s, en, "type-mismatch", head(`${fromS} は String に入れられない`), `文字列なら "${lit.raw}" と " で囲む`, [{ s, e: en, text: `"${lit.raw}"` }]);
          return;
        }
        err(s, en, "type-mismatch", head(`${fromS} は String に入れられない`), "String.valueOf(…) で文字列にする", [{ s, e: s, text: "String.valueOf(" }, { s: en, e: en, text: ")" }]);
        return;
      }
      if (Ty.isString(from) && to.n === "char" && to.d === 0) {
        const one = lit && /^"(.|\\.)"$/.test(lit.raw);
        err(s, en, "type-mismatch", head("文字列（\"…\"）は char に入れられない"), one ? `1文字なら '${lit.raw.slice(1, -1)}' と ' で囲む` : "1文字なら '…'、文字列なら String 型にする",
          one ? [{ s, e: en, text: `'${lit.raw.slice(1, -1)}'` }] : null);
        return;
      }
      if (Ty.isPrim(to) && Ty.isNumeric(to) && Ty.numLike(from) && !Ty.isBool(to)) {
        const f = Ty.unboxed(from).n;
        const lossy = Ty.NUM_RANK[f] > Ty.NUM_RANK[to.n] || (f === "char" && (to.n === "short" || to.n === "byte")) || (to.n === "char");
        if (lossy) {
          const dec = (f === "double" || f === "float") && (to.n === "int" || to.n === "long");
          const simple = ["Literal", "Name", "Field", "Call", "Index", "Paren"].includes(e.k);
          err(s, en, "lossy", head(`${f} を ${toS} に入れると${dec ? "小数点以下が消える" : "はみ出すかも"}`),
            `(${toS}) を付けて変換するか、${f} 型にする`,
            simple ? [{ s, e: s, text: `(${toS}) ` }] : [{ s, e: s, text: `(${toS}) (` }, { s: en, e: en, text: ")" }]);
          return;
        }
      }
      if ((Ty.isBool(to) && Ty.numLike(from)) || (Ty.numLike(to) && Ty.boolLike(from))) {
        err(s, en, "type-mismatch", head(`${fromS} は ${toS} に入れられない`), Ty.isBool(to) ? "true / false を入れる（比べるなら x > 0 など）" : "数を入れる（true / false は boolean 型）");
        return;
      }
      if (to.d > 0 && from.d === 0) {
        err(s, en, "type-mismatch", head(`配列（${toS}）に ${fromS} は入れられない`), `配列なら new ${to.n}[]{ … } のように作る`);
        return;
      }
      if (from.d > 0 && to.d === 0 && from.n !== "null") {
        err(s, en, "type-mismatch", head(`配列は ${toS} に入れられない`), `1つ取り出すなら ${text(e)}[0] のように番号を付ける`);
        return;
      }
      err(s, en, "type-mismatch", head(`${fromS} は ${toS} に入れられない`), `${toS} 型の値にする`);
    }

    function intDivisionHint(to, e, sc, M) {
      if (!to || to.d || !(to.n === "double" || to.n === "float" || to.n === "Double")) return;
      const x = e.k === "Paren" ? e.expr : e;
      if (x.k !== "Binary" || x.op !== "/" || !x.lt || !x.rt) return;
      if (!Ty.isIntegral(Ty.unboxed(x.lt)) || !Ty.isIntegral(Ty.unboxed(x.rt))) return;
      warn(x.s, x.e, "int-division", "整数どうしの割り算（小数点以下が消える）", `(double) ${text(x.l)} / ${text(x.r)} にする`, [{ s: x.s, e: x.s, text: "(double) " }]);
      void sc;
      void M;
    }

    /** 式の型を調べる（チェックもする） */
    function expr(e, sc, M, expected) {
      if (!e) return null;
      const t = expr0(e, sc, M, expected);
      e.ty = t;
      return t;
    }

    function expr0(e, sc, M, expected) {
      switch (e.k) {
        case "Literal":
          return literal(e);
        case "Paren":
          return expr(e.expr, sc, M, expected);
        case "Name":
        case "Field": {
          const r = ref(e, sc, M);
          if (r.kind === "type" && !e.asQualifier) {
            err(e.s, e.e, "type-as-value", `「${text(e)}」はクラス名（値ではない）`, "変数名か、クラス名.メソッド() にする");
            return null;
          }
          return r.t || null;
        }
        case "Call":
          return call(e, sc, M);
        case "New":
          return newObj(e, sc, M, expected);
        case "NewArray": {
          const at = typeOf(e.type, M.mtv || tvarsOf(M.rec));
          for (const d of e.dims) {
            if (!d) continue;
            const dt = expr(d, sc, M);
            if (dt && !Ty.isIntegral(Ty.unboxed(dt))) err(d.s, d.e, "array-size-type", `配列の大きさは整数（いまは ${str(dt)}）`, Ty.isString(dt) ? "Integer.parseInt(…) で数にする" : "(int) を付けるか int の値にする");
            else if (dt && Ty.unboxed(dt).n === "long") err(d.s, d.e, "array-size-type", "配列の大きさは int", "(int) を付ける");
            const v = constIntOf(d);
            if (v !== null && v < 0) warn(d.s, d.e, "array-negative", "大きさがマイナス（実行時エラー）", "0 以上にする");
          }
          if (e.init) arrayInitCheck(at, e.init, sc, M);
          return at;
        }
        case "ArrayInit":
          for (const el of e.elems) expr(el, sc, M);
          return null;
        case "Index": {
          const at = expr(e.arr, sc, M);
          const it = expr(e.index, sc, M);
          if (it && !Ty.isIntegral(Ty.unboxed(it))) {
            err(e.index.s, e.index.e, "index-type", `番号は整数（いまは ${str(it)}）`, Ty.isString(it) ? "Integer.parseInt(…) で数にする" : "(int) を付ける");
          } else if (it && Ty.unboxed(it).n === "long") {
            err(e.index.s, e.index.e, "index-type", "番号は int（long は使えない）", "(int) を付ける");
          }
          if (!at) return null;
          if (at.d > 0) {
            indexRangeCheck(e, sc);
            return Ty.elem(at);
          }
          if (Ty.isString(at)) {
            err(e.s, e.e, "string-index", "文字列に [ ] は使えない", `${text(e.arr)}.charAt(${text(e.index)}) にする`,
              [{ s: e.arr.e, e: e.index.s, text: ".charAt(" }, { s: e.index.e, e: e.e, text: ")" }]);
            return T("char");
          }
          if (LIST_LIKE.has(at.n)) {
            err(e.s, e.e, "list-index", "リストに [ ] は使えない", `${text(e.arr)}.get(${text(e.index)}) にする`,
              [{ s: e.arr.e, e: e.index.s, text: ".get(" }, { s: e.index.e, e: e.e, text: ")" }]);
            return at.a ? at.a[0] : null;
          }
          if (Ty.isPrim(at) || recOf(at.n)) err(e.s, e.e, "not-array", `${str(at)} は配列ではない`, "[ ] は配列にだけ使える");
          return null;
        }
        case "Unary":
          return unary(e, sc, M);
        case "Binary":
          return binary(e, sc, M);
        case "Assign":
          return assign(e, sc, M);
        case "Cond": {
          cond(e.cond, sc, M, "? :");
          const a = expr(e.a, sc, M, expected);
          const b = expr(e.b, sc, M, expected);
          if (!a || !b) return null;
          if (Ty.same(a, b)) return a;
          if (a.n === "null") return Ty.isPrim(b) ? Ty.boxed(b) : b;
          if (b.n === "null") return Ty.isPrim(a) ? Ty.boxed(a) : a;
          if (Ty.isPrim(a) && Ty.isPrim(b) && ["char", "short", "byte"].includes(a.n) && b.n === "int" && constIntOf(e.b) !== null && db.assignable(a, b, constIntOf(e.b))) return a;
          if (Ty.isPrim(a) && Ty.isPrim(b) && ["char", "short", "byte"].includes(b.n) && a.n === "int" && constIntOf(e.a) !== null && db.assignable(b, a, constIntOf(e.a))) return b;
          if (Ty.numLike(a) && Ty.numLike(b)) return Ty.promote(a, b);
          if (db.assignable(a, b) === true && !Ty.isPrim(a)) return a;
          if (db.assignable(b, a) === true && !Ty.isPrim(b)) return b;
          return null;
        }
        case "Cast": {
          const ct = typeOf(e.type, M.mtv || tvarsOf(M.rec));
          const xt = expr(e.expr, sc, M);
          castCheck(ct, xt, e);
          return ct;
        }
        case "InstanceOf": {
          const xt = expr(e.expr, sc, M);
          if (e.target.k === "Pattern" || e.target.k === "RecordPattern") {
            bindPattern(e.target, sc, M);
          } else typeOf(e.target, M.mtv || tvarsOf(M.rec));
          if (xt && Ty.isPrim(xt)) err(e.expr.s, e.expr.e, "instanceof-prim", `${str(xt)} に instanceof は使えない`, "instanceof はクラスの値に使う");
          return Ty.BOOLEAN;
        }
        case "Lambda": {
          const ls = new Scope(sc, "block");
          const LM = Object.assign({}, M, { lambda: true, ret: null, tryStack: [], checkExc: false });
          for (const p of e.params) {
            const pt = p.type ? typeOf(p.type, M.mtv || tvarsOf(M.rec)) : null;
            declare(ls, LM, p.nameTok, p.name, pt, "param");
          }
          if (e.body.k === "Block") walkBlock(e.body, ls, LM, true);
          else expr(e.body, ls, LM);
          return null;
        }
        case "MethodRef":
          if (e.target && e.target.k !== "TypeRef") {
            e.target.asQualifier = true;
            expr(e.target, sc, M);
          }
          return null;
        case "TypeRef":
          typeOf(e.type, M.mtv || tvarsOf(M.rec));
          return null;
        case "ClassLit":
          return T("Class");
        case "This": {
          if (e.qualifier) return T(e.qualifier.name || M.rec.name);
          if (M.static) {
            err(e.s, e.e, "static-this", "static メソッドの中では this は使えない", "static を外すか、オブジェクトを作って使う");
            return null;
          }
          return M.rec.anon ? null : T(M.rec.name);
        }
        case "Super":
          if (M.static) err(e.s, e.e, "static-this", "static メソッドの中では super は使えない", "static を外す");
          if (M.rec.unknownSuper) return null;
          return M.rec.sup ? T(M.rec.sup) : T("Object");
        case "SwitchExpr": {
          switchStmt(e, sc, M);
          return null;
        }
        case "Error":
          M.hasErrors = true;
          return null;
        default:
          return null;
      }
    }

    function literal(e) {
      if (e.bad) return null;
      switch (e.type) {
        case "int":
        case "long": {
          const v = L.intValue(e.raw);
          const hex = /^0[xXbB]/.test(e.raw) || /^0\d/.test(e.raw);
          if (v !== null) {
            const limit = e.type === "int" ? (hex ? 0xffffffffn : 2147483647n) : hex ? 0xffffffffffffffffn : 9223372036854775807n;
            const okNeg = e.negated && v === limit + 1n && !hex;
            if (v > limit && !okNeg) {
              if (e.type === "int") {
                err(e.s, e.e, "int-too-large", "int に入らない大きな数", "最後に L を付けて long にする", [{ s: e.e, e: e.e, text: "L" }]);
              } else err(e.s, e.e, "int-too-large", "long にも入らない大きな数", "double を使うか、数を小さくする");
            }
          }
          return T(e.type);
        }
        case "double":
        case "float":
        case "boolean":
        case "char":
          return T(e.type);
        case "String":
          return Ty.STRING;
        case "null":
          return Ty.NULL;
      }
      return null;
    }

    /** 名前・フィールドの参照 → { kind: value|type|pkg|unknown, t, v } */
    function ref(e, sc, M) {
      if (e.k === "Name") return nameRef(e, sc, M);
      if (e.k !== "Field") return { kind: "value", t: expr(e, sc, M) };
      if (e.target.k === "Name" || e.target.k === "Field") e.target.asQualifier = true;
      const base = e.target.k === "Name" || e.target.k === "Field" ? ref(e.target, sc, M) : { kind: "value", t: expr(e.target, sc, M) };
      if (e.target.k === "Name" || e.target.k === "Field") e.target.ty = base.t || null;
      if (base.kind === "pkg") {
        const full = text(e.target).replace(/\s+/g, "") + "." + e.name;
        const pk = text(e.target).replace(/\s+/g, "");
        if (Ty.PKG_CLASSES[full]) return { kind: "pkg" };
        if (user.has(e.name) || ambiguous.has(e.name) || localTypes.has(e.name)) return { kind: "type", name: e.name, unknownMembers: true };
        if (Ty.PKG_CLASSES[pk] && Ty.PKG_CLASSES[pk].has(e.name)) return { kind: "type", name: e.name };
        if (/^[A-Z]/.test(e.name)) return { kind: "type", name: e.name, unknownMembers: !Ty.PKG_CLASSES[pk] };
        return { kind: "pkg" };
      }
      if (base.kind === "unknown") return { kind: "unknown" };
      if (base.kind === "type") return staticMember(base, e, sc, M);
      const t = base.t;
      if (!t) return { kind: "unknown" };
      return { kind: "value", t: memberField(t, e, M) };
    }

    function staticMember(base, e, sc, M) {
      const cls = base.name;
      if (base.unknownMembers) return { kind: "unknown" };
      const rec = recOf(cls);
      // 入れ子のクラス  Map.Entry / Outer.Inner
      const nested = Ty.DATA.CLASSES[cls + "." + e.name] ? cls + "." + e.name : null;
      if (nested) return { kind: "type", name: nested };
      if (/^[A-Z]/.test(e.name) && (user.has(e.name) || ambiguous.has(e.name))) return { kind: "type", name: e.name };
      if (!rec) return { kind: "unknown" };
      const f = db.findField(cls, e.name);
      if (f.field) {
        if (!f.field.static) {
          err(e.nameTok.s, e.nameTok.e, "static-ref", `「${e.name}」は static ではない`, `${cls}.${e.name} ではなく、オブジェクト.${e.name} で使う`);
        } else if (f.field.private && f.field.rec && topOf(f.field.rec) !== topOf(M.rec)) {
          err(e.nameTok.s, e.nameTok.e, "private-access", `「${e.name}」は private`, `${f.field.owner} の外からは使えない`);
        }
        return { kind: "value", t: f.field.type, v: f.field };
      }
      if (!f.complete) return { kind: "unknown" };
      const ms = db.findMethods(cls, e.name);
      if (ms.list.length) {
        err(e.nameTok.s, e.nameTok.e, "missing-call-paren", `「${e.name}」はメソッド。( ) が要る`, `${e.name}() にする`, [{ s: e.nameTok.e, e: e.nameTok.e, text: "()" }]);
        return { kind: "unknown" };
      }
      if (e.name === "class") return { kind: "value", t: T("Class") };
      const names = [...db.memberNames(cls, true)];
      const sg = suggest(e.name, names);
      err(e.nameTok.s, e.nameTok.e, "no-member", `${cls} に「${e.name}」はない`, sg ? `もしかして「${sg.name}」？` : "名前を確認",
        sg ? [{ s: e.nameTok.s, e: e.nameTok.e, text: sg.name }] : null);
      return { kind: "unknown" };
    }

    function memberField(t, e, M) {
      if (Ty.isPrim(t)) {
        err(e.target.s, e.nameTok.e, "deref-prim", `${str(t)} に「.」は使えない`, `${str(t)} は値そのもの。メソッドやフィールドはない`);
        return null;
      }
      if (t.n === "null") return null;
      if (t.d > 0) {
        if (e.name === "length") return Ty.INT;
        err(e.nameTok.s, e.nameTok.e, "array-member", `配列に「${e.name}」はない`, "配列の長さは length");
        return null;
      }
      const f = db.findField(t.n, e.name);
      if (f.field) {
        if (f.field.private && f.field.rec && topOf(f.field.rec) !== topOf(M.rec)) {
          err(e.nameTok.s, e.nameTok.e, "private-access", `「${e.name}」は private`, `${f.field.owner} の外からは使えない（get メソッドなどを使う）`);
        }
        return substField(f.field, t);
      }
      if (!f.complete) return null;
      if (LIST_LIKE.has(t.n) && (e.name === "length" || e.name === "size")) {
        err(e.nameTok.s, e.nameTok.e, "list-length", "リストの長さは size()", "size() にする", [{ s: e.nameTok.s, e: e.nameTok.e, text: "size()" }]);
        return Ty.INT;
      }
      const ms = db.findMethods(t.n, e.name);
      if (ms.list.length) {
        err(e.nameTok.s, e.nameTok.e, "missing-call-paren", `「${e.name}」はメソッド。( ) が要る`, `${e.name}() にする`, [{ s: e.nameTok.e, e: e.nameTok.e, text: "()" }]);
        const r0 = ms.list.find((m) => m.params.length === 0);
        return r0 ? substRet(r0, t) : null;
      }
      const sg = suggest(e.name, [...db.memberNames(t.n)]);
      err(e.nameTok.s, e.nameTok.e, "no-member", `${str(t)} に「${e.name}」はない`, sg ? `もしかして「${sg.name}」？` : "名前を確認",
        sg ? [{ s: e.nameTok.s, e: e.nameTok.e, text: sg.name }] : null);
      return null;
    }

    function substField(f, recv) {
      if (!f.type) return null;
      const { map, tvars } = db.typeVarMap(recv, f.owner);
      return Ty.subst(f.type, map, tvars);
    }
    function substRet(sig, recv) {
      if (!sig.ret) return null;
      const { map, tvars } = db.typeVarMap(recv, sig.owner);
      if (sig.tvars) for (const v of sig.tvars) tvars.add(v);
      // メソッド自身の型変数（<T> T foo()）はわからない
      return scrubTV(Ty.subst(sig.ret, map, tvars));
    }

    function scrubTV(t) {
      if (!t) return null;
      if (/^[A-Z]$/.test(t.n)) return null;
      if (!t.a) return t;
      const a = t.a.map(scrubTV);
      return a.some((x) => !x) ? T(t.n, null, t.d) : T(t.n, a, t.d);
    }

    function nameRef(e, sc, M) {
      const name = e.name;
      const v = sc.lookup(name);
      if (v) {
        e.ref = v;
        if (v.kind === "field") return fieldAccess(v, e, M, 0);
        return { kind: "value", t: v.type, v };
      }
      // フィールド（外側のクラスも）
      let incomplete = false;
      for (let k = 0; k < M.chain.length; k++) {
        const r = M.chain[k];
        const f = db.findField(r.name, name);
        if (f.field) {
          e.ref = f.field;
          return fieldAccess(f.field, e, M, k);
        }
        if (!f.complete) {
          incomplete = true;
          break;
        }
      }
      // static import
      for (const si of staticImps) {
        if (si.member === name || si.member === null) {
          const f = db.findField(si.cls, name);
          if (f.field) return { kind: "value", t: f.field.type };
          if (!f.complete || si.member === name) return { kind: "unknown" };
        }
      }
      // クラス名
      if (classKnown(name)) return { kind: "type", name };
      if (M.mtv && M.mtv.has(name)) return { kind: "unknown" };
      if (e.asQualifier && /^(java|javax|jdk|org|com|net|sun)$/.test(name)) return { kind: "pkg" };
      if (incomplete || unknownStaticStar) return { kind: "unknown" };
      if (e.asQualifier && /^[A-Z]/.test(name)) {
        if (unknownStar) return { kind: "unknown" };
        reportUnknownType(name, e.s, e.e);
        return { kind: "unknown" };
      }
      undefinedVar(e, sc, M);
      return { kind: "unknown" };
    }

    function fieldAccess(f, e, M, level) {
      if (!f.static) {
        const avail = availOuter(M);
        if (!avail[level]) {
          const ownerRec = f.rec;
          const isMainLike = M.node && M.node.name === "main";
          const declTok = f.decl && f.decl.nameTok;
          err(e.s, e.e, "static-context", `static でない「${f.name}」を static から使っている`,
            isMainLike || M.static ? `${f.name} の宣言に static を付ける` : "static を外すか、オブジェクトを作って使う",
            declTok && ownerRec ? staticEditForField(f) : null);
        }
      }
      return { kind: "value", t: f.type, v: f };
    }
    function staticEditForField(f) {
      const decl = f.rec && f.rec.node.members.find((m) => m.k === "Field" && m.vars.includes(f.decl));
      if (!decl) return null;
      return [{ s: decl.type.s, e: decl.type.s, text: "static " }];
    }

    function undefinedVar(e, sc, M) {
      if (M.hasErrors) return;
      const name = e.name;
      const s = e.s;
      const en = e.e;
      if (name === "system") {
        err(s, en, "undefined-var", "「system」→「System」（大文字）", "System と書く", [{ s, e: en, text: "System" }]);
        return;
      }
      if (name === "string" || name === "integer" || name === "math" || name === "scanner") {
        const up = name[0].toUpperCase() + name.slice(1);
        err(s, en, "undefined-var", `「${name}」→「${up}」（大文字）`, `${up} と書く`, [{ s, e: en, text: up }]);
        return;
      }
      // 使うより後で宣言している
      const later = M.allNames && M.allNames.get(name);
      if (later !== undefined && later > s) {
        err(s, en, "use-before-decl", `「${name}」を宣言より前で使っている`, `使う前に ${name} を宣言する（宣言の行を上へ）`);
        return;
      }
      if (M.declaredNames.has(name)) {
        err(s, en, "out-of-scope", `「${name}」はこの { } の外では使えない`, `${name} を { } の外（前）で宣言する`);
        return;
      }
      // メソッド名を ( ) なしで使った
      for (const r of M.chain) {
        if (db.findMethods(r.name, name).list.length) {
          err(s, en, "missing-call-paren", `「${name}」はメソッド。( ) が要る`, `${name}() にする`, [{ s: en, e: en, text: "()" }]);
          return;
        }
      }
      const cands = sc.visibleNames();
      for (const r of M.chain) for (const n of db.memberNames(r.name)) cands.push(n);
      const sg = suggest(name, cands);
      if (sg) {
        err(s, en, "undefined-var", `変数「${name}」はない`, sg.caseOnly ? `大文字・小文字がちがう：「${sg.name}」` : `もしかして「${sg.name}」？`, [{ s, e: en, text: sg.name }]);
        return;
      }
      if (/^[A-Z][A-Z0-9_]*$/.test(name) || /^[A-Z]/.test(name)) {
        err(s, en, "undefined-var", `「${name}」が見つからない`, "変数・定数・クラスの名前を確認");
        return;
      }
      if (/^[\p{L}][\p{L}\p{N}]*$/u.test(name) && /[^\x00-\x7f]/.test(name)) {
        err(s, en, "undefined-var", `「${name}」という変数はない`, "文字なら \" \" で囲む。変数なら先に宣言する");
        return;
      }
      err(s, en, "undefined-var", `変数「${name}」はない`, `先に宣言する（例: int ${name} = 0;）`);
    }

    /* ---------- メソッド呼び出し ---------- */
    function argTypes(args, sc, M) {
      return args.map((a) => expr(a, sc, M));
    }

    function call(e, sc, M) {
      if (e.ctorCall) {
        argTypes(e.args, sc, M);
        return null;
      }
      // 受け手
      let recv = null; // { kind, t, name }
      if (e.target) {
        if (e.target.k === "Name" || e.target.k === "Field") {
          e.target.asQualifier = true;
          recv = ref(e.target, sc, M);
          e.target.ty = recv.t || null;
        } else recv = { kind: "value", t: expr(e.target, sc, M) };
      }
      const ats = argTypes(e.args, sc, M);
      let res;
      if (!e.target) res = callUnqualified(e, sc, M, ats);
      else if (recv.kind === "pkg" || recv.kind === "unknown") res = null;
      else if (recv.kind === "type") res = callStatic(e, recv.name, ats, M, recv);
      else res = callOnValue(e, recv.t, ats, M);
      if (recv && recv.kind === "value") e.recvType = recv.t;
      // Scanner の nextInt → nextLine
      if (recv && recv.kind === "value" && recv.t && recv.t.n === "Scanner" && e.target.k === "Name") {
        const key = e.target.name;
        const last = M.scanner.get(key);
        if (e.name === "nextLine" && last && SCANNER_TOKEN.has(last) && !e.discard) {
          warn(e.s, e.e, "nextline-after-nextint", `${last}() のあとの nextLine() は空の行を読む`, `${last}() のあとに ${key}.nextLine(); を1行入れて改行を読み捨てる`);
        }
        M.scanner.set(key, e.name);
      }
      return res;
    }

    function callUnqualified(e, sc, M, ats) {
      const name = e.name;
      let incomplete = false;
      for (let k = 0; k < M.chain.length; k++) {
        const r = M.chain[k];
        const res = db.findMethods(r.name, name);
        if (res.list.length) {
          const avail = availOuter(M);
          if (!avail[k] && res.list.every((m) => !m.static)) {
            const m0 = res.list.find((m) => m.node);
            err(e.nameTok.s, e.nameTok.e, "static-context", `static でない「${name}」を static から呼んでいる`,
              `${name} の宣言に static を付ける`, m0 && m0.node.ret ? [{ s: m0.node.ret.s, e: m0.node.ret.s, text: "static " }] : null);
          }
          return pickMethod(e, res.list, ats, M, null, `${name}`, res.complete);
        }
        if (!res.complete) {
          incomplete = true;
          break;
        }
      }
      if (incomplete) return null;
      for (const si of staticImps) {
        if (si.member === name || si.member === null) {
          const res = db.findMethods(si.cls, name);
          if (res.list.length) return pickMethod(e, res.list.filter((m) => m.static), ats, M, null, name);
          if (!res.complete || si.member === name) return null;
        }
      }
      if (incomplete || unknownStaticStar) return null;
      // 見つからない
      if (/^[A-Z]/.test(name) && (classKnown(name) || Ty.CLASS_PKGS[name])) {
        err(e.s, e.e, "missing-new", `「new」が抜けている`, `new ${name}(…) にする`, [{ s: e.s, e: e.s, text: "new " }]);
        if (!classKnown(name)) reportUnknownType(name, e.nameTok.s, e.nameTok.e);
        return T(name);
      }
      if (name === "println" || name === "print" || name === "printf") {
        err(e.nameTok.s, e.nameTok.e, "missing-system-out", `${name} の前に System.out. が要る`, `System.out.${name}(…) にする`, [{ s: e.s, e: e.s, text: "System.out." }]);
        return Ty.T("void");
      }
      if (M.hasErrors) return null;
      const cands = [];
      for (const r of M.chain) for (const n of db.memberNames(r.name)) cands.push(n);
      const sg = suggest(name, cands);
      err(e.nameTok.s, e.nameTok.e, "undefined-method", `メソッド「${name}」はない`, sg ? `もしかして「${sg.name}」？` : `${name} メソッドを作るか、名前を確認`,
        sg ? [{ s: e.nameTok.s, e: e.nameTok.e, text: sg.name }] : null);
      return null;
    }

    function callStatic(e, cls, ats, M, recv) {
      if (recv.unknownMembers) return null;
      const rec = recOf(cls);
      if (!rec) return null;
      const res = db.findMethods(cls, e.name);
      if (!res.list.length) {
        if (!res.complete) return null;
        noMethod(e, T(cls), true);
        return null;
      }
      const statics = res.list.filter((m) => m.static);
      if (!statics.length) {
        const inside = M.chain.some((r) => r.name === cls) && !M.static;
        if (!inside) {
          err(e.nameTok.s, e.nameTok.e, "static-ref", `「${e.name}」は static ではない`,
            cls === "String" ? `文字列の変数.${e.name}(…) のように使う` : `${cls} のオブジェクトを作って、変数.${e.name}(…) で呼ぶ`);
          return null;
        }
        return pickMethod(e, res.list, ats, M, T(cls), `${cls}.${e.name}`, res.complete);
      }
      return pickMethod(e, statics, ats, M, T(cls), `${cls}.${e.name}`, res.complete);
    }

    function callOnValue(e, t, ats, M) {
      if (!t) return null;
      if (t.n === "null") return null;
      if (Ty.isPrim(t)) {
        let fix = `${str(t)} は値そのもの。メソッドはない`;
        if (e.name === "equals") fix = "数や文字は == で比べる";
        else if (e.name === "length") fix = `桁数なら String.valueOf(${text(e.target)}).length()`;
        else if (e.name === "toString") fix = `String.valueOf(${text(e.target)}) を使う`;
        err(e.target.s, e.nameTok.e, "deref-prim", `${str(t)} に「.」は使えない`, fix,
          e.name === "equals" && e.args.length === 1 ? [{ s: e.target.e, e: e.e, text: ` == ${text(e.args[0])}` }] : null);
        return null;
      }
      if (t.d > 0) {
        if (e.name === "length" || e.name === "size") {
          err(e.nameTok.s, e.e, "array-length", "配列の長さは length（( ) なし）", "length にする", [{ s: e.nameTok.s, e: e.e, text: "length" }]);
          return Ty.INT;
        }
        if (["clone", "getClass", "equals", "hashCode", "toString"].includes(e.name)) return e.name === "clone" ? t : e.name === "equals" ? Ty.BOOLEAN : e.name === "hashCode" ? Ty.INT : e.name === "toString" ? Ty.STRING : T("Class");
        err(e.nameTok.s, e.nameTok.e, "array-member", `配列に「${e.name}」はない`, e.name === "get" ? `${text(e.target)}[番号] で取り出す` : e.name === "add" ? "配列は大きさが決まっている。ArrayList を使う" : "Arrays クラスのメソッドを使う（Arrays.sort など）");
        return null;
      }
      const res = db.findMethods(t.n, e.name);
      if (!res.list.length) {
        if (!res.complete) return null;
        noMethod(e, t, false);
        return null;
      }
      return pickMethod(e, res.list, ats, M, t, `${e.name}`, res.complete);
    }

    function noMethod(e, t, isStatic) {
      const name = e.name;
      const tn = str(t);
      if (Ty.isString(t) && name === "size") {
        err(e.nameTok.s, e.nameTok.e, "no-member", "文字列の長さは length()", "length() にする", [{ s: e.nameTok.s, e: e.nameTok.e, text: "length" }]);
        return;
      }
      if (LIST_LIKE.has(t.n) && name === "length") {
        err(e.nameTok.s, e.nameTok.e, "no-member", "リストの長さは size()", "size() にする", [{ s: e.nameTok.s, e: e.nameTok.e, text: "size" }]);
        return;
      }
      const f = db.findField(t.n, name);
      if (f.field) {
        err(e.nameTok.s, e.e, "field-call", `「${name}」はフィールド。( ) は要らない`, `${name} にする`, [{ s: e.nameTok.e, e: e.e, text: "" }]);
        return;
      }
      const names = [...db.memberNames(t.n, isStatic ? true : undefined)];
      const sg = suggest(name, names);
      err(e.nameTok.s, e.nameTok.e, "no-member", `${tn} に「${name}」はない`, sg ? (sg.caseOnly ? `大文字・小文字：「${sg.name}」` : `もしかして「${sg.name}」？`) : "メソッド名を確認",
        sg ? [{ s: e.nameTok.s, e: e.nameTok.e, text: sg.name }] : null);
    }

    /** オーバーロードから合うものを選び、引数と例外を調べて、戻り値の型を返す */
    function pickMethod(e, list, ats, M, recv, label, complete) {
      const n = ats.length;
      const byArity = list.filter((m) => Ty.arityOk(m, n));
      if (complete === false) {
        // 親クラスにほかの形があるかもしれない
        const ch = mostSpecific(byArity.filter((m) => argsFit(m, ats, e.args) !== false));
        return ch.length ? commonRet(ch, recv) : null;
      }
      if (!byArity.length) {
        const counts = [...new Set(list.map((m) => (m.varargs ? `${m.params.length - 1}個以上` : `${m.params.length}個`)))];
        const one = list.length === 1 && list[0].node ? list[0] : null;
        const sigText = one ? `${e.name}(${one.params.map((p) => (p ? str(p) : "?")).join(", ")})` : label;
        err(e.nameTok.s, e.e, "arg-count", `引数の数がちがう（${sigText} は ${counts.join("か")}、いまは ${n}個）`,
          e.name === "nextInt" || e.name === "nextLine" ? "( ) の中は空にする" : "引数の数を合わせる");
        return commonRet(list, recv);
      }
      // 型の合うもの
      const fits = byArity.filter((m) => argsFit(m, ats, e.args) !== false);
      let chosen = mostSpecific(fits);
      if (!fits.length) {
        if (byArity.length === 1) {
          const m = byArity[0];
          for (let i = 0; i < n; i++) {
            const pt = paramAt(m, i, n);
            if (pt && ats[i] && argOk(pt, ats[i], e.args[i]) === false) {
              argMismatch(e, i, pt, ats[i], m);
              break;
            }
          }
        } else {
          err(e.nameTok.s, e.e, "arg-type", `${label}(${ats.map((t) => (t ? str(t) : "?")).join(", ")}) という呼び方はできない`, "引数の型を確認する");
        }
        chosen = byArity;
      }
      // チェック例外
      if (M.checkExc && !M.lambda && chosen.length) {
        let common = chosen[0].throws || [];
        for (const m of chosen.slice(1)) common = common.filter((x) => (m.throws || []).includes(x));
        for (const ex of common) excCheck(ex, e, M);
      }
      return commonRet(chosen, recv);
    }

    function mostSpecific(list) {
      if (list.length < 2) return list;
      const best = list.filter((m) =>
        list.every((o) => o === m || (m.params.length === o.params.length && m.params.every((p, i) => !p || !o.params[i] || db.assignable(o.params[i], p) !== false)))
      );
      return best.length === 1 ? best : list;
    }

    function paramAt(m, i, n) {
      if (m.varargs && i >= m.params.length - 1) {
        const last = m.params[m.params.length - 1];
        if (!last) return null;
        // 配列そのものを渡すこともできる
        if (n === m.params.length) return null;
        return Ty.elem(last);
      }
      return m.params[i];
    }
    function argOk(pt, at, argNode) {
      if (!pt || !at) return null;
      if (argNode && (argNode.k === "Lambda" || argNode.k === "MethodRef")) return null;
      // 型変数（T, E など）
      if (/^[A-Z]$/.test(pt.n)) return pt.d === 0 || at.d >= pt.d || at.n === "null" ? null : false;
      return db.assignable(pt, at, undefined);
    }
    function argsFit(m, ats, args) {
      let res = true;
      for (let i = 0; i < ats.length; i++) {
        const pt = paramAt(m, i, ats.length);
        const ok = argOk(pt, ats[i], args[i]);
        if (ok === false) return false;
        if (ok === null) res = null;
      }
      return res;
    }
    function argMismatch(e, i, pt, at, m) {
      const a = e.args[i];
      const nth = `${i + 1}つ目の引数`;
      if (Ty.isString(at) && Ty.numLike(pt)) {
        err(a.s, a.e, "arg-type", `${nth}は ${str(pt)} が要る（いまは String）`, `Integer.parseInt(…) で数にする`);
      } else if (Ty.numLike(at) && Ty.isString(pt)) {
        err(a.s, a.e, "arg-type", `${nth}は String が要る（いまは ${str(at)}）`, `String.valueOf(…) で文字列にする`, [{ s: a.s, e: a.s, text: "String.valueOf(" }, { s: a.e, e: a.e, text: ")" }]);
      } else if (Ty.numLike(at) && Ty.numLike(pt)) {
        err(a.s, a.e, "arg-type", `${nth}は ${str(pt)} が要る（いまは ${str(at)}）`, `(${str(pt)}) を付けて変換する`, [{ s: a.s, e: a.s, text: `(${str(pt)}) ` }]);
      } else {
        err(a.s, a.e, "arg-type", `${nth}は ${str(pt)} が要る（いまは ${str(at)}）`, m.node ? `${e.name}(${m.params.map((p) => (p ? str(p) : "?")).join(", ")}) に合わせる` : "引数の型を確認する");
      }
    }
    function commonRet(list, recv) {
      if (!list.length) return null;
      const rets = list.map((m) => (m.user === false || !m.node ? substRet(m, recv) : m.ret));
      const r0 = rets[0];
      if (!r0) return null;
      for (const r of rets) if (!r || !Ty.same(r, r0)) return null;
      return r0;
    }

    function excCheck(exName, node, M) {
      if (!exName || !M.checkExc || M.lambda) return;
      const checked = Ty.isChecked(exName, user);
      if (checked !== true) return;
      for (const list of M.tryStack) for (const c of list) if (Ty.excIsA(exName, c, user) !== false) return;
      for (const t of M.throws) if (Ty.excIsA(exName, t, user) !== false) return;
      let edits = null;
      const m = M.node;
      if (m && m.body && !M.init) {
        if (m.throws.length) edits = [{ s: m.throws[m.throws.length - 1].e, e: m.throws[m.throws.length - 1].e, text: `, ${exName}` }];
        else {
          const before = src.slice(0, m.body.s);
          const ws = before.match(/\s*$/)[0].length;
          edits = [{ s: m.body.s - ws, e: m.body.s - ws, text: ` throws ${exName}` }];
        }
      }
      err(node.s, node.e, "unreported-exception", `${exName} の対処が要る`, `try { … } catch (${exName} e) { … } で囲むか、メソッドに throws ${exName} を付ける`, edits);
    }

    function newObj(e, sc, M, expected) {
      const tv = M.mtv || tvarsOf(M.rec);
      const t = typeOf(e.type, tv);
      if (e.outer) expr(e.outer, sc, M);
      const ats = argTypes(e.args, sc, M);
      if (!t) return null;
      const rec = recOf(t.n);
      if (e.body) {
        const ar = e.body.rec || collect(e.body, M.rec, { local: true, inStatic: M.static });
        e.body.rec = ar;
        registerAll(ar);
        walkClass(ar, sc, M);
        return t;
      }
      if (!rec) return t;
      if (rec.kind === "interface") {
        const impl = INTERFACE_IMPL[t.n];
        err(e.type.s, e.type.e, "new-interface", `${t.n} はインタフェースなので new できない`, impl ? `new ${impl}<>() にする` : `${t.n} を実装したクラスを new する`,
          impl ? [{ s: e.type.s, e: e.type.s + t.n.length, text: impl }] : null);
        return t;
      }
      const chainComplete = M.chain.every((r) => r.complete);
      if (rec.kind === "abstract" && (chainComplete || !rec.outer)) {
        err(e.type.s, e.type.e, "new-abstract", `${t.n} は abstract クラスなので new できない`, "それを継承したクラスを new する");
        return t;
      }
      if (rec.kind === "enum") {
        err(e.type.s, e.type.e, "new-enum", "enum は new できない", `${t.n}.定数名 で使う`);
        return t;
      }
      // static でない内部クラスを static から new
      if (rec.user && rec.outer && !rec.isStaticNested && !rec.local && !e.outer) {
        const k = M.chain.indexOf(rec.outer);
        const avail = availOuter(M);
        if (k === 0 && !avail[k] && chainComplete) {
          err(e.type.s, e.type.e, "inner-new-static", `${t.n} は static でない内部クラス`, `class ${t.n} を static class ${t.n} にするか、${rec.outer.name} の外に出す`,
            [{ s: rec.node.s, e: rec.node.s, text: "static " }]);
        }
      }
      if (!e.noParen) checkCtorArgs(rec, e.args, e.type, sc, M, ats, e);
      return t;
    }

    function checkCtorArgs(rec, args, at, sc, M, ats, node) {
      if (!rec || !rec.ctors) return;
      if (!ats) ats = args.map((a) => a.ty || null);
      const n = ats.length;
      const ctors = rec.ctors.filter((c) => !c.private || topOf(rec) === topOf(M.rec) || !rec.user);
      if (!ctors.length) return;
      const byArity = ctors.filter((c) => Ty.arityOk(c, n));
      if (!byArity.length) {
        const counts = [...new Set(ctors.map((c) => (c.varargs ? `${c.params.length - 1}個以上` : `${c.params.length}個`)))];
        let fix = "引数の数を合わせる";
        if (rec.name === "Scanner") fix = "new Scanner(System.in) にする";
        else if (rec.user && ctors.length === 1 && ctors[0].auto && n > 0) fix = `${rec.name} にコンストラクタを作るか、( ) を空にする`;
        err(at.s, (node || at).e, "arg-count", `${rec.name} を作る引数の数がちがう（${counts.join("か")}、いまは ${n}個）`, fix,
          rec.name === "Scanner" && n === 0 && node ? [{ s: node.e - 1, e: node.e - 1, text: "System.in" }] : null);
        return;
      }
      const fits = byArity.filter((c) => argsFit(c, ats, args) !== false);
      if (!fits.length && byArity.length === 1) {
        const c = byArity[0];
        for (let i = 0; i < n; i++) {
          const pt = paramAt(c, i, n);
          if (pt && ats[i] && argOk(pt, ats[i], args[i]) === false) {
            argMismatch({ args, name: rec.name, nameTok: at }, i, pt, ats[i], c);
            break;
          }
        }
      }
      const chosen = fits.length ? fits : byArity;
      if (M.checkExc && !M.lambda && node) {
        let common = chosen[0].throws || [];
        for (const c of chosen.slice(1)) common = common.filter((x) => (c.throws || []).includes(x));
        for (const ex of common) excCheck(ex, node, M);
      }
    }

    function castCheck(ct, xt, e) {
      if (!ct || !xt) return;
      if (xt.n === "null") {
        if (Ty.isPrim(ct)) err(e.s, e.e, "bad-cast", `null は (${str(ct)}) にできない`, "参照型にする");
        return;
      }
      if (Ty.isString(xt) && Ty.isPrim(ct) && Ty.isNumeric(ct)) {
        const conv = ct.n === "double" ? "Double.parseDouble" : ct.n === "long" ? "Long.parseLong" : "Integer.parseInt";
        err(e.s, e.e, "bad-cast", `文字列は (${ct.n}) で数にできない`, `${conv}(…) を使う`, [{ s: e.s, e: e.expr.s, text: `${conv}(` }, { s: e.expr.e, e: e.expr.e, text: ")" }]);
        return;
      }
      if (Ty.isString(ct) && (Ty.isPrim(xt) || Ty.UNBOX[xt.n])) {
        err(e.s, e.e, "bad-cast", `${str(xt)} は (String) で文字列にできない`, "String.valueOf(…) を使う", [{ s: e.s, e: e.expr.s, text: "String.valueOf(" }, { s: e.expr.e, e: e.expr.e, text: ")" }]);
        return;
      }
      if (Ty.isPrim(ct) && Ty.isPrim(xt)) {
        if ((ct.n === "boolean") !== (xt.n === "boolean")) err(e.s, e.e, "bad-cast", `${str(xt)} は (${ct.n}) にできない`, "true / false と数は変換できない");
        return;
      }
      if (Ty.isPrim(ct) && !Ty.isPrim(xt)) {
        const u = Ty.unboxed(xt);
        if (Ty.isPrim(u) && (ct.n === "boolean") !== (u.n === "boolean")) err(e.s, e.e, "bad-cast", `${str(xt)} は (${ct.n}) にできない`, "型を確認する");
        return;
      }
      const FINALS = new Set(["String", "Integer", "Double", "Long", "Boolean", "Character", "Float", "Short", "Byte"]);
      if (ct.d === 0 && xt.d === 0 && FINALS.has(ct.n) && FINALS.has(xt.n) && ct.n !== xt.n) {
        err(e.s, e.e, "bad-cast", `${xt.n} は (${ct.n}) にできない`, Ty.isString(ct) ? "String.valueOf(…) を使う" : Ty.isString(xt) ? `${ct.n}.valueOf(…) か parse メソッドを使う` : "型を確認する");
      }
    }

    function indexRangeCheck(e, sc) {
      void sc;
      const v = e.arr.k === "Name" ? e.arr.ref : null;
      if (!v || v.arrLen === undefined || v.arrLen === null || v.reassigned) return;
      const idx = constIntOf(e.index);
      if (idx !== null && (idx < 0 || idx >= v.arrLen)) {
        warn(e.index.s, e.index.e, "index-out", `番号 ${idx} は範囲外（${v.name} は 0〜${v.arrLen - 1}）`, "実行するとエラーになる。番号を確認");
      } else if (e.index.k === "Field" && e.index.name === "length" && e.index.target.k === "Name" && e.index.target.name === v.name) {
        warn(e.index.s, e.index.e, "index-out", `${v.name}[${v.name}.length] は範囲外`, `最後の要素は ${v.name}[${v.name}.length - 1]`);
      }
    }

    function unary(e, sc, M) {
      if (e.op === "-" && e.expr.k === "Literal") e.expr.negated = true;
      const t = expr(e.expr, sc, M);
      if (!t) return null;
      switch (e.op) {
        case "!":
          if (!Ty.boolLike(t)) err(e.s, e.e, "bad-operand", `「!」は true / false にだけ使える（いまは ${str(t)}）`, Ty.numLike(t) ? "x != 0 のような比較にする" : "boolean の値に使う");
          return Ty.BOOLEAN;
        case "-":
        case "+":
          if (!Ty.numLike(t)) {
            err(e.s, e.e, "bad-operand", `「${e.op}」は数にだけ使える（いまは ${str(t)}）`, "数の値に使う");
            return null;
          }
          return Ty.promote(t, Ty.INT);
        case "~":
          if (!Ty.isIntegral(Ty.unboxed(t))) err(e.s, e.e, "bad-operand", "「~」は整数にだけ使える", "整数の値に使う");
          return Ty.promote(t, Ty.INT);
        case "++":
        case "--": {
          if (!["Name", "Field", "Index", "Paren", "Error"].includes(e.expr.k)) {
            err(e.s, e.e, "bad-operand", `「${e.op}」は変数にだけ使える`, `変数に ${e.op} を付ける`);
            return t;
          }
          if (!Ty.numLike(t)) err(e.s, e.e, "bad-operand", `「${e.op}」は数の変数にだけ使える（いまは ${str(t)}）`, "int などの変数に使う");
          finalAssignCheck(e.expr, M);
          markAssigned(e.expr);
          return t;
        }
      }
      return t;
    }

    function binary(e, sc, M) {
      const lt = expr(e.l, sc, M);
      const rt = expr(e.r, sc, M);
      e.lt = lt;
      e.rt = rt;
      const op = e.op;
      const opEnd = e.opS + op.length;
      const bad = (msg, fix, edits) => err(e.opS, opEnd, "bad-operand", msg, fix, edits);
      switch (op) {
        case "+":
          if (Ty.isString(lt) || Ty.isString(rt)) {
            if ((lt && lt.n === "void") || (rt && rt.n === "void")) bad("void（値を返さないメソッド）はつなげられない", "戻り値のあるメソッドにする");
            return Ty.STRING;
          }
          if (!lt || !rt) return null;
          if (Ty.numLike(lt) && Ty.numLike(rt)) return Ty.promote(lt, rt);
          bad(`「+」は ${str(lt)} と ${str(rt)} に使えない`, Ty.boolLike(lt) || Ty.boolLike(rt) ? "true / false は足し算できない" : "数どうし、または文字列とつなげる");
          return null;
        case "-":
        case "*":
        case "/":
        case "%": {
          if (!lt || !rt) return op === "/" || op === "%" ? divZero(e, lt, rt) : null;
          if (Ty.numLike(lt) && Ty.numLike(rt)) {
            divZero(e, lt, rt);
            return Ty.promote(lt, rt);
          }
          if (Ty.isString(lt) || Ty.isString(rt)) {
            if (op === "*" && Ty.isString(lt) && Ty.numLike(rt)) bad("文字列に「*」は使えない", `くり返すなら ${text(e.l)}.repeat(${text(e.r)})`);
            else if (op === "-" && (Ty.isString(lt) || Ty.isString(rt))) bad("文字列に「-」は使えない", Ty.isString(lt) && Ty.isString(rt) ? "文字を消すなら replace(…) を使う" : "数にするなら Integer.parseInt(…)");
            else bad(`文字列に「${op}」は使えない`, "数にするなら Integer.parseInt(…) で変換する");
            return null;
          }
          bad(`「${op}」は ${str(lt)} と ${str(rt)} に使えない`, "数どうしで計算する");
          return null;
        }
        case "<":
        case ">":
        case "<=":
        case ">=":
          if (e.l.k === "Binary" && ["<", ">", "<=", ">="].includes(e.l.op)) {
            const mid = text(e.l.r);
            err(e.s, e.e, "chained-compare", `「${text(e)}」とは書けない`, `${text(e.l)} && ${mid} ${op} ${text(e.r)} にする`, [{ s: e.l.e, e: e.l.e, text: ` && ${mid}` }]);
            return Ty.BOOLEAN;
          }
          if (!lt || !rt) return Ty.BOOLEAN;
          if (Ty.numLike(lt) && Ty.numLike(rt)) return Ty.BOOLEAN;
          if (Ty.isString(lt) && Ty.isString(rt)) bad(`文字列は「${op}」で比べられない`, `${text(e.l)}.compareTo(${text(e.r)}) ${op} 0 にする`);
          else bad(`「${op}」は ${str(lt)} と ${str(rt)} に使えない`, Ty.isString(lt) || Ty.isString(rt) ? "数にするなら Integer.parseInt(…)" : "数どうしで比べる");
          return Ty.BOOLEAN;
        case "==":
        case "!=": {
          if (!lt || !rt) return Ty.BOOLEAN;
          if (!db.comparable(lt, rt)) {
            let fix = "同じ種類の値どうしで比べる";
            if ((Ty.isString(lt) && rt.n === "char") || (Ty.isString(rt) && lt.n === "char")) {
              const ch = Ty.isString(lt) ? e.l : e.r;
              fix = ch.k === "Literal" && ch.type === "String" && /^"(.|\\.)"$/.test(ch.raw) ? `'${ch.raw.slice(1, -1)}' と ' で囲む（char どうし）` : "char どうし（'a'）か、String どうしで比べる";
            } else if (Ty.isString(lt) || Ty.isString(rt)) fix = "数なら Integer.parseInt(…)、文字列なら equals(…) で比べる";
            else if (lt.n === "null" || rt.n === "null") fix = `${str(Ty.isPrim(lt) ? lt : rt)} は null にならない。比べなくてよい`;
            err(e.opS, opEnd, "incomparable", `${str(lt)} と ${str(rt)} は比べられない`, fix);
            return Ty.BOOLEAN;
          }
          if (Ty.isString(lt) && Ty.isString(rt) && e.l.k !== "Literal" || (Ty.isString(lt) && Ty.isString(rt) && e.r.k !== "Literal")) {
            const not = op === "!=" ? "!" : "";
            warn(e.s, e.e, "string-eq", `文字列の比較は ${op} ではなく equals`, `${not}${text(e.l)}.equals(${text(e.r)}) にする`, [{ s: e.s, e: e.e, text: `${not}${text(e.l)}.equals(${text(e.r)})` }]);
          }
          return Ty.BOOLEAN;
        }
        case "&&":
        case "||":
          for (const [x, xt] of [[e.l, lt], [e.r, rt]]) {
            if (xt && !Ty.boolLike(xt)) err(x.s, x.e, "bad-operand", `「${op}」の両側は true / false（いまは ${str(xt)}）`, Ty.numLike(xt) ? `例: ${text(x)} > 0` : "比較の式にする");
          }
          return Ty.BOOLEAN;
        case "&":
        case "|":
        case "^":
          if (!lt || !rt) return null;
          if (Ty.boolLike(lt) && Ty.boolLike(rt)) return Ty.BOOLEAN;
          if (Ty.isIntegral(Ty.unboxed(lt)) && Ty.isIntegral(Ty.unboxed(rt))) return Ty.promote(lt, rt);
          bad(`「${op}」は ${str(lt)} と ${str(rt)} に使えない`, op === "^" ? "べき乗なら Math.pow(a, b) を使う" : "true / false どうし、整数どうしで使う");
          return null;
        case "<<":
        case ">>":
        case ">>>":
          if (!lt || !rt) return null;
          if (Ty.isIntegral(Ty.unboxed(lt)) && Ty.isIntegral(Ty.unboxed(rt))) return Ty.promote(lt, Ty.INT);
          bad(`「${op}」は整数にだけ使える`, "整数の値に使う");
          return null;
      }
      return null;
    }

    function divZero(e, lt, rt) {
      if ((e.op === "/" || e.op === "%") && constIntOf(e.r) === 0 && e.r.k === "Literal" && (!lt || Ty.isIntegral(Ty.unboxed(lt)))) {
        warn(e.r.s, e.r.e, "div-zero", "0 で割っている（実行時エラー）", "割る数を 0 以外にする");
      }
      return null;
    }

    function finalAssignCheck(target, M) {
      const x = target.k === "Paren" ? target.expr : target;
      const v = x.k === "Name" ? x.ref : x.k === "Field" && x.target.k === "This" ? (M.rec.fields.get(x.name) || null) : null;
      if (!v || !v.final) return;
      if (v.kind === "field") {
        if (!v.hasInit && (M.ctor || M.init) && M.rec.fields.get(v.name) === v) return;
        if (Ty.UNBOX[v.name]) return;
      } else if (!v.hasInit && v.kind === "local") return;
      err(x.s, x.e, "final-assign", `「${v.name}」は final なので変更できない`, v.kind === "field" ? "final を外すか、別の変数を使う" : "final を外すか、別の変数を使う");
    }
    function markAssigned(target) {
      const x = target.k === "Paren" ? target.expr : target;
      if (x.k === "Name" && x.ref && x.ref.arrLen !== undefined) x.ref.reassigned = true;
    }

    function assign(e, sc, M) {
      const tt = expr(e.target, sc, M);
      const vt = expr(e.value, sc, M, tt);
      if (e.op === "=" && (src[e.opS + 1] === "+" || src[e.opS + 1] === "-") && /\s/.test(src[e.opS - 1] || "") && /\s/.test(src[e.opS + 2] || "") && tt && Ty.numLike(tt)) {
        const op = src[e.opS + 1];
        warn(e.opS, e.opS + 2, "eq-plus", `「=${op}」は「${op}=」のまちがい？`, `${op === "+" ? "足す" : "引く"}なら ${op}= にする（=${op} は値を入れ直すだけ）`, [{ s: e.opS, e: e.opS + 2, text: `${op}=` }]);
      }
      if (e.op === "=" && e.target.k === "Name" && e.value.k === "Name" && e.target.name === e.value.name && e.target.ref && e.target.ref === e.value.ref) {
        const f = M.rec.fields.get(e.target.name);
        warn(e.s, e.e, "self-assign", `「${e.target.name}」を自分自身に入れている（変わらない）`,
          f && e.target.ref.kind !== "field" ? `フィールドに入れるなら this.${e.target.name} = ${e.target.name}; にする` : "代入する先を確認",
          f && e.target.ref.kind !== "field" ? [{ s: e.target.s, e: e.target.s, text: "this." }] : null);
      }
      finalAssignCheck(e.target, M);
      if (e.op === "=") markAssigned(e.target);
      if (!tt) return null;
      if (e.op === "=") {
        if (e.value.k === "ArrayInit") return tt;
        if (vt) assignCheck(tt, vt, e.value, "assign");
        intDivisionHint(tt, e.value, sc, M);
        return tt;
      }
      if (!vt) return tt;
      if (e.op === "+=" && Ty.isString(tt)) return tt;
      if (["+=", "-=", "*=", "/=", "%="].includes(e.op)) {
        if (Ty.numLike(tt) && Ty.numLike(vt)) return tt;
        err(e.opS, e.opS + e.op.length, "bad-operand", `「${e.op}」は ${str(tt)} と ${str(vt)} に使えない`, Ty.isString(vt) ? "数にするなら Integer.parseInt(…)" : "数どうしで計算する");
        return tt;
      }
      return tt;
    }

    /* ------------------------------------------------------------------ */
    /* 流れの解析：値が入っていない変数・return 忘れ・届かない文             */
    /* ------------------------------------------------------------------ */
    const ALL = "ALL";
    const inter = (a, b) => {
      if (a === ALL) return b;
      if (b === ALL) return a;
      const out = new Set();
      for (const x of a) if (b.has(x)) out.add(x);
      return out;
    };
    const withVar = (s, id) => {
      if (s === ALL) return ALL;
      const n = new Set(s);
      n.add(id);
      return n;
    };
    const union = (a, b) => {
      if (a === ALL || b === ALL) return ALL;
      const n = new Set(a);
      for (const x of b) n.add(x);
      return n;
    };

    function flowMethod(m, M) {
      if (M.hasErrors) return;
      const F = { M, uncertain: false, reports: [], uninitReported: new Set(), targets: [], tracked: new Set() };
      // 値なしで宣言されたローカル変数だけ追いかける
      for (const v of M.locals) if (v.kind === "local" && !v.hasInit) F.tracked.add(v.id);
      const out = fStmt(m.body, { reach: true, da: new Set() }, F);
      if (F.uncertain) {
        // 定数の条件などで判断しきれないときは、値なしの変数のエラーだけ出す
        for (const r of F.reports) if (r.kind === "uninit") err(r.s, r.e, r.id, r.msg, r.fix);
        return;
      }
      for (const r of F.reports) (r.sev === "warn" ? warn : err)(r.s, r.e, r.id, r.msg, r.fix, r.edits);
      if (m.ret && m.ret.unknown) return;
      if (out.reach && !m.ctor && m.ret && !(m.ret.name === "void" && m.ret.dims === 0) && M.ret !== null) {
        const close = m.body.closeS != null ? m.body.closeS : m.body.e - 1;
        err(close, close + 1, "missing-return", "最後に return がない", `メソッドの終わりで return 値; を書く（${str(M.ret)} 型）`);
      } else if (out.reach && !m.ctor && m.ret && m.ret.name !== "void" && M.ret === null) {
        const close = m.body.closeS != null ? m.body.closeS : m.body.e - 1;
        err(close, close + 1, "missing-return", "最後に return がない", "メソッドの終わりで return 値; を書く");
      }
    }

    function isConstTrue(e) {
      if (!e) return true;
      const x = e.k === "Paren" ? e.expr : e;
      return x.k === "Literal" && x.raw === "true";
    }
    function maybeConst(e, F) {
      // final 変数だけの条件は定数かもしれない（判断しきれない）
      let onlyConst = true;
      let hasName = false;
      walkAst(e, (x) => {
        if (x.k === "Name") {
          hasName = true;
          if (!(x.ref && x.ref.final)) onlyConst = false;
        } else if (x.k === "Call" || x.k === "New" || x.k === "Index" || x.k === "Assign" || x.k === "Field") onlyConst = false;
        return undefined;
      });
      if (onlyConst && (hasName || e.k !== "Literal")) F.uncertain = true;
    }

    function fCond(e, da, F) {
      if (!e) return { t: da, f: ALL };
      const x = e.k === "Paren" ? e.expr : e;
      if (x.k === "Literal" && x.type === "boolean") return x.raw === "true" ? { t: da, f: ALL } : { t: ALL, f: da };
      if (x.k === "Unary" && x.op === "!") {
        const r = fCond(x.expr, da, F);
        return { t: r.f, f: r.t };
      }
      if (x.k === "Binary" && x.op === "&&") {
        const a = fCond(x.l, da, F);
        const b = fCond(x.r, a.t, F);
        return { t: b.t, f: inter(a.f, b.f) };
      }
      if (x.k === "Binary" && x.op === "||") {
        const a = fCond(x.l, da, F);
        const b = fCond(x.r, a.f, F);
        return { t: inter(a.t, b.t), f: b.f };
      }
      maybeConst(x, F);
      const s = fExpr(x, da, F);
      return { t: s, f: s };
    }

    function fExpr(e, da, F) {
      if (!e || da === ALL) {
        if (e && da === ALL) return ALL;
        return da;
      }
      switch (e.k) {
        case "Name":
          if (e.ref && F.tracked.has(e.ref.id) && !da.has(e.ref.id) && !F.uninitReported.has(e.ref.id)) {
            F.uninitReported.add(e.ref.id);
            F.reports.push({ kind: "uninit", s: e.s, e: e.e, id: "uninit", msg: `「${e.name}」に値が入っていない`, fix: `宣言のときに値を入れる（例: ${e.ref.type ? str(e.ref.type) : "int"} ${e.name} = 0;）` });
          }
          return da;
        case "Assign": {
          const tgt = e.target.k === "Paren" ? e.target.expr : e.target;
          if (tgt.k === "Name") {
            if (e.op !== "=") da = fExpr(tgt, da, F);
            da = fExpr(e.value, da, F);
            if (tgt.ref && F.tracked.has(tgt.ref.id)) da = withVar(da, tgt.ref.id);
            return da;
          }
          da = fExpr(e.target, da, F);
          return fExpr(e.value, da, F);
        }
        case "Binary":
          if (e.op === "&&" || e.op === "||") {
            const c = fCond(e, da, F);
            return inter(c.t, c.f);
          }
          return fExpr(e.r, fExpr(e.l, da, F), F);
        case "Cond": {
          const c = fCond(e.cond, da, F);
          return inter(fExpr(e.a, c.t, F), fExpr(e.b, c.f, F));
        }
        case "Unary":
          if (e.op === "!") {
            const c = fCond(e, da, F);
            return inter(c.t, c.f);
          }
          return fExpr(e.expr, da, F);
        case "Lambda": {
          // ラムダの中で外の変数を使うときも、値が入っている必要がある
          if (e.body.k === "Block") {
            const saved = F.targets;
            F.targets = [];
            const savedR = F.reports.length;
            fStmt(e.body, { reach: true, da }, F);
            // ラムダの中の return 忘れや届かない文はここでは扱わない
            F.reports = F.reports.filter((r, i) => i < savedR || r.kind === "uninit");
            F.targets = saved;
          } else fExpr(e.body, da, F);
          return da;
        }
        case "New":
          if (e.outer) da = fExpr(e.outer, da, F);
          for (const a of e.args) da = fExpr(a, da, F);
          return da;
        case "SwitchExpr": {
          const r = fSwitch(e, { reach: true, da }, F, true);
          return r.da;
        }
        case "Call":
          if (e.target) da = fExpr(e.target, da, F);
          for (const a of e.args) da = fExpr(a, da, F);
          return da;
        case "Field":
          return fExpr(e.target, da, F);
        case "Index":
          return fExpr(e.index, fExpr(e.arr, da, F), F);
        case "Paren":
          return fExpr(e.expr, da, F);
        case "Cast":
          return fExpr(e.expr, da, F);
        case "InstanceOf":
          return fExpr(e.expr, da, F);
        case "NewArray":
          for (const d of e.dims) if (d) da = fExpr(d, da, F);
          if (e.init) da = fExpr(e.init, da, F);
          return da;
        case "ArrayInit":
          for (const x of e.elems) da = fExpr(x, da, F);
          return da;
        case "MethodRef":
          return e.target ? fExpr(e.target, da, F) : da;
        default:
          return da;
      }
    }

    const DEAD = { reach: false, da: ALL };

    function fBlock(stmts, st, F) {
      let cur = st;
      let reported = false;
      const startReach = st.reach;
      for (const s of stmts) {
        if (!cur.reach && !reported && s.k !== "Empty" && s.k !== "LocalClass") {
          reported = true;
          F.reports.push({ s: s.s, e: Math.min(s.e, src.indexOf("\n", s.s) > 0 ? src.indexOf("\n", s.s) : s.e), id: "unreachable", msg: "この文には絶対に来ない", fix: "前の return / break / continue のあとに文は書けない。消すか位置を変える" });
          cur = { reach: true, da: cur.da };
        }
        cur = fStmt(s, cur, F);
      }
      if (reported && startReach) return { reach: false, da: ALL };
      return cur;
    }

    function fStmt(s, st, F) {
      if (!s) return st;
      const da = st.da;
      switch (s.k) {
        case "Block":
          return fBlock(s.stmts, st, F);
        case "Local": {
          let d = da;
          for (const v of s.vars) {
            if (v.init) {
              d = fExpr(v.init, d, F);
              if (v.info && F.tracked.has(v.info.id)) d = withVar(d, v.info.id);
            }
          }
          return { reach: st.reach, da: d };
        }
        case "ExprStmt":
          return { reach: st.reach, da: fExpr(s.expr, da, F) };
        case "If": {
          const c = fCond(s.cond, da, F);
          const a = fStmt(s.then, { reach: true, da: c.t }, F);
          if (!s.els) return { reach: st.reach, da: inter(a.reach ? a.da : ALL, c.f) };
          const b = fStmt(s.els, { reach: true, da: c.f }, F);
          return { reach: st.reach && (a.reach || b.reach), da: inter(a.reach ? a.da : ALL, b.reach ? b.da : ALL) };
        }
        case "While": {
          const c = fCond(s.cond, da, F);
          const tgt = { kind: "loop", label: s.label, breaks: [], conts: [] };
          F.targets.push(tgt);
          fStmt(s.body, { reach: true, da: c.t }, F);
          F.targets.pop();
          const inf = isConstTrue(s.cond);
          let out = inf ? ALL : c.f;
          for (const b of tgt.breaks) out = inter(out, b);
          return { reach: st.reach && (!inf || tgt.breaks.length > 0), da: out };
        }
        case "DoWhile": {
          const tgt = { kind: "loop", label: s.label, breaks: [], conts: [] };
          F.targets.push(tgt);
          const b = fStmt(s.body, { reach: true, da }, F);
          F.targets.pop();
          let beforeCond = b.reach ? b.da : ALL;
          for (const c of tgt.conts) beforeCond = inter(beforeCond, c);
          const condReach = b.reach || tgt.conts.length > 0;
          const c = fCond(s.cond, beforeCond, F);
          const inf = isConstTrue(s.cond);
          let out = inf ? ALL : c.f;
          for (const x of tgt.breaks) out = inter(out, x);
          return { reach: st.reach && ((condReach && !inf) || tgt.breaks.length > 0), da: out };
        }
        case "For": {
          let d = da;
          for (const i of s.init) d = fStmt(i, { reach: true, da: d }, F).da;
          const c = s.cond ? fCond(s.cond, d, F) : { t: d, f: ALL };
          const tgt = { kind: "loop", label: s.label, breaks: [], conts: [] };
          F.targets.push(tgt);
          const b = fStmt(s.body, { reach: true, da: c.t }, F);
          F.targets.pop();
          let ud = b.reach ? b.da : ALL;
          for (const x of tgt.conts) ud = inter(ud, x);
          for (const u of s.update) fStmt(u, { reach: true, da: ud === ALL ? c.t : ud }, F);
          const inf = !s.cond || isConstTrue(s.cond);
          if (s.broken) return { reach: true, da: d };
          let out = inf ? ALL : c.f;
          for (const x of tgt.breaks) out = inter(out, x);
          return { reach: st.reach && (!inf || tgt.breaks.length > 0), da: out };
        }
        case "ForEach": {
          const d = fExpr(s.iter, da, F);
          const tgt = { kind: "loop", label: s.label, breaks: [], conts: [] };
          F.targets.push(tgt);
          fStmt(s.body, { reach: true, da: d }, F);
          F.targets.pop();
          let out = d;
          for (const x of tgt.breaks) out = inter(out, x);
          return { reach: st.reach, da: out };
        }
        case "Labeled": {
          const inner = s.stmt;
          if (inner && (inner.k === "While" || inner.k === "DoWhile" || inner.k === "For" || inner.k === "ForEach")) inner.label = s.label;
          const tgt = { kind: "label", label: s.label, breaks: [], conts: [] };
          F.targets.push(tgt);
          const r = fStmt(inner, st, F);
          F.targets.pop();
          let out = r.reach ? r.da : ALL;
          for (const x of tgt.breaks) out = inter(out, x);
          return { reach: r.reach || tgt.breaks.length > 0, da: out };
        }
        case "Switch":
          return fSwitch(s, st, F, false);
        case "Return":
          if (s.expr) fExpr(s.expr, da, F);
          return DEAD;
        case "Throw":
          fExpr(s.expr, da, F);
          return DEAD;
        case "Yield":
          fExpr(s.expr, da, F);
          for (let i = F.targets.length - 1; i >= 0; i--) {
            if (F.targets[i].kind === "switchExpr") {
              F.targets[i].yields.push(da);
              break;
            }
          }
          return DEAD;
        case "Break": {
          let tgt = null;
          for (let i = F.targets.length - 1; i >= 0; i--) {
            const t = F.targets[i];
            if (s.label ? t.label === s.label && (t.kind === "label" || t.kind === "loop") : t.kind === "loop" || t.kind === "switch") {
              tgt = t;
              break;
            }
            if (!s.label && t.kind === "switchExpr") break;
          }
          if (!tgt) {
            if (s.label) F.reports.push({ s: s.s, e: s.e, id: "bad-label", msg: `ラベル「${s.label}」がない`, fix: "ラベル名を確認" });
            else F.reports.push({ s: s.s, e: s.e, id: "break-outside", msg: "break は for / while / switch の中だけ", fix: "break を消すか、ループの中に移す" });
            return DEAD;
          }
          if (tgt.kind === "label" && s.label) {
            // ラベル付きのループに対する break
            for (let i = F.targets.length - 1; i >= 0; i--) if (F.targets[i].label === s.label && F.targets[i].kind === "loop") { F.targets[i].breaks.push(da); return DEAD; }
          }
          tgt.breaks.push(da);
          return DEAD;
        }
        case "Continue": {
          let tgt = null;
          for (let i = F.targets.length - 1; i >= 0; i--) {
            const t = F.targets[i];
            if (t.kind === "loop" && (!s.label || t.label === s.label)) {
              tgt = t;
              break;
            }
          }
          if (!tgt) {
            F.reports.push({ s: s.s, e: s.e, id: "continue-outside", msg: "continue はループの中だけ", fix: "continue を消すか、for / while の中に移す" });
            return DEAD;
          }
          tgt.conts.push(da);
          return DEAD;
        }
        case "Try": {
          let d = da;
          for (const r of s.res) d = fStmt(r, { reach: true, da: d }, F).da;
          const tb = fStmt(s.block, { reach: true, da: d }, F);
          let out = tb.reach ? tb.da : ALL;
          let reach = tb.reach;
          for (const c of s.catches) {
            const cb = fStmt(c.body, { reach: true, da }, F);
            out = inter(out, cb.reach ? cb.da : ALL);
            reach = reach || cb.reach;
          }
          if (s.fin) {
            const fb = fStmt(s.fin, { reach: true, da }, F);
            if (!fb.reach) return DEAD;
            out = union(out, fb.da === ALL ? new Set() : fb.da);
          }
          return { reach: st.reach && reach, da: reach ? out : ALL };
        }
        case "Sync":
          return fStmt(s.body, { reach: st.reach, da: fExpr(s.lock, da, F) }, F);
        case "Assert":
          fCond(s.cond, da, F);
          return st;
        case "Error":
          F.uncertain = true;
          return { reach: st.reach, da: ALL };
        default:
          return st;
      }
    }

    function fSwitch(s, st, F, isExpr) {
      const d0 = fExpr(s.sel, st.da, F);
      const tgt = { kind: isExpr ? "switchExpr" : "switch", breaks: [], conts: [], yields: [] };
      F.targets.push(tgt);
      const hasDefault = s.cases.some((c) => c.isDefault);
      const hasPattern = s.cases.some((c) => c.labels.some((l) => l.k === "Pattern" || l.k === "RecordPattern" || (l.k === "Literal" && l.type === "null")));
      if (hasPattern && !hasDefault) F.uncertain = true;
      let out = ALL;
      let anyReach = false;
      let prev = null;
      for (const c of s.cases) {
        let entry = d0;
        if (!s.arrow && prev && prev.reach) entry = inter(d0, prev.da);
        if (c.guard) entry = fCond(c.guard, entry, F).t;
        let r;
        if (s.arrow) {
          const b = c.body[0];
          if (b && b.k === "ExprStmt" && b.arrowExpr) {
            r = { reach: true, da: fExpr(b.expr, entry, F) };
            if (isExpr) {
              tgt.yields.push(r.da);
              r = DEAD;
            }
          } else r = fBlock(c.body, { reach: true, da: entry }, F);
          if (r.reach) {
            anyReach = true;
            out = inter(out, r.da);
          }
        } else {
          r = fBlock(c.body, { reach: true, da: entry }, F);
        }
        prev = r;
      }
      F.targets.pop();
      if (isExpr) {
        let o = ALL;
        for (const y of tgt.yields) o = inter(o, y);
        return { reach: st.reach, da: o === ALL ? d0 : o };
      }
      if (!s.arrow) {
        if (prev && prev.reach) {
          anyReach = true;
          out = inter(out, prev.da);
        }
        if (!s.cases.length) anyReach = true;
      }
      for (const b of tgt.breaks) out = inter(out, b);
      if (!hasDefault) out = inter(out, d0);
      const reach = st.reach && (anyReach || tgt.breaks.length > 0 || !hasDefault);
      return { reach, da: reach ? out : ALL };
    }

    /* ---------- ファイル全体 ---------- */
    function fileChecks() {
      const base = (opts.fileName || "Main.java").replace(/^.*[\\/]/, "").replace(/\.java$/i, "");
      let publics = 0;
      for (const c of unit.types) {
        if (!c.mods.list.includes("public")) continue;
        publics++;
        if (publics > 1) {
          err(c.nameTok.s, c.nameTok.e, "multi-public", "public class は1つのファイルに1つだけ", `public を外すか、別のファイル（${c.name}.java）に分ける`);
          continue;
        }
        if (c.name !== base && base) {
          err(c.nameTok.s, c.nameTok.e, "public-class-name", `public class の名前がファイル名（${base}.java）とちがう`, `クラス名を ${base} にするか、ファイル名を ${c.name}.java にする`, [{ s: c.nameTok.s, e: c.nameTok.e, text: base }]);
        }
      }
      // main メソッドの形
      for (const c of unit.types) {
        for (const m of c.members) {
          if (m.k !== "Method" || m.name !== "main" || m.ctor) continue;
          const mods = m.mods.list;
          const p = m.params;
          const okParams = p.length === 1 && p[0].type.name === "String" && p[0].type.dims === 1;
          const okRet = m.ret && m.ret.name === "void" && m.ret.dims === 0;
          if (mods.includes("public") && mods.includes("static") && okParams && okRet) continue;
          if (c.kind !== "class") continue;
          let fix = "public static void main(String[] args) にする";
          if (!mods.includes("static")) fix = "static を付ける：public static void main(String[] args)";
          else if (!okRet) fix = "戻り値は void：public static void main(String[] args)";
          else if (!okParams) fix = "引数は String[] args：public static void main(String[] args)";
          warn(m.nameTok.s, m.nameTok.e, "main-signature", "main の形がちがう（このままでは実行できない）", fix);
        }
      }
    }

    /* ---------- 実行 ---------- */
    // いつも例外を投げるメソッド（while (true) の出口の判定に使う）
    for (const r of allRecs) {
      for (const m of r.node.members) {
        if (m.k === "Method" && m.body && m.body.stmts.length && m.body.stmts[m.body.stmts.length - 1].k === "Throw") neverReturns.add(m.name);
      }
    }
    fileChecks();
    for (const c of unit.types) {
      try {
        walkClass(c.rec, null, null);
      } catch (e) {
        if (opts.debug) throw e;
      }
    }
  }

  /** AST をたどる。fn が false を返したら、その下には入らない。d はループ・switch の深さ */
  function walkAst(n, fn, depth) {
    const seenNodes = new Set();
    (function go(x, d) {
      if (!x || typeof x !== "object" || seenNodes.has(x)) return;
      if (Array.isArray(x)) {
        for (const y of x) go(y, d);
        return;
      }
      seenNodes.add(x);
      if (x.k && fn(x, d) === false) return;
      const nd = x.k === "While" || x.k === "DoWhile" || x.k === "For" || x.k === "ForEach" || x.k === "Switch" ? d + 1 : d;
      for (const key in x) {
        if (key === "ref" || key === "ty" || key === "info" || key === "rec" || key === "lt" || key === "rt" || key === "recvType" || key === "nameTok" || key === "tok") continue;
        const v = x[key];
        if (v && typeof v === "object") go(v, nd);
      }
    })(n, depth || 0);
  }

  const api = { check, editDistance, suggest };
  if (isNode) module.exports = api;
  else root.JavaChecker = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
