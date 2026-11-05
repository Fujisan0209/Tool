public class Main {
    void hello() {
        System.out.println("hello");
    }

    public static void main(String[] args) {
        hello(); // <<error:static-context
    }
}
