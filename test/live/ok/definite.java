public class Main {
    static int pick(boolean a) {
        int x;
        if (a) {
            x = 1;
        } else {
            x = 2;
        }
        return x;
    }

    static int sw(int k) {
        int y;
        switch (k) {
            case 1:
                y = 10;
                break;
            case 2:
                y = 20;
                break;
            default:
                y = 0;
        }
        return y;
    }

    static int loop() {
        int z;
        while (true) {
            z = 5;
            break;
        }
        return z;
    }

    static int tryIt(String s) {
        int v;
        try {
            v = Integer.parseInt(s);
        } catch (NumberFormatException e) {
            v = -1;
        }
        return v;
    }

    static int cond(int a) {
        int r;
        if (a > 0 && (r = a * 2) > 4) {
            return r;
        }
        final int f;
        f = 3;
        boolean done;
        do {
            done = a > 10;
            a++;
        } while (!done);
        int w;
        for (;;) {
            w = 1;
            if (a > 0) break;
        }
        return f + w;
    }

    static int arrowSwitch(int k) {
        int q;
        switch (k) {
            case 1 -> q = 1;
            case 2 -> q = 2;
            default -> q = 3;
        }
        return q;
    }

    static int ifTrue() {
        int t;
        if (true) t = 1;
        return t;
    }

    public static void main(String[] args) {
        int total;
        total = 0;
        for (int i = 0; i < 3; i++) {
            total += i;
        }
        String msg;
        msg = total > 2 ? "big" : "small";
        System.out.println(pick(true) + sw(2) + loop() + tryIt("3") + cond(1) + arrowSwitch(2) + ifTrue() + total + msg);
    }
}
