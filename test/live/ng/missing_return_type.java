public class Main {
    public static add(int a, int b) { // <<error:missing-return-type
        return a + b;
    }

    public static void main(String[] args) {
        System.out.println(add(1, 2));
    }
}
