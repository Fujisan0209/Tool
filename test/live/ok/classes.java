import java.util.ArrayList;
import java.util.List;

abstract class Animal {
    protected String name;
    private int age;

    Animal(String name, int age) {
        this.name = name;
        this.age = age;
    }

    int getAge() {
        return age;
    }

    abstract String sound();

    @Override
    public String toString() {
        return name + "(" + age + ")";
    }
}

class Dog extends Animal {
    Dog(String name, int age) {
        super(name, age);
    }

    @Override
    String sound() {
        return "ワン";
    }
}

class Cat extends Animal {
    Cat(String name) {
        this(name, 1);
    }

    Cat(String name, int age) {
        super(name, age);
    }

    @Override
    String sound() {
        return "ニャー";
    }

    @Override
    public boolean equals(Object o) {
        return o instanceof Cat c && c.name.equals(name);
    }

    @Override
    public int hashCode() {
        return name.hashCode();
    }
}

interface Shape {
    double area();

    default String describe() {
        return "面積 " + area();
    }
}

class Circle implements Shape, Comparable<Circle> {
    private final double r;

    Circle(double r) {
        this.r = r;
    }

    public double area() {
        return Math.PI * r * r;
    }

    @Override
    public int compareTo(Circle o) {
        return Double.compare(r, o.r);
    }
}

public class Main {
    private int counter = 0;
    static int total = 0;

    void increment() {
        counter++;
        total++;
    }

    public static void main(String[] args) {
        List<Animal> zoo = new ArrayList<>();
        zoo.add(new Dog("ポチ", 3));
        zoo.add(new Cat("タマ"));
        for (Animal a : zoo) {
            System.out.println(a + " " + a.sound() + " " + a.getAge() + a.name);
        }
        Shape s = new Circle(2);
        System.out.println(s.describe());
        Main m = new Main();
        m.increment();
        System.out.println(m.counter + total);
        Circle c1 = new Circle(1);
        System.out.println(c1.compareTo(new Circle(3)));
    }
}
