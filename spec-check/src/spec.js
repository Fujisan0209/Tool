/*
 * 仕様書（Markdown / テキスト）を読んで、「仕様に書かれている項目」の一覧を作ります。
 *
 * 読み取れる書き方:
 *   - 見出し        ### calcTotal(price: int, qty: int): int / ## Order クラス / ## 定数
 *   - 表            | 引数 | 型 | 必須 | ... / | メソッド | パス | ... / | 定数名 | 値 |
 *   - 箇条書き      - price (int, 必須): 単価 / - `MAX_ITEMS`: 100
 *   - ラベル        引数: price (int), qty (int) / 戻り値: int
 *   - 文中          `calcTotal(price, qty)` / GET /api/orders/{id} / `MAX_ITEMS` は 100
 *   - コードブロック ```java ... ```（中の宣言を、コードと同じように読む）
 *
 * SpecModel: { funcs, types, consts, endpoints, valueLists, mentions, words, lines }
 *   どの項目にも line（仕様書の行番号）と strong（はっきり書かれているか）が付きます。
 */
(function (root) {
  "use strict";

  const node = typeof module !== "undefined" && module.exports;
  const { parseType, normName, splitTop, IDENT } = node ? require("./common.js") : root.SpecCheckCommon;
  const { parseCode, detectLang } = node ? require("./code.js") : root.SpecCheckCode;

  // ---------------------------------------------------------------- 言葉の辞書

  const RE = {
    params: /^(?:引数|パラメ[ーｰ]?タ|入力(?:値|パラメ[ーｰ]?タ)?|リクエストパラメ[ーｰ]?タ|parameters?|params|arguments?|args|inputs?)(?:一覧|リスト|の一覧)?$/i,
    returns: /^(?:戻り値|返り値|返却値|戻値|出力|returns?|return\s*values?|outputs?|レスポンス)(?:の型)?$/i,
    fields: /^(?:フィールド|プロパティ|属性|メンバ(?:変数)?|項目|カラム|fields?|properties|attributes|members|columns?)(?:一覧|定義|の一覧)?$/i,
    consts: /^(?:定数|設定値|設定|固定値|constants?|config(?:uration)?|settings?)(?:一覧|定義|の一覧)?$/i,
    values: /^(?:取りうる値|取り得る値|値の一覧|値一覧|列挙値|列挙子|区分値|values?|enum\s*values?)$/i,
    funcs: /^(?:メソッド|関数|機能|操作|methods?|functions?|operations?)(?:一覧|定義|の一覧)?$/i,
    endpoints: /(?:API一覧|エンドポイント|endpoints?|routes?|ルーティング|API\s*仕様|REST\s*API)/i,
  };
  const KW_ENUM = /(?:列挙型?|enum|区分)/i;
  const KW_TYPE = /(?:クラス|class|インター?フェ[ーｰ]?ス|interface|モデル|model|エンティティ|entity|レコード|record|構造体|struct|dto|データ型|型定義|\s型$|の型$)/i;
  const KW_FUNC = /(?:メソッド|関数|function|method|処理|操作)/i;
  const STOP = new Set([
    "API", "HTTP", "HTTPS", "JSON", "XML", "CSV", "URL", "URI", "ID", "DB", "UI", "UX", "REST", "SQL", "HTML", "CSS",
    "GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "OK", "NG", "TODO", "FAQ", "README", "Overview",
    "Usage", "Introduction", "Summary", "Example", "Examples", "Notes", "Note", "Changelog", "Appendix", "Version",
    "Spec", "Specification", "Requirements", "Design", "Index", "Contents", "Background", "Scope", "Glossary",
    "Errors", "Error", "Response", "Request", "Status", "Description", "Details", "Java", "Python", "TypeScript",
    "JavaScript", "Node", "Spring", "Express", "FastAPI", "Flask", "v1", "v2", "v3", "Ver", "No", "N/A", "null",
    "true", "false", "None", "void", "and", "or", "the", "a", "an", "of", "to", "in", "for", "with", "is", "on",
  ]);
  const HTTP = /\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+`?(\/[^\s`"'）)、。,]*)/g;
  const REQ_YES = /^(?:○|◯|〇|●|✓|✔|yes|y|true|必須|required|mandatory|要|必要)$/i;
  const REQ_NO = /^(?:×|✕|✗|-|－|―|ー|no|n|false|任意|optional|省略可|不要|オプション)$/i;
  const DEFAULT_RE = /(?:デフォルト(?:値)?|既定値?|初期値|default)\s*(?:[:：=]|は)?\s*`?([^\s`、。,;)）]+)`?/i;
  const MODS = new Set(["public", "private", "protected", "static", "final", "abstract", "async", "export", "def", "function", "synchronized", "default", "fun", "func", "fn"]);

  const isPascalHump = (s) => /^[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]*)+$/.test(s);
  const isCamelHump = (s) => /^[a-z][a-z0-9]*(?:[A-Z][a-z0-9]*)+$/.test(s);
  const isSnake = (s) => /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/.test(s);
  const isUpper = (s) => /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/.test(s) && /[A-Z]/.test(s);

  const nfkc = (s) => String(s).normalize("NFKC");
  const unBacktick = (s) => String(s).replace(/`/g, "").trim();

  /** 型らしい文字列か */
  function looksLikeType(s) {
    const x = unBacktick(s).replace(/[。、.,;]$/, "");
    if (!x || x.length > 60) return false;
    if (/\s/.test(x) && !/[<[|(]/.test(x)) return false;
    const t = parseType(x, "spec");
    if (!t) return false;
    if (t.coarse !== "other") return true;
    return /^[A-Z][\w$.]*(?:<.*>)?(?:\[\])*\??$/.test(x) || /^(?:['"].*['"]\s*\|\s*)+['"].*['"]$/.test(x);
  }

  /** 文字列の中の (...) の対応する ) の位置 */
  function closeAt(s, open) {
    let d = 0;
    for (let i = open; i < s.length; i++) {
      const c = s[i];
      if (c === "(" || c === "[" || c === "{" || c === "<") d++;
      else if (c === ")" || c === "]" || c === "}" || c === ">") {
        d--;
        if (d === 0) return c === ")" ? i : -1;
      }
    }
    return -1;
  }

  const LITERAL = /^(?:-?\d[\d_,.]*[a-z]?|"[^"]*"|'[^']*'|「[^」]*」|true|false|null|none|nil|undefined)$/i;

  /** 「a: int, b: str = 'x'」「int a, int b」「a, b」を引数の配列に。呼び出し例なら callish */
  function parseParamsLoose(str) {
    const s = nfkc(str).trim();
    if (!s) return { params: [], callish: false };
    const parts = splitTop(s.replace(/、/g, ","), ",");
    const params = [];
    let callish = false;
    for (let p of parts) {
      p = unBacktick(p);
      if (/^(?:self|cls|this)$/.test(p)) continue;
      if (/^\*$|^\/$/.test(p)) continue;
      if (LITERAL.test(p) || /[+*%!]|\(\)|\bnew\b|^\w+\.\w+$/.test(p.replace(/^\*{1,2}/, ""))) { callish = true; continue; }
      let m = p.match(/^(\.\.\.|\*{1,2})?([A-Za-z_$][\w$]*)(\?)?\s*:\s*([^=]+?)\s*(?:=\s*(.+))?$/);
      if (m) {
        params.push({ name: m[2], type: m[4].trim(), default: m[5] !== undefined ? m[5].trim() : null, required: m[3] || m[5] !== undefined ? false : null, variadic: !!m[1] });
        continue;
      }
      m = p.match(/^([A-Za-z_$][\w$]*)\s*\(([^)]*)\)$/);
      if (m) {
        const info = parenInfo(m[2]);
        params.push({ name: m[1], type: info.type, default: info.default, required: info.required, variadic: false });
        continue;
      }
      m = p.match(/^(?:@\w+\s+)*(?:final\s+)?([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*(?:<.*>)?(?:\[\])*)(\.\.\.)?\s+([A-Za-z_$][\w$]*)\s*(?:=\s*(.+))?$/);
      if (m) {
        params.push({ name: m[3], type: m[1] + (m[2] ? "[]" : ""), default: m[4] ? m[4].trim() : null, required: null, variadic: !!m[2] });
        continue;
      }
      m = p.match(/^(\.\.\.|\*{1,2})?([A-Za-z_$][\w$]*)(\?)?\s*(?:=\s*(.+))?$/);
      if (m) {
        params.push({ name: m[2], type: null, default: m[4] ? m[4].trim() : null, required: m[3] || m[4] ? false : null, variadic: !!m[1] });
        continue;
      }
      callish = true;
    }
    return { params, callish };
  }

  /** (int, 必須, デフォルト 1) のような かっこの中身 */
  function parenInfo(inner) {
    let type = null;
    let required = null;
    let def = null;
    for (const part of nfkc(inner).split(/[,、/／]/)) {
      const x = part.trim();
      if (!x) continue;
      const d = x.match(DEFAULT_RE);
      if (d) { def = d[1]; required = false; continue; }
      if (REQ_YES.test(x)) { required = true; continue; }
      if (REQ_NO.test(x) && x !== "-") { required = false; continue; }
      if (!type && looksLikeType(x)) type = unBacktick(x);
    }
    return { type, required, default: def };
  }

  /**
   * 文中のシグネチャを探す。 calcTotal(price: int): int / int calcTotal(int a) / Order.save(o) -> bool
   * 戻り値: [{ name, owner, params|null, returns|null, callish }]
   */
  function findSignatures(text) {
    const s = nfkc(text);
    const out = [];
    const re = /(?:([A-Za-z_$][\w$]*)\s*(?:\.|#|::)\s*)?([A-Za-z_$][\w$]*)\s*\(/g;
    let m;
    while ((m = re.exec(s))) {
      const open = m.index + m[0].length - 1;
      const close = closeAt(s, open);
      if (close < 0) continue;
      const name = m[2];
      if (MODS.has(name) || /^(?:if|for|while|switch|catch|return|new|super|this|print|println|printf|console|e\.g|i\.e)$/i.test(name)) continue;
      const before = s.slice(0, m.index);
      // 直前が英字・数字につながっているもの（例: abc_def(）は除く
      if (/[\w$]$/.test(before)) continue;
      const argStr = s.slice(open + 1, close);
      const { params, callish } = parseParamsLoose(argStr);
      let returns = null;
      const after = s.slice(close + 1);
      const rm = after.match(/^\s*(?::|->|→|=>|：)\s*`?([A-Za-z_$぀-ヿ一-鿿][\w$.]*(?:<[^>]*>|\[[^\]]*\])?(?:\[\])*\??(?:\s*\|\s*[A-Za-z_$][\w$.]*(?:<[^>]*>)?(?:\[\])*)*)`?/);
      if (rm && looksLikeType(rm[1])) returns = rm[1].trim();
      if (!returns) {
        const bm = before.match(/(?:^|[\s`(（:：])((?:(?:public|private|protected|static|final|abstract|synchronized|default)\s+)*)([A-Za-z_$][\w$.]*(?:<[^()]*>)?(?:\[\])*)\s+$/);
        if (bm && !MODS.has(bm[2]) && !/^(?:def|function|fun|func|async|new|return|await|is|the|a|an|to|of|and|or)$/i.test(bm[2]) && (bm[1] || /^[a-z]+$|^[A-Z]/.test(bm[2])) && looksLikeType(bm[2])) {
          const beforeType = before.slice(0, before.length - bm[0].length + (bm[0].length - bm[0].trimStart().length));
          if (!/[A-Za-z0-9_]$/.test(beforeType)) returns = bm[2];
        }
      }
      out.push({ name, owner: m[1] && !/^(?:this|self)$/.test(m[1]) ? m[1] : null, params: argStr.trim() === "" ? [] : params, returns, callish, emptyParens: argStr.trim() === "" });
      re.lastIndex = close + 1;
    }
    return out;
  }

  /** 箇条書き1つを「名前 + 型 + 必須 + デフォルト」として読む */
  function parseLooseItem(body) {
    const s = nfkc(body).trim();
    const m = s.match(/^\**`?([A-Za-z_$][\w$]*)(\?)?`?\**\s*(.*)$/);
    if (!m) return null;
    const name = m[1];
    let rest = m[3];
    let type = null;
    let required = m[2] ? false : null;
    let def = null;
    let value = null;
    let typed = false;
    if (rest.startsWith("(")) {
      const c = closeAt(rest, 0);
      const info = parenInfo(c > 0 ? rest.slice(1, c) : rest.slice(1));
      type = info.type;
      if (info.required !== null) required = info.required;
      def = info.default;
      typed = !!type;
      rest = c > 0 ? rest.slice(c + 1) : "";
      rest = rest.replace(/^\s*[:：\-–—]\s*/, "");
    } else if (/^[:：]/.test(rest)) {
      const after = rest.slice(1).trim();
      const tok = after.match(/^`([^`]+)`|^([^\s、。,（(]+)/);
      if (tok) {
        const cand = tok[1] || tok[2];
        if (looksLikeType(cand)) { type = cand.trim(); typed = true; }
        else if (LITERAL.test(cand.replace(/[,]/g, ""))) value = cand;
      }
      rest = after;
    } else if (/^=/.test(rest)) {
      const tok = rest.slice(1).trim().match(/^`([^`]+)`|^([^\s、。,（(]+)/);
      if (tok) value = tok[1] || tok[2];
    } else if (/^[-–—]/.test(rest)) {
      const after = rest.replace(/^[-–—]+\s*/, "");
      const tok = after.match(/^`([^`]+)`|^([^\s、。,（(]+)/);
      if (tok && looksLikeType(tok[1] || tok[2])) { type = (tok[1] || tok[2]).trim(); typed = true; }
      rest = after;
    } else if (rest && !/^[\s（(]/.test(rest)) return null;
    else if (/^\s*[（(]/.test(rest)) return parseLooseItem(name + rest.trim());
    if (required === null && /(?:必須|required|mandatory)/i.test(rest)) required = true;
    if (required === null && /(?:任意|省略可|optional)/i.test(rest)) required = false;
    const d = rest.match(DEFAULT_RE);
    if (d && !def) { def = d[1]; if (required === null) required = false; }
    return { name, type, required, default: def, value, typed, rest };
  }

  /** 表の1行を | で分ける（`a | b` の中は分けない） */
  function splitRow(line) {
    let s = line.trim();
    if (s.startsWith("|")) s = s.slice(1);
    if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
    const cells = [];
    let cur = "";
    let tick = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === "\\" && s[i + 1] === "|") { cur += "|"; i++; continue; }
      if (c === "`") tick = !tick;
      if (c === "|" && !tick) { cells.push(cur.trim()); cur = ""; continue; }
      cur += c;
    }
    cells.push(cur.trim());
    return cells;
  }

  function headerRole(h, hasPath) {
    const x = nfkc(h).replace(/[*`_]/g, "").trim().toLowerCase();
    if (!x) return { role: "none" };
    if (/^(?:http\s*)?(?:メソッド|method|verb|動詞)$/.test(x) && hasPath) return { role: "http" };
    if (/(?:パス|path|url|uri|エンドポイント|endpoint|ルート|route)/.test(x)) return { role: "path" };
    if (/(?:シグネチャ|signature|宣言|定義)/.test(x)) return { role: "sig" };
    if (/(?:戻り値|返り値|返却値|returns?|戻値)/.test(x)) return { role: "ret" };
    if (/(?:デフォルト|既定値|初期値|default)/.test(x)) return { role: "default" };
    if (/(?:必須|required|省略|任意|optional|nullable|null許容)/.test(x)) return { role: "req", invert: /(?:省略|任意|optional|nullable|null許容)/.test(x) };
    if (/(?:論理名|日本語名|和名|表示名|説明|備考|概要|description|note|comment|remarks?)/.test(x)) return { role: "none" };
    if (/(?:型|^type$|データ型|^types?$|形式)/.test(x)) return { role: "type" };
    if (/^(?:値|設定値|value|内容|定数値)$/.test(x)) return { role: "value" };
    if (/(?:物理名|英名|変数名|識別子|プロパティ名|フィールド名|カラム名|^key$|キー|physical|^id$|identifier)/.test(x)) return { role: "name", kind: null, prio: 4 };
    if (/(?:引数|パラメ[ーｰ]?タ|params?|parameters?|arguments?)/.test(x)) return { role: "params" };
    if (/(?:列挙子|列挙値|enum|コード値|区分値|取りうる値)/.test(x)) return { role: "name", kind: "values", prio: 3 };
    if (/(?:定数|constant)/.test(x)) return { role: "name", kind: "consts", prio: 3 };
    if (/(?:メソッド|関数|method|function|api名|操作)/.test(x)) return { role: "name", kind: "funcs", prio: 3 };
    if (/(?:フィールド|プロパティ|属性|項目|カラム|列名|member|field|property|attribute|column)/.test(x)) return { role: "name", kind: "fields", prio: 2 };
    if (/(?:名前|名称|^name$|^names?$)/.test(x)) return { role: "name", kind: null, prio: 1 };
    return { role: "none" };
  }

  function cleanIdent(cell) {
    const s = nfkc(cell).replace(/\*\*/g, "").replace(/`/g, "").trim().replace(/\?$/, "").replace(/\(\)$/, "").trim();
    return IDENT.test(s) ? s : null;
  }

  // ================================================================ 本体

  function parseSpec(text) {
    const src = String(text || "").replace(/\r\n?/g, "\n");
    const lines = src.split("\n");
    const S = { funcs: [], types: [], consts: [], endpoints: [], valueLists: [], mentions: [], words: new Set(), lines };
    const stack = [];
    let fence = null;
    let table = null;
    let lastFunc = null;
    let lastType = null;
    let lineCtx = null; // 「引数:」のあとの箇条書きなど

    const lineText = (ln) => (lines[ln - 1] || "").trim();

    function nearest(key) {
      for (let i = stack.length - 1; i >= 0; i--) if (stack[i][key]) return stack[i][key];
      return null;
    }
    function ctxNow() {
      if (lineCtx) return lineCtx;
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].ctx) return stack[i].ctx;
        if (stack[i].func || stack[i].type) return null;
      }
      return null;
    }
    /** いまの節の主役（関数か型か） */
    function ownerNow() {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].func) return { func: stack[i].func };
        if (stack[i].type) return { type: stack[i].type };
      }
      return null;
    }
    const targetFunc = () => lastFunc || nearest("func");
    const targetType = () => lastType || nearest("type");

    function addFunc(sig, line, strong, src) {
      const owner = sig.owner || (nearest("type") ? nearest("type").name : null);
      const f = {
        kind: "func", name: sig.name, owner, params: sig.params === undefined ? null : sig.params,
        returns: sig.returns || null, line, strong, src, lines: [line], ownerExplicit: !!sig.owner,
      };
      S.funcs.push(f);
      return f;
    }
    function addType(name, kind, line, strong) {
      const t = { kind: "type", name, typeKind: kind, fields: null, values: kind === "enum" ? [] : null, line, strong, lines: [line] };
      S.types.push(t);
      return t;
    }
    function addConst(name, value, line, strong) {
      if (S.consts.some((c) => c.name === name && c.line === line)) return;
      S.consts.push({ kind: "const", name, value, line, strong, lines: [line] });
    }
    function addEndpoint(method, path, line) {
      const p = path.replace(/[.。,、:：;]+$/, "");
      if (!p.startsWith("/")) return;
      if (S.endpoints.some((e) => e.method === method && e.path === p && e.line === line)) return;
      S.endpoints.push({ kind: "endpoint", method, path: p, line, strong: true, lines: [line] });
    }
    function pushParam(f, p, line) {
      if (!f) return;
      if (!f.params) f.params = [];
      const ex = f.params.find((x) => x.name === p.name);
      if (ex) {
        if (!ex.type && p.type) ex.type = p.type;
        if (ex.default == null && p.default != null) ex.default = p.default;
        if (ex.required == null && p.required != null) ex.required = p.required;
        return;
      }
      f.params.push({ name: p.name, type: p.type || null, default: p.default ?? null, required: p.required ?? null, line });
      if (!f.lines.includes(line)) f.lines.push(line);
    }
    function pushField(t, p, line) {
      if (!t) return;
      if (!t.fields) t.fields = [];
      if (t.fields.some((x) => x.name === p.name)) return;
      t.fields.push({ name: p.name, type: p.type || null, default: p.default ?? null, required: p.required ?? null, line });
    }
    function pushValue(t, name, line) {
      if (!t) return;
      if (!t.values) t.values = [];
      if (!t.values.some((v) => v.name === name)) t.values.push({ name, line });
    }

    // -------------------------------------------------- 見出し
    function heading(level, rawText, L) {
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      lastFunc = null;
      lastType = null;
      lineCtx = null;
      const entry = { level, func: null, type: null, ctx: null };
      let t = nfkc(rawText).replace(/^(?:\d+(?:\.\d+)*\.?|第\s*\d+\s*[章節項]|[(]\d+[)]|[A-Z]\.)\s*/, "").replace(/\*\*/g, "").trim();
      const plain = unBacktick(t);
      for (const k of ["params", "returns", "fields", "consts", "values", "funcs"]) if (RE[k].test(plain)) entry.ctx = k;
      if (!entry.ctx && RE.endpoints.test(plain) && !/[A-Z]{3,}\s+\//.test(plain)) entry.ctx = "endpoints";
      if (entry.ctx) { stack.push(entry); return; }

      HTTP.lastIndex = 0;
      let em;
      let hasEp = false;
      while ((em = HTTP.exec(t))) { addEndpoint(em[1], em[2], L); hasEp = true; }
      if (hasEp) { stack.push(entry); return; }

      const sigs = findSignatures(t).filter((x) => !x.callish);
      if (sigs.length) {
        const sg = sigs[0];
        entry.func = addFunc({ ...sg, params: sg.emptyParens && !/[:：→]|->/.test(t.slice(t.indexOf(sg.name))) ? null : sg.params }, L, true, "heading");
        if (sg.emptyParens) entry.func.emptyParens = true;
        stack.push(entry);
        return;
      }
      // 識別子を探す
      const ticks = [...t.matchAll(/`([^`]+)`/g)].map((x) => x[1].trim()).filter((x) => IDENT.test(x));
      const rawIds = (t.match(/[A-Za-z_$][\w$]*/g) || []).filter((w) => w.length > 1);
      const explicit = KW_ENUM.test(t) || KW_TYPE.test(t) || KW_FUNC.test(t);
      let words = ticks.length ? ticks : rawIds.filter((w) => !STOP.has(w));
      // 「Status 列挙型」のように種類がはっきり書かれていれば、よくある単語でも名前として読む
      if (!words.length && explicit) words = rawIds.filter((w) => !/^(?:API|HTTP|JSON|XML|ID|URL|DB|REST|class|enum|interface|model|record|struct|dto|function|method)$/i.test(w));
      const name = words[0];
      if (name) {
        const strongTick = ticks.length > 0;
        if (KW_ENUM.test(t)) entry.type = addType(name, "enum", L, true);
        else if (KW_TYPE.test(t)) entry.type = addType(name, "class", L, true);
        else if (KW_FUNC.test(t) && !/^[A-Z]/.test(name)) entry.func = addFunc({ name, params: null }, L, true, "heading");
        else if (isCamelHump(name) || isSnake(name)) entry.func = addFunc({ name, params: null }, L, strongTick || true, "heading");
        else if (isPascalHump(name)) entry.type = addType(name, "class", L, true);
        else if (/^[A-Z][a-z0-9]+$/.test(name) && words.length === 1 && plain === name) entry.type = addType(name, "class", L, strongTick);
        else if (strongTick && /^[a-z]/.test(name)) entry.func = addFunc({ name, params: null }, L, true, "heading");
        else if (strongTick && /^[A-Z]/.test(name) && !isUpper(name)) entry.type = addType(name, "class", L, true);
      }
      stack.push(entry);
    }

    // -------------------------------------------------- 表
    function flushTable() {
      if (!table) return;
      const t = table;
      table = null;
      const rows = t.rows;
      const sepIdx = rows.findIndex((r) => r.cells.every((c) => /^:?-{2,}:?$/.test(c.replace(/\s/g, "")) || c === ""));
      if (sepIdx !== 1) {
        for (const r of rows) prose(r.cells.join(" "), r.line, true);
        return;
      }
      const header = rows[0].cells;
      const hasPath = header.some((h) => headerRole(h, false).role === "path");
      const roles = header.map((h) => headerRole(h, hasPath));
      const col = (role) => roles.findIndex((r) => r.role === role);
      let nameCol = -1;
      let best = 0;
      roles.forEach((r, i) => { if (r.role === "name" && r.prio > best) { best = r.prio; nameCol = i; } });
      const cPath = col("path"), cHttp = col("http"), cSig = col("sig"), cRet = col("ret"), cType = col("type");
      const cDef = col("default"), cVal = col("value"), cReq = col("req"), cParams = col("params");
      if (nameCol < 0 && cParams >= 0 && cSig < 0) nameCol = cParams;
      const nameRole = nameCol >= 0 ? roles[nameCol] : null;

      let kind = null;
      if (cPath >= 0) kind = "endpoints";
      else if (cSig >= 0) kind = "sigs";
      else if (nameCol >= 0 && nameCol === cParams) kind = "params";
      else if (nameRole && nameRole.kind) kind = nameRole.kind;
      if (!kind || (nameRole && !nameRole.kind && kind !== "params")) {
        const c = ctxNow();
        const ow = ownerNow();
        if (c && c !== "endpoints" && c !== "returns") kind = c;
        else if (cParams >= 0 || cRet >= 0) kind = "funcs";
        else if (ow && ow.func) kind = "params";
        else if (ow && ow.type) kind = ow.type.typeKind === "enum" ? "values" : "fields";
        else if (cVal >= 0) kind = "consts";
      }
      if (!kind) {
        for (const r of rows.slice(2)) prose(r.cells.join(" "), r.line, true);
        return;
      }
      const tf = targetFunc();
      const tt = targetType();
      for (const r of rows.slice(2)) {
        const cells = r.cells;
        const L = r.line;
        const cell = (i) => (i >= 0 && i < cells.length ? cells[i] : "");
        mentionsIn(cells.join(" "), L);
        if (kind === "endpoints") {
          const path = unBacktick(cell(cPath)).split(/\s+/).find((x) => x.startsWith("/")) || "";
          const ms = nfkc(cell(cHttp) || cell(cPath)).toUpperCase().match(/\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g) || ["ANY"];
          for (const m of ms) addEndpoint(m, path, L);
          continue;
        }
        if (kind === "sigs") {
          for (const sg of findSignatures(cell(cSig))) if (!sg.callish) {
            const f = addFunc(sg, L, true, "table");
            if (!f.returns && cRet >= 0 && looksLikeType(cell(cRet))) f.returns = unBacktick(cell(cRet));
          }
          continue;
        }
        let nameCell = cell(nameCol >= 0 ? nameCol : 0);
        if (/\(/.test(nameCell) && (kind === "funcs" || kind === "params" || nameCol < 0)) {
          const sg = findSignatures(nameCell).filter((x) => !x.callish)[0];
          if (sg) {
            const f = addFunc(sg, L, true, "table");
            if (!f.returns && cRet >= 0 && looksLikeType(cell(cRet))) f.returns = unBacktick(cell(cRet));
            continue;
          }
        }
        const name = cleanIdent(nameCell);
        if (!name) continue;
        const type = cType >= 0 && looksLikeType(cell(cType)) ? unBacktick(cell(cType)) : null;
        let required = null;
        if (cReq >= 0) {
          const v = nfkc(cell(cReq)).trim();
          if (REQ_YES.test(v)) required = !roles[cReq].invert;
          else if (REQ_NO.test(v) && v) required = !!roles[cReq].invert;
        }
        let def = cDef >= 0 ? unBacktick(cell(cDef)) : null;
        if (def && /^(?:-|－|―|ー|なし|無し|none)$/i.test(def)) def = null;
        if (kind === "funcs") {
          const pr = cParams >= 0 && cParams !== nameCol ? cell(cParams) : null;
          let params = null;
          if (pr !== null) {
            const v = nfkc(pr).trim();
            if (/^(?:なし|無し|none|-|－|―|ー|\(\))$/i.test(v)) params = [];
            else {
              const pl = parseParamsLoose(v.replace(/^\((.*)\)$/, "$1"));
              if (!pl.callish) params = pl.params;
            }
          }
          const rv = cRet >= 0 ? nfkc(cell(cRet)).trim() : "";
          let returns = null;
          if (rv) {
            const tok = (rv.match(/^`([^`]+)`/) || rv.match(/^([^\s（(、。]+)/) || [])[1];
            if (tok && looksLikeType(tok)) returns = tok.trim();
          }
          addFunc({ name, params, returns }, L, true, "table");
        } else if (kind === "params") {
          pushParam(tf, { name, type, required, default: def }, L);
        } else if (kind === "fields") {
          pushField(tt, { name, type, required, default: def }, L);
        } else if (kind === "consts") {
          const v = cVal >= 0 ? cell(cVal) : cDef >= 0 ? cell(cDef) : "";
          addConst(name, constValue(v), L, true);
        } else if (kind === "values") {
          if (tt) pushValue(tt, name, L);
          else {
            const last = S.valueLists[S.valueLists.length - 1];
            if (last && last.table === t) last.names.push(name);
            else S.valueLists.push({ names: [name], line: L, table: t, lines: [L] });
          }
        }
      }
    }

    function constValue(v) {
      const s = nfkc(v).trim();
      if (!s) return null;
      const tick = s.match(/^`([^`]+)`/);
      if (tick) return tick[1];
      const m = s.match(/^(-?[\d][\d_,]*(?:\.\d+)?(?:e[-+]?\d+)?[lLfFdD]?|"[^"]*"|'[^']*'|「[^」]*」|true|false)/i);
      return m ? m[1] : s.split(/\s/)[0];
    }

    // -------------------------------------------------- 文中の名前
    function mentionsIn(text, L) {
      for (const m of String(text).matchAll(/`([^`\n]+)`/g)) {
        let x = nfkc(m[1]).trim().replace(/\(\)$/, "");
        if (/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(x)) S.mentions.push({ name: x.split(".").pop(), full: x, line: L });
      }
    }

    // -------------------------------------------------- 1行の文
    function prose(rawLine, L, fromTable) {
      const n = nfkc(rawLine);
      const t = n.trim();
      if (!t) { lineCtx = null; return; }
      const bm = t.match(/^(?:[-*+・•]|\d+[.)]|[(]\d+[)]|[①-⑳])\s+(.*)$/) || t.match(/^[・•]\s*(.*)$/);
      const isBullet = !!bm;
      let body = bm ? bm[1] : t;
      const indent = rawLine.match(/^\s*/)[0].length;
      if (!isBullet && lineCtx && !/^[【\[]/.test(body)) lineCtx = null;

      mentionsIn(n, L);

      // エンドポイント
      HTTP.lastIndex = 0;
      let em;
      while ((em = HTTP.exec(n))) addEndpoint(em[1], em[2], L);

      // 【引数】 / 引数: ... / Returns: ...
      const lab = body.match(/^\**[【\[]?([^\]】:：*]{1,24}?)[】\]]?\**\s*(?:[:：]|(?<=[】\]])\s*)\s*(.*)$/);
      if (lab) {
        const key = lab[1].trim().replace(/`/g, "");
        const rest = lab[2].trim();
        if (RE.params.test(key)) {
          const f = targetFunc();
          if (!rest) { lineCtx = "params"; return; }
          if (/^(?:なし|無し|none|-|－|ー|―|\(\))(?:\s|。|$)/i.test(rest)) { if (f) f.params = f.params && f.params.length ? f.params : []; return; }
          const pl = parseParamsLoose(rest.replace(/[。]$/, "").replace(/^\((.*)\)$/, "$1"));
          if (!pl.callish) for (const p of pl.params) pushParam(f, p, L);
          return;
        }
        if (RE.returns.test(key)) {
          const f = targetFunc();
          if (!rest) { lineCtx = "returns"; return; }
          if (/^(?:なし|無し|none|void|-|－|ー|―)(?:\s|。|$|（|\()/i.test(rest)) { if (f) f.returns = "void"; return; }
          const tok = (rest.match(/^`([^`]+)`/) || rest.match(/^([^\s（(、。,]+)/) || [])[1];
          if (f && tok && looksLikeType(tok)) f.returns = tok.trim();
          else if (f) {
            const inner = rest.match(/[（(]([^)）]+)[)）]/);
            if (inner && looksLikeType(inner[1])) f.returns = inner[1].trim();
          }
          return;
        }
        if (RE.fields.test(key) && !rest) { lineCtx = "fields"; return; }
        if (RE.consts.test(key) && !rest) { lineCtx = "consts"; return; }
        if (RE.values.test(key)) {
          if (!rest) { lineCtx = "values"; return; }
          const vs = [...rest.matchAll(/`?([A-Za-z_][\w]*)`?/g)].map((x) => x[1]).filter((x) => isUpper(x) || /^[a-z]+$/.test(x));
          const tt = targetType();
          if (tt) for (const v of vs) pushValue(tt, v, L);
          else if (vs.length >= 2) S.valueLists.push({ names: vs, line: L, lines: [L] });
          return;
        }
      }

      const ctx = ctxNow();

      // returns 文脈の行
      if (ctx === "returns") {
        const f = targetFunc();
        const tok = (body.match(/^`([^`]+)`/) || body.match(/^([^\s（(、。,:：]+)/) || [])[1];
        if (f && !f.returns && tok && looksLikeType(tok)) f.returns = tok.trim();
        return;
      }

      // シグネチャ（バッククォートの中、または行頭）
      const sigTexts = [...n.matchAll(/`([^`\n]+)`/g)].map((x) => x[1]);
      const lead = body.replace(/`/g, "").match(/^(?:(?:public|private|protected|static|final|abstract|async|def|function)\s+)*(?:[A-Za-z_$][\w$.<>\[\], ?]*\s+)?[A-Za-z_$][\w$.#]*\s*\(/);
      if (lead && !sigTexts.some((s) => body.replace(/`/g, "").startsWith(s))) {
        const close = closeAt(body.replace(/`/g, ""), lead[0].length - 1);
        if (close > 0) {
          const after = body.replace(/`/g, "").slice(close + 1).match(/^\s*(?:(?::|->|→|=>|：)\s*[^\s、。,]+)?/);
          sigTexts.push(body.replace(/`/g, "").slice(0, close + 1 + (after ? after[0].length : 0)));
        }
      }
      let foundSig = false;
      for (const st of sigTexts) {
        for (const sg of findSignatures(st)) {
          if (sg.callish) {
            if (!S.funcs.some((f) => f.name === sg.name && f.line === L)) addFunc({ name: sg.name, owner: sg.owner, params: null }, L, true, "mention");
            continue;
          }
          const isDef = !sg.emptyParens || sg.returns;
          const f = addFunc({ ...sg, params: sg.emptyParens && !sg.returns && !(isBullet && body.replace(/`/g, "").trim().startsWith(st.trim())) ? null : sg.params }, L, true, isDef ? "signature" : "mention");
          if (isBullet && body.replace(/`/g, "").trim().startsWith(st.replace(/`/g, "").trim().split("(")[0].trim().split(/\s+/).pop())) {
            lastFunc = f;
            f.indent = indent;
          }
          foundSig = true;
        }
      }
      if (foundSig && !ctx) return;

      // 定数: MAX_ITEMS = 100 / `MAX_ITEMS` は 100
      for (const cm of n.matchAll(/(`?)\b([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+|[A-Z]{2,}[0-9]*)\b\1\s*(?:=|:|：|は|が|＝|→)\s*`?(-?\d[\d_,]*(?:\.\d+)?(?:e[-+]?\d+)?[lLfFdD]?|"[^"]*"|'[^']*'|「[^」]*」|true|false)`?/g)) {
        if (STOP.has(cm[2])) continue;
        addConst(cm[2], cm[3], L, !!cm[1] || cm[2].includes("_"));
        if (ctx !== "consts") return;
      }

      // 型の値の一覧:  `OrderStatus`: `PENDING` / `PAID` / `SHIPPED`
      const ups = [...n.matchAll(/`([A-Z][A-Z0-9_]*)`/g)].map((x) => x[1]);
      const plainUps = ups.length >= 2 ? ups : [...n.matchAll(/(?:^|[\s:：(（/|,、])([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*)(?=\s*(?:[/|,、)）]|または|or\b|$))/g)].map((x) => x[1]).filter((x) => !STOP.has(x));
      if (plainUps.length >= 2 && !/[=＝]/.test(n) && ctx !== "consts") {
        const pas = [...n.matchAll(/`([A-Z][a-z][\w]*)`/g)].map((x) => x[1]);
        const tt = pas.length ? S.types.find((x) => x.name === pas[0]) || addType(pas[0], "enum", L, true) : targetType();
        if (tt && (tt.typeKind === "enum" || pas.length || ctx === "values")) for (const v of plainUps) pushValue(tt, v, L);
        else S.valueLists.push({ names: plainUps, line: L, lines: [L], field: (body.match(/^`?([A-Za-z_]\w*)`?/) || [])[1] || null });
        if (!isBullet || ctx !== "fields") return;
      }

      if (!isBullet) {
        // ラベルなしの「引数」行は、ここでは読まない
        return;
      }
      const item = parseLooseItem(body);
      if (!item) return;
      const ow = ownerNow();
      const lf = lastFunc;
      // シグネチャの下の箇条書き（引数の説明）
      if (lf && lf.params && lf.params.some((p) => p.name === item.name) && (lf.indent === undefined || indent > lf.indent)) {
        pushParam(lf, item, L);
        return;
      }
      if (ctx === "params") pushParam(targetFunc(), item, L);
      else if (ctx === "fields") pushField(targetType(), item, L);
      else if (ctx === "consts") { if (item.value !== null || item.default !== null) addConst(item.name, item.value ?? item.default, L, true); }
      else if (ctx === "values") {
        const tt = targetType();
        if (tt) pushValue(tt, item.name, L);
        else {
          const last = S.valueLists[S.valueLists.length - 1];
          if (last && last.ctxLine === L - 1) { last.names.push(item.name); last.ctxLine = L; }
          else S.valueLists.push({ names: [item.name], line: L, lines: [L], ctxLine: L });
        }
      } else if (ctx === "funcs") {
        /* メソッド一覧の箇条書き: シグネチャがなければ名前だけ */
        if (!S.funcs.some((f) => f.line === L)) addFunc({ name: item.name, params: null }, L, true, "list");
      } else if (ow && ow.func && item.typed && (ow.func.params === null || ow.func.params.some((p) => p.name === item.name))) pushParam(ow.func, item, L);
      else if (ow && ow.type) {
        if (ow.type.typeKind === "enum" && (isUpper(item.name) || !item.typed)) pushValue(ow.type, item.name, L);
        else if (item.typed) pushField(ow.type, item, L);
      }
    }

    // -------------------------------------------------- コードブロック
    function flushFence() {
      const f = fence;
      fence = null;
      const body = f.lines.join("\n");
      const lang = f.lang;
      const skip = /^(?:json|jsonc|yaml|yml|toml|ini|bash|sh|shell|zsh|console|terminal|cmd|powershell|ps1|text|txt|plaintext|xml|html|sql|mermaid|csv|diff|log|output|properties|env|dockerfile|makefile|markdown|md)$/.test(lang);
      const offset = f.start - 1;
      if (/^(?:http|rest)$/.test(lang) || skip) {
        f.lines.forEach((l, i) => {
          HTTP.lastIndex = 0;
          let em;
          while ((em = HTTP.exec(nfkc(l)))) addEndpoint(em[1], em[2], offset + i + 1);
        });
        return;
      }
      const map = { java: "java", ts: "ts", typescript: "ts", tsx: "ts", js: "js", javascript: "js", jsx: "js", mjs: "js", python: "python", py: "python", python3: "python" };
      const cl = map[lang] || detectLang(body);
      let found = false;
      if (cl) {
        const m = parseCode(body, "spec", { lang: cl, loose: true, skipWords: true });
        for (const fn of m.funcs) {
          if (fn.local) continue;
          const params = fn.params.map((p) => ({ name: p.name, type: p.type, default: p.default, required: p.optional ? false : null, variadic: p.variadic }));
          const item = addFunc({ name: fn.name, owner: fn.owner, params, returns: fn.returns }, offset + fn.line, true, "code");
          item.isCtor = fn.isCtor;
          item.ownerExplicit = !!fn.owner;
          found = true;
        }
        for (const ty of m.types) {
          if (ty.local) continue;
          const t = addType(ty.name, ty.kind === "enum" ? "enum" : "class", offset + ty.line, true);
          if (ty.fields.length) t.fields = ty.fields.filter((x) => !x.private || !x.static).map((x) => ({ name: x.name, type: x.type, default: null, required: x.optional ? false : null, line: offset + x.line }));
          if (ty.values) t.values = ty.values.map((v) => ({ name: v.name, line: offset + v.line }));
          found = true;
        }
        for (const c of m.consts) { addConst(c.name, c.value, offset + c.line, true); found = true; }
        for (const e of m.endpoints) { addEndpoint(e.method, e.path, offset + e.line); found = true; }
      }
      f.lines.forEach((l, i) => {
        const L = offset + i + 1;
        HTTP.lastIndex = 0;
        let em;
        while ((em = HTTP.exec(nfkc(l)))) addEndpoint(em[1], em[2], L);
        if (!found) for (const sg of findSignatures(l)) if (!sg.callish && (sg.params.length || sg.returns)) addFunc(sg, L, true, "code");
      });
    }

    // -------------------------------------------------- 行ごとに読む
    for (let ln = 0; ln < lines.length; ln++) {
      const raw = lines[ln];
      const L = ln + 1;
      if (fence) {
        if (raw.trim().startsWith(fence.mark) && raw.trim().replace(/[`~]/g, "") === "") flushFence();
        else fence.lines.push(raw);
        continue;
      }
      const fm = raw.match(/^\s*(```+|~~~+)\s*([\w+#.-]*)/);
      if (fm) {
        flushTable();
        fence = { mark: fm[1], lang: fm[2].toLowerCase(), start: L + 1, lines: [] };
        continue;
      }
      for (const w of raw.match(/[A-Za-z_$][\w$]*/g) || []) S.words.add(normName(w));

      const n = nfkc(raw);
      if (/^\s*\|/.test(n)) {
        if (!table) table = { rows: [] };
        table.rows.push({ cells: splitRow(n), line: L });
        continue;
      }
      flushTable();

      const hm = n.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/);
      if (hm) { heading(hm[1].length, hm[2], L); continue; }
      // 次の行が === / --- なら見出し（Setext）
      const next = lines[ln + 1];
      if (next !== undefined && /^\s*(=+|-+)\s*$/.test(next) && n.trim() && !/^\s*[-*+]\s/.test(n)) {
        heading(/=/.test(next) ? 1 : 2, n.trim(), L);
        ln++;
        continue;
      }
      // ■ 見出し / 【見出し】だけの行
      const sq = n.match(/^\s*[■□◆◇▼▽▶►]\s*(.+)$/);
      if (sq) { heading(4, sq[1], L); continue; }
      prose(raw, L, false);
    }
    if (fence) flushFence();
    flushTable();

    S.funcs = mergeFuncs(S.funcs);
    S.types = mergeTypes(S.types);
    S.consts = mergeBy(S.consts, (c) => c.name, (a, b) => { if (a.value == null) a.value = b.value; });
    S.endpoints = mergeBy(S.endpoints, (e) => e.method + " " + e.path, () => {});
    S.lineText = lineText;
    return S;
  }

  function mergeBy(list, key, merge) {
    const map = new Map();
    for (const x of list) {
      const k = key(x);
      const ex = map.get(k);
      if (!ex) { map.set(k, x); continue; }
      merge(ex, x);
      for (const l of x.lines) if (!ex.lines.includes(l)) ex.lines.push(l);
      ex.strong = ex.strong || x.strong;
    }
    return [...map.values()];
  }

  /** 同じ関数が何か所にも書かれていたら、いちばん詳しい情報を集めて1つにする */
  function mergeFuncs(list) {
    const groups = new Map();
    for (const f of list) {
      const k = f.name;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(f);
    }
    const out = [];
    const richness = (f) => (f.params ? 1 + f.params.length + f.params.filter((p) => p.type).length : 0) + (f.returns ? 1 : 0);
    for (const fs of groups.values()) {
      // オーナーが明示されて違うものは別物
      const byOwner = new Map();
      for (const f of fs) {
        const o = f.ownerExplicit ? f.owner : "";
        if (!byOwner.has(o)) byOwner.set(o, []);
        byOwner.get(o).push(f);
      }
      if (byOwner.size > 1 && byOwner.has("")) {
        const owners = [...byOwner.keys()].filter((x) => x);
        if (owners.length === 1) {
          byOwner.get(owners[0]).push(...byOwner.get(""));
          byOwner.delete("");
        }
      }
      for (const group of byOwner.values()) {
        const defs = group.filter((f) => f.src !== "mention");
        const base = (defs.length ? defs : group).slice().sort((a, b) => richness(b) - richness(a))[0];
        const m = { ...base, lines: [] };
        m.params = base.params ? base.params.map((p) => ({ ...p })) : null;
        for (const f of group) {
          for (const l of f.lines) if (!m.lines.includes(l)) m.lines.push(l);
          if (!m.returns && f.returns) m.returns = f.returns;
          if (m.params && f.params && f !== base)
            for (const p of f.params) {
              const ex = m.params.find((x) => x.name === p.name);
              if (ex) {
                if (!ex.type && p.type) ex.type = p.type;
                if (ex.default == null && p.default != null) ex.default = p.default;
                if (ex.required == null && p.required != null) ex.required = p.required;
              }
            }
          if (!m.params && f.params) m.params = f.params.map((p) => ({ ...p }));
          if (!m.owner && f.owner) m.owner = f.owner;
          m.strong = m.strong || f.strong;
        }
        m.lines.sort((a, b) => a - b);
        m.line = Math.min(...m.lines.filter((l) => defs.length === 0 || defs.some((d) => d.lines.includes(l)))) || m.lines[0];
        m.mentionOnly = defs.length === 0;
        out.push(m);
      }
    }
    return out.sort((a, b) => a.line - b.line);
  }

  function mergeTypes(list) {
    return mergeBy(list, (t) => t.name, (a, b) => {
      if (b.fields) {
        if (!a.fields) a.fields = [];
        for (const f of b.fields) if (!a.fields.some((x) => x.name === f.name)) a.fields.push(f);
      }
      if (b.values && b.values.length) {
        if (!a.values) a.values = [];
        for (const v of b.values) if (!a.values.some((x) => x.name === v.name)) a.values.push(v);
      }
      if (b.typeKind === "enum") a.typeKind = "enum";
    });
  }

  const api = { parseSpec, findSignatures, parseParamsLoose, parseLooseItem, looksLikeType };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SpecCheckSpec = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
