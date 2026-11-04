/*
 * dsp.js — 音響特徴量の抽出（依存ライブラリなし）
 *
 * フレーム単位で以下を計算する:
 *   rms / db      : 音量
 *   zcr           : ゼロ交差率
 *   centroid      : スペクトル重心 (Hz) — 声の「明るさ・鋭さ」
 *   hfRatio       : 1kHz 以上のエネルギー比 — 声の張り・力み
 *   flatness      : スペクトル平坦度 — 息っぽさ・ざらつき
 *   f0 / clarity  : 基本周波数 (YIN) とその信頼度
 *
 * 高速化のポイント
 *   - ピッチ推定は ~16kHz にデシメーションしてから YIN（計算量が約 1/9）
 *   - FFT は基数2の in-place 実装、窓関数・ビット反転表・三角関数表はサイズごとにキャッシュ
 *   - 作業用バッファは使い回してフレームごとの GC を避ける
 */
(function (root) {
  'use strict';

  var cache = {};

  function getTables(n) {
    var key = 'fft' + n;
    if (cache[key]) return cache[key];
    var levels = Math.round(Math.log2(n));
    var rev = new Uint32Array(n);
    for (var i = 0; i < n; i++) {
      var r = 0, x = i;
      for (var b = 0; b < levels; b++) { r = (r << 1) | (x & 1); x >>= 1; }
      rev[i] = r;
    }
    var cos = new Float64Array(n / 2), sin = new Float64Array(n / 2);
    for (var k = 0; k < n / 2; k++) {
      cos[k] = Math.cos(2 * Math.PI * k / n);
      sin[k] = Math.sin(2 * Math.PI * k / n);
    }
    var win = new Float32Array(n);
    for (var w = 0; w < n; w++) win[w] = 0.5 - 0.5 * Math.cos(2 * Math.PI * w / (n - 1));
    cache[key] = {
      rev: rev, cos: cos, sin: sin, win: win,
      re: new Float64Array(n), im: new Float64Array(n), mag: new Float64Array(n / 2 + 1)
    };
    return cache[key];
  }

  function fft(re, im, t) {
    var n = re.length, i, j, tmp;
    for (i = 0; i < n; i++) {
      j = t.rev[i];
      if (j > i) {
        tmp = re[i]; re[i] = re[j]; re[j] = tmp;
        tmp = im[i]; im[i] = im[j]; im[j] = tmp;
      }
    }
    for (var size = 2; size <= n; size <<= 1) {
      var half = size >> 1, step = n / size;
      for (i = 0; i < n; i += size) {
        for (j = 0; j < half; j++) {
          var k = j * step;
          var a = i + j, b = a + half;
          var tre = re[b] * t.cos[k] + im[b] * t.sin[k];
          var tim = -re[b] * t.sin[k] + im[b] * t.cos[k];
          re[b] = re[a] - tre; im[b] = im[a] - tim;
          re[a] += tre; im[a] += tim;
        }
      }
    }
  }

  /** 2 の冪で、sr * sec 以上の最小値 */
  function frameSizeFor(sr, sec) {
    var n = 256;
    while (n < sr * sec) n <<= 1;
    return n;
  }

  /** 単純な箱型平均 + 間引き（ピッチ推定用、帯域 ~8kHz で十分） */
  function decimate(src, factor, out) {
    var len = Math.floor(src.length / factor);
    if (!out || out.length !== len) out = new Float32Array(len);
    for (var i = 0, p = 0; i < len; i++) {
      var s = 0;
      for (var k = 0; k < factor; k++) s += src[p++];
      out[i] = s / factor;
    }
    return out;
  }

  /**
   * YIN による F0 推定。
   * @returns {{f0:number, clarity:number}} 無声なら f0 = 0
   */
  function yin(x, sr, fmin, fmax, threshold) {
    var tauMin = Math.max(2, Math.floor(sr / fmax));
    var tauMax = Math.min(Math.floor(sr / fmin), Math.floor(x.length / 2));
    var W = x.length - tauMax;
    if (W < 32 || tauMax <= tauMin) return { f0: 0, clarity: 0 };
    var key = 'yin' + tauMax;
    var d = cache[key] || (cache[key] = new Float64Array(tauMax + 1));
    var tau, j;
    for (tau = 1; tau <= tauMax; tau++) {
      var s = 0;
      for (j = 0; j < W; j++) { var df = x[j] - x[j + tau]; s += df * df; }
      d[tau] = s;
    }
    // 累積平均正規化差分関数 (CMNDF)
    var run = 0;
    d[0] = 1;
    for (tau = 1; tau <= tauMax; tau++) {
      run += d[tau];
      d[tau] = run > 0 ? d[tau] * tau / run : 1;
    }
    var best = -1;
    for (tau = tauMin; tau <= tauMax; tau++) {
      if (d[tau] < threshold) {
        while (tau + 1 <= tauMax && d[tau + 1] < d[tau]) tau++;
        best = tau;
        break;
      }
    }
    if (best < 0) {
      // 閾値未満がない場合は全体最小値（信頼度は低く出る）
      var mv = Infinity;
      for (tau = tauMin; tau <= tauMax; tau++) if (d[tau] < mv) { mv = d[tau]; best = tau; }
    }
    var b = best;
    var shift = 0;
    if (b > 1 && b < tauMax) {
      var s0 = d[b - 1], s1 = d[b], s2 = d[b + 1];
      var den = s0 + s2 - 2 * s1;
      if (den !== 0) shift = 0.5 * (s0 - s2) / den;
      if (shift > 1 || shift < -1) shift = 0;
    }
    var clarity = Math.max(0, 1 - d[b]);
    return { f0: sr / (b + shift), clarity: clarity };
  }

  /**
   * 1 フレーム分の特徴量を計算する。
   * @param {Float32Array} frame 長さは 2 の冪
   * @param {number} sr サンプリング周波数
   */
  function analyzeFrame(frame, sr) {
    var n = frame.length;
    var i;
    // 時間領域
    var mean = 0;
    for (i = 0; i < n; i++) mean += frame[i];
    mean /= n;
    var sq = 0, zc = 0, prev = frame[0] - mean;
    for (i = 0; i < n; i++) {
      var v = frame[i] - mean;
      sq += v * v;
      if ((v >= 0) !== (prev >= 0)) zc++;
      prev = v;
    }
    var rms = Math.sqrt(sq / n);
    var db = 20 * Math.log10(rms + 1e-9);

    // 周波数領域
    var t = getTables(n);
    for (i = 0; i < n; i++) { t.re[i] = (frame[i] - mean) * t.win[i]; t.im[i] = 0; }
    fft(t.re, t.im, t);
    var half = n / 2, binHz = sr / n;
    var total = 0, wsum = 0, hf = 0, logSum = 0, linSum = 0, cnt = 0;
    var lo = Math.max(1, Math.round(80 / binHz));
    var hi = Math.min(half, Math.round(8000 / binHz));
    var flo = Math.round(250 / binHz), fhi = Math.min(half, Math.round(4000 / binHz));
    var hfBin = Math.round(1000 / binHz);
    for (i = lo; i <= hi; i++) {
      var p = t.re[i] * t.re[i] + t.im[i] * t.im[i];
      t.mag[i] = p;
      total += p;
      wsum += p * i * binHz;
      if (i >= hfBin) hf += p;
      if (i >= flo && i <= fhi) { logSum += Math.log(p + 1e-12); linSum += p; cnt++; }
    }
    var centroid = total > 0 ? wsum / total : 0;
    var hfRatio = total > 0 ? hf / total : 0;
    var flatness = cnt > 0 && linSum > 0 ? Math.exp(logSum / cnt) / (linSum / cnt) : 1;

    // ピッチ（~16kHz に間引いてから YIN）
    var factor = Math.max(1, Math.floor(sr / 16000));
    var key = 'dec' + n + '_' + factor;
    var dx = factor > 1 ? (cache[key] = decimate(frame, factor, cache[key])) : frame;
    var py = yin(dx, sr / factor, 70, 500, 0.15);

    return {
      rms: rms, db: db, zcr: zc / n,
      centroid: centroid, hfRatio: hfRatio, flatness: flatness,
      f0: py.f0, clarity: py.clarity
    };
  }

  /**
   * 音声バッファ全体をフレーム分析する（ファイル解析用）。
   * イベントループを塞がないよう、chunkMs ごとに await して進捗を返す。
   */
  function analyzeBuffer(samples, sr, opts) {
    opts = opts || {};
    var hopSec = opts.hopSec || 0.05;
    var n = frameSizeFor(sr, 0.04);
    var hop = Math.round(sr * hopSec);
    var frames = [];
    var total = Math.max(0, Math.floor((samples.length - n) / hop) + 1);
    var idx = 0;
    var onProgress = opts.onProgress || function () {};
    return new Promise(function (resolve) {
      function step() {
        var t0 = Date.now();
        while (idx < total && Date.now() - t0 < 30) {
          var start = idx * hop;
          var f = analyzeFrame(samples.subarray(start, start + n), sr);
          f.t = (start + n / 2) / sr;
          frames.push(f);
          idx++;
        }
        onProgress(total ? idx / total : 1);
        if (idx < total) setTimeout(step, 0); else resolve(frames);
      }
      step();
    });
  }

  var api = {
    analyzeFrame: analyzeFrame,
    analyzeBuffer: analyzeBuffer,
    frameSizeFor: frameSizeFor,
    yin: yin,
    decimate: decimate
  };
  root.VEDsp = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
