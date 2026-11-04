/* 画面の動き。計算は sim.js、グラフは chart.js。 */
(function () {
  "use strict";
  const S = window.GameLabSim;
  const { Chart, setupCanvas, css, color, fmt } = window.GameLabChart;
  const $ = (id) => document.getElementById(id);
  const num = (id) => +$(id).value;
  const f1 = (v) => (Math.round(v * 10) / 10).toFixed(1);
  const f2 = (v) => (Math.round(v * 100) / 100).toFixed(2);
  const pct = (v, d = 0) => (v * 100).toFixed(d) + "%";
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const FONT_LABEL = '12px "BIZ UDPGothic", "Hiragino Sans", "Yu Gothic UI", sans-serif';
  const FONT_NUM = '12px "IBM Plex Mono", ui-monospace, monospace';

  // ------------------------------------------------------------ 共通: スライダーの数字表示
  const OUT_FMT = {
    "sat-cost": f1, "sat-drop": f1,
    "mx-asp": (v) => v + "%", "mx-habit": (v) => v.toFixed(3), "mx-rate": f2, "mx-p0": f2, "mx-q0": f2,
    "ipd-noise": (v) => pct(v, 1), "ipd-T": f1, "ipd-R": f1, "ipd-P": f1, "ipd-S": f1, "ipd-asp": f1, "ipd-habit": f2,
    "sp-b": f2, "sp-K": f2, "sp-asp": f2, "sp-mu": (v) => pct(v, 1), "sp-c0": (v) => pct(v),
  };
  function syncOutputs(scope = document) {
    scope.querySelectorAll('input[type="range"]').forEach((el) => {
      const out = $(el.id + "-out");
      if (out) out.textContent = (OUT_FMT[el.id] || String)(+el.value);
    });
  }

  function legend(ul, items) {
    ul.innerHTML = items
      .map((it) =>
        `<li>${it.line ? `<span class="ln${it.dash ? " dash" : ""}" style="border-color:${color(it.color)}"></span>` : `<span class="sw" style="background:${color(it.color)}"></span>`}${esc(it.name)}</li>`)
      .join("");
  }

  /** 連続した入力を1フレームにまとめる */
  function scheduler(fn) {
    let queued = false, quick = true;
    return (isQuick) => {
      quick = queued ? quick && isQuick : isQuick;
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; fn(quick); });
    };
  }

  // ------------------------------------------------------------ タブ
  const TABS = ["satisfice", "matrix", "ipd", "spatial"];
  const inited = {};
  const INIT = {}, ON_SHOW = {}, ON_HIDE = {}, REDRAW = {};
  let current = null;
  function showTab(name) {
    if (!TABS.includes(name)) name = "satisfice";
    if (current && current !== name && ON_HIDE[current]) ON_HIDE[current]();
    current = name;
    for (const t of TABS) {
      const on = t === name;
      const btn = $("tab-" + t);
      btn.setAttribute("aria-selected", on);
      btn.tabIndex = on ? 0 : -1;
      $("panel-" + t).hidden = !on;
    }
    if (!inited[name]) { inited[name] = true; INIT[name](); }
    else if (REDRAW[name]) REDRAW[name]();
    if (ON_SHOW[name]) ON_SHOW[name]();
  }
  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      const name = btn.dataset.tab;
      if (location.hash !== "#" + name) history.replaceState(null, "", "#" + name);
      showTab(name);
    });
    btn.addEventListener("keydown", (e) => {
      const i = TABS.indexOf(btn.dataset.tab);
      const j = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : null;
      if (j == null) return;
      e.preventDefault();
      const next = $("tab-" + TABS[(j + TABS.length) % TABS.length]);
      next.focus(); next.click();
    });
  });
  window.addEventListener("hashchange", () => showTab(location.hash.slice(1)));

  // ============================================================ 満足化
  const SAT = [
    { k: "satisfice", name: "満足化", color: "--s1" },
    { k: "adaptive", name: "妥協する満足化", color: "--s2" },
    { k: "maximize", name: "全部見る（最大化）", color: "--s3" },
    { k: "secretary", name: "37%ルール", color: "--s4" },
    { k: "optimal", name: "最適停止（理論上の目安）", color: "--ink", dash: true },
  ];
  INIT.satisfice = function () {
    const dist = $("sat-dist");
    dist.innerHTML = Object.entries(S.DISTS).map(([k, d]) => `<option value="${k}">${d.label}</option>`).join("");
    let seed = 7, exampleIndex = 0, last = null;
    const cache = { key: null, T: null, okey: null, opt: null };
    const sweepChart = new Chart($("sat-sweep"), { height: 280, ariaLabel: "願望水準と平均の手取りのグラフ" });
    const strip = makeStrip($("sat-strip"));

    function compute(quick) {
      const p = {
        n: num("sat-n"), cost: num("sat-cost"), dist: dist.value, noise: num("sat-noise"),
        aspiration: num("sat-asp"), drop: num("sat-drop"), recall: $("sat-recall").checked,
        trials: quick ? Math.min(800, num("sat-trials")) : num("sat-trials"), seed,
      };
      const key = [p.n, p.trials, p.dist, p.noise, p.seed].join("|");
      if (cache.key !== key) { cache.key = key; cache.T = S.makeTrials(p); }
      const okey = [p.n, p.cost, p.dist].join("|");
      if (cache.okey !== okey) { cache.okey = okey; cache.opt = S.optimalThresholds(p.n, p.cost, p.dist); }
      const T = cache.T, opt = cache.opt;
      const strategies = {
        satisfice: { kind: "satisfice", aspiration: p.aspiration, drop: 0 },
        adaptive: { kind: "satisfice", aspiration: p.aspiration, drop: p.drop },
        maximize: { kind: "maximize" },
        secretary: { kind: "secretary" },
        optimal: { kind: "optimal", thresholds: opt.thresholds },
      };
      const res = {};
      for (const [k, s] of Object.entries(strategies)) res[k] = S.evaluate(T, s, p.cost, p.recall);
      const step = quick ? 2 : 1;
      const sweep = S.sweepAspiration(T, p.cost, 0, p.recall, step);
      const sweepA = p.drop > 0 ? S.sweepAspiration(T, p.cost, p.drop, p.recall, step) : null;
      const ex = exampleIndex % p.trials;
      const example = {
        truth: Array.from(T.truth.subarray(ex * p.n, ex * p.n + p.n)),
        seen: Array.from(T.seen.subarray(ex * p.n, ex * p.n + p.n)),
        stops: Object.fromEntries(Object.entries(strategies).map(([k, s]) => [k, S.searchOnce(T, ex, s, p.recall)])),
      };
      last = { p, res, sweep, sweepA, opt, example };
      render();
    }

    function render() {
      if (!last) return;
      const { p, res, sweep, sweepA, opt, example } = last;
      // 見出し
      const best = sweep.best;
      const mine = res.satisfice.net;
      const ratio = res.optimal.net > 0 ? best.net / res.optimal.net : null;
      $("sat-head").innerHTML = `この条件で一番よい願望水準は <strong>${best.a}</strong>。平均の手取りは <strong>${f1(best.net)}</strong>`;
      const parts = [];
      parts.push(`いまの願望水準 ${p.aspiration} では ${f1(mine)}${Math.abs(best.net - mine) < 0.05 ? "（最善と同じ）" : `（最善より ${f1(best.net - mine)} 少ない）`}。`);
      const dm = best.net - res.maximize.net;
      parts.push(dm > 0
        ? `全部見る（最大化）は ${f1(res.maximize.net)} で、うまく満足化したほうが ${f1(dm)} 得です。`
        : `全部見る（最大化）は ${f1(res.maximize.net)} で、この条件ではそのほうが得です（コストが小さいため）。`);
      if (ratio && ratio > 0) parts.push(`理論上の最適停止（${f1(res.optimal.net)}）の ${Math.min(100, Math.round(ratio * 100))}% に届いています。`);
      if (p.noise > 0) parts.push(`見まちがいがあると、全部見る人は「よく見えただけ」の候補をつかみやすくなります。`);
      $("sat-body").textContent = parts.join("");
      $("sat-sub").textContent = `${p.trials.toLocaleString("ja-JP")} 回の平均・候補 ${p.n} 個・コスト ${f1(p.cost)}`;

      // 表
      const nets = SAT.map((s) => res[s.k].net);
      const maxNet = Math.max(...nets, 1e-9);
      const winner = SAT.filter((s) => s.k !== "optimal").reduce((a, b) => (res[b.k].net > res[a.k].net ? b : a));
      $("sat-table").tBodies[0].innerHTML = SAT.map((s) => {
        const r = res[s.k];
        const w = Math.max(0, r.net) / maxNet * 100;
        return `<tr${s === winner ? ' class="best"' : ""}><td><span class="name"><span class="sw" style="background:${color(s.color)}"></span>${s.name}${s === winner ? '<span class="pill">いちばん</span>' : ""}</span></td>` +
          `<td class="num">${f1(r.net)}</td><td class="bar-cell"><div class="bar" style="width:${w}%;background:${color(s.color)}"></div></td>` +
          `<td class="num">${f1(r.looked)}</td><td class="num">${pct(r.pBest)}</td></tr>`;
      }).join("");

      // 願望水準スイープ
      const series = [{ name: "満足化", color: "--s1", ys: sweep.net, area: true }];
      if (sweepA) series.push({ name: "妥協する満足化", color: "--s2", ys: sweepA.net });
      const hlines = [
        { y: res.maximize.net, color: "--s3", label: "全部見る" },
        { y: res.secretary.net, color: "--s4", label: "37%ルール" },
        { y: res.optimal.net, color: "--ink", label: "最適停止", dash: [2, 3] },
      ];
      const iA = sweep.xs.findIndex((x) => x >= p.aspiration);
      const points = [{ x: best.a, y: best.net, color: "--s1", label: `最善 ${best.a}` }];
      if (iA >= 0 && Math.abs(sweep.xs[iA] - best.a) > 3) points.push({ x: sweep.xs[iA], y: sweep.net[iA], color: "--s1", hollow: true, label: "いま" });
      sweepChart.set({
        xs: sweep.xs, series, hlines, points, xDomain: [0, 100],
        vlines: [{ x: p.aspiration, color: "--s1" }],
        xLabel: "願望水準",
        tipHead: (i) => `願望水準 ${sweep.xs[i]}`,
        tooltip: (i) => {
          const rows = [["満足化", f1(sweep.net[i]), "--s1"], ["…見た数", f1(sweep.looked[i]), ""]];
          if (sweepA) rows.push(["妥協する満足化", f1(sweepA.net[i]), "--s2"]);
          rows.push(["全部見る", f1(res.maximize.net), "--s3"], ["37%ルール", f1(res.secretary.net), "--s4"], ["最適停止", f1(res.optimal.net), "--ink"]);
          return rows;
        },
      });
      legend($("sat-sweep-legend"), [
        { name: "満足化（願望水準ごと）", color: "--s1", line: true },
        ...(sweepA ? [{ name: `妥協する満足化（1つごとに −${f1(p.drop)}）`, color: "--s2", line: true }] : []),
        { name: "全部見る", color: "--s3", line: true, dash: true },
        { name: "37%ルール", color: "--s4", line: true, dash: true },
        { name: "最適停止", color: "--ink", line: true, dash: true },
      ]);

      strip.set({ ...example, p, opt });
      legend($("sat-strip-legend"), [
        { name: "候補の本当の値", color: "--axis" },
        ...(p.noise > 0 ? [{ name: "見えた値", color: "--ink-2" }] : []),
        { name: "願望水準", color: "--s1", line: true },
        ...(p.drop > 0 ? [{ name: "妥協する満足化のしきい値", color: "--s2", line: true }] : []),
        { name: "最適停止のしきい値", color: "--ink", line: true, dash: true },
      ]);
    }

    const run = scheduler(compute);
    $("sat-form").addEventListener("input", () => { syncOutputs($("sat-form")); run(true); });
    $("sat-form").addEventListener("change", () => run(false));
    $("sat-reseed").addEventListener("click", () => { seed = (seed * 7919 + 13) % 100003; run(false); });
    $("sat-best").addEventListener("click", () => {
      if (!last) return;
      $("sat-asp").value = last.sweep.best.a; syncOutputs($("sat-form")); run(false);
    });
    $("sat-next").addEventListener("click", () => { exampleIndex++; run(false); });
    REDRAW.satisfice = () => { render(); };
    syncOutputs($("sat-form"));
    compute(false);
  };

  /** 1回の例: 候補の棒 + しきい値 + 各戦略がどこまで見てどれを選んだか */
  function makeStrip(wrap) {
    const canvas = document.createElement("canvas");
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", "1回の探索の例");
    const tip = document.createElement("div");
    tip.className = "tip"; tip.hidden = true;
    wrap.append(canvas, tip);
    let data = null, hover = null, geo = null;
    const LANE = 18;
    function draw() {
      if (!data || !wrap.clientWidth) return;
      const { truth, seen, stops, p, opt } = data;
      const n = truth.length;
      const w = wrap.clientWidth;
      const lanes = SAT.length;
      const narrow = w < 520;
      const m = { l: narrow ? 92 : 150, r: 10, t: 10 };
      const ph = 170, h = m.t + ph + 26 + lanes * LANE + 6;
      const ctx = setupCanvas(canvas, w, h);
      ctx.clearRect(0, 0, w, h);
      const pw = w - m.l - m.r, bw = pw / n;
      const X = (k) => m.l + k * bw + bw / 2;
      const Y = (v) => m.t + ph - (Math.max(0, Math.min(100, v)) / 100) * ph;
      geo = { m, bw, n };
      const grid = css("--grid"), muted = css("--muted");
      ctx.font = FONT_NUM; ctx.fillStyle = muted; ctx.textAlign = "right"; ctx.textBaseline = "middle";
      for (const v of [0, 50, 100]) {
        ctx.strokeStyle = grid; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(m.l, Math.round(Y(v)) + 0.5); ctx.lineTo(m.l + pw, Math.round(Y(v)) + 0.5); ctx.stroke();
        ctx.fillText(v, m.l - 6, Y(v));
      }
      // 棒
      const picks = new Set(Object.values(stops).map((s) => s.pick));
      const gap = bw > 6 ? 2 : bw > 3 ? 1 : 0;
      for (let k = 0; k < n; k++) {
        ctx.fillStyle = hover === k ? css("--ink-2") : picks.has(k) ? css("--muted") : css("--axis");
        const x = m.l + k * bw + gap / 2, y = Y(truth[k]);
        const bwid = Math.max(1, bw - gap);
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x, y, bwid, Y(0) - y, [Math.min(4, bwid / 2), Math.min(4, bwid / 2), 0, 0]);
        else ctx.rect(x, y, bwid, Y(0) - y);
        ctx.fill();
        if (p.noise > 0) {
          ctx.fillStyle = css("--ink-2");
          ctx.fillRect(x, Math.round(Y(seen[k])) - 1, bwid, 2);
        }
      }
      // しきい値
      const line = (fn, c, dash, width = 2) => {
        ctx.strokeStyle = color(c); ctx.lineWidth = width; ctx.setLineDash(dash || []);
        ctx.beginPath();
        let started = false;
        for (let k = 0; k < n; k++) {
          const v = fn(k);
          if (!isFinite(v)) continue;
          const y = Y(v);
          if (!started) { ctx.moveTo(m.l + k * bw, y); started = true; } else ctx.lineTo(m.l + k * bw, y);
          ctx.lineTo(m.l + (k + 1) * bw, y);
        }
        ctx.stroke(); ctx.setLineDash([]);
      };
      line((k) => opt.thresholds[k], "--ink", [3, 3], 1.5);
      if (p.drop > 0) line((k) => p.aspiration - p.drop * k, "--s2", null);
      line(() => p.aspiration, "--s1", null);

      // レーン: どこまで見て、どれを選んだか
      const top = m.t + ph + 22;
      ctx.font = FONT_NUM; ctx.fillStyle = muted; ctx.textAlign = "center"; ctx.textBaseline = "top";
      const every = Math.ceil(n / Math.max(4, Math.floor(pw / 40)));
      for (let k = 0; k < n; k += every) ctx.fillText(k + 1, X(k), m.t + ph + 4);
      SAT.forEach((s, i) => {
        const y = top + i * LANE + LANE / 2;
        const st = stops[s.k];
        ctx.font = FONT_LABEL; ctx.fillStyle = css("--ink-2"); ctx.textAlign = "right"; ctx.textBaseline = "middle";
        const short = narrow ? { satisfice: "満足化", adaptive: "妥協", maximize: "全部見る", secretary: "37%", optimal: "最適停止" }[s.k] : s.name.replace("（理論上の目安）", "");
        ctx.fillText(short, m.l - 8, y);
        ctx.strokeStyle = color(s.color); ctx.globalAlpha = 0.45; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(m.l + 1, y); ctx.lineTo(m.l + st.looked * bw - 1, y); ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.beginPath(); ctx.arc(X(st.pick), y, 5, 0, Math.PI * 2);
        ctx.fillStyle = color(s.color); ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = css("--surface"); ctx.stroke();
      });
    }
    canvas.addEventListener("pointermove", (e) => {
      if (!geo || !data) return;
      const r = canvas.getBoundingClientRect();
      const k = Math.floor((e.clientX - r.left - geo.m.l) / geo.bw);
      if (k < 0 || k >= geo.n) { hover = null; tip.hidden = true; draw(); return; }
      hover = k; draw();
      const { truth, seen, stops, p, opt } = data;
      const who = SAT.filter((s) => stops[s.k].pick === k).map((s) => s.name.replace("（理論上の目安）", ""));
      tip.innerHTML = `<div class="tip-head">${k + 1} 番目の候補</div>` +
        `<div class="tip-row"><i style="background:${css("--axis")}"></i><span>本当の値</span><b>${f1(truth[k])}</b></div>` +
        (p.noise > 0 ? `<div class="tip-row"><i style="background:${css("--ink-2")}"></i><span>見えた値</span><b>${f1(seen[k])}</b></div>` : "") +
        `<div class="tip-row"><i></i><span>最適停止のしきい値</span><b>${isFinite(opt.thresholds[k]) ? f1(opt.thresholds[k]) : "（最後）"}</b></div>` +
        (who.length ? `<div class="tip-row"><i></i><span>ここで選んだ</span><b>${esc(who.join("・"))}</b></div>` : "");
      tip.hidden = false;
      const x = geo.m.l + (k + 0.5) * geo.bw;
      const tw = tip.offsetWidth;
      tip.style.left = (x + 14 + tw < wrap.clientWidth ? x + 14 : Math.max(0, x - 14 - tw)) + "px";
      tip.style.top = "8px";
    });
    canvas.addEventListener("pointerleave", () => { hover = null; tip.hidden = true; draw(); });
    new ResizeObserver(draw).observe(wrap);
    return { set(d) { data = d; draw(); }, draw };
  }

  // ============================================================ 2×2ゲーム
  INIT.matrix = function () {
    const preset = $("mx-preset");
    preset.innerHTML = Object.entries(S.GAMES).map(([k, g]) => `<option value="${k}">${g.label}</option>`).join("");
    let game = null, seed = 3, last = null;
    const ts = new Chart($("mx-ts"), { height: 250, ariaLabel: "確率の時間変化" });
    const planeWrap = $("mx-plane");
    const planeCanvas = document.createElement("canvas");
    planeCanvas.setAttribute("role", "img");
    planeCanvas.setAttribute("aria-label", "戦略の動きの図。横軸は A が上を出す確率、縦軸は B が左を出す確率");
    planeWrap.append(planeCanvas);
    let planeGeo = null;

    const DYN_NOTE = {
      replicator: "得をした手が増える進化の動き。矢印が向き、黒い線が始点からの道すじです。",
      aspiration: "得点が願望水準を超えたら同じ手を強め、下回ったら弱める。相手の得点は見ません。",
      fictitious: "相手がこれまで出した手の割合に、一番よい手を返します。",
    };
    const dyn = () => document.querySelector('input[name="mx-dyn"]:checked').value;

    function loadPreset() {
      const g = S.GAMES[preset.value];
      game = { ...g, a: g.a.map((r) => r.slice()), b: g.b.map((r) => r.slice()) };
      $("mx-note").textContent = g.note;
      buildTable();
    }

    function buildTable() {
      const t = $("mx-table");
      const { rows, cols } = game;
      let h = `<tr><th></th>${cols.map((c, j) => `<th class="colh"><span class="who">B ・ ${j ? "右" : "左"}</span>${esc(c)}</th>`).join("")}</tr>`;
      for (let i = 0; i < 2; i++) {
        h += `<tr><th class="rowh"><span class="who">A ・ ${i ? "下" : "上"}</span>${esc(rows[i])}</th>`;
        for (let j = 0; j < 2; j++) {
          h += `<td><div class="cell" id="mx-c${i}${j}"><div class="badges"></div>` +
            `<input type="number" step="any" class="pa" id="mx-a${i}${j}" value="${game.a[i][j]}" aria-label="${esc(rows[i])}・${esc(cols[j])} のときの A の得点">` +
            `<span class="comma">,</span>` +
            `<input type="number" step="any" class="pb" id="mx-b${i}${j}" value="${game.b[i][j]}" aria-label="${esc(rows[i])}・${esc(cols[j])} のときの B の得点"></div></td>`;
        }
        h += "</tr>";
      }
      t.innerHTML = h;
    }
    $("mx-table").addEventListener("input", (e) => {
      const m = /^mx-([ab])(\d)(\d)$/.exec(e.target.id);
      if (!m || e.target.value === "" || isNaN(+e.target.value)) return;
      game[m[1]][+m[2]][+m[3]] = +e.target.value;
      run(true);
    });

    function compute() {
      const an = S.analyze2x2(game);
      const p0 = num("mx-p0"), q0 = num("mx-q0");
      const d = dyn();
      let path, counts = null, dt = null;
      const flows = [];
      if (d === "replicator") {
        dt = 0.02;
        path = S.replicatorPath(game, p0, q0, 1500, dt);
        for (const sp of [0.1, 0.5, 0.9]) for (const sq of [0.1, 0.5, 0.9]) flows.push(S.replicatorPath(game, sp, sq, 900, 0.03));
      } else if (d === "aspiration") {
        const lo = (arr) => Math.min(...arr.flat()), hi = (arr) => Math.max(...arr.flat());
        const t = num("mx-asp") / 100;
        const res = S.aspirationLearning(game, {
          p0, q0, rounds: num("mx-rounds"), rate: num("mx-rate"), habit: num("mx-habit"), seed,
          aspA: lo(game.a) + t * (hi(game.a) - lo(game.a)), aspB: lo(game.b) + t * (hi(game.b) - lo(game.b)),
        });
        path = res.path; counts = res.counts;
      } else {
        const res = S.fictitiousPlay(game, { p0, q0, rounds: num("mx-rounds"), seed });
        path = res.path; counts = res.counts;
      }
      last = { an, path, counts, flows, d, dt, p0, q0 };
      render();
    }

    function cellName(i, j) { return `（${game.rows[i]}, ${game.cols[j]}）`; }

    function render() {
      if (!last) return;
      const { an, path, counts, d, dt } = last;
      // 表の飾り
      const total = counts ? counts.flat().reduce((s, v) => s + v, 0) : 0;
      for (let i = 0; i < 2; i++)
        for (let j = 0; j < 2; j++) {
          const isNE = an.nash.some(([a, b]) => a === i && b === j);
          const isPO = an.pareto.some(([a, b]) => a === i && b === j);
          const cell = $(`mx-c${i}${j}`);
          cell.classList.toggle("ne", isNE);
          $(`mx-a${i}${j}`).classList.toggle("br", an.rowBR[j].includes(i));
          $(`mx-b${i}${j}`).classList.toggle("br", an.colBR[i].includes(j));
          cell.querySelector(".badges").innerHTML =
            (isNE ? '<span class="badge ne">均衡</span>' : "") + (isPO ? '<span class="badge po">パレート</span>' : "") +
            (counts && total ? `<span class="badge fr" title="最後の2割で、この組み合わせになった割合">${pct(counts[i][j] / total)}</span>` : "");
        }

      // 見出し
      const ne = an.nash.map(([i, j]) => cellName(i, j));
      let head;
      const notPO = an.nash.filter(([i, j]) => !an.pareto.some(([a, b]) => a === i && b === j));
      if (an.nash.length === 0) head = "純粋戦略のナッシュ均衡はありません";
      else if (an.nash.length === 1 && notPO.length) {
        const [i, j] = notPO[0];
        const better = [[0, 0], [0, 1], [1, 0], [1, 1]].find(([k, l]) => game.a[k][l] > game.a[i][j] && game.b[k][l] > game.b[i][j]);
        head = `均衡は${ne[0]}。でも${better ? cellName(...better) : "ほかの組み合わせ"}のほうが2人とも得です`;
      } else if (an.nash.length === 1) head = `均衡は${ne[0]}の1つだけ`;
      else head = `均衡が ${an.nash.length} つ：${ne.join("と")}`;
      $("mx-head").textContent = head;

      const body = [];
      if (an.dominant.row != null) body.push(`A にとって「${game.rows[an.dominant.row]}」は、相手が何を出しても得な支配戦略です。`);
      if (an.dominant.col != null) body.push(`B にとって「${game.cols[an.dominant.col]}」は支配戦略です。`);
      if (an.mixed) body.push(`混合戦略の均衡: A は上を ${pct(an.mixed.p)}、B は左を ${pct(an.mixed.q)} の確率で出す（期待得点 A ${f2(an.mixed.payA)}、B ${f2(an.mixed.payB)}）。`);
      const [pe, qe] = path[path.length - 1];
      const corner = (v) => (v > 0.95 ? 0 : v < 0.05 ? 1 : null);
      const ci = corner(pe), cj = corner(qe);
      const label = { replicator: "レプリケーター動態", aspiration: "満足化学習", fictitious: "仮想プレイ" }[d];
      if (d !== "replicator" && counts && total) {
        let bi = 0, bj = 0;
        for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) if (counts[i][j] > counts[bi][bj]) { bi = i; bj = j; }
        body.push(`${label}では、最後の2割でいちばん多かったのは${cellName(bi, bj)}（${pct(counts[bi][bj] / total)}）。`);
      } else if (ci != null && cj != null) body.push(`${label}では、始点から${cellName(ci, cj)}に落ちつきます。`);
      else if (an.mixed) body.push(`${label}では、混合均衡のまわりを回りつづけます。`);
      $("mx-body").textContent = body.join("");
      $("mx-dyn-note").textContent = DYN_NOTE[d];
      document.querySelectorAll("#mx-form [data-show]").forEach((el) => { el.hidden = !el.dataset.show.split(" ").includes(d); });

      drawPlane();

      // 時系列
      const stepN = Math.max(1, Math.ceil(path.length / 500));
      const xs = [], ps = [], qs = [];
      for (let k = 0; k < path.length; k += stepN) { xs.push(dt ? +(k * dt).toFixed(3) : k); ps.push(path[k][0]); qs.push(path[k][1]); }
      ts.set({
        xs, yDomain: [0, 1], xLabel: dt ? "時間" : "ラウンド",
        yFmt: (v) => v.toFixed(1),
        series: [
          { name: `A が「${game.rows[0]}」を出す確率`, color: "--s1", ys: ps },
          { name: `B が「${game.cols[0]}」を出す確率`, color: "--s2", ys: qs },
        ],
        tooltip: (i) => [[`A「${game.rows[0]}」`, f2(ps[i]), "--s1"], [`B「${game.cols[0]}」`, f2(qs[i]), "--s2"]],
        tipHead: (i) => `${dt ? "時間" : "ラウンド"} ${xs[i]}`,
      });
      $("mx-ts-sub").textContent = d === "fictitious" ? "実際に出した手の割合" : "上を出す確率・左を出す確率";
      legend($("mx-ts-legend"), [
        { name: `A が「${game.rows[0]}」を出す確率`, color: "--s1", line: true },
        { name: `B が「${game.cols[0]}」を出す確率`, color: "--s2", line: true },
      ]);
      legend($("mx-plane-legend"), [
        { name: "道すじ", color: "--ink", line: true },
        ...(d === "replicator" ? [{ name: "ほかの始点からの流れ", color: "--axis", line: true }] : []),
        { name: "ナッシュ均衡", color: "--accent" },
      ]);
      $("mx-plane-sub").textContent = "横 = A が上を出す確率、縦 = B が左を出す確率";
    }

    function drawPlane() {
      if (!last || !planeWrap.clientWidth) return;
      const { an, path, flows } = last;
      const size = Math.min(planeWrap.clientWidth, 440);
      const m = { l: 74, r: 14, t: 26, b: 52 };
      const side = Math.max(120, size - m.l - m.r);
      const w = m.l + side + m.r, h = m.t + side + m.b;
      const ctx = setupCanvas(planeCanvas, w, h);
      const X = (p) => m.l + p * side, Y = (q) => m.t + (1 - q) * side;
      planeGeo = { m, side };
      ctx.clearRect(0, 0, w, h);
      const grid = css("--grid"), axis = css("--axis"), muted = css("--muted"), ink = css("--ink"), surf = css("--surface");
      ctx.fillStyle = css("--sunken"); ctx.fillRect(m.l, m.t, side, side);
      ctx.strokeStyle = grid; ctx.lineWidth = 1;
      for (let k = 1; k < 4; k++) {
        const v = k / 4;
        ctx.beginPath(); ctx.moveTo(X(v), m.t); ctx.lineTo(X(v), m.t + side); ctx.moveTo(m.l, Y(v)); ctx.lineTo(m.l + side, Y(v)); ctx.stroke();
      }
      ctx.strokeStyle = axis; ctx.strokeRect(m.l + 0.5, m.t + 0.5, side - 1, side - 1);
      // 目盛り
      ctx.font = FONT_NUM; ctx.fillStyle = muted;
      ctx.textAlign = "center"; ctx.textBaseline = "top";
      for (const v of [0, 0.5, 1]) ctx.fillText(v, X(v), m.t + side + 4);
      ctx.textAlign = "right"; ctx.textBaseline = "middle";
      for (const v of [0, 0.5, 1]) ctx.fillText(v, m.l - 6, Y(v));
      // 軸の名前
      ctx.font = FONT_LABEL; ctx.fillStyle = css("--ink-2");
      ctx.textAlign = "center"; ctx.textBaseline = "top";
      ctx.fillText(`A が「${game.rows[0]}」を出す確率 →`, m.l + side / 2, m.t + side + 22);
      ctx.save(); ctx.translate(16, m.t + side / 2); ctx.rotate(-Math.PI / 2); ctx.textBaseline = "top";
      ctx.fillText(`B が「${game.cols[0]}」を出す確率 →`, 0, 0); ctx.restore();
      // 角の名前
      ctx.font = FONT_LABEL; ctx.fillStyle = muted; ctx.textBaseline = "bottom";
      ctx.textAlign = "left"; ctx.fillText(`${game.rows[1]}・${game.cols[0]}`, m.l, m.t - 4);
      ctx.textAlign = "right"; ctx.fillText(`${game.rows[0]}・${game.cols[0]}`, m.l + side, m.t - 4);

      // 矢印（レプリケーター動態の向き）
      ctx.strokeStyle = axis; ctx.fillStyle = axis; ctx.lineWidth = 1.2;
      const G = 9;
      let maxLen = 1e-9;
      const vec = [];
      for (let a = 0; a < G; a++) for (let b = 0; b < G; b++) {
        const p = (a + 0.5) / G, q = (b + 0.5) / G;
        const [dp, dq] = S.replicatorField(game, p, q);
        const len = Math.hypot(dp, dq);
        maxLen = Math.max(maxLen, len);
        vec.push([p, q, dp, dq, len]);
      }
      const cellPx = side / G;
      for (const [p, q, dp, dq, len] of vec) {
        if (len < 1e-9) continue;
        const L = cellPx * 0.42 * Math.sqrt(len / maxLen);
        const ux = dp / len, uy = -dq / len;
        const x0 = X(p) - ux * L / 2, y0 = Y(q) - uy * L / 2, x1 = X(p) + ux * L / 2, y1 = Y(q) + uy * L / 2;
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
        const ah = Math.min(5, L * 0.5);
        ctx.beginPath(); ctx.moveTo(x1, y1);
        ctx.lineTo(x1 - ux * ah - uy * ah * 0.6, y1 - uy * ah + ux * ah * 0.6);
        ctx.lineTo(x1 - ux * ah + uy * ah * 0.6, y1 - uy * ah - ux * ah * 0.6);
        ctx.closePath(); ctx.fill();
      }
      // 流れ
      ctx.save(); ctx.beginPath(); ctx.rect(m.l, m.t, side, side); ctx.clip();
      ctx.strokeStyle = axis; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.9;
      for (const fl of flows) {
        ctx.beginPath();
        fl.forEach(([p, q], k) => (k ? ctx.lineTo(X(p), Y(q)) : ctx.moveTo(X(p), Y(q))));
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      // 道すじ
      ctx.strokeStyle = ink; ctx.lineWidth = 2; ctx.lineJoin = "round";
      ctx.beginPath();
      path.forEach(([p, q], k) => (k ? ctx.lineTo(X(p), Y(q)) : ctx.moveTo(X(p), Y(q))));
      ctx.stroke();
      ctx.restore();
      // 均衡
      const acc = css("--accent");
      for (const [i, j] of an.nash) {
        ctx.beginPath(); ctx.arc(X(i === 0 ? 1 : 0), Y(j === 0 ? 1 : 0), 7, 0, Math.PI * 2);
        ctx.fillStyle = acc; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = surf; ctx.stroke();
      }
      if (an.mixed) {
        ctx.beginPath(); ctx.arc(X(an.mixed.p), Y(an.mixed.q), 6, 0, Math.PI * 2);
        ctx.fillStyle = surf; ctx.fill(); ctx.lineWidth = 2.5; ctx.strokeStyle = acc; ctx.stroke();
      }
      // 始点と終点
      const [ps, qs] = path[0], [pe, qe] = path[path.length - 1];
      ctx.beginPath(); ctx.arc(X(ps), Y(qs), 5, 0, Math.PI * 2);
      ctx.fillStyle = surf; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = ink; ctx.stroke();
      ctx.beginPath(); ctx.arc(X(pe), Y(qe), 4, 0, Math.PI * 2); ctx.fillStyle = ink; ctx.fill();
      ctx.font = FONT_LABEL; ctx.fillStyle = ink; ctx.textBaseline = "bottom";
      ctx.textAlign = X(ps) > m.l + side - 50 ? "right" : "left";
      ctx.fillText("始点", X(ps) + (ctx.textAlign === "left" ? 8 : -8), Y(qs) - 4);
    }

    function setStart(e) {
      if (!planeGeo) return;
      const r = planeCanvas.getBoundingClientRect();
      const { m, side } = planeGeo;
      const p = (e.clientX - r.left - m.l) / side, q = 1 - (e.clientY - r.top - m.t) / side;
      if (p < -0.05 || p > 1.05 || q < -0.05 || q > 1.05) return;
      $("mx-p0").value = Math.min(0.99, Math.max(0.01, p)).toFixed(2);
      $("mx-q0").value = Math.min(0.99, Math.max(0.01, q)).toFixed(2);
      syncOutputs($("mx-form"));
      run(true);
    }
    let dragging = false;
    planeCanvas.addEventListener("pointerdown", (e) => { dragging = true; planeCanvas.setPointerCapture(e.pointerId); setStart(e); });
    planeCanvas.addEventListener("pointermove", (e) => { if (dragging) setStart(e); });
    planeCanvas.addEventListener("pointerup", () => { dragging = false; });
    new ResizeObserver(drawPlane).observe(planeWrap);

    const run = scheduler(compute);
    preset.addEventListener("change", () => { loadPreset(); run(false); });
    $("mx-form").addEventListener("input", (e) => { if (e.target !== preset) { syncOutputs($("mx-form")); run(true); } });
    $("mx-reseed").addEventListener("click", () => { seed = (seed * 7919 + 13) % 100003; run(false); });
    REDRAW.matrix = render;
    loadPreset();
    syncOutputs($("mx-form"));
    compute();
  };

  // ============================================================ くり返し囚人のジレンマ
  INIT.ipd = function () {
    const SLOT = Object.fromEntries(S.IPD_STRATEGIES.map((s, i) => [s.id, `--s${i + 1}`]));
    $("ipd-strats").innerHTML = S.IPD_STRATEGIES.map((s) =>
      `<label class="check" title="${esc(s.desc)}"><input type="checkbox" id="ipd-on-${s.id}" value="${s.id}" checked>` +
      `<span><span class="name"><span class="sw" style="background:var(${SLOT[s.id]})"></span><b>${s.name}</b></span><span class="hint">${s.desc}</span></span></label>`).join("");
    let seed = 11, last = null;
    const evo = new Chart($("ipd-evo"), { height: 270, ariaLabel: "戦略の割合の進化" });

    function compute() {
      const P = { T: num("ipd-T"), R: num("ipd-R"), P: num("ipd-P"), S: num("ipd-S") };
      const warn = [];
      if (!(P.T > P.R && P.R > P.P && P.P > P.S)) warn.push("T > R > P > S でないと、囚人のジレンマではありません。");
      if (!(2 * P.R > P.T + P.S)) warn.push("2R > T + S でないと、交互に裏切りあうほうが得になります。");
      $("ipd-warn").hidden = !warn.length;
      $("ipd-warn").textContent = warn.join(" ");
      const ids = S.IPD_STRATEGIES.map((s) => s.id).filter((id) => $("ipd-on-" + id).checked);
      if (ids.length < 2) {
        $("ipd-head").textContent = "戦略を2つ以上えらんでください";
        $("ipd-body").textContent = "左の「参加する戦略」で、チェックを入れた戦略どうしが対戦します。";
        return;
      }
      const res = S.tournament({
        ids, payoff: P, rounds: num("ipd-rounds"), noise: num("ipd-noise"), reps: 10,
        aspiration: num("ipd-asp"), habit: num("ipd-habit"), seed,
      });
      const hist = S.evolve(res.M, ids.map(() => 1 / ids.length), num("ipd-gens"));
      last = { P, res, hist, ids };
      render();
    }

    function render() {
      if (!last) return;
      const { P, res, hist } = last;
      const k = res.strategies.length;
      const order = res.scores.map((s, i) => i).sort((a, b) => res.scores[b] - res.scores[a]);
      const final = hist[hist.length - 1];
      const evoWin = final.indexOf(Math.max(...final));
      const top = res.strategies[order[0]];
      $("ipd-head").textContent = `大会の優勝は「${top.name}」。進化で最後に一番多いのは「${res.strategies[evoWin].name}」（${pct(final[evoWin])}）`;
      const body = [];
      const iSat = res.strategies.findIndex((s) => s.id === "sat");
      if (iSat >= 0) {
        const A = num("ipd-asp");
        const rank = order.indexOf(iSat) + 1;
        let why;
        if (num("ipd-habit") > 0) why = "願望水準が得点に合わせて動くので、はじめの値だけでは決まりません。";
        else if (A <= P.S) why = `願望水準 ${f1(A)} は S 以下なので、どんな結果にも満足して最初の手（協力）をつづけます。`;
        else if (A <= P.P) why = `願望水準 ${f1(A)} は P 以下なので、裏切りあいにも満足してしまい、そこから抜け出せません。`;
        else if (A <= P.R) why = `願望水準 ${f1(A)} は P と R の間なので、パブロフと同じ動きです。`;
        else if (A <= P.T) why = `願望水準 ${f1(A)} は R より高いので、協力しあっていても満足できずに手を変えてしまいます。`;
        else why = `願望水準 ${f1(A)} は T より高いので、何をしても満足できず、毎回手を変えます。`;
        body.push(`満足化は ${k} 戦略中 ${rank} 位（平均 ${f2(res.scores[iSat])}）。${why}`);
      }
      if (num("ipd-noise") > 0) body.push(`手のミスが ${pct(num("ipd-noise"), 1)} あるので、ミスから立ち直れるかどうかで差がつきます。`);
      $("ipd-body").textContent = body.join("");

      // 順位表
      const maxS = Math.max(...res.scores, 1e-9);
      $("ipd-rank").tBodies[0].innerHTML = order.map((i, r) => {
        const s = res.strategies[i];
        const coop = res.coop[i].reduce((a, b) => a + b, 0) / k;
        return `<tr${r === 0 ? ' class="best"' : ""}><td><span class="name"><span class="num" style="color:var(--muted);width:1.4em">${r + 1}</span><span class="sw" style="background:var(${SLOT[s.id]})"></span>${s.name}</span></td>` +
          `<td class="num">${f2(res.scores[i])}</td><td class="bar-cell"><div class="bar" style="width:${(Math.max(0, res.scores[i]) / maxS) * 100}%;background:var(${SLOT[s.id]})"></div></td>` +
          `<td class="num">${pct(coop)}</td></tr>`;
      }).join("");

      // 進化
      const xs = hist.map((_, g) => g);
      const series = res.strategies.map((s, i) => ({ name: s.name, color: SLOT[s.id], ys: hist.map((x) => x[i]) }));
      evo.set({
        xs, series, stacked: true, yDomain: [0, 1], xLabel: "世代", yFmt: (v) => pct(v),
        tipHead: (g) => `${g} 世代`,
        tooltip: (g) => res.strategies.map((s, i) => [s.name, pct(hist[g][i], 1), SLOT[s.id]]).sort((a, b) => parseFloat(b[1]) - parseFloat(a[1])),
      });
      legend($("ipd-evo-legend"), res.strategies.map((s) => ({ name: s.name, color: SLOT[s.id] })));

      // 対戦表（濃さ = 得点）
      let lo = Infinity, hi = -Infinity;
      for (const row of res.M) for (const v of row) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
      const loC = parseColor(css("--seq-lo")), hiC = parseColor(css("--seq-hi"));
      let h = `<thead><tr><th>行 ＼ 列</th>${res.strategies.map((s) => `<th class="rot">${s.name}</th>`).join("")}</tr></thead><tbody>`;
      res.strategies.forEach((s, i) => {
        h += `<tr><td><span class="name"><span class="sw" style="background:var(${SLOT[s.id]})"></span>${s.name}</span></td>`;
        res.M[i].forEach((v) => {
          const t = hi > lo ? (v - lo) / (hi - lo) : 0.5;
          const c = loC.map((x, z) => Math.round(x + (hiC[z] - x) * t));
          h += `<td class="hv" style="background:rgb(${c.join(",")});color:${t > 0.55 ? "var(--seq-mid-ink)" : "var(--ink)"}">${f2(v)}</td>`;
        });
        h += "</tr>";
      });
      $("ipd-heat").innerHTML = h + "</tbody>";
    }

    const run = scheduler(compute);
    $("ipd-form").addEventListener("input", () => { syncOutputs($("ipd-form")); run(true); });
    $("ipd-reseed").addEventListener("click", () => { seed = (seed * 7919 + 13) % 100003; run(false); });
    REDRAW.ipd = render;
    syncOutputs($("ipd-form"));
    compute();
  };

  function parseColor(c) {
    c = c.trim();
    if (c.startsWith("#")) {
      const h = c.length === 4 ? c.slice(1).split("").map((x) => x + x).join("") : c.slice(1);
      return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    }
    const m = c.match(/\d+(\.\d+)?/g);
    return m ? m.slice(0, 3).map(Number) : [128, 128, 128];
  }

  // ============================================================ 空間ゲーム
  INIT.spatial = function () {
    const canvas = $("sp-canvas");
    const ctx = canvas.getContext("2d");
    const chart = new Chart($("sp-chart"), { height: 230, ariaLabel: "協力者の割合の推移" });
    let L, g, prev, pay, gen, hist, seed = 5, playing = true, acc = 0, lastT = 0, raf = 0, lastChart = 0, flips = 0;
    let rng = S.rng(seed);
    let colors = null;
    const rule = () => document.querySelector('input[name="sp-rule"]:checked').value;
    const NOTE = {
      best: "周り8人と自分の中で、一番得点が高い人の戦略をまねます（Nowak–May）。",
      fermi: "ランダムな隣を1人見て、自分より得点が高いほど高い確率でまねます。K が大きいほど気まぐれ。",
      aspire: "周りは見ない。1回あたりの得点が願望水準より低いと、半分の確率で手を変えます。",
    };

    function readColors() {
      colors = { cc: parseColor(css("--s1")), dd: parseColor(css("--s8")), dc: parseColor(css("--s3")), cd: parseColor(css("--s4")) };
    }
    function reset() {
      L = num("sp-L");
      rng = S.rng(seed);
      g = S.spatialInit(L, $("sp-init").value, num("sp-c0"), seed);
      prev = g.slice();
      pay = null; gen = 0; flips = 0;
      hist = [coopFrac()];
      canvas.width = L; canvas.height = L;
      drawGrid(); updateStats(true);
    }
    function coopFrac() { let c = 0; for (let i = 0; i < g.length; i++) c += g[i]; return c / g.length; }
    function params() {
      return { b: num("sp-b"), self: $("sp-self").checked, rule: rule(), K: num("sp-K"), aspiration: num("sp-asp"), mutation: num("sp-mu") };
    }
    function step() {
      const out = S.spatialStep(g, L, params(), rng, pay);
      prev = g; g = out.next; pay = out.pay; gen++;
      flips = 0;
      for (let i = 0; i < g.length; i++) if (g[i] !== prev[i]) flips++;
      hist.push(coopFrac());
      if (hist.length > 2000) hist.splice(0, hist.length - 2000);
    }
    function drawGrid() {
      if (!colors) readColors();
      const img = ctx.createImageData(L, L);
      const d = img.data;
      for (let i = 0; i < g.length; i++) {
        const c = g[i] ? (prev[i] ? colors.cc : colors.dc) : prev[i] ? colors.cd : colors.dd;
        d[i * 4] = c[0]; d[i * 4 + 1] = c[1]; d[i * 4 + 2] = c[2]; d[i * 4 + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
    }
    function updateStats(force) {
      const c = hist[hist.length - 1];
      $("sp-gen").textContent = gen;
      $("sp-coop").textContent = pct(c, 1);
      $("sp-flip").textContent = gen ? pct(flips / g.length, 1) : "–";
      $("sp-sub").textContent = `${L} × ${L} マス・端は反対側とつながっています`;
      const now = performance.now();
      if (!force && now - lastChart < 120) return;
      lastChart = now;
      const start = gen - hist.length + 1;
      chart.set({
        xs: hist.map((_, i) => start + i), series: [{ name: "協力者の割合", color: "--s1", ys: hist, area: true }],
        yDomain: [0, 1], xLabel: "世代", yFmt: (v) => pct(v),
        tipHead: (i) => `${start + i} 世代`, tooltip: (i) => [["協力者", pct(hist[i], 1), "--s1"]],
      });
      // 見出し
      const b = num("sp-b"), r = rule();
      let head;
      if (c >= 0.999) head = "全員が協力しています";
      else if (c <= 0.001) head = "協力者はいなくなりました";
      else head = `協力者が ${pct(c)} 生きのこっています`;
      if (gen === 0) head = "はじめの配置です。再生すると動きだします";
      $("sp-head").textContent = head;
      let body = "";
      if (r === "best" && $("sp-self").checked) {
        body = b < 1.8 ? `b = ${f2(b)} は小さめ。協力者のかたまりは裏切り者に負けず、広がるか、動かない形で固まります。`
          : b < 2 ? `b = ${f2(b)} は 1.8〜2.0 の間。協力と裏切りのかたまりが、いつまでも形を変えながら共存します（割合はおよそ 3 割前後）。`
          : `b = ${f2(b)} は 2 以上。裏切り者が強く、協力者は大きなかたまりでないと生きのこれません。`;
      } else if (r === "aspire") {
        body = `願望水準 ${f2(num("sp-asp"))}。協力者どうしの 1 回の得点は 1、裏切り者が協力者から取ると ${f2(b)} です。願望水準が 1 より高いと、協力しあっていても満足できません。`;
      } else if (r === "fermi") {
        body = `確率でまねるので、ゆっくりと形が変わります。K が小さいほど、得点差に正直にまねます。`;
      } else body = "自分とは対戦しない設定です。周り8人とだけ遊びます。";
      $("sp-body").textContent = body;
    }
    function loop(t) {
      raf = 0;
      if (!playing || $("panel-spatial").hidden || document.hidden) return;
      const dt = lastT ? Math.min(250, t - lastT) : 0;
      lastT = t;
      acc += (dt / 1000) * num("sp-speed");
      let n = 0;
      while (acc >= 1 && n < 8) { step(); acc -= 1; n++; }
      if (acc > 8) acc = 0;
      if (n) { drawGrid(); updateStats(); }
      raf = requestAnimationFrame(loop);
    }
    function start() { if (!raf && playing) { lastT = 0; raf = requestAnimationFrame(loop); } }
    function setPlaying(v) {
      playing = v;
      $("sp-play").textContent = v ? "一時停止" : "再生";
      if (v) start(); else updateStats(true);
    }

    // 塗る
    let paintVal = null;
    function paint(e) {
      const r = canvas.getBoundingClientRect();
      const x = Math.floor(((e.clientX - r.left) / r.width) * L), y = Math.floor(((e.clientY - r.top) / r.height) * L);
      if (x < 0 || y < 0 || x >= L || y >= L) return;
      const i = y * L + x;
      if (paintVal == null) paintVal = 1 - g[i];
      g[i] = paintVal; prev[i] = paintVal;
      hist[hist.length - 1] = coopFrac();
      drawGrid();
    }
    canvas.addEventListener("pointerdown", (e) => { paintVal = null; canvas.setPointerCapture(e.pointerId); paint(e); });
    canvas.addEventListener("pointermove", (e) => { if (e.buttons) paint(e); });
    canvas.addEventListener("pointerup", () => { paintVal = null; updateStats(true); });

    $("sp-play").addEventListener("click", () => setPlaying(!playing));
    $("sp-step").addEventListener("click", () => { setPlaying(false); step(); drawGrid(); updateStats(true); });
    $("sp-reset").addEventListener("click", () => { seed = (seed * 7919 + 13) % 100003; reset(); });
    $("sp-form").addEventListener("input", (e) => {
      syncOutputs($("sp-form"));
      const id = e.target.id;
      if (id === "sp-L" || id === "sp-init" || id === "sp-c0") reset();
      showControls();
      if (!playing) updateStats(true);
    });
    function showControls() {
      const r = rule();
      document.querySelectorAll("#sp-form [data-show]").forEach((el) => { el.hidden = el.dataset.show !== r; });
      document.querySelectorAll("#sp-form [data-init]").forEach((el) => { el.hidden = el.dataset.init !== $("sp-init").value; });
      $("sp-rule-note").textContent = NOTE[r];
    }
    document.addEventListener("visibilitychange", () => { if (!document.hidden) start(); });
    ON_SHOW.spatial = start;
    REDRAW.spatial = () => { readColors(); drawGrid(); updateStats(true); };
    syncOutputs($("sp-form"));
    showControls();
    reset();
  };

  // ------------------------------------------------------------ テーマが変わったら描き直す
  const redrawAll = () => { for (const t of TABS) if (inited[t] && REDRAW[t]) REDRAW[t](); };
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", redrawAll);
  new MutationObserver(redrawAll).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  showTab(location.hash.slice(1));
})();
