public class Main {
    public static void main(String[] args) {
        int x = 5 // <<error:missing-semicolon
        int y = x + 1;
        System.out.println(y);
    }
}
