import java.util.ArrayList;

public class Main {
    public static void main(String[] args) {
        ArrayList<int> list = new ArrayList<>(); // <<error:generic-prim
        list.add(1);
    }
}
