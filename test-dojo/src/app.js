// テスト書き方道場: 画面の動き
(function () {
  "use strict";
  const { EXERCISES, mutantCode, mutantDiff } = window.DojoExercises;
  const Runner = window.DojoRunner;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const TIMEOUT_MS = 3000;

  // ---------- 保存（使えないブラウザでも動くように） ----------
  const store = {
    get(k) { try { return localStorage.getItem("dojo:" + k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem("dojo:" + k, v); } catch (e) { /* 保存できなくても続ける */ } },
    del(k) { try { localStorage.removeItem("dojo:" + k); } catch (e) { /* noop */ } },
  };

  // 仕様の中の `code` と **太字** だけを整形する
  const inline = (s) => esc(s).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");

  // ---------- シンタックスハイライト ----------
  const TOKEN = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?|`(?:\\.|[^`\\])*`?)|\b(\d+(?:\.\d+)?)\b|\b(const|let|var|new|return|function|class|if|else|throw|true|false|null|undefined|of|for|while|typeof)\b|\b(test|it|describe|expect)\b|(\.(?:not|to[A-Z]\w*)\b)/g;
  function highlight(src) {
    let out = "", last = 0;
    src.replace(TOKEN, (m, com, str, num, kw, api, match, at) => {
      out += esc(src.slice(last, at));
      const cls = com ? "com" : str ? "str" : num ? "num" : kw ? "kw" : api ? "api" : "match";
      out += `<span class="tk-${cls}">${esc(m)}</span>`;
      last = at + m.length;
      return m;
    });
    return out + esc(src.slice(last)) + "\n";
  }

  const ed = $("editor"), hl = $("hl"), gutter = $("gutter");
  function paint() {
    hl.innerHTML = highlight(ed.value);
    const n = ed.value.split("\n").length;
    let g = "";
    for (let i = 1; i <= n; i++) g += i + "\n";
    gutter.textContent = g;
    syncScroll();
  }
  function syncScroll() {
    hl.scrollTop = ed.scrollTop; hl.scrollLeft = ed.scrollLeft;
    gutter.scrollTop = ed.scrollTop;
  }
  ed.addEventListener("scroll", syncScroll);
  ed.addEventListener("input", () => {
    paint();
    store.set("draft:" + cur().id, ed.value);
    markStale(true);
  });
  ed.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); grade(); return; }
    if (e.key === "Tab" && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      insert("  ");
    } else if (e.key === "Enter" && !e.isComposing) {
      // 前の行と同じだけ字下げ。{ の後ならもう一段
      const s = ed.selectionStart, line = ed.value.slice(0, s).split("\n").pop();
      let ind = (line.match(/^\s*/) || [""])[0];
      if (/[{([]\s*$/.test(line)) ind += "  ";
      e.preventDefault();
      insert("\n" + ind);
    }
  });
  function insert(text) {
    const s = ed.selectionStart, en = ed.selectionEnd;
    // execCommand なら「元に戻す」が効く。使えなければ直接書きかえる
    if (!document.execCommand || !document.execCommand("insertText", false, text)) {
      ed.setRangeText(text, s, en, "end");
      ed.dispatchEvent(new Event("input"));
    }
  }

  // ---------- 問題の切りかえ ----------
  let index = 0;
  const cur = () => EXERCISES[index];

  function renderStrip() {
    $("strip").innerHTML = EXERCISES.map((ex, i) => {
      const best = store.get("best:" + ex.id);
      const b = best === null ? "未挑戦" : best + "点";
      return `<li><button type="button" data-i="${i}" aria-current="${i === index}"><span class="no">${i + 1}</span><span class="t">${esc(ex.title)}</span><span class="best${best === "100" ? " full" : ""}">${b}</span></button></li>`;
    }).join("");
  }
  $("strip").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-i]");
    if (b) select(+b.dataset.i);
  });

  function select(i) {
    index = i;
    const ex = cur();
    store.set("current", ex.id);
    if (location.hash.slice(1) !== ex.id) history.replaceState(null, "", "#" + ex.id);
    renderStrip();
    $("q-no").textContent = `問題 ${i + 1} / ${EXERCISES.length}`;
    $("q-name").textContent = ex.title;
    $("q-level").innerHTML = "むずかしさ " + [1, 2, 3, 4].map((n) => `<i class="${n <= ex.level ? "on" : ""}"></i>`).join("");
    $("q-spec").innerHTML = ex.spec.map((s) => `<li>${inline(s)}</li>`).join("");
    $("q-sig").textContent = ex.signature;
    $("q-lesson").innerHTML = "<b>ポイント</b>　" + inline(ex.lesson);
    $("q-code").innerHTML = highlight(ex.code);
    $("solution").innerHTML = highlight(ex.solution);
    $("solution-box").open = false;
    $("ed-file").textContent = ex.id + ".test.js";
    ed.value = store.get("draft:" + ex.id) ?? ex.starter;
    ed.scrollTop = 0;
    paint();
    grade();
  }
  window.addEventListener("hashchange", () => {
    const i = EXERCISES.findIndex((e) => e.id === location.hash.slice(1));
    if (i >= 0 && i !== index) select(i);
  });

  // 2回押して確定するボタン（confirm() はこの画面では使えないため）
  function twoStep(btn, label, confirmLabel, action) {
    let timer = null;
    btn.addEventListener("click", () => {
      if (btn.classList.contains("confirm")) {
        clearTimeout(timer);
        btn.classList.remove("confirm");
        btn.textContent = label;
        action();
        return;
      }
      btn.classList.add("confirm");
      btn.textContent = confirmLabel;
      timer = setTimeout(() => { btn.classList.remove("confirm"); btn.textContent = label; }, 3000);
    });
  }
  twoStep($("reset"), "最初に戻す", "もう一度押すと消えます", () => {
    ed.value = cur().starter;
    store.del("draft:" + cur().id);
    paint();
    grade();
  });
  twoStep($("use-solution"), "エディタに入れる", "今のテストを上書きします。もう一度押す", () => {
    ed.value = cur().solution;
    store.set("draft:" + cur().id, ed.value);
    paint();
    grade();
    ed.focus();
  });
  $("run").addEventListener("click", () => grade());

  // ---------- 実行（Web Worker。固まったら打ち切る） ----------
  let workerUrl = null;
  function makeWorker() {
    if (!workerUrl) {
      const src = "var C = (" + Runner.core.toString() + ")();\n" +
        "self.onmessage = function (e) { var r; try { r = C.evaluate(e.data); } catch (err) { r = { error: { phase: 'tests', message: String(err && err.message || err) } }; } self.postMessage(r); };";
      workerUrl = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
    }
    return new Worker(workerUrl);
  }
  let running = null;
  function evaluateAsync(job) {
    return new Promise((resolve) => {
      let w;
      try { w = makeWorker(); } catch (e) {
        // Worker が使えない環境では、そのまま実行する（無限ループの保護はなし）
        resolve(Runner.evaluate(job));
        return;
      }
      if (running) running.cancel();
      let done = false;
      const finish = (r) => { if (done) return; done = true; clearTimeout(t); w.terminate(); running = null; resolve(r); };
      const t = setTimeout(() => finish({ error: { phase: "tests", message: `時間切れ: ${TIMEOUT_MS / 1000} 秒たっても終わりませんでした。\nテストの中で無限ループになっていませんか？（while や for の終わりの条件を確かめてください）` } }), TIMEOUT_MS);
      w.onmessage = (e) => finish(e.data);
      w.onerror = (e) => { e.preventDefault(); finish({ error: { phase: "tests", message: "実行中にエラーが起きました: " + (e.message || "不明なエラー") } }); };
      running = { cancel: () => { done = true; clearTimeout(t); w.terminate(); } };
      w.postMessage(job);
    });
  }

  let gradeSeq = 0;
  async function grade() {
    const ex = cur(), tests = ed.value, seq = ++gradeSeq;
    $("ed-state").textContent = "採点中…";
    const ev = await evaluateAsync({ code: ex.code, names: ex.names, tests, mutants: ex.mutants.map((_, i) => mutantCode(ex, i)) });
    if (seq !== gradeSeq || ex !== cur()) return; // 古い結果は捨てる
    const sc = Runner.score(ex, ev);
    const prev = +(store.get("best:" + ex.id) ?? -1);
    if (sc.total > prev) { store.set("best:" + ex.id, String(sc.total)); renderStrip(); }
    renderResult(ex, ev, sc);
    markStale(false);
    $("ed-state").textContent = "採点済み";
  }
  function markStale(on) {
    $("results").classList.toggle("stale", on);
    if (on) $("ed-state").textContent = "変更あり（未採点）";
  }

  // ---------- 結果の表示 ----------
  function renderResult(ex, ev, sc) {
    const rk = Runner.rank(sc.total);
    const full = sc.total >= 100;
    // 赤ペンの丸（満点は二重丸＋花びら）
    let svg = `<svg viewBox="0 0 150 130" aria-hidden="true"><path class="ring" d="M20 70 C 16 30, 60 10, 92 16 C 130 24, 142 62, 126 92 C 110 120, 54 124, 30 104 C 18 94, 14 80, 22 62" fill="none" style="stroke:var(--pen)" stroke-width="4" stroke-linecap="round"/>`;
    if (full) {
      svg += `<path class="ring" d="M34 70 C 32 42, 64 28, 88 32 C 116 38, 124 66, 112 88 C 100 108, 60 110, 44 96" fill="none" style="stroke:var(--pen)" stroke-width="3" stroke-linecap="round"/>`;
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2, x = 75 + Math.cos(a) * 70, y = 66 + Math.sin(a) * 60;
        svg += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="9" fill="none" style="stroke:var(--pen)" stroke-width="2.5"/>`;
      }
    }
    svg += `</svg>`;
    $("mark").innerHTML = svg + `<div class="pts"><div><b>${sc.total}</b><small>${esc(rk.mark)}</small></div></div>`;
    $("mark").setAttribute("aria-label", `${sc.total} 点（${rk.mark}）`);
    $("mark").setAttribute("role", "img");
    $("rank-label").textContent = rk.label;

    const row = (label, v, max, sub, neg) => `<div class="bd-row"><dt>${label}</dt><dd class="meter"><i style="width:${max ? Math.round((v / max) * 100) : 0}%;${neg ? "background:var(--pen)" : ""}"></i></dd><dd class="v">${neg ? "−" + v : v + " / " + max}</dd>${sub ? `<dd class="bd-sub">${sub}</dd>` : ""}</div>`;
    const p = sc.parts || { names: 0, asserts: 0, focus: 0 };
    $("breakdown").innerHTML =
      row("バグ発見", sc.detect, 80, `${sc.mutants} 個中 ${sc.killed} 個を発見`) +
      row("読みやすさ", sc.quality, 20, `名前 ${p.names}/8 ・ expect あり ${p.asserts}/6 ・ 1テスト1観点 ${p.focus}/6`) +
      (sc.penalty ? row("減点", sc.penalty, 30, "正しいコードで失敗するテスト", true) : "");
    $("notes").replaceChildren(...sc.notes.map((n) => { const li = document.createElement("li"); li.textContent = n; return li; }));

    const err = $("run-error");
    err.hidden = !ev.error;
    if (ev.error) err.textContent = ev.error.message;

    // バグ入り版
    const muts = ev.mutants || ex.mutants.map(() => ({ killed: false }));
    $("mut-summary").textContent = ev.error ? "テストを直すと表示されます" : `${muts.filter((m) => m.killed).length} / ${muts.length} 個を発見`;
    $("mutants").innerHTML = ex.mutants.map((m, i) => {
      const r = muts[i];
      const d = mutantDiff(ex, i);
      const diff = d.before.map((l, k) => `<div class="del"><span class="ln">${String(d.line + k).padStart(2)} −</span> ${esc(l)}</div>`).join("") +
        d.after.map((l, k) => `<div class="add"><span class="ln">${String(d.line + k).padStart(2)} +</span> ${esc(l)}</div>`).join("") ||
        `<div class="del"><span class="ln">${String(d.line).padStart(2)} −</span> （1行消えた）</div>`;
      const body = r.killed
        ? `<span class="kind">${esc(m.kind)}</span>${r.by ? `「${esc(r.by)}」で発見` : "発見"}`
        : `<span class="kind">${esc(m.kind)}</span>${esc(m.hint)}`;
      return `<li class="mut"><span class="status ${r.killed ? "killed" : "missed"}">${r.killed ? "✓ 発見" : "! 見逃し"}</span><div class="body">${body}</div>
        <details><summary>${r.killed ? "どんなバグだった？" : "答えを見る（どこを書きかえたか）"}</summary><div class="diff">${diff}</div></details></li>`;
    }).join("");

    // 正しいコードでの結果
    const tests = ev.correct || [];
    $("test-summary").textContent = ev.error ? "" : `${tests.length} 個中 ${tests.filter((t) => t.pass).length} 個が成功`;
    $("tests").innerHTML = tests.length ? tests.map((t) => `<li class="t-item ${t.pass ? "ok" : "ng"}"><span class="ic">${t.pass ? "✓" : "✗"}</span><span>${esc(t.name)}<span class="meta">expect ${t.expects} 個</span></span>${t.pass ? "" : `<pre>${esc(t.message)}</pre>`}</li>`).join("")
      : `<li class="how">${ev.error ? "上のエラーを直すと、ここにテストごとの結果が出ます。" : "test(\"名前\", () => { expect(...).toBe(...); }); の形でテストを書きましょう。"}</li>`;
  }

  // ---------- 起動 ----------
  const fromHash = EXERCISES.findIndex((e) => e.id === location.hash.slice(1));
  const saved = EXERCISES.findIndex((e) => e.id === store.get("current"));
  select(fromHash >= 0 ? fromHash : saved >= 0 ? saved : 0);
})();
