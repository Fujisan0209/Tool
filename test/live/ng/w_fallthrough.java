public class Main {
    public static void main(String[] args) {
        int n = 2;
        switch (n) {
            case 1:
                System.out.println("one");
            case 2: // <<warn:switch-fallthrough
                System.out.println("two");
                break;
            default:
                System.out.println("other");
        }
    }
}
