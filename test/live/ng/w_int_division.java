public class Main {
    public static void main(String[] args) {
        int sum = 7;
        int count = 2;
        double avg = sum / count; // <<warn:int-division
        System.out.println(avg);
    }
}
