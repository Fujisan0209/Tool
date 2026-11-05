public class Main {
    public static void main(String[] args) {
        String path = "C:\Users\taro"; // <<error:bad-escape
        System.out.println(path);
    }
}
