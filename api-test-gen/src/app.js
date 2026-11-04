/*
 * 画面の動き。仕様書を読み、テストケースを作り、一覧・コード・実行結果を表示します。
 */
(function () {
  "use strict";
  const G = window.ApiTestGen;
  const { CATEGORIES } = G.cases;
  const CAT = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));
  const $ = (id) => document.getElementById(id);
  const STORE_KEY = "api-test-gen:spec";

  const state = {
    api: null,
    model: null,
    selected: new Set(),
    knownOps: new Set(),
    categories: Object.fromEntries(CATEGORIES.map((c) => [c.id, true])),
    negativeStatus: "spec",
    paramOverrides: {},
    credentials: {},
    baseUrl: "",
    baseUrlTouched: false,
    results: new Map(),
    view: "cases",
    filter: "all",
    running: null,
    outputs: {},
  };

  // ---------- 小さな道具 ----------
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  function debounce(fn, ms) {
    let t;
    return (...a) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...a), ms);
    };
  }
  function store(key, value) {
    try {
      if (value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch (e) {
      /* 保存できなくても動く */
    }
  }
  function load(key) {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }
  let toastTimer;
  function toast(msg) {
    let el = document.querySelector(".toast");
    if (!el) {
      el = document.createElement("div");
      el.className = "toast";
      el.setAttribute("role", "status");
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), 2200);
  }
  const statusLabel = (list) => list.map((s) => s.replace(/XX$/, "xx")).join(" / ");

  // ---------- 仕様書の読み込み ----------
  const specEl = $("spec");

  function parseSpec() {
    const text = specEl.value;
    const status = $("specStatus");
    const warn = $("warnings");
    try {
      const api = G.spec.loadSpec(text);
      state.api = api;
      status.dataset.state = "ok";
      const kind = api.version === "2.0" ? "Swagger 2.0" : "OpenAPI " + api.version;
      $("specMsg").innerHTML = `<b>${esc(api.title)}</b> ${esc(api.apiVersion)} <span class="meta">${esc(kind)} · ${api.operations.length} エンドポイント</span>`;
      warn.innerHTML = api.warnings.slice(0, 8).map((w) => `<li>${esc(w)}</li>`).join("");
      // 新しく出てきたエンドポイントは選んだ状態にする
      const keys = new Set(api.operations.map((o) => o.key));
      for (const k of keys) if (!state.knownOps.has(k)) state.selected.add(k);
      for (const k of [...state.selected]) if (!keys.has(k)) state.selected.delete(k);
      state.knownOps = keys;
      if (!state.baseUrlTouched) state.baseUrl = (api.servers[0] && api.servers[0].url) || "http://localhost:3000";
      $("baseUrl").value = state.baseUrl;
      renderOps();
      rebuild();
    } catch (e) {
      status.dataset.state = "error";
      $("specMsg").textContent = e instanceof G.spec.SpecError ? e.message : "読みこめませんでした: " + e.message;
      warn.innerHTML = "";
      if (!(e instanceof G.spec.SpecError)) console.error(e);
    }
  }
  const parseSoon = debounce(() => {
    parseSpec();
    store(STORE_KEY, specEl.value.length < 1500000 ? specEl.value : null);
  }, 250);
  specEl.addEventListener("input", parseSoon);

  function setSpec(text) {
    specEl.value = text;
    state.knownOps = new Set();
    state.selected = new Set();
    state.paramOverrides = {};
    state.baseUrlTouched = false;
    parseSpec();
    store(STORE_KEY, text.length < 1500000 ? text : null);
  }

  $("sample").addEventListener("change", (e) => {
    const v = e.target.value;
    if (v && G.examples[v]) setSpec(G.examples[v]);
    e.target.value = "";
  });
  $("openFile").addEventListener("click", () => $("fileInput").click());
  function readFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setSpec(String(reader.result));
    reader.onerror = () => toast("ファイルを読めませんでした");
    reader.readAsText(file);
  }
  $("fileInput").addEventListener("change", (e) => {
    readFile(e.target.files[0]);
    e.target.value = "";
  });
  const editor = $("editor");
  editor.addEventListener("dragover", (e) => {
    e.preventDefault();
    editor.classList.add("drag");
  });
  editor.addEventListener("dragleave", () => editor.classList.remove("drag"));
  editor.addEventListener("drop", (e) => {
    e.preventDefault();
    editor.classList.remove("drag");
    readFile(e.dataTransfer.files[0]);
  });
  // Tab キーでインデントを入れる（Esc のあとは普通に移動できる）
  let tabTrap = true;
  specEl.addEventListener("keydown", (e) => {
    if (e.key === "Escape") tabTrap = false;
    if (e.key === "Tab" && tabTrap && !e.shiftKey) {
      e.preventDefault();
      document.execCommand ? document.execCommand("insertText", false, "  ") : null;
    }
  });
  specEl.addEventListener("focus", () => (tabTrap = true));

  // ---------- 条件 ----------
  function renderCats() {
    $("cats").innerHTML = CATEGORIES.map(
      (c) => `<label class="cat" style="--c: var(--c-${c.id})" title="${esc(c.hint)}">
        <input type="checkbox" id="cat-${c.id}" data-cat="${c.id}" ${state.categories[c.id] ? "checked" : ""}>
        <span class="sw"></span>${esc(c.label)} <span class="n" id="catn-${c.id}"></span></label>`
    ).join("");
  }
  $("cats").addEventListener("change", (e) => {
    const id = e.target.dataset.cat;
    if (!id) return;
    state.categories[id] = e.target.checked;
    $("catHint").textContent = CAT[id].label + ": " + CAT[id].hint;
    rebuild();
  });
  $("cats").addEventListener("mouseover", (e) => {
    const input = e.target.closest(".cat") && e.target.closest(".cat").querySelector("input");
    if (input) $("catHint").textContent = CAT[input.dataset.cat].label + ": " + CAT[input.dataset.cat].hint;
  });

  function renderOps() {
    const api = state.api;
    $("ops").innerHTML = api.operations.length
      ? api.operations
          .map(
            (o) => `<label class="op ${state.selected.has(o.key) ? "" : "off"}">
          <input type="checkbox" data-op="${esc(o.key)}" ${state.selected.has(o.key) ? "checked" : ""}>
          <span class="method ${o.method}">${o.method.toUpperCase()}</span>
          <span class="path">${esc(o.path)}${o.summary ? `<span class="sum">${esc(o.summary)}</span>` : ""}</span>
          <span class="cnt" data-cnt="${esc(o.key)}"></span></label>`
          )
          .join("")
      : `<p class="cat-hint">エンドポイントがありません。</p>`;
  }
  $("ops").addEventListener("change", (e) => {
    const k = e.target.dataset.op;
    if (!k) return;
    if (e.target.checked) state.selected.add(k);
    else state.selected.delete(k);
    e.target.closest(".op").classList.toggle("off", !e.target.checked);
    rebuild();
  });
  $("opsAll").addEventListener("click", () => {
    state.selected = new Set(state.api ? state.api.operations.map((o) => o.key) : []);
    renderOps();
    rebuild();
  });
  $("opsGet").addEventListener("click", () => {
    state.selected = new Set(state.api ? state.api.operations.filter((o) => o.method === "get").map((o) => o.key) : []);
    renderOps();
    rebuild();
  });

  $("baseUrl").addEventListener("input", (e) => {
    state.baseUrl = e.target.value.trim();
    state.baseUrlTouched = true;
    if (state.model) state.model.baseUrl = state.baseUrl;
    state.outputs = {};
    if (state.view !== "cases") renderCode();
  });
  document.querySelectorAll('input[name="neg"]').forEach((r) =>
    r.addEventListener("change", (e) => {
      state.negativeStatus = e.target.value;
      rebuild();
    })
  );

  function renderSettings() {
    const m = state.model;
    const names = Object.keys(m.paramInfo);
    $("paramFields").innerHTML = names.length
      ? `<div class="subhead">パスに入れる値（実在するIDなど）</div>` +
        names
          .map((n) => {
            const info = m.paramInfo[n];
            const v = state.paramOverrides[n] != null ? state.paramOverrides[n] : "";
            return `<div class="field"><label for="param-${esc(n)}"><span class="mono">{${esc(n)}}</span></label>
              <input class="input" id="param-${esc(n)}" data-param="${esc(n)}" value="${esc(v)}" placeholder="${esc(String(m.params[n]))}" spellcheck="false">
              <span class="help">${esc(info.description || info.ops.slice(0, 2).join("、"))}</span></div>`;
          })
          .join("")
      : "";
    const schemes = Object.entries(m.schemes);
    $("authFields").innerHTML = schemes.length
      ? `<div class="subhead">認証情報（ブラウザで実行するときだけ使います。保存しません）</div>` +
        schemes
          .map(([name, s]) => {
            const c = state.credentials[name] || {};
            const input = (key, label, type) =>
              `<div class="field"><label for="cred-${esc(name)}-${key}">${label}</label><input class="input" id="cred-${esc(name)}-${key}" data-cred="${esc(name)}" data-key="${key}" type="${type}" value="${esc(c[key] || "")}" autocomplete="off" spellcheck="false"></div>`;
            if (s.kind === "bearer") return input("token", `${esc(name)} · Bearer トークン`, "password");
            if (s.kind === "apiKey") return input("key", `${esc(name)} · API キー（${esc(s.in)} の ${esc(s.name)}）`, "password");
            return `<div class="pair">${input("user", `${esc(name)} · ユーザー名`, "text")}${input("password", "パスワード", "password")}</div>`;
          })
          .join("")
      : "";
  }
  $("paramFields").addEventListener("input", (e) => {
    const n = e.target.dataset.param;
    if (!n) return;
    const raw = e.target.value.trim();
    const t = G.sample.mainType(G.sample.flatten(state.model.paramInfo[n].schema, state.api.resolver));
    state.paramOverrides[n] = raw === "" ? null : (t === "integer" || t === "number") && /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw;
    rebuildSoon();
  });
  $("authFields").addEventListener("input", (e) => {
    const n = e.target.dataset.cred;
    if (!n) return;
    state.credentials[n] = { ...(state.credentials[n] || {}), [e.target.dataset.key]: e.target.value };
  });

  // ---------- テストケースを作る ----------
  function rebuild() {
    if (!state.api) return;
    const params = {};
    for (const [k, v] of Object.entries(state.paramOverrides)) if (v != null) params[k] = v;
    state.model = G.cases.buildCases(state.api, {
      categories: state.categories,
      include: [...state.selected],
      negativeStatus: state.negativeStatus,
      params,
    });
    state.model.baseUrl = state.baseUrl || state.model.baseUrl;
    state.results = new Map();
    state.outputs = {};
    const settingsFocused = document.activeElement && document.activeElement.closest && document.activeElement.closest("#paramFields, #authFields");
    if (!settingsFocused) renderSettings();
    renderOverview();
    renderFilters();
    renderCases();
    if (state.view !== "cases") renderCode();
  }
  const rebuildSoon = debounce(rebuild, 300);

  function renderOverview() {
    const m = state.model;
    const n = m.cases.length;
    $("total").textContent = n;
    const by = {};
    for (const c of m.cases) by[c.category] = (by[c.category] || 0) + 1;
    const per = {};
    for (const c of m.cases) per[c.op.key] = (per[c.op.key] || 0) + 1;
    document.querySelectorAll("[data-cnt]").forEach((el) => (el.textContent = per[el.dataset.cnt] || ""));
    for (const c of CATEGORIES) {
      const el = $("catn-" + c.id);
      if (el) el.textContent = by[c.id] || "";
    }
    const ops = new Set(m.cases.map((c) => c.op.key)).size;
    $("ovSub").textContent = n ? `${ops} 個のエンドポイントから` : "テストがありません。種類かエンドポイントを選んでください";
    $("stack").innerHTML = CATEGORIES.filter((c) => by[c.id])
      .map((c) => `<span style="flex:${by[c.id]};background:var(--c-${c.id})"></span>`)
      .join("");
    $("legend").innerHTML = CATEGORIES.filter((c) => by[c.id])
      .map((c) => `<span><i style="background:var(--c-${c.id})"></i>${esc(c.label)}<b>${by[c.id]}</b></span>`)
      .join("");
    renderRunCounts();
  }

  function renderRunCounts() {
    const r = [...state.results.values()];
    $("ovRun").hidden = !r.length;
    if (!r.length) return;
    $("nPass").textContent = "合格 " + r.filter((x) => x.pass).length;
    $("nFail").textContent = "不合格 " + r.filter((x) => !x.pass && !x.skipped).length;
    $("nSkip").textContent = "スキップ " + r.filter((x) => x.skipped).length;
  }

  function renderFilters() {
    const m = state.model;
    const present = CATEGORIES.filter((c) => m.cases.some((x) => x.category === c.id));
    const items = [["all", "すべて"], ...present.map((c) => [c.id, c.label])];
    if (state.results.size) items.push(["fail", "不合格だけ"]);
    if (!items.some(([k]) => k === state.filter)) state.filter = "all";
    $("filters").innerHTML = items
      .map(([k, label]) => `<button type="button" class="filter" data-filter="${k}" aria-pressed="${state.filter === k}">${esc(label)}</button>`)
      .join("");
  }
  $("filters").addEventListener("click", (e) => {
    const k = e.target.dataset.filter;
    if (!k) return;
    state.filter = k;
    renderFilters();
    renderCases();
  });

  function visibleCases() {
    const f = state.filter;
    return state.model.cases.filter((c) => {
      if (f === "all") return true;
      if (f === "fail") {
        const r = state.results.get(c.id);
        return r && !r.pass && !r.skipped;
      }
      return c.category === f;
    });
  }

  function resultAttr(id) {
    const r = state.results.get(id);
    if (!r) return "";
    if (r.running) return "run";
    return r.skipped ? "skip" : r.pass ? "pass" : "fail";
  }
  function markText(id) {
    const r = resultAttr(id);
    return r === "pass" ? "✓" : r === "fail" ? "✕" : r === "skip" ? "–" : "";
  }

  function renderCases() {
    const m = state.model;
    const list = visibleCases();
    if (!m.cases.length) {
      $("groups").innerHTML = `<div class="empty">テストがありません。左で「テストの種類」と「エンドポイント」を選んでください。</div>`;
      return;
    }
    if (!list.length) {
      $("groups").innerHTML = `<div class="empty">この条件に当てはまるテストはありません。</div>`;
      return;
    }
    const groups = G.emit.common.groupByOp(list);
    $("groups").innerHTML = groups
      .map((g) => {
        const rows = g.cases
          .map((c) => {
            const r = state.results.get(c.id);
            const actual = r && r.status ? ` → <b>${r.status}</b>` : "";
            return `<details class="case" data-id="${c.id}" data-r="${resultAttr(c.id)}">
            <summary><span class="mark" aria-hidden="true">${markText(c.id)}</span><span class="id">${c.id}</span>
            <span class="chip" style="--c: var(--c-${c.category})">${esc(CAT[c.category].label)}</span>
            <span class="title">${esc(c.title)}</span><span class="exp">期待 <b>${esc(statusLabel(c.expect.status))}</b>${actual}</span></summary>
          </details>`;
          })
          .join("");
        return `<section class="group"><div class="group-head"><span class="method ${g.op.method}">${g.op.method.toUpperCase()}</span>
          <span class="path">${esc(g.op.path)}</span><span class="sum">${esc(g.op.summary || "")}</span>
          <span class="gstat">${g.cases.length} 件</span></div>${rows}</section>`;
      })
      .join("");
  }

  // 詳細は開いたときに作る（件数が多くても軽く動くように）
  $("groups").addEventListener(
    "toggle",
    (e) => {
      const d = e.target;
      if (!d.classList || !d.classList.contains("case") || !d.open) return;
      fillDetail(d);
    },
    true
  );

  function fillDetail(d) {
    const c = state.model.cases.find((x) => x.id === d.dataset.id);
    if (!c) return;
    const { url, init } = G.runtime.buildRequest(c.request, state.model.baseUrl, state.model.params, {}, state.model.schemes);
    const r = state.results.get(c.id);
    const old = d.querySelector(".detail");
    if (old) old.remove();
    const headers = Object.entries(init.headers).filter(([k]) => k !== "Accept").map(([k, v]) => `${k}: ${v}`);
    const authNote = c.request.auth ? `認証: ${c.request.auth.join(", ")}（実行時に付けます）` : c.category === "auth" ? "認証: なしで送ります" : "";
    let html = `<div class="detail">
      <div><h4>リクエスト</h4><div class="reqline"><span class="method ${c.request.method}">${init.method}</span>${esc(url)}</div></div>`;
    if (headers.length || authNote) html += `<div class="reqline">${esc([...headers, authNote].filter(Boolean).join("\n")).replace(/\n/g, "<br>")}</div>`;
    if (c.request.body !== undefined) html += `<div><h4>ボディ</h4><pre>${esc(JSON.stringify(c.request.body, null, 2))}</pre></div>`;
    html += `<div><h4>期待すること</h4>ステータス ${esc(statusLabel(c.expect.status))}${state.model.responses[c.op.key] ? "。仕様にスキーマがあるレスポンスは、形も確かめます" : ""}</div>`;
    if (r && !r.running) {
      if (r.skipped) html += `<div><h4>結果</h4>${esc(r.errors[0])}</div>`;
      else {
        html += `<div><h4>結果</h4>${r.pass ? `<span class="result-ok">合格</span>` : ""} ${r.status ? `ステータス ${r.status} · ${r.ms}ms` : ""}</div>`;
        if (r.errors.length) html += `<ul class="errors">${r.errors.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;
        if (r.bodyPreview) html += `<div><h4>レスポンス</h4><pre>${esc(prettyBody(r.bodyPreview))}</pre></div>`;
      }
    }
    html += `</div>`;
    d.insertAdjacentHTML("beforeend", html);
  }
  function prettyBody(text) {
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch (e) {
      return text;
    }
  }

  // ---------- ブラウザで実行 ----------
  $("runBtn").addEventListener("click", async () => {
    if (state.running) {
      state.running.aborted = true;
      return;
    }
    const m = state.model;
    if (!m || !m.cases.length) return;
    if (!state.baseUrl || !/^https?:\/\//i.test(state.baseUrl)) {
      toast("「テストするサーバーの URL」を http:// か https:// から入れてください");
      $("baseUrl").focus();
      return;
    }
    const cases = visibleCases();
    const ctrl = { aborted: false };
    state.running = ctrl;
    state.results = new Map();
    renderCases();
    $("runLabel").textContent = "止める";
    const bar = $("progress");
    bar.hidden = false;
    bar.firstElementChild.style.width = "0";
    let done = 0;
    const setRow = (id) => {
      const d = document.querySelector(`.case[data-id="${id}"]`);
      if (!d) return;
      d.dataset.r = resultAttr(id);
      d.querySelector(".mark").textContent = markText(id);
      const r = state.results.get(id);
      const exp = d.querySelector(".exp");
      const c = m.cases.find((x) => x.id === id);
      exp.innerHTML = `期待 <b>${esc(statusLabel(c.expect.status))}</b>${r && r.status ? ` → <b>${r.status}</b>` : ""}`;
      if (d.open && !r.running) fillDetail(d);
    };
    for (const c of cases) {
      if (ctrl.aborted) break;
      state.results.set(c.id, { running: true });
      setRow(c.id);
      const r = await G.runner.runCase(c, m, { baseUrl: state.baseUrl, params: m.params, credentials: state.credentials, timeoutMs: 15000 });
      if (state.model !== m) return; // 実行中に仕様書が変わった
      state.results.set(c.id, r);
      setRow(c.id);
      renderRunCounts();
      bar.firstElementChild.style.width = (++done / cases.length) * 100 + "%";
      if (r.network && done === 1) {
        toast("サーバーにつながりませんでした。URL と CORS の設定を確かめてください");
        break;
      }
    }
    state.running = null;
    $("runLabel").textContent = "もう一度実行";
    renderFilters();
    const vals = [...state.results.values()];
    const fails = vals.filter((x) => !x.pass && !x.skipped).length;
    toast(fails ? `不合格が ${fails} 件あります` : `${vals.filter((x) => x.pass).length} 件すべて合格しました`);
  });

  // ---------- コード ----------
  const EMIT = {
    js: () => G.emit.javascript(state.model),
    py: () => G.emit.python(state.model),
    postman: () => G.emit.postman(state.model),
  };
  function output(view) {
    if (!state.outputs[view]) state.outputs[view] = EMIT[view]();
    return state.outputs[view];
  }
  function envLine(prefix) {
    const m = state.model;
    const vars = Object.values(m.credentialEnv).flatMap((e) => Object.values(e)).filter((n) => !/PASSWORD/.test(n));
    return `BASE_URL=${m.baseUrl}${vars.map((v) => ` ${v}=xxxx`).join("")} ${prefix}`;
  }
  function renderCode() {
    if (!state.model) return;
    const view = state.view;
    const o = output(view);
    $("fname").textContent = o.filename;
    const howto = {
      js: `Node.js 18 以上で、そのまま動きます（インストール不要）。<pre>${esc(envLine("node --test " + o.filename))}</pre>`,
      py: `pytest と requests を入れてから実行します。<pre>pip install pytest requests\n${esc(envLine("pytest " + o.filename + " -v"))}</pre>`,
      postman: `Postman の「Import」で読みこみ、コレクションの変数 <code>baseUrl</code> と認証情報を設定して実行します。Newman でも動きます。<pre>${esc("newman run " + o.filename + " --env-var baseUrl=" + state.model.baseUrl)}</pre>`,
    }[view];
    $("howto").innerHTML = howto;
    const code = o.code;
    // とても大きいときは色付けを省く
    $("code").innerHTML = code.length > 1500000 ? esc(code) : highlight(code, view);
  }

  const KEYWORDS = {
    js: "const|let|var|function|return|if|else|for|of|in|while|async|await|new|try|catch|finally|throw|typeof|true|false|null|undefined|require|break|continue",
    py: "def|return|if|elif|else|for|in|while|import|from|as|try|except|finally|raise|class|not|and|or|is|None|True|False|lambda|with|pass|nonlocal|assert",
  };
  function highlight(code, view) {
    let re;
    if (view === "postman") re = /("(?:[^"\\\n]|\\.)*")(\s*:)?|(-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)|\b(true|false|null)\b/g;
    else if (view === "py") re = new RegExp(String.raw`("""[\s\S]*?"""|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')|(#[^\n]*)|\b(\d+(?:\.\d+)?)\b|\b(${KEYWORDS.py})\b|(@[\w.]+)`, "g");
    else re = new RegExp(String.raw`("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|` + "`(?:[^`\\\\]|\\\\.)*`" + String.raw`)|(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|\b(\d+(?:\.\d+)?)\b|\b(${KEYWORDS.js})\b`, "g");
    let out = "";
    let last = 0;
    let m;
    while ((m = re.exec(code))) {
      out += esc(code.slice(last, m.index));
      if (view === "postman") {
        if (m[1]) out += `<span class="${m[2] ? "t-p" : "t-s"}">${esc(m[1])}</span>${m[2] ? esc(m[2]) : ""}`;
        else if (m[3]) out += `<span class="t-n">${m[3]}</span>`;
        else out += `<span class="t-k">${m[4]}</span>`;
      } else if (m[1]) out += `<span class="t-s">${esc(m[1])}</span>`;
      else if (m[2]) out += `<span class="t-c">${esc(m[2])}</span>`;
      else if (m[3]) out += `<span class="t-n">${m[3]}</span>`;
      else if (m[4]) out += `<span class="t-k">${m[4]}</span>`;
      else out += `<span class="t-p">${esc(m[5])}</span>`;
      last = re.lastIndex;
    }
    return out + esc(code.slice(last));
  }

  $("copyBtn").addEventListener("click", () => {
    const text = output(state.view).code;
    const fallback = () => {
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents($("code"));
      sel.removeAllRanges();
      sel.addRange(range);
      toast("コピーできなかったので選択しました。Ctrl+C（⌘C）でコピーしてください");
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => toast("コピーしました"), fallback);
    } else fallback();
  });
  $("dlBtn").addEventListener("click", () => {
    const o = output(state.view);
    const blob = new Blob([o.code], { type: o.language === "json" ? "application/json" : "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = o.filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 1000);
    toast(o.filename + " をダウンロードしました");
  });

  // ---------- タブ ----------
  function setView(view) {
    state.view = view;
    document.querySelectorAll(".tab").forEach((t) => t.setAttribute("aria-selected", String(t.dataset.view === view)));
    $("view-cases").hidden = view !== "cases";
    $("view-code").hidden = view === "cases";
    if (view !== "cases") {
      $("view-code").setAttribute("aria-labelledby", "tab-" + view);
      renderCode();
    }
  }
  document.querySelector(".tabs").addEventListener("click", (e) => {
    const t = e.target.closest(".tab");
    if (t) setView(t.dataset.view);
  });
  document.querySelector(".tabs").addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const tabs = [...document.querySelectorAll(".tab")];
    const i = tabs.findIndex((t) => t.dataset.view === state.view);
    const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
    setView(next.dataset.view);
    next.focus();
  });

  // ---------- はじめ ----------
  renderCats();
  const saved = load(STORE_KEY);
  specEl.value = saved && saved.trim() ? saved : G.examples.library;
  parseSpec();
})();
