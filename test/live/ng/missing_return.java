public class Main {
    static String grade(int s) {
        if (s >= 80) {
            return "A";
        } else if (s >= 60) {
            return "B";
        }
    } // <<error:missing-return

    public static void main(String[] args) {
        System.out.println(grade(70));
    }
}
