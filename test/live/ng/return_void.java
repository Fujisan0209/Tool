public class Main {
    static void show() {
        return 5; // <<error:return-value-void
    }

    public static void main(String[] args) {
        show();
    }
}
