public class Main {
    public static void main(String[] args) {
        int x = 1;
        int x = 2; // <<error:dup-var
        System.out.println(x);
    }
}
