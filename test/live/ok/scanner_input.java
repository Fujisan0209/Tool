import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        System.out.print("名前: ");
        String name = sc.nextLine();
        System.out.print("年齢: ");
        int age = sc.nextInt();
        double height = sc.nextDouble();
        sc.nextLine();
        String memo = sc.nextLine();
        if (age >= 20) {
            System.out.println(name + "さんは大人です");
        } else if (age >= 13) {
            System.out.println(name + "さんは中高生です");
        } else {
            System.out.println(name + "さんは子どもです");
        }
        System.out.println("身長 " + height + " / " + memo);
        int n = Integer.parseInt(sc.next());
        long big = Long.parseLong("123");
        double d = Double.parseDouble("1.5");
        System.out.println(n + big + d);
        sc.close();
    }
}
