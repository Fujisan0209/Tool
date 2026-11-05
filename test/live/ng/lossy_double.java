public class Main {
    public static void main(String[] args) {
        int x = 3.5; // <<error:lossy
        int p = Math.pow(2, 3); // <<error:lossy
        System.out.println(x + p);
    }
}
