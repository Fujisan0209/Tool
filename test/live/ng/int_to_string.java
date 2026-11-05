public class Main {
    public static void main(String[] args) {
        int n = 5;
        String s = n; // <<error:type-mismatch
        System.out.println(s);
    }
}
