public class Main {
    public static void main(String[] args) {
        for (int i = 0; i < 3; i++) {
            int sq = i * i;
        }
        System.out.println(sq); // <<error:out-of-scope
    }
}
