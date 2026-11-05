public class Main {
    int count = 0;

    public static void main(String[] args) {
        count++; // <<error:static-context
        System.out.println(count); // <<error:static-context
    }
}
