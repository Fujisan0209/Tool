// Java: あいさつ・合計・FizzBuzz
// 実行: javac Hello.java && java Hello
// （public クラスの名前とファイル名は同じにします）

public class Hello {
    public static void main(String[] args) {
        System.out.println("こんにちは、Java!");

        int sum = 0;
        for (int i = 1; i <= 10; i++) {
            sum += i;
        }
        System.out.println("1から10の合計: " + sum);

        for (int i = 1; i <= 15; i++) {
            if (i % 15 == 0) {
                System.out.println("FizzBuzz");
            } else if (i % 3 == 0) {
                System.out.println("Fizz");
            } else if (i % 5 == 0) {
                System.out.println("Buzz");
            } else {
                System.out.println(i);
            }
        }
    }
}
