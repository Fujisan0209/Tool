// JavaScript (Node.js): あいさつ・合計・FizzBuzz
// 実行: node hello.js

console.log("こんにちは、JavaScript!");

let sum = 0;
for (let i = 1; i <= 10; i++) {
  sum += i;
}
console.log(`1から10の合計: ${sum}`);

for (let i = 1; i <= 15; i++) {
  if (i % 15 === 0) {
    console.log("FizzBuzz");
  } else if (i % 3 === 0) {
    console.log("Fizz");
  } else if (i % 5 === 0) {
    console.log("Buzz");
  } else {
    console.log(i);
  }
}
