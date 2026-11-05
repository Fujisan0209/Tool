import java.util.ArrayList;

public class Main {
    public static void main(String[] args) {
        ArrayList<String> names = new ArrayList<>();
        for (int n : names) { // <<error:foreach-type
            System.out.println(n);
        }
    }
}
