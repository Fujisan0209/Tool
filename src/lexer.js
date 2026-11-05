/*
 * Java のコードを「トークン」に分けます（その場チェック用）。
 * 書きかけのコードでも止まらず、最後まで分けきります。
 * まちがい（全角の記号・閉じていない文字列など）は problems に入れます。
 *
 * token = { t, v, s, e }
 *   t: "id" 名前 / "kw" 予約語 / "num" 数 / "str" 文字列 / "chr" 文字 / "op" 記号 / "bad" 使えない文字 / "eof"
 *   s, e: コードの中の位置（文字の番号）
 */
(function (root) {
  "use strict";

  const KEYWORDS = new Set(
    (
      "abstract assert boolean break byte case catch char class const continue default do double else enum " +
      "extends final finally float for goto if implements import instanceof int interface long native new " +
      "package private protected public return short static strictfp super switch synchronized this throw " +
      "throws transient try void volatile while true false null _"
    ).split(" ")
  );

  // 長いものから順に
  const OPS = [
    "<<=", "...", "::", "->", "==", "<=", "!=", "&&", "||", "++", "--", "+=", "-=", "*=", "/=", "%=", "&=", "|=",
    "^=", "<<", "(", ")", "{", "}", "[", "]", ";", ",", ".", "@", "=", ">", "<", "!", "~", "?", ":", "+", "-",
    "*", "/", "&", "|", "^", "%",
  ];

  /** 全角 → 半角（見た目が似ていて、まちがえやすいもの） */
  const FULLWIDTH = {
    "\u3000": " ", "；": ";", "：": ":", "（": "(", "）": ")", "｛": "{", "｝": "}", "［": "[", "］": "]",
    "＜": "<", "＞": ">", "＝": "=", "＋": "+", "－": "-", "−": "-", "＊": "*", "／": "/", "％": "%", "！": "!",
    "＆": "&", "｜": "|", "，": ",", "．": ".", "？": "?", "＂": '"', "＇": "'", "“": '"', "”": '"', "‘": "'",
    "’": "'", "、": ",", "。": ".", "＃": "#", "＠": "@", "～": "~", "＾": "^", "￥": "\\", "¥": "\\",
    "｀": "`", "＄": "$", "＿": "_",
  };

  const ID_START = /[\p{L}\p{Nl}\p{Sc}\p{Pc}]/u;
  const ID_PART = /[\p{L}\p{Nl}\p{Sc}\p{Pc}\p{Nd}\p{Mn}\p{Mc}\u200c\u200d]/u;
  const FW_ALNUM = /[\uff10-\uff19\uff21-\uff3a\uff41-\uff5a]/; // ０-９ Ａ-Ｚ ａ-ｚ

  function toHalf(ch) {
    if (FULLWIDTH[ch] !== undefined) return FULLWIDTH[ch];
    const c = ch.charCodeAt(0);
    if (c >= 0xff01 && c <= 0xff5e) return String.fromCharCode(c - 0xfee0);
    return ch;
  }

  function isDigit(c) {
    return c >= "0" && c <= "9";
  }

  /**
   * @returns {{ tokens: object[], comments: object[], problems: object[] }}
   * problem = { s, e, sev: "error"|"warn", id, msg, fix, edit?: {s, e, text} }
   */
  function lex(src) {
    const tokens = [];
    const comments = [];
    const problems = [];
    const n = src.length;
    let i = 0;

    const problem = (p) => problems.push(p);

    // 文字列・文字リテラルの中の \ を調べる
    function checkEscape(at, inText) {
      const c = src[at + 1];
      if (c === undefined) return 1;
      if ("btnfr\"'\\s".includes(c)) return 2;
      if (c >= "0" && c <= "7") {
        let k = at + 1;
        let m = 0;
        while (k < n && m < 3 && src[k] >= "0" && src[k] <= "7") k++, m++;
        return k - at;
      }
      if (c === "u") {
        let k = at + 1;
        while (src[k] === "u") k++;
        if (/^[0-9a-fA-F]{4}$/.test(src.slice(k, k + 4))) return k + 4 - at;
        problem({
          s: at, e: Math.min(k + 4, n), sev: "error", id: "bad-unicode-escape",
          msg: "\\u のあとは16進数4けた", fix: "\\u3042 のように4けた書くか、\\\\u にする",
        });
        return k - at;
      }
      if (inText && c === "\n") return 2;
      if (c === "\n" || c === "\r") return 1;
      problem({
        s: at, e: at + 2, sev: "error", id: "bad-escape",
        msg: `「\\${c}」という書き方はない`,
        fix: c === "d" || c === "w" || c === "." ? "正規表現なら \\\\ と2つ重ねる" : "\\ を文字として書くなら \\\\ と2つ重ねる",
        edits: [{ s: at, e: at + 1, text: "\\\\" }],
      });
      return 2;
    }

    while (i < n) {
      const ch = src[i];

      // 空白
      if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f") {
        i++;
        continue;
      }

      // コメント
      if (ch === "/" && src[i + 1] === "/") {
        let k = src.indexOf("\n", i);
        if (k < 0) k = n;
        comments.push({ t: "cmt", s: i, e: k });
        i = k;
        continue;
      }
      if (ch === "/" && src[i + 1] === "*") {
        const k = src.indexOf("*/", i + 2);
        if (k < 0) {
          comments.push({ t: "cmt", s: i, e: n });
          problem({
            s: i, e: i + 2, sev: "error", id: "unclosed-comment",
            msg: "コメント /* が閉じていない", fix: "コメントの終わりに */ を書く",
          });
          i = n;
        } else {
          comments.push({ t: "cmt", s: i, e: k + 2, doc: src[i + 2] === "*" });
          i = k + 2;
        }
        continue;
      }

      // 名前・予約語
      if (ID_START.test(ch) || (ch >= "\ud800" && ch <= "\udbff" && ID_START.test(String.fromCodePoint(src.codePointAt(i))))) {
        let k = i + (src.codePointAt(i) > 0xffff ? 2 : 1);
        while (k < n) {
          const cp = src.codePointAt(k);
          const w = cp > 0xffff ? 2 : 1;
          if (!ID_PART.test(String.fromCodePoint(cp))) break;
          k += w;
        }
        const v = src.slice(i, k);
        if (FW_ALNUM.test(v)) {
          const half = v.replace(/[\uff10-\uff19\uff21-\uff3a\uff41-\uff5a]/g, toHalf);
          problem({
            s: i, e: k, sev: "error", id: "fullwidth-alnum",
            msg: "全角の英数字がまざっている", fix: `半角で「${half}」と打ち直す`,
            edits: [{ s: i, e: k, text: half }],
          });
        }
        if (ch === "¥" || ch === "￥") {
          problem({
            s: i, e: i + 1, sev: "error", id: "fullwidth-symbol",
            msg: "「¥」はコードに使えない", fix: "文字列の中に入れるか、\\（バックスラッシュ）にする",
          });
        }
        tokens.push({ t: KEYWORDS.has(v) ? "kw" : "id", v, s: i, e: k });
        i = k;
        continue;
      }

      // 数
      if (isDigit(ch) || (ch === "." && isDigit(src[i + 1] || ""))) {
        const m = src
          .slice(i, i + 80)
          .match(/^(?:0[xX][0-9a-fA-F_]*(?:\.[0-9a-fA-F_]*)?(?:[pP][+-]?\d+)?|0[bB][01_]*|\d[\d_]*(?:\.[\d_]*)?(?:[eE][+-]?[\d_]+)?|\.\d[\d_]*(?:[eE][+-]?[\d_]+)?)[lLfFdD]?/);
        let k = i + m[0].length;
        const raw = m[0];
        const tok = { t: "num", v: raw, s: i, e: k, numType: numType(raw) };
        // 1abc のように、数のすぐあとに文字が続く
        if (k < n && ID_PART.test(src[k])) {
          let j = k;
          while (j < n && ID_PART.test(src[j])) j++;
          problem({
            s: i, e: j, sev: "error", id: "bad-number",
            msg: "名前は数字から始められない", fix: "名前の先頭は英字にする（例: a1, num1）",
          });
          k = j;
          tok.e = k;
        } else if (/^0\d*[89]\d*$/.test(raw)) {
          problem({
            s: i, e: k, sev: "error", id: "bad-octal",
            msg: "0 で始まる数に 8 や 9 は使えない", fix: `先頭の 0 を消して ${raw.replace(/^0+(?=\d)/, "")} にする`,
            edits: [{ s: i, e: k, text: raw.replace(/^0+(?=\d)/, "") }],
          });
        } else if (/_$|_[lLfFdD]$|^0[xXbB]_|\._|_\./.test(raw)) {
          problem({ s: i, e: k, sev: "error", id: "bad-number", msg: "数の _ の位置がおかしい", fix: "_ は数字と数字の間にだけ書ける" });
        }
        tokens.push(tok);
        i = k;
        continue;
      }

      // テキストブロック """ ... """
      if (ch === '"' && src.startsWith('"""', i)) {
        const after = src.slice(i + 3).match(/^[ \t\f]*\r?\n/);
        if (!after) {
          problem({
            s: i, e: i + 3, sev: "error", id: "text-block-open",
            msg: '""" のあとは改行する', fix: '""" のすぐあとで改行して、次の行から中身を書く',
          });
        }
        let k = i + 3;
        let closed = false;
        while (k < n) {
          if (src[k] === "\\") {
            k += checkEscape(k, true);
            continue;
          }
          if (src.startsWith('"""', k)) {
            closed = true;
            k += 3;
            break;
          }
          k++;
        }
        if (!closed) {
          problem({
            s: i, e: i + 3, sev: "error", id: "unclosed-string",
            msg: '""" が閉じていない', fix: '文章の終わりに """ を書く',
          });
          k = n;
        }
        tokens.push({ t: "str", v: src.slice(i, k), s: i, e: k, text: true });
        i = k;
        continue;
      }

      // 全角・スマートクォートで囲んだ文字列 “Hello”
      if (ch === "“" || ch === "”" || ch === "＂") {
        const eol = src.indexOf("\n", i);
        const lineEnd = eol < 0 ? n : eol;
        let k = i + 1;
        while (k < lineEnd && !"“”＂\"".includes(src[k])) k++;
        if (k < lineEnd) {
          problem({
            s: i, e: k + 1, sev: "error", id: "fullwidth-symbol",
            msg: `全角の「${ch}${src[k]}」で囲んでいる`, fix: '文字列は半角の " " で囲む',
            edits: [{ s: i, e: i + 1, text: '"' }, { s: k, e: k + 1, text: '"' }],
          });
          tokens.push({ t: "str", v: '"' + src.slice(i + 1, k) + '"', s: i, e: k + 1 });
          i = k + 1;
          continue;
        }
      }

      // 文字列
      if (ch === '"') {
        let k = i + 1;
        let closed = false;
        while (k < n && src[k] !== "\n" && src[k] !== "\r") {
          if (src[k] === "\\") {
            k += checkEscape(k, false);
            continue;
          }
          if (src[k] === '"') {
            closed = true;
            k++;
            break;
          }
          if ((src[k] === "”" || src[k] === "“") && !src.slice(k + 1).split("\n")[0].includes('"')) {
            problem({
              s: k, e: k + 1, sev: "error", id: "fullwidth-quote",
              msg: "全角の「”」で閉じている", fix: '半角の " にする',
              edits: [{ s: k, e: k + 1, text: '"' }],
            });
            closed = true;
            k++;
            break;
          }
          if ((src[k] === "¥" || src[k] === "￥") && /[ntr"\\]/.test(src[k + 1] || "")) {
            problem({
              s: k, e: k + 2, sev: "warn", id: "yen-escape",
              msg: `「${src[k]}${src[k + 1]}」は文字のまま表示される`, fix: `改行などのつもりなら \\${src[k + 1]}（バックスラッシュ）にする`,
              edits: [{ s: k, e: k + 1, text: "\\" }],
            });
          }
          k++;
        }
        if (!closed) {
          problem({
            s: i, e: k, sev: "error", id: "unclosed-string",
            msg: "文字列の \" が閉じていない", fix: '文字列の最後に " を書く',
            edits: [{ s: k, e: k, text: '"' }],
          });
        }
        tokens.push({ t: "str", v: src.slice(i, k), s: i, e: k, open: !closed });
        i = k;
        continue;
      }

      // 文字 'a'
      if (ch === "'") {
        let k = i + 1;
        let count = 0;
        let closed = false;
        while (k < n && src[k] !== "\n" && src[k] !== "\r") {
          if (src[k] === "'") {
            closed = true;
            k++;
            break;
          }
          if (src[k] === "\\") k += checkEscape(k, false);
          else k += src.codePointAt(k) > 0xffff ? 2 : 1;
          count++;
        }
        const v = src.slice(i, k);
        if (!closed) {
          problem({
            s: i, e: k, sev: "error", id: "unclosed-char",
            msg: "文字の ' が閉じていない", fix: "1文字なら 'A'、文字列なら \"ABC\" と書く",
          });
        } else if (count === 0) {
          problem({ s: i, e: k, sev: "error", id: "empty-char", msg: "'' の中が空っぽ", fix: "1文字入れる（空の文字列なら \"\"）" });
        } else if (count > 1) {
          problem({
            s: i, e: k, sev: "error", id: "char-too-long",
            msg: "' ' に入るのは1文字だけ", fix: '2文字以上は " " で囲む（String）',
            edits: [{ s: i, e: k, text: '"' + v.slice(1, -1) + '"' }],
          });
        }
        tokens.push({ t: "chr", v, s: i, e: k, err: !closed || count !== 1 });
        i = k;
        continue;
      }

      // 記号
      let op = null;
      for (const o of OPS) {
        if (src.startsWith(o, i)) {
          op = o;
          break;
        }
      }
      if (op) {
        tokens.push({ t: "op", v: op, s: i, e: i + op.length });
        i += op.length;
        continue;
      }

      // ここまで来たら使えない文字
      const cp = src.codePointAt(i);
      const len = cp > 0xffff ? 2 : 1;
      const c = src.slice(i, i + len);
      const half = toHalf(c);
      if (half !== c) {
        const isSpace = c === "\u3000";
        problem({
          s: i, e: i + len, sev: "error", id: isSpace ? "fullwidth-space" : "fullwidth-symbol",
          msg: isSpace ? "全角スペースが入っている" : `全角の「${c}」は使えない`,
          fix: isSpace ? "半角スペースにする" : `半角の「${half}」にする`,
          edits: [{ s: i, e: i + len, text: half }],
        });
        // 全角の記号は、半角の記号として続きを読む（エラーが連鎖しないように）
        if (!isSpace && OPS.includes(half)) tokens.push({ t: "op", v: half, s: i, e: i + len, fw: true });
        else if (!isSpace) tokens.push({ t: "bad", v: c, s: i, e: i + len });
      } else {
        problem({
          s: i, e: i + len, sev: "error", id: "illegal-char",
          msg: `「${c}」はコードに使えない`, fix: c === "#" ? "コメントは // で書く" : "この文字を消す",
        });
        tokens.push({ t: "bad", v: c, s: i, e: i + len });
      }
      i += len;
    }
    tokens.push({ t: "eof", v: "", s: n, e: n });
    return { tokens, comments, problems };
  }

  function numType(raw) {
    const last = raw[raw.length - 1];
    if (last === "l" || last === "L") return "long";
    if (/^0[xX]/.test(raw)) return /[.pP]/.test(raw) ? (last === "f" || last === "F" ? "float" : "double") : "int";
    if (last === "f" || last === "F") return "float";
    if (last === "d" || last === "D") return "double";
    if (/^0[bB]/.test(raw)) return "int";
    if (/[.eE]/.test(raw)) return "double";
    return "int";
  }

  /** 数のトークンの値（BigInt）。小数は null */
  function intValue(raw) {
    let s = raw.replace(/_/g, "").replace(/[lL]$/, "");
    try {
      if (/^0[xX]/.test(s)) return BigInt(s);
      if (/^0[bB]/.test(s)) return BigInt(s);
      if (/^0\d+$/.test(s)) return /[89]/.test(s) ? null : BigInt("0o" + s.slice(1));
      if (/^\d+$/.test(s)) return BigInt(s);
    } catch (e) {
      return null;
    }
    return null;
  }

  const api = { lex, KEYWORDS, intValue, toHalf };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.JavaLexer = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
