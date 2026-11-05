public class Main {
    public static void main(String[] args) {
        int n = 12345;
        System.out.println(n.length()); // <<error:deref-prim
    }
}
