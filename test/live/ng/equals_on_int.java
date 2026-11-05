public class Main {
    public static void main(String[] args) {
        int a = 3;
        if (a.equals(3)) { // <<error:deref-prim
            System.out.println("3");
        }
    }
}
