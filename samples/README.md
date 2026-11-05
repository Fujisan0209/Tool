# いろいろな言語のサンプル

同じ内容のプログラムを、いろいろなプログラミング言語で書いたものです。
書き方のちがいを見くらべてみてください。

どのプログラムも次の3つをします。

1. あいさつを表示する
2. 1から10までの合計（55）を表示する
3. 1から15までの FizzBuzz を表示する（3の倍数で Fizz、5の倍数で Buzz、両方で FizzBuzz）

| 言語 | ファイル | 実行のしかた |
| --- | --- | --- |
| C | `hello.c` | `gcc hello.c -o hello && ./hello` |
| Python | `hello.py` | `python3 hello.py` |
| Java | `Hello.java` | `javac Hello.java && java Hello` |
| JavaScript | `hello.js` | `node hello.js` |
| Ruby | `hello.rb` | `ruby hello.rb` |
| Go | `hello.go` | `go run hello.go` |
| Rust | `hello.rs` | `rustc hello.rs && ./hello` |
| PHP | `hello.php` | `php hello.php` |
| TypeScript | `hello.ts` | `npx tsx hello.ts` |

Java で日本語が `??` になるときは、`java -Dstdout.encoding=UTF-8 Hello` で実行してください。

## 言語くらべ帳（index.html）

`samples/index.html` をブラウザで開くと、2つの言語をならべて見くらべられます。

- **再生**: 両方の言語で「いま動いている行」が同時に光り、変数の箱（`i` と合計）と画面に出る文字が1ステップずつ変わります
- **行をタップ**: その行の意味を、やさしい日本語で説明します
- **行の色**: 表示・変数・くりかえし・条件分岐などの種類ごとに色分けしています。色をタップすると、その種類の行だけを目立たせます
- **コードが動くまで**: コンパイルとインタプリタのちがいを、流れの図で見せます
- **ちがい早見表・どんな言語？**: 書き方のちがいと、言語ごとの特ちょう

サンプルのファイルを書きかえたら、`index.html` の中のコードも同じように書きかえてください（`npm test` で、ずれていないかを確かめられます）。
