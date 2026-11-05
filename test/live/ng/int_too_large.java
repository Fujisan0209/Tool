public class Main {
    public static void main(String[] args) {
        long big = 3000000000; // <<error:int-too-large
        System.out.println(big);
    }
}
