public class Main {
    public static void main(String[] args) {
        System.out.println(price); // <<error:use-before-decl
        int price = 100;
    }
}
