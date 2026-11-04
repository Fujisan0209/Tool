# 小さな開発ツール集

| ツール | 内容 | すぐ使う |
| --- | --- | --- |
| [Javaエラーやさしく解説](#javaエラーやさしく解説) | `javac` / `java` のエラーを、やさしい日本語で説明する | [`dist/java-error-yasashiku.html`](dist/java-error-yasashiku.html) |
| [API テスト自動生成](api-test-gen/README.md) | OpenAPI / Swagger の仕様書から、正常系・異常系・境界値のテストを作る（JavaScript / Python / Postman） | [`dist/api-test-gen.html`](dist/api-test-gen.html) |

どちらもファイル1つで、ダブルクリックで開くだけで動きます。

## Javaエラーやさしく解説

Javaを習いはじめた人向けのツールです。`javac` や `java` が出したエラーメッセージを貼りつけると、
**なにが起きたのか・よくある原因・なおし方・まちがい/正しいコード例** を、やさしい日本語で説明します。

- 英語のメッセージ（`error: ';' expected`）も、日本語のメッセージ（`エラー: ';'がありません`）も読めます
- エラーが複数あっても1つずつ分けて説明し、ファイル名と行番号、`^` の場所を表示します
- 実行時エラー（例外）は、スタックトレースから **自分のコードの行** を見つけます
- すべてブラウザの中だけで動きます。貼りつけたエラーはどこにも送信しません

### 使い方

**いちばん簡単な方法:** [`dist/java-error-yasashiku.html`](dist/java-error-yasashiku.html) を1つダウンロードして、ダブルクリックで開くだけです。

- Claude のアカウントも、インストールも、サーバーもいりません
- インターネットにつながっていなくても動きます（そのときは文字の形だけが少し変わります）
- ファイル1つなので、メールやUSB、学校のLMSなどで、そのまま配れます

リポジトリをまるごとダウンロードした場合は、`index.html` を開いても同じように使えます。

`src/` を書きかえたら、`npm run build` で `dist/java-error-yasashiku.html` を作りなおしてください。

### 対応しているエラー（50種類）

| 種類 | エラー |
| --- | --- |
| コンパイルエラー | `;` 忘れ、かっこ不足、シンボルが見つからない（import 忘れ・大文字小文字のまちがいも判定）、型が合わない、精度が失われる変換、public クラスとファイル名の不一致、`}` 不足、return 忘れ、未初期化の変数、到達できない文、文ではない、式の開始が不正、文字列/文字リテラルが閉じていない、static コンテキスト、変数の二重定義、例外の未処理、引数が合わない、演算子の型が不正、全角スペース・全角記号、文字コード、クラスの外の記述、戻り値の型がない、else に対応する if がない、final への代入、プリミティブ型に `.`、メソッド本体がない、abstract メソッド未実装、break の位置、配列でないものに `[]` |
| 実行時エラー | NullPointerException、ArrayIndexOutOfBounds、StringIndexOutOfBounds、IndexOutOfBounds（List）、0 で割り算、NumberFormatException、InputMismatchException、NoSuchElementException、ClassCastException、StackOverflowError、OutOfMemoryError、ConcurrentModificationException、FileNotFoundException |
| 準備・コマンド | `javac` が見つからない、ソースファイルが見つからない、メインクラスが見つからない、main メソッドがない、Java のバージョン違い |

### ファイル

```
index.html          画面
src/rules.js        エラーと説明の対応表（ここを増やせば対応エラーが増えます）
src/analyzer.js     貼りつけた文字を1つずつのエラーに分けて、ルールに当てはめる
src/app.js          画面の動き
test/               テスト（fixtures/ は本物の OpenJDK 21 の出力）
```

### テスト

```bash
npm test
```

### ルールの追加

`src/rules.js` に `rule({ id, kind, match, build })` を足します。上にあるルールから順に調べるので、
細かいルールほど上に置きます。説明文の中の `` `...` `` はコードとして表示されます。
追加したら、本物のエラー出力を `test/fixtures/` に入れて、`test/analyzer.test.js` の `EXPECT` に期待するIDを書いてください。
