public class Main {
    public static void main(String[] args) {
        final int MAX = 10;
        MAX = 20; // <<error:final-assign
        System.out.println(MAX);
    }
}
