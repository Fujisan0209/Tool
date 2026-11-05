public class Main {
    static int add(int a, int b) {
        return a + b;
    }

    static double average(int... nums) {
        if (nums.length == 0) return 0;
        int s = 0;
        for (int n : nums) s += n;
        return (double) s / nums.length;
    }

    static int fact(int n) {
        if (n <= 1) {
            return 1;
        }
        return n * fact(n - 1);
    }

    static String grade(int score) {
        if (score >= 80) {
            return "A";
        } else if (score >= 60) {
            return "B";
        } else {
            return "C";
        }
    }

    static boolean isEven(int n) {
        return n % 2 == 0;
    }

    static int sign(int x) {
        if (x > 0) return 1;
        else if (x < 0) return -1;
        return 0;
    }

    static int loopForever() {
        while (true) {
            int r = (int) (Math.random() * 10);
            if (r == 3) return r;
        }
    }

    static void hello() {
        System.out.println("hello");
        return;
    }

    static long square(long v) { return v * v; }

    public static void main(String[] args) {
        System.out.println(add(2, 3));
        System.out.println(average(1, 2, 3));
        System.out.println(fact(5));
        System.out.println(grade(70));
        System.out.println(isEven(4) ? "even" : "odd");
        System.out.println(sign(-3) + loopForever());
        hello();
        System.out.println(square(3));
        System.out.println(Math.max(3, 7) + Math.abs(-2) + Math.sqrt(16) + Math.pow(2, 10));
        int m = Math.max(3, 7);
        long r = Math.round(2.5);
        int r2 = Math.round(2.5f);
        System.out.println(m + r + r2);
    }
}
