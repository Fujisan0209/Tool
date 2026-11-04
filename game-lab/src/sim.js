// 満足化・ゲーム理論ラボ: シミュレーションの中身（画面には触らない純粋な計算だけ）
// ブラウザでは window.GameLabSim、Node では require() で読み込めます。
(function (root) {
  "use strict";

  // ---------- 乱数（シードつき。同じ条件なら同じ結果になる） ----------
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // =====================================================================
  // 1. 満足化（探索をいつやめるか）
  // =====================================================================
  // 候補の良さは 0〜100 点。分布は3種類。
  const DISTS = {
    uniform: { name: "まんべんなく", draw: (r) => 100 * r() },
    normal: {
      name: "ふつうが多い",
      draw: (r) => {
        const u = 1 - r(), v = r();
        const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
        return Math.min(100, Math.max(0, 50 + 15 * z));
      },
    },
    rare: { name: "当たりはまれ", draw: (r) => 100 * Math.pow(r(), 3) },
  };

  // trials × n 個の候補をまとめて作る（全戦略で同じ候補を使い、比べやすくする）
  function sampleOptions(n, trials, dist, seed) {
    const r = mulberry32(seed);
    const draw = (DISTS[dist] || DISTS.uniform).draw;
    const v = new Float64Array(n * trials);
    for (let i = 0; i < v.length; i++) v[i] = draw(r);
    return v;
  }

  const SEARCH_STRATEGIES = [
    { id: "max", name: "最大化", short: "全部見て、いちばん良いものを選ぶ" },
    { id: "sat", name: "満足化", short: "要求水準を超えたら、そこで決める" },
    { id: "adapt", name: "妥協する満足化", short: "見るたびに要求水準を下げていく" },
    { id: "secretary", name: "見送りルール", short: "最初の一部は見送り、それより良いものが来たら決める" },
  ];

  // 1回分の探索。結果は [選んだ位置, 見た数]
  function searchOnce(v, off, n, id, p) {
    const recall = p.recall;
    let best = off; // 見た中で最良の位置
    if (id === "max") {
      if (!recall) return null; // 戻れないと「全部見てから選ぶ」はできない
      for (let i = off + 1; i < off + n; i++) if (v[i] > v[best]) best = i;
      return [best - off, n];
    }
    if (id === "sat" || id === "adapt") {
      const drop = id === "adapt" ? p.drop : 0;
      for (let k = 0; k < n; k++) {
        const i = off + k;
        if (v[i] > v[best]) best = i;
        if (v[i] >= p.aspiration - drop * k) return [k, k + 1];
      }
      return [recall ? best - off : n - 1, n];
    }
    if (id === "secretary") {
      const skip = Math.min(n - 1, Math.max(1, Math.round(n * p.skipRatio)));
      for (let k = 1; k < skip; k++) if (v[off + k] > v[best]) best = off + k;
      const bar = v[best];
      for (let k = skip; k < n; k++) {
        const i = off + k;
        if (v[i] > v[best]) best = i;
        if (v[i] > bar) return [k, k + 1];
      }
      return [recall ? best - off : n - 1, n];
    }
    throw new Error("unknown strategy " + id);
  }

  function quantile(sorted, q) {
    if (!sorted.length) return NaN;
    const x = (sorted.length - 1) * q, lo = Math.floor(x), hi = Math.ceil(x);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (x - lo);
  }

  // 1つの戦略を trials 回ためした成績
  function evaluateSearch(v, n, trials, id, p, withSpread) {
    const nets = withSpread ? new Float64Array(trials) : null;
    let sumV = 0, sumLook = 0, sumNet = 0, hit = 0;
    for (let t = 0; t < trials; t++) {
      const off = t * n;
      const res = searchOnce(v, off, n, id, p);
      if (!res) return null;
      const val = v[off + res[0]];
      const net = val - p.cost * res[1];
      sumV += val; sumLook += res[1]; sumNet += net;
      let mx = v[off];
      for (let i = off + 1; i < off + n; i++) if (v[i] > mx) mx = v[i];
      if (val === mx) hit++;
      if (nets) nets[t] = net;
    }
    const out = { value: sumV / trials, looked: sumLook / trials, net: sumNet / trials, bestRate: hit / trials };
    if (nets) {
      nets.sort();
      out.p10 = quantile(nets, 0.1);
      out.p50 = quantile(nets, 0.5);
      out.p90 = quantile(nets, 0.9);
    }
    return out;
  }

  // 条件をまとめて計算する（画面の「満足化」タブ1回分）
  function runSearchLab(cfg) {
    const { n, trials, dist, seed } = cfg;
    const v = sampleOptions(n, trials, dist, seed);
    const p = { cost: cfg.cost, recall: cfg.recall, aspiration: cfg.aspiration, drop: cfg.drop, skipRatio: cfg.skipRatio };
    const results = {};
    for (const s of SEARCH_STRATEGIES) results[s.id] = evaluateSearch(v, n, trials, s.id, p, true);

    // 要求水準を 0〜100 で動かしたときの、満足化の手取り
    const sweep = [];
    for (let a = 0; a <= 100; a += 2) {
      const r = evaluateSearch(v, n, trials, "sat", { ...p, aspiration: a }, false);
      sweep.push({ aspiration: a, net: r.net, looked: r.looked, value: r.value });
    }
    let bestA = sweep[0];
    for (const s of sweep) if (s.net > bestA.net) bestA = s;

    // 「1回分のようす」用に、最初の試行の候補と各戦略の決定位置
    const example = { values: Array.from(v.subarray(0, n)), picks: {} };
    for (const s of SEARCH_STRATEGIES) {
      const r = searchOnce(v, 0, n, s.id, p);
      example.picks[s.id] = r ? { index: r[0], looked: r[1] } : null;
    }
    return { results, sweep, bestAspiration: bestA, example };
  }

  // =====================================================================
  // 2. 2×2 ゲーム（ナッシュ均衡・最適反応・進化のながれ）
  // =====================================================================
  // A[i][j] = 行プレイヤーの得点、B[i][j] = 列プレイヤーの得点（i: 上/下, j: 左/右）
  function analyze2x2(A, B) {
    const nash = [], pareto = [];
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
      if (A[i][j] >= A[1 - i][j] && B[i][j] >= B[i][1 - j]) nash.push([i, j]);
      let dominated = false;
      for (let k = 0; k < 2; k++) for (let l = 0; l < 2; l++) {
        if (k === i && l === j) continue;
        if (A[k][l] >= A[i][j] && B[k][l] >= B[i][j] && (A[k][l] > A[i][j] || B[k][l] > B[i][j])) dominated = true;
      }
      if (!dominated) pareto.push([i, j]);
    }
    const rowDom = [0, 1].find((i) => A[i][0] > A[1 - i][0] && A[i][1] > A[1 - i][1]);
    const colDom = [0, 1].find((j) => B[0][j] > B[0][1 - j] && B[1][j] > B[1][1 - j]);

    // 混合戦略: 相手をちょうど迷わせる確率
    const dq = A[0][0] - A[0][1] - A[1][0] + A[1][1];
    const dp = B[0][0] - B[1][0] - B[0][1] + B[1][1];
    const q = dq !== 0 ? (A[1][1] - A[0][1]) / dq : NaN; // 列が「左」を選ぶ確率
    const p = dp !== 0 ? (B[1][1] - B[1][0]) / dp : NaN; // 行が「上」を選ぶ確率
    let mixed = null;
    if (p > 0 && p < 1 && q > 0 && q < 1) {
      const ev = (M) => p * q * M[0][0] + p * (1 - q) * M[0][1] + (1 - p) * q * M[1][0] + (1 - p) * (1 - q) * M[1][1];
      mixed = { p, q, rowPayoff: ev(A), colPayoff: ev(B) };
    }
    return {
      nash, pareto, mixed,
      rowDominant: rowDom === undefined ? null : rowDom,
      colDominant: colDom === undefined ? null : colDom,
    };
  }

  // 相手の混合確率に対する最適反応（折れ線の頂点）
  // 行: 横軸 q に対する p、列: 縦軸 p に対する q
  function bestResponses(A, B) {
    const rowGain = (q) => (A[0][0] * q + A[0][1] * (1 - q)) - (A[1][0] * q + A[1][1] * (1 - q));
    const colGain = (p) => (B[0][0] * p + B[1][0] * (1 - p)) - (B[0][1] * p + B[1][1] * (1 - p));
    return { row: brPath(rowGain), col: brPath(colGain) };
  }
  function brPath(gain) {
    const g0 = gain(0), g1 = gain(1), s = (g) => (g > 0 ? 1 : g < 0 ? 0 : 0.5);
    if (g0 === 0 && g1 === 0) return { indifferent: true, pts: [] };
    if (Math.sign(g0) === Math.sign(g1) || g0 === 0 || g1 === 0) {
      // 交差しない（または端で0）: ほぼ一定
      const v = s(g0 !== 0 ? g0 : g1);
      if (g0 === 0) return { pts: [[0, 0], [0, 1], [0, v], [1, v]] };
      if (g1 === 0) return { pts: [[0, v], [1, v], [1, 0], [1, 1]] };
      return { pts: [[0, v], [1, v]] };
    }
    const x = g0 / (g0 - g1);
    return { pts: [[0, s(g0)], [x, s(g0)], [x, s(g1)], [1, s(g1)]] };
  }

  // 2集団レプリケーター方程式の向き
  function replicator2(A, B, p, q) {
    const uU = A[0][0] * q + A[0][1] * (1 - q), uD = A[1][0] * q + A[1][1] * (1 - q);
    const vL = B[0][0] * p + B[1][0] * (1 - p), vR = B[0][1] * p + B[1][1] * (1 - p);
    return [p * (1 - p) * (uU - uD), q * (1 - q) * (vL - vR)];
  }
  // (p, q) から出発した軌道（RK4）
  function trajectory2(A, B, p0, q0, steps, dt) {
    steps = steps || 600; dt = dt || 0.02;
    const out = [[p0, q0]];
    let p = p0, q = q0;
    const scale = Math.max(1e-9, ...[0, 1].flatMap((i) => [0, 1].map((j) => Math.max(Math.abs(A[i][j]), Math.abs(B[i][j])))));
    const h = dt * 4 / scale;
    for (let s = 0; s < steps; s++) {
      const k1 = replicator2(A, B, p, q);
      const k2 = replicator2(A, B, p + h / 2 * k1[0], q + h / 2 * k1[1]);
      const k3 = replicator2(A, B, p + h / 2 * k2[0], q + h / 2 * k2[1]);
      const k4 = replicator2(A, B, p + h * k3[0], q + h * k3[1]);
      const np = Math.min(1, Math.max(0, p + h / 6 * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0])));
      const nq = Math.min(1, Math.max(0, q + h / 6 * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1])));
      if (Math.abs(np - p) + Math.abs(nq - q) < 1e-7) break;
      p = np; q = nq;
      out.push([p, q]);
    }
    return out;
  }

  // =====================================================================
  // 3. 繰り返し囚人のジレンマ（総当たり戦 → 進化）
  // =====================================================================
  const C = 0, D = 1;
  // 並び順 = 色の順番（色は戦略についていく。並べ替えても色は変わらない）
  const IPD_STRATEGIES = [
    { id: "tft", name: "しっぺ返し", desc: "最初は協力。あとは相手が前回したことをまねる" },
    { id: "alld", name: "いつも裏切る", desc: "毎回かならず裏切る" },
    { id: "wsls", name: "勝てば継続", desc: "うまくいけば同じ手、だめなら手を変える（パブロフ）" },
    { id: "grim", name: "トリガー", desc: "協力するが、一度でも裏切られたら永久に裏切る" },
    { id: "gtft", name: "寛大なしっぺ返し", desc: "しっぺ返しだが、裏切られても 1/3 の確率で許す" },
    { id: "allc", name: "いつも協力", desc: "毎回かならず協力する" },
    { id: "sat", name: "満足化", desc: "得点が要求水準以上なら同じ手、未満なら手を変える。要求水準は経験に合わせて動く" },
    { id: "rand", name: "でたらめ", desc: "半々の確率で協力か裏切り" },
  ];

  function payoffOf(pay, a, b) {
    // pay = {T, R, P, S}
    if (a === C) return b === C ? pay.R : pay.S;
    return b === C ? pay.T : pay.P;
  }

  function newState(id, cfg) {
    return { grim: false, asp: cfg.satAspiration, last: C, lastPay: null };
  }

  function decide(id, t, st, oppLast, r, cfg) {
    switch (id) {
      case "allc": return C;
      case "alld": return D;
      case "rand": return r() < 0.5 ? C : D;
      case "tft": return t === 0 ? C : oppLast;
      case "gtft": return t === 0 || oppLast === C ? C : r() < 1 / 3 ? C : D;
      case "grim": return st.grim ? D : C;
      case "wsls": {
        if (t === 0) return C;
        return st.lastPay >= cfg.pay.R ? st.last : 1 - st.last;
      }
      case "sat": {
        if (t === 0) return C;
        return st.lastPay >= st.asp ? st.last : 1 - st.last;
      }
    }
    throw new Error("unknown strategy " + id);
  }

  function afterRound(id, st, myMove, oppMove, myPay, cfg) {
    if (oppMove === D) st.grim = true;
    if (id === "sat") st.asp = (1 - cfg.satAdapt) * st.asp + cfg.satAdapt * myPay;
    st.last = myMove;
    st.lastPay = myPay;
  }

  // 1試合。戻り値: 1回あたりの平均得点と協力率
  function playMatch(ia, ib, cfg, r) {
    const sa = newState(ia, cfg), sb = newState(ib, cfg);
    let la = C, lb = C, ta = 0, tb = 0, ca = 0, cb = 0;
    for (let t = 0; t < cfg.rounds; t++) {
      let a = decide(ia, t, sa, lb, r, cfg);
      let b = decide(ib, t, sb, la, r, cfg);
      if (cfg.noise > 0) {
        if (r() < cfg.noise) a = 1 - a;
        if (r() < cfg.noise) b = 1 - b;
      }
      const pa = payoffOf(cfg.pay, a, b), pb = payoffOf(cfg.pay, b, a);
      afterRound(ia, sa, a, b, pa, cfg);
      afterRound(ib, sb, b, a, pb, cfg);
      ta += pa; tb += pb;
      if (a === C) ca++;
      if (b === C) cb++;
      la = a; lb = b;
    }
    const n = cfg.rounds;
    return [ta / n, tb / n, ca / n, cb / n];
  }

  // 総当たり戦。M[i][j] = 戦略 i が j と当たったときの1回あたり平均得点
  function tournament(ids, cfg) {
    const r = mulberry32(cfg.seed);
    const k = ids.length;
    const M = Array.from({ length: k }, () => new Array(k).fill(0));
    const coop = Array.from({ length: k }, () => new Array(k).fill(0));
    const reps = Math.max(1, cfg.reps);
    for (let i = 0; i < k; i++) for (let j = i; j < k; j++) {
      let si = 0, sj = 0, ci = 0, cj = 0;
      for (let rep = 0; rep < reps; rep++) {
        const res = playMatch(ids[i], ids[j], cfg, r);
        si += res[0]; sj += res[1]; ci += res[2]; cj += res[3];
      }
      if (i === j) {
        M[i][i] = (si + sj) / (2 * reps);
        coop[i][i] = (ci + cj) / (2 * reps);
      } else {
        M[i][j] = si / reps; M[j][i] = sj / reps;
        coop[i][j] = ci / reps; coop[j][i] = cj / reps;
      }
    }
    const scores = M.map((row, i) => {
      let s = 0, c = 0;
      for (let j = 0; j < k; j++) if (cfg.selfPlay || i !== j) { s += row[j]; c++; }
      return c ? s / c : 0;
    });
    return { ids, M, coop, scores };
  }

  // 離散レプリケーター・ダイナミクス: 得点が平均より高い戦略ほど増える
  function evolve(M, gens, mutation, x0) {
    const k = M.length;
    let x = x0 ? x0.slice() : new Array(k).fill(1 / k);
    let min = Infinity;
    for (const row of M) for (const v of row) if (v < min) min = v;
    const shift = -min + 0.1; // 適応度を正にする
    const hist = [x.slice()];
    for (let g = 0; g < gens; g++) {
      const f = M.map((row) => row.reduce((s, v, j) => s + v * x[j], 0) + shift);
      const mean = f.reduce((s, v, i) => s + v * x[i], 0);
      let nx = x.map((xi, i) => (xi * f[i]) / mean);
      if (mutation > 0) nx = nx.map((xi) => (1 - mutation) * xi + mutation / k);
      const sum = nx.reduce((a, b) => a + b, 0);
      x = nx.map((xi) => xi / sum);
      hist.push(x);
    }
    return hist;
  }

  // =====================================================================
  // 4. 空間ゲーム（格子の上の囚人のジレンマ: Nowak & May 1992）
  // =====================================================================
  // 各マスは 協力(1) か 裏切り(0)。自分＋まわり8マスと対戦し、
  // 協力相手1人につき 協力者は 1点、裏切り者は b 点もらう。
  function spatialCreate(L, cfg) {
    const r = mulberry32(cfg.seed);
    const g = new Uint8Array(L * L);
    if (cfg.start === "center") {
      g.fill(1);
      g[(L >> 1) * L + (L >> 1)] = 0;
    } else {
      for (let i = 0; i < g.length; i++) g[i] = r() < cfg.coopRatio ? 1 : 0;
    }
    return { L, g, prev: g.slice(), score: new Float64Array(L * L), cnt: new Uint8Array(L * L), r, t: 0 };
  }

  function spatialStep(S, cfg) {
    const { L, g, score, cnt, r } = S;
    const b = cfg.b;
    // まわり（自分を含む9マス）の協力者の数
    for (let y = 0; y < L; y++) {
      const ym = ((y + L - 1) % L) * L, y0 = y * L, yp = ((y + 1) % L) * L;
      for (let x = 0; x < L; x++) {
        const xm = (x + L - 1) % L, xp = (x + 1) % L;
        cnt[y0 + x] = g[ym + xm] + g[ym + x] + g[ym + xp] + g[y0 + xm] + g[y0 + x] + g[y0 + xp] + g[yp + xm] + g[yp + x] + g[yp + xp];
      }
    }
    for (let i = 0; i < g.length; i++) score[i] = g[i] ? cnt[i] : cnt[i] * b;

    S.prev.set(g);
    const prev = S.prev;
    const satisfice = cfg.rule === "satisfice";
    const need = cfg.aspiration * 9;
    for (let y = 0; y < L; y++) {
      const ym = ((y + L - 1) % L) * L, y0 = y * L, yp = ((y + 1) % L) * L;
      for (let x = 0; x < L; x++) {
        const me = y0 + x;
        if (satisfice && score[me] >= need) { g[me] = prev[me]; continue; }
        const xm = (x + L - 1) % L, xp = (x + 1) % L;
        let best = me, bs = score[me];
        const nb = [ym + xm, ym + x, ym + xp, y0 + xm, y0 + xp, yp + xm, yp + x, yp + xp];
        for (let k = 0; k < 8; k++) if (score[nb[k]] > bs) { bs = score[nb[k]]; best = nb[k]; }
        g[me] = prev[best];
      }
    }
    if (cfg.mutation > 0) for (let i = 0; i < g.length; i++) if (r() < cfg.mutation) g[i] = 1 - g[i];
    S.t++;
    let c = 0;
    for (let i = 0; i < g.length; i++) c += g[i];
    return c / g.length;
  }

  const api = {
    mulberry32, DISTS, SEARCH_STRATEGIES, sampleOptions, searchOnce, evaluateSearch, runSearchLab,
    analyze2x2, bestResponses, replicator2, trajectory2,
    IPD_STRATEGIES, payoffOf, playMatch, tournament, evolve,
    spatialCreate, spatialStep,
  };
  root.GameLabSim = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
