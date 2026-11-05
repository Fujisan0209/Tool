<?php
// PHP: あいさつ・合計・FizzBuzz
// 実行: php hello.php

echo "こんにちは、PHP!\n";

$sum = 0;
for ($i = 1; $i <= 10; $i++) {
    $sum += $i;
}
echo "1から10の合計: {$sum}\n";

for ($i = 1; $i <= 15; $i++) {
    if ($i % 15 === 0) {
        echo "FizzBuzz\n";
    } elseif ($i % 3 === 0) {
        echo "Fizz\n";
    } elseif ($i % 5 === 0) {
        echo "Buzz\n";
    } else {
        echo $i . "\n";
    }
}
