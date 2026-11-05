public class Main {
    public static void main(String[] args) {
        char c = 'a';
        c++;
        c += 2;
        int diff = 'z' - c;
        char up = Character.toUpperCase(c);
        boolean digit = Character.isDigit('5');
        int v = '7' - '0';
        byte b = 10;
        short sh = 300;
        long big = 10_000_000_000L;
        float f = 1.5f;
        double d = f * 2;
        int i = (int) d;
        long l = i;
        double half = 1 / 2.0;
        int neg = -2147483648;
        int hex = 0xFF;
        int bin = 0b1010;
        int mod = 17 % 5;
        i <<= 1;
        i >>= 1;
        boolean x = (i & 1) == 0 ^ true;
        int ternary = i > 0 ? i : -i;
        Integer boxed = 5;
        int unboxed = boxed + 1;
        double avg = (double) (i + mod) / 2;
        System.out.println("" + diff + up + (digit ? 1 : 0) + v + b + sh + big + f + d + l + half + neg + hex + bin + x + ternary + unboxed + avg);
    }
}
