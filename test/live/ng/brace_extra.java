public class Main {
    public static void main(String[] args) {
        System.out.println("a");
        } // <<error:extra-brace
    }

    static void foo() { // <<javac
        System.out.println("b");
    }
}
