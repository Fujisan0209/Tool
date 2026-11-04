// テスト書き方道場: テストの実行と採点
// core() は外の変数を一切使わない関数です。画面ではこの関数の文字列から Web Worker を作り、
// 無限ループなどで画面が固まらないようにして実行します。
(function (root) {
  "use strict";

  function core() {
    "use strict";
    class AssertionError extends Error {
      constructor(m) { super(m); this.name = "AssertionError"; }
    }

    function show(v, depth) {
      depth = depth || 0;
      if (typeof v === "string") return JSON.stringify(v);
      if (typeof v === "number") return Object.is(v, -0) ? "-0" : String(v);
      if (typeof v === "bigint") return v + "n";
      if (v === undefined) return "undefined";
      if (v === null) return "null";
      if (typeof v === "function") return v.name ? "[関数 " + v.name + "]" : "[関数]";
      if (v instanceof Error) return v.name + '("' + v.message + '")';
      if (depth > 2) return Array.isArray(v) ? "[…]" : "{…}";
      if (Array.isArray(v)) return "[" + v.slice(0, 10).map((x) => show(x, depth + 1)).join(", ") + (v.length > 10 ? ", …" : "") + "]";
      if (typeof v === "object") {
        const ks = Object.keys(v);
        const name = v.constructor && v.constructor !== Object ? v.constructor.name + " " : "";
        return name + "{" + ks.slice(0, 8).map((k) => k + ": " + show(v[k], depth + 1)).join(", ") + (ks.length > 8 ? ", …" : "") + "}";
      }
      return String(v);
    }
    const typeName = (v) => (v === null ? "null" : Array.isArray(v) ? "配列" : typeof v);

    function deepEqual(a, b) {
      if (Object.is(a, b)) return true;
      if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
      if (Array.isArray(a) !== Array.isArray(b)) return false;
      if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
      const ka = Object.keys(a), kb = Object.keys(b);
      if (ka.length !== kb.length) return false;
      for (const k of ka) if (!Object.prototype.hasOwnProperty.call(b, k) || !deepEqual(a[k], b[k])) return false;
      return true;
    }

    // 各マッチャーは [合格したか, 失敗したときの説明] を返す。neg は .not のとき true
    const MATCHERS = {
      toBe(a, neg, e) {
        const ok = Object.is(a, e);
        if (neg) return [ok, "期待: " + show(e) + " ではないこと\n実際: " + show(a)];
        let msg = "期待: " + show(e) + "\n実際: " + show(a);
        if (typeof a !== typeof e) msg += "\nヒント: 型がちがいます（期待は " + typeName(e) + "、実際は " + typeName(a) + "）。";
        else if (typeof a === "object" && deepEqual(a, e)) msg += "\nヒント: 中身は同じですが別の物です。配列やオブジェクトの中身をくらべるときは toEqual を使います。";
        else if (typeof a === "number" && Math.abs(a - e) < 1e-9) msg += "\nヒント: 小数の計算誤差です。toBeCloseTo を使いましょう。";
        return [ok, msg];
      },
      toEqual(a, neg, e) {
        return [deepEqual(a, e), neg ? "期待: " + show(e) + " と等しくないこと\n実際: " + show(a) : "期待: " + show(e) + "\n実際: " + show(a)];
      },
      toBeCloseTo(a, neg, e, digits) {
        if (typeof a !== "number") return [false, "toBeCloseTo は数をくらべます。実際: " + show(a)];
        const d = digits === undefined ? 2 : digits;
        const ok = Math.abs(a - e) < Math.pow(10, -d) / 2;
        return [ok, "期待: " + show(e) + " にほぼ等しい" + (neg ? "ではないこと" : "") + "（小数第" + d + "位まで）\n実際: " + show(a)];
      },
      toBeTruthy(a, neg) { return [!!a, "期待: " + (neg ? "false 扱いの値" : "true 扱いの値") + "\n実際: " + show(a)]; },
      toBeFalsy(a, neg) { return [!a, "期待: " + (neg ? "true 扱いの値" : "false 扱いの値") + "\n実際: " + show(a)]; },
      toBeNull(a, neg) { return [a === null, "期待: " + (neg ? "null 以外" : "null") + "\n実際: " + show(a)]; },
      toBeUndefined(a, neg) { return [a === undefined, "期待: " + (neg ? "undefined 以外" : "undefined") + "\n実際: " + show(a)]; },
      toBeDefined(a, neg) { return [a !== undefined, "期待: " + (neg ? "undefined" : "undefined 以外") + "\n実際: " + show(a)]; },
      toBeNaN(a, neg) { return [Number.isNaN(a), "期待: " + (neg ? "NaN 以外" : "NaN") + "\n実際: " + show(a)]; },
      toBeGreaterThan(a, neg, e) { return [a > e, "期待: " + show(e) + " より大きい" + (neg ? "ではない" : "") + "\n実際: " + show(a)]; },
      toBeGreaterThanOrEqual(a, neg, e) { return [a >= e, "期待: " + show(e) + " 以上" + (neg ? "ではない" : "") + "\n実際: " + show(a)]; },
      toBeLessThan(a, neg, e) { return [a < e, "期待: " + show(e) + " より小さい" + (neg ? "ではない" : "") + "\n実際: " + show(a)]; },
      toBeLessThanOrEqual(a, neg, e) { return [a <= e, "期待: " + show(e) + " 以下" + (neg ? "ではない" : "") + "\n実際: " + show(a)]; },
      toContain(a, neg, e) {
        const ok = (typeof a === "string" || Array.isArray(a)) && a.includes(e);
        return [ok, "期待: " + show(e) + " を" + (neg ? "ふくまない" : "ふくむ") + "\n実際: " + show(a)];
      },
      toHaveLength(a, neg, n) {
        const len = a == null ? undefined : a.length;
        return [len === n, "期待: 長さ " + n + (neg ? " ではない" : "") + "\n実際: 長さ " + show(len) + "（" + show(a) + "）"];
      },
      toThrow(a, neg, expected) {
        if (typeof a !== "function") {
          throw new AssertionError("toThrow には「関数」を渡します。\n書き方: expect(() => 関数(引数)).toThrow()\n（expect(関数(引数)) だと、expect に届く前にエラーが起きてしまいます）");
        }
        let err = null, threw = false;
        try { a(); } catch (e) { threw = true; err = e; }
        let ok = threw, want = "エラーが起きること";
        if (threw && expected !== undefined) {
          if (typeof expected === "function") { ok = err instanceof expected; want = expected.name + " が起きること"; }
          else if (expected instanceof RegExp) { ok = expected.test(String(err && err.message)); want = "メッセージが " + expected + " に合うエラー"; }
          else { ok = String(err && err.message).includes(String(expected)); want = "メッセージに " + show(String(expected)) + " をふくむエラー"; }
        }
        const got = threw ? show(err) + " が起きた" : "エラーは起きなかった";
        return [ok, "期待: " + want + (neg ? "がない" : "") + "\n実際: " + got];
      },
    };

    function makeExpect(counter) {
      return function expect(actual) {
        counter.n++;
        const build = (neg) => {
          const o = {};
          for (const name of Object.keys(MATCHERS)) {
            o[name] = function () {
              const args = [actual, neg].concat(Array.from(arguments));
              const r = MATCHERS[name].apply(null, args);
              if (r[0] === neg) throw new AssertionError((neg ? "not." : "") + name + " が合いません\n" + r[1]);
            };
          }
          return o;
        };
        const m = build(false);
        m.not = build(true);
        return new Proxy(m, {
          get(t, k) {
            if (k in t || typeof k !== "string") return t[k];
            throw new AssertionError("expect(...)." + k + " という書き方はありません。使える書き方は左の「使える書き方」を見てください。");
          },
        });
      };
    }

    function errText(e) {
      if (e && e.name === "AssertionError") return e.message;
      if (e instanceof Error) return e.name + ": " + e.message;
      return "throw された値: " + show(e);
    }

    // implCode を読みこみ、testCode のテストを実行する
    function runSuite(implCode, names, testCode, opts) {
      opts = opts || {};
      let exp;
      try {
        exp = new Function('"use strict";\n' + implCode + "\nreturn {" + names.join(", ") + "};")();
      } catch (e) {
        return { error: { phase: "impl", message: errText(e) } };
      }
      const tests = [], prefix = [];
      const test = function (name, fn) {
        if (typeof fn !== "function") throw new Error("test(名前, () => { ... }) のように、2つ目には関数を渡します");
        tests.push({ name: prefix.concat([String(name)]).join(" › "), fn });
      };
      const describe = function (name, fn) {
        prefix.push(String(name));
        try { fn(); } finally { prefix.pop(); }
      };
      const counter = { n: 0 };
      const expect = makeExpect(counter);
      try {
        const f = new Function("test", "it", "describe", "expect", ...names, '"use strict";\n' + testCode);
        f(test, test, describe, expect, ...names.map((n) => exp[n]));
      } catch (e) {
        const msg = e instanceof SyntaxError
          ? "書き方のまちがい（SyntaxError）: " + e.message + "\nかっこ ( ) { }・カンマ・引用符の閉じ忘れがないか確かめてください。"
          : "テストの外側でエラーが起きました: " + errText(e) + "\nexpect(...) は test(...) の中に書きます。";
        return { error: { phase: "tests", message: msg } };
      }
      const only = opts.only ? new Set(opts.only) : null;
      const results = [];
      for (let i = 0; i < tests.length; i++) {
        if (only && !only.has(i)) continue;
        const t = tests[i];
        counter.n = 0;
        let pass = true, message = "";
        try {
          const r = t.fn();
          if (r && typeof r.then === "function") { pass = false; message = "このツールでは async / Promise を返すテストは使えません。"; }
        } catch (e) {
          pass = false;
          message = errText(e);
          if (!(e && e.name === "AssertionError")) {
            message = "テストの中でエラーが起きました: " + message;
            if (e instanceof Error && /Error$/.test(e.name)) message += "\nヒント: エラーが起きることを確かめたいときは expect(() => ...).toThrow() のように関数で包みます。";
          }
        }
        results.push({ index: i, name: t.name, pass, message, expects: counter.n });
        if (!pass && opts.stopAtFirstFail) break;
      }
      return { tests: results, count: tests.length };
    }

    // 正しいコードで実行 → 通ったテストだけで、バグ入り版を1つずつ実行
    function evaluate(job) {
      const correct = runSuite(job.code, job.names, job.tests);
      if (correct.error) return { error: correct.error };
      const valid = correct.tests.filter((t) => t.pass).map((t) => t.index);
      const mutants = job.mutants.map((code) => {
        if (!valid.length) return { killed: false, by: null };
        const r = runSuite(code, job.names, job.tests, { only: valid, stopAtFirstFail: true });
        if (r.error) return { killed: true, by: null, message: r.error.message };
        const f = r.tests.find((t) => !t.pass);
        return f ? { killed: true, by: f.name, message: f.message } : { killed: false, by: null };
      });
      return { correct: correct.tests, mutants };
    }

    return { runSuite, evaluate, deepEqual, show };
  }

  // ---------------- 採点（画面と Node の両方で使う） ----------------
  const MAX = { detect: 80, names: 8, asserts: 6, focus: 6 };

  function isGoodName(name, all) {
    const n = String(name).trim();
    if ([...n].length < 4) return false;
    if (/^(test|テスト|it)\s*\d*$/i.test(n)) return false;
    return all.filter((x) => x === name).length === 1;
  }

  function score(ex, ev) {
    const out = { total: 0, detect: 0, quality: 0, penalty: 0, notes: [], killed: 0, mutants: ex.mutants.length, tests: 0, invalid: 0 };
    if (ev.error) {
      out.notes.push(ev.error.phase === "impl" ? "対象コードの読みこみに失敗しました。" : "テストを実行できませんでした。");
      return out;
    }
    const tests = ev.correct;
    out.tests = tests.length;
    if (!tests.length) { out.notes.push("test(...) が1つもありません。"); return out; }
    const valid = tests.filter((t) => t.pass);
    out.invalid = tests.length - valid.length;
    out.killed = ev.mutants.filter((m) => m.killed).length;
    out.detect = Math.round((MAX.detect * out.killed) / ex.mutants.length);

    const names = tests.map((t) => t.name);
    const fNames = tests.filter((t) => isGoodName(t.name, names)).length / tests.length;
    const fAsserts = tests.filter((t) => t.expects >= 1).length / tests.length;
    const fFocus = tests.filter((t) => t.expects <= 4).length / tests.length;
    out.parts = {
      names: Math.round(MAX.names * fNames),
      asserts: Math.round(MAX.asserts * fAsserts),
      focus: Math.round(MAX.focus * fFocus),
    };
    out.quality = valid.length ? out.parts.names + out.parts.asserts + out.parts.focus : 0;
    out.penalty = Math.min(30, out.invalid * 10);
    out.total = Math.max(0, Math.min(100, out.detect + out.quality - out.penalty));

    if (out.invalid) out.notes.push(`正しいコードで失敗するテストが ${out.invalid} 個あります（1つにつき −10 点）。テストのほうがまちがっています。`);
    if (fNames < 1) out.notes.push("中身がわかるテスト名をつけましょう（「test1」や同じ名前のくり返しは減点）。");
    if (fAsserts < 1) out.notes.push("expect が1つもないテストがあります。確かめていないテストは、いつでも通ってしまいます。");
    if (fFocus < 1) out.notes.push("expect が5つ以上あるテストがあります。1つのテストでは1つの観点を確かめると、失敗したとき原因が分かりやすくなります。");
    return out;
  }

  function rank(total) {
    if (total >= 100) return { mark: "花丸", label: "満点！すべてのバグを見つけました" };
    if (total >= 90) return { mark: "秀", label: "あと少しで満点" };
    if (total >= 70) return { mark: "優", label: "よく見つけています" };
    if (total >= 50) return { mark: "良", label: "見逃しのヒントを見てみましょう" };
    return { mark: "可", label: "まずは仕様の1行ごとにテストを1つ" };
  }

  const api = { core, score, rank, isGoodName, MAX };
  Object.assign(api, core());
  root.DojoRunner = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
