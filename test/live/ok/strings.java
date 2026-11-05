public class Main {
    public static void main(String[] args) {
        String s = "Hello, World";
        System.out.println(s.length());
        System.out.println(s.charAt(0));
        System.out.println(s.substring(0, 5).toUpperCase());
        System.out.println(s.indexOf("World"));
        System.out.println(s.contains("lo") && s.startsWith("He"));
        String t = s.replace("World", "Java");
        t = t.trim();
        if (t.equals("Hello, Java")) {
            System.out.println("same");
        }
        if (t.equalsIgnoreCase("hello, java") || t.isEmpty()) {
            System.out.println("ok");
        }
        char c = s.charAt(1);
        if (c == 'e') {
            System.out.println("e!");
        }
        int code = c + 1;
        char next = (char) (c + 1);
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < 3; i++) {
            sb.append(i).append(',');
        }
        sb.reverse();
        String joined = String.join("-", "a", "b");
        String num = String.valueOf(42);
        String fmt = String.format("%05d", 42);
        int cmp = "apple".compareTo("banana");
        String rep = "ab".repeat(3);
        if (s != null && s.compareTo("A") > 0) {
            System.out.println("after A");
        }
        System.out.println(code + next + sb.toString() + joined + num + fmt + cmp + rep);
        String multi = """
            Hello
              Text block
            """;
        System.out.println(multi.lines().count());
        System.out.println("tab\tnew\nquote\"back\\");
    }
}
