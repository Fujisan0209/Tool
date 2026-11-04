/* 画面の動き。common.js / code.js / spec.js / compare.js / samples.js を先に読みこんでください。 */
(function () {
  "use strict";
  const { parseSpec } = window.SpecCheckSpec;
  const { parseCode, langOf, detectLang } = window.SpecCheckCode;
  const { compare, toMarkdown, KIND_LABEL } = window.SpecCheckCompare;
  const { SAMPLES } = window.SpecCheckSamples;

  const CODE_EXT = /\.(?:java|ts|tsx|mts|cts|js|jsx|mjs|cjs|py|pyi)$/i;
  const SPEC_EXT = /\.(?:md|markdown|txt|adoc|asciidoc|rst|text)$/i;
  const SKIP_DIR = /(?:^|\/)(?:node_modules|\.git|\.svn|dist|build|target|out|\.next|\.nuxt|\.output|venv|\.venv|env|__pycache__|\.mypy_cache|\.pytest_cache|vendor|coverage|\.idea|\.vscode|\.gradle|\.mvn|bin|obj|site-packages)(?:\/|$)/;
  const SKIP_FILE = /\.(?:min|bundle)\.js$|\.d\.ts$/i;
  const MAX_FILES = 3000;
  const MAX_SIZE = 1024 * 1024;
  const LANG_LABEL = { java: "Java", ts: "TypeScript", js: "JavaScript", python: "Python" };
  const STAMP = { mismatch: "違", missing: "無", naming: "揺", extra: "外" };
  const CAT_LABEL = { mismatch: "食い違い", missing: "見つからない", naming: "名前の揺れ", extra: "仕様にない" };
  const SEV_LABEL = { error: "要修正", warn: "要確認", info: "参考" };

  const $ = (id) => document.getElementById(id);
  const specInput = $("spec-input");
  const codeInput = $("code-input");
  const gutter = $("gutter");

  const state = {
    spec: { name: "", text: "", sample: false },
    files: [],
    active: null,
    codeSample: false,
    sampleId: null,
    report: null,
    filters: new Set(["mismatch", "missing", "naming", "extra"]),
    view: "findings",
  };
  let seq = 0;
  let specCache = { text: null, model: null };

  // ---------------------------------------------------------------- 小道具

  /** `code` を <code> にして、文字列を安全に入れる */
  function rich(el, text) {
    String(text).split(/`([^`]+)`/).forEach((p, i) => {
      if (i % 2) {
        const c = document.createElement("code");
        c.textContent = p;
        el.appendChild(c);
      } else if (p) el.appendChild(document.createTextNode(p));
    });
    return el;
  }
  function h(tag, cls, text) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined && text !== null) rich(el, text);
    return el;
  }
  function plain(tag, cls, text) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    el.textContent = text;
    return el;
  }
  const baseName = (p) => String(p).split("/").pop();

  function newFile(name, text) {
    return { id: "file" + ++seq, name, text: text || "", model: null };
  }
  function activeFile() {
    return state.files.find((f) => f.id === state.active) || null;
  }
  function pastedName() {
    let n = 1;
    while (state.files.some((f) => f.name === "貼りつけ " + n)) n++;
    return "貼りつけ " + n;
  }

  // ---------------------------------------------------------------- 仕様書の欄

  function renderSpecMeta() {
    $("spec-name").textContent = state.spec.name || "";
    $("spec-sample").hidden = !state.spec.sample;
    const lines = state.spec.text ? state.spec.text.split("\n").length : 0;
    $("spec-count").textContent = lines ? `${lines} 行` : "";
  }
  function updateSpecPos() {
    const pos = specInput.selectionStart || 0;
    const line = specInput.value.slice(0, pos).split("\n").length;
    $("spec-pos").textContent = `${line} 行目`;
  }
  specInput.addEventListener("input", () => {
    state.spec.text = specInput.value;
    if (state.spec.sample) { state.spec.sample = false; state.sampleId = null; renderSamples(); }
    renderSpecMeta();
    schedule();
  });
  ["keyup", "click", "select"].forEach((ev) => specInput.addEventListener(ev, updateSpecPos));

  // ---------------------------------------------------------------- コードの欄

  function renderTabs() {
    const box = $("tabs-box");
    box.replaceChildren();
    if (state.files.length > 40) {
      const sel = document.createElement("select");
      sel.className = "file-select";
      sel.id = "file-select";
      sel.setAttribute("aria-label", "表示するファイル");
      const sorted = state.files.slice().sort((a, b) => a.name.localeCompare(b.name));
      for (const f of sorted) {
        const o = document.createElement("option");
        o.value = f.id;
        o.textContent = f.name;
        if (f.id === state.active) o.selected = true;
        sel.appendChild(o);
      }
      sel.addEventListener("change", () => selectFile(sel.value));
      box.appendChild(sel);
      return;
    }
    const tabs = document.createElement("div");
    tabs.className = "tabs";
    tabs.setAttribute("role", "tablist");
    tabs.setAttribute("aria-label", "ファイル");
    for (const f of state.files) {
      const t = document.createElement("div");
      t.className = "tab";
      t.setAttribute("role", "tab");
      t.setAttribute("aria-selected", f.id === state.active ? "true" : "false");
      t.tabIndex = f.id === state.active ? 0 : -1;
      t.title = f.name;
      t.appendChild(plain("span", "tab-name", baseName(f.name)));
      const x = plain("span", "x", "×");
      x.setAttribute("role", "button");
      x.setAttribute("aria-label", `${f.name} を閉じる`);
      x.addEventListener("click", (e) => { e.stopPropagation(); removeFile(f.id); });
      t.appendChild(x);
      t.addEventListener("click", () => selectFile(f.id));
      t.addEventListener("keydown", (e) => {
        const i = state.files.indexOf(f);
        if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
          const n = state.files[(i + (e.key === "ArrowRight" ? 1 : state.files.length - 1)) % state.files.length];
          selectFile(n.id);
          const el = box.querySelector('[aria-selected="true"]');
          if (el) el.focus();
        } else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectFile(f.id); }
        else if (e.key === "Delete") removeFile(f.id);
      });
      tabs.appendChild(t);
    }
    const add = document.createElement("button");
    add.type = "button";
    add.className = "tab tab-add";
    add.textContent = "+";
    add.setAttribute("aria-label", "貼りつけ用のファイルを足す");
    add.title = "貼りつけ用のファイルを足す";
    add.addEventListener("click", () => {
      if (state.codeSample) clearCode();
      const f = newFile(pastedName(), "");
      state.files.push(f);
      selectFile(f.id);
      codeInput.focus();
    });
    tabs.appendChild(add);
    box.appendChild(tabs);
  }

  function selectFile(id) {
    state.active = id;
    renderTabs();
    loadEditor();
  }
  function removeFile(id) {
    const i = state.files.findIndex((f) => f.id === id);
    if (i < 0) return;
    state.files.splice(i, 1);
    if (!state.files.length) state.files.push(newFile(pastedName(), ""));
    if (state.active === id) state.active = state.files[Math.min(i, state.files.length - 1)].id;
    renderTabs();
    loadEditor();
    schedule();
  }
  function clearCode() {
    state.files = [];
    state.codeSample = false;
    state.sampleId = null;
    renderSamples();
  }

  let gutterLines = 0;
  function updateGutter() {
    const n = codeInput.value.split("\n").length;
    if (n !== gutterLines) {
      gutterLines = n;
      let s = "";
      for (let i = 1; i <= n; i++) s += i + "\n";
      gutter.textContent = s;
    }
    gutter.scrollTop = codeInput.scrollTop;
  }
  function loadEditor() {
    const f = activeFile();
    codeInput.value = f ? f.text : "";
    codeInput.scrollTop = 0;
    codeInput.scrollLeft = 0;
    updateGutter();
    renderCodeMeta();
  }
  function renderCodeMeta() {
    const f = activeFile();
    const lang = f ? langOf(f.name, f.text) || detectLang(f.text) : null;
    const lines = state.files.reduce((a, x) => a + (x.text ? x.text.split("\n").length : 0), 0);
    const nonEmpty = state.files.filter((x) => x.text.trim()).length;
    $("code-pos").textContent = f ? `${baseName(f.name)}${lang ? " · " + LANG_LABEL[lang] : ""}` : "";
    $("code-count").textContent = nonEmpty ? `${nonEmpty} ファイル · ${lines.toLocaleString()} 行` : "";
    $("code-sample").hidden = !state.codeSample;
  }
  codeInput.addEventListener("input", () => {
    let f = activeFile();
    if (state.codeSample) {
      // 例を書きかえたら、もう例ではない
      state.codeSample = false;
      state.sampleId = null;
      renderSamples();
    }
    if (!f) {
      f = newFile(pastedName(), "");
      state.files.push(f);
      state.active = f.id;
      renderTabs();
    }
    f.text = codeInput.value;
    f.model = null;
    updateGutter();
    renderCodeMeta();
    schedule();
  });
  codeInput.addEventListener("scroll", () => { gutter.scrollTop = codeInput.scrollTop; });
  codeInput.addEventListener("keydown", (e) => {
    if (e.key === "Tab" && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && codeInput.selectionStart === codeInput.selectionEnd) {
      e.preventDefault();
      if (document.execCommand) document.execCommand("insertText", false, "    ");
    }
  });

  // ---------------------------------------------------------------- ファイルの読み込み

  async function addCodeFiles(list) {
    const ok = [];
    let skipped = 0;
    for (const it of list) {
      const path = (it.path || it.file.webkitRelativePath || it.file.name).replace(/^\/+/, "");
      if (!CODE_EXT.test(path) || SKIP_DIR.test(path) || SKIP_FILE.test(path) || it.file.size > MAX_SIZE) { skipped++; continue; }
      if (ok.length >= MAX_FILES) { skipped++; continue; }
      ok.push({ path, file: it.file });
    }
    if (!ok.length) {
      toast(skipped ? "読めるコード（.java .ts .js .py など）が見つかりませんでした" : "", true);
      return;
    }
    $("code-count").textContent = "読み込み中…";
    const texts = await Promise.all(ok.map((x) => x.file.text().catch(() => null)));
    if (state.codeSample) clearCode();
    // 中身が空の「貼りつけ」ファイルは片づける
    state.files = state.files.filter((f) => f.text.trim() || !/^貼りつけ \d+$/.test(f.name));
    let first = null;
    ok.forEach((x, i) => {
      if (texts[i] === null) return;
      const ex = state.files.find((f) => f.name === x.path);
      if (ex) { ex.text = texts[i]; ex.model = null; first = first || ex; }
      else {
        const f = newFile(x.path, texts[i]);
        state.files.push(f);
        first = first || f;
      }
    });
    if (first) state.active = first.id;
    renderTabs();
    loadEditor();
    flash($("code-pane"));
    toast(`${ok.length} ファイルを読み込みました` + (skipped ? `（対象外 ${skipped} 件）` : ""));
    schedule(0);
  }

  async function loadSpecFile(file) {
    const text = await file.text();
    state.spec = { name: file.name, text, sample: false };
    state.sampleId = null;
    specInput.value = text;
    renderSpecMeta();
    renderSamples();
    flash($("spec-pane"));
    schedule(0);
  }

  $("spec-open").addEventListener("click", () => $("spec-file").click());
  $("spec-file").addEventListener("change", (e) => {
    const f = e.target.files[0];
    if (f) loadSpecFile(f);
    e.target.value = "";
  });
  $("spec-clear").addEventListener("click", () => {
    state.spec = { name: "", text: "", sample: false };
    state.sampleId = null;
    specInput.value = "";
    renderSpecMeta();
    renderSamples();
    specInput.focus();
    schedule(0);
  });
  $("code-open").addEventListener("click", () => $("code-file").click());
  $("dir-open").addEventListener("click", () => $("dir-file").click());
  for (const id of ["code-file", "dir-file"]) {
    $(id).addEventListener("change", (e) => {
      const files = [...e.target.files].map((file) => ({ file, path: file.webkitRelativePath || file.name }));
      if (files.length) addCodeFiles(files);
      e.target.value = "";
    });
  }
  $("code-clear").addEventListener("click", () => {
    clearCode();
    const f = newFile(pastedName(), "");
    state.files.push(f);
    state.active = f.id;
    renderTabs();
    loadEditor();
    codeInput.focus();
    schedule(0);
  });
  $("reset-all").addEventListener("click", () => {
    $("spec-clear").click();
    $("code-clear").click();
  });

  // ドラッグ＆ドロップ（フォルダごと落とせる）
  let dragDepth = 0;
  function paneAt(target) {
    return target && target.closest ? target.closest(".pane") : null;
  }
  function setDrop(pane) {
    for (const p of document.querySelectorAll(".pane")) {
      p.classList.toggle("drop", p === pane);
      const hint = p.querySelector(".drop-hint");
      if (p === pane && !hint) {
        const d = plain("div", "drop-hint", p.id === "spec-pane" ? "ここに落とすと仕様書として読みます" : "ここに落とすとコードとして読みます（フォルダもOK）");
        p.appendChild(d);
      } else if (p !== pane && hint) hint.remove();
    }
  }
  document.addEventListener("dragenter", (e) => {
    if (!e.dataTransfer || ![...e.dataTransfer.types].includes("Files")) return;
    dragDepth++;
    e.preventDefault();
    setDrop(paneAt(e.target));
  });
  document.addEventListener("dragover", (e) => {
    if (!e.dataTransfer || ![...e.dataTransfer.types].includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setDrop(paneAt(e.target));
  });
  document.addEventListener("dragleave", () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) setDrop(null);
  });
  document.addEventListener("drop", async (e) => {
    if (!e.dataTransfer || ![...e.dataTransfer.types].includes("Files")) return;
    e.preventDefault();
    dragDepth = 0;
    const pane = paneAt(e.target);
    setDrop(null);
    const items = [...(e.dataTransfer.items || [])];
    const entries = items.map((i) => (i.webkitGetAsEntry ? i.webkitGetAsEntry() : null)).filter(Boolean);
    const plainFiles = [...e.dataTransfer.files];
    const files = entries.length ? await walkEntries(entries) : plainFiles.map((file) => ({ file, path: file.name }));
    const specs = files.filter((x) => SPEC_EXT.test(x.path));
    const codes = files.filter((x) => CODE_EXT.test(x.path));
    if (pane && pane.id === "spec-pane") {
      const f = specs[0] || files[0];
      if (f) loadSpecFile(f.file);
      return;
    }
    if (pane && pane.id === "code-pane") { addCodeFiles(files); return; }
    if (specs.length === 1 && !codes.length) loadSpecFile(specs[0].file);
    else if (codes.length) addCodeFiles(files);
    else if (specs.length) loadSpecFile(specs[0].file);
  });

  async function walkEntries(entries) {
    const out = [];
    async function walk(entry, path) {
      if (out.length >= MAX_FILES * 2) return;
      if (entry.isFile) {
        if (!CODE_EXT.test(entry.name) && !SPEC_EXT.test(entry.name)) return;
        try {
          const file = await new Promise((res, rej) => entry.file(res, rej));
          out.push({ file, path: path + entry.name });
        } catch (err) { /* 読めないファイルは飛ばす */ }
      } else if (entry.isDirectory) {
        if (SKIP_DIR.test(entry.name)) return;
        const reader = entry.createReader();
        let batch;
        do {
          batch = await new Promise((res) => reader.readEntries(res, () => res([])));
          for (const e of batch) await walk(e, path + entry.name + "/");
        } while (batch.length);
      }
    }
    for (const e of entries) await walk(e, "");
    return out;
  }

  // ---------------------------------------------------------------- 例

  function renderSamples() {
    const box = $("samples");
    box.replaceChildren();
    for (const s of SAMPLES) {
      const b = plain("button", "chipbtn", s.label);
      b.type = "button";
      b.setAttribute("aria-pressed", state.sampleId === s.id && state.spec.sample && state.codeSample ? "true" : "false");
      b.addEventListener("click", () => loadSample(s.id));
      box.appendChild(b);
    }
  }
  function loadSample(id) {
    const s = SAMPLES.find((x) => x.id === id) || SAMPLES[0];
    state.sampleId = s.id;
    state.spec = { name: s.specName, text: s.spec, sample: true };
    specInput.value = s.spec;
    state.files = s.files.map((f) => newFile(f.name, f.text));
    state.active = state.files[0].id;
    state.codeSample = true;
    renderSpecMeta();
    renderSamples();
    renderTabs();
    loadEditor();
    schedule(0);
  }

  // ---------------------------------------------------------------- 照合

  let timer = 0;
  function schedule(delay) {
    clearTimeout(timer);
    $("result-sec").setAttribute("aria-busy", "true");
    timer = setTimeout(run, delay === undefined ? 250 : delay);
  }

  function run() {
    $("result-sec").setAttribute("aria-busy", "false");
    const specText = state.spec.text;
    if (specCache.text !== specText) specCache = { text: specText, model: parseSpec(specText) };
    const models = [];
    for (const f of state.files) {
      if (!f.text.trim()) continue;
      if (!f.model) f.model = parseCode(f.text, f.name);
      models.push(f.model);
    }
    state.report = specText.trim() && models.length ? compare(specCache.model, models) : null;
    state.reportCtx = { specEmpty: !specText.trim(), codeEmpty: !models.length, spec: specCache.model, models };
    renderResults();
  }

  // ---------------------------------------------------------------- 結果

  function renderResults() {
    const rep = state.report;
    const list = $("list");
    const score = $("score");
    const bar = $("bar");
    const filters = $("filters");
    list.replaceChildren();
    score.replaceChildren();
    bar.replaceChildren();
    filters.replaceChildren();
    $("copy-fallback").replaceChildren();
    $("copy-md").disabled = !rep;

    if (!rep) {
      const ctx = state.reportCtx || {};
      const e = h("div", "empty");
      e.appendChild(plain("strong", "", ctx.specEmpty && ctx.codeEmpty ? "仕様書とコードを入れてください" : ctx.specEmpty ? "仕様書を入れてください" : "コードを入れてください"));
      e.appendChild(h("span", "", "上の2つの欄に貼りつけるか、ファイルをドロップすると、すぐに照合します。どう使うか見たいときは「例で試す」を押してください。"));
      list.appendChild(e);
      score.appendChild(plain("span", "score-text", "まだ照合していません"));
      return;
    }
    const s = rep.stats;
    // 点数
    const num = plain("span", "score-num", String(s.ok));
    num.appendChild(plain("small", "", ` / ${s.checked}`));
    score.appendChild(num);
    score.appendChild(plain("span", "score-text", s.checked ? `仕様の ${s.checked} 項目のうち ${s.ok} 項目がコードと一致` : "仕様書から照合できる項目が見つかりませんでした"));
    const counts = { ok: 0, warn: 0, error: 0, skipped: 0 };
    for (const c of rep.checks) counts[c.status === "info" ? "ok" : c.status] = (counts[c.status === "info" ? "ok" : c.status] || 0) + 1;
    const total = rep.checks.length || 1;
    for (const [k, cls] of [["ok", "b-ok"], ["warn", "b-warn"], ["error", "b-err"], ["skipped", "b-skip"]]) {
      if (!counts[k]) continue;
      const sp = document.createElement("span");
      sp.className = cls;
      sp.style.width = (counts[k] / total) * 100 + "%";
      bar.appendChild(sp);
    }
    // 絞りこみ
    const byCat = { mismatch: 0, missing: 0, naming: 0, extra: 0 };
    for (const f of rep.findings) byCat[f.cat]++;
    for (const cat of ["mismatch", "missing", "naming", "extra"]) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "filter";
      b.setAttribute("aria-pressed", state.filters.has(cat) ? "true" : "false");
      const mini = plain("span", `mini c-${cat}`, STAMP[cat]);
      mini.setAttribute("aria-hidden", "true");
      b.appendChild(mini);
      b.appendChild(plain("span", "", CAT_LABEL[cat]));
      b.appendChild(plain("span", "n", String(byCat[cat])));
      b.disabled = !byCat[cat];
      b.addEventListener("click", () => {
        if (state.filters.has(cat)) state.filters.delete(cat);
        else state.filters.add(cat);
        renderResults();
      });
      filters.appendChild(b);
    }
    filters.hidden = state.view !== "findings";
    $("view-findings").setAttribute("aria-pressed", state.view === "findings" ? "true" : "false");
    $("view-checks").setAttribute("aria-pressed", state.view === "checks" ? "true" : "false");

    if (state.view === "checks") { renderChecks(rep, list); return; }

    if (!s.checked && !rep.findings.length) {
      const e = h("div", "empty");
      e.appendChild(plain("strong", "", "仕様書から、照合できる項目が見つかりませんでした"));
      e.appendChild(h("span", "", "関数のシグネチャ（`calcTotal(price: int): int`）、「引数」「フィールド」「定数」の表、`GET /api/...` の形の API などを書くと読み取れます。下の「仕様書から読む書き方」を見てください。"));
      list.appendChild(e);
      return;
    }
    const shown = rep.findings.filter((f) => state.filters.has(f.cat));
    const main = shown.filter((f) => f.cat !== "extra");
    const extras = shown.filter((f) => f.cat === "extra");
    if (!rep.findings.length) {
      const e = h("div", "empty allgood");
      e.appendChild(plain("strong", "", "食い違いは見つかりませんでした"));
      e.appendChild(h("span", "", `仕様の ${s.checked} 項目すべてが、コードと一致しています。`));
      list.appendChild(e);
    } else if (!shown.length) {
      list.appendChild(h("div", "empty", "絞りこみの条件に合う指摘はありません。"));
    }
    for (const f of main) list.appendChild(renderFinding(f));
    if (extras.length) {
      const head = h("div", "group-head");
      const mini = plain("span", "mini c-extra", "外");
      mini.setAttribute("aria-hidden", "true");
      head.appendChild(mini);
      head.appendChild(plain("span", "", "仕様書に書かれていないコード"));
      head.appendChild(plain("span", "n", s.extraTotal > extras.length ? `${extras.length} / ${s.extraTotal} 件` : `${extras.length} 件`));
      list.appendChild(head);
      const box = h("div", "extras");
      for (const f of extras) {
        const row = h("div", "extra-row");
        row.id = f.id;
        row.appendChild(plain("span", "k", KIND_LABEL[f.kind] || ""));
        const nm = plain("span", "nm", f.name);
        const det = f.rows[0] && f.rows[0].code;
        if (det && det !== f.name && !f.name.endsWith(det)) nm.appendChild(plain("small", "", det));
        row.appendChild(nm);
        if (f.code) {
          const loc = plain("button", "loc", `${f.code.file}:${f.code.line}`);
          loc.type = "button";
          loc.addEventListener("click", () => jumpCode(f.code.file, f.code.line));
          row.appendChild(loc);
        }
        box.appendChild(row);
      }
      list.appendChild(box);
    }
  }

  function renderFinding(f) {
    const card = h("article", `find f-${f.sev}`);
    card.id = f.id;
    const st = plain("div", `stamp c-${f.sev === "warn" ? "warn" : f.cat}`, STAMP[f.cat]);
    st.title = CAT_LABEL[f.cat];
    st.setAttribute("aria-hidden", "true");
    card.appendChild(st);
    const main = h("div", "find-main");
    const meta = h("div", "find-meta");
    meta.appendChild(plain("span", `sev sev-${f.sev}`, SEV_LABEL[f.sev]));
    meta.appendChild(plain("span", "kind", `${CAT_LABEL[f.cat]} · ${KIND_LABEL[f.kind] || ""}`));
    meta.appendChild(plain("span", "find-name", f.name));
    main.appendChild(meta);
    main.appendChild(h("h3", "find-title", f.title));
    if (f.more.length) {
      const ul = h("ul", "find-more");
      for (const m of f.more) ul.appendChild(h("li", "", m));
      main.appendChild(ul);
    }
    const rows = f.rows.filter((r) => r.label !== "コード");
    if (rows.length) {
      const wrap = h("div", "cmp-wrap");
      const t = h("table", "cmp");
      const thead = document.createElement("thead");
      const tr = document.createElement("tr");
      for (const x of ["", "項目", "仕様書", "コード"]) tr.appendChild(plain("th", "", x));
      tr.firstChild.appendChild(plain("span", "sr", "判定"));
      thead.appendChild(tr);
      t.appendChild(thead);
      const tb = document.createElement("tbody");
      for (const r of rows) {
        const row = document.createElement("tr");
        row.className = "s-" + r.state;
        const mark = { ok: "✓", bad: "✕", warn: "!", na: "–" }[r.state];
        const stc = plain("td", "st", mark);
        stc.setAttribute("aria-label", { ok: "一致", bad: "違う", warn: "要確認", na: "比べられない" }[r.state]);
        row.appendChild(stc);
        row.appendChild(plain("td", "lbl", r.label));
        row.appendChild(plain("td", "v spec", r.spec));
        row.appendChild(plain("td", "v code" + (r.code === "—" ? " none" : ""), r.code));
        tb.appendChild(row);
      }
      t.appendChild(tb);
      wrap.appendChild(t);
      main.appendChild(wrap);
    }
    const srcs = h("div", "srcs");
    if (f.spec) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "src";
      b.appendChild(plain("span", "src-where", `仕様書 ${f.spec.line} 行目`));
      b.appendChild(plain("code", "", f.spec.text || ""));
      b.addEventListener("click", () => jumpSpec(f.spec.line));
      srcs.appendChild(b);
    }
    if (f.code) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "src";
      const w = plain("span", "src-where", `${baseName(f.code.file)}:${f.code.line}`);
      w.title = `${f.code.file}:${f.code.line}`;
      b.appendChild(w);
      b.appendChild(plain("code", "", f.code.text || ""));
      b.addEventListener("click", () => jumpCode(f.code.file, f.code.line));
      srcs.appendChild(b);
    }
    if (srcs.children.length) main.appendChild(srcs);
    if (f.hint) main.appendChild(h("p", "hint", f.hint));
    card.appendChild(main);
    return card;
  }

  function renderChecks(rep, list) {
    if (!rep.checks.length) {
      list.appendChild(h("div", "empty", "照合した項目はありません。"));
      return;
    }
    const wrap = h("div", "table-wrap");
    const t = h("table", "checks");
    const thead = document.createElement("thead");
    const tr = document.createElement("tr");
    for (const x of ["行", "種類", "仕様の項目", "判定", "コードの場所"]) tr.appendChild(plain("th", "", x));
    thead.appendChild(tr);
    t.appendChild(thead);
    const tb = document.createElement("tbody");
    for (const c of rep.checks) {
      const row = document.createElement("tr");
      if (c.findingId) {
        row.dataset.fid = c.findingId;
        row.tabIndex = 0;
        const go = () => {
          state.view = "findings";
          const f = rep.findings.find((x) => x.id === c.findingId);
          if (f) state.filters.add(f.cat);
          renderResults();
          const el = document.getElementById(c.findingId);
          if (el) {
            el.scrollIntoView({ block: "center", behavior: smooth() });
            el.classList.remove("hl");
            void el.offsetWidth;
            el.classList.add("hl");
          }
        };
        row.addEventListener("click", go);
        row.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
      }
      row.appendChild(plain("td", "num", c.line ? String(c.line) : "—"));
      row.appendChild(plain("td", "", KIND_LABEL[c.kind] || ""));
      row.appendChild(plain("td", "nm", c.label));
      const label = c.status === "ok" || c.status === "info" ? "一致" : c.status === "skipped" ? "判定できず" : c.status === "error" ? (c.cat === "missing" ? "見つからない" : "食い違い") : "要確認";
      const td = document.createElement("td");
      td.appendChild(plain("span", `pill p-${c.status}`, label));
      row.appendChild(td);
      row.appendChild(plain("td", "num", c.code ? `${baseName(c.code.file)}:${c.code.line}` : "—"));
      tb.appendChild(row);
    }
    t.appendChild(tb);
    wrap.appendChild(t);
    list.appendChild(wrap);
  }

  $("view-findings").addEventListener("click", () => { state.view = "findings"; renderResults(); });
  $("view-checks").addEventListener("click", () => { state.view = "checks"; renderResults(); });

  // ---------------------------------------------------------------- コピー

  let toastTimer = 0;
  function toast(msg, warn) {
    const t = $("toast");
    t.textContent = msg;
    t.style.color = warn ? "var(--red)" : "";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.textContent = ""; }, 3500);
  }
  $("copy-md").addEventListener("click", () => {
    if (!state.report) return;
    const md = toMarkdown(state.report, { specName: state.spec.name || "仕様書", files: `${state.reportCtx.models.length} ファイル` });
    const fallback = () => {
      const box = $("copy-fallback");
      box.replaceChildren();
      const p = h("p", "hint", "自動でコピーできませんでした。下の文字を選んでコピーしてください。");
      p.style.marginTop = "10px";
      const ta = document.createElement("textarea");
      ta.className = "copybox";
      ta.id = "copy-text";
      ta.readOnly = true;
      ta.value = md;
      ta.setAttribute("aria-label", "コピーする Markdown");
      box.appendChild(p);
      box.appendChild(ta);
      ta.focus();
      ta.select();
    };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(md).then(() => toast("コピーしました"), fallback);
      else fallback();
    } catch (e) {
      fallback();
    }
  });

  // ---------------------------------------------------------------- その行へ移動

  const smooth = () => (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth");
  function flash(el) {
    el.classList.remove("flash");
    void el.offsetWidth;
    el.classList.add("flash");
  }
  function lineRange(text, line) {
    let start = 0;
    for (let i = 1; i < line; i++) {
      const n = text.indexOf("\n", start);
      if (n < 0) break;
      start = n + 1;
    }
    let end = text.indexOf("\n", start);
    if (end < 0) end = text.length;
    return [start, end];
  }
  /** 折り返しのある textarea の中で、index の文字の高さ位置を測る */
  function caretTop(ta, index) {
    const cs = getComputedStyle(ta);
    const div = document.createElement("div");
    for (const p of ["fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "boxSizing", "whiteSpace", "overflowWrap", "wordBreak", "tabSize"]) div.style[p] = cs[p];
    div.style.position = "absolute";
    div.style.visibility = "hidden";
    div.style.left = "-9999px";
    div.style.top = "0";
    div.style.width = ta.clientWidth + "px";
    div.style.whiteSpace = "pre-wrap";
    div.textContent = ta.value.slice(0, index);
    const mark = document.createElement("span");
    mark.textContent = "​";
    div.appendChild(mark);
    document.body.appendChild(div);
    const top = mark.offsetTop;
    div.remove();
    return top;
  }
  function jumpSpec(line) {
    const [a, b] = lineRange(specInput.value, line);
    const pane = $("spec-pane");
    pane.scrollIntoView({ block: "nearest", behavior: smooth() });
    specInput.focus({ preventScroll: true });
    specInput.setSelectionRange(a, b);
    specInput.scrollTop = Math.max(0, caretTop(specInput, a) - specInput.clientHeight / 3);
    updateSpecPos();
    flash(pane);
  }
  function jumpCode(file, line) {
    const f = state.files.find((x) => x.name === file);
    if (!f) return;
    if (state.active !== f.id) selectFile(f.id);
    const [a, b] = lineRange(codeInput.value, line);
    const pane = $("code-pane");
    pane.scrollIntoView({ block: "nearest", behavior: smooth() });
    codeInput.focus({ preventScroll: true });
    codeInput.setSelectionRange(a, b);
    const lh = parseFloat(getComputedStyle(codeInput).lineHeight) || 20;
    codeInput.scrollTop = Math.max(0, (line - 1) * lh - codeInput.clientHeight / 3);
    codeInput.scrollLeft = 0;
    gutter.scrollTop = codeInput.scrollTop;
    flash(pane);
  }

  // ---------------------------------------------------------------- はじめ

  // 最初は例を表示しておく（何をするツールか、すぐわかるように）
  loadSample(SAMPLES[0].id);
  run();
})();
