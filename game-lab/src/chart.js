/*
 * 小さなキャンバス用グラフ部品（折れ線・積み上げ面）。ライブラリなし。
 * 色はすべて CSS 変数から読むので、ライト／ダークどちらでも読めます。
 */
(function (root) {
  "use strict";

  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const color = (c) => (c && c.startsWith("--") ? css(c) : c);

  function niceTicks(min, max, count = 5) {
    if (!(max > min)) return [min];
    const span = max - min;
    const step0 = span / count;
    const mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const err = step0 / mag;
    const step = (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1) * mag;
    const out = [];
    for (let v = Math.ceil(min / step - 1e-9) * step; v <= max + 1e-9; v += step) out.push(+v.toFixed(10));
    return out;
  }

  function setupCanvas(canvas, w, h) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }

  const FONT = '12px "IBM Plex Mono", ui-monospace, monospace';
  const FONT_LABEL = '12px "BIZ UDPGothic", "Hiragino Sans", "Yu Gothic UI", sans-serif';

  /**
   * 折れ線グラフ / 積み上げ面グラフ
   * spec = {
   *   xs: [...], series: [{ name, color: "--s1", ys: [...], width, dash, area }],
   *   stacked: false, xDomain, yDomain, xLabel, yLabel, xFmt, yFmt,
   *   hlines: [{ y, color, label, dash }], vlines: [{ x, color, label }], points: [{ x, y, color, label }],
   *   tooltip: (index) => [ [label, value, color], ... ] | null
   * }
   */
  class Chart {
    constructor(wrap, opts = {}) {
      this.wrap = wrap;
      this.opts = opts;
      this.canvas = document.createElement("canvas");
      this.canvas.setAttribute("role", "img");
      if (opts.ariaLabel) this.canvas.setAttribute("aria-label", opts.ariaLabel);
      this.tip = document.createElement("div");
      this.tip.className = "tip";
      this.tip.hidden = true;
      wrap.append(this.canvas, this.tip);
      this.hover = null;
      new ResizeObserver(() => this.draw()).observe(wrap);
      this.canvas.addEventListener("pointermove", (e) => this.onMove(e));
      this.canvas.addEventListener("pointerleave", () => { this.hover = null; this.tip.hidden = true; this.draw(); });
    }
    set(spec) { this.spec = spec; this.draw(); }

    geom() {
      const w = this.wrap.clientWidth;
      const h = this.opts.height || 260;
      const m = { l: 48, r: 14, t: 12, b: 38 };
      return { w, h, m, pw: Math.max(10, w - m.l - m.r), ph: Math.max(10, h - m.t - m.b) };
    }

    domains() {
      const s = this.spec;
      const xs = s.xs;
      const xd = s.xDomain || [xs[0], xs[xs.length - 1]];
      let yd = s.yDomain;
      if (!yd) {
        let lo = Infinity, hi = -Infinity;
        for (const se of s.series) for (const v of se.ys) if (isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
        for (const hl of s.hlines || []) { lo = Math.min(lo, hl.y); hi = Math.max(hi, hl.y); }
        if (!isFinite(lo)) { lo = 0; hi = 1; }
        const pad = (hi - lo) * 0.08 || 1;
        yd = [lo - pad, hi + pad];
      }
      return { xd, yd };
    }

    draw() {
      const s = this.spec;
      if (!s || !this.wrap.isConnected || this.wrap.clientWidth === 0) return;
      const { w, h, m, pw, ph } = this.geom();
      const ctx = setupCanvas(this.canvas, w, h);
      const { xd, yd } = this.domains();
      const X = (x) => m.l + ((x - xd[0]) / (xd[1] - xd[0] || 1)) * pw;
      const Y = (y) => m.t + ph - ((y - yd[0]) / (yd[1] - yd[0] || 1)) * ph;
      this.X = X; this.Y = Y; this.m = m; this.pw = pw;
      ctx.clearRect(0, 0, w, h);
      const ink = css("--muted"), grid = css("--grid"), axis = css("--axis");

      // 目盛りとグリッド
      ctx.font = FONT;
      ctx.fillStyle = ink;
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      const yt = niceTicks(yd[0], yd[1], Math.max(3, Math.round(ph / 48)));
      for (const v of yt) {
        const y = Math.round(Y(v)) + 0.5;
        ctx.strokeStyle = grid; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(m.l, y); ctx.lineTo(m.l + pw, y); ctx.stroke();
        ctx.fillText((s.yFmt || fmt)(v), m.l - 6, y);
      }
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      const xt = niceTicks(xd[0], xd[1], Math.max(3, Math.round(pw / 80)));
      for (const v of xt) ctx.fillText((s.xFmt || fmt)(v), X(v), m.t + ph + 6);
      ctx.strokeStyle = axis; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(m.l, Math.round(m.t + ph) + 0.5); ctx.lineTo(m.l + pw, Math.round(m.t + ph) + 0.5); ctx.stroke();
      ctx.font = FONT_LABEL;
      if (s.xLabel) { ctx.textAlign = "right"; ctx.fillText(s.xLabel, m.l + pw, m.t + ph + 22); }
      if (s.yLabel) { ctx.textAlign = "left"; ctx.textBaseline = "top"; ctx.fillText(s.yLabel, m.l + 4, m.t); }

      ctx.save();
      ctx.beginPath(); ctx.rect(m.l, m.t - 2, pw, ph + 4); ctx.clip();

      if (s.stacked) {
        // 積み上げ面（各層の間に背景色で 2px のすき間）
        const n = s.xs.length;
        const base = new Float64Array(n);
        const surf = css("--surface");
        for (const se of s.series) {
          ctx.beginPath();
          for (let i = 0; i < n; i++) { const x = X(s.xs[i]), y = Y(base[i] + se.ys[i]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
          for (let i = n - 1; i >= 0; i--) ctx.lineTo(X(s.xs[i]), Y(base[i]));
          ctx.closePath();
          ctx.fillStyle = color(se.color);
          ctx.fill();
          for (let i = 0; i < n; i++) base[i] += se.ys[i];
          ctx.beginPath();
          for (let i = 0; i < n; i++) { const x = X(s.xs[i]), y = Y(base[i]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
          ctx.strokeStyle = surf; ctx.lineWidth = 2; ctx.stroke();
        }
      } else {
        for (const se of s.series) {
          if (se.area) {
            ctx.beginPath();
            se.ys.forEach((v, i) => { const x = X(s.xs[i]), y = Y(v); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
            ctx.lineTo(X(s.xs[s.xs.length - 1]), Y(yd[0])); ctx.lineTo(X(s.xs[0]), Y(yd[0])); ctx.closePath();
            ctx.globalAlpha = 0.12; ctx.fillStyle = color(se.color); ctx.fill(); ctx.globalAlpha = 1;
          }
          ctx.beginPath();
          let started = false;
          se.ys.forEach((v, i) => {
            if (!isFinite(v)) { started = false; return; }
            const x = X(s.xs[i]), y = Y(v);
            started ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
            started = true;
          });
          ctx.strokeStyle = color(se.color);
          ctx.lineWidth = se.width || 2;
          ctx.lineJoin = "round";
          ctx.setLineDash(se.dash || []);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
      for (const hl of s.hlines || []) {
        const y = Math.round(Y(hl.y)) + 0.5;
        ctx.strokeStyle = color(hl.color); ctx.lineWidth = hl.width || 1.5; ctx.setLineDash(hl.dash || [5, 4]);
        ctx.beginPath(); ctx.moveTo(m.l, y); ctx.lineTo(m.l + pw, y); ctx.stroke(); ctx.setLineDash([]);
      }
      for (const vl of s.vlines || []) {
        const x = Math.round(X(vl.x)) + 0.5;
        ctx.strokeStyle = color(vl.color || "--axis"); ctx.lineWidth = 1; ctx.setLineDash(vl.dash || [3, 3]);
        ctx.beginPath(); ctx.moveTo(x, m.t); ctx.lineTo(x, m.t + ph); ctx.stroke(); ctx.setLineDash([]);
      }
      ctx.restore();

      // ラベル付きの点（2px の背景色リング）
      const surf = css("--surface");
      for (const pt of s.points || []) {
        const x = X(pt.x), y = Y(pt.y);
        ctx.beginPath(); ctx.arc(x, y, pt.r || 5, 0, Math.PI * 2);
        ctx.fillStyle = pt.hollow ? surf : color(pt.color); ctx.fill();
        ctx.lineWidth = pt.hollow ? 2.5 : 2; ctx.strokeStyle = pt.hollow ? color(pt.color) : surf; ctx.stroke();
        if (pt.label) {
          ctx.font = FONT_LABEL; ctx.fillStyle = css("--ink"); ctx.textBaseline = "bottom";
          const tw = ctx.measureText(pt.label).width;
          const right = x + 8 + tw < m.l + pw;
          ctx.textAlign = right ? "left" : "right";
          ctx.fillText(pt.label, right ? x + 8 : x - 8, y - 4);
        }
      }
      for (const hl of s.hlines || []) {
        if (!hl.label) continue;
        ctx.font = FONT_LABEL; ctx.fillStyle = css("--ink-2"); ctx.textAlign = "left"; ctx.textBaseline = "bottom";
        ctx.fillText(hl.label, m.l + 6, Y(hl.y) - 3);
      }

      // ホバー（十字線と各系列の点）
      if (this.hover != null) {
        const i = this.hover;
        const x = Math.round(X(s.xs[i])) + 0.5;
        ctx.strokeStyle = axis; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, m.t); ctx.lineTo(x, m.t + ph); ctx.stroke();
        let base = 0;
        for (const se of s.series) {
          const v = s.stacked ? (base += se.ys[i]) : se.ys[i];
          if (!isFinite(v)) continue;
          ctx.beginPath(); ctx.arc(X(s.xs[i]), Y(v), 4, 0, Math.PI * 2);
          ctx.fillStyle = color(se.color); ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = surf; ctx.stroke();
        }
      }
    }

    onMove(e) {
      const s = this.spec;
      if (!s || !this.X) return;
      const rect = this.canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      let best = 0, bd = Infinity;
      for (let i = 0; i < s.xs.length; i++) {
        const d = Math.abs(this.X(s.xs[i]) - mx);
        if (d < bd) { bd = d; best = i; }
      }
      this.hover = best;
      this.draw();
      const rows = s.tooltip
        ? s.tooltip(best)
        : s.series.map((se) => [se.name, (s.yFmt || fmt)(se.ys[best]), se.color]);
      if (!rows) { this.tip.hidden = true; return; }
      const head = s.tipHead ? s.tipHead(best) : `${s.xLabel || "x"} ${(s.xFmt || fmt)(s.xs[best])}`;
      this.tip.innerHTML =
        `<div class="tip-head">${head}</div>` +
        rows.map(([k, v, c]) => `<div class="tip-row"><i style="background:${color(c) || "transparent"}"></i><span>${k}</span><b>${v}</b></div>`).join("");
      this.tip.hidden = false;
      const tw = this.tip.offsetWidth;
      const x = this.X(s.xs[best]);
      const left = x + 14 + tw < this.wrap.clientWidth ? x + 14 : Math.max(0, x - 14 - tw);
      this.tip.style.left = left + "px";
      this.tip.style.top = Math.max(0, e.clientY - rect.top - 40) + "px";
    }
  }

  function fmt(v) {
    if (!isFinite(v)) return "–";
    const a = Math.abs(v);
    if (a >= 1000) return Math.round(v).toLocaleString("ja-JP");
    if (a >= 100 || Number.isInteger(v)) return String(Math.round(v * 10) / 10);
    return (Math.round(v * 100) / 100).toString();
  }

  root.GameLabChart = { Chart, niceTicks, setupCanvas, css, color, fmt };
})(typeof globalThis !== "undefined" ? globalThis : this);
