class Account {
    private int balance = 100;
}

public class Main {
    public static void main(String[] args) {
        Account a = new Account();
        System.out.println(a.balance); // <<error:private-access
    }
}
