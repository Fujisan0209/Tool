import java.util.*;
import java.util.function.*;
import java.util.stream.*;

public class Main {
    sealed interface Shape permits Circle, Square, Rect {}
    record Circle(double r) implements Shape {}
    record Square(double side) implements Shape {
        Square {
            if (side < 0) throw new IllegalArgumentException("neg");
        }
        static Square unit() { return new Square(1); }
    }
    record Rect(double w, double h) implements Shape {}
    enum Color { RED, GREEN("g") { @Override String code() { return "G"; } }, BLUE;
        private final String c;
        Color() { this("x"); }
        Color(String c) { this.c = c; }
        String code() { return c; }
    }
    @FunctionalInterface interface Op { int apply(int a, int b); }
    static <T extends Comparable<? super T>> T max(List<? extends T> xs) { return Collections.max(xs); }
    int[][] grid = new int[3][];
    String[] names = {"a", "b"};
    static int counter;
    static { counter = 1; }
    { counter++; }

    static double area(Shape s) {
        return switch (s) {
            case Circle c -> Math.PI * c.r() * c.r();
            case Square sq when sq.side() > 10 -> 100;
            case Square sq -> sq.side() * sq.side();
            case Rect(double w, double h) -> w * h;
        };
    }

    static String describe(Object o) {
        if (o instanceof String str && !str.isEmpty()) return "str " + str.length();
        if (!(o instanceof Integer i)) return "other";
        return switch (i) {
            case 1, 2 -> "small";
            default -> {
                String r = "big" + i;
                yield r;
            }
        };
    }

    @SuppressWarnings({"unchecked", "rawtypes"})
    public static void main(String... args) throws Exception {
        var list = new ArrayList<Map.Entry<String, Integer>>();
        list.add(Map.entry("a", 1));
        Map<String, List<Integer>> m = new HashMap<>();
        m.computeIfAbsent("k", k -> new ArrayList<>()).add(3);
        BiFunction<Integer, Integer, Integer> add = (a, b) -> a + b;
        Op mul = (int a, int b) -> { return a * b; };
        Supplier<List<String>> sup = ArrayList::new;
        Function<String, Integer> len = String::length;
        int[] arr = IntStream.rangeClosed(1, 5).map(x -> x * x).toArray();
        String text = """
            Hello, "world"!
              indented \
            continued
            """;
        long big = 1_000_000L << 2 >>> 1 >> 1;
        int shifted = 8 >> 1;
        boolean ge = shifted >= 2 && big > 0;
        char c = '\n';
        c += 1;
        label:
        for (int i = 0, j = 10; i < j; i++, j--) {
            for (int k : arr) {
                if (k == 9) continue label;
                if (k > 20) break label;
            }
        }
        int x = 0;
        do { x++; } while (x < 3);
        switch (x) {
            case 3:
                System.out.println("three");
                break;
            default:
                System.out.println("?");
        }
        try (var sc = new Scanner("1 2"); Scanner sc2 = new Scanner("3")) {
            System.out.println(sc.nextInt() + sc2.nextInt());
        } catch (IllegalStateException | NoSuchElementException e) {
            throw new RuntimeException(e);
        } finally {
            System.out.printf("%d%n", x);
        }
        Object o = (Comparable<String>) "abc";
        int casted = (int) (Math.random() * 10) + (int) 3.5;
        double d = (double) casted / 2;
        Runnable r = () -> System.out.println(text.strip());
        r.run();
        new Thread(new Runnable() {
            @Override public void run() { System.out.println("anon"); }
        }).start();
        List<String> sorted = Stream.of("b", "a").sorted(Comparator.<String>naturalOrder()).collect(Collectors.toList());
        int[] copy = arr.clone();
        Class<?> cls = int[].class;
        String s = cls.getName() + String.class.getSimpleName();
        assert copy.length == 5 : "len";
        System.out.println(area(new Circle(1)) + describe(3) + max(List.of(1, 2)) + sorted + s + o + ge + c + d + add.apply(1, 2) + mul.apply(2, 3) + sup.get() + len.apply("x") + Color.GREEN.code());
        final int fin = 3;
        int y = fin > 2 ? 1 : fin < 0 ? -1 : 0;
        Integer boxed = y;
        y = -boxed + ~y + +y - -y;
        synchronized (Main.class) { y++; }
        if (y > 0) {
        } else if (y < 0) {
        } else {
        }
        Thread.sleep(1);
    }
}
