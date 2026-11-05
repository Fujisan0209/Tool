public class Main {
    static int get() {
        return; // <<error:return-missing-value
    }

    public static void main(String[] args) {
        System.out.println(get());
    }
}
