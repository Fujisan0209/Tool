public class Main {
    public static void main(String[] args) {
        int n = (int) "5"; // <<error:bad-cast
        System.out.println(n);
    }
}
