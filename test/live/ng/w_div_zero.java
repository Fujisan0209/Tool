public class Main {
    public static void main(String[] args) {
        int x = 10 / 0; // <<warn:div-zero
        System.out.println(x);
    }
}
