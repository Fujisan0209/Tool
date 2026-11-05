// テスト用: フォルダの中の .java を1つずつ本物の javac でコンパイルし、エラーの行を JSON で出します。
// 実行: java test/JavacCheck.java test/live
// ファイルの先頭に「// file: Hello.java」と書くと、そのファイル名としてコンパイルします（なければ Main.java）。
import javax.tools.*;
import java.io.*;
import java.net.URI;
import java.nio.file.*;
import java.util.*;

public class JavacCheck {
    public static void main(String[] args) throws Exception {
        JavaCompiler jc = ToolProvider.getSystemJavaCompiler();
        List<Path> files = new ArrayList<>();
        for (String a : args) {
            try (var s = Files.walk(Path.of(a))) {
                s.filter(p -> p.toString().endsWith(".java")).sorted().forEach(files::add);
            }
        }
        StringBuilder out = new StringBuilder("[\n");
        boolean first = true;
        for (Path p : files) {
            String src = Files.readString(p);
            String name = "Main.java";
            var m = java.util.regex.Pattern.compile("//\\s*file:\\s*(\\S+\\.java)").matcher(src);
            if (m.find()) name = m.group(1);
            final String fname = name;
            JavaFileObject fo = new SimpleJavaFileObject(URI.create("string:///" + fname), JavaFileObject.Kind.SOURCE) {
                @Override public CharSequence getCharContent(boolean ignore) { return src; }
            };
            DiagnosticCollector<JavaFileObject> dc = new DiagnosticCollector<>();
            Path outDir = Files.createTempDirectory("jc");
            StandardJavaFileManager fm = jc.getStandardFileManager(dc, Locale.ENGLISH, null);
            fm.setLocation(StandardLocation.CLASS_OUTPUT, List.of(outDir.toFile()));
            boolean ok = jc.getTask(new StringWriter(), fm, dc, List.of("-Xlint:none", "-proc:none", "-encoding", "UTF-8"), null, List.of(fo)).call();
            if (!first) out.append(",\n");
            first = false;
            out.append("{\"file\":").append(q(p.toString())).append(",\"ok\":").append(ok).append(",\"errors\":[");
            boolean f2 = true;
            for (var d : dc.getDiagnostics()) {
                if (d.getKind() != Diagnostic.Kind.ERROR) continue;
                if (!f2) out.append(",");
                f2 = false;
                out.append("{\"line\":").append(d.getLineNumber()).append(",\"code\":").append(q(d.getCode()))
                   .append(",\"msg\":").append(q(d.getMessage(Locale.ENGLISH).split("\n")[0])).append("}");
            }
            out.append("]}");
        }
        out.append("\n]\n");
        System.out.print(out);
    }

    static String q(String s) {
        StringBuilder b = new StringBuilder("\"");
        for (char c : s.toCharArray()) {
            if (c == '"' || c == '\\') b.append('\\').append(c);
            else if (c < 0x20) b.append(String.format("\\u%04x", (int) c));
            else b.append(c);
        }
        return b.append('"').toString();
    }
}
