abstract class Animal {
    abstract void sound();
}

public class Main {
    public static void main(String[] args) {
        Animal a = new Animal(); // <<error:new-abstract
    }
}
