public class Main {
    public static void main(String[] args) {
        String a = "x";
        String b = "y";
        if (a < b) { // <<error:bad-operand
            System.out.println(a);
        }
    }
}
