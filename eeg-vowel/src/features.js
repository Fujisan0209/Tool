// 脳波1試行 → 特徴量 → 母音ごとの確率。python/train.py と同じ計算をブラウザでします。
//   1. Welch 法でパワースペクトル密度（1秒の Hann 窓、半分ずつ重ねる。scipy.signal.welch と同じ）
//   2. 周波数帯ごとの平均パワーの対数
//   3. 学習データの平均・標準偏差で標準化 → 線形モデル → softmax
(function (root) {
  "use strict";

  const cache = new Map();
  function tables(n) {
    if (cache.has(n)) return cache.get(n);
    const win = new Float64Array(n);
    let wss = 0;
    for (let i = 0; i < n; i++) {
      win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n); // 周期的 Hann 窓（scipy の既定）
      wss += win[i] * win[i];
    }
    const nf = n / 2 + 1;
    const cos = new Float64Array(nf * n), sin = new Float64Array(nf * n);
    for (let k = 0; k < nf; k++)
      for (let i = 0; i < n; i++) {
        const a = (2 * Math.PI * k * i) / n;
        cos[k * n + i] = Math.cos(a);
        sin[k * n + i] = Math.sin(a);
      }
    const t = { win, wss, cos, sin, nf };
    cache.set(n, t);
    return t;
  }

  // x: 1チャンネル分の配列。返り値: 0..fs/2 Hz（1 Hz 刻み）のパワー
  function welch(x, fs) {
    const n = fs, step = n / 2;
    const { win, wss, cos, sin, nf } = tables(n);
    const out = new Float64Array(nf);
    const seg = new Float64Array(n);
    let count = 0;
    for (let s = 0; s + n <= x.length; s += step) {
      let mean = 0;
      for (let i = 0; i < n; i++) mean += x[s + i];
      mean /= n;
      for (let i = 0; i < n; i++) seg[i] = (x[s + i] - mean) * win[i];
      for (let k = 0; k < nf; k++) {
        let re = 0, im = 0;
        const o = k * n;
        for (let i = 0; i < n; i++) { re += seg[i] * cos[o + i]; im -= seg[i] * sin[o + i]; }
        let p = (re * re + im * im) / (fs * wss);
        if (k > 0 && k < nf - 1) p *= 2; // 片側スペクトル（n は偶数なのでナイキストは2倍しない）
        out[k] += p;
      }
      count++;
    }
    for (let k = 0; k < nf; k++) out[k] /= count;
    return out;
  }

  // trial: [6][サンプル] の配列、model: python/train.py の export_model() の形
  function features(trial, fs, model) {
    const a = Math.round(model.win[0] * fs), b = Math.round(model.win[1] * fs);
    const f = [];
    for (const ch of trial) {
      const P = welch(ch.subarray ? ch.subarray(a, b) : ch.slice(a, b), fs);
      for (const [lo, hi] of model.bands) {
        let sum = 0, cnt = 0;
        for (let k = 0; k < P.length; k++) {
          if (k >= lo && k < hi) { sum += P[k]; cnt++; } // 窓が1秒なので k 番目 = k Hz
        }
        f.push(Math.log(sum / cnt));
      }
    }
    return f;
  }

  function predict(trial, fs, model) {
    const f = features(trial, fs, model);
    const z = f.map((v, i) => (v - model.mean[i]) / model.std[i]);
    const logits = model.W.map((w, c) => w.reduce((s, wi, i) => s + wi * z[i], model.b[c]));
    const m = Math.max(...logits);
    const e = logits.map((v) => Math.exp(v - m));
    const sum = e.reduce((s, v) => s + v, 0);
    return { features: f, logits, proba: e.map((v) => v / sum) };
  }

  // base64 の int16（little endian, [ch][sample]）→ µV の Float64Array を6本
  function decodeTrial(b64, scale, nch) {
    let bin;
    if (typeof atob === "function") {
      const s = atob(b64);
      bin = new Uint8Array(s.length);
      for (let i = 0; i < s.length; i++) bin[i] = s.charCodeAt(i);
    } else {
      bin = new Uint8Array(Buffer.from(b64, "base64"));
    }
    const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
    const n = bin.byteLength / 2 / nch;
    const out = [];
    for (let c = 0; c < nch; c++) {
      const ch = new Float64Array(n);
      for (let i = 0; i < n; i++) ch[i] = dv.getInt16((c * n + i) * 2, true) * scale;
      out.push(ch);
    }
    return out;
  }

  const api = { welch, features, predict, decodeTrial };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.EegVowel = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
