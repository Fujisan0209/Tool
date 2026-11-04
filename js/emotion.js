/*
 * emotion.js — 韻律特徴から感情を推定する（ルールベース・話者適応）
 *
 * 流れ:
 *   フレーム特徴 (dsp.js) → 直近 1.5 秒の窓特徴 → 話者ベースラインで z 化
 *   → 感情ごとのスコア → softmax → 時間平滑化
 *
 * 感情は 5 クラス（覚醒度 arousal / 感情価 valence の円環モデル上に配置）:
 *   sad 悲しみ / neutral 平常 / joy 喜び / anxiety 不安 / anger 怒り
 *
 * 学習済みモデルではなく、音声感情研究で繰り返し報告されている傾向
 * （怒り=大きく鋭い声、喜び=高く抑揚が大きい、悲しみ=小さく平板で遅い、
 *  不安=高く揺れる・速い）をスコア式に落とし込んだもの。
 */
(function (root) {
  'use strict';

  var EMOTIONS = [
    { id: 'sad',     label: '悲しみ', emoji: '😢', a: -0.6, v: -0.55 },
    { id: 'neutral', label: '平常',   emoji: '😐', a: -0.1, v: 0.1 },
    { id: 'joy',     label: '喜び',   emoji: '😄', a: 0.55, v: 0.75 },
    { id: 'anxiety', label: '不安',   emoji: '😟', a: 0.45, v: -0.45 },
    { id: 'anger',   label: '怒り',   emoji: '😠', a: 0.85, v: -0.7 }
  ];

  // 窓特徴ごとの事前分布 (mean, sd) と事前の重み k（話者データ k 窓分の重さ）
  // k が小さいほど「話者ごとの差」が大きい特徴（声の高さ・マイク音量など）
  var PRIORS = {
    pitch:     { mean: 8.7,  sd: 2.5,  k: 10 },   // 半音 (100Hz 基準), 8.7 ≒ 165Hz
    pitchVar:  { mean: 2.2,  sd: 1.0,  k: 120 },  // 半音
    jitter:    { mean: 0.35, sd: 0.2,  k: 200 },  // ピッチ 2 階差分（半音）
    energy:    { mean: -30,  sd: 5,    k: 10 },   // dBFS
    energyVar: { mean: 5,    sd: 2,    k: 100 },  // dB
    centroid:  { mean: 10.2, sd: 0.4,  k: 30 },   // log2(Hz)
    hf:        { mean: 0.25, sd: 0.12, k: 60 },
    flat:      { mean: 0.15, sd: 0.08, k: 100 },
    rate:      { mean: 4,    sd: 1.5,  k: 120 }   // 音節ピーク / 秒
  };
  var KEYS = Object.keys(PRIORS);

  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }

  function quantile(sorted, q) {
    if (!sorted.length) return NaN;
    var pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }

  /**
   * 話者ベースライン。
   * 平均ではなく「中央値・MAD」を使う：感情が強く出た区間に基準が引っ張られず、
   * 普段の話し方（多くの時間を占める状態）が基準になる。
   * 履歴は 4 窓に 1 つ間引いて最大 maxN 個保持（≒ 60 秒）し、事前分布と重み付きで混ぜる。
   */
  function Baseline(maxN) {
    this.maxN = maxN || 300;
    this.hist = {};
    this.tick = 0;
    this.dirty = true;
    this.stats = {};
    for (var i = 0; i < KEYS.length; i++) this.hist[KEYS[i]] = [];
  }
  Baseline.prototype.update = function (f) {
    if ((this.tick++ & 3) !== 0) return;
    for (var i = 0; i < KEYS.length; i++) {
      var k = KEYS[i], x = f[k];
      if (!isFinite(x)) continue;
      var h = this.hist[k];
      h.push(x);
      if (h.length > this.maxN) h.shift();
    }
    this.dirty = true;
  };
  Baseline.prototype.compute = function () {
    for (var i = 0; i < KEYS.length; i++) {
      var k = KEYS[i], p = PRIORS[k], h = this.hist[k], n = h.length;
      if (!n) { this.stats[k] = { center: p.mean, sd: p.sd }; continue; }
      var s = h.slice().sort(function (a, b) { return a - b; });
      var med = quantile(s, 0.5);
      var dev = s.map(function (x) { return Math.abs(x - med); }).sort(function (a, b) { return a - b; });
      var rsd = 1.4826 * quantile(dev, 0.5);
      var w = n / (n + p.k / 4);
      this.stats[k] = {
        center: w * med + (1 - w) * p.mean,
        sd: Math.sqrt(w * rsd * rsd + (1 - w) * p.sd * p.sd)
      };
    }
    this.dirty = false;
  };
  Baseline.prototype.z = function (f) {
    if (this.dirty && (this.tick & 15) === 1 || !this.stats.pitch) this.compute();
    var out = {};
    for (var i = 0; i < KEYS.length; i++) {
      var k = KEYS[i], st = this.stats[k];
      var sd = Math.max(st.sd, PRIORS[k].sd * 0.5);
      out[k] = isFinite(f[k]) ? clamp((f[k] - st.center) / sd, -3, 3) : 0;
    }
    return out;
  };
  Baseline.prototype.freeze = function () { this.compute(); this.update = function () {}; return this; };

  /** z 化した窓特徴 → 感情ごとのスコア（logit） */
  function scores(z) {
    var mag = Math.sqrt((z.energy * z.energy + z.pitch * z.pitch + z.pitchVar * z.pitchVar +
      z.centroid * z.centroid + z.rate * z.rate) / 5);
    return {
      sad: -0.9 * z.energy - 0.7 * z.pitchVar - 0.4 * z.pitch - 0.5 * z.rate -
        0.4 * z.centroid - 0.3 * z.energyVar - 0.9,
      neutral: 1.2 - 0.8 * mag,
      joy: 0.8 * z.pitch + 0.9 * z.pitchVar + 0.5 * z.energy + 0.3 * z.rate +
        0.2 * z.energyVar - 0.4 * z.jitter - 0.3 * z.flat - 0.9,
      anxiety: 0.7 * z.pitch + 0.7 * z.jitter + 0.5 * z.rate - 0.4 * z.energy -
        0.3 * z.pitchVar + 0.2 * z.flat - 1.0,
      anger: 1.0 * z.energy + 0.6 * z.centroid + 0.5 * z.hf + 0.4 * z.jitter +
        0.2 * z.pitch + 0.3 * z.energyVar - 0.3 * z.pitchVar - 1.0
    };
  }

  function softmax(sc, temp) {
    var mx = -Infinity, i, id, out = {}, sum = 0;
    for (i = 0; i < EMOTIONS.length; i++) mx = Math.max(mx, sc[EMOTIONS[i].id]);
    for (i = 0; i < EMOTIONS.length; i++) {
      id = EMOTIONS[i].id;
      out[id] = Math.exp((sc[id] - mx) / temp);
      sum += out[id];
    }
    for (id in out) out[id] /= sum;
    return out;
  }

  /**
   * フレームを順に受け取り、感情推定結果を返すストリーム推定器。
   * opts: { hopSec, windowSec, smoothSec, baseline, adapt }
   */
  function Estimator(opts) {
    opts = opts || {};
    this.hop = opts.hopSec || 0.05;
    this.winN = Math.round((opts.windowSec || 1.5) / this.hop);
    this.alpha = Math.min(1, this.hop / (opts.smoothSec || 0.7));
    this.baseline = opts.baseline || new Baseline();
    this.adapt = opts.adapt !== false;
    this.buf = [];
    this.noise = null;
    this.probs = null;
  }

  Estimator.prototype.push = function (fr) {
    // ノイズフロア追従: 下には即追従、上にはゆっくり (1 dB/s)
    if (this.noise === null) this.noise = Math.min(fr.db, -50);
    else this.noise = Math.min(fr.db, this.noise + 1 * this.hop);
    var periodic = fr.clarity >= 0.7 && fr.f0 >= 70 && fr.f0 <= 500;
    // 発話判定: 雑音より十分大きい、または周期性が強く雑音より大きい
    var active = fr.db > -62 && (fr.db > this.noise + 9 || (periodic && fr.clarity >= 0.8 && fr.db > this.noise + 3));
    var voiced = active && periodic;
    var item = { db: fr.db, f0: fr.f0, centroid: fr.centroid, hf: fr.hfRatio,
      flat: fr.flatness, active: active, voiced: voiced };
    this.buf.push(item);
    if (this.buf.length > this.winN) this.buf.shift();

    var res = { t: fr.t, active: false, db: fr.db, f0: voiced ? fr.f0 : 0, probs: null };
    var wf = this.windowFeatures();
    if (!active || !wf) return res;

    if (this.adapt) this.baseline.update(wf);
    var z = this.baseline.z(wf);
    var p = softmax(scores(z), 0.8);
    if (!this.probs) this.probs = p;
    else for (var id in p) this.probs[id] += this.alpha * (p[id] - this.probs[id]);

    var probs = {}, a = 0, v = 0, best = null;
    for (var i = 0; i < EMOTIONS.length; i++) {
      var e = EMOTIONS[i];
      probs[e.id] = this.probs[e.id];
      a += probs[e.id] * e.a;
      v += probs[e.id] * e.v;
      if (!best || probs[e.id] > probs[best]) best = e.id;
    }
    res.active = true;
    res.probs = probs;
    res.arousal = a;
    res.valence = v;
    res.dominant = best;
    res.features = wf;
    res.z = z;
    return res;
  };

  /** 直近窓から韻律特徴を作る。発話が少なすぎる窓は null。 */
  Estimator.prototype.windowFeatures = function () {
    var b = this.buf, n = b.length, i;
    if (n < Math.min(10, this.winN)) return null;
    var act = 0, vo = [], dbs = [], cen = 0, hf = 0, flat = 0, nf = 0, jit = 0, nj = 0;
    // jitter: ピッチ軌跡の 2 階差分（滑らかな抑揚は除き、細かな揺れだけを見る）
    var p1 = null, p2 = null;
    for (i = 0; i < n; i++) {
      var x = b[i];
      if (x.active) { act++; dbs.push(x.db); cen += x.centroid; hf += x.hf; }
      if (x.voiced) {
        var st = 12 * Math.log2(x.f0 / 100);
        vo.push(st);
        flat += x.flat; nf++;
        if (p1 !== null && p2 !== null) { jit += Math.min(3, Math.abs(p1 - (p2 + st) / 2)); nj++; }
        p2 = p1; p1 = st;
      } else { p1 = null; p2 = null; }
    }
    if (act < n * 0.3 || vo.length < 5) return null;
    vo.sort(function (p, q) { return p - q; });
    var em = 0;
    for (i = 0; i < dbs.length; i++) em += dbs[i];
    em /= dbs.length;
    var ev = 0;
    for (i = 0; i < dbs.length; i++) ev += (dbs[i] - em) * (dbs[i] - em);
    ev = Math.sqrt(ev / dbs.length);

    // 音節レート: 音量包絡のピーク数（直前の谷から 3dB 以上の山）
    var sm = new Array(n);
    for (i = 0; i < n; i++) sm[i] = b[i].db;
    var peaks = 0, valley = Infinity;
    for (i = 1; i < n - 1; i++) {
      if (sm[i] < valley) valley = sm[i];
      if (b[i].active && sm[i] >= sm[i - 1] && sm[i] > sm[i + 1] && sm[i] - valley >= 3) {
        peaks++;
        valley = sm[i];
      }
    }
    var mc = cen / act;
    return {
      pitch: quantile(vo, 0.5),
      pitchVar: (quantile(vo, 0.9) - quantile(vo, 0.1)) / 2.56,
      jitter: nj ? jit / nj : NaN,
      energy: em,
      energyVar: ev,
      centroid: Math.log2(Math.max(mc, 50)),
      hf: hf / act,
      flat: nf ? flat / nf : NaN,
      rate: peaks / (n * this.hop)
    };
  };

  /**
   * ファイル解析: 1 パス目で話者ベースラインを全体から学習し、
   * 2 パス目でそれを固定して推定する（序盤も後半と同じ基準で評価できる）。
   */
  function estimateAll(frames, hopSec) {
    var warm = new Estimator({ hopSec: hopSec, baseline: new Baseline(Infinity) });
    for (var i = 0; i < frames.length; i++) warm.push(frames[i]);
    var est = new Estimator({ hopSec: hopSec, baseline: warm.baseline.freeze(), adapt: false });
    var out = new Array(frames.length);
    for (var j = 0; j < frames.length; j++) out[j] = est.push(frames[j]);
    return out;
  }

  /** 推定結果列の集計（支配的感情ごとの発話時間・平均確率） */
  function summarize(results, hopSec) {
    var dom = {}, avg = {}, n = 0, i, id;
    for (i = 0; i < EMOTIONS.length; i++) { dom[EMOTIONS[i].id] = 0; avg[EMOTIONS[i].id] = 0; }
    for (i = 0; i < results.length; i++) {
      var r = results[i];
      if (!r || !r.active) continue;
      n++;
      dom[r.dominant] += hopSec;
      for (id in r.probs) avg[id] += r.probs[id];
    }
    if (n) for (id in avg) avg[id] /= n;
    return { speechSec: n * hopSec, dominantSec: dom, meanProb: avg };
  }

  var api = {
    EMOTIONS: EMOTIONS, PRIORS: PRIORS, Baseline: Baseline, Estimator: Estimator,
    estimateAll: estimateAll, summarize: summarize, scores: scores, softmax: softmax
  };
  root.VEEmotion = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
