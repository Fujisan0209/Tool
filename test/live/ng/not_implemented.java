class Item implements Comparable<Item> { // <<error:not-implemented
    int price;
}

public class Main {
    public static void main(String[] args) {
        System.out.println(new Item().price);
    }
}
