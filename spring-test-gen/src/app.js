/* 画面の動き。prompts.js / core.js / engines.js / samples.js を先に読みこんでください。 */
(function () {
  "use strict";
  const P = window.SpringTestPrompts;
  const C = window.SpringTestCore;
  const E = window.SpringTestEngines;
  const SAMPLES = window.SpringTestSamples;

  const $ = (id) => document.getElementById(id);
  const h = (tag, attrs, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
    return el;
  };

  // ---------------------------------------------------------------- ブラウザに覚えておくもの（なくても動く）
  const store = {
    get(k) {
      try { return localStorage.getItem("stg." + k); } catch (_) { return null; }
    },
    set(k, v) {
      try { if (v == null) localStorage.removeItem("stg." + k); else localStorage.setItem("stg." + k, v); } catch (_) { /* 使えないときは覚えない */ }
    },
  };

  // ---------------------------------------------------------------- 状態
  const state = {
    plan: null,
    planIsExample: false,
    jobs: [], // {cls, state: wait|run|done|warn|error, text, files, error, started, ended}
    files: [],
    activeFile: null,
    usage: null,
    usageModel: null,
    busy: false,
    abort: null,
    sample: null, // claude.ai の sample 関数
    downloads: null, // claude.ai の downloads
    planText: "",
    planStarted: 0,
    manualMode: false,
  };

  // ---------------------------------------------------------------- 設定のフォーム
  function buildForm() {
    const boot = $("boot");
    for (const [v, info] of Object.entries(P.BOOT_VERSIONS)) boot.append(h("option", { value: v, text: info.label }));
    const styles = $("styles");
    for (const [v, s] of Object.entries(P.STYLES)) {
      styles.append(
        h("label", { class: "style-card" },
          h("input", { type: "radio", name: "style", value: v }),
          h("b", { text: s.label }),
          h("span", { text: s.short })),
      );
    }
    const model = $("model");
    for (const [v, m] of Object.entries(E.MODELS)) model.append(h("option", { value: v, text: `${m.label.replace("Claude ", "")}（${m.note}）` }));

    const samples = $("samples");
    SAMPLES.forEach((s, i) => samples.append(h("button", { type: "button", class: "chip-btn", text: s.label, onclick: () => loadSample(i) })));

    // 前回の設定
    boot.value = store.get("boot") || "4";
    model.value = store.get("model") || "claude-opus-5-5";
    $("effort").value = store.get("effort") || "high";
    $("pkg").value = store.get("pkg") || "com.example.demo";
    const style = store.get("style") || "slice";
    (document.querySelector(`input[name="style"][value="${style}"]`) || document.querySelector('input[name="style"]')).checked = true;
    const key = store.get("apiKey");
    if (key) { $("api-key").value = key; $("remember-key").checked = true; }

    for (const id of ["boot", "model", "effort", "pkg"]) $(id).addEventListener("change", () => { store.set(id, $(id).value); onSettingsChange(); });
    styles.addEventListener("change", () => { store.set("style", settings().style); onSettingsChange(); });
    document.querySelectorAll('input[name="engine"]').forEach((r) => r.addEventListener("change", () => { store.set("engine", r.value); renderEngine(); }));
    $("remember-key").addEventListener("change", () => store.set("apiKey", $("remember-key").checked ? $("api-key").value.trim() : null));
    $("api-key").addEventListener("input", () => { if ($("remember-key").checked) store.set("apiKey", $("api-key").value.trim()); });
    syncStyleAvailability();
  }

  function settings() {
    const style = (document.querySelector('input[name="style"]:checked') || {}).value || "slice";
    return {
      boot: $("boot").value,
      style,
      basePackage: $("pkg").value.trim() || "com.example.demo",
      model: $("model").value,
      effort: $("effort").value,
    };
  }

  function engineKind() {
    return (document.querySelector('input[name="engine"]:checked') || {}).value || "manual";
  }

  function onSettingsChange() {
    syncStyleAvailability();
    if (state.files.length) recheck();
    if (state.manualMode) updatePromptSize();
  }

  /** MockMvcTester は 3.4 から */
  function syncStyleAvailability() {
    const boot = $("boot").value;
    const tester = document.querySelector('input[name="style"][value="tester"]');
    const ok = boot !== "3.0";
    tester.disabled = !ok;
    if (!ok && tester.checked) document.querySelector('input[name="style"][value="slice"]').checked = true;
  }

  // ---------------------------------------------------------------- つなぎ方
  function renderEngine() {
    const kind = engineKind();
    const claudeRadio = document.querySelector('input[name="engine"][value="claude"]');
    claudeRadio.disabled = !state.sample;
    $("key-box").hidden = kind !== "api";
    const note = $("engine-note");
    if (kind === "claude") note.textContent = "claude.ai のあなたのアカウントの Claude を使います。API キーはいりません。はじめて使うときに許可を聞かれます。";
    else if (kind === "api") note.textContent = "Anthropic の API キー（console.anthropic.com で作れます）で、このブラウザから直接呼びます。使った分だけ料金がかかります。";
    else note.textContent = "API を呼ばずに、プロンプトをコピーしてチャットに貼る方法です。答えを貼り戻すと、同じチェックができます。";
    $("plan-btn").textContent = kind === "manual" ? "プロンプトを用意する" : "テスト観点を作る";
    $("model").disabled = kind === "manual";
    $("effort").disabled = kind === "manual";
  }

  function pickDefaultEngine() {
    const saved = store.get("engine");
    let kind = saved || (state.sample ? "claude" : $("api-key").value ? "api" : "manual");
    if (kind === "claude" && !state.sample) kind = $("api-key").value ? "api" : "manual";
    if (kind === "api" && !window.AnthropicSDK) kind = "manual";
    document.querySelector(`input[name="engine"][value="${kind}"]`).checked = true;
    renderEngine();
  }

  function makeEngine() {
    const s = settings();
    const kind = engineKind();
    if (kind === "claude" && state.sample) return E.createSampleEngine(state.sample, s);
    if (kind === "api") {
      const key = $("api-key").value.trim();
      if (!key) throw new E.EngineError("no_key", "API キーを入れてください。");
      return E.createApiEngine({ apiKey: key, model: s.model, effort: s.effort });
    }
    return null;
  }

  // ---------------------------------------------------------------- 仕様書の入力
  function loadSample(i) {
    const s = SAMPLES[i];
    $("spec").value = s.spec;
    $("pkg").value = s.pkg;
    store.set("pkg", s.pkg);
    onSpecInput();
    if (i === 0 && (!state.plan || state.planIsExample)) showExamplePlan();
  }

  function onSpecInput() {
    const text = $("spec").value;
    store.set("spec", text);
    const bytes = new TextEncoder().encode(text).length;
    const eps = countEndpoints(text);
    $("spec-meta").textContent = text.trim()
      ? `${text.split("\n").length} 行・約 ${Math.max(1, Math.round(bytes / 1024))} KB${eps ? `・エンドポイントらしきもの ${eps} 件` : ""}`
      : "";
    if (state.manualMode) updatePromptSize();
  }

  /** 見た目のための大まかな数え方（GET /path や OpenAPI の get: など） */
  function countEndpoints(text) {
    const set = new Set();
    for (const m of text.matchAll(/\b(GET|POST|PUT|PATCH|DELETE)\s+(\/[\w/{}\-.:]*)/g)) set.add(m[1] + " " + m[2]);
    let path = null;
    for (const line of text.split("\n")) {
      const p = line.match(/^ {2}(\/[^:\s]*):\s*$/);
      if (p) { path = p[1]; continue; }
      const m = path && line.match(/^ {4}(get|post|put|patch|delete):\s*$/);
      if (m) set.add(m[1].toUpperCase() + " " + path);
    }
    return set.size;
  }

  function setupSpecInput() {
    const spec = $("spec");
    spec.addEventListener("input", onSpecInput);
    $("spec-file").addEventListener("change", async (e) => {
      const f = e.target.files[0];
      if (f) { spec.value = await f.text(); onSpecInput(); }
      e.target.value = "";
    });
    spec.addEventListener("dragover", (e) => { e.preventDefault(); spec.classList.add("drop-on"); });
    spec.addEventListener("dragleave", () => spec.classList.remove("drop-on"));
    spec.addEventListener("drop", async (e) => {
      spec.classList.remove("drop-on");
      const f = e.dataTransfer && e.dataTransfer.files[0];
      if (!f) return;
      e.preventDefault();
      spec.value = await f.text();
      onSpecInput();
    });
    const code = $("code-input");
    code.value = store.get("code") || "";
    if (code.value) $("code-box").open = true;
    code.addEventListener("input", () => store.set("code", code.value));
  }

  // ---------------------------------------------------------------- タブと手順
  function selectTab(name) {
    for (const t of ["plan", "code", "manual"]) {
      $("tab-" + t).setAttribute("aria-selected", String(t === name));
      $("panel-" + t).hidden = t !== name;
    }
  }

  function renderSteps() {
    const hasPlan = state.plan && !state.planIsExample && state.plan.cases.length;
    const hasCode = state.files.length > 0;
    const running = state.busy;
    const steps = {
      plan: hasPlan ? "done" : "active",
      code: hasCode ? "done" : hasPlan ? "active" : "",
      check: hasCode && !running ? (allClear() ? "done" : "active") : "",
    };
    document.querySelectorAll("#steps li").forEach((li) => {
      const s = steps[li.dataset.step];
      if (s) li.dataset.state = s; else delete li.dataset.state;
    });
    const sel = selectedCases().length;
    $("plan-count").textContent = state.plan && state.plan.cases.length ? `${sel}/${state.plan.cases.length}` : "";
    $("code-count").textContent = state.files.length ? String(state.files.filter((f) => f.lang === "java").length) : "";
  }

  function allClear() {
    const cov = C.coverage(selectedCases(), state.files);
    return cov.missing.length === 0 && state.files.every((f) => !C.lint(f, settings()).some((p) => p.level === "error"));
  }

  // ---------------------------------------------------------------- 1. 観点
  function selectedCases() {
    return state.plan ? state.plan.cases.filter((c) => c.selected) : [];
  }

  async function makePlan() {
    const spec = $("spec").value;
    if (!spec.trim()) { flashPlan("error", "仕様書を入れてください。"); $("spec").focus(); return; }
    if (engineKind() === "manual") { openManual(); return; }
    let engine;
    try { engine = makeEngine(); } catch (e) { flashPlan("error", e.message); if (e.code === "no_key") $("api-key").focus(); return; }

    const s = settings();
    const ctl = new AbortController();
    setBusy(true, ctl);
    state.planText = "";
    state.planStarted = Date.now();
    selectTab("plan");
    renderPlanProgress();
    const tick = setInterval(renderPlanProgress, 1000);
    let task = P.buildPlanTask(s);
    if (engine.kind !== "api") task += "\n\n# JSON の形（JSON Schema）\n" + JSON.stringify(P.PLAN_SCHEMA);
    try {
      const r = await engine.run({
        system: P.buildSystem(s),
        specBlock: P.buildSpecBlock(spec, $("code-input").value),
        task,
        schema: P.PLAN_SCHEMA,
        signal: ctl.signal,
        onText: (t) => { state.planText = t; },
      });
      trackUsage(engine, r.usage);
      const plan = C.parsePlan(r.text);
      if (!plan.cases.length) throw new Error("観点が1件もありませんでした。仕様書にエンドポイントが書かれているか確かめてください。");
      state.plan = plan;
      state.planIsExample = false;
      state.jobs = [];
      state.files = [];
      state.activeFile = null;
      if (r.stopReason === "max_tokens") state.plan.notice = "答えが長すぎて途中で切れました。観点が足りないかもしれません。仕様書を分けて渡すと確実です。";
    } catch (e) {
      clearInterval(tick);
      setBusy(false);
      if (e.code === "cancelled") { renderPlan(); return; }
      if (e.code === "unavailable") { state.sample = null; pickDefaultEngine(); }
      flashPlan("error", e.message || String(e));
      return;
    }
    clearInterval(tick);
    setBusy(false);
    renderPlan();
    renderCode();
  }

  function renderPlanProgress() {
    const panel = $("panel-plan");
    const found = (state.planText.match(/"id"\s*:/g) || []).length;
    const sec = Math.round((Date.now() - state.planStarted) / 1000);
    panel.replaceChildren(
      h("div", { class: "thinking" },
        h("span", { text: found ? `観点を書いています… ${found} 件` : "仕様書を読んで、観点を洗い出しています…" }),
        h("span", { class: "usage grow", text: `${sec} 秒` }),
        h("button", { type: "button", class: "btn btn-line btn-sm", text: "止める", onclick: () => state.abort && state.abort.abort() })),
      h("p", { class: "fineprint", text: "大きな仕様書では1〜2分かかることがあります。" }),
    );
  }

  function flashPlan(level, msg) {
    renderPlan();
    $("panel-plan").prepend(h("div", { class: "notice " + level, role: "alert", text: msg }));
    selectTab("plan");
  }

  function renderPlan() {
    const panel = $("panel-plan");
    const plan = state.plan;
    renderSteps();
    if (!plan) {
      panel.replaceChildren(
        h("div", { class: "empty" },
          h("b", { text: "まだテスト観点はありません" }),
          h("span", { text: "左に仕様書を入れて「テスト観点を作る」を押してください。" })),
      );
      return;
    }
    const kids = [];
    if (state.planIsExample) {
      kids.push(h("div", { class: "row" },
        h("span", { class: "example-flag", text: "例" }),
        h("span", { class: "fineprint", text: "書籍APIの仕様書から作った観点の見本です。自分の仕様書で「テスト観点を作る」を押すと置きかわります。" })));
    }
    if (plan.notice) kids.push(h("div", { class: "notice warn", text: plan.notice }));
    if (plan.summary) kids.push(h("p", { class: "summary-line", text: plan.summary }));

    // 観点の種類ごとの件数
    const byCat = {};
    for (const c of plan.cases) byCat[c.category] = (byCat[c.category] || 0) + 1;
    const guesses = plan.cases.filter((c) => c.basis === "assumption").length;
    kids.push(h("div", { class: "stats" },
      Object.keys(P.CATEGORIES).filter((k) => byCat[k]).map((k) => h("span", { class: "stat" }, P.CATEGORIES[k] + " ", h("b", { text: String(byCat[k]) }))),
      guesses ? h("span", { class: "stat" }, "うち推測 ", h("b", { text: String(guesses) })) : null));

    if (plan.questions.length) {
      kids.push(h("div", { class: "questions" },
        h("h3", { text: `仕様書で確認したい点（${plan.questions.length}）` }),
        h("ul", {}, plan.questions.map((q) => h("li", { text: q })))));
    }

    for (const cls of plan.classes) kids.push(renderClassTable(cls));

    const n = selectedCases().length;
    const disabled = state.planIsExample || state.busy || !n;
    kids.push(h("div", { class: "actions" },
      h("button", { type: "button", class: "btn btn-primary btn-big", text: `選んだ ${n} 件でテストコードを作る`, disabled, onclick: makeCode }),
      h("span", { class: "fineprint grow", text: state.planIsExample ? "見本なので、ここからは作れません。" : `${plan.classes.length} クラスに分けて作ります。` })));
    panel.replaceChildren(...kids);
  }

  function renderClassTable(cls) {
    const cases = state.plan.cases.filter((c) => c.className === cls.className);
    const rows = [];
    let lastEp = "";
    for (const c of cases) {
      const ep = c.method + " " + c.path;
      if (ep !== lastEp) {
        rows.push(h("tr", { class: "ep" }, h("td", { colspan: "5" }, h("span", { class: "method m-" + c.method, text: c.method }), h("span", { class: "path", text: c.path }))));
        lastEp = ep;
      }
      const detail = [c.given && "前提: " + c.given, c.request && "送る: " + c.request, c.expect && "確かめる: " + c.expect].filter(Boolean).join(" ／ ");
      const titleInput = h("input", { type: "text", class: "title", value: c.title, "aria-label": c.id + " のタイトル", disabled: state.planIsExample });
      titleInput.addEventListener("change", () => { c.title = titleInput.value.trim() || c.title; });
      const cb = h("input", { type: "checkbox", "aria-label": c.id + " を使う", disabled: state.planIsExample });
      cb.checked = c.selected;
      cb.addEventListener("change", () => { c.selected = cb.checked; tr.classList.toggle("off", !c.selected); refreshPlanButton(); });
      const tr = h("tr", { class: c.selected ? "" : "off", title: c.specRef ? "根拠: " + c.specRef : null },
        h("td", {}, cb),
        h("td", { class: "id", text: c.id }),
        h("td", {}, h("span", { class: "cat cat-" + c.category, text: P.CATEGORIES[c.category] })),
        h("td", {}, titleInput, detail ? h("span", { class: "detail", text: detail }) : null),
        h("td", { class: "st st-" + String(c.expectStatus)[0] }, String(c.expectStatus), c.basis === "assumption" ? h("div", { class: "guess", text: "推測" }) : null));
      rows.push(tr);
    }
    const addBtn = state.planIsExample ? null : h("button", { type: "button", class: "btn btn-line btn-sm", text: "＋ 観点を足す", onclick: () => addCase(cls) });
    return h("div", { class: "cls" },
      h("div", { class: "cls-head" },
        h("span", { class: "name", text: cls.className }),
        h("span", { class: "target", text: "対象: " + cls.target }),
        h("span", { class: "grow" }),
        addBtn),
      h("div", { class: "table-wrap" },
        h("table", { class: "cases" },
          h("thead", {}, h("tr", {}, h("th", {}, h("span", { class: "sr", text: "使う" })), h("th", { text: "ID" }), h("th", { text: "観点" }), h("th", { text: "タイトル" }), h("th", { text: "期待" }))),
          h("tbody", {}, rows))));
  }

  function refreshPlanButton() {
    renderSteps();
    const btn = $("panel-plan").querySelector(".actions .btn-primary");
    const n = selectedCases().length;
    if (btn) { btn.textContent = `選んだ ${n} 件でテストコードを作る`; btn.disabled = state.planIsExample || state.busy || !n; }
  }

  /** 手で観点を足す。いちばん下の観点のエンドポイントを引きつぐ */
  function addCase(cls) {
    const same = state.plan.cases.filter((c) => c.className === cls.className);
    const last = same[same.length - 1] || { method: "GET", path: "/" };
    const c = { id: C.nextCaseId(state.plan.cases), className: cls.className, method: last.method, path: last.path, category: "other", title: "", given: "", request: "", expectStatus: 200, expect: "", basis: "spec", specRef: "手で追加", selected: true };
    const idx = state.plan.cases.lastIndexOf(last);
    state.plan.cases.splice(idx + 1, 0, c);
    c.title = "（ここに確かめたいことを書く）";
    renderPlan();
    const inputs = $("panel-plan").querySelectorAll("input.title");
    for (const inp of inputs) if (inp.getAttribute("aria-label").startsWith(c.id)) { inp.focus(); inp.select(); }
  }

  // ---------------------------------------------------------------- 2. コード
  async function makeCode() {
    if (!state.plan || state.planIsExample) return;
    let engine;
    try { engine = makeEngine(); } catch (e) { flashPlan("error", e.message); return; }
    if (!engine) { openManual(); return; }
    const s = settings();
    const work = state.plan.classes
      .map((cls) => ({ cls, cases: state.plan.cases.filter((c) => c.selected && c.className === cls.className) }))
      .filter((w) => w.cases.length);
    state.jobs = work.map((w) => ({ cls: w.cls, cases: w.cases, state: "wait", text: "", files: [], error: "" }));
    state.files = [];
    state.activeFile = null;
    const ctl = new AbortController();
    setBusy(true, ctl);
    selectTab("code");
    renderCode();
    const ticker = setInterval(renderJobs, 1000);

    const base = { system: P.buildSystem(s), specBlock: P.buildSpecBlock($("spec").value, $("code-input").value), signal: ctl.signal };
    const runJob = async (job) => {
      if (ctl.signal.aborted) return;
      job.state = "run";
      job.started = Date.now();
      try {
        const r = await engine.run({ ...base, task: P.buildCodeTask(s, job.cls, job.cases), onText: (t) => onJobText(job, t) });
        trackUsage(engine, r.usage);
        acceptJob(job, r.text, r.stopReason);
      } catch (e) {
        job.state = e.code === "cancelled" ? "wait" : "error";
        job.error = e.code === "cancelled" ? "止めました" : e.message;
        if (e.partialText) acceptJob(job, e.partialText, "max_tokens", true);
      }
      job.ended = Date.now();
      renderCode();
    };

    // 1つ目を先に終わらせて仕様書をキャッシュに載せてから、残りを並べて走らせる
    const queue = [...state.jobs];
    const first = queue.shift();
    if (first) await runJob(first);
    const parallel = engine.kind === "api" ? 3 : 2;
    await Promise.all(Array.from({ length: Math.min(parallel, queue.length) }, async () => {
      while (queue.length && !ctl.signal.aborted) await runJob(queue.shift());
    }));
    clearInterval(ticker);
    setBusy(false);
    renderCode();
  }

  function onJobText(job, text) {
    job.text = text;
    const now = Date.now();
    if (now - (job.lastPaint || 0) < 250) return; // 描きなおしすぎない
    job.lastPaint = now;
    const files = C.extractFiles(text, settings().basePackage);
    job.files = files;
    rebuildFiles();
    if (!state.activeFile || state.activeFile.startsWith("…")) state.activeFile = files.length ? files[files.length - 1].path : state.activeFile;
    renderCode();
  }

  function acceptJob(job, text, stopReason, keepError) {
    job.text = text;
    job.files = C.extractFiles(text, settings().basePackage);
    if (!keepError) {
      if (!job.files.length) { job.state = "error"; job.error = "答えの中にコードが見つかりませんでした"; }
      else job.state = stopReason === "max_tokens" ? "warn" : "done";
      if (stopReason === "max_tokens") job.error = "答えが長すぎて途中で切れました。「直す」で続きを作れます。";
    }
    rebuildFiles();
  }

  function rebuildFiles() {
    const byPath = new Map();
    for (const j of state.jobs) for (const f of j.files) byPath.set(f.path, f);
    state.files = [...byPath.values()];
    if (state.activeFile && !byPath.has(state.activeFile)) state.activeFile = null;
    if (!state.activeFile && state.files.length) state.activeFile = state.files[0].path;
  }

  /** 足りない観点・見つかった問題を、そのクラスだけ直してもらう */
  async function fixJob(job) {
    let engine;
    try { engine = makeEngine(); } catch (e) { alertCode(e.message); return; }
    if (!engine) return;
    const s = settings();
    const main = job.files.find((f) => f.lang === "java") || { code: job.text, path: "" };
    const cov = C.coverage(job.cases, job.files);
    const missing = job.cases.filter((c) => cov.missing.includes(c.id));
    const problems = job.files.flatMap((f) => C.lint(f, s)).filter((p) => p.level === "error");
    const ctl = new AbortController();
    setBusy(true, ctl);
    job.state = "run";
    job.started = Date.now();
    job.error = "";
    const before = job.files;
    renderCode();
    const ticker = setInterval(renderJobs, 1000);
    try {
      const r = await engine.run({
        system: P.buildSystem(s),
        specBlock: P.buildSpecBlock($("spec").value, $("code-input").value),
        task: P.buildFixTask(s, job.cls, main.code, missing, problems),
        signal: ctl.signal,
        onText: (t) => onJobText(job, t),
      });
      trackUsage(engine, r.usage);
      acceptJob(job, r.text, r.stopReason);
      // 直した版に入っていないファイル（SQL など）は残す
      for (const f of before) if (!job.files.some((g) => g.path === f.path)) job.files.push(f);
      rebuildFiles();
    } catch (e) {
      job.files = before;
      job.state = e.code === "cancelled" ? "done" : "error";
      job.error = e.code === "cancelled" ? "" : e.message;
      rebuildFiles();
    }
    clearInterval(ticker);
    job.ended = Date.now();
    setBusy(false);
    renderCode();
  }

  function trackUsage(engine, usage) {
    if (!usage) return;
    state.usage = C.addUsage(state.usage, usage);
    state.usageModel = engine.model;
  }

  function setBusy(on, ctl) {
    state.busy = on;
    state.abort = on ? ctl : null;
    $("plan-btn").disabled = on;
    renderSteps();
  }

  function alertCode(msg) {
    $("panel-code").prepend(h("div", { class: "notice error", role: "alert", text: msg }));
  }

  // ---------------------------------------------------------------- 2'. コードの画面
  function renderJobs() {
    const box = $("jobs");
    if (!box) return;
    box.replaceChildren(...state.jobs.map((j) => {
      const sec = j.started ? Math.round(((j.state === "run" ? Date.now() : j.ended || Date.now()) - j.started) / 1000) : 0;
      const cov = C.coverage(j.cases, j.files);
      const label = {
        wait: j.error || "待ち",
        run: `作成中 ${sec} 秒`,
        done: `${cov.covered.length}/${cov.total} 件 ・ ${sec} 秒`,
        warn: `${cov.covered.length}/${cov.total} 件 ・ 途中で切れた`,
        error: "エラー",
      }[j.state];
      const needsFix = !state.busy && j.files.length && (cov.missing.length || j.state === "warn" || j.files.some((f) => C.lint(f, settings()).some((p) => p.level === "error")));
      return h("div", { class: "job", "data-state": j.state === "done" && cov.missing.length ? "warn" : j.state },
        h("span", { class: "dot", "aria-hidden": "true" }),
        h("div", {},
          h("div", { class: "name", text: j.cls.className }),
          j.error && j.state !== "wait" ? h("div", { class: "fineprint", text: j.error }) : null),
        h("div", { class: "row" },
          h("span", { class: "state", text: label }),
          needsFix ? h("button", { type: "button", class: "btn btn-line btn-sm", text: cov.missing.length ? `足りない ${cov.missing.length} 件を作る` : "直す", onclick: () => fixJob(j) }) : null,
          j.state === "error" && !state.busy && !j.files.length ? h("button", { type: "button", class: "btn btn-line btn-sm", text: "もう一度", onclick: () => fixJob(j) }) : null));
    }));
  }

  function renderCode() {
    renderSteps();
    const panel = $("panel-code");
    if (!state.jobs.length && !state.files.length) {
      panel.replaceChildren(h("div", { class: "empty" },
        h("b", { text: "まだテストコードはありません" }),
        h("span", { text: "テスト観点を確かめてから「テストコードを作る」を押してください。" })));
      return;
    }
    const s = settings();
    const kids = [];

    if (state.jobs.length) {
      kids.push(h("div", { class: "progress", id: "jobs" }));
      if (state.busy) {
        kids.push(h("div", { class: "actions" },
          h("button", { type: "button", class: "btn btn-line btn-sm", text: "止める", onclick: () => state.abort && state.abort.abort() }),
          h("span", { class: "fineprint", text: "1つ目のクラスを作ってから、残りをまとめて作ります（仕様書をキャッシュに載せるため）。" })));
      }
    }
    const cost = state.usage && C.estimateCost(state.usageModel, state.usage);
    if (cost) {
      const u = state.usage;
      kids.push(h("p", { class: "usage", text: `使ったトークン: 入力 ${fmt(u.input + u.cacheWrite)}・キャッシュから ${fmt(u.cacheRead)}・出力 ${fmt(u.output)} ／ 料金の目安 $${cost.usd.toFixed(3)}${cost.saved > 0.0005 ? `（キャッシュで $${cost.saved.toFixed(3)} 節約）` : ""}` }));
    }

    if (state.files.length) {
      kids.push(renderChecks(s));
      kids.push(renderEditor(s));
      kids.push(h("details", { class: "deps" },
        h("summary", { text: "テストに必要な依存（build.gradle の例）" }),
        h("pre", {}, h("code", { text: C.dependencySnippet(s) }))));
    }
    panel.replaceChildren(...kids);
    renderJobs();
  }

  function fmt(n) {
    return n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n);
  }

  function casesForCheck() {
    if (state.manualMode && state.manualIds) return state.manualIds.map((id) => ({ id }));
    return selectedCases();
  }

  function renderChecks(s) {
    const cases = casesForCheck();
    const cov = C.coverage(cases, state.files);
    const pct = cov.total ? Math.round((cov.covered.length / cov.total) * 100) : 100;
    const issues = state.files.flatMap((f) => C.lint(f, s).map((p) => ({ ...p, file: f })));
    const errors = issues.filter((i) => i.level === "error").length;
    const box = h("div", { class: "cls" });
    const inner = h("div", { class: "sheet-body" });
    const cover = h("div", { class: "cover" },
      h("div", { class: "num" }, String(cov.covered.length), h("small", { text: ` / ${cov.total} 観点` })),
      h("div", { class: "meter" + (cov.missing.length ? " partial" : ""), role: "img", "aria-label": `観点の ${pct}% がテストになっています` }, h("i", { style: `width:${pct}%` })),
      h("p", {},
        cov.total === 0
          ? "観点IDが見つからないので、漏れは数えられません。"
          : cov.missing.length
            ? h("span", {}, "まだテストがない観点: ", h("span", { class: "missing-ids", text: cov.missing.join(", ") }))
            : "すべての観点がテストになっています。",
        cov.extra.length ? `（表にないID ${cov.extra.join(", ")} のテストもあります）` : ""));
    inner.append(cover);
    if (issues.length) {
      inner.append(h("ul", { class: "issues" }, issues.map((i) =>
        h("li", { class: i.level },
          h("span", { class: "lv", text: i.level === "error" ? "要修正" : "注意" }),
          h("span", {},
            h("button", { type: "button", class: "where del", text: `${i.file.name}${i.line ? ":" + i.line : ""}`, onclick: () => { state.activeFile = i.file.path; state.hitLine = i.line; renderCode(); } }),
            i.message)))));
    } else {
      inner.append(h("p", { class: "all-clear", text: "自動チェックで見つかった問題はありません。" }));
    }
    inner.append(h("p", { class: "fineprint", text: errors ? "「要修正」は、そのままでは動かない可能性が高いものです。上の「直す」で直してもらえます。" : "自動チェックはコンパイルの代わりではありません。プロジェクトに入れて ./gradlew test で確かめてください。" }));
    box.append(inner);
    return box;
  }

  function renderEditor(s) {
    const file = state.files.find((f) => f.path === state.activeFile) || state.files[0];
    const tabs = h("div", { class: "files", role: "tablist", "aria-label": "ファイル" },
      state.files.map((f) => {
        const lv = C.lint(f, s);
        const flag = lv.some((p) => p.level === "error") ? "error" : lv.length ? "warn" : "";
        return h("button", { type: "button", class: "file-tab", role: "tab", "aria-selected": String(f === file), onclick: () => { state.activeFile = f.path; state.hitLine = 0; renderCode(); } },
          h("span", { class: "flag " + flag, "aria-hidden": "true" }), f.name, f.partial ? "…" : "");
      }));
    const hits = new Set(C.lint(file, s).map((p) => p.line).filter(Boolean));
    if (state.hitLine) hits.add(state.hitLine);
    const pre = h("pre", { tabindex: "0", "aria-label": file.name + " のコード" }, highlight(file.code, file.lang, hits));
    const bar = h("div", { class: "editor-bar" },
      h("span", { class: "grow", text: file.path }),
      h("button", { type: "button", class: "btn btn-line btn-sm", text: "コピー", onclick: (e) => copyText(file.code, e.currentTarget) }),
      h("button", { type: "button", class: "btn btn-line btn-sm", text: "保存", disabled: file.partial, onclick: () => saveFile(file.name, new TextEncoder().encode(file.code), "text/x-java") }),
      state.files.length > 1 ? h("button", { type: "button", class: "btn btn-line btn-sm", text: "全部を zip で保存", disabled: state.busy, onclick: () => saveFile("spring-api-tests.zip", C.makeZip(state.files), "application/zip") }) : null);
    const ed = h("div", { class: "editor" }, bar, pre);
    if (state.hitLine) {
      requestAnimationFrame(() => {
        const ln = pre.children[state.hitLine - 1];
        if (ln) pre.scrollTop = Math.max(0, ln.offsetTop - 60);
      });
    } else if (state.busy && file.partial) {
      requestAnimationFrame(() => { pre.scrollTop = pre.scrollHeight; });
    }
    return h("div", { style: "display:grid;gap:8px;min-width:0" }, tabs, ed);
  }

  // ---------------------------------------------------------------- Java の色づけ（軽いもの）
  const KW = new Set("abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for if implements import instanceof int interface long native new null package private protected public record return short static super switch this throw throws true false try var void volatile while yield".split(" "));

  function highlight(code, lang, hits) {
    const frag = document.createDocumentFragment();
    const lines = code.replace(/\n$/, "").split("\n");
    let inBlock = null; // "/*" or '"""'
    lines.forEach((line, i) => {
      const ln = h("span", { class: "ln" + (hits.has(i + 1) ? " hit" : "") });
      let rest = line;
      const push = (cls, text) => ln.append(cls ? h("span", { class: cls, text }) : document.createTextNode(text));
      while (rest.length) {
        if (inBlock) {
          const end = rest.indexOf(inBlock === "/*" ? "*/" : '"""');
          const cls = inBlock === "/*" ? "c" : "s";
          if (end < 0) { push(cls, rest); rest = ""; break; }
          push(cls, rest.slice(0, end + (inBlock === "/*" ? 2 : 3)));
          rest = rest.slice(end + (inBlock === "/*" ? 2 : 3));
          inBlock = null;
          continue;
        }
        let m;
        if (lang === "sql") {
          if ((m = rest.match(/^--.*/))) { push("c", m[0]); rest = rest.slice(m[0].length); continue; }
          if ((m = rest.match(/^'(?:[^']|'')*'/))) { push("s", m[0]); rest = rest.slice(m[0].length); continue; }
          if ((m = rest.match(/^[A-Za-z_]+/))) { push(/^(insert|into|values|select|from|where|delete|update|set|create|table|and|or|null)$/i.test(m[0]) ? "k" : "", m[0]); rest = rest.slice(m[0].length); continue; }
          push("", rest[0]); rest = rest.slice(1); continue;
        }
        if (rest.startsWith("//")) { push("c", rest); rest = ""; break; }
        if (rest.startsWith("/*")) { inBlock = "/*"; push("c", "/*"); rest = rest.slice(2); continue; }
        if (rest.startsWith('"""')) { inBlock = '"""'; push("s", '"""'); rest = rest.slice(3); continue; }
        if ((m = rest.match(/^"(?:[^"\\]|\\.)*"?/)) || (m = rest.match(/^'(?:[^'\\]|\\.)*'?/))) { push("s", m[0]); rest = rest.slice(m[0].length); continue; }
        if ((m = rest.match(/^@[A-Za-z_][\w.]*/))) { push("a", m[0]); rest = rest.slice(m[0].length); continue; }
        if ((m = rest.match(/^\d[\d_]*[lLdDfF]?/))) { push("n", m[0]); rest = rest.slice(m[0].length); continue; }
        if ((m = rest.match(/^[A-Za-z_$][\w$]*/))) { push(KW.has(m[0]) ? "k" : "", m[0]); rest = rest.slice(m[0].length); continue; }
        if ((m = rest.match(/^[^"'@\w/$]+|^\//))) { push("", m[0]); rest = rest.slice(m[0].length); continue; }
        push("", rest[0]); rest = rest.slice(1);
      }
      ln.append("\n");
      frag.append(ln);
    });
    return frag;
  }

  // ---------------------------------------------------------------- コピー・保存
  async function copyText(text, btn) {
    const label = btn ? btn.textContent : "";
    try {
      await navigator.clipboard.writeText(text);
      if (btn) { btn.textContent = "コピーしました"; setTimeout(() => { btn.textContent = label; }, 1500); }
      return true;
    } catch (_) {
      // 使えないときは、選んだ状態の欄を出す
      const ta = h("textarea", { class: "sr" });
      ta.value = text;
      document.body.append(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand("copy"); } catch (_) { ok = false; }
      ta.remove();
      if (btn) { btn.textContent = ok ? "コピーしました" : "コピーできませんでした"; setTimeout(() => { btn.textContent = label; }, 1800); }
      return ok;
    }
  }

  async function saveFile(name, bytes, type) {
    if (state.downloads) {
      try { await state.downloads.save({ filename: name, data: new Blob([bytes], { type }) }); } catch (_) { /* 見ている人が断った */ }
      return;
    }
    const url = URL.createObjectURL(new Blob([bytes], { type }));
    const a = h("a", { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  // ---------------------------------------------------------------- コピーして使う
  function openManual() {
    state.manualMode = true;
    $("tab-manual").hidden = false;
    selectTab("manual");
    updatePromptSize();
  }

  function manualPrompt() {
    return P.buildOneShotPrompt(settings(), $("spec").value, $("code-input").value);
  }

  function updatePromptSize() {
    const n = manualPrompt().length;
    $("prompt-size").textContent = `${n.toLocaleString()} 文字`;
  }

  function readAnswer() {
    const text = $("answer").value;
    const files = C.extractFiles(text, settings().basePackage);
    if (!files.length) {
      $("panel-manual").prepend(h("div", { class: "notice error", role: "alert", text: "答えの中にコードブロック（```java）が見つかりませんでした。答えをまるごと貼りつけてください。" }));
      return;
    }
    state.manualIds = C.idsInPlanText(text);
    state.jobs = [];
    state.files = files;
    state.activeFile = files[0].path;
    selectTab("code");
    renderCode();
  }

  function recheck() {
    renderCode();
  }

  // ---------------------------------------------------------------- 最初に見せる見本
  function showExamplePlan() {
    state.plan = C.normalizePlan(EXAMPLE_PLAN);
    state.planIsExample = true;
    renderPlan();
  }

  const EXAMPLE_PLAN = {
    summary: "書籍の取得・検索・登録・削除を行う REST API。エラーは Problem Details で返し、削除は ADMIN だけができる。",
    classes: [{ className: "BookControllerTest", target: "BookController" }],
    cases: [
      { id: "C001", className: "BookControllerTest", method: "GET", path: "/api/books/{id}", category: "normal", title: "存在するIDなら書籍を返す", given: "id=1 の書籍がある", request: "GET /api/books/1", expectStatus: 200, expect: "id, title, author, isbn, price, publishedOn", basis: "spec", specRef: "1. 200: { id, title, ... }" },
      { id: "C002", className: "BookControllerTest", method: "GET", path: "/api/books/{id}", category: "notfound", title: "存在しないIDなら404", given: "id=999 の書籍がない", request: "GET /api/books/999", expectStatus: 404, expect: "Problem Details の status=404", basis: "spec", specRef: "1. 404: 指定した id の書籍がない" },
      { id: "C003", className: "BookControllerTest", method: "GET", path: "/api/books", category: "normal", title: "省略時は page=0, size=20 で検索", given: "", request: "パラメータなし", expectStatus: 200, expect: "page=0, size=20", basis: "spec", specRef: "2. page 省略時 0 / size 省略時 20" },
      { id: "C004", className: "BookControllerTest", method: "GET", path: "/api/books", category: "boundary", title: "size=100 なら検索できる", given: "", request: "size=100", expectStatus: 200, expect: "size=100", basis: "spec", specRef: "2. size: 1〜100" },
      { id: "C005", className: "BookControllerTest", method: "GET", path: "/api/books", category: "boundary", title: "size=101 なら400", given: "", request: "size=101", expectStatus: 400, expect: "", basis: "spec", specRef: "2. 400: size が 1〜100 の外" },
      { id: "C006", className: "BookControllerTest", method: "POST", path: "/api/books", category: "normal", title: "正しい内容なら201とLocation", given: "", request: "全項目を正しく入れる", expectStatus: 201, expect: "Location: /api/books/{id}", basis: "spec", specRef: "3. 201 + Location" },
      { id: "C007", className: "BookControllerTest", method: "POST", path: "/api/books", category: "validation", title: "title がないと400と errors", given: "", request: "title を省く", expectStatus: 400, expect: "errors[0].field=title", basis: "spec", specRef: "共通: errors: [{ field, message }]" },
      { id: "C008", className: "BookControllerTest", method: "POST", path: "/api/books", category: "boundary", title: "title が101文字なら400", given: "", request: "title=101文字", expectStatus: 400, expect: "errors に title", basis: "spec", specRef: "3. title: 1〜100文字" },
      { id: "C009", className: "BookControllerTest", method: "POST", path: "/api/books", category: "conflict", title: "登録済みの isbn なら409", given: "isbn が登録済み", request: "同じ isbn", expectStatus: 409, expect: "", basis: "spec", specRef: "3. 409: isbn がすでに登録されている" },
      { id: "C010", className: "BookControllerTest", method: "DELETE", path: "/api/books/{id}", category: "auth", title: "ADMIN でなければ403", given: "USER でログイン", request: "DELETE /api/books/1", expectStatus: 403, expect: "削除されない", basis: "spec", specRef: "4. 403: ADMIN ではない" },
    ],
    questions: [
      "page に負の数を入れたときの動き（400 か 0 扱いか）が書かれていません。",
      "isbn が13桁の数字でないときのエラーメッセージの文言は決まっていますか。",
    ],
  };

  // ---------------------------------------------------------------- はじめる
  async function start() {
    buildForm();
    setupSpecInput();
    for (const t of ["plan", "code", "manual"]) $("tab-" + t).addEventListener("click", () => selectTab(t));
    $("plan-btn").addEventListener("click", makePlan);
    $("copy-prompt").addEventListener("click", (e) => copyText(manualPrompt(), e.currentTarget));
    $("read-answer").addEventListener("click", readAnswer);

    const saved = store.get("spec");
    if (saved && saved.trim()) { $("spec").value = saved; onSpecInput(); renderPlan(); }
    else loadSample(0);
    renderCode();
    pickDefaultEngine();

    // claude.ai で公開したページなら、API キーなしで Claude を使える
    const sample = await E.detectSample();
    if (sample) {
      state.sample = sample;
      if (!store.get("engine") || store.get("engine") === "claude") document.querySelector('input[name="engine"][value="claude"]').checked = true;
      renderEngine();
    }
    try {
      if (window.claude && window.claude.use) state.downloads = await window.claude.use("downloads");
    } catch (_) { state.downloads = null; }
  }

  start();
})();
