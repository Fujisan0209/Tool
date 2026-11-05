public class Main {
    public static void main(String[] args) {
        int x = 3;
        String msg;
        if (x > 0) {
            msg = "plus";
        } else if (x < 0) {
            msg = "minus";
        }
        System.out.println(msg); // <<error:uninit
    }
}
