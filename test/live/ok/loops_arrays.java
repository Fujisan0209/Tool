public class Main {
    public static void main(String[] args) {
        int[] scores = {80, 92, 75, 64};
        int sum = 0;
        for (int i = 0; i < scores.length; i++) {
            sum += scores[i];
        }
        double avg = (double) sum / scores.length;
        int max = scores[0];
        for (int s : scores) {
            if (s > max) max = s;
        }
        int[][] grid = new int[3][4];
        for (int r = 0; r < grid.length; r++) {
            for (int c = 0; c < grid[r].length; c++) {
                grid[r][c] = r * c;
            }
        }
        String[] names = new String[2];
        names[0] = "A";
        names[1] = "B";
        int count = 0;
        while (count < 3) {
            count++;
        }
        do {
            count--;
        } while (count > 0);
        outer:
        for (int i = 0; i < 5; i++) {
            for (int j = 0; j < 5; j++) {
                if (i * j > 6) break outer;
                if (j > i) continue outer;
            }
        }
        char[] cs = "abc".toCharArray();
        for (char ch : cs) System.out.print(ch);
        int[] copy = java.util.Arrays.copyOf(scores, 6);
        System.out.println(sum + " " + avg + " " + max + " " + grid[2][3] + names[1] + copy.length);
    }
}
