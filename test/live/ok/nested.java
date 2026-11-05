import java.util.ArrayList;

public class Main {
    static class Point {
        int x, y;

        Point(int x, int y) {
            this.x = x;
            this.y = y;
        }

        double dist() {
            return Math.sqrt(x * x + y * y);
        }
    }

    class Inner {
        int value() {
            return base * 2;
        }
    }

    int base = 21;

    record Pair(String key, int value) {
        Pair {
            if (value < 0) throw new IllegalArgumentException();
        }

        String show() {
            return key + "=" + value;
        }
    }

    interface Greeter {
        String greet(String name);
    }

    void run() {
        Inner in = new Inner();
        System.out.println(in.value());
        Greeter g = n -> "やあ " + n;
        System.out.println(g.greet("太郎"));
        Runnable r = new Runnable() {
            @Override
            public void run() {
                System.out.println("anon " + base);
            }
        };
        r.run();
        class Local {
            int twice(int v) {
                return v * 2 + base;
            }
        }
        System.out.println(new Local().twice(2));
    }

    public static void main(String[] args) {
        Point p = new Point(3, 4);
        System.out.println(p.dist() + p.x);
        Pair pr = new Pair("a", 1);
        System.out.println(pr.key() + pr.value() + pr.show());
        new Main().run();
        Main m = new Main();
        Main.Inner i2 = m.new Inner();
        System.out.println(i2.value());
        ArrayList<Point> pts = new ArrayList<>();
        pts.add(new Point(1, 1));
        pts.forEach(pt -> System.out.println(pt.x));
        pts.sort((a, b) -> Integer.compare(a.x, b.x));
    }
}
