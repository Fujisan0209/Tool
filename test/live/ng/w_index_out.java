public class Main {
    public static void main(String[] args) {
        int[] a = new int[3];
        a[3] = 10; // <<warn:index-out
        System.out.println(a[0]);
    }
}
