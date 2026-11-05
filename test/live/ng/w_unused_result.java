public class Main {
    public static void main(String[] args) {
        String s = "abc";
        s.toUpperCase(); // <<warn:unused-result
        System.out.println(s);
    }
}
