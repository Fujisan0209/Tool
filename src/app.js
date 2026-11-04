/* 画面の動き。analyzer.js と rules.js を先に読みこんでください。 */
(function () {
  "use strict";
  const { analyze } = window.JavaErrorAnalyzer;

  const SAMPLES = [
    {
      label: "セミコロン忘れ",
      text: `Main.java:3: エラー: ';'がありません
        System.out.println("こんにちは")
                                        ^
エラー1個`,
    },
    {
      label: "変数が見つからない",
      text: `Main.java:5: error: cannot find symbol
        System.out.println(cont);
                           ^
  symbol:   variable cont
  location: class Main
1 error`,
    },
    {
      label: "Scanner の import 忘れ",
      text: `Main.java:3: エラー: シンボルを見つけられません
        Scanner sc = new Scanner(System.in);
        ^
  シンボル:   クラス Scanner
  場所: クラス Main
エラー1個`,
    },
    {
      label: "型が合わない",
      text: `Main.java:4: エラー: 不適合な型: Stringをintに変換できません:
        int age = "20";
                  ^
エラー1個`,
    },
    {
      label: "全角スペース",
      text: `Main.java:3: エラー: '\\u3000'は不正な文字です
        int　x = 1;
           ^
エラー1個`,
    },
    {
      label: "NullPointerException",
      text: `Exception in thread "main" java.lang.NullPointerException: Cannot invoke "String.length()" because "name" is null
	at Main.main(Main.java:6)`,
    },
    {
      label: "配列の範囲外",
      text: `Exception in thread "main" java.lang.ArrayIndexOutOfBoundsException: Index 3 out of bounds for length 3
	at Main.main(Main.java:8)`,
    },
    {
      label: "メインクラスがない",
      text: `エラー: メイン・クラスMain.classを検出およびロードできませんでした
原因: java.lang.ClassNotFoundException: Main.class`,
    },
  ];

  const FIRST_SAMPLE = `Main.java:4: エラー: 不適合な型: Stringをintに変換できません:
        int age = "20";
                  ^
Main.java:5: エラー: シンボルを見つけられません
        System.out.println(agee);
                           ^
  シンボル:   変数 agee
  場所: クラス Main
エラー2個`;

  const $ = (id) => document.getElementById(id);
  const input = $("err-input");
  const results = $("results");
  const summary = $("summary");
  const sampleNote = $("sample-note");
  const samplesBox = $("samples");

  /** `code` を <code> にして、文字列を安全に要素へ入れる */
  function rich(el, text) {
    const parts = String(text).split(/`([^`]+)`/);
    parts.forEach((p, i) => {
      if (i % 2) {
        const c = document.createElement("code");
        c.textContent = p;
        el.appendChild(c);
      } else if (p) {
        p.split("\n").forEach((line, j) => {
          if (j) el.appendChild(document.createElement("br"));
          el.appendChild(document.createTextNode(line));
        });
      }
    });
    return el;
  }

  function h(tag, cls, text) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined) rich(el, text);
    return el;
  }

  function locationText(loc) {
    if (!loc) return "";
    return `${loc.file} の ${loc.line} 行目` + (loc.method ? `（${loc.method.split(".").pop()} メソッドの中）` : "");
  }

  function renderItem(item, index, total) {
    const card = h("article", `card kind-${item.kind}`);
    card.setAttribute("aria-labelledby", `card-title-${index}`);

    const head = h("header", "card-head");
    const meta = h("div", "card-meta");
    if (total > 1) meta.appendChild(h("span", "card-num", `${index + 1} / ${total}`));
    meta.appendChild(h("span", "chip", item.kindLabel || "エラー"));
    if (item.severity === "warning") meta.appendChild(h("span", "chip chip-warn", "警告（動きはする）"));
    if (item.location) meta.appendChild(h("span", "where", locationText(item.location)));
    head.appendChild(meta);
    const title = h("h2", "card-title", item.title);
    title.id = `card-title-${index}`;
    head.appendChild(title);
    card.appendChild(head);

    if (item.original) {
      const orig = h("div", "original");
      orig.appendChild(h("span", "label", "元のメッセージ"));
      const pre = h("code", "original-text");
      pre.textContent = item.original;
      orig.appendChild(pre);
      card.appendChild(orig);
    }

    if (item.snippet) {
      const sn = h("div", "snippet");
      sn.setAttribute("aria-label", "エラーが起きたコード");
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      // コードの行と ^ の行から、共通の先頭スペースを取りのぞく（^ の位置はずれない）
      const lead = (s) => s.match(/^ */)[0].length;
      const cut = Math.min(lead(item.snippet.code), lead(item.snippet.caret));
      code.textContent = item.snippet.code.slice(cut).replace(/\s+$/, "");
      pre.appendChild(code);
      pre.appendChild(document.createTextNode("\n"));
      const caret = h("span", "caret");
      caret.textContent = item.snippet.caret.slice(cut).replace(/\s+$/, "") + " ここ";
      pre.appendChild(caret);
      sn.appendChild(pre);
      card.appendChild(sn);
    }

    const body = h("div", "card-body");
    const what = h("section", "sec sec-what");
    what.appendChild(h("h3", "", "なにが起きた？"));
    what.appendChild(h("p", "", item.what));
    body.appendChild(what);

    if (item.causes && item.causes.length) {
      const s = h("section", "sec sec-cause");
      s.appendChild(h("h3", "", "よくある原因"));
      const ul = h("ul");
      item.causes.forEach((c) => ul.appendChild(h("li", "", c)));
      s.appendChild(ul);
      body.appendChild(s);
    }

    if (item.fixes && item.fixes.length) {
      const s = h("section", "sec sec-fix");
      s.appendChild(h("h3", "", "なおし方"));
      const ul = h("ul");
      item.fixes.forEach((c) => ul.appendChild(h("li", "", c)));
      s.appendChild(ul);
      body.appendChild(s);
    }
    card.appendChild(body);

    if (item.example) {
      const ex = h("div", "example");
      [
        ["bad", "まちがい", item.example.bad],
        ["good", "正しい", item.example.good],
      ].forEach(([cls, label, src]) => {
        const box = h("figure", `ex ex-${cls}`);
        box.appendChild(h("figcaption", "", label));
        const pre = document.createElement("pre");
        const code = document.createElement("code");
        code.textContent = src;
        pre.appendChild(code);
        box.appendChild(pre);
        ex.appendChild(box);
      });
      card.appendChild(ex);
    }
    return card;
  }

  function render() {
    const { items, unknown } = analyze(input.value);
    results.replaceChildren();

    if (!input.value.trim()) {
      summary.replaceChildren(rich(h("p", "summary-text"), "左の欄に、`javac` や `java` が出したエラーをそのまま貼りつけてください。"));
      summary.dataset.state = "empty";
      return;
    }
    if (!items.length) {
      summary.replaceChildren(
        rich(
          h("p", "summary-text"),
          "エラーの形が読み取れませんでした。`Main.java:5: error:` や `Exception in thread \"main\"` で始まる行を含めて、まるごと貼りつけてみてください。"
        )
      );
      summary.dataset.state = "unknown";
      return;
    }

    const errors = items.filter((i) => i.severity !== "warning").length;
    let msg = `${items.length} 個のエラーが見つかりました。`;
    if (items.length > 1)
      msg += " まずは **1つ目** から直しましょう。1つのまちがいが、後ろのエラーを次々と起こしていることがよくあります。";
    else msg += " 下の説明を読んで直したら、保存してもう一度実行してみましょう。";
    if (!errors) msg = "警告だけです。プログラムは動きますが、直しておくと安心です。";
    const p = h("p", "summary-text");
    msg.split(/\*\*(.+?)\*\*/).forEach((part, i) => {
      if (i % 2) p.appendChild(h("strong", "", part));
      else rich(p, part);
    });
    summary.replaceChildren(p);
    summary.dataset.state = unknown ? "unknown" : "ok";

    items.forEach((it, i) => results.appendChild(renderItem(it, i, items.length)));
  }

  let timer = 0;
  input.addEventListener("input", () => {
    sampleNote.hidden = true;
    clearTimeout(timer);
    timer = setTimeout(render, 200);
  });

  $("err-form").addEventListener("submit", (e) => {
    e.preventDefault();
    render();
  });

  $("clear-btn").addEventListener("click", () => {
    input.value = "";
    sampleNote.hidden = true;
    render();
    input.focus();
  });

  SAMPLES.forEach((s) => {
    const b = h("button", "sample-btn", s.label);
    b.type = "button";
    b.addEventListener("click", () => {
      input.value = s.text;
      sampleNote.hidden = false;
      render();
    });
    samplesBox.appendChild(b);
  });

  // 最初は例を表示しておく（何をするツールか、すぐわかるように）
  if (!input.value.trim()) {
    input.value = FIRST_SAMPLE;
    sampleNote.hidden = false;
  }
  render();
})();
