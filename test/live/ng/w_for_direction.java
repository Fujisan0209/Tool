public class Main {
    public static void main(String[] args) {
        for (int i = 0; i < 10; i--) { // <<warn:for-direction
            System.out.println(i);
        }
    }
}
