import java.util.*;
import java.util.function.*;
import java.util.stream.*;

public class Main {
    static <T extends Comparable<T>> T biggest(List<T> xs) {
        T best = xs.get(0);
        for (T x : xs) {
            if (x.compareTo(best) > 0) best = x;
        }
        return best;
    }

    static class Box<T> {
        private T value;

        Box(T value) {
            this.value = value;
        }

        T get() {
            return value;
        }

        <R> Box<R> map(Function<T, R> f) {
            return new Box<>(f.apply(value));
        }
    }

    public static void main(String[] args) {
        List<Integer> xs = List.of(3, 9, 2);
        System.out.println(biggest(xs));
        Box<String> b = new Box<>("hi");
        Box<Integer> len = b.map(String::length);
        int n = len.get();
        System.out.println(n);
        List<String> up = Stream.of("a", "b").map(String::toUpperCase).collect(Collectors.toList());
        int sum = IntStream.rangeClosed(1, 10).sum();
        Optional<String> first = up.stream().filter(s -> s.startsWith("A")).findFirst();
        System.out.println(up + " " + sum + " " + first.orElse("none"));
        BiFunction<Integer, Integer, Integer> add = (x, y) -> x + y;
        Supplier<List<String>> mk = ArrayList::new;
        Predicate<String> empty = String::isEmpty;
        Consumer<String> pr = System.out::println;
        pr.accept("ok" + add.apply(1, 2) + mk.get() + empty.test(""));
        Map<String, List<Integer>> groups = new HashMap<>();
        groups.computeIfAbsent("even", k -> new ArrayList<>()).add(2);
        Comparator<String> byLen = Comparator.comparing(String::length);
        List<String> words = new ArrayList<>(List.of("ccc", "a", "bb"));
        words.sort(byLen.reversed());
        System.out.println(words + " " + groups);
        var list = new ArrayList<String>();
        list.add("v");
        var it = list.iterator();
        System.out.println(it.next());
    }
}
