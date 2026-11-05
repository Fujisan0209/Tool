public class Main {
    public static void main(String[] args) {
        boolean done = false;
        if (done = true) { // <<warn:assign-in-cond
            System.out.println("done");
        }
    }
}
