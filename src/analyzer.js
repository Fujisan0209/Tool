/*
 * 貼りつけられたエラー出力を、1つずつのエラーに分けて、
 * rules.js のルールで説明を作ります。DOM は使いません（Node でもテストできます）。
 */
(function (root) {
  "use strict";

  const { RULES } =
    typeof module !== "undefined" && module.exports ? require("./rules.js") : root.JavaErrorRules;

  // Main.java:5: error: ';' expected  /  Main.java:5: エラー: ';'がありません
  const COMPILE_HEADER = /^(.*?([^\\/\s]+\.java)):(\d+):\s*(error|エラー|warning|警告):\s*(.*)$/;
  // Exception in thread "main" java.lang.NullPointerException: ...
  const RUNTIME_HEADER = /^(?:Exception in thread "[^"]*"\s+|スレッド"[^"]*"で例外が発生しました\s*)?((?:[\w$]+\.)+[\w$]*(?:Exception|Error))(?::\s*(.*))?$/;
  // at Main.main(Main.java:10)
  const STACK_FRAME = /^\s*at\s+([\w$.<>]+)\(([^:()]+\.java):(\d+)\)/;
  // 「2 errors」「エラー2個」などのまとめ行
  const SUMMARY = /^\s*(?:\d+\s+(?:errors?|warnings?)|(?:エラー|警告)\s*\d+\s*個)\s*$/;

  const KIND_LABEL = {
    compile: "コンパイルエラー",
    runtime: "実行時エラー",
    env: "準備・コマンドのエラー",
  };

  /** 1つのエラーのかたまりに、最初に合うルールを探す */
  function findRule(headline, block) {
    for (const r of RULES) {
      const m = headline.match(r.match);
      if (m) return { rule: r, m };
    }
    if (headline !== block) {
      for (const r of RULES) {
        const m = block.match(r.match);
        if (m) return { rule: r, m };
      }
    }
    return null;
  }

  /** 実行時エラーのスタックトレースから、自分のコードの場所を探す */
  function userFrame(lines) {
    const frames = [];
    for (const l of lines) {
      const f = l.match(STACK_FRAME);
      if (f) frames.push({ method: f[1], file: f[2], line: Number(f[3]) });
    }
    const mine = frames.find((f) => !/^(java|javax|jdk|sun|com\.sun)\./.test(f.method));
    return mine || frames[0] || null;
  }

  /** テキストを、エラーのかたまり（block）の配列に分ける */
  function split(text) {
    const lines = text.replace(/\r\n?/g, "\n").split("\n");
    const blocks = [];
    let cur = null;

    const push = () => {
      if (cur) blocks.push(cur);
      cur = null;
    };

    for (const line of lines) {
      const c = line.match(COMPILE_HEADER);
      if (c) {
        push();
        cur = {
          type: "compile",
          file: c[2],
          line: Number(c[3]),
          severity: /warning|警告/.test(c[4]) ? "warning" : "error",
          headline: c[5].trim(),
          lines: [line],
        };
        continue;
      }
      const r = line.match(RUNTIME_HEADER);
      if (r && !/^\s*(Caused by|at)\b/.test(line) && (!cur || cur.type !== "runtime")) {
        push();
        cur = { type: "runtime", headline: line.trim(), lines: [line] };
        continue;
      }
      if (SUMMARY.test(line)) {
        push();
        continue;
      }
      if (cur) cur.lines.push(line);
    }
    push();
    return blocks;
  }

  /** compile エラーの下にある「コードの行」と「^ の行」を取り出す */
  function codeSnippet(block) {
    const rest = block.lines.slice(1);
    const caretIdx = rest.findIndex((l) => /^\s*\^\s*$/.test(l));
    if (caretIdx > 0) return { code: rest[caretIdx - 1], caret: rest[caretIdx] };
    return null;
  }

  function explainBlock(headline, blockText) {
    const found = findRule(headline, blockText);
    if (!found) return null;
    const info = found.rule.build(found.m, { block: blockText });
    return { id: found.rule.id, kind: found.rule.kind, kindLabel: KIND_LABEL[found.rule.kind], ...info };
  }

  /**
   * メインの関数。
   * 戻り値: { items: [...], unknown: boolean }
   *   item = { id, kind, kindLabel, title, what, causes, fixes, example,
   *            original, location: {file,line,method}|null, snippet }
   */
  function analyze(text) {
    const src = String(text || "")
      .split(/\r\n?|\n/)
      .filter((l) => !/^Picked up (?:JAVA_TOOL_OPTIONS|_JAVA_OPTIONS|JDK_JAVA_OPTIONS)/.test(l))
      .join("\n")
      .trim();
    if (!src) return { items: [], unknown: false };

    const blocks = split(src);
    const items = [];

    for (const b of blocks) {
      const blockText = b.lines.join("\n");
      const info = explainBlock(b.headline, blockText);
      let location = null;
      if (b.type === "compile") location = { file: b.file, line: b.line };
      else if (b.type === "runtime") location = userFrame(b.lines);

      items.push({
        ...(info || {
          id: "unknown",
          kind: b.type,
          kindLabel: KIND_LABEL[b.type],
          title: "このエラーはまだ説明を用意していません",
          what: "下の「どのエラーにも使えるコツ」を試してみてください。",
          causes: [],
          fixes: [],
        }),
        severity: b.severity || "error",
        original: b.headline,
        location,
        snippet: b.type === "compile" ? codeSnippet(b) : null,
      });
    }

    // ヘッダーの形をしていない（環境のエラーなど）ときは、全体で探す
    if (items.length === 0) {
      const info = explainBlock(src, src);
      if (info) {
        const firstLine = src.split("\n").find((l) => l.trim()) || src;
        items.push({ ...info, severity: "error", original: firstLine.trim(), location: null, snippet: null });
      }
    }

    return { items, unknown: items.length === 0 || items.every((i) => i.id === "unknown") };
  }

  const api = { analyze, split };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.JavaErrorAnalyzer = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
