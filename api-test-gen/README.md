# API テスト自動生成

Web API の仕様書（OpenAPI / Swagger）を貼りつけると、テストを自動で作るツールです。
作ったテストは **JavaScript（node:test）・Python（pytest）・Postman コレクション** で書き出せて、ブラウザやコマンドからその場で実行もできます。

## 使い方

**画面で使う:** [`../dist/api-test-gen.html`](../dist/api-test-gen.html) をダウンロードして、ダブルクリックで開くだけです（ファイル1つ、インストール不要、仕様書は外に送りません）。

1. 仕様書を貼りつける（ファイルをドロップしても、「ファイルを開く」でも OK）
2. 作るテストの種類と、テストするエンドポイントを選ぶ
3. 「JavaScript / Python / Postman」タブでコードをコピーかダウンロード、または「ブラウザで実行」

**コマンドで使う（CI 向け）:** Node.js 18 以上だけで動きます。

```bash
node api-test-gen/cli.js api-test-gen/examples/library.yaml -o generated
```

```bash
BASE_URL=https://staging.example.com/v1 API_TOKEN=xxxx node api-test-gen/cli.js openapi.yaml --run
```

`--run` は不合格があると終了コード 1 を返すので、そのまま CI のチェックに使えます。ほかのオプションは `--help` で見られます。

## 作るテスト

| 種類 | 内容 | 期待するステータス |
| --- | --- | --- |
| 正常系 | `example` / `default` / 制約から正しいリクエストを作る。レスポンスの形もスキーマと照らす | 仕様の 2xx |
| 境界値 | `minimum` / `maximum` / `minLength` / `maxLength` のちょうどの値、`enum` の最後の値 | 仕様の 2xx |
| 必須の欠落 | 必須のクエリ・ヘッダー・ボディ項目を1つずつ抜く。ボディそのものを抜く | 仕様の 400 / 422 |
| 不正な値 | 型ちがい、範囲外、長すぎる・短すぎる、`enum` にない、`pattern` に合わない、必須項目の `null` | 仕様の 400 / 422 |
| 形式 | `email` / `date` / `date-time` / `uuid` などの形がまちがっている | 仕様の 400 / 422 |
| 認証 | 認証が必要なエンドポイントに、認証情報なしで送る | 401 / 403 |
| 存在しないID | 404 が書かれているエンドポイントに、存在しないIDで送る | 404 |

- 仕様に 400 / 422 が書かれていないときは「4xx なら合格」にします（画面の設定やCLIの `--loose` で、いつでも 4xx 合格にもできます）
- 値は毎回同じものを作るので、結果が再現できます
- `readOnly` の項目はリクエストに入れず、`writeOnly` の項目はレスポンスで必須にしません
- 認証（Bearer / Basic / API キー / OAuth2 のトークン）は環境変数から読み、ない場合は認証が必要なテストをスキップします

## 対応している仕様書

OpenAPI 3.0 / 3.1、Swagger 2.0。YAML でも JSON でも読めます。
`$ref`（循環参照も OK）、`allOf` / `oneOf` / `anyOf`、`nullable`、3.1 の `type: [string, "null"]` に対応しています。
外部ファイルへの `$ref` は読めないので、1つのファイルにまとめた仕様書を使ってください。

## ファイル

```
index.html            画面
cli.js                コマンド
src/spec.js           仕様書を読んで、扱いやすい形にそろえる
src/sample.js         スキーマから正しい値・境界の値・まちがった値を作る
src/cases.js          テストケースの一覧を作る（言語に依存しない形）
src/runtime.js        実行時に使う関数（リクエストの組み立て・スキーマの確認）。生成するコードにもそのまま入る
src/emit/             JavaScript / Python / Postman への書き出し
src/runner.js         その場で実行する（ブラウザと CLI）
src/app.js            画面の動き
src/examples.js       サンプル（npm run build で examples/ から作られる）
examples/             サンプルの仕様書
test/                 テスト。mock-server.js は examples/library.yaml のとおりに動くサーバー
```

## テスト

```bash
npm test
```

生成した JavaScript / Python のテストを、モックサーバーに向けて本当に実行しています。
仕様どおりのサーバーでは全部合格し、わざとまちがえたサーバー（範囲チェックなし、必須項目なし、認証なしで通る）では不合格になることを確かめています。

ブラウザでの実行を試したいときは、モックサーバーを動かしてから、画面の「図書館 API」サンプルで実行してください（トークンは `test-token`）。

```bash
node api-test-gen/test/mock-server.js
```

`src/` や `examples/` を書きかえたら、`npm run build` で `dist/api-test-gen.html` と `src/examples.js` を作りなおしてください。
