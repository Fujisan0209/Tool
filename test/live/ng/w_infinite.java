public class Main {
    public static void main(String[] args) {
        int n = 0;
        while (true) { // <<warn:infinite-loop
            n++;
            System.out.println(n);
        }
    }
}
