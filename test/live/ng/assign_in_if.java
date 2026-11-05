public class Main {
    public static void main(String[] args) {
        int x = 5;
        if (x = 5) { // <<error:assign-in-cond
            System.out.println("five");
        }
    }
}
