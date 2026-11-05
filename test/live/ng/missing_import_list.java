public class Main {
    public static void main(String[] args) {
        ArrayList<String> list = new ArrayList<>(); // <<error:missing-import
        list.add("a");
    }
}
