class Dog {
    String name;

    Dog(String name) {
        name = name; // <<warn:self-assign
    }
}

public class Main {
    public static void main(String[] args) {
        System.out.println(new Dog("Pochi").name);
    }
}
