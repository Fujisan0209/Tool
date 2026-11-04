/*
 * LLM の答えを読む・確かめる・まとめる処理。DOM は使いません（Node でもテストできます）。
 *  - parsePlan:      観点づくりの答え（JSON）を読み、形をそろえる
 *  - extractFiles:   コードづくりの答えから、ファイルを取り出す
 *  - coverage:       観点IDが全部テストになっているか
 *  - lint:           コンパイル前にわかる、よくあるまちがい
 *  - makeZip:        取り出したファイルを1つの zip にする
 *  - estimateCost:   使ったトークンから料金の目安を出す
 */
(function (root) {
  "use strict";

  const { CATEGORIES, packagePath } =
    typeof module !== "undefined" && module.exports ? require("./prompts.js") : root.SpringTestPrompts;

  // ---------------------------------------------------------------- JSON を取り出す

  /** 答えの文字から JSON を1つ取り出す。前後に文があっても、```json で囲まれていても読む。 */
  function extractJson(text) {
    const t = String(text || "").trim();
    const tries = [t];
    const fence = t.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
    if (fence) tries.push(fence[1]);
    const a = t.indexOf("{");
    const b = t.lastIndexOf("}");
    if (a >= 0 && b > a) tries.push(t.slice(a, b + 1));
    for (const s of tries) {
      try {
        return JSON.parse(s);
      } catch (_) {
        /* 次を試す */
      }
    }
    throw new Error("答えの中に JSON が見つかりませんでした");
  }

  const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

  /** 観点の一覧の形をそろえる。足りない項目は埋め、ID の重複や抜けは振りなおす。 */
  function normalizePlan(raw) {
    const plan = raw && typeof raw === "object" ? raw : {};
    const cases = Array.isArray(plan.cases) ? plan.cases : [];
    const classes = [];
    const seenCls = new Set();
    const addCls = (className, target) => {
      const name = safeClassName(className) || "ApiControllerTest";
      if (seenCls.has(name)) return name;
      seenCls.add(name);
      classes.push({ className: name, target: String(target || name.replace(/Test$/, "")) });
      return name;
    };
    for (const c of Array.isArray(plan.classes) ? plan.classes : []) addCls(c && c.className, c && c.target);

    const seenId = new Set();
    let next = 1;
    const out = cases
      .filter((c) => c && typeof c === "object")
      .map((c) => {
        let id = String(c.id || "").trim().toUpperCase();
        if (!/^C\d{3,}$/.test(id) || seenId.has(id)) {
          while (seenId.has(caseId(next))) next++;
          id = caseId(next);
        }
        seenId.add(id);
        const method = String(c.method || "GET").toUpperCase();
        const status = parseInt(c.expectStatus, 10);
        return {
          id,
          className: addCls(c.className),
          method: METHODS.includes(method) ? method : "GET",
          path: String(c.path || "/"),
          category: CATEGORIES[c.category] ? c.category : "other",
          title: String(c.title || "").trim() || "（タイトルなし）",
          given: String(c.given || ""),
          request: String(c.request || ""),
          expectStatus: Number.isFinite(status) ? status : 200,
          expect: String(c.expect || ""),
          basis: c.basis === "assumption" ? "assumption" : "spec",
          specRef: String(c.specRef || ""),
          selected: true,
        };
      });
    return {
      summary: String(plan.summary || ""),
      classes: classes.filter((k) => out.some((c) => c.className === k.className)),
      cases: out,
      questions: (Array.isArray(plan.questions) ? plan.questions : []).map(String).filter((q) => q.trim()),
    };
  }

  function parsePlan(text) {
    return normalizePlan(extractJson(text));
  }

  function caseId(n) {
    return "C" + String(n).padStart(3, "0");
  }

  /** いちばん大きい ID の次。手で観点を足すときに使う。 */
  function nextCaseId(cases) {
    let max = 0;
    for (const c of cases) {
      const m = /^C(\d+)$/.exec(c.id);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    return caseId(max + 1);
  }

  function safeClassName(s) {
    const t = String(s || "").replace(/[^A-Za-z0-9_$]/g, "");
    if (!t) return "";
    return /^[A-Za-z_$]/.test(t) ? t[0].toUpperCase() + t.slice(1) : "T" + t;
  }

  // ---------------------------------------------------------------- コードを取り出す

  const FILE_HINT = /^\s*(?:\/\/|--|#)\s*file:\s*(\S+)\s*$/i;

  /**
   * ```java などのコードブロックを取り出し、ファイルにする。
   * 1行目の「// file: パス」を優先し、なければ package と class 名からパスを決める。
   * 閉じていない最後のブロック（書いている途中）も、partial: true で返す。
   */
  function extractFiles(text, basePackage) {
    const files = [];
    const src = String(text || "");
    const open = /^[ \t]*```([\w+-]*)[^\n]*\n/gm;
    let m;
    while ((m = open.exec(src))) {
      const lang = (m[1] || "").toLowerCase();
      const start = open.lastIndex;
      const close = /^[ \t]*```[ \t]*$/m.exec(src.slice(start));
      const closed = !!close;
      let body = closed ? src.slice(start, start + close.index) : src.slice(start);
      open.lastIndex = closed ? start + close.index + close[0].length : src.length;
      body = body.replace(/\n$/, "");
      const lines = body.split("\n");
      let path = "";
      const hint = lines[0] && lines[0].match(FILE_HINT);
      if (hint) {
        path = hint[1];
        lines.shift();
        body = lines.join("\n");
      }
      const isJava = lang === "java" || /\.java$/.test(path) || /^\s*(package|import)\s/m.test(body);
      if (!path && isJava) path = guessJavaPath(body, basePackage);
      if (!path) continue; // 説明用の小さなコードなどは飛ばす
      path = path.replace(/^\.?\//, "");
      files.push({
        path,
        name: path.split("/").pop(),
        lang: isJava ? "java" : lang || path.split(".").pop(),
        code: body.replace(/\s+$/, "") + "\n",
        partial: !closed,
      });
    }
    // 同じパスが2回出たら、あとのほう（直した版）を使う
    const byPath = new Map();
    for (const f of files) byPath.set(f.path, f);
    return [...byPath.values()];
  }

  function guessJavaPath(code, basePackage) {
    const pkg = (code.match(/^\s*package\s+([\w.]+)\s*;/m) || [])[1] || basePackage || "com.example.demo";
    const cls =
      (code.match(/^\s*(?:public\s+)?(?:final\s+)?(?:abstract\s+)?class\s+(\w+)/m) || [])[1] || "GeneratedTest";
    return `src/test/java/${packagePath(pkg)}/${cls}.java`;
  }

  /** ファイルの中のテストクラス名（public class か、ファイル名） */
  function classNameOf(file) {
    const m = file.code.match(/^\s*(?:public\s+)?(?:final\s+)?class\s+(\w+)/m);
    return m ? m[1] : file.name.replace(/\.\w+$/, "");
  }

  // ---------------------------------------------------------------- 観点がテストになっているか

  /** コードに出てくる観点ID（@DisplayName("[C001] ...") の形）を集める */
  function idsInCode(code) {
    const ids = new Set();
    const re = /@DisplayName\s*\(\s*"\s*\[\s*(C\d{3,})\s*\]/g;
    let m;
    while ((m = re.exec(String(code || "")))) ids.add(m[1]);
    return ids;
  }

  function coverage(cases, files) {
    const found = new Set();
    for (const f of files) for (const id of idsInCode(f.code)) found.add(id);
    const want = cases.map((c) => c.id);
    const covered = want.filter((id) => found.has(id));
    const missing = want.filter((id) => !found.has(id));
    const extra = [...found].filter((id) => !want.includes(id));
    return { total: want.length, covered, missing, extra };
  }

  /** コピーして使ったときの答えから、表に出てきた観点ID を集める（コードブロックの外だけ） */
  function idsInPlanText(text) {
    const outside = String(text || "").replace(/```[\s\S]*?(?:```|$)/g, "");
    const ids = new Set();
    const re = /(?:^|[|\s[])(C\d{3,})(?=[\s|\]])/gm;
    let m;
    while ((m = re.exec(outside))) ids.add(m[1]);
    return [...ids].sort();
  }

  // ---------------------------------------------------------------- よくあるまちがいを見つける

  /**
   * コンパイルしなくてもわかる問題を探す。level: "error"（ほぼ確実に動かない）/ "warn"（直したほうがいい）
   * settings.boot: "4" | "3.4" | "3.0"
   */
  function lint(file, settings) {
    const out = [];
    if (file.lang !== "java") return out;
    const code = file.code;
    const lines = code.split("\n");
    const boot = settings.boot;
    const add = (level, message, re) => {
      let line = 0;
      if (re) {
        const i = lines.findIndex((l) => re.test(l));
        if (i < 0) return;
        line = i + 1;
      }
      out.push({ level, message, line });
    };
    const has = (re) => re.test(code);

    if (file.partial) add("error", "コードが途中で終わっています（答えが長すぎて切れた可能性があります）");
    if (!has(/^\s*package\s+[\w.]+\s*;/m)) add("warn", "package 文がありません");

    const pkg = (code.match(/^\s*package\s+([\w.]+)\s*;/m) || [])[1];
    if (pkg && settings.basePackage && pkg !== settings.basePackage.trim()) {
      add("warn", `package が設定（${settings.basePackage.trim()}）と違います: ${pkg}`, /^\s*package\s/);
    }
    const cls = classNameOf(file);
    if (file.name.endsWith(".java") && cls && file.name !== cls + ".java") {
      add("error", `ファイル名 ${file.name} とクラス名 ${cls} が合っていません`, /^\s*(public\s+)?class\s/);
    }

    // バージョンのちがい
    if (boot === "4") {
      add("error", "Spring Boot 4 では @WebMvcTest などは org.springframework.boot.webmvc.test.autoconfigure に移りました", /import\s+org\.springframework\.boot\.test\.autoconfigure\.web\.servlet\./);
      add("error", "Spring Boot 4 では @MockBean は削除されました。@MockitoBean を使います", /@MockBean\b|import\s+org\.springframework\.boot\.test\.mock\.mockito\.MockBean/);
      add("warn", "Spring Boot 4 の JSON は Jackson 3（tools.jackson）です。com.fasterxml.jackson の ObjectMapper は動かないことがあります", /import\s+com\.fasterxml\.jackson\.databind\./);
    } else {
      add("error", "Spring Boot 3 では @WebMvcTest は org.springframework.boot.test.autoconfigure.web.servlet にあります", /import\s+org\.springframework\.boot\.webmvc\.test\./);
      if (boot === "3.4") add("warn", "Spring Boot 3.4 以降、@MockBean は非推奨です。@MockitoBean を使います", /@MockBean\b/);
      if (boot === "3.0") add("error", "Spring Boot 3.0〜3.3 には @MockitoBean がありません。@MockBean を使います", /@MockitoBean\b/);
    }
    add("error", "JUnit 4 の import です。JUnit 5（org.junit.jupiter.api）を使います", /import\s+org\.junit\.(Test|Before|After|Assert|runner)\b/);
    add("warn", "@RunWith は JUnit 4 用です（JUnit 5 では不要）", /@RunWith\b/);

    // テストの中身
    add("warn", "Thread.sleep は使わないでください（遅くなり、不安定になります）", /Thread\.sleep\s*\(/);
    add("warn", "System.out は使わないでください", /System\.(out|err)\.print/);
    add("warn", "@Disabled のテストがあります", /@Disabled\b/);
    add("warn", "assertTrue(true) は何も確かめていません", /assertTrue\s*\(\s*true\s*\)/);
    add("warn", "TODO が残っています", /\/\/\s*TODO|\/\*\s*TODO/);

    const tests = (code.match(/@Test\b/g) || []).length;
    if (!tests) add("error", "@Test のメソッドがありません");
    const asserts = (code.match(/\.andExpect\s*\(|assertThat\s*\(|\.hasStatus|\.should\(\)|\bverify\s*\(/g) || []).length;
    if (tests && asserts < tests) add("warn", `確かめる処理（andExpect / assertThat など）が @Test の数（${tests}）より少なく、何も確かめていないテストがあるかもしれません`);

    if (/MockMvcTester\b/.test(code) && !/import\s+org\.springframework\.test\.web\.servlet\.assertj\.MockMvcTester/.test(code)) {
      add("error", "MockMvcTester の import がありません");
    }
    if (/\bMockMvc\b/.test(code) && !/import\s+org\.springframework\.test\.web\.servlet\.MockMvc\s*;/.test(code)) {
      add("error", "MockMvc の import がありません");
    }

    // かっこの数（文字列・コメントを除いて数える）
    const bal = braceBalance(code);
    if (bal !== 0 && !file.partial) add("error", `{ と } の数が合っていません（${bal > 0 ? "} が " + bal + " 個足りない" : "} が " + -bal + " 個多い"}）`);

    return out;
  }

  /** 文字列・テキストブロック・コメントを飛ばして { と } の差を数える */
  function braceBalance(code) {
    let depth = 0;
    let i = 0;
    const n = code.length;
    while (i < n) {
      const c = code[i];
      const two = code.slice(i, i + 2);
      const three = code.slice(i, i + 3);
      if (two === "//") {
        i = code.indexOf("\n", i);
        if (i < 0) break;
        continue;
      }
      if (two === "/*") {
        i = code.indexOf("*/", i + 2);
        if (i < 0) break;
        i += 2;
        continue;
      }
      if (three === '"""') {
        i = code.indexOf('"""', i + 3);
        if (i < 0) break;
        i += 3;
        continue;
      }
      if (c === '"' || c === "'") {
        i++;
        while (i < n && code[i] !== c && code[i] !== "\n") i += code[i] === "\\" ? 2 : 1;
        i++;
        continue;
      }
      if (c === "{") depth++;
      else if (c === "}") depth--;
      i++;
    }
    return depth;
  }

  // ---------------------------------------------------------------- 必要な依存（build.gradle の例）

  function dependencySnippet(settings) {
    const lines = [];
    if (settings.boot === "4") {
      lines.push("testImplementation 'org.springframework.boot:spring-boot-starter-webmvc-test'");
    } else {
      lines.push("testImplementation 'org.springframework.boot:spring-boot-starter-test'");
    }
    lines.push("// 仕様に認証があるとき");
    lines.push("testImplementation 'org.springframework.security:spring-security-test'");
    return lines.join("\n");
  }

  // ---------------------------------------------------------------- 料金の目安

  /** 1M トークンあたりのドル（2026年11月時点の公開価格。目安です） */
  const PRICES = {
    "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
    "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2 },
    "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
  };

  function addUsage(total, u) {
    const t = total || { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    if (!u) return t;
    t.input += u.input_tokens || 0;
    t.output += u.output_tokens || 0;
    t.cacheRead += u.cache_read_input_tokens || 0;
    t.cacheWrite += u.cache_creation_input_tokens || 0;
    return t;
  }

  function estimateCost(model, usage) {
    const p = PRICES[model];
    if (!p || !usage) return null;
    const usd =
      (usage.input * p.input + usage.cacheWrite * p.input * 1.25 + usage.cacheRead * p.cacheRead + usage.output * p.output) / 1e6;
    // キャッシュがなかったら、入力にいくらかかったか
    const noCache = ((usage.input + usage.cacheWrite + usage.cacheRead) * p.input + usage.output * p.output) / 1e6;
    return { usd, saved: Math.max(0, noCache - usd) };
  }

  // ---------------------------------------------------------------- zip（無圧縮）

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  /** files: [{path, code}] → Uint8Array（zip）。ファイル名は UTF-8。 */
  function makeZip(files, date) {
    const enc = new TextEncoder();
    const d = date || new Date();
    const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    const locals = [];
    const centrals = [];
    let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.path);
      const data = enc.encode(f.code);
      const crc = crc32(data);
      const local = new Uint8Array(30 + name.length);
      const lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);
      lv.setUint16(6, 0x0800, true); // UTF-8 のファイル名
      lv.setUint16(8, 0, true); // 無圧縮
      lv.setUint16(10, dosTime, true);
      lv.setUint16(12, dosDate, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, data.length, true);
      lv.setUint32(22, data.length, true);
      lv.setUint16(26, name.length, true);
      local.set(name, 30);
      locals.push(local, data);

      const cen = new Uint8Array(46 + name.length);
      const cv = new DataView(cen.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, dosTime, true);
      cv.setUint16(14, dosDate, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, name.length, true);
      cv.setUint32(42, offset, true);
      cen.set(name, 46);
      centrals.push(cen);
      offset += local.length + data.length;
    }
    const cenSize = centrals.reduce((s, c) => s + c.length, 0);
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, cenSize, true);
    ev.setUint32(16, offset, true);
    const parts = [...locals, ...centrals, end];
    const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
    let o = 0;
    for (const p of parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  }

  const api = {
    extractJson,
    normalizePlan,
    parsePlan,
    nextCaseId,
    extractFiles,
    classNameOf,
    idsInCode,
    idsInPlanText,
    coverage,
    lint,
    braceBalance,
    dependencySnippet,
    PRICES,
    addUsage,
    estimateCost,
    crc32,
    makeZip,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SpringTestCore = api;
})(typeof window !== "undefined" ? window : globalThis);
