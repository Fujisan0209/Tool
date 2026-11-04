/*
 * 満足化とゲーム理論のシミュレーション（計算だけ）。DOM は使いません（Node でもテストできます）。
 *
 *   satisficing  … 候補を1つずつ見て、どこで止めるか（満足化・最大化・37%ルール・最適停止）
 *   game2x2      … 2×2ゲームの均衡分析と、レプリケーター動態・学習のシミュレーション
 *   ipd          … くり返し囚人のジレンマの総当たり大会と、戦略の割合の進化
 *   spatial      … 格子の上で隣とだけ遊ぶ囚人のジレンマ（Nowak–May 型）
 *
 * 乱数はすべて seed 付き（同じ seed なら同じ結果）。
 */
(function (root) {
  "use strict";

  // ---------------------------------------------------------------- 乱数
  function rng(seed) {
    // mulberry32
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function gauss(r) {
    let u = 0;
    while (u === 0) u = r();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
  }
  const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

  // ================================================================ 満足化
  const DISTS = {
    uniform: { label: "一様（どの値も同じくらい）", draw: (r) => 100 * r() },
    normal: { label: "山なり（平凡が多い）", draw: (r) => clamp(50 + 15 * gauss(r), 0, 100) },
    rare: { label: "まれに大当たり", draw: (r) => 100 * Math.pow(r(), 3) },
    mostly: { label: "ほとんど良い", draw: (r) => 100 * (1 - Math.pow(r(), 3)) },
  };

  /** trials 回ぶんの「候補の列」を作る。truth=本当の値、seen=見えた値（ノイズ入り） */
  function makeTrials({ n, trials, dist = "uniform", noise = 0, seed = 1 }) {
    const r = rng(seed);
    const draw = (DISTS[dist] || DISTS.uniform).draw;
    const truth = new Float64Array(trials * n);
    const seen = new Float64Array(trials * n);
    for (let i = 0; i < truth.length; i++) {
      const v = draw(r);
      truth[i] = v;
      seen[i] = noise > 0 ? v + noise * gauss(r) : v;
    }
    return { n, trials, truth, seen, dist };
  }

  /** 分布を知っている人の最適停止のしきい値（戻れない前提、後ろ向き帰納法） */
  function optimalThresholds(n, cost, dist = "uniform", seed = 99) {
    const M = 20000;
    const r = rng(seed);
    const draw = (DISTS[dist] || DISTS.uniform).draw;
    const s = new Float64Array(M);
    for (let i = 0; i < M; i++) s[i] = draw(r);
    s.sort();
    const suffix = new Float64Array(M + 1); // suffix[i] = s[i] + ... + s[M-1]
    for (let i = M - 1; i >= 0; i--) suffix[i] = suffix[i + 1] + s[i];
    const eMax = (t) => {
      // E[max(X, t)]
      let lo = 0, hi = M;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (s[mid] < t) lo = mid + 1; else hi = mid;
      }
      return (t * lo + suffix[lo]) / M;
    };
    // C[k] = k 番目を見る直前の「この先の期待手取り」（k 番目以降の探索コストを含む）
    const C = new Float64Array(n + 1);
    C[n - 1] = suffix[0] / M - cost;
    for (let k = n - 2; k >= 0; k--) C[k] = eMax(C[k + 1]) - cost;
    const th = new Float64Array(n);
    for (let k = 0; k < n - 1; k++) th[k] = C[k + 1];
    th[n - 1] = -Infinity;
    return { thresholds: th, expected: C[0] };
  }

  function argmaxSeen(seen, base, upto) {
    let best = base;
    for (let k = base + 1; k < base + upto; k++) if (seen[k] > seen[best]) best = k;
    return best - base;
  }

  /**
   * 1回ぶんの探索。戻り値 { looked: 見た数, pick: 選んだ位置 }
   * strategy: { kind: "satisfice", aspiration, drop } | { kind: "maximize" } | { kind: "secretary" } | { kind: "optimal", thresholds }
   */
  function searchOnce(T, t, strategy, recall) {
    const { n, seen } = T;
    const base = t * n;
    switch (strategy.kind) {
      case "maximize":
        return { looked: n, pick: argmaxSeen(seen, base, n) };
      case "secretary": {
        const m = Math.max(1, Math.round(n / Math.E));
        if (m >= n) return { looked: n, pick: argmaxSeen(seen, base, n) };
        let bestSeen = -Infinity;
        for (let k = 0; k < m; k++) if (seen[base + k] > bestSeen) bestSeen = seen[base + k];
        for (let k = m; k < n; k++) if (seen[base + k] > bestSeen) return { looked: k + 1, pick: k };
        return { looked: n, pick: recall ? argmaxSeen(seen, base, n) : n - 1 };
      }
      case "optimal": {
        const th = strategy.thresholds;
        for (let k = 0; k < n; k++) if (seen[base + k] >= th[k]) return { looked: k + 1, pick: k };
        return { looked: n, pick: n - 1 };
      }
      default: {
        // 満足化: 願望水準 A 以上の最初の候補で止まる。drop>0 なら1つ見るごとに A を下げる（妥協）
        const A = strategy.aspiration, d = strategy.drop || 0;
        for (let k = 0; k < n; k++) if (seen[base + k] >= A - d * k) return { looked: k + 1, pick: k };
        return { looked: n, pick: recall ? argmaxSeen(seen, base, n) : n - 1 };
      }
    }
  }

  /** ある戦略を全試行で評価する */
  function evaluate(T, strategy, cost, recall, keepNet) {
    const { n, trials, truth } = T;
    let sumNet = 0, sumVal = 0, sumLook = 0, hitBest = 0;
    const nets = keepNet ? new Float64Array(trials) : null;
    for (let t = 0; t < trials; t++) {
      const { looked, pick } = searchOnce(T, t, strategy, recall);
      const base = t * n;
      const v = truth[base + pick];
      let bestTrue = truth[base];
      for (let k = 1; k < n; k++) if (truth[base + k] > bestTrue) bestTrue = truth[base + k];
      const net = v - cost * looked;
      sumNet += net; sumVal += v; sumLook += looked;
      if (v >= bestTrue) hitBest++;
      if (nets) nets[t] = net;
    }
    return { net: sumNet / trials, value: sumVal / trials, looked: sumLook / trials, pBest: hitBest / trials, nets };
  }

  /** 願望水準を 0〜100 で動かしたときの平均手取り（共通の乱数で比べるので曲線がなめらか） */
  function sweepAspiration(T, cost, drop, recall, step = 1) {
    const xs = [], net = [], looked = [];
    let best = { a: 0, net: -Infinity };
    for (let a = 0; a <= 100 + 1e-9; a += step) {
      const e = evaluate(T, { kind: "satisfice", aspiration: a, drop }, cost, recall);
      xs.push(a); net.push(e.net); looked.push(e.looked);
      if (e.net > best.net) best = { a, net: e.net };
    }
    return { xs, net, looked, best };
  }

  /** 満足化タブ用: すべての戦略をまとめて評価 */
  function runSatisficing(p) {
    const T = makeTrials(p);
    const opt = optimalThresholds(p.n, p.cost, p.dist);
    const strategies = {
      satisfice: { kind: "satisfice", aspiration: p.aspiration, drop: 0 },
      adaptive: { kind: "satisfice", aspiration: p.aspiration, drop: p.drop },
      maximize: { kind: "maximize" },
      secretary: { kind: "secretary" },
      optimal: { kind: "optimal", thresholds: opt.thresholds },
    };
    const results = {};
    for (const [k, s] of Object.entries(strategies)) results[k] = evaluate(T, s, p.cost, p.recall, true);
    const sweep = sweepAspiration(T, p.cost, 0, p.recall);
    const sweepAdaptive = p.drop > 0 ? sweepAspiration(T, p.cost, p.drop, p.recall) : null;
    // 例として見せる1回ぶん
    const ex = p.exampleIndex % p.trials;
    const example = {
      truth: Array.from(T.truth.subarray(ex * p.n, ex * p.n + p.n)),
      seen: Array.from(T.seen.subarray(ex * p.n, ex * p.n + p.n)),
      stops: Object.fromEntries(Object.entries(strategies).map(([k, s]) => [k, searchOnce(T, ex, s, p.recall)])),
    };
    return { results, sweep, sweepAdaptive, optimal: opt, example, strategies };
  }

  // ================================================================ 2×2ゲーム
  // g.a[i][j] = 行プレイヤー（A）の利得、g.b[i][j] = 列プレイヤー（B）の利得。i=0:上 1:下、j=0:左 1:右
  const GAMES = {
    pd: { label: "囚人のジレンマ", rows: ["協力", "裏切り"], cols: ["協力", "裏切り"], a: [[3, 0], [5, 1]], b: [[3, 5], [0, 1]],
      note: "2人とも裏切るのが唯一の均衡。でも2人とも協力したほうが、どちらにとっても得です。" },
    stag: { label: "鹿狩り", rows: ["鹿", "うさぎ"], cols: ["鹿", "うさぎ"], a: [[4, 0], [3, 3]], b: [[4, 3], [0, 3]],
      note: "均衡が2つ。大きな得（鹿）は相手を信じないと取れず、安全な手（うさぎ）は小さな得で確実。" },
    chicken: { label: "チキンゲーム", rows: ["よける", "突っこむ"], cols: ["よける", "突っこむ"], a: [[3, 1], [4, 0]], b: [[3, 4], [1, 0]],
      note: "相手と逆の手を取るのが均衡。どちらが譲るかで争いになり、混合戦略の均衡もあります。" },
    bos: { label: "男女の争い", rows: ["映画", "野球"], cols: ["映画", "野球"], a: [[3, 0], [0, 2]], b: [[2, 0], [0, 3]],
      note: "一緒に行きたいが、行き先の好みがちがう。どちらの均衡に落ちつくかで得をする人が変わります。" },
    coord: { label: "調整ゲーム", rows: ["左側通行", "右側通行"], cols: ["左側通行", "右側通行"], a: [[2, 0], [0, 1]], b: [[2, 0], [0, 1]],
      note: "そろえば得をする。どちらにそろっても均衡ですが、2つの均衡の良さがちがいます。" },
    pennies: { label: "コイン合わせ", rows: ["表", "裏"], cols: ["表", "裏"], a: [[1, -1], [-1, 1]], b: [[-1, 1], [1, -1]],
      note: "純粋戦略の均衡がなく、半々で出すのが唯一の均衡。動態は均衡のまわりを回ります。" },
    hawkdove: { label: "タカとハト", rows: ["タカ", "ハト"], cols: ["タカ", "ハト"], a: [[-1, 4], [0, 2]], b: [[-1, 0], [4, 2]],
      note: "資源の価値 V=4、けんかの損 C=6 の例。けんかが高くつくほど、ハトが増えます。" },
  };

  function analyze2x2(g) {
    const { a, b } = g;
    const nash = [];
    const rowBR = [[], []], colBR = [[], []]; // rowBR[j] = 列 j に対する A の最適反応（行の集合）
    for (let j = 0; j < 2; j++) {
      const m = Math.max(a[0][j], a[1][j]);
      for (let i = 0; i < 2; i++) if (a[i][j] === m) rowBR[j].push(i);
    }
    for (let i = 0; i < 2; i++) {
      const m = Math.max(b[i][0], b[i][1]);
      for (let j = 0; j < 2; j++) if (b[i][j] === m) colBR[i].push(j);
    }
    for (let i = 0; i < 2; i++)
      for (let j = 0; j < 2; j++) if (rowBR[j].includes(i) && colBR[i].includes(j)) nash.push([i, j]);

    const dominant = { row: null, col: null };
    for (let i = 0; i < 2; i++) if (a[i][0] > a[1 - i][0] && a[i][1] > a[1 - i][1]) dominant.row = i;
    for (let j = 0; j < 2; j++) if (b[0][j] > b[0][1 - j] && b[1][j] > b[1][1 - j]) dominant.col = j;

    const pareto = [];
    for (let i = 0; i < 2; i++)
      for (let j = 0; j < 2; j++) {
        let dominated = false;
        for (let k = 0; k < 2; k++)
          for (let l = 0; l < 2; l++)
            if (a[k][l] >= a[i][j] && b[k][l] >= b[i][j] && (a[k][l] > a[i][j] || b[k][l] > b[i][j])) dominated = true;
        if (!dominated) pareto.push([i, j]);
      }

    // 混合戦略: p = A が上を出す確率、q = B が左を出す確率
    let mixed = null;
    const dq = a[0][0] - a[0][1] - a[1][0] + a[1][1];
    const dp = b[0][0] - b[1][0] - b[0][1] + b[1][1];
    if (dq !== 0 && dp !== 0) {
      const q = (a[1][1] - a[0][1]) / dq;
      const p = (b[1][1] - b[1][0]) / dp;
      if (p > 0 && p < 1 && q > 0 && q < 1) {
        mixed = { p, q, payA: a[0][0] * q + a[0][1] * (1 - q), payB: b[0][0] * p + b[1][0] * (1 - p) };
      }
    }
    return { nash, dominant, pareto, mixed, rowBR, colBR };
  }

  /** 2集団レプリケーター動態の向き (dp/dt, dq/dt) */
  function replicatorField(g, p, q) {
    const { a, b } = g;
    const fa = (a[0][0] - a[1][0]) * q + (a[0][1] - a[1][1]) * (1 - q);
    const fb = (b[0][0] - b[0][1]) * p + (b[1][0] - b[1][1]) * (1 - p);
    return [p * (1 - p) * fa, q * (1 - q) * fb];
  }

  function replicatorPath(g, p0, q0, steps = 1500, dt = 0.02) {
    const out = [[p0, q0]];
    let p = p0, q = q0;
    for (let s = 0; s < steps; s++) {
      const k1 = replicatorField(g, p, q);
      const k2 = replicatorField(g, p + (dt / 2) * k1[0], q + (dt / 2) * k1[1]);
      const k3 = replicatorField(g, p + (dt / 2) * k2[0], q + (dt / 2) * k2[1]);
      const k4 = replicatorField(g, p + dt * k3[0], q + dt * k3[1]);
      p = clamp(p + (dt / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]), 0, 1);
      q = clamp(q + (dt / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]), 0, 1);
      out.push([p, q]);
    }
    return out;
  }

  /**
   * 満足化学習（願望水準つきの強化学習: Bush–Mosteller 型）
   * 得点が願望水準以上なら、いま出した手を出す確率を上げる。下回ったら下げる。
   * 願望水準は h の速さで、最近の得点に近づく（h=0 なら固定）。
   */
  function aspirationLearning(g, { p0, q0, rounds = 2000, rate = 0.1, aspA, aspB, habit = 0, seed = 1 }) {
    const r = rng(seed);
    const { a, b } = g;
    const flatA = a.flat(), flatB = b.flat();
    let p = p0, q = q0, AA = aspA, AB = aspB;
    const path = [[p, q]];
    const asp = [[AA, AB]];
    const counts = [[0, 0], [0, 0]];
    const tail = Math.floor(rounds * 0.8);
    for (let t = 0; t < rounds; t++) {
      const i = r() < p ? 0 : 1;
      const j = r() < q ? 0 : 1;
      const pa = a[i][j], pb = b[i][j];
      const sa = (pa - AA) / Math.max(1e-9, ...flatA.map((x) => Math.abs(x - AA)));
      const sb = (pb - AB) / Math.max(1e-9, ...flatB.map((x) => Math.abs(x - AB)));
      // 選んだ手の確率を更新
      let pi = i === 0 ? p : 1 - p;
      pi = sa >= 0 ? pi + rate * sa * (1 - pi) : pi + rate * sa * pi;
      p = i === 0 ? pi : 1 - pi;
      let qj = j === 0 ? q : 1 - q;
      qj = sb >= 0 ? qj + rate * sb * (1 - qj) : qj + rate * sb * qj;
      q = j === 0 ? qj : 1 - qj;
      AA += habit * (pa - AA);
      AB += habit * (pb - AB);
      path.push([p, q]);
      asp.push([AA, AB]);
      if (t >= tail) counts[i][j]++;
    }
    return { path, aspiration: asp, counts };
  }

  /** 仮想プレイ: 相手のこれまでの出し方の割合に対して、最適反応を出す */
  function fictitiousPlay(g, { p0, q0, rounds = 2000, seed = 1 }) {
    const r = rng(seed);
    const { a, b } = g;
    let nA = [p0, 1 - p0], nB = [q0, 1 - q0]; // 重み1の事前の数
    const path = [[p0, q0]];
    const counts = [[0, 0], [0, 0]];
    const tail = Math.floor(rounds * 0.8);
    for (let t = 0; t < rounds; t++) {
      const q = nB[0] / (nB[0] + nB[1]);
      const p = nA[0] / (nA[0] + nA[1]);
      const u0 = a[0][0] * q + a[0][1] * (1 - q), u1 = a[1][0] * q + a[1][1] * (1 - q);
      const v0 = b[0][0] * p + b[1][0] * (1 - p), v1 = b[0][1] * p + b[1][1] * (1 - p);
      const i = u0 > u1 ? 0 : u1 > u0 ? 1 : r() < 0.5 ? 0 : 1;
      const j = v0 > v1 ? 0 : v1 > v0 ? 1 : r() < 0.5 ? 0 : 1;
      nA[i]++; nB[j]++;
      path.push([nA[0] / (nA[0] + nA[1]), nB[0] / (nB[0] + nB[1])]);
      if (t >= tail) counts[i][j]++;
    }
    return { path, counts };
  }

  // ================================================================ くり返し囚人のジレンマ
  // 手: 1 = 協力 (C), 0 = 裏切り (D)
  const IPD_STRATEGIES = [
    { id: "tft", name: "しっぺ返し", desc: "最初は協力。あとは相手の前の手をまねる。",
      make: () => (t, my, op) => (t === 0 ? 1 : op) },
    { id: "alld", name: "いつも裏切り", desc: "ずっと裏切る。",
      make: () => () => 0 },
    { id: "wsls", name: "パブロフ", desc: "勝てば同じ手、負ければ手を変える（願望水準 R の満足化と同じ）。",
      make: () => (t, my, op, pay, P) => (t === 0 ? 1 : pay >= P.R ? my : 1 - my) },
    { id: "sat", name: "満足化", desc: "得点が願望水準以上なら同じ手、下回ったら手を変える。",
      make: (prm) => {
        let A = prm.aspiration;
        return (t, my, op, pay) => {
          if (t === 0) return 1;
          const keep = pay >= A;
          A += prm.habit * (pay - A);
          return keep ? my : 1 - my;
        };
      } },
    { id: "allc", name: "いつも協力", desc: "ずっと協力する。",
      make: () => () => 1 },
    { id: "grim", name: "恨み続ける", desc: "1回でも裏切られたら、そのあとずっと裏切る。",
      make: () => {
        let mad = false;
        return (t, my, op) => {
          if (t > 0 && op === 0) mad = true;
          return mad ? 0 : 1;
        };
      } },
    { id: "gtft", name: "寛容なしっぺ返し", desc: "しっぺ返しだが、裏切られても 1/3 の確率で許す。",
      make: (prm, r) => (t, my, op) => (t === 0 || op === 1 ? 1 : r() < 1 / 3 ? 1 : 0) },
    { id: "rand", name: "でたらめ", desc: "半々の確率で協力か裏切り。",
      make: (prm, r) => () => (r() < 0.5 ? 1 : 0) },
  ];

  function ipdPay(P, me, op) {
    return me ? (op ? P.R : P.S) : op ? P.T : P.P;
  }

  /** 1試合。戻り値は1ラウンドあたりの平均得点 [x, y] と協力率 */
  function playMatch(sx, sy, P, rounds, noise, prm, r) {
    const fx = sx.make(prm, r), fy = sy.make(prm, r);
    let mx = 1, my = 1, px = 0, py = 0, tx = 0, ty = 0, coop = 0;
    for (let t = 0; t < rounds; t++) {
      let ax = fx(t, mx, my, px, P);
      let ay = fy(t, my, mx, py, P);
      if (noise > 0) {
        if (r() < noise) ax = 1 - ax;
        if (r() < noise) ay = 1 - ay;
      }
      px = ipdPay(P, ax, ay);
      py = ipdPay(P, ay, ax);
      tx += px; ty += py; coop += ax + ay;
      mx = ax; my = ay;
    }
    return [tx / rounds, ty / rounds, coop / (2 * rounds)];
  }

  /** 総当たり（自分自身との対戦も含む）。M[i][j] = i が j と戦ったときの平均得点 */
  function tournament({ ids, payoff: P, rounds = 200, noise = 0, reps = 10, aspiration = 2, habit = 0, seed = 1 }) {
    const r = rng(seed);
    const strats = ids.map((id) => IPD_STRATEGIES.find((s) => s.id === id)).filter(Boolean);
    const k = strats.length;
    const M = Array.from({ length: k }, () => new Array(k).fill(0));
    const C = Array.from({ length: k }, () => new Array(k).fill(0));
    const prm = { aspiration, habit };
    for (let i = 0; i < k; i++)
      for (let j = i; j < k; j++) {
        let sx = 0, sy = 0, sc = 0;
        for (let rep = 0; rep < reps; rep++) {
          const [x, y, c] = playMatch(strats[i], strats[j], P, rounds, noise, prm, r);
          sx += x; sy += y; sc += c;
        }
        M[i][j] = i === j ? (sx + sy) / (2 * reps) : sx / reps;
        M[j][i] = i === j ? M[i][j] : sy / reps;
        C[i][j] = C[j][i] = sc / reps;
      }
    const scores = M.map((row) => row.reduce((s, x) => s + x, 0) / k);
    return { strategies: strats, M, coop: C, scores };
  }

  /** 戦略の割合の進化（離散レプリケーター）。得点が高い戦略ほど次の世代で増える */
  function evolve(M, x0, generations = 100) {
    const k = M.length;
    let minM = Infinity;
    for (const row of M) for (const v of row) minM = Math.min(minM, v);
    let x = x0.slice();
    const hist = [x.slice()];
    for (let g = 0; g < generations; g++) {
      const f = new Array(k).fill(0);
      let mean = 0;
      for (let i = 0; i < k; i++) {
        for (let j = 0; j < k; j++) f[i] += M[i][j] * x[j];
        f[i] = f[i] - minM + 0.05; // すべて正にする（向きは変わらない）
        mean += f[i] * x[i];
      }
      x = x.map((xi, i) => (xi * f[i]) / mean);
      hist.push(x.slice());
    }
    return hist;
  }

  // ================================================================ 空間ゲーム
  function spatialInit(L, mode, coopFrac, seed) {
    const r = rng(seed);
    const g = new Uint8Array(L * L);
    if (mode === "single") {
      g.fill(1);
      g[(L >> 1) * L + (L >> 1)] = 0;
    } else if (mode === "island") {
      const h = Math.max(2, Math.round(L / 10));
      for (let y = 0; y < L; y++)
        for (let x = 0; x < L; x++) g[y * L + x] = Math.abs(y - L / 2) < h && Math.abs(x - L / 2) < h ? 1 : 0;
    } else {
      for (let i = 0; i < g.length; i++) g[i] = r() < coopFrac ? 1 : 0;
    }
    return g;
  }

  /**
   * 1世代すすめる（全員いっせいに更新）。
   * 得点: C と C → 1、D が C から → b、それ以外 0（Nowak–May の弱い囚人のジレンマ）
   * rule: "best"   … まわり（自分を含む）でいちばん得点が高い人をまねる
   *       "fermi"  … ランダムな隣を1人見て、得点差が大きいほど高い確率でまねる
   *       "aspire" … 1回あたりの得点が願望水準未満なら、半分の確率で手を変える（満足化）
   */
  function spatialStep(g, L, prm, r, pay) {
    const { b, self = true, rule = "best", K = 0.1, aspiration = 0.5, mutation = 0 } = prm;
    const N = L * L;
    if (!pay || pay.length !== N) pay = new Float64Array(N);
    for (let y = 0; y < L; y++) {
      const ym = ((y - 1 + L) % L) * L, y0 = y * L, yp = ((y + 1) % L) * L;
      for (let x = 0; x < L; x++) {
        const xm = (x - 1 + L) % L, xp = (x + 1) % L;
        const nc =
          g[ym + xm] + g[ym + x] + g[ym + xp] + g[y0 + xm] + g[y0 + xp] + g[yp + xm] + g[yp + x] + g[yp + xp] +
          (self ? g[y0 + x] : 0);
        pay[y0 + x] = g[y0 + x] ? nc : b * nc;
      }
    }
    const games = self ? 9 : 8;
    const next = new Uint8Array(N);
    for (let y = 0; y < L; y++) {
      for (let x = 0; x < L; x++) {
        const i = y * L + x;
        let s = g[i];
        if (rule === "best") {
          let bp = pay[i];
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              if (!dx && !dy) continue;
              const j = ((y + dy + L) % L) * L + ((x + dx + L) % L);
              if (pay[j] > bp) { bp = pay[j]; s = g[j]; }
            }
        } else if (rule === "fermi") {
          const k = Math.floor(r() * 8);
          const dx = [-1, 0, 1, -1, 1, -1, 0, 1][k], dy = [-1, -1, -1, 0, 0, 1, 1, 1][k];
          const j = ((y + dy + L) % L) * L + ((x + dx + L) % L);
          const pr = 1 / (1 + Math.exp((pay[i] - pay[j]) / (games * Math.max(K, 1e-4))));
          if (r() < pr) s = g[j];
        } else {
          if (pay[i] / games < aspiration && r() < 0.5) s = 1 - s;
        }
        if (mutation > 0 && r() < mutation) s = 1 - s;
        next[i] = s;
      }
    }
    return { next, pay };
  }

  const api = {
    rng, gauss, DISTS, makeTrials, optimalThresholds, searchOnce, evaluate, sweepAspiration, runSatisficing,
    GAMES, analyze2x2, replicatorField, replicatorPath, aspirationLearning, fictitiousPlay,
    IPD_STRATEGIES, playMatch, tournament, evolve, spatialInit, spatialStep,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.GameLabSim = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
