# 想像した母音、脳波でわかる？

声を出さずに母音 /a/ /e/ /i/ /o/ /u/ を思い浮かべたときの脳波（公開データ）から、どの母音かを分類するツールです。
1試行ずつ波形と判定を見られるほか、この方法が**偶然と比べてどれくらい当たるのか**を、甘くならない方法で測った結果も載せています。

**使い方:** [`../dist/eeg-vowel.html`](../dist/eeg-vowel.html) を1つダウンロードして開くだけです。データ・モデル・計算がすべて入っていて、サーバーもインターネットもいりません（つながっていないときは文字の形だけ少し変わります）。

## 結果（要約）

<!-- results:start -->
`python/train.py` の実行結果がここに入ります。
<!-- results:end -->

## データ

G. A. Pressel Coretto, I. E. Gareis, H. L. Rufiner, “Open access database of EEG signals recorded during imagined speech,”
Proc. SPIE 10160 (2017), [doi:10.1117/12.2255697](https://doi.org/10.1117/12.2255697)。
[NEMAR nm000258](https://doi.org/10.82901/nemar.nm000258) が再配布している元ファイルを使っています。

- スペイン語話者15人。母音5つと方向の単語6つを、想像（声を出さない）と発声の両方で
- 電極は F3・F4・C3・C4・P3・P4 の6つ、1024 Hz、2–45 Hz のフィルタ済み、1試行4秒
- 列の意味: モダリティ（1=想像, 2=発声）、刺激（1–5=母音, 6–11=単語）、アーチファクト（1=なし, 2=あり）
- このツールでは「想像」「母音」「アーチファクトなし」の 2,597 試行を使います

## 方法

1. 1024 Hz → 128 Hz に間引き
2. Welch 法（1秒の Hann 窓、半分ずつ重ねる）でスペクトルを求め、周波数帯ごとの平均パワーの対数を特徴にする
3. 標準化して線形分類器（ロジスティック回帰 / 縮小LDA）で母音ごとの確率を出す
4. 時間窓（0–4秒・0–3秒・1–4秒）× 帯域（6帯域・2Hz刻み）× 分類器（4種）の24通りから、**学習データの中の交差検証だけで**選ぶ

評価は被験者ごとの**入れ子の交差検証**（外側5分割で測り、設定は内側5分割で選ぶ）です。さらに、

- ラベルを被験者内でシャッフルして同じ手順を丸ごと100回回す**置換検定**
- 別の人のデータだけで学習する**被験者間**（leave-one-subject-out）評価
- 同じ手順で「想像か発声か」など別の問題を解く**動作確認**
- ランダムフォレスト・SVM・リーマン幾何・ERP・EEGNet 型 CNN など**ほかの方法との比較**

を行っています。ブラウザで動くモデル（被験者ごとに5分割ぶん）と表示用の試行（被験者ごと各母音8試行）は、
その試行がテスト側だった分割のモデルで判定するので、学習に使った試行を判定することはありません。

## 作りなおす

```bash
cd eeg-vowel/python
pip install -r requirements.txt
python fetch_data.py        # 約1.8GB を data/raw/ に（SHA-256 を照合）
python train.py             # data/results.json, data/demo.json（4コアで1時間半ほど）
python eegnet_baseline.py   # 参考の CNN（PyTorch が必要）
cd ../..
npm run build:eeg           # dist/eeg-vowel.html
npm test                    # ブラウザの計算が Python と同じ確率を出すか確認
```

## ファイル

```
index.html            画面（開発用。data/*.json を読むので python3 -m http.server などで開く）
src/features.js       スペクトル → 特徴量 → 確率（Python と同じ計算）
src/app.js            画面の動きとグラフ
python/fetch_data.py  データのダウンロード
python/train.py       学習・評価・書き出し
python/eegnet_baseline.py  参考の CNN
data/results.json     評価結果
data/demo.json        ブラウザ用のモデルと試行
build.js              1ファイルの配布用 HTML を作る
```

医療・診断の用途には使えません。
