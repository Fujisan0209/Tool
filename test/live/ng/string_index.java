public class Main {
    public static void main(String[] args) {
        String s = "abc";
        char c = s[0]; // <<error:string-index
        System.out.println(c);
    }
}
