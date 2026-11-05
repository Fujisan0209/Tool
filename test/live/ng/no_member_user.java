class Dog {
    String name = "Pochi";

    void bark() {
        System.out.println("ワン");
    }
}

public class Main {
    public static void main(String[] args) {
        Dog d = new Dog();
        d.brak(); // <<error:no-member
        System.out.println(d.nmae); // <<error:no-member
    }
}
