import java.io.BufferedReader;
import java.io.FileReader;
import java.io.IOException;
import java.util.InputMismatchException;
import java.util.Scanner;

class TooSmallException extends Exception {
    TooSmallException(String msg) {
        super(msg);
    }
}

public class Main {
    static void check(int n) throws TooSmallException {
        if (n < 0) {
            throw new TooSmallException("マイナス");
        }
    }

    static String readFirst(String path) throws IOException {
        try (BufferedReader br = new BufferedReader(new FileReader(path))) {
            return br.readLine();
        }
    }

    static void sleepy() {
        try {
            Thread.sleep(10);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    public static void main(String[] args) throws Exception {
        try {
            check(-1);
        } catch (TooSmallException e) {
            System.out.println(e.getMessage());
        } finally {
            System.out.println("end");
        }
        try {
            int x = Integer.parseInt("abc");
            System.out.println(10 / x);
        } catch (NumberFormatException | ArithmeticException e) {
            System.out.println("error: " + e);
        }
        Scanner sc = new Scanner(System.in);
        try {
            int v = sc.nextInt();
            System.out.println(v);
        } catch (InputMismatchException e) {
            e.printStackTrace();
        }
        sleepy();
        Thread.sleep(1);
        System.out.println(readFirst("a.txt"));
        throw new IllegalStateException("おわり");
    }
}
