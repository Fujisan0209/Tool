public class Main {
    public static void main(String[] args) {
        int x = 5;
        if (0 < x < 10) { // <<error:chained-compare
            System.out.println(x);
        }
    }
}
