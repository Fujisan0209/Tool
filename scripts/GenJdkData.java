// JDK のクラス情報（メソッド・フィールド・例外）を src/jdk-data.js に書き出します。
// 「その場チェック」が、メソッド名のまちがいや型のまちがいを見つけるのに使います。
// 実行: java scripts/GenJdkData.java > src/jdk-data.js   （JDK 21 で作っています）
import java.lang.reflect.*;
import java.net.URI;
import java.nio.file.*;
import java.util.*;
import java.util.stream.*;

public class GenJdkData {
    // メソッドまで調べるクラス（スーパークラスとインタフェースは自動で追加）
    static final String[] SEED = {
        "java.lang.Object", "java.lang.String", "java.lang.StringBuilder", "java.lang.StringBuffer",
        "java.lang.Math", "java.lang.System", "java.lang.Integer", "java.lang.Long", "java.lang.Double",
        "java.lang.Float", "java.lang.Short", "java.lang.Byte", "java.lang.Character", "java.lang.Boolean",
        "java.lang.Thread", "java.lang.Throwable", "java.lang.Exception", "java.lang.RuntimeException",
        "java.lang.Error", "java.lang.Enum", "java.lang.Record", "java.lang.Runnable", "java.lang.Iterable",
        "java.lang.Comparable", "java.lang.CharSequence", "java.lang.AutoCloseable", "java.lang.Cloneable",
        "java.io.PrintStream", "java.io.InputStream", "java.io.BufferedReader", "java.io.InputStreamReader",
        "java.io.FileReader", "java.io.FileWriter", "java.io.PrintWriter", "java.io.BufferedWriter", "java.io.File",
        "java.io.IOException", "java.io.FileNotFoundException", "java.io.UncheckedIOException",
        "java.util.Scanner", "java.util.Random", "java.util.ArrayList", "java.util.LinkedList", "java.util.List",
        "java.util.HashMap", "java.util.TreeMap", "java.util.LinkedHashMap", "java.util.Map", "java.util.Map$Entry",
        "java.util.HashSet", "java.util.TreeSet", "java.util.LinkedHashSet", "java.util.Set", "java.util.Arrays",
        "java.util.Collections", "java.util.Iterator", "java.util.ArrayDeque", "java.util.Deque", "java.util.Queue",
        "java.util.Stack", "java.util.Vector", "java.util.PriorityQueue", "java.util.Objects", "java.util.Optional",
        "java.util.StringJoiner", "java.util.Comparator", "java.util.InputMismatchException",
        "java.util.NoSuchElementException", "java.util.ConcurrentModificationException",
        "java.lang.NumberFormatException", "java.lang.ArithmeticException", "java.lang.NullPointerException",
        "java.lang.ArrayIndexOutOfBoundsException", "java.lang.StringIndexOutOfBoundsException",
        "java.lang.IndexOutOfBoundsException", "java.lang.IllegalArgumentException",
        "java.lang.IllegalStateException", "java.lang.ClassCastException", "java.lang.InterruptedException",
        "java.lang.CloneNotSupportedException", "java.lang.ClassNotFoundException",
        "java.lang.UnsupportedOperationException", "java.lang.NegativeArraySizeException",
        "java.lang.StackOverflowError", "java.lang.OutOfMemoryError", "java.lang.AssertionError",
        "java.time.LocalDate", "java.time.LocalDateTime", "java.time.LocalTime",
        "java.nio.file.Files", "java.nio.file.Path", "java.nio.file.Paths",
    };

    // クラス名だけ集めるパッケージ（import の候補・存在チェック用）。先にあるほど優先
    static final String[] PACKAGES = {
        "java.lang", "java.util", "java.io", "java.util.function", "java.util.stream", "java.util.regex",
        "java.util.concurrent", "java.util.concurrent.atomic", "java.math", "java.text", "java.time",
        "java.time.format", "java.time.temporal", "java.nio.file", "java.nio.charset", "java.net",
        "java.awt", "java.awt.event", "java.awt.image", "java.awt.geom", "javax.swing", "javax.swing.event",
        "javax.swing.border", "javax.swing.table", "java.sql", "java.lang.reflect",
    };

    static final Map<String, Class<?>> members = new LinkedHashMap<>();
    static final Map<String, Class<?>> excs = new TreeMap<>();

