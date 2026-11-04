# 仕様ズレチェッカー

仕様書（Markdown / テキスト）とソースコードを読み比べて、**食い違い**を一覧にするツールです。

- 関数・メソッドの **引数の数・順番・名前・型・デフォルト値**、**戻り値の型**
- クラスの **フィールド**、列挙型の **値**
- **定数の値**（`5,000` と `5_000`、`3600` と `60 * 60` も同じとみなします）
- **API**（HTTP メソッドとパス。`{id}` / `:id` / `<id>` の違いは同じとみなします）
- 仕様に出てくる `名前` が、コードのどこにもないもの（打ちまちがいなら似た名前を出します）
- コードにあるのに、仕様書に書かれていないもの

すべてブラウザの中だけで動きます。貼りつけた仕様書やコードは、どこにも送信しません。

## 使い方

[`dist/spec-zure-checker.html`](../dist/spec-zure-checker.html) をダウンロードして、ダブルクリックで開きます（インストール不要・オフラインでも動きます）。

1. 左の「仕様書」に、仕様書を貼りつけるか `.md` ファイルをドロップ
2. 右の「ソースコード」に、コードを貼りつけるか、ファイルやフォルダをドロップ（`node_modules` などは自動で飛ばします）
3. 下に食い違いが出ます。行番号を押すと、その行に飛びます
4. 「Markdown でコピー」で、Issue やプルリクエストに貼れるチェックリストになります

## はんこの意味

| はんこ | 意味 |
| --- | --- |
| 違 | 食い違い: 引数・型・値・HTTP メソッドなどが違う |
| 無 | 見つからない: 仕様にあるのに、コードにない |
| 揺 | 名前の揺れ: `user_id` と `userId` のような書き方の違い |
| 外 | 仕様にない: コードにだけある（仕様書が触れている種類だけ調べます） |

## 仕様書から読み取れる書き方

````markdown
## Order クラス
| フィールド名 | 型 | 必須 |
|---|---|---|
| id | long | ○ |

### calcTotal(price: int, qty: int): int
- 引数
  - `price` (int, 必須): 単価
  - `qty` (int): 数量。デフォルト 1
- 戻り値: int

### cancel メソッド
- 引数: reason (String)
- 戻り値: なし

## OrderStatus 列挙型
`PENDING` / `PAID` / `SHIPPED` のいずれか

## 定数
| 定数名 | 値 |
|---|---|
| MAX_ITEMS | 100 |

## API
| メソッド | パス |
|---|---|
| GET | /api/orders/{id} |

```java
public interface OrderRepository {
    Order findById(long id);
}
```
````

シグネチャは `int calc(int a)`（Java 風）、`calc(a: int): int`（TS 風）、`def calc(a: int) -> int`（Python 風）のどれでも読めます。
「引数」「戻り値」「フィールド」「定数」は、見出し・ラベル（`引数:`）・表のどれで書いても大丈夫です。

## コードから読むもの

| 言語 | 読むもの |
| --- | --- |
| Java | class / interface / enum / record、メソッド、フィールド、`static final` 定数、Spring（`@GetMapping` など）、JAX-RS |
| TypeScript / JavaScript | function、アロー関数、class、interface、type、enum、`export const` 定数、Express（`router.get(...)`、`app.use('/api', router)`）、NestJS |
| Python | def、class、dataclass / Pydantic、Enum、大文字の定数、FastAPI（`APIRouter(prefix=...)`）、Flask |

コンパイラではないので、とても珍しい書き方は読み落とすことがあります。

## ファイル

```
spec-check/
  index.html         画面
  src/common.js      名前・型・値の比べ方、似た名前探し
  src/code.js        コードを読む（Java / JS / TS / Python）
  src/spec.js        仕様書を読む
  src/compare.js     突き合わせと Markdown レポート
  src/samples.js     画面の「例」（テストでも使う）
  src/app.js         画面の動き
  test/              テスト
```

`src/` を書きかえたら、リポジトリのいちばん上で `npm test` と `npm run build` を実行してください。
