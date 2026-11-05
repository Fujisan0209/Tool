public class Main {
    public static void main(String[] args) {
        char c = 'a';
        if (c == "a") { // <<error:incomparable
            System.out.println("a");
        }
    }
}
