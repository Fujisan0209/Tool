class Dog {
    String name;
    int age;

    Dog(String name, int age) {
        this.name = name;
        this.age = age;
    }
}

public class Main {
    public static void main(String[] args) {
        Dog d = new Dog("Pochi"); // <<error:arg-count
        System.out.println(d.name);
    }
}
