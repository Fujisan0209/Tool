public class Main {
    public static void main(String[] args) {
        int i = 0;
        for (int i = 0; i < 3; i++) { // <<error:dup-var
            System.out.println(i);
        }
    }
}
