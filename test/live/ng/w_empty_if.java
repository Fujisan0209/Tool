public class Main {
    public static void main(String[] args) {
        int x = -1;
        if (x > 0); // <<warn:empty-body
        {
            System.out.println("plus?");
        }
    }
}
