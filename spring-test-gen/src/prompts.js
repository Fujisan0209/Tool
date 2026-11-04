/*
 * LLM に渡すプロンプトを組み立てます。DOM は使いません（Node でもテストできます）。
 *
 * 呼び出しは2段階です。
 *   1. 観点づくり: 仕様書 → テスト観点の一覧（JSON）
 *   2. コードづくり: 仕様書 + 選んだ観点 → テストクラス（テストクラスごとに1回）
 *
 * どの呼び出しも「system（書き方の決まり）→ 仕様書」が同じ順・同じ文字で先頭に来るので、
 * API キーで使うときは2回目以降の呼び出しで仕様書の部分がプロンプトキャッシュから読まれます。
 */
(function (root) {
  "use strict";

  // ---------------------------------------------------------------- 選択肢

  const BOOT_VERSIONS = {
    "4": { label: "Spring Boot 4.x", java: "21" },
    "3.4": { label: "Spring Boot 3.4 / 3.5", java: "21" },
    "3.0": { label: "Spring Boot 3.0〜3.3", java: "17" },
  };

  const STYLES = {
    slice: {
      label: "@WebMvcTest + MockMvc",
      short: "コントローラだけ（速い）",
      desc: "@WebMvcTest でコントローラだけを起動し、MockMvc でリクエストを送る。サービスなどの依存はモックにする。",
    },
    tester: {
      label: "@WebMvcTest + MockMvcTester",
      short: "AssertJ で読みやすく",
      desc: "@WebMvcTest でコントローラだけを起動し、MockMvcTester（AssertJ 形式）でリクエストを送って assertThat で確かめる。依存はモックにする。",
      minBoot: "3.4",
    },
    integration: {
      label: "@SpringBootTest + MockMvc",
      short: "アプリ全体（結合）",
      desc: "@SpringBootTest + @AutoConfigureMockMvc でアプリ全体を起動し、本物の Bean と DB を通して確かめる。各テストは @Transactional で後片付けする。",
    },
  };

  const CATEGORIES = {
    normal: "正常系",
    validation: "入力チェック",
    boundary: "境界値",
    notfound: "存在しない",
    conflict: "重複・競合",
    auth: "認証・認可",
    other: "その他",
  };

  // ---------------------------------------------------------------- バージョンごとの import

  function importTable(boot, style) {
    const lines = [];
    const webmvc =
      boot === "4"
        ? "org.springframework.boot.webmvc.test.autoconfigure"
        : "org.springframework.boot.test.autoconfigure.web.servlet";
    if (style === "integration") {
      lines.push("- @SpringBootTest: `org.springframework.boot.test.context.SpringBootTest`");
      lines.push(`- @AutoConfigureMockMvc: \`${webmvc}.AutoConfigureMockMvc\``);
      lines.push("- @Transactional: `org.springframework.transaction.annotation.Transactional`");
    } else {
      lines.push(`- @WebMvcTest: \`${webmvc}.WebMvcTest\``);
      if (boot === "3.0") {
        lines.push("- @MockBean: `org.springframework.boot.test.mock.mockito.MockBean`");
      } else {
        lines.push("- @MockitoBean: `org.springframework.test.context.bean.override.mockito.MockitoBean`");
      }
    }
    if (style === "tester") {
      lines.push("- MockMvcTester: `org.springframework.test.web.servlet.assertj.MockMvcTester`");
      lines.push("- assertThat: `static org.assertj.core.api.Assertions.assertThat`");
      lines.push("- HttpStatus: `org.springframework.http.HttpStatus`");
    } else {
      lines.push("- MockMvc: `org.springframework.test.web.servlet.MockMvc`");
      lines.push("- リクエスト: `static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*`");
      lines.push("- 結果: `static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*`");
    }
    lines.push("- MediaType: `org.springframework.http.MediaType`");
    lines.push("- Mockito: `static org.mockito.BDDMockito.given`, `static org.mockito.BDDMockito.then`, `static org.mockito.ArgumentMatchers.any`");
    lines.push("- 認証（仕様に認証があるときだけ）: `org.springframework.security.test.context.support.WithMockUser`, `static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf`");
    return lines.join("\n");
  }

  function versionNotes(boot, style) {
    const notes = [];
    if (boot === "4") {
      notes.push("Spring Boot 4 では @WebMvcTest / @AutoConfigureMockMvc のパッケージが `org.springframework.boot.webmvc.test.autoconfigure` に変わった。古いパッケージ `org.springframework.boot.test.autoconfigure.web.servlet` は使わない。");
      notes.push("Spring Boot 4 では @MockBean は削除された。必ず @MockitoBean を使う。");
      notes.push("Spring Boot 4 の JSON は Jackson 3（`tools.jackson`）。`com.fasterxml.jackson` の ObjectMapper は import しない。");
    } else if (boot === "3.4") {
      notes.push("Spring Boot 3.4 以降、@MockBean は非推奨。必ず @MockitoBean を使う。");
    } else {
      notes.push("Spring Boot 3.0〜3.3 なので、モックは @MockBean を使う（@MockitoBean はまだない）。");
    }
    if (style === "tester") {
      notes.push("MockMvcTester は `mvc.get().uri(\"/path/{id}\", id)` のように書き、`assertThat(result).hasStatus(HttpStatus.OK)` や `.bodyJson().extractingPath(\"$.name\").isEqualTo(...)` で確かめる。`.exchange()` を呼んでから確かめてもよい。");
    }
    return notes.map((n) => "- " + n).join("\n");
  }

  // ---------------------------------------------------------------- system（全呼び出しで共通・固定）

  /**
   * 書き方の決まり。設定が同じなら毎回まったく同じ文字列になるようにする
   * （日時や乱数を入れない）。ここが変わるとプロンプトキャッシュが効かなくなる。
   */
  function buildSystem(settings) {
    const boot = BOOT_VERSIONS[settings.boot] || BOOT_VERSIONS["4"];
    const style = STYLES[settings.style] || STYLES.slice;
    return `あなたは Spring Boot の Web API テストを書くベテランのエンジニアです。
「仕様書を先に渡して、実装より先にテストを作る」使い方をされています。仕様書だけを正しい答えとして扱い、実装がまだなくても、仕様どおりに作られた実装なら通り、仕様から外れた実装なら落ちるテストを書きます。

# 環境
- ${boot.label} / Java ${boot.java} / JUnit 5（Jupiter）/ AssertJ / Mockito
- テストの方式: ${style.label} — ${style.desc}
- テストのパッケージ: ${settings.basePackage || "com.example.demo"}

# このバージョンで使う import
${importTable(settings.boot, settings.style)}

# バージョンの注意
${versionNotes(settings.boot, settings.style)}

# テストの書き方の決まり
1. 期待値（ステータスコード・レスポンスの項目・ヘッダ）は仕様書から取る。仕様書に書いていない振る舞いを、さも仕様のように期待値にしない。推測で決めたところには \`// 推測: 〜\` とコメントを書く。
2. 1つのテストメソッドで確かめる振る舞いは1つ。\`@DisplayName("[C001] 〜")\` のように、先頭に必ず観点IDを角かっこで付ける。
3. メソッド名は英語の lowerCamelCase で、振る舞いがわかる名前にする（例: returns404WhenBookDoesNotExist）。
4. 本文は \`// Given\` \`// When\` \`// Then\` のコメントで区切る。
5. リクエストの JSON は Java のテキストブロック（\`"""\`）でそのまま書く。ObjectMapper でオブジェクトから作らない（バージョンによって Jackson のパッケージが違い、壊れやすいため）。
6. レスポンスは、ステータスだけでなく仕様にある項目を jsonPath で確かめる。エラーのときも、仕様にエラーの形（例: RFC 9457 の ProblemDetail、独自の errors 配列）があれば、その項目まで確かめる。
7. エンドポイントごとに \`@Nested\` クラスでまとめる。同じ準備が3回以上出るときは private のヘルパーメソッドにする。
8. モックを使う方式では、コントローラが呼ぶ依存（サービスなど）を \`given(...).willReturn(...)\` / \`willThrow(...)\` で用意し、書き込み系では \`then(service).should().〜\` で呼ばれ方も確かめる。入力チェックで弾かれるケースでは \`then(service).shouldHaveNoInteractions()\` を確かめる。
9. コントローラやサービスのコードが渡されていないときは、クラス名・メソッド名・例外クラス名を仕様書から自然な名前で決め、クラスの Javadoc に「前提にしたクラスとメソッド」を箇条書きで書く（実装側でそろえてもらうため）。
10. 禁止: \`Thread.sleep\`、\`System.out\`、\`@Disabled\`、中身のないテスト、\`assertTrue(true)\`、ランダムな値、現在時刻に依存する期待値。
11. import は省略しない。ワイルドカード import は static import だけにする。コンパイルが通る完全なファイルを書く。

# 出力の形（コードを書くとき）
- 1ファイルを1つの \`\`\`java コードブロックにする。ブロックの1行目に \`// file: src/test/java/パッケージのパス/クラス名.java\` を書く。
- 結合テストでテストデータの SQL が必要なときは、\`\`\`sql ブロックの1行目に \`-- file: src/test/resources/パス.sql\` を書く。
- コードブロックの外には何も書かない。`;
  }

  // ---------------------------------------------------------------- 仕様書（全呼び出しで共通・固定）

  /** 仕様書とコードのかたまり。キャッシュの区切りはこのブロックの最後に置く。 */
  function buildSpecBlock(spec, code) {
    let s = `<spec>\n${String(spec || "").trim()}\n</spec>`;
    if (code && code.trim()) {
      s += `\n\n<existing_code>\n以下は、すでにあるコントローラ・DTO・サービスなどのコードです。クラス名・メソッド名・例外クラスはこれに合わせてください。ただし期待値は仕様書を優先し、コードが仕様と食い違うところは仕様書に合わせたテストを書きます。\n\n${code.trim()}\n</existing_code>`;
    }
    return s;
  }

  // ---------------------------------------------------------------- 1. 観点づくり

  const PLAN_SCHEMA = {
    type: "object",
    additionalProperties: false,
    required: ["summary", "classes", "cases", "questions"],
    properties: {
      summary: { type: "string", description: "仕様書のAPIを1〜2文で要約" },
      classes: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["className", "target"],
          properties: {
            className: { type: "string", description: "テストクラス名。例: BookControllerTest" },
            target: { type: "string", description: "テスト対象のコントローラ名。例: BookController" },
          },
        },
      },
      cases: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "className", "method", "path", "category", "title", "given", "request", "expectStatus", "expect", "basis", "specRef"],
          properties: {
            id: { type: "string", description: "C001 から順に3桁の連番" },
            className: { type: "string" },
            method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE"] },
            path: { type: "string", description: "例: /api/books/{id}" },
            category: { type: "string", enum: Object.keys(CATEGORIES) },
            title: { type: "string", description: "DisplayName に使う短い日本語。例: 存在しないIDなら404" },
            given: { type: "string", description: "前提・準備（モックの返り値やDBの状態）" },
            request: { type: "string", description: "送るリクエストの要点（パラメータ・ボディ）" },
            expectStatus: { type: "integer" },
            expect: { type: "string", description: "確かめること（レスポンスの項目・ヘッダ・依存の呼ばれ方）" },
            basis: { type: "string", enum: ["spec", "assumption"], description: "spec=仕様書に書いてある / assumption=推測" },
            specRef: { type: "string", description: "根拠になる仕様書の箇所を短く引用（推測なら、何を推測したか）" },
          },
        },
      },
      questions: {
        type: "array",
        description: "仕様書があいまい・書かれていないために、テストが書けない／推測が必要になった点",
        items: { type: "string" },
      },
    },
  };

  function buildPlanTask(settings) {
    const style = STYLES[settings.style] || STYLES.slice;
    return `<spec> の仕様書から、Web API のテスト観点の一覧を作ってください。テストの方式は「${style.label}」です。

# 観点の洗い出し方
エンドポイントごとに、次の順で、仕様書から言えるものを挙げます。
1. 正常系: 代表的な成功（ステータス・レスポンスの項目・Location などのヘッダ）。一覧系はページング・並び順・絞り込みのパラメータも。
2. 入力チェック: 必須の欠け、型・形式の違い（数値に文字、メール形式など）、選べない値（enum の外）。
3. 境界値: 文字数・数値・件数の上限と下限。ちょうど（成功）と、1つ外（失敗）を基本にし、同じ意味のものは1つにまとめる。
4. 存在しない: パスの ID が存在しないとき。
5. 重複・競合: 一意の項目の重複、状態による操作の禁止など。
6. 認証・認可: 仕様に認証・権限が書いてあるときだけ（未ログイン、権限なし）。
7. その他: 仕様に書いてある特別なルール。

# 決まり
- 仕様書に書いてないことは観点にしない。ただし、ふつうの Web API なら決まっているはずなのに仕様書に書いてない点（例: 入力エラーのステータスコードやエラーの形）は、basis を "assumption" にして観点に入れ、questions にも書く。
- 1つの観点で確かめることは1つ。重複させない。エンドポイント1つあたり、だいたい3〜10件。
- id は C001 から通しの3桁の連番。
- テストクラスはコントローラごとに1つ（className は「コントローラ名 + Test」）。cases の className は classes のどれかと同じにする。
- title は DisplayName にそのまま使える短い日本語（30文字くらいまで）。
- questions には、仕様書の作者に確認したほうがいい点を、具体的に短く書く（なければ空の配列）。

JSON だけを返してください。`;
  }

  // ---------------------------------------------------------------- 2. コードづくり

  function formatCase(c) {
    const mark = c.basis === "assumption" ? "（推測）" : "";
    return [
      `- [${c.id}] ${c.title}${mark}`,
      `  - エンドポイント: ${c.method} ${c.path}`,
      `  - 観点: ${CATEGORIES[c.category] || c.category}`,
      c.given ? `  - 前提: ${c.given}` : "",
      c.request ? `  - リクエスト: ${c.request}` : "",
      `  - 期待: ${c.expectStatus}${c.expect ? " / " + c.expect : ""}`,
      c.specRef ? `  - 根拠: ${c.specRef}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  function packagePath(pkg) {
    return String(pkg || "com.example.demo").trim().replace(/\./g, "/");
  }

  function buildCodeTask(settings, cls, cases) {
    const pkg = (settings.basePackage || "com.example.demo").trim();
    return `<spec> の仕様書に対する、テストクラス \`${cls.className}\`（対象: \`${cls.target}\`）を書いてください。

- パッケージ: \`${pkg}\`
- ファイル: \`src/test/java/${packagePath(pkg)}/${cls.className}.java\`
- 下の ${cases.length} 件の観点を、1件につき1つのテストメソッドにしてください。全部を書き、ほかの観点は足さないでください。
- \`@DisplayName\` は「[観点ID] タイトル」にしてください。（推測）とある観点は、メソッドの中に \`// 推測: 〜\` で何を推測したかを書いてください。

# 観点
${cases.map(formatCase).join("\n")}`;
  }

  /** 足りない観点だけを書き足してもらう。今のファイルを丸ごと直して返してもらう。 */
  function buildFixTask(settings, cls, currentCode, missingCases, problems) {
    const parts = [
      `テストクラス \`${cls.className}\` を直してください。直したファイルを丸ごと、1つのコードブロックで返してください。今あるテストは消さないでください。`,
    ];
    if (missingCases.length) {
      parts.push(`# まだテストがない観点（書き足す）\n${missingCases.map(formatCase).join("\n")}`);
    }
    if (problems.length) {
      parts.push(`# 自動チェックで見つかった問題（直す）\n${problems.map((p) => `- ${p.line ? p.line + "行目: " : ""}${p.message}`).join("\n")}`);
    }
    parts.push(`# 今のファイル\n\`\`\`java\n${currentCode}\n\`\`\``);
    return parts.join("\n\n");
  }

  // ---------------------------------------------------------------- APIキーなし（コピーして使う）

  /** チャットにそのまま貼る1回分のプロンプト。観点の表とコードを1回で出してもらう。 */
  function buildOneShotPrompt(settings, spec, code) {
    return `${buildSystem(settings)}

${buildSpecBlock(spec, code)}

# お願い
<spec> の仕様書から、Spring Boot の Web API テストを作ってください。2つの手順で進めます。

## 手順1: テスト観点の表
はじめに、テスト観点を Markdown の表で出してください。列は「ID | エンドポイント | 観点 | タイトル | 期待ステータス | 根拠（仕様 / 推測）」です。
- ID は C001 から通しの3桁の連番
- 観点は 正常系・入力チェック・境界値・存在しない・重複・競合・認証・認可・その他 から選ぶ
- 仕様書に書いてないことは観点にしない。ふつうは決まっているはずなのに書いてない点は「推測」として入れる
- 表のあとに「仕様書で確認したい点」を箇条書きで出す（なければ「なし」）

## 手順2: テストコード
表のすべての観点を、コントローラごとのテストクラスにしてください。
- 1観点 = 1テストメソッド。\`@DisplayName("[C001] タイトル")\`
- 出力の形は上の「出力の形」のとおり（1ファイル1コードブロック、1行目に \`// file: パス\`）
- ここだけは、手順1の表と箇条書きをコードブロックの前に書いてかまいません`;
  }

  const api = {
    BOOT_VERSIONS,
    STYLES,
    CATEGORIES,
    PLAN_SCHEMA,
    buildSystem,
    buildSpecBlock,
    buildPlanTask,
    buildCodeTask,
    buildFixTask,
    buildOneShotPrompt,
    formatCase,
    packagePath,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SpringTestPrompts = api;
})(typeof window !== "undefined" ? window : globalThis);
