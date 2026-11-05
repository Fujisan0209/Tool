public class Main {
    public static void main(String[] args) {
        int x = 1;
        if (x) { // <<error:cond-type
            System.out.println("x");
        }
    }
}
