// Rust: あいさつ・合計・FizzBuzz
// 実行: rustc hello.rs && ./hello

fn main() {
    println!("こんにちは、Rust!");

    let sum: i32 = (1..=10).sum();
    println!("1から10の合計: {}", sum);

    for i in 1..=15 {
        if i % 15 == 0 {
            println!("FizzBuzz");
        } else if i % 3 == 0 {
            println!("Fizz");
        } else if i % 5 == 0 {
            println!("Buzz");
        } else {
            println!("{}", i);
        }
    }
}
