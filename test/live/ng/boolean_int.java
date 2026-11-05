public class Main {
    public static void main(String[] args) {
        boolean ok = 1; // <<error:type-mismatch
        System.out.println(ok);
    }
}
