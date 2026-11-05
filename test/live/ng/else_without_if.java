public class Main {
    public static void main(String[] args) {
        int x = 3;
        if (x > 0)
            System.out.println("a");
            System.out.println("b");
        else // <<error:else-without-if
            System.out.println("c");
    }
}
