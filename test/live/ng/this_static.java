public class Main {
    int x = 1;

    public static void main(String[] args) {
        System.out.println(this.x); // <<error:static-this
    }
}