    public static void main(String[] a) throws Exception {
        for (String n : SEED) addMembers(Class.forName(n));

        StringBuilder out = new StringBuilder();
        out.append("/* 自動生成: java scripts/GenJdkData.java > src/jdk-data.js （").append(System.getProperty("java.version"))
           .append("）。手で書きかえないでください。 */\n");
        out.append("(function (root) {\n  \"use strict\";\n");

        // ---- クラスのメンバー ----
        out.append("  const C = {\n");
        for (var e : members.entrySet()) {
            Class<?> c = e.getValue();
            out.append("    ").append(q(simple(c))).append(": {");
            List<String> parts = new ArrayList<>();
            parts.add("p:" + q(c.getPackageName()));
            parts.add("k:" + q(c.isInterface() ? "i" : c.isEnum() ? "e" : Modifier.isAbstract(c.getModifiers()) ? "a" : "c"));
            if (c.getSuperclass() != null) parts.add("sup:" + q(simple(c.getSuperclass())));
            List<String> ifs = new ArrayList<>();
            for (Class<?> i : c.getInterfaces()) ifs.add(simple(i));
            if (!ifs.isEmpty()) parts.add("ifs:" + arr(ifs));
            List<String> tps = new ArrayList<>();
            for (TypeVariable<?> t : c.getTypeParameters()) tps.add(t.getName());
            if (!tps.isEmpty()) parts.add("tp:" + arr(tps));

            Map<String, String> f = new TreeMap<>();
            for (Field fd : c.getDeclaredFields()) {
                if (!visible(fd.getModifiers()) || fd.isSynthetic()) continue;
                f.put(fd.getName(), (Modifier.isStatic(fd.getModifiers()) ? "s;" : "") + type(fd.getGenericType()));
            }
            if (!f.isEmpty()) parts.add("f:" + obj(f));

            Map<String, TreeSet<String>> m = new TreeMap<>();
            for (Method md : c.getDeclaredMethods()) {
                if (!visible(md.getModifiers()) || md.isSynthetic() || md.isBridge()) continue;
                StringBuilder s = new StringBuilder();
                if (Modifier.isStatic(md.getModifiers())) s.append("s;");
                s.append(params(md.getParameterTypes(), md.isVarArgs()));
                s.append(':').append(type(md.getGenericReturnType()));
                String th = throwsOf(md.getExceptionTypes());
                if (!th.isEmpty()) s.append('!').append(th);
                m.computeIfAbsent(md.getName(), k -> new TreeSet<>()).add(s.toString());
            }
            if (!m.isEmpty()) {
                List<String> ms = new ArrayList<>();
                for (var me : m.entrySet()) ms.add(q(me.getKey()) + ":" + arr(new ArrayList<>(me.getValue())));
                parts.add("m:{" + String.join(",", ms) + "}");
            }
            if (!c.isInterface() && !Modifier.isAbstract(c.getModifiers())) {
                TreeSet<String> ctors = new TreeSet<>();
                for (Constructor<?> ct : c.getDeclaredConstructors()) {
                    if (!visible(ct.getModifiers())) continue;
                    String s = params(ct.getParameterTypes(), ct.isVarArgs());
                    String th = throwsOf(ct.getExceptionTypes());
                    ctors.add(th.isEmpty() ? s : s + "!" + th);
                }
                parts.add("c:" + arr(new ArrayList<>(ctors)));
            }
            out.append(String.join(",", parts)).append("},\n");
        }
        out.append("  };\n");

        // ---- 例外の親子関係（チェック例外かどうか） ----
        for (String n : new String[]{"java.lang.Exception", "java.lang.RuntimeException", "java.lang.Error"}) addExc(Class.forName(n));
        out.append("  // 例外名: [親, チェック例外なら1]\n  const EXC = {\n");
        for (var e : excs.entrySet()) {
            Class<?> c = e.getValue();
            boolean checked = Exception.class.isAssignableFrom(c) && !RuntimeException.class.isAssignableFrom(c);
            String sup = c.getSuperclass() == null ? "" : simple(c.getSuperclass());
            out.append("    ").append(q(e.getKey())).append(": [").append(q(sup)).append(", ").append(checked ? 1 : 0).append("],\n");
        }
        out.append("  };\n");

        // ---- パッケージごとのクラス名 ----
        FileSystem jrt = FileSystems.getFileSystem(URI.create("jrt:/"));
        out.append("  // パッケージ: 公開クラス名（空白区切り）\n  const PKG = {\n");
        for (String p : PACKAGES) {
            TreeSet<String> names = new TreeSet<>();
            Path pk = jrt.getPath("/packages/" + p);
            if (!Files.exists(pk)) continue;
            try (Stream<Path> mods = Files.list(pk)) {
                for (Path mod : mods.toList()) {
                    Path dir = jrt.getPath("/modules/" + mod.getFileName() + "/" + p.replace('.', '/'));
                    if (!Files.isDirectory(dir)) continue;
                    try (Stream<Path> fs = Files.list(dir)) {
                        for (Path f : fs.toList()) {
                            String fn = f.getFileName().toString();
                            if (!fn.endsWith(".class") || fn.contains("$") || fn.equals("package-info.class") || fn.equals("module-info.class")) continue;
                            String cn = p + "." + fn.substring(0, fn.length() - 6);
                            try {
                                Class<?> c = Class.forName(cn, false, ClassLoader.getSystemClassLoader());
                                if (Modifier.isPublic(c.getModifiers())) names.add(c.getSimpleName());
                            } catch (Throwable t) { /* 読めないクラスはとばす */ }
                        }
                    }
                }
            }
            out.append("    ").append(q(p)).append(": ").append(q(String.join(" ", names))).append(",\n");
        }
        out.append("  };\n");

        // JDK のすべてのパッケージ名（import のチェック用）
        TreeSet<String> allPkgs = new TreeSet<>();
        try (Stream<Path> ps = Files.list(jrt.getPath("/packages"))) {
            for (Path pk : ps.toList()) {
                String n = pk.getFileName().toString();
                if (n.startsWith("java.") || n.startsWith("javax.")) allPkgs.add(n);
            }
        }
        out.append("  const ALL_PKGS = ").append(q(String.join(" ", allPkgs))).append(";\n");
        out.append("  const api = { CLASSES: C, EXCEPTIONS: EXC, PACKAGES: PKG, ALL_PKGS: new Set(ALL_PKGS.split(\" \")) };\n");
        out.append("  if (typeof module !== \"undefined\" && module.exports) module.exports = api;\n");
        out.append("  else root.JavaJdkData = api;\n");
        out.append("})(typeof globalThis !== \"undefined\" ? globalThis : this);\n");
        System.out.print(out);
    }

