public class Main {
    public static void main(String[] args) {
        String s = "hello";
        for (char c : s) { // <<error:foreach-string
            System.out.println(c);
        }
    }
}
