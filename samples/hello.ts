// TypeScript: あいさつ・合計・FizzBuzz
// 実行: npx tsx hello.ts

const greeting: string = "こんにちは、TypeScript!";
console.log(greeting);

let sum: number = 0;
for (let i: number = 1; i <= 10; i++) {
  sum += i;
}
console.log(`1から10の合計: ${sum}`);

function fizzBuzz(n: number): string {
  if (n % 15 === 0) return "FizzBuzz";
  if (n % 3 === 0) return "Fizz";
  if (n % 5 === 0) return "Buzz";
  return String(n);
}

for (let i = 1; i <= 15; i++) {
  console.log(fizzBuzz(i));
}
