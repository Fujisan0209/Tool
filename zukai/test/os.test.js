// 実行: npm test
const test = require("node:test");
const assert = require("node:assert");
const Os = require("../src/os.js");

const procs3 = [
  { arrival: 0, cpu: 5 },
  { arrival: 1, cpu: 3 },
  { arrival: 2, cpu: 1 },
];
/** ガントチャートを "11222..." の形にする（- はアイドル） */
const chart = (r) => r.timeline.map((x) => (x.run ? x.run.slice(1) : "-")).join("");
const waits = (r) => r.stats.map((x) => x.wait);

test("到着順（FCFS）", () => {
  const r = Os.schedule({ algo: "fcfs", procs: procs3 });
  assert.strictEqual(chart(r), "111112223");
  assert.deepStrictEqual(waits(r), [0, 4, 6]);
  assert.strictEqual(r.average.wait, 10 / 3);
});

test("処理時間順（SJF）は横取りしない", () => {
  const r = Os.schedule({ algo: "sjf", procs: procs3 });
  assert.strictEqual(chart(r), "111113222");
  assert.deepStrictEqual(waits(r), [0, 5, 3]);
});

test("残り時間順（SRT）は横取りする", () => {
  const r = Os.schedule({ algo: "srtf", procs: procs3 });
  assert.strictEqual(chart(r), "123221111");
  assert.deepStrictEqual(waits(r), [4, 1, 0]);
  assert.ok(r.frames.some((f) => f.events.some((e) => e.type === "preempt")));
});

test("ラウンドロビン: 新しく来たものが、持ち時間切れのものより先に並ぶ", () => {
  const r = Os.schedule({ algo: "rr", quantum: 2, procs: procs3 });
  assert.strictEqual(chart(r), "112231121");
  const f2 = r.frames[2];
  assert.strictEqual(f2.running, "P2");
  assert.deepStrictEqual(f2.ready, ["P3", "P1"]);
  assert.deepStrictEqual(waits(r), [4, 4, 2]);
});

test("ラウンドロビン: 列が空なら、持ち時間を使い切っても続けて実行", () => {
  const r = Os.schedule({ algo: "rr", quantum: 2, procs: [{ arrival: 0, cpu: 5 }] });
  assert.strictEqual(chart(r), "11111");
  assert.ok(r.frames.every((f) => !f.switchFrom));
});

test("I/O 待ち: 待ちの間はほかのプロセスが CPU を使う", () => {
  const r = Os.schedule({
    algo: "fcfs",
    procs: [
      { arrival: 0, cpu: 5, ioAt: 2, ioLen: 4 },
      { arrival: 1, cpu: 3 },
      { arrival: 2, cpu: 3, ioAt: 1, ioLen: 2 },
    ],
  });
  assert.strictEqual(chart(r), "11222311133");
  assert.deepStrictEqual(r.frames[3].blocked, [{ name: "P1", left: 3 }]);
  assert.strictEqual(r.frames[3].states.P1, "blocked");
  assert.deepStrictEqual(waits(r), [0, 1, 4]);
  for (const s of r.stats) assert.strictEqual(s.turnaround, s.finish - s.arrival);
});

test("だれもいない時間は CPU がアイドルになる", () => {
  const r = Os.schedule({ algo: "fcfs", procs: [{ arrival: 0, cpu: 1 }, { arrival: 3, cpu: 1 }] });
  assert.strictEqual(chart(r), "1--2");
  assert.ok(r.frames[1].events.some((e) => e.type === "idle"));
});

test("コンテキストスイッチの記録", () => {
  const r = Os.schedule({ algo: "rr", quantum: 2, procs: procs3 });
  const f = r.frames[2];
  assert.strictEqual(f.switchFrom, "P1");
  assert.strictEqual(f.switchTo, "P2");
  assert.ok(f.lines.some((l) => l.includes("コンテキストスイッチ") && l.includes("PCB")));
});

test("おかしな入力でも止まらない", () => {
  const r = Os.schedule({
    algo: "???",
    quantum: -3,
    procs: [{ arrival: -5, cpu: 0 }, { arrival: "x", cpu: 5, ioAt: 7, ioLen: 2 }, {}, {}, {}, {}, {}],
  });
  assert.strictEqual(r.algo, "fcfs");
  assert.strictEqual(r.quantum, 1);
  assert.strictEqual(r.procs.length, Os.MAX_PROCS);
  assert.strictEqual(r.procs[1].ioAt, null, "I/O の開始が CPU 時間以上なら I/O なし");
  assert.ok(r.frames[r.frames.length - 1].end);
});

test("どのプリセット・やり方でも、説明に undefined や NaN が混ざらない", () => {
  for (const p of Os.PRESETS)
    for (const algo of Object.keys(Os.ALGOS))
      for (const quantum of [1, 2, 3]) {
        const r = Os.schedule({ ...p, algo, quantum });
        assert.ok(r.frames[r.frames.length - 1].end);
        for (const f of r.frames) {
          assert.ok(f.lines.length > 0, `${p.id}/${algo} 時刻${f.time} に説明がある`);
          assert.ok(!/undefined|NaN|null/.test(f.title + f.lines.join("")), `${p.id}/${algo}: ${f.title}`);
        }
        for (const s of r.stats) assert.ok(s.wait >= 0);
      }
});
