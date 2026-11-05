import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        String ans = sc.next();
        if (ans == "yes") { // <<warn:string-eq
            System.out.println("OK");
        }
    }
}
