// 画面の動き。データは配布用HTMLでは <script id="eeg-data">、開発中は data/*.json から読みます。
(function () {
  "use strict";
  const E = window.EegVowel;
  const SVGNS = "http://www.w3.org/2000/svg";
  const VOWEL_JA = { a: "あ", e: "え", i: "い", o: "お", u: "う" };
  const BAND_NAMES = { "2-4": "δ", "4-8": "θ", "8-13": "α", "13-20": "β1", "20-30": "β2", "30-45": "γ" };
  const POS = { F3: [44, 44], F4: [88, 44], C3: [36, 68], C4: [96, 68], P3: [44, 92], P4: [88, 92] };

  const $ = (sel, el = document) => el.querySelector(sel);
  const pct = (v, d = 1) => (v * 100).toFixed(d) + "%";
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  function svg(tag, attrs = {}, parent) {
    const el = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    if (parent) parent.appendChild(el);
    return el;
  }
  function text(parent, x, y, s, attrs = {}) {
    const t = svg("text", { x, y, ...attrs }, parent);
    t.textContent = s;
    return t;
  }

  // ---------- tooltip ----------
  const tip = $("#tip");
  function attachTip(el, html) {
    const show = (e) => {
      tip.innerHTML = html;
      tip.hidden = false;
      const r = tip.getBoundingClientRect();
      const x = Math.min(window.innerWidth - r.width - 8, e.clientX + 12);
      const y = e.clientY - r.height - 12 < 8 ? e.clientY + 16 : e.clientY - r.height - 12;
      tip.style.left = x + "px";
      tip.style.top = y + "px";
    };
    el.addEventListener("pointerenter", show);
    el.addEventListener("pointermove", show);
    el.addEventListener("pointerleave", () => (tip.hidden = true));
  }

  async function loadData() {
    const el = document.getElementById("eeg-data");
    if (el) return JSON.parse(el.textContent);
    const [results, demo] = await Promise.all(["data/results.json", "data/demo.json"].map((u) => fetch(u).then((r) => r.json())));
    return { results, demo };
  }

  // ---------- head map ----------
  function drawHead(active) {
    const g = $("#headmap");
    g.innerHTML = "";
    svg("circle", { cx: 66, cy: 68, r: 54, fill: "var(--sheet)", stroke: "var(--line)", "stroke-width": 1.5 }, g);
    svg("path", { d: "M58 15 L66 4 L74 15", fill: "none", stroke: "var(--line)", "stroke-width": 1.5 }, g);
    svg("path", { d: "M12 58 q-7 10 0 20 M120 58 q7 10 0 20", fill: "none", stroke: "var(--line)", "stroke-width": 1.5 }, g);
    svg("line", { x1: 66, y1: 14, x2: 66, y2: 122, stroke: "var(--grid)" }, g);
    svg("line", { x1: 12, y1: 68, x2: 120, y2: 68, stroke: "var(--grid)" }, g);
    for (const [ch, [x, y]] of Object.entries(POS)) {
      const on = ch === active;
      svg("circle", { cx: x, cy: y, r: 9.5, fill: on ? "var(--pen)" : "var(--pen-soft)", stroke: "var(--pen)", "stroke-width": 1 }, g);
      text(g, x, y + 3.5, ch, { "text-anchor": "middle", "font-size": 9, "font-family": "var(--f-mono)", fill: on ? "var(--pen-ink)" : "var(--ink)" });
    }
  }

  // =================================================================== tool
  function buildTool(D) {
    const demo = D.demo, fs = demo.fs, V = demo.vowels;
    const tool = $("#tool");
    tool.innerHTML = `
      <div class="panel">
        <div class="controls">
          <label for="subj">被験者 <select id="subj"></select></label>
          <div class="chips" role="group" aria-label="正解の母音でしぼりこむ" id="vfilter"></div>
          <div class="nav">
            <button class="btn" id="prev" aria-label="前の試行">←</button>
            <span class="trial-id" id="tid"></span>
            <button class="btn" id="next" aria-label="次の試行">→</button>
            <button class="btn" id="rand">ランダム</button>
          </div>
        </div>
        <div class="scope-wrap"><svg class="scope" id="scope" viewBox="0 0 760 384" role="img" aria-label="6チャンネルの脳波"></svg></div>
        <div class="scope-foot"><span id="scope-cap"></span><span>2–45 Hz 帯域通過済み・128 Hz に間引き</span></div>
        <div class="feat">
          <h3>モデルが見ている特徴（周波数帯ごとのパワー、学習データの平均からのずれ）</h3>
          <svg class="feat-svg" id="feat" role="img" aria-label="特徴量のヒートマップ"></svg>
          <div class="feat-legend"><span>平均より弱い</span><span class="ramp"></span><span>平均より強い</span></div>
        </div>
      </div>
      <div class="panel">
        <div class="verdict">
          <div class="answer">
            <div class="truth"><div class="k">思い浮かべた母音</div><div class="glyph" id="truth"></div></div>
            <div class="guess"><div class="k">モデルの判定</div><div class="glyph" id="guess"></div></div>
          </div>
          <span class="hitbadge" id="hit"></span>
          <div class="bars" id="bars"></div>
          <p class="note" id="mnote"></p>
        </div>
        <div class="tally">
          <div class="row"><span>このページで判定した試行</span><b class="num" id="t-n">0</b></div>
          <div class="row"><span>そのうち当たり</span><b class="num" id="t-k">0</b></div>
          <div class="btns">
            <button class="btn" id="run-subj">この被験者の試行をまとめて判定</button>
            <button class="btn btn-primary" id="run-all">全員分をまとめて判定</button>
          </div>
          <p class="note" id="run-out" aria-live="polite"></p>
        </div>
      </div>`;

    const subjSel = $("#subj");
    for (const s of demo.subjects) {
      const o = document.createElement("option");
      o.value = s.subject;
      o.textContent = `${s.subject}（正解率 ${pct(s.acc, 0)}）`;
      subjSel.appendChild(o);
    }
    const vf = $("#vfilter");
    const filters = ["all", ...V.map((_, i) => i)];
    for (const f of filters) {
      const b = document.createElement("button");
      b.className = "chip";
      b.dataset.f = f;
      b.textContent = f === "all" ? "すべて" : `/${V[f]}/`;
      b.setAttribute("aria-pressed", f === "all");
      vf.appendChild(b);
    }
    $("#run-subj").textContent = `この被験者の${demo.subjects[0].trials.length}試行をまとめて判定`;

    const state = { s: 0, filter: "all", pos: 0, seen: new Set(), hits: 0 };
    const decoded = new Map();
    const getTrial = (si, ti) => {
      const key = si + ":" + ti;
      if (!decoded.has(key)) {
        const t = demo.subjects[si].trials[ti];
        decoded.set(key, E.decodeTrial(t.data, t.scale, demo.channels.length));
      }
      return decoded.get(key);
    };
    const visible = () => demo.subjects[state.s].trials.map((t, i) => [t, i]).filter(([t]) => state.filter === "all" || t.label === +state.filter).map(([, i]) => i);
    const classify = (si, ti) => {
      const t = demo.subjects[si].trials[ti];
      const model = demo.subjects[si].models[t.fold];
      return { t, model, r: E.predict(getTrial(si, ti), fs, model) };
    };

    function render() {
      const list = visible();
      state.pos = Math.max(0, Math.min(state.pos, list.length - 1));
      const ti = list[state.pos];
      const { t, model, r } = classify(state.s, ti);
      const x = getTrial(state.s, ti);
      const top = r.proba.indexOf(Math.max(...r.proba));
      $("#tid").textContent = `${state.pos + 1} / ${list.length}`;
      drawScope(x, fs, model, demo.channels);
      drawFeatures(r.features, model, demo.channels);
      $("#truth").innerHTML = `/${V[t.label]}/<small>${VOWEL_JA[V[t.label]]}</small>`;
      $("#guess").innerHTML = `/${V[top]}/<small>${VOWEL_JA[V[top]]}</small>`;
      const hit = $("#hit");
      hit.dataset.hit = top === t.label ? 1 : 0;
      hit.textContent = top === t.label ? "当たり" : "はずれ";
      const bars = $("#bars");
      bars.innerHTML = r.proba.map((p, c) => `
        <div class="bar" data-top="${c === top ? 1 : 0}">
          <span class="lab">/${V[c]}/<small>${VOWEL_JA[V[c]]}</small></span>
          <span class="track"><span class="fill" style="width:${(p / Math.max(0.5, ...r.proba)) * 100}%"></span><span class="chance" style="left:${(0.2 / Math.max(0.5, ...r.proba)) * 100}%"></span></span>
          <span class="pct">${pct(p)}${c === t.label ? '<span class="truthtag">正解</span>' : ""}</span>
        </div>`).join("");
      const winTxt = `${model.win[0]}–${model.win[1]}秒`;
      $("#mnote").innerHTML = `点線は偶然の 20%。この試行は第${t.fold + 1}分割のテスト側で、学習には使っていません。モデル: ${esc(model.clf)}・${esc(model.bandset)}・${winTxt}（内側の交差検証で自動選択）`;
      const key = state.s + ":" + ti;
      if (!state.seen.has(key)) {
        state.seen.add(key);
        if (top === t.label) state.hits++;
      }
      $("#t-n").textContent = state.seen.size;
      $("#t-k").textContent = `${state.hits}（${pct(state.hits / state.seen.size, 0)}）`;
    }

    function drawScope(x, fs, model, chans) {
      const g = $("#scope");
      g.innerHTML = "";
      const L = 52, R = 748, T = 22, rowH = 54, n = x[0].length, dur = n / fs;
      const W = R - L, H = rowH * chans.length;
      svg("rect", { x: 0, y: 0, width: 760, height: 384, class: "bg" }, g);
      for (let s = 0; s <= dur * 5; s++) {
        const xx = L + (s / (dur * 5)) * W;
        svg("line", { x1: xx, y1: T, x2: xx, y2: T + H, class: s % 5 === 0 ? "major" : "minor" }, g);
      }
      for (let r = 0; r <= chans.length; r++) svg("line", { x1: L, y1: T + r * rowH, x2: R, y2: T + r * rowH, class: "minor" }, g);
      const wx0 = L + (model.win[0] / dur) * W, wx1 = L + (model.win[1] / dur) * W;
      svg("rect", { x: wx0, y: T, width: wx1 - wx0, height: H, class: "win" }, g);
      text(g, wx0 + 4, T - 7, "モデルが使う区間", { class: "winlabel" });
      // 振幅スケール: 試行ごとに、全チャンネル共通（チャンネル間の大小がわかるように）
      let mx = 0;
      for (const ch of x) { const s = [...ch].map(Math.abs).sort((a, b) => a - b); mx = Math.max(mx, s[Math.floor(s.length * 0.98)]); }
      const uv = [10, 20, 25, 50, 100, 200].find((v) => v >= mx * 0.6) || 200;
      const k = rowH * 0.42 / Math.max(mx, 1e-6);
      chans.forEach((name, c) => {
        const mid = T + c * rowH + rowH / 2;
        let d = "";
        for (let i = 0; i < n; i++) {
          const xx = L + (i / (n - 1)) * W;
          const yy = Math.max(T + c * rowH + 1, Math.min(T + (c + 1) * rowH - 1, mid - x[c][i] * k));
          d += (i ? "L" : "M") + xx.toFixed(1) + " " + yy.toFixed(1);
        }
        const p = svg("path", { d, class: "trace" }, g);
        text(g, 8, mid + 4, name, { class: "chlabel" });
        const hit = svg("rect", { x: 0, y: mid - rowH / 2, width: 760, height: rowH, fill: "transparent" }, g);
        hit.addEventListener("pointerenter", () => { drawHead(name); p.style.strokeWidth = 1.8; });
        hit.addEventListener("pointerleave", () => { drawHead(null); p.style.strokeWidth = ""; });
      });
      for (let s = 0; s <= dur; s++) text(g, L + (s / dur) * W, T + H + 16, s + "s", { class: "tick", "text-anchor": "middle" });
      const sb = uv * k;
      svg("line", { x1: R - 2, y1: T + H + 34, x2: R - 2, y2: T + H + 34 - sb, class: "scalebar" }, g);
      text(g, R - 8, T + H + 34, uv + " µV", { class: "tick", "text-anchor": "end" });
      $("#scope-cap").textContent = `被験者${demo.subjects[state.s].subject}・第${state.pos + 1}試行（この条件の中で）・縦線は0.2秒ごと`;
    }

    function drawFeatures(f, model, chans) {
      const g = $("#feat");
      g.innerHTML = "";
      const nb = model.bands.length, L = 30, T = 4, cw = Math.min(46, 640 / nb), ch = 13, gap = 2;
      const W = L + nb * cw + 4, H = T + chans.length * (ch + gap) + 16;
      g.setAttribute("viewBox", `0 0 ${W} ${H}`);
      g.style.maxWidth = W * 1.25 + "px";
      const z = f.map((v, i) => (v - model.mean[i]) / model.std[i]);
      const css = getComputedStyle(document.documentElement);
      const neg = css.getPropertyValue("--div-neg").trim(), mid = css.getPropertyValue("--div-mid").trim(), pos = css.getPropertyValue("--div-pos").trim();
      chans.forEach((name, c) => {
        text(g, 0, T + c * (ch + gap) + 10, name);
        model.bands.forEach(([lo, hi], b) => {
          const v = Math.max(-2.5, Math.min(2.5, z[c * nb + b])) / 2.5;
          const col = `color-mix(in oklab, ${v < 0 ? neg : pos} ${Math.round(Math.abs(v) * 100)}%, ${mid})`;
          const r = svg("rect", { x: L + b * cw, y: T + c * (ch + gap), width: cw - gap, height: ch, rx: 2, fill: col }, g);
          attachTip(r, `${name}・${lo}–${hi} Hz<br>log パワー ${f[c * nb + b].toFixed(2)}<br>平均からのずれ ${z[c * nb + b] >= 0 ? "+" : ""}${z[c * nb + b].toFixed(2)} SD`);
        });
      });
      const step = nb > 8 ? 3 : 1;
      model.bands.forEach(([lo, hi], b) => {
        if (b % step) return;
        text(g, L + b * cw + (cw - gap) / 2, H - 3, BAND_NAMES[`${lo}-${hi}`] || `${lo}`, { "text-anchor": "middle" });
      });
    }

    function runMany(subjects) {
      let n = 0, k = 0;
      for (const si of subjects) demo.subjects[si].trials.forEach((t, ti) => {
        const { r } = classify(si, ti);
        n++;
        if (r.proba.indexOf(Math.max(...r.proba)) === t.label) k++;
      });
      return { n, k };
    }

    subjSel.addEventListener("change", () => { state.s = subjSel.selectedIndex; state.pos = 0; render(); });
    vf.addEventListener("click", (e) => {
      const b = e.target.closest(".chip");
      if (!b) return;
      state.filter = b.dataset.f;
      state.pos = 0;
      vf.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", c === b));
      render();
    });
    $("#prev").addEventListener("click", () => { const n = visible().length; state.pos = (state.pos - 1 + n) % n; render(); });
    $("#next").addEventListener("click", () => { const n = visible().length; state.pos = (state.pos + 1) % n; render(); });
    $("#rand").addEventListener("click", () => {
      state.s = Math.floor(Math.random() * demo.subjects.length);
      subjSel.selectedIndex = state.s;
      state.pos = Math.floor(Math.random() * visible().length);
      render();
    });
    $("#run-subj").addEventListener("click", () => {
      const { n, k } = runMany([state.s]);
      $("#run-out").textContent = `被験者${demo.subjects[state.s].subject}: ${n}試行中 ${k}試行が当たり（${pct(k / n)}）。偶然なら平均 ${(n * 0.2).toFixed(0)}試行。`;
    });
    $("#run-all").addEventListener("click", () => {
      const t0 = performance.now();
      const { n, k } = runMany(demo.subjects.map((_, i) => i));
      $("#run-out").textContent = `全員: ${n}試行中 ${k}試行が当たり（${pct(k / n)}）。偶然なら平均 ${(n * 0.2).toFixed(0)}試行。計算 ${Math.round(performance.now() - t0)} ms`;
    });
    render();
  }

  // =================================================================== results
  function buildResults(D) {
    const R = D.results, w = R.within, l = R.loso;
    const box = $("#results");
    const sig = w.p_perm < 0.05;
    const sorted = [...w.null].sort((a, b) => a - b);
    const nullMean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
    const null95 = sorted[Math.floor(sorted.length * 0.95)];
    const nGe = sorted.filter((v) => v >= w.acc).length;
    const lift = (w.acc - 0.2) * 100;
    const verdict = sig
      ? `被験者ごとに学習すると正解率は ${pct(w.acc)} で、偶然の 20% より ${lift.toFixed(1)} ポイント高く、ラベルをでたらめにした場合（置換検定）と比べても偶然とは言いにくい差です（p = ${w.p_perm.toFixed(3)}）。ただし差はごくわずかで、1回の判定はほぼ当てずっぽうと変わりません。`
      : `被験者ごとに学習すると正解率は ${pct(w.acc)} でした。偶然の 20% との差は ${lift.toFixed(1)} ポイントしかなく、ラベルをでたらめにしても同じくらいの値がよく出ます（${w.null.length}回中${nGe}回が実際以上、置換検定 p = ${w.p_perm.toFixed(2)}）。この方法とデータでは、母音を読み取れているとは言えません。`;
    box.innerHTML = `
      <div class="callout"><span class="stamp">${sig ? "わずかに偶然以上" : "偶然と区別できない"}</span><p>${verdict}
        別の人のデータだけで学習した場合（被験者間）は ${pct(l.acc)} です。同じ手順で「想像したか、声に出したか」を見分けると ${pct(R.checks[0].acc, 0)} 当たるので、計算は脳波の違いを拾えています。それでも母音どうしの違いは、このデータとこの方法ではほとんど読み取れませんでした。</p></div>
      <div class="stats">
        <div class="stat"><span class="k">被験者内の正解率</span><span class="v">${pct(w.acc)}</span><span class="s">${w.correct}/${w.n} 試行・95%CI ${pct(w.ci[0])}–${pct(w.ci[1])}</span></div>
        <div class="stat"><span class="k">偶然の正解率</span><span class="v">20.0%</span><span class="s">5種類から1つ</span></div>
        <div class="stat"><span class="k">置換検定の p 値</span><span class="v">${w.p_perm.toFixed(3)}</span><span class="s">${w.null.length}回シャッフル</span></div>
        <div class="stat"><span class="k">被験者間の正解率</span><span class="v">${pct(l.acc)}</span><span class="s">本人のデータなしで学習</span></div>
      </div>
      <div class="charts">
        <div class="panel chart"><h3>ラベルをでたらめにしたら、どれくらい当たるか</h3>
          <p class="sub">同じ手順をラベルのシャッフル付きで${w.null.length}回。平均 ${pct(nullMean)}、上位5%の境目 ${pct(null95)}。母音ごとの試行数が少し違うので、でたらめでも20%をやや超えます。</p><svg id="c-null"></svg>
          <div class="legend"><span><i style="background:var(--faint)"></i>シャッフルした場合</span><span><i style="background:var(--mark)"></i>実際</span></div></div>
        <div class="panel chart"><h3>被験者ごとの正解率</h3>
          <p class="sub">点が正解率、線が95%信頼区間。偶然の20%を超えて有意なのは15人中${w.n_significant}人（偶然でも平均0.75人は出ます）。</p><svg id="c-subj"></svg>
          <div class="legend"><span><i style="background:var(--pen)"></i>被験者内（本人のデータで学習）</span><span><i style="background:var(--mark)"></i>被験者間</span><span><i class="dash"></i>偶然 20%</span></div></div>
        <div class="panel chart"><h3>どの母音をどれと間違えたか</h3>
          <p class="sub">行が正解、列が判定。数字は試行数。対角線が当たりです。</p><svg id="c-cm"></svg></div>
        <div class="panel chart"><h3>同じ手順で、ほかの問題を解くと</h3>
          <p class="sub">計算が壊れていないかの確認。点線がそれぞれの偶然の値です。上の2つは記録がまとまり（ブロック）ごとなので、時間による変化も手がかりになりえます。母音どうしはブロックの中でランダムな順なので、その心配はありません。</p><svg id="c-check"></svg></div>
        <div class="panel chart span2"><h3>ほかに試した方法</h3>
          <p class="sub">設定を選ぶ入れ子の交差検証は使わず、被験者ごとの5分割交差検証の平均（甘めの見積もり）。どれも20%前後でした。</p>
          <div class="tablewrap"><table id="t-base"></table></div></div>
      </div>`;
    drawNull(w);
    drawSubjects(w, l);
    drawConfusion(w.confusion, D.demo.vowels);
    drawChecks(R.checks);
    const tb = $("#t-base");
    const rows = [[`このページのモデル（スペクトル + 線形、入れ子CVで自動選択）`, w.acc, true], ...Object.entries(R.baselines).map(([k, v]) => [k, v, false])];
    tb.innerHTML = `<thead><tr><th>方法</th><th style="text-align:right">正解率</th></tr></thead><tbody>${rows.map(([k, v, me]) => `<tr><td>${me ? "<b>" + esc(k) + "</b>" : esc(k)}</td><td class="n">${pct(v)}</td></tr>`).join("")}</tbody>`;
  }

  function frame(id, w, h) {
    const g = $(id);
    g.setAttribute("viewBox", `0 0 ${w} ${h}`);
    g.innerHTML = "";
    return g;
  }

  function drawNull(w) {
    const W = 520, H = 220, L = 40, Rr = 12, T = 14, B = 34;
    const g = frame("#c-null", W, H);
    const lo = 0.16, hi = 0.26, nb = 40, bw = (hi - lo) / nb;
    const counts = new Array(nb).fill(0);
    w.null.forEach((v) => counts[Math.max(0, Math.min(nb - 1, Math.floor((v - lo) / bw)))]++);
    const ymax = Math.max(...counts, 1);
    const sx = (v) => L + ((v - lo) / (hi - lo)) * (W - L - Rr), sy = (c) => H - B - (c / ymax) * (H - T - B);
    for (let t = 0; t <= ymax; t += Math.max(1, Math.ceil(ymax / 4))) {
      svg("line", { x1: L, x2: W - Rr, y1: sy(t), y2: sy(t), class: "gridl" }, g);
      text(g, L - 6, sy(t) + 4, t, { "text-anchor": "end" });
    }
    counts.forEach((c, i) => {
      if (!c) return;
      const x = sx(lo + i * bw) + 1, bwPx = sx(lo + bw) - sx(lo) - 2, y = sy(c);
      svg("path", { d: `M${x} ${H - B} V${y + 3} q0 -3 3 -3 h${bwPx - 6} q3 0 3 3 V${H - B} Z`, fill: "var(--faint)", opacity: 0.55 }, g);
      const hit = svg("rect", { x, y: T, width: bwPx, height: H - B - T, class: "hit" }, g);
      attachTip(hit, `正解率 ${pct(lo + i * bw)}–${pct(lo + (i + 1) * bw)}<br>${c}回`);
    });
    svg("line", { x1: L, x2: W - Rr, y1: H - B, y2: H - B, class: "axis" }, g);
    for (let v = lo; v <= hi + 1e-9; v += 0.02) text(g, sx(v), H - B + 16, pct(v, 0), { "text-anchor": "middle" });
    text(g, (L + W) / 2, H - 2, "正解率", { "text-anchor": "middle" });
    const ox = sx(w.acc);
    svg("line", { x1: ox, x2: ox, y1: T, y2: H - B, stroke: "var(--mark)", "stroke-width": 2 }, g);
    text(g, ox + (ox > W - 120 ? -6 : 6), T + 10, `実際 ${pct(w.acc)}`, { class: "lbl", "text-anchor": ox > W - 120 ? "end" : "start" });
    svg("line", { x1: sx(0.2), x2: sx(0.2), y1: T, y2: H - B, class: "chance" }, g);
  }

  function drawSubjects(w, l) {
    const W = 520, H = 250, L = 40, Rr = 10, T = 12, B = 34;
    const g = frame("#c-subj", W, H);
    const lo = 0, hi = 0.45;
    const sy = (v) => H - B - ((v - lo) / (hi - lo)) * (H - T - B);
    const n = w.per_subject.length, sx = (i) => L + ((i + 0.5) / n) * (W - L - Rr);
    for (let v = 0; v <= hi + 1e-9; v += 0.1) {
      svg("line", { x1: L, x2: W - Rr, y1: sy(v), y2: sy(v), class: "gridl" }, g);
      text(g, L - 6, sy(v) + 4, pct(v, 0), { "text-anchor": "end" });
    }
    svg("line", { x1: L, x2: W - Rr, y1: sy(0.2), y2: sy(0.2), class: "chance" }, g);
    w.per_subject.forEach((p, i) => {
      const x = sx(i);
      svg("line", { x1: x - 3, x2: x - 3, y1: sy(p.ci[0]), y2: sy(p.ci[1]), stroke: "var(--pen)", "stroke-width": 2, "stroke-linecap": "round", opacity: 0.45 }, g);
      svg("circle", { cx: x - 3, cy: sy(p.acc), r: 4.5, fill: "var(--pen)", stroke: "var(--sheet)", "stroke-width": 2 }, g);
      const la = l.per_subject[p.subject];
      if (la != null) svg("circle", { cx: x + 5, cy: sy(la), r: 4, fill: "var(--mark)", stroke: "var(--sheet)", "stroke-width": 2 }, g);
      text(g, x, H - B + 16, p.subject, { "text-anchor": "middle" });
      const hit = svg("rect", { x: x - 12, y: T, width: 24, height: H - B - T, class: "hit" }, g);
      attachTip(hit, `被験者${p.subject}（${p.n}試行）<br>被験者内 ${pct(p.acc)}（${p.correct}/${p.n}）・p=${p.p.toFixed(3)}<br>95%CI ${pct(p.ci[0])}–${pct(p.ci[1])}${la != null ? `<br>被験者間 ${pct(la)}` : ""}`);
    });
    text(g, (L + W) / 2, H - 2, "被験者", { "text-anchor": "middle" });
  }

  function drawConfusion(cm, V) {
    const n = V.length, cell = 52, L = 64, T = 34, W = L + n * cell + 10, H = T + n * cell + 10;
    const g = frame("#c-cm", W, H);
    g.style.maxWidth = W * 1.15 + "px";
    const rowSum = cm.map((r) => r.reduce((a, b) => a + b, 0));
    text(g, L + (n * cell) / 2, 12, "判定", { class: "lbl", "text-anchor": "middle" });
    text(g, 12, T + (n * cell) / 2, "正解", { class: "lbl", "text-anchor": "middle", transform: `rotate(-90 12 ${T + (n * cell) / 2})` });
    V.forEach((v, i) => {
      text(g, L + i * cell + cell / 2, T - 6, `/${v}/`, { "text-anchor": "middle" });
      text(g, L - 8, T + i * cell + cell / 2 + 4, `/${v}/`, { "text-anchor": "end" });
    });
    cm.forEach((row, i) => row.forEach((c, j) => {
      const frac = c / rowSum[i];
      const t = Math.max(0, Math.min(1, (frac - 0.1) / 0.25));
      const fill = `color-mix(in oklab, var(--div-neg) ${Math.round(12 + t * 80)}%, var(--sheet))`;
      const r = svg("rect", { x: L + j * cell + 1, y: T + i * cell + 1, width: cell - 2, height: cell - 2, rx: 3, fill }, g);
      if (i === j) svg("rect", { x: L + j * cell + 2, y: T + i * cell + 2, width: cell - 4, height: cell - 4, rx: 3, fill: "none", stroke: "var(--ink)", "stroke-width": 1.2 }, g);
      text(g, L + j * cell + cell / 2, T + i * cell + cell / 2 + 4, c, { "text-anchor": "middle", fill: t > 0.6 ? "#ffffff" : "var(--ink)", "font-size": 12 });
      attachTip(r, `正解 /${V[i]}/ → 判定 /${V[j]}/<br>${c}試行（正解 /${V[i]}/ の ${pct(frac)}）`);
    }));
  }

  function drawChecks(checks) {
    const W = 520, rowH = 58, T = 4, H = T + checks.length * rowH + 20;
    const g = frame("#c-check", W, H);
    const x0 = 0, x1 = W - 48, sx = (v) => x0 + v * (x1 - x0);
    for (let v = 0; v <= 1.0001; v += 0.25) {
      svg("line", { x1: sx(v), x2: sx(v), y1: T, y2: H - 18, class: "gridl" }, g);
      text(g, Math.min(Math.max(sx(v), 12), W - 30), H - 4, pct(v, 0), { "text-anchor": "middle" });
    }
    checks.forEach((c, i) => {
      const y = T + i * rowH, h = 14, by = y + 34;
      text(g, 0, y + 13, c.name, { class: "lbl" });
      text(g, 0, y + 28, `${c.metric}・${c.subjects}人${c.note ? "・" + c.note : ""}`, { "font-size": 10.5 });
      const wpx = Math.max(5, sx(c.acc) - x0);
      svg("path", { d: `M${x0} ${by} h${wpx - 4} q4 0 4 4 v${h - 8} q0 4 -4 4 h${-(wpx - 4)} Z`, fill: c.acc - c.chance > 0.1 ? "var(--pen)" : "var(--faint)" }, g);
      svg("line", { x1: sx(c.chance), x2: sx(c.chance), y1: by - 4, y2: by + h + 4, stroke: "var(--ink)", "stroke-width": 1.5, "stroke-dasharray": "3 2" }, g);
      text(g, sx(c.acc) + 6, by + 11, pct(c.acc, 0), { fill: "var(--ink)" });
      const hit = svg("rect", { x: 0, y, width: W, height: rowH - 2, class: "hit" }, g);
      attachTip(hit, `${esc(c.name)}<br>${c.metric} ${pct(c.acc)}（偶然 ${pct(c.chance)}）<br>${c.subjects}人・${c.n}試行`);
    });
  }

  // =================================================================== method
  function buildMethod(D) {
    const R = D.results, ds = R.dataset;
    const chosen = Object.entries(R.within.chosen).sort((a, b) => b[1] - a[1]).slice(0, 3);
    $("#method").innerHTML = `
      <div class="panel"><h3>データ</h3>
        <p>Pressel Coretto・Gareis・Rufiner（2017）の公開データベース。スペイン語話者 ${ds.subjects}人が、画面に出た母音 /a/ /e/ /i/ /o/ /u/ や方向の単語を、声を出さずに思い浮かべたときの脳波です。</p>
        <ul><li>電極 ${ds.channels.join("・")} の6つ（右上の図）</li><li>${ds.fs_original} Hz で記録、2–45 Hz のフィルタ済み。ここでは ${ds.fs_used} Hz に間引き</li>
        <li>アーチファクト（まばたき等）の印がない ${ds.trials_used} 試行を使用</li></ul></div>
      <div class="panel"><h3>分類のしかた</h3>
        <p>4秒の波形を1秒ずつ区切ってスペクトルを求め、周波数帯ごとのパワーの対数を特徴にします（6チャンネル × 帯域）。それを線形分類器（ロジスティック回帰か縮小LDA）にかけ、母音ごとの確率を出します。</p>
        <p>時間窓・帯域の分け方・分類器・正則化の強さの ${R.grid.windows.length * Object.keys(R.grid.bandsets).length * R.grid.classifiers.length} 通りから、学習データの中の交差検証だけで選びます。よく選ばれたのは「${esc(chosen[0][0])}」でした。</p></div>
      <div class="panel"><h3>甘く見積もらないために</h3>
        <ul><li>被験者ごとに5分割し、テストに回した試行は設定選びにも使わない（入れ子の交差検証）</li>
        <li>ラベルをシャッフルして同じ手順を${R.within.null.length}回回し、偶然の分布と比べる</li>
        <li>同じ手順で答えのわかっている問題（想像か発声か）も解き、計算が働くことを確かめる</li></ul>
        <p>論文によってはこのデータでもっと高い正解率が報告されていますが、試行の分け方や設定の選び方で結果は大きく変わります。</p></div>`;
    $("#footer").innerHTML = `データ: G. A. Pressel Coretto, I. E. Gareis, H. L. Rufiner, “Open access database of EEG signals recorded during imagined speech,” Proc. SPIE 10160 (2017), <a href="https://doi.org/${ds.doi}" target="_blank" rel="noopener">doi:${ds.doi}</a>。
      NEMAR による再配布 <a href="${ds.mirror}" target="_blank" rel="noopener">nm000258</a>。このページは医療・診断の用途には使えません。`;
  }

  drawHead(null);
  loadData().then((D) => {
    buildTool(D);
    buildResults(D);
    buildMethod(D);
  }).catch((e) => {
    $("#tool").innerHTML = `<div class="panel loading">データを読みこめませんでした（${esc(e.message)}）。配布用の dist/eeg-vowel.html を開くか、eeg-vowel フォルダで <code>python3 -m http.server</code> を実行してから開いてください。</div>`;
  });
})();
