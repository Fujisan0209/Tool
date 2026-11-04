/*
 * demo.js — 動作確認用の「声っぽい」合成音声
 * 倍音列（tilt で明るさ）+ 気息ノイズ + 音節包絡 + 抑揚・揺らぎ で
 * 各感情の典型的な韻律を真似る。テストとブラウザのデモの両方で使う。
 */
(function (root) {
  'use strict';

  var PRESETS = {
    neutral: { f0: 150, var: 3.3, varHz: 0.6, amp: 0.12, tilt: 0.75, syl: 4,   jit: 0.4, breath: 0.08 },
    joy:     { f0: 200, var: 6,   varHz: 1.1, amp: 0.2,  tilt: 0.85, syl: 5,   jit: 0.4, breath: 0.08 },
    anger:   { f0: 175, var: 2.5, varHz: 0.8, amp: 0.45, tilt: 0.55, syl: 5,   jit: 1.4, breath: 0.15 },
    sad:     { f0: 130, var: 0.8, varHz: 0.4, amp: 0.04, tilt: 1.3,  syl: 2.5, jit: 0.3, breath: 0.1 },
    anxiety: { f0: 195, var: 1.2, varHz: 5,   amp: 0.08, tilt: 1.0,  syl: 6,   jit: 1.6, breath: 0.12 }
  };

  function rng(seed) {
    var s = seed || 1;
    return function () { s = (s * 16807) % 2147483647; return s / 2147483647; };
  }

  /** syl は 1 秒あたりの音節数。2 秒ごとに 0.3 秒の息継ぎを入れる。 */
  function synth(sr, sec, o, rnd) {
    var n = Math.floor(sr * sec), out = new Float32Array(n);
    var ph = 0, lp = 0, jitter = 0, hop = Math.round(sr / 100);
    for (var i = 0; i < n; i++) {
      var t = i / sr;
      if (i % hop === 0) jitter = (o.jit || 0) * (rnd() - 0.5);
      var semis = o.var * Math.sin(2 * Math.PI * o.varHz * t) + jitter;
      var f0 = o.f0 * Math.pow(2, semis / 12);
      ph += 2 * Math.PI * f0 / sr;
      var s = 0;
      for (var h = 1; h * f0 < Math.min(7000, sr / 2); h++) s += Math.sin(h * ph) / Math.pow(h, o.tilt);
      var w = rnd() - 0.5;
      lp += 0.3 * (w - lp);
      var breath = (w - lp) * (o.breath || 0.05);
      var env = Math.pow(Math.abs(Math.sin(Math.PI * o.syl * t)), 0.6) * ((t % 2) < 1.7 ? 1 : 0);
      out[i] = o.amp * env * (s * 0.4 + breath) + 0.0005 * (rnd() - 0.5);
    }
    return out;
  }

  /**
   * 区間ごとに感情を切り替えた合成音声を作る。
   * @returns {{samples: Float32Array, segments: {id:string, start:number, end:number}[]}}
   */
  function makeDemo(sr, order, segSec, seed) {
    order = order || ['neutral', 'joy', 'neutral', 'anger', 'neutral', 'sad', 'neutral', 'anxiety'];
    segSec = segSec || 6;
    var rnd = rng(seed || 1);
    var parts = order.map(function (k) { return synth(sr, segSec, PRESETS[k], rnd); });
    var len = parts.reduce(function (a, p) { return a + p.length; }, 0);
    var out = new Float32Array(len), off = 0;
    parts.forEach(function (p) { out.set(p, off); off += p.length; });
    return {
      samples: out,
      segments: order.map(function (id, i) { return { id: id, start: i * segSec, end: (i + 1) * segSec }; })
    };
  }

  var api = { PRESETS: PRESETS, synth: synth, makeDemo: makeDemo, rng: rng };
  root.VEDemo = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
