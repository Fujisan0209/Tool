public class Main {
    public static void main(String[] args) {
        int x = 5;
        if (x > 0) { // <<error:missing-brace
            System.out.println("plus");
        System.out.println("done");
    }
} // <<javac
