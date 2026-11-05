public class Main {
    public static void main(String[] args) { // <<error:missing-brace
        System.out.println("a");

    static void foo() { // <<javac
        System.out.println("b");
    }
}
