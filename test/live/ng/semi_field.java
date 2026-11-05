public class Main {
    static int count = 0 // <<error:missing-semicolon

    public static void main(String[] args) {
        System.out.println(count);
    }
}
