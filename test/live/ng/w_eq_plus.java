public class Main {
    public static void main(String[] args) {
        int total = 0;
        total =+ 5; // <<warn:eq-plus
        System.out.println(total);
    }
}
