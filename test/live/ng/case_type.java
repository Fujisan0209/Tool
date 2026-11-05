public class Main {
    public static void main(String[] args) {
        int n = 1;
        switch (n) {
            case "1": // <<error:case-type
                System.out.println("one");
                break;
        }
    }
}
