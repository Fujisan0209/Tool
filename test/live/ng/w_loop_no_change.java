public class Main {
    public static void main(String[] args) {
        int i = 0;
        int[] a = new int[10];
        while (i < 10) { // <<warn:loop-no-change
            a[i] = i * 2;
            System.out.println(a[i]);
        }
    }
}