    // public と protected（継承したクラスから使える）
    static boolean visible(int mod) {
        return Modifier.isPublic(mod) || Modifier.isProtected(mod);
    }

    static void addMembers(Class<?> c) {
        String k = simple(c);
        if (members.containsKey(k)) return;
        members.put(k, c);
        if (Throwable.class.isAssignableFrom(c)) addExc(c);
        if (c.getSuperclass() != null) addMembers(c.getSuperclass());
        for (Class<?> i : c.getInterfaces()) addMembers(i);
    }

    static void addExc(Class<?> c) {
        while (c != null && Throwable.class.isAssignableFrom(c)) {
            excs.putIfAbsent(simple(c), c);
            c = c.getSuperclass();
        }
    }

    static String throwsOf(Class<?>[] ts) {
        List<String> l = new ArrayList<>();
        for (Class<?> t : ts) {
            addExc(t);
            l.add(simple(t));
        }
        return String.join(",", l);
    }

    static String params(Class<?>[] ps, boolean varargs) {
        List<String> l = new ArrayList<>();
        for (int i = 0; i < ps.length; i++) {
            String t = raw(ps[i]);
            if (varargs && i == ps.length - 1) t = t.substring(0, t.length() - 2) + "...";
            l.add(t);
        }
        return String.join(",", l);
    }

    static String raw(Class<?> c) {
        if (c.isArray()) return raw(c.getComponentType()) + "[]";
        return simple(c);
    }

    /** Map$Entry → Map.Entry */
    static String simple(Class<?> c) {
        if (c.isArray()) return raw(c);
        if (c.isPrimitive()) return c.getName();
        String n = c.getName();
        String p = c.getPackageName();
        if (!p.isEmpty()) n = n.substring(p.length() + 1);
        return n.replace('$', '.');
    }

    /** ジェネリクスを残した型名（List<E> など）。? extends X は X にする */
    static String type(Type t) {
        if (t instanceof Class<?> c) return raw(c);
        if (t instanceof TypeVariable<?> v) return v.getName();
        if (t instanceof GenericArrayType g) return type(g.getGenericComponentType()) + "[]";
        if (t instanceof WildcardType w) {
            Type[] lo = w.getLowerBounds();
            if (lo.length > 0) return type(lo[0]);
            return type(w.getUpperBounds()[0]);
        }
        if (t instanceof ParameterizedType p) {
            String args = Arrays.stream(p.getActualTypeArguments()).map(GenJdkData::type).collect(Collectors.joining(","));
            return type(p.getRawType()) + "<" + args + ">";
        }
        return "Object";
    }

    static String q(String s) {
        return "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"") + "\"";
    }

    static String arr(List<String> l) {
        return "[" + l.stream().map(GenJdkData::q).collect(Collectors.joining(",")) + "]";
    }

    static String obj(Map<String, String> m) {
        return "{" + m.entrySet().stream().map(e -> q(e.getKey()) + ":" + q(e.getValue())).collect(Collectors.joining(",")) + "}";
    }
}
