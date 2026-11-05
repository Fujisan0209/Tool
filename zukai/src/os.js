/*
 * OS の「動く図解」の中身。
 * いくつかのプロセスが 1 つの CPU を順番に使うようすを、時刻ごとの場面（frames）にして返します。
 * DOM は使いません（Node でもテストできます）。
 *
 * 時刻の決まりごと（教科書・試験でよく使う決まりに合わせています）:
 *   - 時刻 t の場面では、まず「t に起きたこと」を順に処理して、t から t+1 まで CPU を使うプロセスを決めます。
 *   - 同じ時刻に列に並ぶときは、
 *       1. 前の時刻で I/O を始めた・終わったプロセスの処理
 *       2. 新しく到着したプロセス
 *       3. I/O が終わったプロセス
 *       4. 持ち時間切れ・横取りで CPU を手放したプロセス
 *     の順に並びます。
 *   - コンテキストスイッチにかかる時間は 0 とします。
 *
 * 説明文の中の `...` はコード、**...** は太字で表示されます。
 */
(function (root) {
  "use strict";

  const ALGOS = {
    fcfs: { label: "到着順", long: "到着順（FCFS）", note: "先に来たプロセスから順に、終わるまで実行します。" },
    sjf: { label: "処理時間順", long: "処理時間順（SJF）", note: "列の中で、CPU を使う時間がいちばん短いものを選びます。実行が始まったら、終わるまで続けます。" },
    srtf: { label: "残り時間順", long: "残り時間順（SRT・横取りあり）", note: "残りの CPU 時間がいちばん短いものを実行します。もっと短いものが来たら、実行中のプロセスから CPU を横取りします。" },
    rr: { label: "ラウンドロビン", long: "ラウンドロビン（RR）", note: "決まった持ち時間（タイムクォンタム）ずつ、順番に CPU を使います。使い切ったら列の最後に並び直します。" },
  };

  const STATE_LABEL = {
    new: "新規（まだ来ていない）",
    ready: "実行可能（順番待ち）",
    running: "実行中",
    blocked: "待ち（I/O 中）",
    done: "終了",
  };

  const PRESETS = [
    {
      id: "basic",
      label: "3つのプロセス",
      algo: "fcfs",
      quantum: 2,
      procs: [
        { arrival: 0, cpu: 5 },
        { arrival: 1, cpu: 3 },
        { arrival: 2, cpu: 1 },
      ],
    },
    {
      id: "rr",
      label: "ラウンドロビン",
      algo: "rr",
      quantum: 2,
      procs: [
        { arrival: 0, cpu: 5 },
        { arrival: 1, cpu: 3 },
        { arrival: 2, cpu: 1 },
      ],
    },
    {
      id: "srtf",
      label: "横取りが起きる",
      algo: "srtf",
      quantum: 2,
      procs: [
        { arrival: 0, cpu: 6 },
        { arrival: 2, cpu: 2 },
        { arrival: 3, cpu: 4 },
      ],
    },
    {
      id: "io",
      label: "I/O待ちがある",
      algo: "fcfs",
      quantum: 2,
      procs: [
        { arrival: 0, cpu: 5, ioAt: 2, ioLen: 4 },
        { arrival: 1, cpu: 3 },
        { arrival: 2, cpu: 3, ioAt: 1, ioLen: 2 },
      ],
    },
  ];

  const MAX_PROCS = 5;
  const int = (v, lo, hi, dflt) => {
    const n = Math.floor(Number(v));
    if (!Number.isFinite(n)) return dflt;
    return Math.max(lo, Math.min(hi, n));
  };

  /** 入力を、安全な形にそろえる */
  function normalize(procs) {
    return (procs || []).slice(0, MAX_PROCS).map((p, i) => {
      const cpu = int(p.cpu, 1, 20, 3);
      let ioAt = p.ioAt === "" || p.ioAt == null ? null : int(p.ioAt, 1, 19, null);
      let ioLen = p.ioLen === "" || p.ioLen == null ? null : int(p.ioLen, 1, 20, null);
      if (ioAt == null || ioLen == null || ioAt >= cpu) ioAt = ioLen = null;
      return { name: `P${i + 1}`, arrival: int(p.arrival, 0, 30, 0), cpu, ioAt, ioLen };
    });
  }

  /**
   * cfg = { algo: "fcfs"|"sjf"|"srtf"|"rr", quantum: 2, procs: [{ arrival, cpu, ioAt?, ioLen? }] }
   * 戻り値: { frames, stats, timeline, algo, quantum }
   *
   * frame = {
   *   time, title, lines: [...],
   *   states: { P1: "ready", ... },  ready: ["P2", "P3"]（先頭から）, running: "P1" | null,
   *   blocked: [{ name, left }], arrows: ["ready-running", ...],
   *   procs: { P1: { used, cpu, left, wait, ioLeft } },
   *   switchFrom, switchTo,  コンテキストスイッチ（なければ null）
   *   end: boolean
   * }
   * timeline[t] = { run: "P1" | null, states: {...} }   t から t+1 までのようす（ガントチャート用）
   */
  function schedule(cfg) {
    const algo = ALGOS[cfg && cfg.algo] ? cfg.algo : "fcfs";
    const q = int(cfg && cfg.quantum, 1, 10, 2);
    const input = normalize(cfg && cfg.procs);
    const P = input.map((p) => {
      const bursts = p.ioAt ? [p.ioAt, p.ioLen, p.cpu - p.ioAt] : [p.cpu];
      return {
        ...p,
        bursts,
        seg: 0,
        left: bursts[0],
        used: 0,
        wait: 0,
        state: "new",
        ioEnd: null,
        finish: null,
      };
    });

    const frames = [];
    const timeline = [];
    const ready = [];
    let running = null;
    let slice = 0; // いまのプロセスが続けて使った時間（ラウンドロビン用）
    let lastRan = null; // 1つ前の時間に CPU を使っていたプロセス
    let carry = []; // 前の時間の終わりに起きたこと
    const LIMIT = 400;

    for (let t = 0; t <= LIMIT; t++) {
      const ev = carry;
      carry = [];

      for (const p of P)
        if (p.state === "new" && p.arrival === t) {
          p.state = "ready";
          ready.push(p);
          ev.push({ type: "arrive", p: p.name });
        }
      for (const p of P)
        if (p.state === "blocked" && p.ioEnd === t) {
          p.state = "ready";
          ready.push(p);
          ev.push({ type: "io-done", p: p.name });
        }

      if (running) {
        if (algo === "rr" && slice >= q) {
          if (ready.length) {
            running.state = "ready";
            ready.push(running);
            ev.push({ type: "quantum", p: running.name });
            running = null;
          } else {
            ev.push({ type: "quantum-again", p: running.name });
            slice = 0;
          }
        } else if (algo === "srtf") {
          const s = shortest(ready);
          if (s && s.left < running.left) {
            ev.push({ type: "preempt", p: running.name, by: s.name, left: running.left, byLeft: s.left });
            running.state = "ready";
            ready.push(running);
            running = null;
          }
        }
      }

      let switchFrom = null;
      let switchTo = null;
      if (!running && ready.length) {
        const snapshot = ready.map((p) => ({ name: p.name, left: p.left }));
        const pick = algo === "sjf" || algo === "srtf" ? shortest(ready) : ready[0];
        ready.splice(ready.indexOf(pick), 1);
        pick.state = "running";
        running = pick;
        slice = 0;
        if (lastRan && lastRan !== pick) {
          switchFrom = lastRan.name;
          switchTo = pick.name;
        }
        ev.push({
          type: "dispatch",
          p: pick.name,
          candidates: snapshot,
          from: switchFrom,
          fromState: lastRan && lastRan.state,
          fresh: pick.used === 0,
        });
      } else if (running && running === lastRan && !ev.some((e) => e.type === "quantum-again")) {
        ev.push({ type: "continue", p: running.name });
      }
      if (!running && P.some((p) => p.state !== "done")) ev.push({ type: "idle" });

      const end = P.every((p) => p.state === "done");
      frames.push(makeFrame(t, ev, switchFrom, switchTo, end));
      if (end) break;

      // t から t+1 まで
      timeline.push({ run: running ? running.name : null, states: Object.fromEntries(P.map((p) => [p.name, p.state])) });
      for (const p of P) if (p.state === "ready") p.wait++;
      lastRan = running;
      if (running) {
        running.left--;
        running.used++;
        slice++;
        if (running.left === 0) {
          running.seg++;
          if (running.seg < running.bursts.length) {
            running.state = "blocked";
            running.ioEnd = t + 1 + running.bursts[running.seg];
            running.seg++;
            running.left = running.bursts[running.seg];
            carry.push({ type: "io-start", p: running.name, len: running.bursts[running.seg - 1] });
          } else {
            running.state = "done";
            running.finish = t + 1;
            carry.push({ type: "exit", p: running.name });
          }
          running = null;
        }
      }
    }

    const stats = P.map((p) => {
      const io = p.ioLen || 0;
      const turnaround = p.finish - p.arrival;
      return { name: p.name, arrival: p.arrival, cpu: p.cpu, io, finish: p.finish, turnaround, wait: turnaround - p.cpu - io };
    });
    const avg = (k) => (stats.length ? stats.reduce((s, x) => s + x[k], 0) / stats.length : 0);
    return {
      algo,
      quantum: q,
      procs: input,
      frames,
      timeline,
      stats,
      average: { wait: avg("wait"), turnaround: avg("turnaround") },
    };

    // ---- ここから下は schedule の中だけで使う関数 ----

    function shortest(list) {
      let best = null;
      for (const p of list) if (!best || p.left < best.left) best = p;
      return best;
    }

    function makeFrame(t, ev, switchFrom, switchTo, end) {
      const lines = [];
      const arrows = new Set();
      const L = (s) => lines.push(s);
      const reasonOf = (e) => {
        if (algo === "fcfs") return "列の先頭（いちばん先に並んだ）だから";
        if (algo === "rr") return "列の先頭だから";
        const list = e.candidates.map((c) => `${c.name}: ${c.left}`).join("、");
        return e.candidates.length > 1
          ? `列の中で、${algo === "sjf" ? "CPU を使う時間" : "残りの CPU 時間"}がいちばん短いから（${list}）`
          : "列にいるのが 1 つだけだから";
      };

      for (const e of ev) {
        const p = e.p;
        switch (e.type) {
          case "exit":
            arrows.add("running-done");
            L(`**${p} が終わった。** CPU の仕事をぜんぶ終えて「終了」になります。`);
            break;
          case "io-start":
            arrows.add("running-blocked");
            L(
              `**${p} が I/O を始めた。** ファイルの読み書きなどを ${e.len} の間待つので、CPU を手放して「待ち」になります。` +
                "待っている間 CPU を遊ばせないよう、ほかのプロセスに使わせます。"
            );
            break;
          case "arrive":
            arrows.add("new-ready");
            L(`**${p} が到着。** 実行可能キュー（CPU の順番待ちの列）の最後に並びます。`);
            break;
          case "io-done":
            arrows.add("blocked-ready");
            L(`**${p} の I/O が終わった。** すぐに CPU には戻れず、「実行可能」になって列の最後に並びます。`);
            break;
          case "quantum":
            arrows.add("running-ready");
            L(`**${p} は持ち時間（タイムクォンタム ${q}）を使い切った。** CPU を手放して、列の最後に並び直します。`);
            break;
          case "quantum-again":
            L(`${p} は持ち時間（${q}）を使い切りましたが、列にだれもいないので、そのまま続けて実行します。`);
            break;
          case "preempt":
            arrows.add("running-ready");
            L(
              `**${e.by} が ${p} から CPU を横取り。** ${e.by} の残り（${e.byLeft}）が、実行中の ${p} の残り（${e.left}）より短いからです。` +
                `${p} は列に戻ります。`
            );
            break;
          case "dispatch":
            arrows.add("ready-running");
            L(`**${p} を CPU で実行**します（ディスパッチ）。${reasonOf(e)}です。`);
            if (e.from) {
              const save =
                e.fromState === "done"
                  ? `${e.from} はもう終わったので保存はいらず、`
                  : `${e.from} がどこまで進んだか（プログラムカウンタやレジスタの中身）を ${e.from} の **PCB** に保存し、`;
              const load = e.fresh ? `${p} は初めて動くので、最初から動かします。` : `${p} の PCB から読み出して、${p} の続きから動かします。`;
              L(`CPU を ${e.from} から ${p} に切りかえます（**コンテキストスイッチ**）。${save}${load}`);
            }
            break;
          case "continue":
            L(`${p} がそのまま実行を続けます。`);
            break;
          case "idle":
            L("実行できるプロセスがないので、CPU はひま（アイドル）です。");
            break;
        }
      }
      if (end) {
        L("すべてのプロセスが終わりました。下の表で、待ち時間とターンアラウンドタイムを確かめましょう。");
      }

      const disp = ev.find((e) => e.type === "dispatch");
      let title = `時刻 ${t}`;
      if (end) title += "：ぜんぶ終了";
      else if (switchFrom) title += `：${switchFrom} → ${switchTo} に切りかえ`;
      else if (disp) title += `：${disp.p} を実行`;
      else if (running) title += `：${running.name} が実行中`;
      else title += "：CPU はひま";

      return {
        time: t,
        title,
        lines,
        events: ev,
        arrows: [...arrows],
        states: Object.fromEntries(P.map((p) => [p.name, p.state])),
        ready: ready.map((p) => p.name),
        running: running ? running.name : null,
        blocked: P.filter((p) => p.state === "blocked").map((p) => ({ name: p.name, left: p.ioEnd - t })),
        procs: Object.fromEntries(
          P.map((p) => [
            p.name,
            {
              used: p.used,
              cpu: p.cpu,
              left: p.cpu - p.used,
              wait: p.wait,
              ioLeft: p.state === "blocked" ? p.ioEnd - t : null,
              finish: p.finish,
            },
          ])
        ),
        switchFrom,
        switchTo,
        end,
      };
    }
  }

  const api = { ALGOS, STATE_LABEL, PRESETS, MAX_PROCS, normalize, schedule };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OsSim = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
