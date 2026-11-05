public class Main {
    private int v = 1;

    @Override // <<javac
    public String tostring() { // <<error:override-none
        return "v=" + v;
    }

    public static void main(String[] args) {
        System.out.println(new Main());
    }
}
