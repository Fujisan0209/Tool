public class Main {
    class Dog {
        String name = "Pochi";
    }

    public static void main(String[] args) {
        Dog d = new Dog(); // <<error:inner-new-static
        System.out.println(d.name);
    }
}
