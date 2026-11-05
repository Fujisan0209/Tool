interface Counter {
    int MAX = 10;
    int next();
    static Counter create() {
        return new SimpleCounter();
    }
}

class SimpleCounter implements Counter {
    private int n;

    public int next() {
        n++;
        if (n > MAX) n = 0;
        return n;
    }
}

public class Main {
    static final int LIMIT = 3;
    static int calls;

    static {
        calls = 0;
    }

    static int bump() {
        calls++;
        return calls;
    }

    public static void main(String[] args) {
        Counter c = Counter.create();
        for (int i = 0; i < LIMIT; i++) {
            System.out.println(c.next() + bump());
        }
        System.out.println(Counter.MAX + Main.LIMIT + Main.bump());
        Object o = c;
        if (o instanceof SimpleCounter sc) {
            System.out.println(sc.next());
        }
        int[] data = new int[LIMIT];
        data[0] = 1;
        data[LIMIT - 1] = 2;
        System.out.println(data[2]);
        String s = null;
        if (s == null) {
            System.out.println("null!");
        }
    }
}
