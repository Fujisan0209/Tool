public class Main {
    public static void main(String[] args) {
        String s = "abc";
        int x = s - 1; // <<error:bad-operand
        boolean b = !5; // <<error:bad-operand
    }
}
