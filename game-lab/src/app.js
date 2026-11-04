// 満足化・ゲーム理論ラボ: 画面の動き
(function () {
  "use strict";
  const Sim = window.GameLabSim;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : "—");
  const pct = (v, d = 0) => (Number.isFinite(v) ? (v * 100).toFixed(d) + "%" : "—");
  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  // 変更を1フレームにまとめて再計算する
  function scheduler(fn) {
    let queued = false;
    return () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; fn(); });
    };
  }

  function seg(id, onChange) {
    const el = $(id);
    el.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-v]");
      if (!b) return;
      for (const x of el.querySelectorAll("button")) x.setAttribute("aria-pressed", String(x === b));
      onChange(b.dataset.v);
    });
    return () => el.querySelector('button[aria-pressed="true"]').dataset.v;
  }
  function range(id, format, onChange) {
    const el = $(id), out = $(id + "-out");
    const show = () => { if (out) out.textContent = format(+el.value); };
    el.addEventListener("input", () => { show(); onChange(); });
    show();
    return () => +el.value;
  }
  function legend(id, items) {
    const ul = $(id);
    ul.replaceChildren(...items.map((it) => {
      const li = document.createElement("li");
      const k = document.createElement("span");
      k.className = "key" + (it.box ? " box" : "");
      k.style.background = it.color;
      if (it.dash) k.style.background = `repeating-linear-gradient(90deg, ${it.color} 0 4px, transparent 4px 7px)`;
      if (it.dot) { k.className = "key box"; k.style.borderRadius = "50%"; k.style.width = k.style.height = "10px"; }
      li.append(k, document.createTextNode(it.name));
      return li;
    }));
  }

  // =====================================================================
  // グラフ部品（SVG）
  // =====================================================================
  function niceTicks(min, max, count) {
    const span = max - min || 1;
    const step0 = span / Math.max(1, count);
    const mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) || 10 * mag;
    const out = [];
    for (let v = Math.ceil(min / step - 1e-9) * step; v <= max + 1e-9; v += step) out.push(+v.toFixed(10));
    return out;
  }

  function tipEl(chart) {
    let tip = chart.querySelector(".tip");
    if (!tip) { tip = document.createElement("div"); tip.className = "tip"; tip.hidden = true; chart.appendChild(tip); }
    return tip;
  }
  function fillTip(tip, head, rows) {
    const h = document.createElement("div");
    h.className = "t-head"; h.textContent = head;
    const items = rows.map((r) => {
      const d = document.createElement("div"); d.className = "t-row";
      const k = document.createElement("i"); k.className = "key"; k.style.background = r.color;
      const b = document.createElement("b"); b.textContent = r.value;
      const s = document.createElement("span"); s.textContent = r.name;
      d.append(k, b, s);
      return d;
    });
    tip.replaceChildren(h, ...items);
  }
  function placeTip(chart, tip, px, py) {
    tip.hidden = false;
    const cw = chart.clientWidth, tw = tip.offsetWidth, th = tip.offsetHeight;
    let left = px + 14;
    if (left + tw > cw) left = px - tw - 14;
    tip.style.left = Math.max(0, left) + "px";
    tip.style.top = Math.max(0, py - th / 2) + "px";
  }

  const charts = new Set();
  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver((entries) => {
    for (const e of entries) {
      const el = e.target;
      if (el._render && Math.abs((el._w || 0) - el.clientWidth) > 2) el._render();
    }
  }) : null;
  function register(el, render) {
    el._render = () => { el._w = el.clientWidth; render(); };
    if (!charts.has(el)) { charts.add(el); if (ro) ro.observe(el); }
    el._render();
  }

  // 折れ線グラフ: 十字線とツールチップつき
  function lineChart(el, o) {
    register(el, () => drawLine(el, o));
  }
  function drawLine(el, o) {
    const W = Math.max(280, el.clientWidth || 600), H = o.height || 260;
    const m = { l: 48, r: o.right || 18, t: 12, b: 40 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const X = (v) => m.l + ((v - o.x.min) / (o.x.max - o.x.min || 1)) * iw;
    const Y = (v) => m.t + ih - ((v - o.y.min) / (o.y.max - o.y.min || 1)) * ih;
    const xt = o.x.ticks || niceTicks(o.x.min, o.x.max, Math.max(3, Math.floor(iw / 80)));
    const yt = o.y.ticks || niceTicks(o.y.min, o.y.max, 5);
    const xf = o.x.fmt || ((v) => v), yf = o.y.fmt || ((v) => v);
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.label || "")}">`;
    s += `<g class="axis">`;
    for (const v of yt) s += `<line class="gridline" x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${m.l - 8}" y="${Y(v) + 4}" text-anchor="end">${esc(yf(v))}</text>`;
    for (const v of xt) s += `<text x="${X(v)}" y="${H - m.b + 16}" text-anchor="middle">${esc(xf(v))}</text>`;
    s += `<line class="baseline" x1="${m.l}" x2="${W - m.r}" y1="${m.t + ih}" y2="${m.t + ih}"/>`;
    s += `</g>`;
    if (o.x.title) s += `<text class="axis-title" x="${m.l + iw / 2}" y="${H - 4}" text-anchor="middle">${esc(o.x.title)}</text>`;
    if (o.y.title) s += `<text class="axis-title" transform="translate(12 ${m.t + ih / 2}) rotate(-90)" text-anchor="middle">${esc(o.y.title)}</text>`;
    for (const h of o.hlines || []) {
      if (!Number.isFinite(h.y)) continue;
      s += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(h.y)}" y2="${Y(h.y)}" style="stroke:${h.color}" stroke-width="2" stroke-dasharray="6 4"/>`;
    }
    for (const sr of o.series) {
      const d = sr.pts.map((p, i) => (i ? "L" : "M") + X(p[0]).toFixed(1) + " " + Y(p[1]).toFixed(1)).join("");
      s += `<path d="${d}" fill="none" style="stroke:${sr.color}" stroke-width="${sr.width || 2}" stroke-linejoin="round" stroke-linecap="round"/>`;
    }
    for (const mk of o.markers || []) {
      s += `<circle cx="${X(mk.x)}" cy="${Y(mk.y)}" r="5" style="fill:${mk.color};stroke:var(--surface)" stroke-width="2"/>`;
      if (mk.label) s += `<text class="direct" x="${X(mk.x)}" y="${Y(mk.y) - 10}" text-anchor="${X(mk.x) > W - 90 ? "end" : X(mk.x) < m.l + 60 ? "start" : "middle"}">${esc(mk.label)}</text>`;
    }
    // 右端の直接ラベル（重ならないようにずらす）
    if (o.directLabels) {
      const labs = o.series.map((sr) => ({ sr, y: Y(sr.pts[sr.pts.length - 1][1]), last: sr.pts[sr.pts.length - 1][1] }))
        .filter((l) => o.directLabels(l.sr, l.last)).sort((a, b) => a.y - b.y);
      for (let i = 1; i < labs.length; i++) if (labs[i].y - labs[i - 1].y < 14) labs[i].y = labs[i - 1].y + 14;
      for (const l of labs) s += `<text class="direct" x="${W - m.r + 6}" y="${Math.min(l.y, m.t + ih) + 4}">${esc(l.sr.name)}</text>`;
    }
    s += `<g class="hover" visibility="hidden"><line class="cross" y1="${m.t}" y2="${m.t + ih}"/>`;
    for (const sr of o.series) s += `<circle r="4" style="fill:${sr.color};stroke:var(--surface)" stroke-width="2"/>`;
    s += `</g><rect class="hit" x="${m.l}" y="${m.t}" width="${iw}" height="${ih}" fill="transparent"/></svg>`;
    el.innerHTML = s;
    const tip = tipEl(el);
    const svg = el.querySelector("svg"), hover = svg.querySelector(".hover"), hit = svg.querySelector(".hit");
    const base = o.series[0].pts;
    const move = (ev) => {
      const r = svg.getBoundingClientRect();
      const px = ((ev.clientX - r.left) / r.width) * W;
      const xv = o.x.min + ((px - m.l) / iw) * (o.x.max - o.x.min);
      let lo = 0, hi = base.length - 1;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (base[mid][0] < xv) lo = mid; else hi = mid; }
      const i = Math.abs(base[lo][0] - xv) < Math.abs(base[hi][0] - xv) ? lo : hi;
      const cx = X(base[i][0]);
      hover.setAttribute("visibility", "visible");
      hover.querySelector("line").setAttribute("x1", cx);
      hover.querySelector("line").setAttribute("x2", cx);
      hover.querySelectorAll("circle").forEach((c, k) => { c.setAttribute("cx", cx); c.setAttribute("cy", Y(o.series[k].pts[i][1])); });
      const rows = o.series.map((sr) => ({ name: sr.name, color: sr.color, v: sr.pts[i][1] }));
      for (const h of o.hlines || []) if (Number.isFinite(h.y)) rows.push({ name: h.name, color: h.color, v: h.y });
      rows.sort((a, b) => b.v - a.v);
      fillTip(tip, o.tipHead ? o.tipHead(base[i][0]) : xf(base[i][0]), rows.map((rw) => ({ ...rw, value: yf(rw.v, true) })));
      placeTip(el, tip, (cx / W) * r.width, ((ev.clientY - r.top)));
    };
    hit.addEventListener("pointermove", move);
    hit.addEventListener("pointerdown", move);
    hit.addEventListener("pointerleave", () => { hover.setAttribute("visibility", "hidden"); tip.hidden = true; });
  }

  // =====================================================================
  // 1. 満足化
  // =====================================================================
  const SEARCH_COLORS = { max: "var(--s1)", sat: "var(--s2)", adapt: "var(--s3)", secretary: "var(--s4)" };
  const satState = { seed: 20261104 };
  const sat = {
    n: range("sat-n", (v) => v + " 個", () => satRun()),
    cost: range("sat-cost", (v) => v.toFixed(2) + " 点", () => satRun()),
    asp: range("sat-asp", (v) => v + " 点", () => satRun()),
    drop: range("sat-drop", (v) => v.toFixed(1) + " 点", () => satRun()),
    skip: range("sat-skip", (v) => v + "%", () => satRun()),
    dist: seg("sat-dist", () => satRun()),
    trials: seg("sat-trials", () => satRun()),
  };
  $("sat-recall").addEventListener("change", () => satRun());
  $("sat-reroll").addEventListener("click", () => { satState.seed = (Math.random() * 2 ** 31) >>> 0; satRun(); });

  const satRun = scheduler(function () {
    const cfg = {
      n: sat.n(), cost: sat.cost(), aspiration: sat.asp(), drop: sat.drop(), skipRatio: sat.skip() / 100,
      dist: sat.dist(), trials: +sat.trials(), recall: $("sat-recall").checked, seed: satState.seed,
    };
    $("sat-seed").textContent = "シード " + satState.seed;
    const lab = Sim.runSearchLab(cfg);
    renderSatTiles(lab, cfg);
    renderSatInsight(lab, cfg);
    renderSatSweep(lab, cfg);
    renderSatExample(lab, cfg);
  });

  function satWinner(lab) {
    let w = null;
    for (const s of Sim.SEARCH_STRATEGIES) {
      const r = lab.results[s.id];
      if (r && (!w || r.net > lab.results[w].net)) w = s.id;
    }
    return w;
  }

  function renderSatTiles(lab, cfg) {
    const w = satWinner(lab);
    const html = Sim.SEARCH_STRATEGIES.map((s) => {
      const r = lab.results[s.id];
      const head = `<div class="tile-head"><span class="key" style="background:${SEARCH_COLORS[s.id]}"></span>${esc(s.name)}${s.id === w ? '<span class="pill">最高</span>' : ""}</div>`;
      if (!r) return `<div class="tile">${head}<div class="big" style="color:var(--faint)">—</div><div class="meta">戻れない設定では使えません。全部見たあと、最良の候補はもう見送っています。</div><div class="desc">${esc(s.short)}</div></div>`;
      return `<div class="tile${s.id === w ? " win" : ""}">${head}
        <div class="big">${fmt(r.net)}<small>点</small></div>
        <div class="meta">平均の手取り<br>選んだ候補 <span class="num">${fmt(r.value)}</span>点 ・ 調べた数 <span class="num">${fmt(r.looked)}</span><br>最良を選べた <span class="num">${pct(r.bestRate)}</span> ・ ばらつき <span class="num">${fmt(r.p10, 0)}〜${fmt(r.p90, 0)}</span></div>
        <div class="desc">${esc(s.short)}</div></div>`;
    }).join("");
    $("sat-tiles").innerHTML = html;
  }

  function renderSatInsight(lab, cfg) {
    const w = satWinner(lab), R = lab.results, best = lab.bestAspiration;
    const name = (id) => Sim.SEARCH_STRATEGIES.find((s) => s.id === id).name;
    let t = `この条件では <b>${esc(name(w))}</b> の手取りがいちばん高く、平均 <span class="num">${fmt(R[w].net)}</span> 点でした。`;
    const diff = best.net - R.sat.net;
    t += ` 満足化の要求水準は <span class="num">${best.aspiration}</span> 点のときが最もよく（平均 <span class="num">${fmt(best.net)}</span> 点）`;
    t += diff > 0.05 ? `、いまの ${cfg.aspiration} 点より <span class="num">${fmt(diff)}</span> 点上です。` : `、いまの設定がほぼ最適です。`;
    if (R.max) {
      const gap = R.sat.net - R.max.net;
      t += ` 全部見る最大化はいつも最良を選びますが、調べるコストが毎回 <span class="num">${fmt(cfg.cost * cfg.n)}</span> 点かかるため`;
      t += gap > 0 ? `、満足化より <span class="num">${fmt(gap)}</span> 点低くなりました。` : `、それでも満足化より <span class="num">${fmt(-gap)}</span> 点高くなっています。コストを上げると逆転します。`;
    } else {
      t += ` 戻れない設定では「全部見てから選ぶ」はできません。見送りルールと満足化の差を見てください。`;
    }
    $("sat-insight").innerHTML = t;
  }

  function renderSatSweep(lab, cfg) {
    const R = lab.results;
    const ys = lab.sweep.map((s) => s.net).concat(Object.values(R).filter(Boolean).map((r) => r.net));
    let ymin = Math.min(...ys), ymax = Math.max(...ys);
    const pad = (ymax - ymin) * 0.12 || 5;
    ymin = Math.floor((ymin - pad) / 5) * 5; ymax = Math.ceil((ymax + pad) / 5) * 5;
    const hl = [];
    if (R.max) hl.push({ name: "最大化", color: SEARCH_COLORS.max, y: R.max.net });
    hl.push({ name: "妥協する満足化", color: SEARCH_COLORS.adapt, y: R.adapt.net });
    hl.push({ name: "見送りルール", color: SEARCH_COLORS.secretary, y: R.secretary.net });
    legend("sat-sweep-legend", [{ name: "満足化（要求水準ごと）", color: SEARCH_COLORS.sat }, ...hl.map((h) => ({ name: h.name, color: h.color, dash: true }))]);
    const cur = lab.sweep.reduce((a, b) => (Math.abs(b.aspiration - cfg.aspiration) < Math.abs(a.aspiration - cfg.aspiration) ? b : a));
    lineChart($("sat-sweep"), {
      label: "要求水準と平均の手取り",
      height: 270,
      x: { min: 0, max: 100, ticks: [0, 20, 40, 60, 80, 100], title: "要求水準（点）" },
      y: { min: ymin, max: ymax, title: "平均の手取り（点）", fmt: (v, tip) => (tip ? v.toFixed(1) : v) },
      series: [{ name: "満足化", color: SEARCH_COLORS.sat, pts: lab.sweep.map((s) => [s.aspiration, s.net]) }],
      hlines: hl,
      markers: [
        { x: lab.bestAspiration.aspiration, y: lab.bestAspiration.net, color: SEARCH_COLORS.sat, label: `最適 ${lab.bestAspiration.aspiration}点` },
        ...(Math.abs(cur.aspiration - lab.bestAspiration.aspiration) > 3 ? [{ x: cur.aspiration, y: cur.net, color: "var(--ink)", label: "いまの設定" }] : []),
      ],
      tipHead: (x) => `要求水準 ${x} 点`,
    });
  }

  function renderSatExample(lab, cfg) {
    const el = $("sat-example");
    legend("sat-example-legend", [
      { name: "候補の良さ", color: "var(--seq-2)", box: true },
      ...Sim.SEARCH_STRATEGIES.filter((s) => lab.example.picks[s.id]).map((s) => ({ name: s.name, color: SEARCH_COLORS[s.id] })),
    ]);
    register(el, () => {
      const vals = lab.example.values, n = vals.length;
      const W = Math.max(280, el.clientWidth || 600), H = 250;
      const m = { l: 40, r: 10, t: 64, b: 30 };
      const iw = W - m.l - m.r, ih = H - m.t - m.b;
      const bw = iw / n, gap = bw > 6 ? 2 : bw > 3 ? 1 : 0;
      const Y = (v) => m.t + ih - (v / 100) * ih;
      let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="1回分の候補と各戦略の決定"><g class="axis">`;
      for (const v of [0, 25, 50, 75, 100]) s += `<line class="gridline" x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${m.l - 6}" y="${Y(v) + 4}" text-anchor="end">${v}</text>`;
      const step = Math.ceil(n / Math.max(4, Math.floor(iw / 50)));
      for (let i = 0; i < n; i += step) s += `<text x="${m.l + (i + 0.5) * bw}" y="${H - m.b + 16}" text-anchor="middle">${i + 1}</text>`;
      s += `</g>`;
      // 見送りルールの見送りゾーン
      const skip = Math.min(n - 1, Math.max(1, Math.round(n * cfg.skipRatio)));
      s += `<rect x="${m.l}" y="${m.t}" width="${skip * bw}" height="${ih}" style="fill:var(--s4)" opacity="0.08"/>`;
      s += `<text class="lbl" x="${m.l + 4}" y="${m.t + 12}">見送りゾーン</text>`;
      const chosen = new Set(Object.values(lab.example.picks).filter(Boolean).map((p) => p.index));
      for (let i = 0; i < n; i++) {
        const x = m.l + i * bw + gap / 2, w = Math.max(1, bw - gap), y = Y(vals[i]);
        const h = m.t + ih - y, r = Math.min(4, w / 2, h);
        s += `<path d="M${x} ${m.t + ih}V${y + r}q0 ${-r} ${r} ${-r}h${w - 2 * r}q${r} 0 ${r} ${r}V${m.t + ih}Z" style="fill:var(${chosen.has(i) ? "--seq-3" : "--seq-2"})"/>`;
      }
      // 要求水準のライン
      s += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(cfg.aspiration)}" y2="${Y(cfg.aspiration)}" style="stroke:var(--s2)" stroke-width="2" stroke-dasharray="6 4"/>`;
      const endA = cfg.aspiration - cfg.drop * (n - 1);
      s += `<line x1="${m.l + bw / 2}" x2="${m.l + (n - 0.5) * bw}" y1="${Y(cfg.aspiration)}" y2="${Y(Math.max(-30, endA))}" style="stroke:var(--s3)" stroke-width="2" stroke-dasharray="2 4"/>`;
      // 各戦略の ▼
      const byIndex = {};
      for (const st of Sim.SEARCH_STRATEGIES) {
        const p = lab.example.picks[st.id];
        if (p) (byIndex[p.index] = byIndex[p.index] || []).push(st);
      }
      for (const [idx, list] of Object.entries(byIndex)) {
        const cx = m.l + (+idx + 0.5) * bw;
        list.forEach((st, k) => {
          const ty = Y(vals[idx]) - 8 - k * 13;
          s += `<path d="M${cx - 6} ${ty - 9}L${cx + 6} ${ty - 9}L${cx} ${ty}Z" style="fill:${SEARCH_COLORS[st.id]};stroke:var(--surface)" stroke-width="1.5"/>`;
        });
      }
      for (let i = 0; i < n; i++) s += `<rect class="bar-hit" data-i="${i}" x="${m.l + i * bw}" y="${m.t - 50}" width="${bw}" height="${ih + 50}" fill="transparent"/>`;
      s += `</svg>`;
      el.innerHTML = s;
      const tip = tipEl(el), svg = el.querySelector("svg");
      svg.addEventListener("pointermove", (ev) => {
        const t = ev.target.closest(".bar-hit");
        if (!t) { tip.hidden = true; return; }
        const i = +t.dataset.i;
        const rows = [{ name: "この候補の良さ", color: "var(--seq-2)", value: fmt(vals[i]) }];
        for (const st of byIndex[i] || []) {
          const p = lab.example.picks[st.id];
          rows.push({ name: `${st.name}が決定（調べた数 ${p.looked}）`, color: SEARCH_COLORS[st.id], value: fmt(vals[i] - cfg.cost * p.looked) });
        }
        fillTip(tip, `${i + 1} 番目の候補`, rows);
        const r = svg.getBoundingClientRect();
        placeTip(el, tip, ev.clientX - r.left, ev.clientY - r.top);
      });
      svg.addEventListener("pointerleave", () => { tip.hidden = true; });
    });
  }

  // =====================================================================
  // 2. 2×2 ゲーム
  // =====================================================================
  const sym = (A) => A.map((row, i) => row.map((_, j) => A[j][i]));
  const PRESETS = [
    { id: "pd", name: "囚人のジレンマ", rows: ["協力", "裏切り"], A: [[3, 0], [5, 1]],
      story: "2人とも協力すれば 3点ずつ。でも相手が何をしても、自分は裏切ったほうが得。だから2人とも裏切り、1点ずつになる。" },
    { id: "stag", name: "鹿狩り", rows: ["鹿", "うさぎ"], A: [[4, 0], [3, 3]],
      story: "2人で協力すれば鹿（4点）がとれるが、1人だけだと何もとれない。うさぎ（3点）なら1人でも確実。信頼の問題。" },
    { id: "chicken", name: "チキンゲーム", rows: ["よける", "直進"], A: [[3, 1], [4, 0]],
      story: "向かい合って車を走らせる。よけたほうは「弱虫」だが、2人とも直進すると大事故（0点）。" },
    { id: "bos", name: "行き先の調整", rows: ["映画", "野球"], A: [[3, 0], [0, 2]], B: [[2, 0], [0, 3]],
      story: "2人とも一緒に出かけたいが、行の人は映画、列の人は野球のほうが好き。別々になるのがいちばんつまらない。" },
    { id: "mp", name: "コイン合わせ", rows: ["表", "裏"], A: [[1, -1], [-1, 1]], B: [[-1, 1], [1, -1]],
      story: "そろえば行の勝ち、ずれれば列の勝ち。読まれたら負けるので、純粋戦略の均衡はない。" },
    { id: "harmony", name: "ハーモニー", rows: ["協力", "裏切り"], A: [[4, 3], [2, 1]],
      story: "協力がいつも得なので、ジレンマがない。比較のための対照実験。" },
  ];
  const game = { A: null, B: null, rows: null, cols: null, preset: "pd", trajs: [] };

  function loadPreset(id) {
    const p = PRESETS.find((x) => x.id === id);
    game.preset = id;
    game.A = p.A.map((r) => r.slice());
    game.B = (p.B || sym(p.A)).map((r) => r.slice());
    game.rows = p.rows.slice();
    game.cols = (p.cols || p.rows).slice();
    game.trajs = [];
    $("game-story").textContent = p.story;
    for (const b of $("game-presets").children) b.setAttribute("aria-pressed", String(b.dataset.v === id));
    buildMatrix();
    seedTrajs();
    gameRender();
  }
  function seedTrajs() {
    game.trajs = [[0.15, 0.85], [0.85, 0.15], [0.3, 0.3], [0.7, 0.7], [0.55, 0.45]].map(([p, q]) => Sim.trajectory2(game.A, game.B, p, q));
  }

  $("game-presets").innerHTML = PRESETS.map((p) => `<button type="button" class="chip" data-v="${p.id}" aria-pressed="false">${esc(p.name)}</button>`).join("");
  $("game-presets").addEventListener("click", (e) => { const b = e.target.closest("button[data-v]"); if (b) loadPreset(b.dataset.v); });

  function buildMatrix() {
    const t = $("game-matrix");
    const lab = (who, i) => `<input id="lab-${who}-${i}" aria-label="${who === "r" ? "行" : "列"}プレイヤーの戦略${i + 1}の名前" value="${esc((who === "r" ? game.rows : game.cols)[i])}">`;
    let h = `<tr><th></th><th>列: ${lab("c", 0)}</th><th>列: ${lab("c", 1)}</th></tr>`;
    for (let i = 0; i < 2; i++) {
      h += `<tr><th>行: ${lab("r", i)}</th>`;
      for (let j = 0; j < 2; j++) {
        h += `<td class="cell" id="cell-${i}${j}"><div class="cell-pay">
          <label style="color:var(--s1)"><span>行</span><input class="num-input" type="number" step="0.5" id="pa-${i}${j}" value="${game.A[i][j]}"></label>
          <label style="color:var(--s2)"><span>列</span><input class="num-input" type="number" step="0.5" id="pb-${i}${j}" value="${game.B[i][j]}"></label>
        </div><div class="cell-badges" id="badges-${i}${j}"></div></td>`;
      }
      h += `</tr>`;
    }
    t.innerHTML = h;
  }
  $("game-matrix").addEventListener("input", (e) => {
    const id = e.target.id;
    if (/^p[ab]-\d\d$/.test(id)) {
      const v = parseFloat(e.target.value);
      if (!Number.isFinite(v)) return;
      const i = +id[3], j = +id[4];
      (id[1] === "a" ? game.A : game.B)[i][j] = v;
      game.preset = null;
      for (const b of $("game-presets").children) b.setAttribute("aria-pressed", "false");
      $("game-story").textContent = "自分で作ったゲームです。";
      seedTrajs();
    } else if (/^lab-[rc]-\d$/.test(id)) {
      (id[4] === "r" ? game.rows : game.cols)[+id[6]] = e.target.value || "?";
    }
    gameRenderSoon();
  });
  $("game-clear").addEventListener("click", () => { game.trajs = []; gameRender(); });

  const gameRenderSoon = scheduler(() => gameRender());
  function gameRender() {
    const { A, B } = game;
    const an = Sim.analyze2x2(A, B);
    const isNash = (i, j) => an.nash.some(([a, b]) => a === i && b === j);
    const isPareto = (i, j) => an.pareto.some(([a, b]) => a === i && b === j);
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
      $("cell-" + i + j).classList.toggle("nash", isNash(i, j));
      $("pa-" + i + j).parentElement.classList.toggle("br", A[i][j] >= A[1 - i][j]);
      $("pb-" + i + j).parentElement.classList.toggle("br", B[i][j] >= B[i][1 - j]);
      const bd = $("badges-" + i + j);
      bd.innerHTML = (isNash(i, j) ? '<span class="badge nash">ナッシュ均衡</span>' : "") + (isPareto(i, j) ? '<span class="badge">パレート最適</span>' : "");
    }
    const cell = (i, j) => `（${game.rows[i]}, ${game.cols[j]}）`;
    const facts = [];
    facts.push(an.nash.length ? `純粋戦略のナッシュ均衡: ${an.nash.map(([i, j]) => cell(i, j)).join("、")}` : "純粋戦略のナッシュ均衡はありません。");
    if (an.mixed) facts.push(`混合戦略の均衡: 行は「${game.rows[0]}」を ${pct(an.mixed.p)}、列は「${game.cols[0]}」を ${pct(an.mixed.q)} の確率で選ぶ。期待得点は 行 ${fmt(an.mixed.rowPayoff, 2)}・列 ${fmt(an.mixed.colPayoff, 2)}。`);
    if (an.rowDominant !== null) facts.push(`行プレイヤーには「${game.rows[an.rowDominant]}」が支配戦略（相手が何を選んでも、こちらのほうが得）。`);
    if (an.colDominant !== null) facts.push(`列プレイヤーには「${game.cols[an.colDominant]}」が支配戦略。`);
    const bad = an.nash.filter(([i, j]) => !isPareto(i, j));
    if (bad.length) facts.push(`均衡 ${bad.map(([i, j]) => cell(i, j)).join("、")} はパレート最適ではありません。2人とも得をする別の結果があるのに、そこへ行けない。これが社会的ジレンマです。`);
    if (an.nash.length >= 2) facts.push("均衡が複数あります。どちらに落ち着くかは、出発点（相手への予想）しだい。右の図で、出発点を変えて軌道を描いてみてください。");
    $("game-facts").replaceChildren(...facts.map((f) => { const li = document.createElement("li"); li.textContent = f; return li; }));
    $("game-xname").textContent = game.cols[0];
    $("game-yname").textContent = game.rows[0];
    legend("game-legend", [
      { name: "行の最適反応", color: "var(--s1)" },
      { name: "列の最適反応", color: "var(--s2)" },
      { name: "ナッシュ均衡", color: "var(--accent)", dot: true },
      { name: "進化の軌道", color: "var(--ink)" },
    ]);
    drawBR(an);
  }

  function drawBR(an) {
    const el = $("game-br");
    register(el, () => {
      const W = Math.max(260, Math.min(520, el.clientWidth || 480)), m = { l: 44, r: 16, t: 14, b: 40 };
      const size = W - m.l - m.r, H = size + m.t + m.b;
      const X = (q) => m.l + q * size, Y = (p) => m.t + (1 - p) * size;
      const { A, B } = game;
      let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="最適反応と進化の流れ"><g class="axis">`;
      for (const v of [0, 0.25, 0.5, 0.75, 1]) {
        s += `<line class="gridline" x1="${X(0)}" x2="${X(1)}" y1="${Y(v)}" y2="${Y(v)}"/><line class="gridline" x1="${X(v)}" x2="${X(v)}" y1="${Y(0)}" y2="${Y(1)}"/>`;
        s += `<text x="${m.l - 6}" y="${Y(v) + 4}" text-anchor="end">${v * 100}%</text><text x="${X(v)}" y="${Y(0) + 16}" text-anchor="middle">${v * 100}%</text>`;
      }
      s += `<rect x="${X(0)}" y="${Y(1)}" width="${size}" height="${size}" fill="none" style="stroke:var(--line)"/></g>`;
      s += `<text class="axis-title" x="${m.l + size / 2}" y="${H - 4}" text-anchor="middle">列が「${esc(game.cols[0])}」を選ぶ確率</text>`;
      s += `<text class="axis-title" transform="translate(12 ${m.t + size / 2}) rotate(-90)" text-anchor="middle">行が「${esc(game.rows[0])}」を選ぶ確率</text>`;
      // 矢印の場
      const k = 11;
      let maxMag = 0;
      const field = [];
      for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) {
        const q = (a + 0.5) / k, p = (b + 0.5) / k;
        const [dp, dq] = Sim.replicator2(A, B, p, q);
        const mag = Math.hypot(dp, dq);
        maxMag = Math.max(maxMag, mag);
        field.push([q, p, dq, dp, mag]);
      }
      const cellPx = size / k;
      for (const [q, p, dq, dp, mag] of field) {
        if (mag < 1e-9) continue;
        const len = cellPx * 0.42 * Math.sqrt(mag / maxMag) + 2;
        const ux = dq / mag, uy = -dp / mag;
        const x0 = X(q) - ux * len / 2, y0 = Y(p) - uy * len / 2, x1 = X(q) + ux * len / 2, y1 = Y(p) + uy * len / 2;
        const hx = -ux * 4, hy = -uy * 4;
        s += `<path d="M${x0.toFixed(1)} ${y0.toFixed(1)}L${x1.toFixed(1)} ${y1.toFixed(1)}M${(x1 + hx - uy * 3).toFixed(1)} ${(y1 + hy + ux * 3).toFixed(1)}L${x1.toFixed(1)} ${y1.toFixed(1)}L${(x1 + hx + uy * 3).toFixed(1)} ${(y1 + hy - ux * 3).toFixed(1)}" fill="none" style="stroke:var(--faint)" stroke-width="1.2" stroke-linecap="round" opacity="0.8"/>`;
      }
      // 最適反応
      const br = Sim.bestResponses(A, B);
      const path = (pts, swap) => pts.map((pt, i) => { const q = swap ? pt[1] : pt[0], p = swap ? pt[0] : pt[1]; return (i ? "L" : "M") + X(q).toFixed(1) + " " + Y(p).toFixed(1); }).join("");
      // 行: pts = [q, p] / 列: pts = [p, q]
      if (br.row.pts.length) s += `<path d="${path(br.row.pts, false)}" fill="none" style="stroke:var(--s1)" stroke-width="3" stroke-linejoin="round"/>`;
      if (br.col.pts.length) s += `<path d="${path(br.col.pts, true)}" fill="none" style="stroke:var(--s2)" stroke-width="3" stroke-linejoin="round" stroke-dasharray="${br.row.pts.length ? "0" : "0"}"/>`;
      // 軌道
      for (const tr of game.trajs) {
        const d = tr.map(([p, q], i) => (i ? "L" : "M") + X(q).toFixed(1) + " " + Y(p).toFixed(1)).join("");
        const [p0, q0] = tr[0], [p1, q1] = tr[tr.length - 1];
        s += `<path d="${d}" fill="none" style="stroke:var(--ink)" stroke-width="2" stroke-linecap="round"/>`;
        s += `<circle cx="${X(q0)}" cy="${Y(p0)}" r="3.5" style="fill:var(--surface);stroke:var(--ink)" stroke-width="2"/>`;
        s += `<circle cx="${X(q1)}" cy="${Y(p1)}" r="3" style="fill:var(--ink)"/>`;
      }
      // 均衡
      const eq = an.nash.map(([i, j]) => [i === 0 ? 1 : 0, j === 0 ? 1 : 0]);
      if (an.mixed) eq.push([an.mixed.p, an.mixed.q]);
      for (const [p, q] of eq) s += `<circle cx="${X(q)}" cy="${Y(p)}" r="7" style="fill:var(--accent);stroke:var(--surface)" stroke-width="2.5"/>`;
      s += `<rect class="hit" x="${X(0)}" y="${Y(1)}" width="${size}" height="${size}" fill="transparent"/></svg>`;
      el.innerHTML = s;
      const svg = el.querySelector("svg"), tip = tipEl(el);
      const toPQ = (ev) => {
        const r = svg.getBoundingClientRect();
        const x = ((ev.clientX - r.left) / r.width) * W, y = ((ev.clientY - r.top) / r.height) * H;
        return [Math.min(1, Math.max(0, 1 - (y - m.t) / size)), Math.min(1, Math.max(0, (x - m.l) / size))];
      };
      const hit = svg.querySelector(".hit");
      hit.addEventListener("click", (ev) => {
        const [p, q] = toPQ(ev);
        game.trajs.push(Sim.trajectory2(game.A, game.B, p, q));
        if (game.trajs.length > 12) game.trajs.shift();
        drawBR(an);
      });
      hit.addEventListener("pointermove", (ev) => {
        const [p, q] = toPQ(ev);
        const uU = A[0][0] * q + A[0][1] * (1 - q), uD = A[1][0] * q + A[1][1] * (1 - q);
        const vL = B[0][0] * p + B[1][0] * (1 - p), vR = B[0][1] * p + B[1][1] * (1 - p);
        fillTip(tip, `行「${game.rows[0]}」${pct(p)}・列「${game.cols[0]}」${pct(q)}`, [
          { name: `行が「${game.rows[0]}」を選んだときの期待得点`, color: "var(--s1)", value: fmt(uU, 2) },
          { name: `行が「${game.rows[1]}」を選んだときの期待得点`, color: "var(--s1)", value: fmt(uD, 2) },
          { name: `列が「${game.cols[0]}」を選んだときの期待得点`, color: "var(--s2)", value: fmt(vL, 2) },
          { name: `列が「${game.cols[1]}」を選んだときの期待得点`, color: "var(--s2)", value: fmt(vR, 2) },
        ]);
        const r = svg.getBoundingClientRect();
        placeTip(el, tip, ev.clientX - r.left, ev.clientY - r.top);
      });
      hit.addEventListener("pointerleave", () => { tip.hidden = true; });
    });
  }

  // =====================================================================
  // 3. 繰り返し囚人のジレンマ
  // =====================================================================
  const IPD_COLORS = {};
  Sim.IPD_STRATEGIES.forEach((s, i) => { IPD_COLORS[s.id] = `var(--s${i + 1})`; });
  const ipdName = (id) => Sim.IPD_STRATEGIES.find((s) => s.id === id).name;
  const ipdState = { seed: 1104 };
  $("ipd-strats").innerHTML = Sim.IPD_STRATEGIES.map((s) =>
    `<label class="strat-chip" title="${esc(s.desc)}"><input type="checkbox" id="ipd-st-${s.id}" value="${s.id}" checked><span class="key box" style="background:${IPD_COLORS[s.id]}"></span><span>${esc(s.name)}</span></label>`).join("");
  const ipd = {
    rounds: range("ipd-rounds", (v) => v + " 回", () => ipdRun()),
    noise: range("ipd-noise", (v) => v.toFixed(1) + "%", () => ipdRun()),
    reps: range("ipd-reps", (v) => v + " 試合", () => ipdRun()),
    asp: range("ipd-asp", (v) => v.toFixed(1) + " 点", () => ipdRun()),
    adapt: range("ipd-adapt", (v) => (v === 0 ? "固定" : v.toFixed(2)), () => ipdRun()),
    gens: range("ipd-gens", (v) => v + " 世代", () => ipdRun()),
    mut: range("ipd-mut", (v) => v.toFixed(2) + "%", () => ipdRun()),
  };
  for (const id of ["ipd-T", "ipd-R", "ipd-P", "ipd-S"]) $(id).addEventListener("input", () => ipdRun());
  $("ipd-self").addEventListener("change", () => ipdRun());
  $("ipd-strats").addEventListener("change", (e) => {
    const on = [...$("ipd-strats").querySelectorAll("input:checked")];
    if (on.length < 2) e.target.checked = true; // 2つ以上は必要
    ipdRun();
  });
  $("ipd-reroll").addEventListener("click", () => { ipdState.seed = (Math.random() * 2 ** 31) >>> 0; ipdRun(); });

  const ipdRun = scheduler(function () {
    const num = (id, d) => { const v = parseFloat($(id).value); return Number.isFinite(v) ? v : d; };
    const pay = { T: num("ipd-T", 5), R: num("ipd-R", 3), P: num("ipd-P", 1), S: num("ipd-S", 0) };
    const warns = [];
    if (!(pay.T > pay.R && pay.R > pay.P && pay.P > pay.S)) warns.push("T > R > P > S になっていないので、囚人のジレンマではありません（計算はそのまま続けます）。");
    if (2 * pay.R <= pay.T + pay.S) warns.push("2R > T + S でないと、交互に裏切り合うほうが協力し続けるより得になります。");
    $("ipd-paywarn").hidden = !warns.length;
    $("ipd-paywarn").textContent = warns.join(" ");
    const ids = Sim.IPD_STRATEGIES.map((s) => s.id).filter((id) => $("ipd-st-" + id).checked);
    const cfg = {
      pay, rounds: ipd.rounds(), noise: ipd.noise() / 100, reps: ipd.reps(), satAspiration: ipd.asp(), satAdapt: ipd.adapt(),
      seed: ipdState.seed, selfPlay: $("ipd-self").checked,
    };
    const t = Sim.tournament(ids, cfg);
    const hist = Sim.evolve(t.M, ipd.gens(), ipd.mut() / 100, null);
    renderIpdBars(t, pay);
    renderIpdHeat(t, pay);
    renderIpdEvo(t, hist);
    renderIpdInsight(t, hist, cfg);
  });

  function renderIpdBars(t, pay) {
    const order = t.ids.map((id, i) => ({ id, s: t.scores[i] })).sort((a, b) => b.s - a.s);
    const max = Math.max(pay.T, ...t.scores, 0.0001), min = Math.min(0, pay.S, ...t.scores);
    $("ipd-bars").innerHTML = order.map(({ id, s }) => {
      const w = ((s - min) / (max - min)) * 100;
      return `<div class="bar-row" title="${esc(Sim.IPD_STRATEGIES.find((x) => x.id === id).desc)}"><span class="name"><span class="key box" style="background:${IPD_COLORS[id]}"></span>${esc(ipdName(id))}</span>
        <span class="bar-track"><span class="bar-fill" style="width:${w.toFixed(1)}%;background:${IPD_COLORS[id]}"></span></span><span class="val">${fmt(s, 2)}</span></div>`;
    }).join("");
  }

  function renderIpdHeat(t, pay) {
    const lo = Math.min(pay.S, pay.P), hi = Math.max(pay.T, pay.R);
    const bin = (v) => Math.max(0, Math.min(5, Math.floor(((v - lo) / (hi - lo || 1)) * 6)));
    let h = `<thead><tr><th></th>${t.ids.map((id) => `<th scope="col">${esc(ipdName(id))}</th>`).join("")}</tr></thead><tbody>`;
    t.ids.forEach((id, i) => {
      h += `<tr><th scope="row">${esc(ipdName(id))}</th>`;
      t.ids.forEach((jd, j) => {
        const v = t.M[i][j], b = bin(v);
        h += `<td style="background:var(--seq-${b});color:${b >= 3 ? "var(--on-seq-hi)" : "var(--ink)"}" title="${esc(ipdName(id))} 対 ${esc(ipdName(jd))}: ${fmt(v, 2)} 点（協力率 ${pct(t.coop[i][j])}）">${fmt(v, 1)}</td>`;
      });
      h += `</tr>`;
    });
    $("ipd-heat").innerHTML = h + "</tbody>";
    $("ipd-heat-scale").innerHTML = `<span class="num">${fmt(lo, 1)}</span>${[0, 1, 2, 3, 4, 5].map((b) => `<i style="background:var(--seq-${b})"></i>`).join("")}<span class="num">${fmt(hi, 1)}</span><span>点</span>`;
  }

  function renderIpdEvo(t, hist) {
    const series = t.ids.map((id, i) => ({ name: ipdName(id), color: IPD_COLORS[id], pts: hist.map((x, g) => [g, x[i]]) }));
    legend("ipd-evo-legend", series.map((s) => ({ name: s.name, color: s.color })));
    lineChart($("ipd-evo"), {
      label: "世代ごとの戦略の割合",
      height: 300, right: 116,
      x: { min: 0, max: hist.length - 1, title: "世代" },
      y: { min: 0, max: 1, ticks: [0, 0.25, 0.5, 0.75, 1], fmt: (v, tip) => pct(v, tip ? 1 : 0), title: "集団の中の割合" },
      series,
      directLabels: (sr, last) => last >= 0.06,
      tipHead: (g) => `${g} 世代目`,
    });
  }

  function renderIpdInsight(t, hist, cfg) {
    const top = t.ids[t.scores.indexOf(Math.max(...t.scores))];
    const last = hist[hist.length - 1];
    const order = t.ids.map((id, i) => ({ id, x: last[i] })).sort((a, b) => b.x - a.x);
    let s = `総当たり戦の1位は <b>${esc(ipdName(top))}</b>（1回あたり平均 <span class="num">${fmt(Math.max(...t.scores), 2)}</span> 点）。`;
    s += ` 進化させると、${hist.length - 1} 世代後には <b>${esc(ipdName(order[0].id))}</b> が <span class="num">${pct(order[0].x)}</span>`;
    s += order[1] && order[1].x > 0.1 ? `、${esc(ipdName(order[1].id))} が <span class="num">${pct(order[1].x)}</span> を占めています。` : ` を占めています。`;
    const coopNow = t.ids.reduce((acc, id, i) => acc + last[i] * t.ids.reduce((a2, jd, j) => a2 + last[j] * t.coop[i][j], 0), 0);
    s += ` このときの集団全体の協力率はおよそ <span class="num">${pct(coopNow)}</span>。`;
    if (order[0].id === "alld" && order[0].x > 0.5) s += " 協力が崩れて裏切りが広がりました。1試合の回数を増やしたり、ノイズを減らしたりすると変わるか試してください。";
    else if (cfg.rounds <= 10) s += " 試合が短いと、将来の仕返しがこわくないので、裏切りが得になりやすくなります。";
    else if (cfg.noise >= 0.05 && t.ids.includes("tft")) s += " ノイズが大きいと、しっぺ返し同士は1回のまちがいから報復合戦になります。許す戦略や「勝てば継続」が有利になりやすい条件です。";
    else if (cfg.noise === 0 && t.ids.includes("tft")) s += " ノイズが0だと、協力的な戦略どうしは区別がつかず、割合がほとんど動かないことがあります。";
    $("ipd-insight").innerHTML = s;
  }

  // =====================================================================
  // 4. 空間ゲーム
  // =====================================================================
  const sp = {
    b: range("sp-b", (v) => v.toFixed(2), () => spInsight()),
    asp: range("sp-asp", (v) => v.toFixed(2) + " 点", () => {}),
    mut: range("sp-mut", (v) => v.toFixed(2) + "%", () => {}),
    ratio: range("sp-ratio", (v) => v + "%", () => spReset()),
    speed: range("sp-speed", (v) => v, () => {}),
    rule: seg("sp-rule", () => { spShowFields(); spInsight(); }),
    start: seg("sp-start", () => { spShowFields(); spReset(); }),
    size: seg("sp-size", () => spReset()),
  };
  const spS = { S: null, hist: [], playing: true, acc: 0, lastT: 0, change: 0, colors: null, img: null, lastChart: 0, seed: 7 };
  const canvas = $("sp-canvas"), ctx = canvas.getContext("2d");

  function spShowFields() {
    $("sp-asp-field").hidden = sp.rule() !== "satisfice";
    $("sp-ratio-field").hidden = sp.start() !== "random";
  }
  function hexRgb(h) {
    const m = /^#?([0-9a-f]{6})$/i.exec(h);
    if (!m) return [128, 128, 128];
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function spColors() {
    spS.colors = { cc: hexRgb(cssVar("--s1")), dc: hexRgb(cssVar("--s1-soft")), dd: hexRgb(cssVar("--s2")), cd: hexRgb(cssVar("--s2-soft")) };
  }
  function spReset() {
    const L = +sp.size();
    spS.seed = (spS.seed * 1103515245 + 12345) >>> 0;
    spS.S = Sim.spatialCreate(L, { seed: spS.seed, start: sp.start(), coopRatio: sp.ratio() / 100 });
    canvas.width = canvas.height = L;
    spS.img = ctx.createImageData(L, L);
    spS.hist = [[0, coopFrac()]];
    spS.change = NaN;
    spDraw();
    spStats(true);
  }
  function coopFrac() { let c = 0; for (const v of spS.S.g) c += v; return c / spS.S.g.length; }
  function spStep() {
    const f = Sim.spatialStep(spS.S, { b: sp.b(), rule: sp.rule(), aspiration: sp.asp(), mutation: sp.mut() / 100 });
    const { g, prev } = spS.S;
    let ch = 0;
    for (let i = 0; i < g.length; i++) if (g[i] !== prev[i]) ch++;
    spS.change = ch / g.length;
    spS.hist.push([spS.S.t, f]);
    if (spS.hist.length > 400) spS.hist.shift();
  }
  function spDraw() {
    if (!spS.colors) spColors();
    const { g, prev } = spS.S, d = spS.img.data, c = spS.colors;
    for (let i = 0, k = 0; i < g.length; i++, k += 4) {
      const col = g[i] ? (prev[i] ? c.cc : c.dc) : (prev[i] ? c.cd : c.dd);
      d[k] = col[0]; d[k + 1] = col[1]; d[k + 2] = col[2]; d[k + 3] = 255;
    }
    ctx.putImageData(spS.img, 0, 0);
  }
  function spStats(forceChart) {
    $("sp-t").textContent = spS.S.t;
    $("sp-coop").textContent = pct(coopFrac(), 1);
    $("sp-change").textContent = Number.isFinite(spS.change) ? pct(spS.change, 1) : "—";
    const now = performance.now();
    if (forceChart || now - spS.lastChart > 300) {
      spS.lastChart = now;
      const h = spS.hist;
      lineChart($("sp-chart"), {
        label: "協力者の割合の推移", height: 200,
        x: { min: h[0][0], max: Math.max(h[0][0] + 1, h[h.length - 1][0]), title: "ステップ" },
        y: { min: 0, max: 1, ticks: [0, 0.25, 0.5, 0.75, 1], fmt: (v, tip) => pct(v, tip ? 1 : 0) },
        series: [{ name: "協力者の割合", color: "var(--s1)", pts: h }],
        tipHead: (x) => `${x} ステップ目`,
      });
      spInsight();
    }
  }
  function spInsight() {
    const b = sp.b(), c = spS.S ? coopFrac() : NaN;
    let s = `いま協力者は <span class="num">${pct(c, 1)}</span>。`;
    if (sp.rule() === "satisfice") {
      s += ` 「満足していれば変えない」では、要求水準 <span class="num">${sp.asp().toFixed(2)}</span> 点以上とれているマスは手を変えません。要求水準を下げると、裏切り者も協力者も今の手に満足して動かなくなり、模様が凍りつきます。`;
    } else if (b < 9 / 8) {
      s += ` b = <span class="num">${b.toFixed(2)}</span> では、裏切り者は協力者のかたまりに勝てず、広がれません（目安: b < 1.125）。`;
    } else if (b < 1.8) {
      s += ` b = <span class="num">${b.toFixed(2)}</span> では、協力者はかたまりを作って身を守り、多数派を保ちやすい範囲です（目安: b < 1.8）。`;
    } else if (b < 2) {
      s += ` b = <span class="num">${b.toFixed(2)}</span> は、協力と裏切りが入りまじって模様が動き続ける範囲です（目安: 1.8〜2.0）。「中央に裏切り者1人」で始めると万華鏡のような図形になります。`;
    } else {
      s += ` b = <span class="num">${b.toFixed(2)}</span> では誘惑が強く、裏切りが広がりやすくなります（目安: b > 2）。`;
    }
    s += " 混ぜずに隣としか対戦しない「空間」があるだけで、全員が混ざる場合より協力が生き残りやすくなるのがポイントです。";
    $("sp-insight").innerHTML = s;
  }
  legend("sp-legend", [
    { name: "協力（そのまま）", color: "var(--s1)", box: true },
    { name: "協力に変わった", color: "var(--s1-soft)", box: true },
    { name: "裏切り（そのまま）", color: "var(--s2)", box: true },
    { name: "裏切りに変わった", color: "var(--s2-soft)", box: true },
  ]);
  $("sp-play").addEventListener("click", () => { spS.playing = !spS.playing; $("sp-play").textContent = spS.playing ? "一時停止" : "再生"; });
  $("sp-step").addEventListener("click", () => { spS.playing = false; $("sp-play").textContent = "再生"; spStep(); spDraw(); spStats(true); });
  $("sp-reset").addEventListener("click", () => spReset());

  function spLoop(now) {
    requestAnimationFrame(spLoop);
    if (document.hidden || $("spatial").hidden || !spS.playing) { spS.lastT = now; return; }
    const dt = Math.min(200, now - (spS.lastT || now));
    spS.lastT = now;
    spS.acc += dt * sp.speed() / 1000;
    let steps = 0;
    while (spS.acc >= 1 && steps < 6) { spStep(); spS.acc -= 1; steps++; }
    if (spS.acc > 6) spS.acc = 0;
    if (steps) { spDraw(); spStats(false); }
  }

  // テーマが変わったら canvas の色を取りなおす
  const reColor = () => { spS.colors = null; if (spS.S) spDraw(); };
  if (window.matchMedia) window.matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", reColor);
  new MutationObserver(reColor).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  // =====================================================================
  // タブ（#satisfice / #game / #ipd / #spatial）
  // =====================================================================
  const TABS = ["satisfice", "game", "ipd", "spatial"];
  function showTab() {
    const h = location.hash.slice(1);
    const cur = TABS.includes(h) ? h : "satisfice";
    for (const t of TABS) {
      $(t).hidden = t !== cur;
      $("tab-" + t).setAttribute("aria-selected", String(t === cur));
    }
    for (const el of charts) if (!el.closest("[hidden]")) el._render();
  }
  window.addEventListener("hashchange", showTab);

  // ---- 起動 ----
  loadPreset("pd");
  spShowFields();
  spReset();
  showTab();
  satRun();
  ipdRun();
  requestAnimationFrame(spLoop);
})();
