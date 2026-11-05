import java.io.FileReader;

public class Main {
    public static void main(String[] args) {
        FileReader fr = new FileReader("a.txt"); // <<error:unreported-exception
    }
}
