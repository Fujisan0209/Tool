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

Java で日本語が `??` になるときは、`java -Dstdout.encoding=UTF-8 Hello` で実行してください。
