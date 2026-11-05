// 実行: npm test
const test = require("node:test");
const assert = require("node:assert");
const Net = require("../src/net.js");

const run = (o) => Net.simulate(o);
const ipSteps = (r, pid = 1) => r.steps.filter((s) => s.packet && s.packet.pid === pid && s.packet.ip);

test("IP の計算", () => {
  assert.strictEqual(Net.maskOf(24), "255.255.255.0");
  assert.strictEqual(Net.maskOf(30), "255.255.255.252");
  assert.strictEqual(Net.maskOf(0), "0.0.0.0");
  assert.strictEqual(Net.networkOf("172.16.1.80", 16), "172.16.0.0");
  assert.strictEqual(Net.networkOf("10.0.12.2", 30), "10.0.12.0");
  assert.strictEqual(Net.networkOf("255.255.255.255", 32), "255.255.255.255");
});

test("ルーティング表は最長一致で選ぶ", () => {
  assert.strictEqual(Net.lookup("r1", "172.16.1.80").best.prefix, 24);
  assert.strictEqual(Net.lookup("r1", "172.16.2.50").best.prefix, 16);
  assert.strictEqual(Net.lookup("r1", "8.8.8.8").best.prefix, 0);
  assert.strictEqual(Net.lookup("r3", "8.8.8.8").best, null, "R3 にはデフォルトルートがない");
});

test("ふつうに届く: IP は変わらず、MAC は区間ごとに変わり、TTL は 2 減る", () => {
  const r = run({ from: "pca", to: "172.16.1.80", ttl: 64 });
  assert.strictEqual(r.result, "delivered");
  const steps = ipSteps(r);
  for (const s of steps) {
    assert.strictEqual(s.packet.ip.src, "192.168.1.10");
    assert.strictEqual(s.packet.ip.dst, "172.16.1.80");
  }
  assert.strictEqual(steps[steps.length - 1].packet.ip.ttl, 62);
  const macs = new Set(steps.filter((s) => s.packet.eth).map((s) => s.packet.eth.src + ">" + s.packet.eth.dst));
  assert.deepStrictEqual([...macs], [
    "00:00:00:AA:00:01>00:00:00:11:00:01", // PC-A → R1
    "00:00:00:11:00:02>00:00:00:22:00:01", // R1 → R2
    "00:00:00:22:00:02>00:00:00:CC:00:01", // R2 → サーバー
  ]);
  // ARP は PC-A が R1 を調べる 1 回だけ（ルーターは最初から知っている）
  const arp = r.steps.filter((s) => s.packet && s.packet.arp);
  assert.strictEqual(arp.length, 2);
  assert.strictEqual(arp[0].packet.eth.dst, "FF:FF:FF:FF:FF:FF");
  assert.deepStrictEqual(arp[0].moves, [["pca", "sw1", "pcb"], ["pca", "sw1", "r1"]]);
  assert.ok(r.steps[r.steps.length - 1].summary);
});

test("同じ LAN の中: ルーターを通らず、TTL も減らない", () => {
  const r = run({ from: "pca", to: "192.168.1.20", ttl: 64 });
  assert.strictEqual(r.result, "delivered");
  assert.ok(!r.steps.some((s) => s.at && s.at.startsWith("r")), "ルーターに注目するステップがない");
  assert.ok(ipSteps(r).every((s) => s.packet.ip.ttl === 64));
});

test("TTL が切れる: R2 で捨てられ、ICMP が PC-A に返る", () => {
  const r = run({ from: "pca", to: "172.16.1.80", ttl: 2 });
  assert.strictEqual(r.result, "ttl");
  const drop = r.steps.find((s) => s.tone === "drop");
  assert.strictEqual(drop.at, "r2");
  const icmp = r.steps.filter((s) => s.packet && s.packet.type === "icmp");
  assert.ok(icmp.length >= 3);
  assert.strictEqual(icmp[0].packet.ip.src, "10.0.12.2");
  assert.strictEqual(icmp[icmp.length - 1].packet.ip.dst, "192.168.1.10");
  assert.strictEqual(icmp[icmp.length - 1].at, "pca");
});

test("TTL 1 なら最初のルーターで捨てられる", () => {
  const r = run({ from: "pca", to: "172.16.1.80", ttl: 1 });
  assert.strictEqual(r.steps.find((s) => s.tone === "drop").at, "r1");
});

test("道がない: R3 で捨てられ、Destination Unreachable が返る", () => {
  for (const to of ["172.16.9.9", "8.8.8.8"]) {
    const r = run({ from: "pca", to, ttl: 64 });
    assert.strictEqual(r.result, "noroute", to);
    assert.strictEqual(r.steps.find((s) => s.tone === "drop").at, "r3", to);
    assert.ok(r.steps.some((s) => s.packet && /Unreachable/.test(s.packet.data || "")), to);
  }
});

test("どの組み合わせでも最後まで動き、説明に undefined や NaN が混ざらない", () => {
  for (const from of Net.SOURCES)
    for (const d of Net.DESTINATIONS)
      for (const ttl of [1, 2, 3, 64]) {
        const r = run({ from, to: d.ip, ttl });
        assert.ok(r.steps.length >= 2 && r.steps.length < 40, `${from}→${d.ip} ttl=${ttl}`);
        for (const s of r.steps) {
          assert.ok(s.title && s.text, "タイトルと説明がある");
          assert.ok(!/undefined|NaN|null/.test(s.title + s.text), `${from}→${d.ip}: ${s.title} / ${s.text}`);
          for (const m of s.moves || []) for (const id of m) assert.ok(Net.NODES[id], `知らない機械 ${id}`);
          for (const x of s.rest) assert.ok(Net.NODES[x.node], `知らない機械 ${x.node}`);
        }
      }
});

test("プリセットはすべて動く", () => {
  const want = { normal: "delivered", lan: "delivered", ttl: "ttl", longest: "delivered", noroute: "noroute" };
  for (const p of Net.PRESETS) assert.strictEqual(run(p).result, want[p.id], p.id);
});
