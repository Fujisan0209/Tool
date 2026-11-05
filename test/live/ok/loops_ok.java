import java.util.Iterator;
import java.util.List;
import java.util.Scanner;

public class Main {
    static int digits(int n) {
        int c = 0;
        while (n > 0) {
            n /= 10;
            c++;
        }
        return c;
    }

    static String kind(int k) {
        switch (k) {
            case 1:
            case 2:
                return "small";
            case 3: {
                return "three";
            }
            case 4:
                if (k > 0) {
                    return "four";
                } else {
                    throw new IllegalStateException();
                }
            case 5:
                System.out.println("five");
                // fall through
            default:
                return "big";
        }
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        boolean done = false;
        while (!done) {
            String s = sc.nextLine();
            if (s.equals("q")) done = true;
        }
        List<String> list = List.of("a", "b");
        Iterator<String> it = list.iterator();
        while (it.hasNext()) {
            System.out.println(it.next());
        }
        int x = 10;
        while (x > 0) x -= 3;
        int y = 5;
        while (y != 0) {
            if (y > 2) {
                break;
            }
            y = 0;
        }
        int total = 0;
        total += +5;
        total = -total;
        int z = 3;
        z = z + 1;
        switch (z) {
            case 4:
                System.out.println("4");
                break;
            case 5:
                System.out.println("5");
        }
        System.out.println(digits(123) + kind(2) + total + z);
    }
}
