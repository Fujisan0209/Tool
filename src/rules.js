/*
 * Javaのエラーメッセージと「やさしい説明」の対応表。
 *
 * 1つのルールは次の形です。
 *   id      : テストなどで使う名前
 *   kind    : "compile"（コンパイル時） / "runtime"（実行時） / "env"（環境・コマンド）
 *   match   : エラーメッセージにマッチする正規表現（英語・日本語の両方）
 *   build   : (m, ctx) => ({ title, what, causes, fixes, example })
 *             m   = match の結果
 *             ctx = { block: エラー全体の文字列 }
 *
 * 説明文の中の `...` はコードとして表示されます。
 * 上から順に調べるので、細かいルールほど上に置いてください。
 */
(function (root) {
  "use strict";

  /** 正規表現の最初に見つかったキャプチャを返す */
  function pick(m) {
    for (let i = 1; i < m.length; i++) if (m[i] !== undefined) return m[i];
    return "";
  }

  /** ctx.block から、英語/日本語どちらかのラベル付きの行を取り出す */
  function field(block, labels) {
    const re = new RegExp("^\\s*(?:" + labels.join("|") + ")\\s*[:：]\\s*(.+)$", "m");
    const m = block.match(re);
    return m ? m[1].trim() : "";
  }

  /** よく import を忘れるクラス */
  const IMPORTS = {
    Scanner: "java.util.Scanner",
    ArrayList: "java.util.ArrayList",
    List: "java.util.List",
    HashMap: "java.util.HashMap",
    Map: "java.util.Map",
    HashSet: "java.util.HashSet",
    Set: "java.util.Set",
    Random: "java.util.Random",
    Arrays: "java.util.Arrays",
    Collections: "java.util.Collections",
    LinkedList: "java.util.LinkedList",
    LocalDate: "java.time.LocalDate",
    BufferedReader: "java.io.BufferedReader",
    InputStreamReader: "java.io.InputStreamReader",
    IOException: "java.io.IOException",
    File: "java.io.File",
    FileReader: "java.io.FileReader",
    FileWriter: "java.io.FileWriter",
  };

  /** 大文字・小文字をまちがえやすい名前 */
  const CASE_MISTAKES = {
    string: "String",
    system: "System",
    scanner: "Scanner",
    integer: "Integer",
    math: "Math",
    Println: "println",
    PrintLn: "println",
  };

  const RULES = [];
  const rule = (r) => RULES.push(r);

  /* ------------------------------------------------------------------ */
  /* 環境・コマンドのエラー                                              */
  /* ------------------------------------------------------------------ */

  rule({
    id: "command-not-found",
    kind: "env",
    match: /'(javac?)'\s*は、内部コマンドまたは外部コマンド|'(javac?)' is not recognized|(?:^|\s)(javac?): (?:command not found|コマンドが見つかりません)|command not found: (javac?)/m,
    build: (m) => {
      const cmd = pick(m);
      return {
        title: `パソコンが「${cmd}」コマンドを知りません`,
        what: `\`${cmd}\` というコマンドが見つかりませんでした。Javaのプログラムが悪いのではなく、パソコンの準備（設定）の問題です。`,
        causes: [
          "JDK（Javaの開発セット）がインストールされていない",
          "インストールはしたが、PATH（コマンドの場所）の設定をしていない",
          "設定のあと、ターミナル（コマンドプロンプト）を開き直していない",
        ],
        fixes: [
          "`java -version` と打って、Javaが入っているか確かめる",
          "入っていなければ JDK をインストールする（Oracle JDK や Eclipse Temurin など）",
          "環境変数 PATH に JDK の `bin` フォルダを追加し、ターミナルを開き直す",
        ],
      };
    },
  });

  rule({
    id: "javac-file-not-found",
    kind: "env",
    match: /file not found: (\S+)|ファイルが見つかりません: (\S+)/,
    build: (m) => {
      const f = pick(m);
      return {
        title: `ファイル「${f}」が見つかりません`,
        what: `\`javac\` に \`${f}\` をコンパイルするよう頼みましたが、そのファイルが今いるフォルダにありませんでした。`,
        causes: [
          "ターミナルで今いるフォルダが、ファイルを保存したフォルダとちがう",
          "ファイル名のつづりや大文字・小文字がちがう（`main.java` と `Main.java` は別物）",
          "ファイルの拡張子が `.java.txt` などになっている",
        ],
        fixes: [
          "`cd` コマンドでファイルがあるフォルダへ移動する",
          "`dir`（Windows）や `ls`（Mac/Linux）でファイル名を確認する",
          "ファイル名を確かめて、そのとおりに `javac ファイル名.java` と打つ",
        ],
      };
    },
  });

  rule({
    id: "main-class-not-found",
    kind: "env",
    match: /Could not find or load main class (\S+)|メイン・クラス\s*(\S+?)\s*を検出およびロードできませんでした/,
    build: (m) => {
      const cls = pick(m);
      const withExt = /\.(java|class)$/.test(cls);
      return {
        title: `クラス「${cls}」が見つからず、実行できません`,
        what: `\`java\` コマンドで \`${cls}\` を動かそうとしましたが、そのクラスが見つかりませんでした。`,
        causes: [
          withExt
            ? `\`java ${cls}\` のように拡張子を付けている（\`java\` コマンドにはクラス名だけを書く）`
            : "先に `javac` でコンパイルしていない（`.class` ファイルがない）",
          "クラス名の大文字・小文字がちがう",
          "`.class` ファイルがあるフォルダとちがう場所で実行している",
          "`package` を書いているのに、パッケージ名を付けずに実行している",
        ],
        fixes: [
          "`javac Main.java` でコンパイルしてから `java Main` で実行する（`.class` は付けない）",
          "コードの `public class ○○` の名前とまったく同じ名前で実行する",
          "Java 11 以降なら `java Main.java` で、コンパイルと実行を一度にすることもできる",
        ],
        example: {
          bad: "java Main.class",
          good: "javac Main.java\njava Main",
        },
      };
    },
  });

  rule({
    id: "main-method-not-found",
    kind: "env",
    match: /Main method not found in class (\w+)|メイン・メソッドがクラス\s*(\w+)\s*で見つかりません/,
    build: (m) => {
      const cls = pick(m);
      return {
        title: `クラス「${cls}」に main メソッドがありません`,
        what: "Javaのプログラムは `main` メソッドからスタートします。そのスタート地点が見つかりませんでした。",
        causes: [
          "`main` メソッドを書いていない",
          "`main` のつづりや形がちがう（`Main`、`static` 忘れ、`String[] args` 忘れなど）",
        ],
        fixes: ["次の形を、1文字もまちがえずに書く"],
        example: {
          bad: "public void main() {",
          good: "public static void main(String[] args) {",
        },
      };
    },
  });

  rule({
    id: "unsupported-class-version",
    kind: "env",
    match: /UnsupportedClassVersionError|has been compiled by a more recent version/,
    build: () => ({
      title: "コンパイルしたJavaと、実行するJavaのバージョンがちがいます",
      what: "新しいバージョンの `javac` で作った `.class` ファイルを、古いバージョンの `java` で動かそうとしました。",
      causes: [
        "パソコンに複数のJavaが入っていて、`javac` と `java` で別のものが使われている",
        "IDE（Eclipse や IntelliJ など）の設定と、ターミナルのJavaがちがう",
      ],
      fixes: [
        "`javac -version` と `java -version` を打って、数字が同じか確かめる",
        "PATH の設定を直して、同じバージョンのJavaを使う",
      ],
    }),
  });

  /* ------------------------------------------------------------------ */
  /* コンパイルエラー（細かいものから順に）                              */
  /* ------------------------------------------------------------------ */

  rule({
    id: "fullwidth-space",
    kind: "compile",
    match: /illegal character: '\\u3000'|'\\u3000'は不正な文字です/,
    build: () => ({
      title: "全角スペースがまざっています",
      what: "コードの中に、日本語入力の全角スペース（`　`）が入っています。Javaは全角スペースを空白として扱えません。",
      causes: ["日本語入力がオンのままスペースキーを押した", "Webや資料からコードをコピーした"],
      fixes: [
        "エラーの行にある空白を全部消して、半角スペースで打ち直す",
        "エディタの「全角スペースを表示する」設定をオンにすると見つけやすい",
      ],
      example: { bad: "int　x = 5;   // ← 全角スペース", good: "int x = 5;" },
    }),
  });

  rule({
    id: "illegal-character",
    kind: "compile",
    match: /illegal character: '(.+?)'|'(.+?)'は不正な文字です/,
    build: (m) => {
      const ch = pick(m);
      return {
        title: "Javaで使えない文字がまざっています",
        what: `\`${ch}\` という文字はJavaのコードとして使えません。多くの場合、日本語入力の「全角」の記号が原因です。`,
        causes: [
          "`；` `（` `）` `｛` `”` など、全角の記号を使っている",
          "Webや資料からコピーしたときに、見えない文字や特殊な引用符が入った",
        ],
        fixes: [
          "日本語入力をオフにして、エラーの行の記号を半角で打ち直す",
          "`\"` は半角のダブルクォーテーションを使う（`“ ”` はダメ）",
        ],
        example: { bad: "System.out.println（“Hello”）；", good: 'System.out.println("Hello");' },
      };
    },
  });

  rule({
    id: "unmappable-character",
    kind: "compile",
    match: /unmappable character|マップできない文字|マッピングできない文字|マップできません/,
    build: () => ({
      title: "ファイルの文字コードが合っていません",
      what: "ファイルに書かれた日本語を、`javac` が正しく読み取れませんでした。ファイルの保存形式（文字コード）と、`javac` が想定している文字コードがちがいます。",
      causes: [
        "ファイルは UTF-8 で保存されているのに、Windows の `javac` が Shift_JIS（MS932）として読んでいる",
        "またはその逆",
      ],
      fixes: [
        "`javac -encoding UTF-8 Main.java` のように文字コードを指定してコンパイルする",
        "または、エディタでファイルを開いて、文字コードを選び直して保存する",
      ],
    }),
  });

  rule({
    id: "unclosed-string",
    kind: "compile",
    match: /unclosed string literal|文字列リテラルが閉じられていません/,
    build: () => ({
      title: "文字列の「\"」が閉じられていません",
      what: "文字列は `\"` で始めて `\"` で終わる必要があります。終わりの `\"` が見つかりませんでした。",
      causes: [
        "最後の `\"` を書き忘れた",
        "片方が全角の `”` になっている",
        "文字列の中で `\"` を使いたいのに `\\\"` と書いていない",
      ],
      fixes: ["文字列の最後に半角の `\"` を付ける", "文字列の中の `\"` は `\\\"` と書く"],
      example: { bad: 'System.out.println("こんにちは);', good: 'System.out.println("こんにちは");' },
    }),
  });

  rule({
    id: "char-literal",
    kind: "compile",
    match: /unclosed character literal|empty character literal|文字リテラルが閉じられていません|空の文字リテラルです/,
    build: () => ({
      title: "「'」（シングルクォーテーション）の使い方がまちがっています",
      what: "Javaでは `'` は「1文字だけ」を表すときに使います（`char` 型）。2文字以上の文字列には `\"` を使います。",
      causes: ["文字列を `'` で囲んでいる", "`''` のように中身が空になっている", "閉じる `'` を忘れた"],
      fixes: ["文字列なら `\"` で囲む", "1文字なら `'A'` のように1文字だけを入れる"],
      example: { bad: "String s = 'Hello';", good: 'String s = "Hello";' },
    }),
  });

  rule({
    id: "class-expected",
    kind: "compile",
    match: /class, interface\b.*?expected|class, interface\b.*?がありません|クラス、インタフェース.*?がありません/,
    build: () => ({
      title: "クラスの外に、よけいなものがあります",
      what: "Javaのコードは、ほとんど全部をクラスの `{ }` の中に書きます。クラスの外に、メソッドや `}` などが書かれていました。",
      causes: [
        "`}` が多すぎて、クラスが途中で閉じてしまった",
        "メソッドをクラスの `}` の後ろに書いた",
        "`import` 文をクラスの中や後ろに書いた",
      ],
      fixes: [
        "`{` と `}` の数が同じか数える（エディタで自動整形すると見つけやすい）",
        "メソッドはクラスの `{ }` の中に移動する",
      ],
      example: {
        bad: "public class Main {\n    public static void main(String[] args) {\n    }\n}\n}   // ← 多い",
        good: "public class Main {\n    public static void main(String[] args) {\n    }\n}",
      },
    }),
  });

  rule({
    id: "semicolon-expected",
    kind: "compile",
    match: /';'\s*expected|';'がありません/,
    build: () => ({
      title: "「;」（セミコロン）が抜けています",
      what: "Javaでは、1つの命令（文）の終わりに必ず `;` を書きます。`;` がないと、どこで命令が終わるのかわかりません。",
      causes: [
        "行の最後に `;` を書き忘れた（いちばん多い！）",
        "全角の `；` を書いている",
        "その行の前後で、かっこや `\"` の数が合っていない",
      ],
      fixes: [
        "エラーの行（またはその1つ前の行）の最後に半角の `;` を付ける",
        "`^` マークの場所の近くを見る",
      ],
      example: { bad: 'System.out.println("Hello")', good: 'System.out.println("Hello");' },
    }),
  });

  rule({
    id: "symbol-expected",
    kind: "compile",
    match: /<identifier> expected|<(?:identifier|識別子)>がありません/,
    build: () => ({
      title: "名前（変数名など）があるべき場所に、ちがうものがあります",
      what: "Javaが「ここには名前（変数名・メソッド名など）が来るはず」と思った場所に、別のものがありました。",
      causes: [
        "`System.out.println(...)` などの命令を、メソッドの外（クラスの中に直接）書いた",
        "変数の型だけ書いて、名前を書き忘れた",
        "名前に使えない記号や予約語（`class` `int` など）を使った",
      ],
      fixes: ["命令は `main` などのメソッドの `{ }` の中に書く", "変数は「型 名前」の順で書く"],
      example: {
        bad: 'public class Main {\n    System.out.println("Hi");\n}',
        good: 'public class Main {\n    public static void main(String[] args) {\n        System.out.println("Hi");\n    }\n}',
      },
    }),
  });

  rule({
    id: "reached-eof",
    kind: "compile",
    match: /reached end of file while parsing|構文解析中にファイルの終わりに移りました/,
    build: () => ({
      title: "「}」が足りないまま、ファイルが終わっています",
      what: "`{` に対応する `}` が見つからないまま、ファイルの最後まで来てしまいました。",
      causes: ["最後の `}` を書き忘れた", "`if` や `for` の `}` をどこかで閉じ忘れた"],
      fixes: [
        "`{` と `}` の数を数えて、足りない分の `}` を足す",
        "インデント（字下げ）をそろえると、閉じ忘れの場所がわかりやすい",
      ],
      example: {
        bad: 'public class Main {\n    public static void main(String[] args) {\n        System.out.println("Hi");\n    }',
        good: 'public class Main {\n    public static void main(String[] args) {\n        System.out.println("Hi");\n    }\n}',
      },
    }),
  });

  rule({
    id: "cannot-find-symbol",
    kind: "compile",
    match: /cannot find symbol|シンボルを見つけられません/,
    build: (m, ctx) => {
      const sym = field(ctx.block, ["symbol", "シンボル"]);
      const loc = field(ctx.block, ["location", "場所"]);
      // 例: "variable x" / "変数 x" / "method foo(int)" / "class Scanner"
      const sm = sym.match(/^(variable|method|class|変数|メソッド|クラス)\s+(\S+)/);
      const kindWord = sm ? sm[1] : "";
      const name = sm ? sm[2].replace(/\(.*$/, "") : sym;
      const kind =
        /variable|変数/.test(kindWord) ? "変数" : /method|メソッド/.test(kindWord) ? "メソッド" : /class|クラス/.test(kindWord) ? "クラス" : "名前";

      const causes = [];
      const fixes = [];
      let example;

      if (IMPORTS[name]) {
        causes.push(`\`${name}\` を使うのに必要な \`import\` を書いていない`);
        fixes.push(`ファイルのいちばん上（\`public class\` より上）に \`import ${IMPORTS[name]};\` を書く`);
        example = {
          bad: "public class Main {\n    public static void main(String[] args) {\n        " + name + " x = ...;",
          good: `import ${IMPORTS[name]};\n\npublic class Main {\n    public static void main(String[] args) {\n        ${name} x = ...;`,
        };
      }
      if (name && CASE_MISTAKES[name]) {
        causes.unshift(`大文字・小文字のまちがい。正しくは \`${CASE_MISTAKES[name]}\` です`);
        fixes.unshift(`\`${name}\` を \`${CASE_MISTAKES[name]}\` に直す`);
        example = { bad: `${name} ...`, good: `${CASE_MISTAKES[name]} ...` };
      }
      if (kind === "変数") {
        causes.push(
          "名前のつづりまちがい、または大文字・小文字のまちがい（`count` と `Count` は別物）",
          "変数を宣言（`int x = 0;` など）する前に使っている",
          "変数を作った `{ }` の外で使っている（`for` や `if` の中で作った変数は外では使えない）"
        );
        fixes.push("宣言した名前と、使っている名前を1文字ずつ見比べる", "使う場所より前で、型を付けて宣言する");
        if (!example)
          example = {
            bad: "for (int i = 0; i < 3; i++) {\n    int sum = i;\n}\nSystem.out.println(sum); // ← {}の外",
            good: "int sum = 0;\nfor (int i = 0; i < 3; i++) {\n    sum = i;\n}\nSystem.out.println(sum);",
          };
      } else if (kind === "メソッド") {
        causes.push(
          "メソッド名のつづりまちがい（`printIn` ← 正しくは `println`（小文字のL））",
          "そのメソッドをまだ作っていない",
          "引数の数や型が、作ったメソッドと合っていない",
          "別のクラスのメソッドなのに、クラス名や変数名を付けずに呼んでいる"
        );
        fixes.push("メソッドを作ったときの名前と、呼び出している名前を見比べる");
      } else if (kind === "クラス") {
        causes.push("クラス名のつづりまちがい（クラス名は大文字で始まる）", "`import` を書き忘れた", "自分で作ったクラスのファイルが同じフォルダにない");
        fixes.push("クラス名を確認する", "標準ライブラリのクラスなら `import` 文を書く");
      } else {
        causes.push("名前のつづりまちがい", "宣言や `import` の書き忘れ");
        fixes.push("名前のつづりを確かめる");
      }

      return {
        title: name ? `${kind}「${name}」が見つかりません` : "名前が見つかりません",
        what:
          `Javaは \`${name || "?"}\` という${kind}を知りません。` +
          (loc ? `（探した場所: \`${loc}\`）` : "") +
          " 「まだ作っていない」か「名前がちがう」のどちらかがほとんどです。",
        causes: [...new Set(causes)],
        fixes: [...new Set(fixes)],
        example,
      };
    },
  });

  rule({
    id: "lossy-conversion",
    kind: "compile",
    match: /possible lossy conversion from (\w+) to (\w+)|精度が失われる可能性がある(\w+)から(\w+)への変換/,
    build: (m) => {
      const from = m[1] || m[3];
      const to = m[2] || m[4];
      return {
        title: `${from} を ${to} に入れると、値の一部が消えるかもしれません`,
        what: `\`${from}\` は \`${to}\` より大きい（または細かい）値を入れられる型です。そのまま入れると情報が失われるかもしれないので、Javaが止めました。`,
        causes: [
          `\`${to}\` 型の変数に \`${from}\` 型の値を入れようとした`,
          "計算の途中で型が変わった（例: `int` と `double` を計算すると答えは `double`）",
        ],
        fixes: [
          `変数の型を \`${from}\` に変える`,
          `小数点以下を切り捨ててもよいなら、\`(${to})\` を付けて型を変換（キャスト）する`,
        ],
        example: { bad: `${to} x = 3.7;`, good: `${to} x = (${to}) 3.7;   // または  double x = 3.7;` },
      };
    },
  });

  rule({
    id: "incompatible-types",
    kind: "compile",
    match: /incompatible types|不適合な型/,
    build: (m, ctx) => {
      const c =
        ctx.block.match(/(\S+) cannot be converted to (\S+)/) ||
        ctx.block.match(/([^\s:：]+)を([^\s:：]+)に変換できません/);
      const from = c ? c[1] : "";
      const to = c ? c[2] : "";
      const causes = [];
      const fixes = [];
      let example;
      if (/^String$/.test(from) && /^(int|double|long)$/.test(to)) {
        const fn = to === "int" ? "Integer.parseInt" : to === "double" ? "Double.parseDouble" : "Long.parseLong";
        causes.push(`文字列（\`String\`）は、見た目が数字でもそのまま \`${to}\` にはなりません`);
        fixes.push(`\`${fn}(文字列)\` で数字に変換する`);
        example = { bad: `${to} n = "123";`, good: `${to} n = ${fn}("123");` };
      } else if (/^(int|double|long|char|boolean)$/.test(from) && to === "String") {
        causes.push("数字はそのまま `String` 型の変数に入れられません");
        fixes.push("`String.valueOf(数字)` を使う", '`"" + 数字` のように文字列とつなげる');
        example = { bad: "String s = 10;", good: "String s = String.valueOf(10);" };
      } else if (to === "boolean") {
        causes.push("`if` や `while` の `( )` の中で、`==`（比べる）ではなく `=`（入れる）を使っている");
        fixes.push("比べるときは `==` を使う");
        example = { bad: "if (x = 5) {", good: "if (x == 5) {" };
      } else {
        causes.push("変数の型と、入れようとしている値の型がちがう", "メソッドの戻り値の型と、`return` している値の型がちがう");
        fixes.push("変数の型を、入れたい値に合わせる", "値の方を変数の型に合わせて変換する");
      }
      return {
        title: from && to ? `${from} 型は ${to} 型に入れられません` : "型が合っていません",
        what:
          (from && to ? `\`${from}\` 型の値を、\`${to}\` 型の場所に入れようとしました。` : "") +
          "Javaでは、変数に決めた型と、入れる値の型が合っていないといけません。",
        causes,
        fixes,
        example,
      };
    },
  });

  rule({
    id: "public-class-filename",
    kind: "compile",
    match: /class (\w+) is public, should be declared in a file named (\S+)|クラス\s*(\w+)\s*はpublicであり、ファイル\s*(\S+?)\s*で宣言する必要があります/,
    build: (m) => {
      const cls = m[1] || m[3];
      const file = m[2] || m[4];
      return {
        title: "クラス名とファイル名が合っていません",
        what: `\`public class ${cls}\` は、\`${file}\` という名前のファイルに書く決まりです。今のファイル名がちがいます。`,
        causes: ["ファイル名とクラス名の大文字・小文字がちがう", "クラス名を変えたのに、ファイル名を変えていない"],
        fixes: [`ファイル名を \`${file}\` に変える`, "または、コードのクラス名をファイル名に合わせる"],
        example: { bad: `ファイル名: main.java\npublic class ${cls} {`, good: `ファイル名: ${file}\npublic class ${cls} {` },
      };
    },
  });

  rule({
    id: "missing-return",
    kind: "compile",
    match: /missing return statement|return文が指定されていません/,
    build: () => ({
      title: "return（答えを返す）が足りません",
      what: "このメソッドは値を返すと決めた（`void` 以外の型を書いた）のに、`return` せずに終わってしまう道があります。",
      causes: [
        "`return` を書き忘れた",
        "`if` の中にしか `return` がなく、条件に合わないときに何も返さない",
      ],
      fixes: ["メソッドのいちばん最後にも `return` を書く", "値を返さないメソッドなら、戻り値の型を `void` にする"],
      example: {
        bad: "static int check(int x) {\n    if (x > 0) {\n        return 1;\n    }\n}",
        good: "static int check(int x) {\n    if (x > 0) {\n        return 1;\n    }\n    return 0;\n}",
      },
    }),
  });

  rule({
    id: "not-initialized",
    kind: "compile",
    match: /variable (\w+) might not have been initialized|変数\s*(\w+)\s*は初期化されていない可能性があります/,
    build: (m) => {
      const v = pick(m);
      return {
        title: `変数「${v}」にまだ値が入っていません`,
        what: `\`${v}\` を使おうとしましたが、まだ一度も値を入れていない（または入れない場合がある）ので、中身がわかりません。`,
        causes: ["変数を宣言しただけで、値を入れていない", "`if` の中だけで値を入れていて、入らない場合がある"],
        fixes: ["宣言するときに最初の値（`0` や `\"\"` など）を入れておく"],
        example: { bad: `int ${v};\nSystem.out.println(${v});`, good: `int ${v} = 0;\nSystem.out.println(${v});` },
      };
    },
  });

  rule({
    id: "unreachable",
    kind: "compile",
    match: /unreachable statement|この文に制御が移ることはありません/,
    build: () => ({
      title: "絶対に実行されない行があります",
      what: "`return` や `break` のあとに書いた行は、そこでメソッドやループが終わるので、絶対に実行されません。Javaはこれをエラーにします。",
      causes: ["`return` / `break` / `continue` のあとに処理を書いた", "終わらない無限ループ（`while (true)`）のあとに処理を書いた"],
      fixes: ["その行を `return` などより前に移す", "いらない行なら消す"],
      example: {
        bad: 'return x;\nSystem.out.println("おわり");',
        good: 'System.out.println("おわり");\nreturn x;',
      },
    }),
  });

  rule({
    id: "not-a-statement",
    kind: "compile",
    match: /not a statement|文ではありません/,
    build: () => ({
      title: "命令になっていない行があります",
      what: "その行は、計算や値だけが書かれていて「何をするか」がわかりません。",
      causes: ["`x + 1;` のように、計算結果をどこにも入れていない", "`;` の位置がおかしい", "`==` と `=` をまちがえた"],
      fixes: ["計算結果を変数に入れる（`x = x + 1;`）", "表示したいなら `System.out.println(...)` で囲む"],
      example: { bad: "x + 1;", good: "x = x + 1;" },
    }),
  });

  rule({
    id: "illegal-start",
    kind: "compile",
    match: /illegal start of (expression|type)|(式|型)の開始が不正です/,
    build: () => ({
      title: "書いてはいけない場所に、書いてはいけないものがあります",
      what: "Javaが文の始まりとして読めないものがありました。多くの場合、その少し前で、かっこの閉じ忘れなどのまちがいが起きています。",
      causes: [
        "メソッドの中に、別のメソッドを書いた（`}` の閉じ忘れが原因のことが多い）",
        "メソッドの中の変数に `public` や `static` を付けた",
        "`(` や `{` の閉じ忘れ",
      ],
      fixes: [
        "エラーの行より上の `{` と `}`、`(` と `)` の数を確かめる",
        "メソッドの中の変数からは `public` / `static` を外す",
      ],
      example: {
        bad: "public static void main(String[] args) {\n    public int x = 5;",
        good: "public static void main(String[] args) {\n    int x = 5;",
      },
    }),
  });

  rule({
    id: "static-context",
    kind: "compile",
    match: /non-static (variable|method) (\S+) cannot be referenced from a static context|staticでない(変数|メソッド)\s*(\S+?)\s*をstaticコンテキストから参照することはできません/,
    build: (m) => {
      const kind = /variable|変数/.test(m[1] || m[3]) ? "変数" : "メソッド";
      const name = (m[2] || m[4]).replace(/\(.*$/, "");
      return {
        title: `static ではない${kind}「${name}」を main から直接使っています`,
        what: `\`main\` は \`static\` なメソッドです。\`static\` なメソッドからは、\`static\` が付いていない${kind}を直接使えません。`,
        causes: [`\`${name}\` を作るときに \`static\` を付け忘れた`],
        fixes: [
          `いちばん簡単: \`${name}\` の宣言に \`static\` を付ける`,
          "または、`new` でクラスのオブジェクトを作ってから、それを通して使う",
        ],
        example:
          kind === "メソッド"
            ? { bad: `void ${name}() {`, good: `static void ${name}() {` }
            : { bad: `int ${name} = 0;`, good: `static int ${name} = 0;` },
      };
    },
  });

  rule({
    id: "already-defined",
    kind: "compile",
    match: /variable (\w+) is already defined|変数\s*(\w+)\s*はすでに.*?で定義されています/,
    build: (m) => {
      const v = pick(m);
      return {
        title: `変数「${v}」を2回作っています`,
        what: `同じ場所で \`${v}\` という名前の変数を2回宣言しました。同じ名前の変数は1つしか作れません。`,
        causes: [`2回目なのに \`int ${v} = ...\` のように型を付けて書いた`],
        fixes: ["2回目以降は型を付けずに `" + v + " = ...;` と書く（値を入れなおすだけ）", "または、別の名前にする"],
        example: { bad: `int ${v} = 1;\nint ${v} = 2;`, good: `int ${v} = 1;\n${v} = 2;` },
      };
    },
  });

  rule({
    id: "unreported-exception",
    kind: "compile",
    match: /unreported exception (\S+?);|例外\s*(\S+?)\s*は報告されません/,
    build: (m) => {
      const ex = pick(m);
      const short = ex.split(".").pop();
      return {
        title: `「${short}」が起きたときの対策が書かれていません`,
        what: `使っている命令は \`${short}\`（エラーの一種）を起こすことがあります。Javaは、そのときどうするかを決めておくよう求めています。`,
        causes: ["ファイルの読み書きや `Thread.sleep` など、失敗する可能性がある命令を使った"],
        fixes: [
          "`try { ... } catch (" + short + " e) { ... }` で囲む",
          "または、メソッドの宣言に `throws " + short + "` を付ける（練習ではこちらが簡単）",
        ],
        example: {
          bad: "public static void main(String[] args) {",
          good: `public static void main(String[] args) throws ${short} {`,
        },
      };
    },
  });

  rule({
    id: "cannot-be-applied",
    kind: "compile",
    match: /(method|constructor) (\w+) in (?:class|enum|interface) (\w+) cannot be applied to given types|(?:クラス|列挙型|インタフェース)\s*(\w+)\s*の(メソッド|コンストラクタ)\s*(\w+)\s*は指定された型に適用できません/,
    build: (m, ctx) => {
      const isCtor = /constructor|コンストラクタ/.test(m[1] || m[5]);
      const name = m[2] || m[6];
      const required = field(ctx.block, ["required", "期待値"]);
      const found = field(ctx.block, ["found", "検出値"]);
      const what =
        `\`${name}\` に渡した引数（かっこの中身）の数や型が、作ったときの決まりと合っていません。` +
        (required || found ? `\n必要なもの: \`${required || "?"}\`　渡したもの: \`${found || "?"}\`` : "");
      return {
        title: `${isCtor ? "コンストラクタ" : "メソッド"}「${name}」に渡したものが合っていません`,
        what: what.replace(/no arguments|引数がありません/g, "なし"),
        causes: ["引数の数が多すぎる・少なすぎる", "引数の順番や型がちがう（`int` が必要なところに `String` など）"],
        fixes: [`\`${name}\` を作ったところを見て、引数の数・型・順番をそろえる`],
        example: {
          bad: "static int add(int a, int b) { ... }\nadd(1);",
          good: "static int add(int a, int b) { ... }\nadd(1, 2);",
        },
      };
    },
  });

  rule({
    id: "bad-operand",
    kind: "compile",
    match: /bad operand types? for (?:binary|unary) operator '(.+?)'|(?:二項|単項)演算子\s*'(.+?)'\s*のオペランド型が不正です/,
    build: (m, ctx) => {
      const op = pick(m);
      const first = field(ctx.block, ["first type", "最初の型"]);
      const second = field(ctx.block, ["second type", "2番目の型"]);
      const causes = ["その型どうしでは使えない記号を使った"];
      let example;
      if (op === "&&" || op === "||") {
        causes.unshift("`&&` の左右が、両方とも条件（`true` か `false`）になっていない");
        example = { bad: "if (x > 0 && < 10) {", good: "if (x > 0 && x < 10) {" };
      } else if (/[-*/%]/.test(op) && (first === "String" || second === "String")) {
        causes.unshift("文字列（`String`）で引き算・かけ算・割り算をしようとした");
        example = { bad: 'String s = "10";\nint n = s - 1;', good: 'String s = "10";\nint n = Integer.parseInt(s) - 1;' };
      }
      return {
        title: `「${op}」をこの型には使えません`,
        what:
          `記号 \`${op}\` は、使える型が決まっています。` +
          (first ? `今は \`${first}\`${second ? ` と \`${second}\`` : ""} に使おうとしています。` : ""),
        causes,
        fixes: ["左右の型を確かめる", "文字列を数字にしたいときは `Integer.parseInt(...)` を使う"],
        example,
      };
    },
  });

  rule({
    id: "return-type-required",
    kind: "compile",
    match: /invalid method declaration; return type required|無効なメソッド宣言です。戻り値の型が必要です/,
    build: () => ({
      title: "メソッドの戻り値の型が書かれていません",
      what: "メソッドを作るときは、名前の前に「何を返すか」の型を書きます。何も返さないなら `void` と書きます。",
      causes: ["`void` などの型を書き忘れた", "コンストラクタのつもりで書いたが、名前がクラス名とちがう"],
      fixes: ["メソッド名の前に `void`（または `int` など）を書く", "コンストラクタなら、名前をクラス名とまったく同じにする"],
      example: { bad: "public static hello() {", good: "public static void hello() {" },
    }),
  });

  rule({
    id: "else-without-if",
    kind: "compile",
    match: /'else' without 'if'|'else'への'if'がありません/,
    build: () => ({
      title: "else に対応する if がありません",
      what: "`else` は `if` のすぐ後ろでしか使えません。その間に何か別のものが入っています。",
      causes: [
        "`if (...)` のすぐ後ろに `;` を付けてしまった",
        "`if` の中が2行以上あるのに `{ }` で囲んでいない",
        "`}` の位置がずれている",
      ],
      fixes: ["`if (...)` の後ろの `;` を消す", "`if` と `else` の中身は必ず `{ }` で囲む"],
      example: {
        bad: 'if (x > 0);\n    System.out.println("正");\nelse\n    System.out.println("負");',
        good: 'if (x > 0) {\n    System.out.println("正");\n} else {\n    System.out.println("負");\n}',
      },
    }),
  });

  rule({
    id: "final-assign",
    kind: "compile",
    match: /cannot assign a value to final variable (\w+)|final変数\s*(\w+)\s*に値を代入することはできません/,
    build: (m) => {
      const v = pick(m);
      return {
        title: `「${v}」は final なので、あとから変えられません`,
        what: `\`final\` が付いた変数は、最初に1回だけ値を入れられます。\`${v}\` に2回目の値を入れようとしました。`,
        causes: ["定数（変えない値）として作った変数を変えようとした"],
        fixes: ["値を変えたいなら、宣言から `final` を外す", "変えないつもりなら、値を入れなおしている行を消す"],
      };
    },
  });

  rule({
    id: "cannot-dereference",
    kind: "compile",
    match: /(\w+) cannot be dereferenced|(\w+)は間接参照できません/,
    build: (m) => {
      const t = pick(m);
      return {
        title: `${t} 型には「.」でメソッドを使えません`,
        what: `\`${t}\` は基本の型（プリミティブ型）なので、\`.length()\` や \`.equals()\` のように \`.\` を付けてメソッドを呼べません。`,
        causes: [
          "`int` などの変数に `.equals()` や `.length()` を使った",
          "`String` だと思っていた変数が、じつは `int` や `char` だった",
        ],
        fixes: ["数字どうしを比べるなら `==` を使う", "文字列に変換したいなら `String.valueOf(...)` を使う"],
        example: { bad: "int a = 5;\nif (a.equals(5)) {", good: "int a = 5;\nif (a == 5) {" },
      };
    },
  });

  rule({
    id: "missing-method-body",
    kind: "compile",
    match: /missing method body, or declare abstract|メソッド本体がないか、abstractとして宣言されています/,
    build: () => ({
      title: "メソッドの中身 { } がありません",
      what: "メソッドの宣言のすぐ後ろに `;` があり、中身の `{ }` がありません。",
      causes: ["メソッドの `( )` の後ろに `;` を付けてしまった"],
      fixes: ["`( )` の後ろの `;` を消して、`{ }` で中身を書く"],
      example: {
        bad: "public static void hello();\n{\n    ...\n}",
        good: "public static void hello() {\n    ...\n}",
      },
    }),
  });

  rule({
    id: "abstract-not-overridden",
    kind: "compile",
    match: /is not abstract and does not override abstract method (\w+)|abstractでなく、.*?abstractメソッド\s*(\w+)/,
    build: (m) => {
      const meth = pick(m);
      return {
        title: `メソッド「${meth}」を作り忘れています`,
        what: `\`implements\` したインタフェース（または \`extends\` した抽象クラス）が「必ず作ってね」と決めている \`${meth}\` を、まだ書いていません。`,
        causes: ["メソッドを書き忘れた", "メソッド名や引数の型が少しちがう"],
        fixes: [`\`${meth}\` メソッドを、決められたとおりの名前・引数で書く`, "メソッドの上に `@Override` を付けると、まちがいに気づきやすい"],
      };
    },
  });

  rule({
    id: "break-outside",
    kind: "compile",
    match: /break outside switch or loop|breakがswitch文またはループの外にあります/,
    build: () => ({
      title: "break を、ループや switch の外で使っています",
      what: "`break` は「ループや `switch` から抜ける」命令なので、その中でしか使えません。",
      causes: ["`if` から抜けるつもりで `break` を書いた", "`}` の位置がずれて、ループの外に出てしまった"],
      fixes: ["メソッドを終わりたいなら `return;` を使う", "`{ }` の位置を確かめる"],
    }),
  });

  rule({
    id: "array-required",
    kind: "compile",
    match: /array required, but (\S+) found|配列が要求されましたが、(\S+?)が見つかりました/,
    build: (m) => {
      const t = pick(m);
      return {
        title: `${t} は配列ではないので [ ] は使えません`,
        what: `\`[0]\` のような書き方は配列にしか使えません。\`${t}\` 型の変数に使おうとしました。`,
        causes: ["配列ではない変数に `[ ]` を付けた", "文字列の1文字を取りたかった"],
        fixes: ["文字列の1文字なら `s.charAt(0)` を使う", "ArrayList なら `list.get(0)` を使う"],
        example: { bad: 'String s = "abc";\nchar c = s[0];', good: 'String s = "abc";\nchar c = s.charAt(0);' },
      };
    },
  });

  // 「○○がありません」はいろいろなメッセージに含まれるので、いちばん最後に調べる
  rule({
    id: "token-expected",
    kind: "compile",
    match: /'([^']+)'(?:\s*or\s*'[^']+')*\s*expected|'([^']+)'(?:または'[^']+')*がありません/,
    build: (m) => {
      const t = pick(m);
      const names = { ")": "閉じかっこ「)」", "(": "かっこ「(」", "}": "「}」", "{": "「{」", "]": "「]」", "=": "「=」", ".": "「.」" };
      const name = names[t] || `「${t}」`;
      const fixes = [`エラーの行の \`^\` マークのあたりに \`${t}\` を足す`];
      let example;
      if (t === ")") {
        fixes.push("`(` と `)` の数が同じか数える");
        example = { bad: 'System.out.println("Hello";', good: 'System.out.println("Hello");' };
      } else if (t === "(") {
        example = { bad: "if x > 0 {", good: "if (x > 0) {" };
      }
      return {
        title: `${name} が足りません`,
        what: `Javaは、この場所に \`${t}\` があるはずだと思っています。何かを書き忘れたか、書き方の順番がちがいます。`,
        causes: [
          `\`${t}\` を書き忘れた`,
          "かっこの数が合っていない",
          "全角の記号を使っている",
          "1つ前の行にまちがいがある（エラーの場所が少しずれることがある）",
        ],
        fixes,
        example,
      };
    },
  });

  /* ------------------------------------------------------------------ */
  /* 実行時エラー（例外）                                                */
  /* ------------------------------------------------------------------ */

  rule({
    id: "null-pointer",
    kind: "runtime",
    match: /NullPointerException/,
    build: (m, ctx) => {
      const why = ctx.block.match(/because "(.+?)" is null/);
      const name = why ? why[1].replace(/^<local\d+>$/, "（ある変数）") : "";
      return {
        title: name ? `「${name}」が空っぽ（null）なのに使おうとしました` : "空っぽ（null）のものを使おうとしました",
        what:
          "`null` は「何も入っていない」という意味です。中身がないものに対して、`.` でメソッドを呼んだり、要素を取り出したりしました。",
        causes: [
          "変数を作っただけで `new` していない",
          "配列を作ったが、中の一つひとつに値を入れていない（`String[]` の中身は最初 `null`）",
          "メソッドが `null` を返したのに、そのまま使った",
        ],
        fixes: [
          "エラーの行で `.` の左側にある変数に、ちゃんと値が入っているか確かめる",
          "使う前に `new` したり、値を入れたりする",
          "心配なら `if (x != null)` で確かめてから使う",
        ],
        example: { bad: "String s = null;\nSystem.out.println(s.length());", good: 'String s = "abc";\nSystem.out.println(s.length());' },
      };
    },
  });

  rule({
    id: "array-index",
    kind: "runtime",
    match: /ArrayIndexOutOfBoundsException(?::\s*(?:Index (-?\d+) out of bounds for length (\d+)|(-?\d+)))?/,
    build: (m) => {
      const idx = m[1] || m[3];
      const len = m[2];
      return {
        title: idx !== undefined ? `配列の ${idx} 番目はありません` : "配列の範囲の外を使おうとしました",
        what:
          (len !== undefined
            ? `この配列の長さは ${len} なので、使える番号は \`0\` 〜 \`${len - 1}\` です。\`${idx}\` 番目を使おうとしました。`
            : "配列の番号（インデックス）が、ある範囲の外でした。") +
          " 配列の番号は `0` から始まるので、最後の番号は「長さ − 1」です。",
        causes: [
          "`for` の条件を `i <= 配列.length` にしている（正しくは `<`）",
          "番号が `1` から始まると思っていた",
          "マイナスの番号を使った",
        ],
        fixes: ["`for` の条件を `i < 配列.length` にする", "番号を数えなおす"],
        example: {
          bad: "int[] a = new int[3];\nfor (int i = 0; i <= a.length; i++) {",
          good: "int[] a = new int[3];\nfor (int i = 0; i < a.length; i++) {",
        },
      };
    },
  });

  rule({
    id: "string-index",
    kind: "runtime",
    match: /StringIndexOutOfBoundsException/,
    build: (m, ctx) => {
      const r =
        ctx.block.match(/[Ii]ndex:? (-?\d+),? (?:out of bounds for )?length:? (\d+)/) ||
        ctx.block.match(/begin (-?\d+), end (-?\d+), length (\d+)/);
      let detail = "";
      if (r && r.length === 3) detail = `この文字列は ${r[2]} 文字なので、使える番号は \`0\` 〜 \`${r[2] - 1}\` です。\`${r[1]}\` 番目を使おうとしました。`;
      else if (r && r.length === 4) detail = `この文字列は ${r[3]} 文字ですが、\`${r[1]}\` 〜 \`${r[2]}\` を取り出そうとしました。`;
      return {
        title: "文字列の範囲の外を使おうとしました",
        what: detail + " 文字列の番号は `0` から始まり、最後は「文字数 − 1」です。",
        causes: ["`charAt` や `substring` に、文字数より大きい番号を渡した", "空の文字列 `\"\"` に `charAt(0)` を使った"],
        fixes: ["`s.length()` で文字数を確かめてから使う", "`for` の条件を `i < s.length()` にする"],
        example: { bad: 'String s = "abc";\nchar c = s.charAt(3);', good: 'String s = "abc";\nchar c = s.charAt(2);' },
      };
    },
  });

  rule({
    id: "list-index",
    kind: "runtime",
    match: /\bIndexOutOfBoundsException(?::\s*Index:? (-?\d+),? (?:out of bounds for length|Size:) (\d+))?/,
    build: (m) => {
      const idx = m[1];
      const len = m[2];
      return {
        title: "リスト（ArrayList など）の範囲の外を使おうとしました",
        what:
          (len !== undefined ? `このリストには ${len} 個しか入っていません。\`${idx}\` 番目を使おうとしました。` : "") +
          " リストの番号は `0` から始まり、最後は「`size()` − 1」です。",
        causes: ["`for` の条件が `i <= list.size()` になっている", "まだ何も `add` していないリストから `get` した"],
        fixes: ["`for` の条件を `i < list.size()` にする", "`list.size()` で中身の数を確かめる"],
      };
    },
  });

  rule({
    id: "divide-by-zero",
    kind: "runtime",
    match: /ArithmeticException: (?:\/ by zero|ゼロ)/,
    build: () => ({
      title: "0 で割り算をしました",
      what: "整数（`int` など）は 0 で割ることができません。割る数が 0 になっていました。",
      causes: ["割る数の変数が 0 のままだった", "`%`（あまり）でも 0 で割るとエラーになる"],
      fixes: ["割る前に `if (b != 0)` で確かめる", "割る数がなぜ 0 になったのか、値を表示して確かめる"],
      example: { bad: "int avg = sum / count;", good: "if (count != 0) {\n    int avg = sum / count;\n}" },
    }),
  });

  rule({
    id: "number-format",
    kind: "runtime",
    match: /NumberFormatException(?:: For input string: "(.*?)")?/,
    build: (m) => {
      const s = m[1];
      return {
        title: s !== undefined ? `「${s}」は数字に変換できません` : "数字ではない文字を、数字に変換しようとしました",
        what: "`Integer.parseInt` などは、数字だけでできた文字列しか変換できません。",
        causes: [
          "数字以外の文字（ひらがな、アルファベット）が入っていた",
          "前後に空白が入っていた",
          "全角の数字（`１２３`）を使っていた",
          "小数（`3.5`）を `Integer.parseInt` で変換しようとした（`Double.parseDouble` を使う）",
          "空の文字列 `\"\"` を変換しようとした",
        ],
        fixes: ["入力する値を確かめる", "`.trim()` で前後の空白を取ってから変換する"],
        example: { bad: 'int n = Integer.parseInt(" 12 ");', good: 'int n = Integer.parseInt(" 12 ".trim());' },
      };
    },
  });

  rule({
    id: "input-mismatch",
    kind: "runtime",
    match: /InputMismatchException/,
    build: () => ({
      title: "入力した値の種類が、読みこむ型と合っていません",
      what: "`Scanner` の `nextInt()` で数字を読もうとしましたが、入力されたのは数字ではありませんでした。",
      causes: ["数字を入力するところで文字を入力した", "小数を `nextInt()` で読もうとした（`nextDouble()` を使う）", "全角の数字を入力した"],
      fixes: ["半角の数字を入力する", "読みこむメソッド（`nextInt` / `nextDouble` / `next`）を入力に合わせる"],
    }),
  });

  rule({
    id: "no-such-element",
    kind: "runtime",
    match: /NoSuchElementException/,
    build: () => ({
      title: "読みこむものが、もうありません",
      what: "`Scanner` で入力を読もうとしましたが、入力がもう残っていませんでした。",
      causes: [
        "入力する前にプログラムが終わった（オンライン実行環境で入力欄が空など）",
        "`Scanner` を `close()` したあとで、また読もうとした",
        "`next()` を呼ぶ回数が、入力の数より多い",
      ],
      fixes: ["実行するときに入力を用意する", "`Scanner` は1つだけ作って使い回し、最後に1回だけ `close()` する"],
    }),
  });

  rule({
    id: "class-cast",
    kind: "runtime",
    match: /ClassCastException(?::\s*class (\S+) cannot be cast to class (\S+))?/,
    build: (m) => {
      const a = m[1] ? m[1].split(".").pop() : "";
      const b = m[2] ? m[2].split(".").pop() : "";
      return {
        title: a ? `${a} を ${b} に変換（キャスト）できません` : "型の変換（キャスト）に失敗しました",
        what: "`(型名)` で型を変えようとしましたが、中身が本当はちがう型だったので変換できませんでした。",
        causes: ["`Object` 型などに入っていたものを、ちがう型だと思ってキャストした"],
        fixes: ["`instanceof` で型を確かめてからキャストする", "最初から正しい型で変数やリストを作る（`ArrayList<String>` など）"],
      };
    },
  });

  rule({
    id: "stack-overflow",
    kind: "runtime",
    match: /StackOverflowError/,
    build: () => ({
      title: "メソッドが自分自身を呼び続けて止まりません",
      what: "メソッドが自分を呼ぶ（再帰）ときに、終わりがなくて無限に呼び続け、メモリがあふれました。",
      causes: ["再帰の「終わる条件」を書いていない", "終わる条件に、いつまでもたどり着かない"],
      fixes: ["`if (n == 0) return ...;` のような終わる条件を、いちばん最初に書く", "呼ぶたびに値が終わりに近づいているか確かめる"],
      example: {
        bad: "static int f(int n) {\n    return n * f(n - 1);\n}",
        good: "static int f(int n) {\n    if (n <= 1) return 1;\n    return n * f(n - 1);\n}",
      },
    }),
  });

  rule({
    id: "out-of-memory",
    kind: "runtime",
    match: /OutOfMemoryError/,
    build: () => ({
      title: "メモリが足りなくなりました",
      what: "プログラムがメモリをたくさん使いすぎて、足りなくなりました。",
      causes: ["終わらないループの中で、リストに `add` し続けている", "とても大きい配列を作った"],
      fixes: ["ループがちゃんと終わるか確かめる", "配列の大きさを確かめる"],
    }),
  });

  rule({
    id: "concurrent-modification",
    kind: "runtime",
    match: /ConcurrentModificationException/,
    build: () => ({
      title: "ループで回している途中に、リストを変えました",
      what: "拡張 `for` 文（`for (String s : list)`）で回している最中に、そのリストに `add` や `remove` をしました。",
      causes: ["ループの中で `list.remove(...)` や `list.add(...)` をした"],
      fixes: ["`list.removeIf(...)` を使う", "`Iterator` の `remove()` を使う", "消したいものを別のリストに集めて、ループのあとで消す"],
      example: {
        bad: 'for (String s : list) {\n    if (s.isEmpty()) list.remove(s);\n}',
        good: "list.removeIf(s -> s.isEmpty());",
      },
    }),
  });

  rule({
    id: "file-not-found-runtime",
    kind: "runtime",
    match: /FileNotFoundException(?::\s*(\S+))?/,
    build: (m) => ({
      title: m[1] ? `ファイル「${m[1]}」が開けません` : "ファイルが開けません",
      what: "プログラムが読もうとしたファイルが見つかりませんでした（または開く権限がありませんでした）。",
      causes: ["ファイル名のつづりがちがう", "ファイルが、プログラムを実行したフォルダにない", "ファイルが他のアプリで開かれていてロックされている"],
      fixes: ["ファイルの場所を確かめる", "ファイルのパスを、フォルダ名も含めて正しく書く"],
    }),
  });

  const api = { RULES, IMPORTS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.JavaErrorRules = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
