// テスト書き方道場: 問題集
// code     … 正しい実装
// mutants  … 正しい実装の一部を書きかえた「バグ入り版」。from を to に置きかえる（from はコードの中に1回だけ出てくること）
// starter  … 最初にエディタに入っているテスト
// solution … 模範解答（すべてのバグを見つけられるテスト）
(function (root) {
  "use strict";

  const EXERCISES = [
    {
      id: "fizzbuzz",
      title: "FizzBuzz",
      level: 1,
      names: ["fizzBuzz"],
      signature: "fizzBuzz(n: number): string",
      spec: [
        "3 の倍数なら `\"Fizz\"` を返す",
        "5 の倍数なら `\"Buzz\"` を返す",
        "3 と 5 両方の倍数なら `\"FizzBuzz\"` を返す",
        "それ以外は、その数を **文字列** にして返す（`7` なら `\"7\"`）",
      ],
      lesson: "1つの例だけでは、たまたま合っているだけかもしれません。同じルールに当てはまる例を2つ以上ためしましょう。",
      code: `function fizzBuzz(n) {
  if (n % 15 === 0) return "FizzBuzz";
  if (n % 3 === 0) return "Fizz";
  if (n % 5 === 0) return "Buzz";
  return String(n);
}`,
      mutants: [
        { from: `  if (n % 15 === 0) return "FizzBuzz";\n`, to: ``, kind: "正常系", hint: "3 と 5 の両方の倍数（15 や 30）のときを確かめていますか？" },
        { from: `n % 3 === 0`, to: `n / 3 === 1`, kind: "正常系", hint: "3 以外の 3 の倍数（6 や 9）でも Fizz になりますか？" },
        { from: `n % 5 === 0`, to: `n === 5`, kind: "正常系", hint: "5 以外の 5 の倍数（10 や 20）でも Buzz になりますか？" },
        { from: `return "Buzz"`, to: `return "buzz"`, kind: "正常系", hint: "5 の倍数の結果を、大文字・小文字までぴったり確かめていますか？" },
        { from: `return String(n);`, to: `return n;`, kind: "型", hint: "それ以外の数のとき、数値ではなく「文字列」が返ることを確かめていますか？ toBe は型までくらべます。" },
      ],
      starter: `test("3 の倍数なら Fizz", () => {
  expect(fizzBuzz(3)).toBe("Fizz");
});

// ↓ ここにテストを足していきましょう
`,
      solution: `test("3 の倍数なら Fizz", () => {
  expect(fizzBuzz(3)).toBe("Fizz");
  expect(fizzBuzz(9)).toBe("Fizz");
});

test("5 の倍数なら Buzz", () => {
  expect(fizzBuzz(5)).toBe("Buzz");
  expect(fizzBuzz(10)).toBe("Buzz");
});

test("3 と 5 両方の倍数なら FizzBuzz", () => {
  expect(fizzBuzz(15)).toBe("FizzBuzz");
  expect(fizzBuzz(30)).toBe("FizzBuzz");
});

test("それ以外は数字の文字列", () => {
  expect(fizzBuzz(7)).toBe("7");
});
`,
    },

    {
      id: "leap",
      title: "うるう年",
      level: 1,
      names: ["isLeapYear"],
      signature: "isLeapYear(year: number): boolean",
      spec: [
        "4 で割り切れる年はうるう年（`true`）",
        "ただし 100 で割り切れる年はうるう年ではない（`false`）",
        "ただし 400 で割り切れる年はうるう年",
        "それ以外は `false`",
      ],
      lesson: "「ただし」が出てくる仕様は、ルールごとに1つずつ例を用意するのが基本です。例: 2024・1900・2000・2023。",
      code: `function isLeapYear(year) {
  if (year % 400 === 0) return true;
  if (year % 100 === 0) return false;
  return year % 4 === 0;
}`,
      mutants: [
        { from: `  if (year % 400 === 0) return true;\n`, to: ``, kind: "例外ルール", hint: "400 で割り切れる年（2000 年など）を確かめていますか？" },
        { from: `  if (year % 100 === 0) return false;\n`, to: ``, kind: "例外ルール", hint: "100 で割り切れるが 400 では割り切れない年（1900 年など）を確かめていますか？" },
        { from: `year % 4 === 0;`, to: `year % 2 === 0;`, kind: "正常系", hint: "4 では割り切れない偶数の年（2022 年など）は false になりますか？" },
        { from: `year % 4 === 0;`, to: `year % 4 !== 1;`, kind: "正常系", hint: "うるう年でない年を、1つだけでなくいくつか（2021・2022・2023）ためしましたか？" },
      ],
      starter: `test("4 で割り切れる年はうるう年", () => {
  expect(isLeapYear(2024)).toBe(true);
});

// ↓ ここにテストを足していきましょう
`,
      solution: `test("4 で割り切れる年はうるう年", () => {
  expect(isLeapYear(2024)).toBe(true);
});

test("4 で割り切れない年はうるう年ではない", () => {
  expect(isLeapYear(2021)).toBe(false);
  expect(isLeapYear(2022)).toBe(false);
  expect(isLeapYear(2023)).toBe(false);
});

test("100 で割り切れる年はうるう年ではない", () => {
  expect(isLeapYear(1900)).toBe(false);
});

test("400 で割り切れる年はうるう年", () => {
  expect(isLeapYear(2000)).toBe(true);
});
`,
    },

    {
      id: "grade",
      title: "成績のランク",
      level: 2,
      names: ["grade"],
      signature: "grade(score: number): string",
      spec: [
        "80 点以上は `\"A\"`、60 点以上は `\"B\"`、40 点以上は `\"C\"`、それより下は `\"D\"`",
        "`score` が 0〜100 の **整数** でないときは `RangeError` を投げる",
      ],
      lesson: "バグは「境目」にかくれます。80 と 79、60 と 59、40 と 39、0 と -1、100 と 101 のように、境界の両側をためしましょう（境界値分析）。",
      code: `function grade(score) {
  if (!Number.isInteger(score) || score < 0 || score > 100) {
    throw new RangeError("score は 0〜100 の整数です");
  }
  if (score >= 80) return "A";
  if (score >= 60) return "B";
  if (score >= 40) return "C";
  return "D";
}`,
      mutants: [
        { from: `score >= 80`, to: `score > 80`, kind: "境界値", hint: "ちょうど 80 点のときを確かめていますか？" },
        { from: `score >= 60`, to: `score > 60`, kind: "境界値", hint: "ちょうど 60 点のときを確かめていますか？" },
        { from: `score >= 40`, to: `score >= 39`, kind: "境界値", hint: "39 点（C になる一歩手前）のときを確かめていますか？" },
        { from: `return "D";`, to: `return "F";`, kind: "正常系", hint: "いちばん下のランクの結果を確かめていますか？" },
        { from: ` || score > 100`, to: ``, kind: "異常系", hint: "100 点をこえる点数（101 など）でエラーになりますか？" },
        { from: ` || score < 0`, to: ``, kind: "異常系", hint: "マイナスの点数でエラーになりますか？" },
        { from: `!Number.isInteger(score) || `, to: ``, kind: "異常系", hint: "小数（79.5 など）を渡したときエラーになりますか？" },
      ],
      starter: `test("90 点は A", () => {
  expect(grade(90)).toBe("A");
});

test("100 点をこえるとエラー", () => {
  // エラーを確かめるときは、関数で包んで toThrow を使う
  expect(() => grade(150)).toThrow(RangeError);
});

// ↓ ここにテストを足していきましょう
`,
      solution: `test("80 点以上は A（境界: 80 / 79）", () => {
  expect(grade(80)).toBe("A");
  expect(grade(79)).toBe("B");
});

test("60 点以上は B（境界: 60 / 59）", () => {
  expect(grade(60)).toBe("B");
  expect(grade(59)).toBe("C");
});

test("40 点以上は C（境界: 40 / 39）", () => {
  expect(grade(40)).toBe("C");
  expect(grade(39)).toBe("D");
});

test("0 点と 100 点は有効", () => {
  expect(grade(0)).toBe("D");
  expect(grade(100)).toBe("A");
});

test("範囲外はエラー", () => {
  expect(() => grade(-1)).toThrow(RangeError);
  expect(() => grade(101)).toThrow(RangeError);
});

test("整数でなければエラー", () => {
  expect(() => grade(79.5)).toThrow(RangeError);
});
`,
    },

    {
      id: "sum",
      title: "配列の合計",
      level: 2,
      names: ["sum"],
      signature: "sum(numbers: number[]): number",
      spec: [
        "配列の数をすべて足した値を返す",
        "空の配列なら `0` を返す",
        "マイナスの数や小数が入っていてもよい",
      ],
      lesson: "配列を扱う関数は「空」「1個」「たくさん」の3つに分けて考えると、ループの書きまちがいを見つけやすくなります。",
      code: `function sum(numbers) {
  let total = 0;
  for (let i = 0; i < numbers.length; i++) {
    total += numbers[i];
  }
  return total;
}`,
      mutants: [
        { from: `let i = 0`, to: `let i = 1`, kind: "端", hint: "配列の最初の要素が足されていることを確かめていますか？（最初の要素だけ大きくしてみる）" },
        { from: `i < numbers.length`, to: `i < numbers.length - 1`, kind: "端", hint: "配列の最後の要素が足されていることを確かめていますか？" },
        { from: `return total;`, to: `return numbers.length ? total : null;`, kind: "空", hint: "空の配列 [] のときを確かめていますか？" },
        { from: `total += numbers[i];`, to: `total += Math.abs(numbers[i]);`, kind: "正常系", hint: "マイナスの数が入った配列を確かめていますか？" },
        { from: `total += numbers[i];`, to: `total += Math.floor(numbers[i]);`, kind: "正常系", hint: "小数が入った配列を確かめていますか？" },
      ],
      starter: `test("1, 2, 3 の合計は 6", () => {
  expect(sum([1, 2, 3])).toBe(6);
});

// ↓ ここにテストを足していきましょう
`,
      solution: `test("いくつかの数の合計", () => {
  expect(sum([10, 2, 3])).toBe(15);
  expect(sum([1, 2, 30])).toBe(33);
});

test("空の配列は 0", () => {
  expect(sum([])).toBe(0);
});

test("1個だけなら、その数", () => {
  expect(sum([7])).toBe(7);
});

test("マイナスの数も足せる", () => {
  expect(sum([5, -3])).toBe(2);
});

test("小数も足せる", () => {
  expect(sum([0.5, 0.25])).toBe(0.75);
});
`,
    },

    {
      id: "average",
      title: "平均",
      level: 3,
      names: ["average"],
      signature: "average(numbers: number[]): number",
      spec: [
        "配列の数の平均を返す",
        "割り切れないときは小数で返す（四捨五入しない）",
        "空の配列のときは `Error` を投げる",
      ],
      lesson: "小数は計算誤差が出ます（0.1 + 0.2 は 0.30000000000000004）。小数の結果は toBe ではなく toBeCloseTo でくらべましょう。",
      code: `function average(numbers) {
  if (numbers.length === 0) {
    throw new Error("空の配列の平均は計算できません");
  }
  let total = 0;
  for (const n of numbers) total += n;
  return total / numbers.length;
}`,
      mutants: [
        { from: `throw new Error("空の配列の平均は計算できません");`, to: `return 0;`, kind: "異常系", hint: "空の配列でエラーになることを確かめていますか？" },
        { from: `numbers.length === 0`, to: `numbers.length <= 1`, kind: "端", hint: "要素が1個だけの配列を確かめていますか？" },
        { from: `return total / numbers.length;`, to: `return Math.round(total / numbers.length);`, kind: "正常系", hint: "割り切れない平均（[1, 2] → 1.5 など）を確かめていますか？" },
        { from: `return total / numbers.length;`, to: `return total / (numbers.length + 1);`, kind: "正常系", hint: "答えが分かりやすい例で、平均の値そのものを確かめていますか？" },
        { from: `total += n;`, to: `total += n > 0 ? n : 0;`, kind: "正常系", hint: "マイナスの数が入った配列を確かめていますか？" },
      ],
      starter: `test("2 と 4 の平均は 3", () => {
  expect(average([2, 4])).toBe(3);
});

// ↓ ここにテストを足していきましょう
`,
      solution: `test("割り切れる平均", () => {
  expect(average([2, 4])).toBe(3);
});

test("割り切れない平均は小数", () => {
  expect(average([1, 2])).toBeCloseTo(1.5);
  expect(average([0.1, 0.2])).toBeCloseTo(0.15);
});

test("1個だけなら、その数", () => {
  expect(average([5])).toBe(5);
});

test("マイナスの数も平均できる", () => {
  expect(average([-2, 4])).toBe(1);
});

test("空の配列はエラー", () => {
  expect(() => average([])).toThrow();
});
`,
    },

    {
      id: "price",
      title: "クーポンの値引き",
      level: 3,
      names: ["calcPrice"],
      signature: "calcPrice(price: number, coupon?: string): number",
      spec: [
        "クーポンなし（省略）なら、`price` をそのまま返す",
        "`\"SALE10\"` は 10% 引き。1 円未満は **切り捨て**",
        "`\"OFF500\"` は 500 円引き。ただし 0 円より安くはならない",
        "知らないクーポンは `Error`、`price` がマイナスなら `RangeError` を投げる（0 円はOK）",
      ],
      lesson: "「切り捨て」「0 円より下にならない」のような細かいルールは、それが効いてくる値（端数が .5 以上になる値、500 円より安い値）を選んでためします。",
      code: `function calcPrice(price, coupon) {
  if (price < 0) throw new RangeError("price は 0 以上です");
  let result = price;
  if (coupon === "SALE10") {
    result = price * 0.9;
  } else if (coupon === "OFF500") {
    result = price - 500;
  } else if (coupon !== undefined) {
    throw new Error("使えないクーポンです: " + coupon);
  }
  return Math.max(0, Math.floor(result));
}`,
      mutants: [
        { from: `price * 0.9`, to: `price * 0.1`, kind: "正常系", hint: "SALE10 を使ったときの金額を確かめていますか？" },
        { from: `Math.floor(result)`, to: `Math.round(result)`, kind: "端数", hint: "端数が .5 以上になる金額（995 円の 10% 引き = 895.5 など）で、切り捨てになっていますか？" },
        { from: `Math.max(0, `, to: `Math.max(-Infinity, `, kind: "境界値", hint: "500 円より安い商品に OFF500 を使ったとき、0 円になりますか？" },
        { from: `throw new Error("使えないクーポンです: " + coupon);`, to: `result = price;`, kind: "異常系", hint: "知らないクーポンを渡したとき、エラーになりますか？" },
        { from: `price < 0`, to: `price <= 0`, kind: "境界値", hint: "ちょうど 0 円のときはエラーにならず 0 が返りますか？" },
        { from: `  if (price < 0) throw new RangeError("price は 0 以上です");\n`, to: ``, kind: "異常系", hint: "マイナスの金額でエラーになりますか？" },
      ],
      starter: `test("クーポンなしなら、そのままの値段", () => {
  expect(calcPrice(1000)).toBe(1000);
});

// ↓ ここにテストを足していきましょう
`,
      solution: `test("クーポンなしなら、そのままの値段", () => {
  expect(calcPrice(1000)).toBe(1000);
});

test("SALE10 は 10% 引き", () => {
  expect(calcPrice(1000, "SALE10")).toBe(900);
});

test("SALE10 の 1 円未満は切り捨て", () => {
  expect(calcPrice(995, "SALE10")).toBe(895);
});

test("OFF500 は 500 円引き", () => {
  expect(calcPrice(1200, "OFF500")).toBe(700);
});

test("OFF500 でも 0 円より安くならない", () => {
  expect(calcPrice(300, "OFF500")).toBe(0);
});

test("0 円の商品は 0 円", () => {
  expect(calcPrice(0)).toBe(0);
});

test("知らないクーポンはエラー", () => {
  expect(() => calcPrice(1000, "FREE")).toThrow("使えないクーポン");
});

test("マイナスの金額はエラー", () => {
  expect(() => calcPrice(-1)).toThrow(RangeError);
});
`,
    },

    {
      id: "password",
      title: "パスワードの点検",
      level: 4,
      names: ["checkPassword"],
      signature: "checkPassword(pw: string): string[]",
      spec: [
        "問題点のメッセージを配列で返す。問題がなければ空の配列 `[]`",
        "8 文字より短い → `\"8文字以上にしてください\"`",
        "数字（0〜9）がない → `\"数字を入れてください\"`",
        "大文字（A〜Z）がない → `\"大文字を入れてください\"`",
        "問題が複数あるときは、上の順番ですべて返す",
      ],
      lesson: "配列やオブジェクトの中身をくらべるときは toBe ではなく toEqual を使います。条件が3つあるなら「1つだけ満たさない」例を3つ作ると、どの条件が壊れたかすぐ分かります。",
      code: `function checkPassword(pw) {
  const problems = [];
  if (pw.length < 8) problems.push("8文字以上にしてください");
  if (!/[0-9]/.test(pw)) problems.push("数字を入れてください");
  if (!/[A-Z]/.test(pw)) problems.push("大文字を入れてください");
  return problems;
}`,
      mutants: [
        { from: `pw.length < 8`, to: `pw.length <= 8`, kind: "境界値", hint: "ちょうど 8 文字のパスワードは OK になりますか？" },
        { from: `pw.length < 8`, to: `pw.length < 7`, kind: "境界値", hint: "7 文字のパスワードは「短い」と言われますか？" },
        { from: `/[0-9]/`, to: `/[1-9]/`, kind: "端", hint: "数字が 0 だけのパスワード（\"Password0\" など）は OK になりますか？" },
        { from: `/[A-Z]/`, to: `/[A-Za-z]/`, kind: "正常系", hint: "小文字しかないパスワードで「大文字を入れてください」と言われますか？" },
        { from: `return problems;`, to: `return problems.slice(0, 1);`, kind: "組み合わせ", hint: "問題が2つ以上あるとき、すべてのメッセージが返りますか？（toEqual で配列ごとくらべる）" },
      ],
      starter: `test("条件をすべて満たせば問題なし", () => {
  expect(checkPassword("Secret123")).toEqual([]);
});

// ↓ ここにテストを足していきましょう
`,
      solution: `test("条件をすべて満たせば問題なし", () => {
  expect(checkPassword("Secret123")).toEqual([]);
});

test("ちょうど 8 文字は OK、7 文字は短い", () => {
  expect(checkPassword("Abcdef12")).toEqual([]);
  expect(checkPassword("Abcde12")).toEqual(["8文字以上にしてください"]);
});

test("数字がない", () => {
  expect(checkPassword("Password")).toEqual(["数字を入れてください"]);
});

test("数字が 0 だけでも OK", () => {
  expect(checkPassword("Password0")).toEqual([]);
});

test("大文字がない", () => {
  expect(checkPassword("password1")).toEqual(["大文字を入れてください"]);
});

test("問題が複数あれば、すべて順番に返す", () => {
  expect(checkPassword("abc")).toEqual([
    "8文字以上にしてください",
    "数字を入れてください",
    "大文字を入れてください",
  ]);
});
`,
    },

    {
      id: "stack",
      title: "スタック",
      level: 4,
      names: ["Stack"],
      signature: "new Stack() / push(x) / pop() / peek() / size",
      spec: [
        "`push(x)` で上に積む。同じ値を何度積んでもよい",
        "`pop()` は **いちばん最後に積んだ** 値を取り出して返す。空なら `Error` を投げる",
        "`peek()` はいちばん上の値を **取り出さずに** 返す。空なら `undefined`",
        "`size` は積んである数",
      ],
      lesson: "状態を持つクラスは「操作の順番」でテストします。準備（Arrange）→ 操作（Act）→ 確認（Assert）の3段に分けて書くと読みやすくなります。",
      code: `class Stack {
  constructor() {
    this.items = [];
  }
  push(x) {
    this.items.push(x);
  }
  pop() {
    if (this.items.length === 0) throw new Error("スタックが空です");
    return this.items.pop();
  }
  peek() {
    if (this.items.length === 0) return undefined;
    return this.items[this.items.length - 1];
  }
  get size() {
    return this.items.length;
  }
}`,
      mutants: [
        { from: `return this.items.pop();`, to: `return this.items.shift();`, kind: "順番", hint: "2つ以上積んだあと pop すると、最後に積んだほうが出てきますか？" },
        { from: `return this.items[this.items.length - 1];`, to: `return this.items.pop();`, kind: "副作用", hint: "peek したあとも値が残っている（size が減らない）ことを確かめていますか？" },
        { from: `return this.items[this.items.length - 1];`, to: `return this.items[0];`, kind: "順番", hint: "2つ以上積んだとき、peek はいちばん上の値を返しますか？" },
        { from: `    if (this.items.length === 0) throw new Error("スタックが空です");\n`, to: ``, kind: "異常系", hint: "空のスタックで pop するとエラーになりますか？" },
        { from: `if (this.items.length === 0) return undefined;`, to: `if (this.items.length === 0) throw new Error("スタックが空です");`, kind: "異常系", hint: "空のスタックで peek すると、エラーではなく undefined が返りますか？" },
        { from: `    this.items.push(x);\n`, to: `    if (!this.items.includes(x)) this.items.push(x);\n`, kind: "正常系", hint: "同じ値を2回積んだとき、size が 2 になりますか？" },
      ],
      starter: `test("push すると size が増える", () => {
  const s = new Stack();
  s.push(10);
  expect(s.size).toBe(1);
});

// ↓ ここにテストを足していきましょう
`,
      solution: `test("新しいスタックは空", () => {
  const s = new Stack();
  expect(s.size).toBe(0);
  expect(s.peek()).toBeUndefined();
});

test("pop は最後に積んだ値を返す", () => {
  const s = new Stack();
  s.push(1);
  s.push(2);
  expect(s.pop()).toBe(2);
  expect(s.size).toBe(1);
});

test("peek は上の値を取り出さずに返す", () => {
  const s = new Stack();
  s.push(1);
  s.push(2);
  expect(s.peek()).toBe(2);
  expect(s.size).toBe(2);
});

test("同じ値を何度も積める", () => {
  const s = new Stack();
  s.push("a");
  s.push("a");
  expect(s.size).toBe(2);
});

test("空のスタックで pop するとエラー", () => {
  expect(() => new Stack().pop()).toThrow();
});
`,
    },
  ];

  // バグ入り版のコードを作る
  function mutantCode(ex, i) {
    const m = ex.mutants[i];
    const at = ex.code.indexOf(m.from);
    if (at < 0 || ex.code.indexOf(m.from, at + 1) >= 0) throw new Error(`${ex.id} の mutant ${i} の from がちょうど1回見つかりません`);
    return ex.code.slice(0, at) + m.to + ex.code.slice(at + m.from.length);
  }

  // 何行目が変わったか（答え合わせの表示用）
  function mutantDiff(ex, i) {
    const a = ex.code.split("\n"), b = mutantCode(ex, i).split("\n");
    let s = 0;
    while (s < a.length && s < b.length && a[s] === b[s]) s++;
    let ea = a.length - 1, eb = b.length - 1;
    while (ea >= s && eb >= s && a[ea] === b[eb]) { ea--; eb--; }
    return { line: s + 1, before: a.slice(s, ea + 1), after: b.slice(s, eb + 1) };
  }

  const api = { EXERCISES, mutantCode, mutantDiff };
  root.DojoExercises = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
