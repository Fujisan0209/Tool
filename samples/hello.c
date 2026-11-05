/* C言語: あいさつ・合計・FizzBuzz
 * 実行: gcc hello.c -o hello && ./hello
 */
#include <stdio.h>

int main(void) {
    printf("こんにちは、C!\n");

    int sum = 0;
    for (int i = 1; i <= 10; i++) {
        sum += i;
    }
    printf("1から10の合計: %d\n", sum);

    for (int i = 1; i <= 15; i++) {
        if (i % 15 == 0) {
            printf("FizzBuzz\n");
        } else if (i % 3 == 0) {
            printf("Fizz\n");
        } else if (i % 5 == 0) {
            printf("Buzz\n");
        } else {
            printf("%d\n", i);
        }
    }
    return 0;
}
