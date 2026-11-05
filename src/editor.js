/*
 * その場チェックの画面。
 *   - 打つたびに色分け（すぐ）
 *   - 打つ手が止まったら解析（約 0.2 秒後。重いファイルほど少し待つ）
 *   - いま打っている行に「新しく」出たまちがいは、少し待ってから出す（打ちかけで「; がない」がチカチカしないように）
 *   - 直したまちがいは、すぐ消える
 * jdk-data.js / lexer.js / parser.js / types.js / checker.js を先に読みこんでください。
 */
(function () {
  "use strict";

  const { check } = window.JavaChecker;
  const { lex } = window.JavaLexer;

  const $ = (id) => document.getElementById(id);
  const input = $("input");
  const backdrop = $("backdrop");
  const gutter = $("gutter");
  const scroller = $("scroller");
  const list = $("list");
  const summary = $("summary");
  const fname = $("fname");
  const statusLine = $("status-line");
  const statusMs = $("status-ms");
  const tabDot = $("tab-dot");
  const toastEl = $("toast");
  const samplesSel = $("samples");

  const STORE_KEY = "java-sonoba-check:v1";
  const LINE_GRACE = 900; // いま打っている行の、新しい指摘を待つ時間（ms）
  const PAD_TOP = 12;
  const PAD_LEFT = 14;

  /* ------------------------------------------------------------------ */
  /* 例のコード                                                          */
  /* ------------------------------------------------------------------ */
  const SAMPLES = [
    {
      label: "まちがい探し（入門）",
      code: `import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        System.out.print("年齢を入力: ");
        int age = sc.nextLine();
        String name = "Taro"
        if (age >= 20) {
            System.out.println(name + "さんは大人です");
        } else {
            System.out.println(nme + "さんは子どもです");
        }
        int sum;
        for (int i = 1; i <= 10; i++) {
            sum += i;
        }
        System.out.println("合計：" + sum)；
    }
}
`,
    },
    {
      label: "クラスとメソッド",
      code: `public class Main {
    int count = 0;

    static int add(int a, int b) {
        return a + b;
    }

    static String grade(int score) {
        if (score >= 80) {
            return "A";
        } else if (score >= 60) {
            return "B";
        }
    }

    void countUp() {
        count++;
    }

    @Override
    public String tostring() {
        return "count=" + count;
    }

    public static void main(String[] args) {
        System.out.println(add(1));
        System.out.println(grade(70));
        countUp();
        Dog d = new Dog("ポチ");
        d.bark();
    }
}

class Dog {
    private String name;

    Dog(String name, int age) {
        this.name = name;
    }

    void bark() {
        System.out.println(name + "「ワン」");
    }
}
`,
    },
    {
      label: "配列・文字列・リスト",
      code: `import java.util.ArrayList;

public class Main {
    public static void main(String[] args) {
        int[] scores = {80, 65, 92};
        int total = 0;
        for (int i = 0; i <= scores.length; i++) {
            total += scores[i];
        }
        double avg = total / scores.length;
        System.out.println("平均: " + avg);
        System.out.println("人数: " + scores.length());

        String answer = "yes";
        if (answer == "yes") {
            System.out.println("OK");
        }
        String word = "java";
        word.toUpperCase();
        char first = word[0];

        ArrayList<int> list = new ArrayList<>();
        list.add(3);
        System.out.println(list.length());
    }
}
`,
    },
    {
      label: "例外とファイル",
      code: `import java.io.BufferedReader;
import java.io.FileReader;

public class Main {
    static int parse(String s) {
        int n;
        try {
            n = Integer.parseInt(s);
        } catch (NumberFormatException e) {
            System.out.println("数ではありません: " + s);
        }
        return n;
    }

    public static void main(String[] args) {
        BufferedReader br = new BufferedReader(new FileReader("data.txt"));
        String line = br.readLine();
        System.out.println(parse(line));
        Thread.sleep(500);
        System.out.println("おわり");
    }
}
`,
    },
    {
      label: "正しいプログラム",
      code: `import java.util.ArrayList;
import java.util.List;
import java.util.Scanner;

public class Main {
    record Item(String name, int price) {}

    static int total(List<Item> items) {
        int sum = 0;
        for (Item it : items) {
            sum += it.price();
        }
        return sum;
    }

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        List<Item> cart = new ArrayList<>();
        cart.add(new Item("りんご", 120));
        cart.add(new Item("パン", 230));
        System.out.print("あといくつ買いますか: ");
        int n = sc.nextInt();
        for (int i = 0; i < n; i++) {
            cart.add(new Item("おまけ" + (i + 1), 0));
        }
        int sum = total(cart);
        String msg = sum >= 300 ? "送料無料です" : "送料がかかります";
        System.out.printf("合計 %d 円（%s）%n", sum, msg);
    }
}
`,
    },
  ];
  const BLANK = "public class Main {\n    public static void main(String[] args) {\n        \n    }\n}\n";

  /* ------------------------------------------------------------------ */
  /* 状態                                                                */
  /* ------------------------------------------------------------------ */
  let prevText = "";
  let diags = []; // { s, e, sev, id, msg, fix, edits, line, stale, key }
  let shown = new Set(); // 前回画面に出した指摘
  let lastEditAt = 0;
  let caretLine = 0;
  let analyzeTimer = 0;
  let graceTimer = 0;
  let saveTimer = 0;
  let debounceMs = 200;
  let model = null; // 最後に描いたときの { text, starts, codes, marks, perLine }
  let htmlCache = new Map();
  let pool = []; // 見えている行の { ln, g, html, cls, gcls, num }
  let first = 0; // pool[0] の行番号
  let paintQueued = false;
  let activeKey = null;
  let lastPanelSig = "";
  let autoPairs = new Set(); // 自動で入れた閉じ記号の位置（打てばそのまま通り過ぎる）
  let autoClose = true;
  let LH = 22;

  /* ------------------------------------------------------------------ */
  /* 色分け                                                              */
  /* ------------------------------------------------------------------ */
  const CLS = ["", "t-kw", "t-st", "t-nu", "t-cm", "t-ty", "t-fn", "t-an", "t-bad"];
  const LITERAL_KW = new Set(["true", "false", "null"]);

  function esc(s) {
    return s.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));
  }

  function colorCodes(text) {
    const codes = new Uint8Array(text.length);
    const { tokens, comments } = lex(text);
    for (const c of comments) codes.fill(4, c.s, c.e);
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      let c = 0;
      switch (t.t) {
        case "kw":
          c = LITERAL_KW.has(t.v) ? 3 : 1;
          break;
        case "id": {
          const nx = tokens[i + 1];
          const pv = tokens[i - 1];
          if ((t.v === "var" || t.v === "record" || t.v === "yield") && nx && nx.t === "id") c = 1;
          else if (pv && pv.t === "op" && pv.v === "@") c = 7;
          else if (nx && nx.t === "op" && nx.v === "(") c = 6;
          else if (/^[A-Z]/.test(t.v) && !/^[A-Z0-9_]+$/.test(t.v)) c = 5;
          break;
        }
        case "num":
          c = 3;
          break;
        case "str":
        case "chr":
          c = 2;
          break;
        case "bad":
          c = 8;
          break;
        case "op":
          if (t.v === "@") {
            const nx = tokens[i + 1];
            if (nx && nx.t === "id") c = 7;
          }
          break;
      }
      if (c) codes.fill(c, t.s, t.e);
    }
    return { codes, tokens, comments };
  }

  /* ------------------------------------------------------------------ */
  /* 指摘の位置を、編集に合わせてずらす                                   */
  /* ------------------------------------------------------------------ */
  function shiftDiags(oldText, newText) {
    let p = 0;
    const max = Math.min(oldText.length, newText.length);
    while (p < max && oldText.charCodeAt(p) === newText.charCodeAt(p)) p++;
    let q = 0;
    while (q < max - p && oldText.charCodeAt(oldText.length - 1 - q) === newText.charCodeAt(newText.length - 1 - q)) q++;
    const oldEnd = oldText.length - q;
    const delta = newText.length - oldText.length;
    // 自動で入れた閉じ記号の位置もずらす（編集した範囲に入ったものは忘れる）
    const pairs = new Set();
    for (const pos of autoPairs) {
      if (pos < p) pairs.add(pos);
      else if (pos >= oldEnd) pairs.add(pos + delta);
    }
    autoPairs = pairs;
    for (const d of diags) {
      if (d.e < p || (d.e === p && d.s < p)) continue;
      if (d.s >= oldEnd && d.s > p) {
        d.s += delta;
        d.e += delta;
        if (d.edits) d.edits = d.edits.map((x) => (x.s >= oldEnd ? { s: x.s + delta, e: x.e + delta, text: x.text } : x));
        continue;
      }
      // 編集した場所と重なる指摘は、次の解析まで薄く表示
      d.stale = true;
      d.s = Math.min(d.s, newText.length);
      d.e = Math.min(Math.max(d.e + (d.e >= oldEnd ? delta : 0), d.s), newText.length);
    }
  }

  /* ------------------------------------------------------------------ */
  /* 描画                                                                */
  /* ------------------------------------------------------------------ */
  function lineStarts(text) {
    const starts = [0];
    for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
    return starts;
  }
  function lineOf(starts, pos) {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /** 画面に出す指摘（打ちかけの行の新しい指摘は待つ） */
  function visibleDiags(starts) {
    const now = Date.now();
    const typing = now - lastEditAt < LINE_GRACE;
    const out = [];
    let wait = false;
    for (const d of diags) {
      d.line = lineOf(starts, d.s);
      d.key = d.id + "@" + d.s;
      const isNew = !shown.has(d.id + "@" + d.line);
      if (typing && d.line === caretLine && isNew && !d.stale) {
        wait = true;
        continue;
      }
      out.push(d);
    }
    if (wait) {
      clearTimeout(graceTimer);
      graceTimer = setTimeout(render, LINE_GRACE - (now - lastEditAt) + 20);
    }
    return out;
  }

  // 長いファイルでも重くならないように、見えている行（と前後少し）だけを描く
  const OVERSCAN = 40;
  const topSpacer = document.createElement("div");
  const botSpacer = document.createElement("div");
  const gTopSpacer = document.createElement("div");
  const gBotSpacer = document.createElement("div");
  backdrop.append(topSpacer, botSpacer);
  gutter.append(gTopSpacer, gBotSpacer);

  /** 文字の幅（半角を1、全角を2として数える） */
  function maxLineUnits(text, starts) {
    let max = 0;
    for (let li = 0; li < starts.length; li++) {
      const ls = starts[li];
      const le = li + 1 < starts.length ? starts[li + 1] - 1 : text.length;
      if (le - ls <= max / 2) continue;
      let u = 0;
      for (let i = ls; i < le; i++) {
        const c = text.charCodeAt(i);
        if (c === 9) u += 4 - (u % 4);
        else if (c >= 0x1100 && !(c >= 0xdc00 && c <= 0xdfff)) u += 2;
        else if (!(c >= 0xdc00 && c <= 0xdfff)) u += 1;
      }
      if (u > max) max = u;
    }
    return max;
  }

  /** 指摘と色分けを計算して、画面を描く */
  function render() {
    const text = input.value;
    const starts = lineStarts(text);
    const { codes, tokens, comments } = colorCodes(text);
    const marks = new Uint8Array(text.length + 1);
    const vis = visibleDiags(starts);
    const perLine = new Map();
    for (const d of vis) {
      const bit = d.sev === "error" ? 1 : 2;
      const s = Math.max(0, Math.min(d.s, text.length));
      let e = Math.min(d.e, text.length);
      if (e <= s) e = Math.min(s + 1, text.length);
      if (!d.stale) for (let i = s; i < e; i++) marks[i] |= bit;
      const arr = perLine.get(d.line) || [];
      arr.push(d);
      perLine.set(d.line, arr);
    }
    for (const ds of perLine.values()) ds.sort((a, b) => (a.sev === b.sev ? a.s - b.s : a.sev === "error" ? -1 : 1));
    model = { text, starts, codes, marks, perLine, tokens, comments };
    htmlCache = new Map();
    // 横スクロールの幅（いちばん長い行）と、行番号の幅
    const units = maxLineUnits(text, starts);
    backdrop.style.minWidth = `calc(${units}ch + ${PAD_LEFT + 24 + (perLine.size ? 320 : 0)}px)`;
    gutter.style.minWidth = `calc(${String(starts.length).length}ch + 34px)`;
    paint();
    shown = new Set(vis.filter((d) => !d.stale).map((d) => d.id + "@" + d.line));
    renderPanel(vis);
  }

  function lineHtml(li) {
    const cached = htmlCache.get(li);
    if (cached) return cached;
    const { text, starts, codes, marks, perLine } = model;
    const n = starts.length;
    const ls = starts[li];
    const le = li + 1 < n ? starts[li + 1] - 1 : text.length;
    let html = "";
    let i = ls;
    while (i < le) {
      const c = codes[i];
      const m = marks[i];
      let j = i + 1;
      while (j < le && codes[j] === c && marks[j] === m) j++;
      const seg = text.slice(i, j);
      let cls = CLS[c];
      if (m) {
        cls += (cls ? " " : "") + (m & 1 ? "u-err" : "u-warn");
        if (!seg.trim()) cls += " blank";
      }
      html += cls ? `<span class="${cls}">${esc(seg)}</span>` : esc(seg);
      i = j;
    }
    let lc = "ln";
    let gc = "";
    const ds = perLine.get(li);
    if (ds) {
      const top = ds[0];
      const sev = top.sev === "error" ? "err" : "warn";
      const stale = ds.every((d) => d.stale);
      html += `<span class="lens ${sev}${stale ? " pending" : ""}">${esc(top.msg)}${ds.length > 1 ? `<span class="more">+${ds.length - 1}</span>` : ""}</span>`;
      if (!stale) {
        lc += ` l-${sev}`;
        gc = `g-${sev}`;
      }
    }
    const out = { html, lc, gc };
    htmlCache.set(li, out);
    return out;
  }

  /** 見えている範囲の行だけを DOM にする */
  function paint() {
    paintQueued = false;
    if (!model) return;
    const n = model.starts.length;
    const h = viewH;
    const top = scrollTopCache;
    const f = Math.max(0, Math.min(n - 1, Math.floor((top - PAD_TOP) / LH) - OVERSCAN));
    const l = Math.max(f, Math.min(n - 1, Math.ceil((top + h - PAD_TOP) / LH) + OVERSCAN));
    const cnt = l - f + 1;
    first = f;
    topSpacer.style.height = f * LH + "px";
    botSpacer.style.height = (n - 1 - l) * LH + "px";
    gTopSpacer.style.height = topSpacer.style.height;
    gBotSpacer.style.height = botSpacer.style.height;
    while (pool.length < cnt) {
      const ln = document.createElement("div");
      const g = document.createElement("div");
      backdrop.insertBefore(ln, botSpacer);
      gutter.insertBefore(g, gBotSpacer);
      pool.push({ ln, g, html: null, cls: "", gcls: null, num: -1 });
    }
    while (pool.length > cnt) {
      const p = pool.pop();
      p.ln.remove();
      p.g.remove();
    }
    for (let k = 0; k < cnt; k++) {
      const li = f + k;
      const p = pool[k];
      const r = lineHtml(li);
      const cur = li === caretLine;
      const lc = cur ? r.lc + " cur" : r.lc;
      const gc = cur ? (r.gc ? r.gc + " cur" : "cur") : r.gc;
      if (p.html !== r.html) {
        p.ln.innerHTML = r.html;
        p.html = r.html;
      }
      if (p.cls !== lc) {
        p.ln.className = lc;
        p.cls = lc;
      }
      if (p.gcls !== gc) {
        p.g.className = gc;
        p.gcls = gc;
      }
      if (p.num !== li) {
        p.g.textContent = String(li + 1);
        p.num = li;
      }
    }
  }
  function queuePaint() {
    if (paintQueued) return;
    paintQueued = true;
    requestAnimationFrame(paint);
  }
  // 大きさ・スクロール位置は、変わったときだけ読む（入力のたびに読むと、長いファイルで重くなる）
  let viewH = 800;
  let scrollTopCache = 0;
  scroller.addEventListener("scroll", () => {
    scrollTopCache = scroller.scrollTop;
    queuePaint();
  }, { passive: true });
  if (window.ResizeObserver) {
    new ResizeObserver(() => {
      viewH = scroller.clientHeight || viewH;
      queuePaint();
    }).observe(scroller);
  }
  window.addEventListener("resize", () => {
    viewH = scroller.clientHeight || viewH;
    queuePaint();
  });
  let ensureQueued = false;
  function queueEnsure() {
    if (ensureQueued) return;
    ensureQueued = true;
    requestAnimationFrame(() => {
      ensureQueued = false;
      ensureVisible(caretInfo());
    });
  }
  const lineEl = (li) => (li >= first && li < first + pool.length ? pool[li - first].ln : null);

  /* ------------------------------------------------------------------ */
  /* 指摘の一覧                                                          */
  /* ------------------------------------------------------------------ */
  const ICON_ERR = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  const ICON_WARN = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M6 2.2v4.8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="6" cy="9.6" r="1.15" fill="currentColor"/></svg>';
  const ICON_OK = '<svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true"><path d="M7 13.5l4 4 8-9" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  let visibleList = [];
  function renderPanel(vis) {
    const items = vis.slice().sort((a, b) => a.s - b.s);
    const errs = items.filter((d) => d.sev === "error").length;
    const warns = items.length - errs;
    const sig = items.map((d) => `${d.key}|${d.line}|${d.stale ? 1 : 0}|${d.msg}`).join("\n") + "#" + activeKey;
    setCount("count-err", errs);
    setCount("count-warn", warns);
    tabDot.className = "dot" + (errs ? " err" : warns ? " warn" : "");
    if (sig === lastPanelSig) return;
    lastPanelSig = sig;
    visibleList = items;

    if (!input.value.trim()) {
      summary.className = "summary";
      summary.textContent = "左にコードを書くと、ここにまちがいが出ます。";
    } else if (errs) {
      summary.className = "summary";
      summary.textContent = errs === 1 ? "このままではコンパイルできません。1か所を直しましょう。" : `このままではコンパイルできません。上から順に直しましょう。`;
    } else if (warns) {
      summary.className = "summary";
      summary.textContent = "コンパイルはできそうです。注意のところを確認しましょう。";
    } else {
      summary.className = "summary ok";
      summary.textContent = "まちがいは見つかりませんでした";
    }

    if (!items.length) {
      list.innerHTML = input.value.trim()
        ? `<div class="empty"><div class="big">${ICON_OK}</div><p class="t">コンパイルできそうです</p><p class="s">ただし、ここで見つけられないまちがいもあります。実行して結果を確かめましょう。</p></div>`
        : "";
      return;
    }
    const frag = document.createDocumentFragment();
    items.forEach((d, i) => {
      const sev = d.sev === "error" ? "err" : "warn";
      const item = document.createElement("div");
      item.className = `item ${sev}${d.key === activeKey ? " active" : ""}`;
      item.dataset.key = d.key;
      if (d.stale) item.style.opacity = ".55";
      const jump = document.createElement("button");
      jump.type = "button";
      jump.className = "jump";
      jump.innerHTML =
        `<span class="ico">${sev === "err" ? ICON_ERR : ICON_WARN}</span>` +
        `<span class="where"><span class="sev">${sev === "err" ? "エラー" : "注意"}</span>${d.line + 1} 行目</span>` +
        `<span class="msg">${esc(d.msg)}</span>` +
        `<span class="fix">${esc(d.fix)}</span>`;
      jump.addEventListener("click", () => goTo(d, true));
      item.appendChild(jump);
      if (d.edits && d.edits.length && !d.stale) {
        const act = document.createElement("div");
        act.className = "actions";
        const qf = document.createElement("button");
        qf.type = "button";
        qf.className = "qf";
        qf.innerHTML = `直す${quickLabel(d)}`;
        qf.addEventListener("click", () => applyFix(d));
        act.appendChild(qf);
        item.appendChild(act);
      }
      frag.appendChild(item);
      void i;
    });
    list.replaceChildren(frag);
  }

  function quickLabel(d) {
    if (d.edits.length === 2 && d.edits[0].text && d.edits[1].text && !d.edits[0].text.includes("\n")) {
      // Integer.parseInt( … ) のように前後に足すもの
      return `：<code>${esc(d.edits[0].text.trim())}…${esc(d.edits[1].text.trim())}</code>`;
    }
    if (d.edits.length !== 1) return "";
    const t = d.edits[0].text.trim();
    if (!t) return "（消す）";
    if (t.length > 34 || t.includes("\n")) return "";
    return `：<code>${esc(t)}</code>`;
  }

  function setCount(id, n) {
    const el = $(id);
    el.lastElementChild.textContent = String(n);
    el.classList.toggle("zero", n === 0);
  }

  /* ------------------------------------------------------------------ */
  /* 解析                                                                */
  /* ------------------------------------------------------------------ */
  function analyze() {
    clearTimeout(analyzeTimer);
    const text = input.value;
    const t0 = performance.now();
    let r;
    try {
      r = check(text, { fileName: fileName() });
    } catch (e) {
      r = { diags: [] };
    }
    const ms = performance.now() - t0;
    // 重いファイルほど、待ち時間を長く（打つのがじゃまされないように）
    debounceMs = Math.min(1200, Math.max(180, ms * 4));
    diags = r.diags.map((d) => Object.assign({}, d));
    statusMs.textContent = `チェック ${ms < 1 ? "<1" : Math.round(ms)}ms`;
    render();
  }

  function scheduleAnalyze() {
    clearTimeout(analyzeTimer);
    analyzeTimer = setTimeout(analyze, debounceMs);
  }

  function fileName() {
    let n = fname.value.trim() || "Main.java";
    if (!/\.java$/i.test(n)) n += ".java";
    return n;
  }

  /* ------------------------------------------------------------------ */
  /* カーソル                                                            */
  /* ------------------------------------------------------------------ */
  const measureCtx = document.createElement("canvas").getContext("2d");
  let fontReady = "";
  function textWidth(s) {
    const cs = getComputedStyle(input);
    const font = `${cs.fontSize} ${cs.fontFamily}`;
    if (font !== fontReady) {
      measureCtx.font = font;
      fontReady = font;
    }
    // タブを空白にのばす
    let out = "";
    for (const ch of s) {
      if (ch === "\t") out += " ".repeat(4 - (out.length % 4));
      else out += ch;
    }
    return measureCtx.measureText(out).width;
  }

  function caretInfo() {
    const pos = input.selectionEnd;
    const text = input.value;
    const starts = model && model.text === text ? model.starts : lineStarts(text);
    const line = lineOf(starts, pos);
    const ls = starts[line];
    return { pos, line, col: pos - ls, prefix: text.slice(ls, pos) };
  }

  function updateCaret(scroll) {
    const c = caretInfo();
    if (c.line !== caretLine) {
      caretLine = c.line;
      autoPairs.clear();
      // 打っていた行から離れたら、待たせていた指摘をすぐ出す
      if (Date.now() - lastEditAt < LINE_GRACE) render();
      else paint();
    }
    statusLine.textContent = `${c.line + 1} 行 ${c.col + 1} 列`;
    // カーソルのある行の指摘を、一覧で目立たせる
    const here = visibleList.find((d) => d.line === c.line);
    setActive(here ? here.key : null, false);
    if (scroll) queueEnsure();
  }

  function ensureVisible(c) {
    const y = PAD_TOP + c.line * LH;
    const gw = gutter.offsetWidth;
    const x = gw + PAD_LEFT + textWidth(c.prefix);
    const top = scroller.scrollTop;
    const h = scroller.clientHeight;
    if (y < top) scroller.scrollTop = Math.max(0, y - LH);
    else if (y + LH > top + h) scroller.scrollTop = y + LH * 2 - h;
    const left = scroller.scrollLeft;
    const w = scroller.clientWidth;
    if (x < left + gw + 8) scroller.scrollLeft = Math.max(0, x - gw - 40);
    else if (x > left + w - 24) scroller.scrollLeft = x - w + 64;
    viewH = h;
    if (scroller.scrollTop !== scrollTopCache) {
      scrollTopCache = scroller.scrollTop;
      paint();
    }
  }

  function setActive(key, scrollList) {
    if (key === activeKey) return;
    activeKey = key;
    for (const el of list.querySelectorAll(".item")) {
      const on = el.dataset.key === key;
      el.classList.toggle("active", on);
      if (on && scrollList) el.scrollIntoView({ block: "nearest" });
    }
  }

  /* ------------------------------------------------------------------ */
  /* 指摘へ移動・自動で直す                                               */
  /* ------------------------------------------------------------------ */
  function goTo(d, focus) {
    if (focus) input.focus({ preventScroll: true });
    input.setSelectionRange(d.s, Math.max(d.s, d.e));
    updateCaret(false);
    const c = caretInfo();
    // 行を画面の上から 1/3 くらいに
    const y = PAD_TOP + c.line * LH;
    if (y < scroller.scrollTop + LH || y > scroller.scrollTop + scroller.clientHeight - LH * 2) {
      scroller.scrollTop = Math.max(0, y - scroller.clientHeight / 3);
    }
    ensureVisible(c);
    flashLine(c.line);
    setActive(d.key, true);
  }

  function flashLine(li) {
    paint();
    const el = lineEl(li);
    if (!el) return;
    el.classList.remove("flash");
    void el.offsetWidth;
    el.classList.add("flash");
    setTimeout(() => el.classList.remove("flash"), 1100);
  }

  function nextDiag(dir) {
    if (!visibleList.length) return;
    const pos = input.selectionStart;
    let d;
    if (dir > 0) d = visibleList.find((x) => x.s > pos) || visibleList[0];
    else d = [...visibleList].reverse().find((x) => x.s < pos) || visibleList[visibleList.length - 1];
    goTo(d, true);
  }

  /** 範囲を置きかえる（Ctrl+Z で戻せるように） */
  function replaceRange(s, e, text) {
    input.focus({ preventScroll: true });
    input.setSelectionRange(s, e);
    let ok = false;
    try {
      ok = document.execCommand("insertText", false, text);
    } catch (err) {
      ok = false;
    }
    if (!ok || input.value.slice(s, s + text.length) !== text) {
      input.setRangeText(text, s, e, "end");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  function applyFix(d) {
    const edits = d.edits.slice().sort((a, b) => a.s - b.s);
    const s = edits[0].s;
    const e = Math.max(...edits.map((x) => x.e));
    const text = input.value;
    let out = "";
    let at = s;
    for (const ed of edits) {
      out += text.slice(at, ed.s) + ed.text;
      at = ed.e;
    }
    out += text.slice(at, e);
    replaceRange(s, e, out);
    lastEditAt = 0; // すぐに結果を出す
    analyze();
    const c = caretInfo();
    flashLine(c.line);
    toast("直しました（Ctrl+Z で元に戻せます）");
  }

  /* ------------------------------------------------------------------ */
  /* キー操作                                                            */
  /* ------------------------------------------------------------------ */
  const INDENT = "    ";
  function lineRange(text, s, e) {
    const ls = text.lastIndexOf("\n", s - 1) + 1;
    let le = text.indexOf("\n", e > s && text[e - 1] === "\n" ? e - 1 : e);
    if (le < 0) le = text.length;
    return [ls, le];
  }

  /* かっこ・クォートを自動で閉じる ------------------------------------ */
  const PAIRS = { "(": ")", "[": "]", "{": "}", '"': '"', "'": "'" };
  const CLOSERS = new Set([")", "]", "}", '"', "'"]);

  /** pos が文字列・文字・コメントの中か */
  function insideStrOrComment(pos) {
    const text = input.value;
    const m = model && model.text === text ? model : colorCodes(text);
    for (const c of m.comments) {
      if (c.s >= pos) break;
      const lineComment = text.startsWith("//", c.s);
      if (pos < c.e || (pos === c.e && (lineComment || !text.startsWith("*/", c.e - 2)))) return true;
    }
    for (const t of m.tokens) {
      if (t.s >= pos) break;
      if ((t.t === "str" || t.t === "chr") && (pos < t.e || (pos === t.e && t.open))) return true;
    }
    return false;
  }

  /** ( [ { " ' を打ったとき。処理したら true */
  function handlePair(k, text, s, e) {
    const next = text[e];
    const prev = text[s - 1];
    // 自動で入れた閉じ記号の上は、打っても増やさずに通り過ぎる
    if (s === e && CLOSERS.has(k) && next === k && autoPairs.has(s)) {
      autoPairs.delete(s);
      input.setSelectionRange(s + 1, s + 1);
      updateCaret(false);
      return true;
    }
    const close = PAIRS[k];
    if (!close) return false;
    // 選んだ文字を囲む
    if (s !== e) {
      const sel = text.slice(s, e);
      if (sel.includes("\n") && k !== "{") return false;
      replaceRange(s, e, k + sel + close);
      input.setSelectionRange(s + 1, e + 1);
      updateCaret(false);
      return true;
    }
    if (insideStrOrComment(s)) return false;
    if ((k === '"' || k === "'") && prev && /[\p{L}\p{N}_$"'\\]/u.test(prev)) return false;
    if (next !== undefined && !/[\s)\]};,]/.test(next)) return false;
    replaceRange(s, e, k + close);
    input.setSelectionRange(s + 1, s + 1);
    autoPairs.add(s + 1);
    updateCaret(false);
    return true;
  }

  input.addEventListener("keydown", (ev) => {
    if (ev.isComposing || ev.keyCode === 229) return;
    const text = input.value;
    const s = input.selectionStart;
    const e = input.selectionEnd;

    if (ev.key === "F8") {
      ev.preventDefault();
      nextDiag(ev.shiftKey ? -1 : 1);
      return;
    }
    if (ev.key === "Escape") {
      input.blur();
      return;
    }
    if (ev.key === "Tab" && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
      ev.preventDefault();
      if (s !== e && text.slice(s, e).includes("\n") || ev.shiftKey) {
        const [ls, le] = lineRange(text, s, e);
        const block = text.slice(ls, le);
        const lines = block.split("\n");
        const out = ev.shiftKey
          ? lines.map((l) => l.replace(/^( {1,4}|\t)/, "")).join("\n")
          : lines.map((l) => (l.length ? INDENT + l : l)).join("\n");
        replaceRange(ls, le, out);
        input.setSelectionRange(ls, ls + out.length);
      } else {
        const col = s - (text.lastIndexOf("\n", s - 1) + 1);
        replaceRange(s, e, " ".repeat(4 - (col % 4)));
      }
      return;
    }
    if (ev.key === "Enter" && !ev.ctrlKey && !ev.metaKey && !ev.altKey && !ev.shiftKey) {
      const ls = text.lastIndexOf("\n", s - 1) + 1;
      const indent = text.slice(ls, s).match(/^[ \t]*/)[0];
      const before = text.slice(ls, s).trimEnd();
      const after = text.slice(e, text.indexOf("\n", e) < 0 ? text.length : text.indexOf("\n", e));
      ev.preventDefault();
      if (/[{(\[]$/.test(before)) {
        const closeNext = /^\s*[})\]]/.test(after);
        if (closeNext) {
          replaceRange(s, e, "\n" + indent + INDENT + "\n" + indent);
          const pos = s + 1 + indent.length + INDENT.length;
          input.setSelectionRange(pos, pos);
        } else {
          replaceRange(s, e, "\n" + indent + INDENT);
        }
      } else {
        replaceRange(s, e, "\n" + indent);
      }
      updateCaret(true);
      return;
    }
    if (autoClose && !ev.ctrlKey && !ev.metaKey && !ev.altKey && (PAIRS[ev.key] || CLOSERS.has(ev.key))) {
      if (handlePair(ev.key, text, s, e)) {
        ev.preventDefault();
        return;
      }
    }
    if (ev.key === "Backspace" && s === e && s > 0 && autoPairs.has(s) && PAIRS[text[s - 1]] === text[s]) {
      // ( | ) のように空のペアなら、両方消す
      ev.preventDefault();
      replaceRange(s - 1, s + 1, "");
      return;
    }
    if (ev.key === "}" && s === e) {
      const ls = text.lastIndexOf("\n", s - 1) + 1;
      const before = text.slice(ls, s);
      if (/^[ \t]+$/.test(before)) {
        ev.preventDefault();
        const dedented = before.replace(/( {1,4}|\t)$/, "");
        replaceRange(ls, s, dedented + "}");
        return;
      }
    }
    if ((ev.ctrlKey || ev.metaKey) && ev.key === "/") {
      ev.preventDefault();
      const [ls, le] = lineRange(text, s, e);
      const lines = text.slice(ls, le).split("\n");
      const all = lines.filter((l) => l.trim()).every((l) => /^\s*\/\//.test(l));
      const out = lines.map((l) => (all ? l.replace(/^(\s*)\/\/ ?/, "$1") : l.trim() ? l.replace(/^(\s*)/, "$1// ") : l)).join("\n");
      replaceRange(ls, le, out);
      input.setSelectionRange(ls, ls + out.length);
    }
  });

  /* ------------------------------------------------------------------ */
  /* 入力                                                                */
  /* ------------------------------------------------------------------ */
  input.addEventListener("input", () => {
    const text = input.value;
    shiftDiags(prevText, text);
    prevText = text;
    lastEditAt = Date.now();
    caretLine = caretInfo().line;
    render();
    updateCaret(true);
    scheduleAnalyze();
    scheduleSave();
  });
  input.addEventListener("keyup", (ev) => {
    if (ev.key.startsWith("Arrow") || ev.key === "Home" || ev.key === "End" || ev.key === "PageUp" || ev.key === "PageDown") updateCaret(true);
  });
  input.addEventListener("click", () => updateCaret(false));
  input.addEventListener("select", () => updateCaret(false));
  document.addEventListener("selectionchange", () => {
    if (document.activeElement === input) updateCaret(false);
  });

  gutter.addEventListener("click", (ev) => {
    const el = ev.target.closest("div");
    if (!el || el.parentElement !== gutter) return;
    const k = pool.findIndex((p) => p.g === el);
    if (k < 0) return;
    const li = first + k;
    const d = visibleList.find((x) => x.line === li);
    if (!d) return;
    goTo(d, true);
    const item = list.querySelector(`.item[data-key="${CSS.escape(d.key)}"]`);
    if (item) {
      item.classList.remove("flash");
      void item.offsetWidth;
      item.classList.add("flash");
    }
  });

  fname.addEventListener("input", () => {
    scheduleAnalyze();
    scheduleSave();
  });
  fname.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") input.focus();
  });

  /* ------------------------------------------------------------------ */
  /* ボタン                                                              */
  /* ------------------------------------------------------------------ */
  function setCode(code, msg) {
    replaceRange(0, input.value.length, code);
    input.setSelectionRange(0, 0);
    scroller.scrollTop = 0;
    scroller.scrollLeft = 0;
    lastEditAt = 0;
    analyze();
    updateCaret(false);
    if (msg) toast(msg);
  }

  const ph = document.createElement("option");
  ph.textContent = "例を開く…";
  ph.value = "";
  ph.disabled = true;
  ph.selected = true;
  samplesSel.appendChild(ph);
  SAMPLES.forEach((s, i) => {
    const o = document.createElement("option");
    o.value = String(i);
    o.textContent = s.label;
    samplesSel.appendChild(o);
  });
  samplesSel.addEventListener("change", () => {
    const s = SAMPLES[Number(samplesSel.value)];
    samplesSel.value = "";
    if (!s) return;
    fname.value = "Main.java";
    setCode(s.code, `「${s.label}」を開きました（Ctrl+Z で元に戻せます）`);
    input.blur();
  });

  $("btn-new").addEventListener("click", () => {
    fname.value = "Main.java";
    setCode(BLANK, "新しく書けます（Ctrl+Z で元に戻せます）");
    const pos = BLANK.indexOf("        \n") + 8;
    input.focus();
    input.setSelectionRange(pos, pos);
    updateCaret(true);
  });

  $("btn-copy").addEventListener("click", () => {
    const text = input.value;
    const done = () => toast("コードをコピーしました");
    try {
      navigator.clipboard.writeText(text).then(done, fallback);
    } catch (e) {
      fallback();
    }
    function fallback() {
      input.focus();
      input.select();
      try {
        document.execCommand("copy");
        done();
      } catch (e) {
        toast("コピーできませんでした。Ctrl+C でコピーしてください");
      }
    }
  });

  let toastTimer = 0;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toastEl.hidden = true), 2600);
  }

  /* かっこを自動で閉じる：オン / オフ（このブラウザに覚える） */
  const acBtn = $("autoclose");
  const PREF_KEY = "java-sonoba-check:autoclose";
  function setAutoClose(on, save) {
    autoClose = on;
    autoPairs.clear();
    acBtn.setAttribute("aria-pressed", on ? "true" : "false");
    acBtn.querySelector(".state").textContent = on ? "オン" : "オフ";
    if (save) {
      try {
        localStorage.setItem(PREF_KEY, on ? "1" : "0");
      } catch (e) {
        /* 保存できない環境では何もしない */
      }
    }
  }
  try {
    setAutoClose(localStorage.getItem(PREF_KEY) !== "0", false);
  } catch (e) {
    setAutoClose(true, false);
  }
  acBtn.addEventListener("click", () => {
    setAutoClose(!autoClose, true);
    toast(autoClose ? "かっこと \" を自動で閉じます" : "かっこと \" を自動で閉じません");
  });

  /* ------------------------------------------------------------------ */
  /* 保存（このブラウザの中だけ）                                         */
  /* ------------------------------------------------------------------ */
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify({ code: input.value, fname: fname.value }));
      } catch (e) {
        /* 保存できない環境では何もしない */
      }
    }, 400);
  }
  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return null;
      const v = JSON.parse(raw);
      return typeof v.code === "string" ? v : null;
    } catch (e) {
      return null;
    }
  }

  /* ------------------------------------------------------------------ */
  /* はじめ                                                              */
  /* ------------------------------------------------------------------ */
  function readMetrics() {
    const v = parseFloat(getComputedStyle(input).lineHeight);
    if (v > 0) LH = v;
  }
  readMetrics();
  window.addEventListener("resize", readMetrics);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => (fontReady = ""));

  const saved = load();
  if (saved && saved.code.trim()) {
    input.value = saved.code;
    if (saved.fname) fname.value = saved.fname;
  } else {
    input.value = SAMPLES[0].code;
  }
  prevText = input.value;
  analyze();
  updateCaret(false);
})();
