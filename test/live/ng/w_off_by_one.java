public class Main {
    public static void main(String[] args) {
        int[] a = {1, 2, 3};
        for (int i = 0; i <= a.length; i++) { // <<warn:off-by-one
            System.out.println(a[i]);
        }
    }
}
