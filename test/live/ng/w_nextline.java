import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int age = sc.nextInt();
        String name = sc.nextLine(); // <<warn:nextline-after-nextint
        System.out.println(name + age);
    }
}
