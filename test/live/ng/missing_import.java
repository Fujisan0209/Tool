public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in); // <<error:missing-import
        int n = sc.nextInt();
        System.out.println(n);
    }
}
