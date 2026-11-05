// Go: あいさつ・合計・FizzBuzz
// 実行: go run hello.go

package main

import "fmt"

func main() {
	fmt.Println("こんにちは、Go!")

	sum := 0
	for i := 1; i <= 10; i++ {
		sum += i
	}
	fmt.Printf("1から10の合計: %d\n", sum)

	for i := 1; i <= 15; i++ {
		switch {
		case i%15 == 0:
			fmt.Println("FizzBuzz")
		case i%3 == 0:
			fmt.Println("Fizz")
		case i%5 == 0:
			fmt.Println("Buzz")
		default:
			fmt.Println(i)
		}
	}
}
