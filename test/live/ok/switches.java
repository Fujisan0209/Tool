public class Main {
    enum Day { MON, TUE, WED, SAT, SUN }

    static String kind(Day d) {
        switch (d) {
            case SAT:
            case SUN:
                return "休み";
            default:
                return "平日";
        }
    }

    static int days(int month) {
        return switch (month) {
            case 2 -> 28;
            case 4, 6, 9, 11 -> 30;
            default -> {
                int d = 31;
                yield d;
            }
        };
    }

    static String name(String code) {
        String r;
        switch (code) {
            case "a":
                r = "エー";
                break;
            case "b":
                r = "ビー";
                break;
            default:
                r = "?";
        }
        return r;
    }

    static String arrow(Day d) {
        String label = switch (d) {
            case MON, TUE, WED -> "前半";
            case SAT, SUN -> "週末";
        };
        return label;
    }

    public static void main(String[] args) {
        System.out.println(kind(Day.SAT) + days(4) + name("a") + arrow(Day.MON));
        char grade = 'B';
        switch (grade) {
            case 'A' -> System.out.println("優");
            case 'B' -> System.out.println("良");
            default -> System.out.println("可");
        }
        for (Day d : Day.values()) {
            System.out.println(d.name() + d.ordinal());
        }
        Day x = Day.valueOf("MON");
        System.out.println(x == Day.MON);
    }
}
