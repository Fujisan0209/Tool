# 一人前ロードマップ

プログラミング言語を1つえらんで、「一人前」とよばれる所までの道のりを、順に歩いていく学習ツールです。
最初に全体の流れ（ゴールと 6 つのステージ）を見てから、レッスンを1つずつ進めます。

**使い方:** [`dist/ichininmae.html`](../dist/ichininmae.html) を1つダウンロードして、ダブルクリックで開くだけです。
進みぐあいは、開いたブラウザの中にだけ保存されます。

- 言語: C / Python / Java / JavaScript / TypeScript / PHP / Ruby / Go / Rust
- 言語ごとに 18 レッスン（6 ステージ × 3）
- レッスンの流れ: ねらいと説明（図つき）→ コードを読む → 結果を予想する → ポイント → クイズ → 自分で書きかえる

## ステージ

| | ステージ | レッスン |
| --- | --- | --- |
| 1 | はじめの一歩 | 動かして表示する / 変数と型 / 計算と文字列 |
| 2 | 流れをつくる | 条件分岐 / くりかえし / 関数 |
| 3 | データをまとめる | 配列・リスト / 辞書・マップ / 文字列 |
| 4 | 大きく作る | データと処理をまとめる / この言語ならでは ① / ファイルを分ける |
| 5 | こわれないプログラム | エラー処理 / ファイルの読み書き / テスト |
| 6 | 一人前へ | この言語ならでは ② / 道具をそろえる / 卒業制作 |

「この言語ならでは」は、言語ごとにちがいます（C はポインタと malloc、Rust は所有権と enum、JavaScript は map・filter と非同期、など）。

## ファイル

```
course/curriculum.js     どの言語にも共通の、ステージ・説明・クイズ・課題
course/langs.js          言語の紹介、「一人前の目安」、コースのあとの道
course/langs/*.txt       言語ごとのコードとポイント（書き方は scripts/course-lib.js の先頭）
course/outputs.json      コードを実際に動かした結果（自動で作られます）
course/template.html     画面
scripts/course-run.js    コードを全部動かして outputs.json を作る
scripts/course-build.js  dist/ichininmae.html を作る
```

## 教材を書きかえたら

```bash
npm run course:run
```

```bash
npm run course:build
```

```bash
npm test
```

`course:run` は、のっているコードを本当に動かして、表示された結果を保存します（それぞれの言語の道具が入っている必要があります）。
画面の「実行結果」は、手で書いた物ではなく、この結果です。`npm run course:run -- python` のように、言語を1つだけ動かすこともできます。
