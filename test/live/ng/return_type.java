public class Main {
    static int half(int x) {
        return x / 2.0; // <<error:lossy
    }

    public static void main(String[] args) {
        System.out.println(half(3));
    }
}
