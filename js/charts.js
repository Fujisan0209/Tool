/*
 * charts.js — Canvas 描画（ライブラリなし）
 * 高速化: 描画はピクセル列単位に間引き（データ数に依存しない）、
 * 再描画は rAF で 1 フレームにまとめる（app.js 側で制御）。
 */
(function (root) {
  'use strict';

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function theme() {
    var E = root.VEEmotion.EMOTIONS, c = {};
    E.forEach(function (e) { c[e.id] = cssVar('--e-' + e.id); });
    return {
      emo: c, surface: cssVar('--surface'), ink: cssVar('--ink'), ink2: cssVar('--ink-2'),
      muted: cssVar('--muted'), grid: cssVar('--grid'), axis: cssVar('--axis'), silence: cssVar('--silence')
    };
  }

  /** DPR を考慮してキャンバスを要素サイズに合わせる */
  function fit(cv) {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
    }
    var ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx: ctx, w: w, h: h };
  }

  /** t 以下で最大の要素の添字（二分探索） */
  function indexAt(data, t) {
    var lo = 0, hi = data.length - 1;
    if (hi < 0 || t < data[0].t) return -1;
    while (lo < hi) {
      var mid = (lo + hi + 1) >> 1;
      if (data[mid].t <= t) lo = mid; else hi = mid - 1;
    }
    return lo;
  }

  function fmtTime(s) {
    var m = Math.floor(s / 60), r = s - m * 60;
    return m + ':' + (r < 10 ? '0' : '') + r.toFixed(r < 10 && s < 60 ? 1 : 0).replace(/\.0$/, '');
  }

  function niceStep(span, target) {
    var raw = span / target, p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p;
    return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
  }

  function timeAxis(ctx, th, L, R, top, bottom, t0, t1) {
    var step = niceStep(t1 - t0, Math.max(2, (R - L) / 90));
    ctx.fillStyle = th.muted;
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.strokeStyle = th.grid;
    ctx.lineWidth = 1;
    for (var t = Math.ceil(t0 / step) * step; t <= t1 + 1e-9; t += step) {
      var x = L + (t - t0) / (t1 - t0) * (R - L);
      ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, top); ctx.lineTo(Math.round(x) + 0.5, bottom); ctx.stroke();
      var m = Math.floor(t / 60), s = Math.round(t - m * 60);
      ctx.fillText(m + ':' + (s < 10 ? '0' : '') + s, x, bottom + 4);
    }
    ctx.strokeStyle = th.axis;
    ctx.beginPath(); ctx.moveTo(L, bottom + 0.5); ctx.lineTo(R, bottom + 0.5); ctx.stroke();
  }

  function vline(ctx, x, top, bottom, color, width) {
    ctx.strokeStyle = color; ctx.lineWidth = width || 1;
    ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, top); ctx.lineTo(Math.round(x) + 0.5, bottom); ctx.stroke();
  }

  /**
   * 感情確率の積み上げ面グラフ。
   * view: { t0, t1, hoverT, playT }
   * 返り値: x ↔ t 変換（ホバー判定用）
   */
  function timeline(cv, data, view, th) {
    var f = fit(cv), ctx = f.ctx, w = f.w, h = f.h;
    var L = 34, R = w - 8, top = 6, bottom = h - 20;
    var E = root.VEEmotion.EMOTIONS;
    var t0 = view.t0, t1 = Math.max(view.t1, t0 + 1);
    var X = function (t) { return L + (t - t0) / (t1 - t0) * (R - L); };
    var Y = function (p) { return bottom - p * (bottom - top); };

    // y 軸グリッド
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    [0, 0.25, 0.5, 0.75, 1].forEach(function (p) {
      ctx.strokeStyle = th.grid; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(L, Math.round(Y(p)) + 0.5); ctx.lineTo(R, Math.round(Y(p)) + 0.5); ctx.stroke();
      ctx.fillStyle = th.muted;
      ctx.fillText(Math.round(p * 100) + '%', L - 6, Y(p));
    });

    // ピクセル列ごとにサンプル（データ量に依存しない描画コスト）
    var cols = Math.max(2, Math.floor(R - L));
    var colData = new Array(cols + 1);
    var lastIdx = data.length ? data[data.length - 1].t : -1;
    for (var c = 0; c <= cols; c++) {
      var t = t0 + c / cols * (t1 - t0);
      var i = t > lastIdx + 0.1 ? -1 : indexAt(data, t);
      colData[c] = i >= 0 && data[i].active ? data[i].probs : (i >= 0 ? 0 : null);
    }

    // 無音帯（データはあるが発話なし）
    ctx.fillStyle = th.silence;
    for (c = 0; c <= cols; c++) if (colData[c] === 0) ctx.fillRect(L + c, top, 1.2, bottom - top);

    // 連続した発話区間ごとに帯を塗る
    var runs = [], s = -1;
    for (c = 0; c <= cols + 1; c++) {
      var on = c <= cols && colData[c];
      if (on && s < 0) s = c;
      if (!on && s >= 0) { runs.push([s, c - 1]); s = -1; }
    }
    runs.forEach(function (run) {
      var lower = new Float32Array(run[1] - run[0] + 1);
      E.forEach(function (e) {
        ctx.beginPath();
        var k, x;
        for (k = run[0]; k <= run[1]; k++) {
          x = L + k;
          var up = lower[k - run[0]] + colData[k][e.id];
          if (k === run[0]) ctx.moveTo(x, Y(up)); else ctx.lineTo(x, Y(up));
        }
        for (k = run[1]; k >= run[0]; k--) ctx.lineTo(L + k + 1, Y(lower[k - run[0]]));
        if (run[0] === run[1]) ctx.lineTo(L + run[0] + 1, Y(lower[0] + colData[run[0]][e.id]));
        ctx.closePath();
        ctx.fillStyle = th.emo[e.id];
        ctx.fill();
        // 帯の上端に面の色で 1.5px の区切り線（隣接色の判別を助ける）
        ctx.beginPath();
        for (k = run[0]; k <= run[1]; k++) {
          lower[k - run[0]] += colData[k][e.id];
          if (k === run[0]) ctx.moveTo(L + k, Y(lower[0])); else ctx.lineTo(L + k, Y(lower[k - run[0]]));
        }
        ctx.strokeStyle = th.surface; ctx.lineWidth = 1.5; ctx.stroke();
      });
    });

    timeAxis(ctx, th, L, R, top, bottom, t0, t1);
    if (view.playT != null) vline(ctx, X(view.playT), top - 4, bottom, th.ink, 2);
    if (view.hoverT != null) vline(ctx, X(view.hoverT), top, bottom, th.ink2, 1);

    return {
      tAt: function (px) { return t0 + (px - L) / (R - L) * (t1 - t0); },
      inPlot: function (px) { return px >= L && px <= R; }
    };
  }

  /** 単一系列の折れ線（無効値は途切れさせる） */
  function line(cv, data, key, view, th, opts) {
    var f = fit(cv), ctx = f.ctx, w = f.w, h = f.h;
    var L = 34, R = w - 8, top = 6, bottom = h - 20;
    var t0 = view.t0, t1 = Math.max(view.t1, t0 + 1);
    var lo = opts.min, hi = opts.max;
    var log = !!opts.log;
    var tr = function (v) { return log ? Math.log(v) : v; };
    var Y = function (v) { return bottom - (tr(v) - tr(lo)) / (tr(hi) - tr(lo)) * (bottom - top); };

    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    opts.ticks.forEach(function (v) {
      ctx.strokeStyle = th.grid; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(L, Math.round(Y(v)) + 0.5); ctx.lineTo(R, Math.round(Y(v)) + 0.5); ctx.stroke();
      ctx.fillStyle = th.muted; ctx.fillText(String(v), L - 6, Y(v));
    });

    var cols = Math.max(2, Math.floor(R - L));
    var lastT = data.length ? data[data.length - 1].t : -1;
    ctx.strokeStyle = opts.color; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.beginPath();
    var pen = false;
    for (var c = 0; c <= cols; c++) {
      var t = t0 + c / cols * (t1 - t0);
      var i = t > lastT + 0.1 ? -1 : indexAt(data, t);
      var v = i >= 0 ? opts.value(data[i]) : NaN;
      if (!isFinite(v)) { pen = false; continue; }
      v = Math.min(hi, Math.max(lo, v));
      if (!pen) { ctx.moveTo(L + c, Y(v)); pen = true; } else ctx.lineTo(L + c, Y(v));
    }
    ctx.stroke();

    timeAxis(ctx, th, L, R, top, bottom, t0, t1);
    var X = function (t) { return L + (t - t0) / (t1 - t0) * (R - L); };
    if (view.playT != null) vline(ctx, X(view.playT), top - 4, bottom, th.ink, 2);
    if (view.hoverT != null) vline(ctx, X(view.hoverT), top, bottom, th.ink2, 1);
    return {
      tAt: function (px) { return t0 + (px - L) / (R - L) * (t1 - t0); },
      inPlot: function (px) { return px >= L && px <= R; }
    };
  }

  /** 覚醒度 × 感情価 の円環マップ。trail は古い→新しい順の結果列 */
  function circumplex(cv, trail, th) {
    var f = fit(cv), ctx = f.ctx, w = f.w, h = f.h;
    var size = Math.min(w, h), cx = w / 2, cy = h / 2, r = size / 2 - 26;
    var P = function (v, a) { return [cx + v * r, cy - a * r]; };

    ctx.strokeStyle = th.grid; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, r / 2, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = th.axis;
    ctx.beginPath();
    ctx.moveTo(cx - r, cy + 0.5); ctx.lineTo(cx + r, cy + 0.5);
    ctx.moveTo(cx + 0.5, cy - r); ctx.lineTo(cx + 0.5, cy + r);
    ctx.stroke();

    ctx.fillStyle = th.muted; ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText('興奮', cx, cy - r - 4);
    ctx.textBaseline = 'top'; ctx.fillText('落ち着き', cx, cy + r + 4);
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.fillText('快', cx + r + 5, cy);
    ctx.textAlign = 'right'; ctx.fillText('不快', cx - r - 5, cy);

    // 各感情の位置（色 + 文字ラベル）
    ctx.font = '12px system-ui, sans-serif';
    root.VEEmotion.EMOTIONS.forEach(function (e) {
      var p = P(e.v, e.a);
      ctx.fillStyle = th.emo[e.id];
      ctx.beginPath(); ctx.arc(p[0], p[1], 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = th.ink2; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText(e.label, p[0], p[1] + 6);
    });

    var pts = trail.filter(function (d) { return d && d.active; });
    if (!pts.length) return;
    ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (var i = 1; i < pts.length; i++) {
      var a = P(pts[i - 1].valence, pts[i - 1].arousal), b = P(pts[i].valence, pts[i].arousal);
      ctx.globalAlpha = 0.15 + 0.7 * (i / pts.length);
      ctx.strokeStyle = th.ink2;
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    var last = pts[pts.length - 1], q = P(last.valence, last.arousal);
    ctx.fillStyle = th.surface;
    ctx.beginPath(); ctx.arc(q[0], q[1], 9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = th.emo[last.dominant];
    ctx.beginPath(); ctx.arc(q[0], q[1], 7, 0, Math.PI * 2); ctx.fill();
  }

  root.VECharts = { theme: theme, timeline: timeline, line: line, circumplex: circumplex, indexAt: indexAt, fmtTime: fmtTime };
})(window);
