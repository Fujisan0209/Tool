/*
 * ネットワークの「動く図解」の中身。
 * パケットが 1 つのネットワークから別のネットワークへ届くまでを、
 * 1 ステップずつの配列（steps）にして返します。DOM は使いません（Node でもテストできます）。
 *
 * 図のなかの機械:
 *
 *   PC-A ─┐                ┌─ R2 ── サーバー     (172.16.1.0/24)
 *         ├ スイッチ ── R1 ┤
 *   PC-B ─┘ 192.168.1.0/24 └─ R3 ── サーバーB    (172.16.2.0/24)
 *
 * 説明文の中の `...` はコードとして表示されます。
 */
(function (root) {
  "use strict";

  // ---------- IP アドレスの計算 ----------
  function ipToInt(ip) {
    return ip.split(".").reduce((n, o) => n * 256 + Number(o), 0);
  }
  function intToIp(n) {
    return [24, 16, 8, 0].map((s) => Math.floor(n / 2 ** s) % 256).join(".");
  }
  function maskInt(prefix) {
    return prefix === 0 ? 0 : 0xffffffff - (2 ** (32 - prefix) - 1);
  }
  function maskOf(prefix) {
    return intToIp(maskInt(prefix));
  }
  /** ip AND サブネットマスク → ネットワークアドレス */
  function networkOf(ip, prefix) {
    return intToIp((ipToInt(ip) & maskInt(prefix)) >>> 0);
  }

  const BROADCAST = "FF:FF:FF:FF:FF:FF";

  // ---------- 図の機械 ----------
  const route = (dest, via, iface) => {
    const [net, p] = dest.split("/");
    return { net, prefix: Number(p), via, iface };
  };

  const NODES = {
    pca: {
      type: "host", name: "PC-A", x: 70, y: 74,
      ifaces: { eth0: { ip: "192.168.1.10", prefix: 24, mac: "00:00:00:AA:00:01", seg: "lan1" } },
      routes: [route("192.168.1.0/24", null, "eth0"), route("0.0.0.0/0", "192.168.1.1", "eth0")],
    },
    pcb: {
      type: "host", name: "PC-B", x: 70, y: 256,
      ifaces: { eth0: { ip: "192.168.1.20", prefix: 24, mac: "00:00:00:BB:00:01", seg: "lan1" } },
      routes: [route("192.168.1.0/24", null, "eth0"), route("0.0.0.0/0", "192.168.1.1", "eth0")],
    },
    sw1: { type: "switch", name: "スイッチ", x: 210, y: 165, seg: "lan1" },
    r1: {
      type: "router", name: "R1", x: 380, y: 165,
      ifaces: {
        eth0: { ip: "192.168.1.1", prefix: 24, mac: "00:00:00:11:00:01", seg: "lan1" },
        eth1: { ip: "10.0.12.1", prefix: 30, mac: "00:00:00:11:00:02", seg: "l12" },
        eth2: { ip: "10.0.13.1", prefix: 30, mac: "00:00:00:11:00:03", seg: "l13" },
      },
      routes: [
        route("192.168.1.0/24", null, "eth0"),
        route("10.0.12.0/30", null, "eth1"),
        route("10.0.13.0/30", null, "eth2"),
        route("172.16.1.0/24", "10.0.12.2", "eth1"),
        route("172.16.0.0/16", "10.0.13.2", "eth2"),
        route("0.0.0.0/0", "10.0.13.2", "eth2"),
      ],
    },
    r2: {
      type: "router", name: "R2", x: 590, y: 74,
      ifaces: {
        eth0: { ip: "10.0.12.2", prefix: 30, mac: "00:00:00:22:00:01", seg: "l12" },
        eth1: { ip: "172.16.1.1", prefix: 24, mac: "00:00:00:22:00:02", seg: "lan2" },
      },
      routes: [
        route("10.0.12.0/30", null, "eth0"),
        route("172.16.1.0/24", null, "eth1"),
        route("0.0.0.0/0", "10.0.12.1", "eth0"),
      ],
    },
    r3: {
      type: "router", name: "R3", x: 590, y: 256,
      ifaces: {
        eth0: { ip: "10.0.13.2", prefix: 30, mac: "00:00:00:33:00:01", seg: "l13" },
        eth1: { ip: "172.16.2.1", prefix: 24, mac: "00:00:00:33:00:02", seg: "lan3" },
      },
      // R3 にはデフォルトルートがない（知らない宛先は捨てる）
      routes: [
        route("10.0.13.0/30", null, "eth0"),
        route("172.16.2.0/24", null, "eth1"),
        route("192.168.1.0/24", "10.0.13.1", "eth0"),
        route("172.16.1.0/24", "10.0.13.1", "eth0"),
      ],
    },
    srv: {
      type: "host", name: "サーバー", x: 790, y: 74,
      ifaces: { eth0: { ip: "172.16.1.80", prefix: 24, mac: "00:00:00:CC:00:01", seg: "lan2" } },
      routes: [route("172.16.1.0/24", null, "eth0"), route("0.0.0.0/0", "172.16.1.1", "eth0")],
    },
    srv2: {
      type: "host", name: "サーバーB", x: 790, y: 256,
      ifaces: { eth0: { ip: "172.16.2.50", prefix: 24, mac: "00:00:00:DD:00:01", seg: "lan3" } },
      routes: [route("172.16.2.0/24", null, "eth0"), route("0.0.0.0/0", "172.16.2.1", "eth0")],
    },
  };

  /** ケーブル（同じネットワーク）。sw があれば、そのスイッチを通る */
  const SEGMENTS = {
    lan1: { net: "192.168.1.0/24", sw: "sw1", ports: { pca: 1, pcb: 2, r1: 3 } },
    l12: { net: "10.0.12.0/30" },
    l13: { net: "10.0.13.0/30" },
    lan2: { net: "172.16.1.0/24" },
    lan3: { net: "172.16.2.0/24" },
  };

  /** 最初から ARP 表に入っている相手（ルーター同士は前にやりとりしたことがある） */
  const INITIAL_ARP = {
    r1: { "10.0.12.2": "00:00:00:22:00:01", "10.0.13.2": "00:00:00:33:00:01" },
    r2: { "10.0.12.1": "00:00:00:11:00:02", "172.16.1.80": "00:00:00:CC:00:01" },
    r3: { "10.0.13.1": "00:00:00:11:00:03", "172.16.2.50": "00:00:00:DD:00:01" },
  };

  /** 送り先として選べるもの */
  const DESTINATIONS = [
    { ip: "172.16.1.80", label: "サーバー（172.16.1.80）" },
    { ip: "172.16.2.50", label: "サーバーB（172.16.2.50）" },
    { ip: "192.168.1.20", label: "PC-B（192.168.1.20）" },
    { ip: "192.168.1.10", label: "PC-A（192.168.1.10）" },
    { ip: "172.16.9.9", label: "172.16.9.9（どこにもない）" },
    { ip: "8.8.8.8", label: "8.8.8.8（図の外）" },
  ];
  const SOURCES = ["pca", "pcb", "srv", "srv2"];

  /** よく使う組み合わせ */
  const PRESETS = [
    { id: "normal", label: "ふつうに届く", from: "pca", to: "172.16.1.80", ttl: 64 },
    { id: "lan", label: "同じLANの中", from: "pca", to: "192.168.1.20", ttl: 64 },
    { id: "ttl", label: "TTLが切れる", from: "pca", to: "172.16.1.80", ttl: 2 },
    { id: "longest", label: "別の道（最長一致）", from: "pca", to: "172.16.2.50", ttl: 64 },
    { id: "noroute", label: "道がない", from: "pca", to: "172.16.9.9", ttl: 64 },
  ];

  // ---------- 名前を引く ----------
  const allIfaces = [];
  for (const [id, n] of Object.entries(NODES))
    for (const [ifName, f] of Object.entries(n.ifaces || {})) allIfaces.push({ node: id, ifName, ...f });

  const ifaceByIp = (ip) => allIfaces.find((f) => f.ip === ip) || null;
  const ifaceByMac = (mac) => allIfaces.find((f) => f.mac === mac) || null;
  const nameOf = (id) => NODES[id].name;

  /** 「R1 の eth1」「PC-A」のように、MAC/IP の持ち主を言う */
  function ownerLabel(f) {
    if (!f) return "";
    return NODES[f.node].type === "router" ? `${nameOf(f.node)} の ${f.ifName}` : nameOf(f.node);
  }
  function macLabel(mac) {
    if (mac === BROADCAST) return "全員（ブロードキャスト）";
    return ownerLabel(ifaceByMac(mac));
  }
  function ipLabel(ip) {
    return ownerLabel(ifaceByIp(ip)) || "（図にない）";
  }
  function hostIface(id) {
    return Object.values(NODES[id].ifaces)[0];
  }

  // ---------- ルーティング表を引く ----------
  function lookup(id, dst) {
    const rows = NODES[id].routes.map((r) => {
      const masked = networkOf(dst, r.prefix);
      return { ...r, masked, match: masked === r.net };
    });
    let best = null;
    for (const r of rows) if (r.match && (!best || r.prefix > best.prefix)) best = r;
    return { rows, best };
  }

  function routeTable(id, dst, L) {
    const node = NODES[id];
    return {
      kind: "route",
      title: `${node.name} のルーティング表`,
      cols: ["あて先ネットワーク", "次にわたす相手", "出口"],
      rows: L.rows.map((r) => [
        `${r.net}/${r.prefix}`,
        r.via ? `${r.via}（${ipLabel(r.via)}）` : "直接つながっている",
        r.iface,
      ]),
      state: L.rows.map((r) => (r === L.best ? "hit" : r.match ? "match" : "")),
      calc: L.rows.map((r) => ({
        text: `${dst} AND ${maskOf(r.prefix)} = ${r.masked}`,
        ok: r.match,
        target: `${r.net}/${r.prefix}`,
      })),
    };
  }

  function arpTable(id, arp, hiIp) {
    const rows = [...arp[id].entries()];
    return {
      kind: "arp",
      title: `${nameOf(id)} の ARP 表（IP → MAC のメモ）`,
      cols: ["IP アドレス", "MAC アドレス"],
      rows: rows.map(([ip, mac]) => [`${ip}（${ipLabel(ip)}）`, mac]),
      state: rows.map(([ip]) => (ip === hiIp ? "hit" : "")),
      empty: "まだ何も入っていない",
    };
  }

  function macTableView(seg, macTable, hiMac) {
    const s = SEGMENTS[seg];
    const rows = [...macTable.entries()];
    return {
      kind: "mac",
      title: `${nameOf(s.sw)} の MAC アドレス表`,
      cols: ["MAC アドレス", "ポート（つながっている先）"],
      rows: rows.map(([mac, node]) => [mac, `${s.ports[node]}番（${nameOf(node)}）`]),
      state: rows.map(([mac]) => (mac === hiMac ? "hit" : "")),
      empty: "まだ何も入っていない",
    };
  }

  // ---------- メイン ----------
  /**
   * opts = { from: "pca", to: "172.16.1.80", ttl: 64 }
   * 戻り値: { steps: [...], result: "delivered" | "ttl" | "noroute" | "noarp" }
   *
   * step = {
   *   title, text,                 説明（`...` はコード）
   *   at,                          いま注目している機械の id
   *   moves: [[id, id, ...], ...], このステップで動く道すじ（なければ動かない）
   *   rest:  [{ node, type }],     ステップが終わったときにパケットがいる場所
   *   packet: { pid, type, eth, ip, arp, data } | null,  ヘッダーの中身
   *   table: {...} | null,         表（ルーティング表・ARP表・MAC表）
   *   tone: "ok" | "drop" | undefined,
   * }
   */
  function simulate(opts) {
    const from = NODES[opts && opts.from] && NODES[opts.from].type === "host" ? opts.from : "pca";
    const dst = String((opts && opts.to) || "172.16.1.80");
    const ttl0 = Math.max(1, Math.min(255, Math.floor(Number(opts && opts.ttl) || 64)));

    const arp = {};
    for (const id of Object.keys(NODES)) arp[id] = new Map(Object.entries(INITIAL_ARP[id] || {}));
    const macTable = new Map(); // MAC → そのMACがつながっているポートの機械
    const steps = [];
    let pidSeq = 0;
    let result = "delivered";
    const hops = []; // 通ったルーター

    const add = (s) => steps.push(s);
    const ipPacket = (pkt, eth) => ({
      pid: pkt.pid,
      type: pkt.proto === "ICMP" ? "icmp" : "ip",
      eth: eth ? { dst: eth.dst, src: eth.src, dstLabel: macLabel(eth.dst), srcLabel: macLabel(eth.src) } : null,
      ip: { src: pkt.src, dst: pkt.dst, ttl: pkt.ttl, srcLabel: ipLabel(pkt.src), dstLabel: ipLabel(pkt.dst) },
      data: pkt.data,
    });

    // --- 1. パケットを作る ---
    const src = hostIface(from);
    const pkt0 = { pid: ++pidSeq, src: src.ip, dst, ttl: ttl0, proto: "TCP", data: "TCP ポート80「ページをください」" };
    add({
      title: `${nameOf(from)} がパケットを作る`,
      text:
        `送り主は自分の IP アドレス \`${src.ip}\`、あて先は \`${dst}\`。` +
        `TTL（あと何台のルーターを通れるか）は \`${ttl0}\` から始めます。` +
        "\nこの IP アドレスの組は、最後まで変わりません。",
      at: from,
      rest: [{ node: from, type: "ip" }],
      packet: ipPacket(pkt0, null),
      table: null,
    });

    if (dst === src.ip) {
      add({
        title: "あて先が自分自身",
        text: "あて先が自分の IP アドレスなので、ネットワークには出ていきません。送り先を変えてみてください。",
        at: from,
        rest: [{ node: from, type: "ip" }],
        packet: ipPacket(pkt0, null),
        table: null,
      });
      return { steps, result: "self" };
    }

    let cur = { node: from, pkt: pkt0, inIf: null };
    let guard = 0;
    while (cur && guard++ < 40) cur = sendFrom(cur.node, cur.pkt, cur.inIf);

    // --- まとめ ---
    add(summaryStep());
    return { steps, result };

    // ===== ここから下は simulate の中だけで使う関数 =====

    /** id の機械が、パケットを次へ送る。次に処理する {node, pkt, inIf} か null を返す */
    function sendFrom(id, pkt, inIf) {
      const node = NODES[id];
      const L = lookup(id, pkt.dst);
      const table = routeTable(id, pkt.dst, L);

      if (!L.best) {
        add({
          title: `${node.name} のルーティング表に、あて先が見つからない`,
          text:
            `\`${pkt.dst}\` に当てはまる行が 1 つもありません。デフォルトルート（\`0.0.0.0/0\`）もないので、` +
            `${node.name} はどこへ送ればいいかわからず、パケットを**捨てます**。`,
          at: id,
          rest: [{ node: id, type: "drop" }],
          packet: ipPacket(pkt, null),
          table,
          tone: "drop",
        });
        if (pkt.proto !== "ICMP") result = "noroute";
        return icmpBack(id, inIf, pkt, "unreachable");
      }

      const best = L.best;
      const out = node.ifaces[best.iface];
      const nextIp = best.via || pkt.dst;

      if (!pkt.brief) add(lookupStep(id, pkt, L, table, nextIp));

      let mac = arp[id].get(nextIp);
      if (!mac) {
        mac = resolveArp(id, best.iface, nextIp, pkt);
        if (!mac) {
          if (pkt.proto !== "ICMP") result = "noarp";
          return null;
        }
      }
      const target = ifaceByMac(mac);
      const eth = { src: out.mac, dst: mac };
      transmit(id, best.iface, target, pkt, eth, nextIp === pkt.dst);
      return receive(target.node, target.ifName, pkt, eth);
    }

    function lookupStep(id, pkt, L, table, nextIp) {
      const node = NODES[id];
      const best = L.best;
      const matches = L.rows.filter((r) => r.match);
      if (node.type === "host") {
        const own = node.ifaces[best.iface];
        const same = !best.via;
        return {
          title: same ? `${node.name}「あて先は同じネットワークだ」` : `${node.name}「あて先はよそのネットワークだ」`,
          text: same
            ? `あて先 \`${pkt.dst}\` を自分のサブネットマスク \`${maskOf(own.prefix)}\` で AND すると \`${networkOf(pkt.dst, own.prefix)}\`。` +
              `自分と同じネットワーク \`${networkOf(own.ip, own.prefix)}/${own.prefix}\` なので、**ルーターを通さず直接**届けます。`
            : `あて先 \`${pkt.dst}\` は、自分のネットワーク \`${networkOf(own.ip, own.prefix)}/${own.prefix}\` に入っていません。` +
              `よそのネットワーク行きは、**デフォルトゲートウェイ**（${ipLabel(best.via)}: \`${best.via}\`）にわたします。`,
          at: id,
          rest: [{ node: id, type: "ip" }],
          packet: ipPacket(pkt, null),
          table,
        };
      }
      let why;
      if (matches.length > 1) {
        const list = matches.map((r) => `\`${r.net}/${r.prefix}\``).join("、");
        why =
          `当てはまる行が ${matches.length} つあります（${list}）。` +
          `いちばん細かい（/ の数字が大きい）\`/${best.prefix}\` を選びます。これを**最長一致**といいます。`;
      } else {
        why = `当てはまるのは \`${best.net}/${best.prefix}\` の行だけです。`;
      }
      const go = best.via
        ? `次は ${ipLabel(best.via)}（\`${best.via}\`）へ、出口は \`${best.iface}\`。`
        : `あて先は直接つながっているネットワークにいるので、\`${best.iface}\` から直接届けます。`;
      return {
        title: `${node.name} がルーティング表を引く`,
        text: `あて先 \`${pkt.dst}\` を、表の各行のマスクで AND して、行のネットワークと同じになるか調べます。\n${why}\n${go}`,
        at: id,
        rest: [{ node: id, type: "ip" }],
        packet: ipPacket(pkt, null),
        table,
      };
    }

    /** ARP で nextIp の MAC アドレスを調べる。見つかれば MAC、なければ null */
    function resolveArp(id, ifName, nextIp, pkt) {
      const node = NODES[id];
      const me = node.ifaces[ifName];
      const seg = SEGMENTS[me.seg];
      const members = allIfaces.filter((f) => f.seg === me.seg && f.node !== id);
      const owner = members.find((f) => f.ip === nextIp) || null;
      const via = (a, b) => (seg.sw ? [a, seg.sw, b] : [a, b]);
      if (seg.sw) macTable.set(me.mac, id);

      add({
        title: `${node.name} が ARP で「\`${nextIp}\` はだれ？」と全員に聞く`,
        text:
          `イーサネットで送るには、相手の **MAC アドレス**（機械ごとの番号）が必要です。` +
          `${node.name} の ARP 表には \`${nextIp}\` がまだないので、同じネットワークの全員に聞きます（ブロードキャスト）。` +
          (seg.sw ? "\nスイッチは、あて先が全員なので、すべてのポートにコピーして送ります。" : ""),
        at: id,
        moves: members.map((f) => via(id, f.node)),
        rest: members.map((f) => ({ node: f.node, type: "arp" })),
        packet: {
          pid: `arp-${pkt.pid}-${nextIp}`,
          type: "arp",
          eth: { dst: BROADCAST, src: me.mac, dstLabel: macLabel(BROADCAST), srcLabel: macLabel(me.mac) },
          arp: { op: "request", text: `${nextIp} を持っている人は、MAC アドレスを教えて（${me.ip} より）` },
        },
        table: arpTable(id, arp, null),
      });

      if (!owner) {
        add({
          title: "だれも返事をしない",
          text: `\`${nextIp}\` を持っている機械がネットワークにいないので、MAC アドレスがわからず、送れません。`,
          at: id,
          rest: [{ node: id, type: "drop" }],
          packet: null,
          table: arpTable(id, arp, null),
          tone: "drop",
        });
        return null;
      }

      // 聞かれた側は、ついでに聞いてきた相手を覚える
      arp[owner.node].set(me.ip, me.mac);
      if (seg.sw) macTable.set(owner.mac, owner.node);
      arp[id].set(nextIp, owner.mac);
      const others = members.filter((f) => f !== owner).map((f) => nameOf(f.node));

      add({
        title: `${ownerLabel(owner)} が「それはわたし」と返事`,
        text:
          `\`${nextIp}\` を持っている ${nameOf(owner.node)} だけが、自分の MAC アドレス \`${owner.mac}\` を返します` +
          (others.length ? `（${others.join("、")} は自分のことではないので無視）。` : "。") +
          `\n${node.name} は ARP 表にメモしたので、次からは聞かずに使えます。`,
        at: owner.node,
        moves: [via(owner.node, id)],
        rest: [{ node: id, type: "arp" }],
        packet: {
          pid: `arp-${pkt.pid}-${nextIp}-r`,
          type: "arp",
          eth: { dst: me.mac, src: owner.mac, dstLabel: macLabel(me.mac), srcLabel: macLabel(owner.mac) },
          arp: { op: "reply", text: `${nextIp} の MAC アドレスは ${owner.mac} です` },
        },
        table: arpTable(id, arp, nextIp),
      });
      return owner.mac;
    }

    /** フレームにして、ケーブル（とスイッチ）を通して送る */
    function transmit(id, outName, target, pkt, eth, direct) {
      const node = NODES[id];
      const out = node.ifaces[outName];
      const seg = SEGMENTS[out.seg];
      const type = pkt.proto === "ICMP" ? "icmp" : "ip";
      const dstName = nameOf(target.node);

      let text;
      if (node.type === "router") {
        text =
          `${node.name} は新しいフレームを作り直します。送信元 MAC は自分の出口 \`${outName}\` の \`${eth.src}\`、` +
          `あて先 MAC は ${ownerLabel(target)} の \`${eth.dst}\`。` +
          "\n**MAC アドレスは区間ごとに入れかわります**が、IP アドレスはそのままです。";
      } else {
        text =
          `IP パケットをイーサネットの**フレーム**に入れて送ります。あて先 MAC は ${ownerLabel(target)} の \`${eth.dst}\`。` +
          (direct ? "" : `\nあて先 IP は \`${pkt.dst}\` のままですが、まずは ${dstName} に渡す、という意味です。`);
      }

      if (pkt.brief) {
        add({
          title: `${pkt.proto} が ${node.name} → ${dstName} へ`,
          text: node.type === "router" ? `${node.name} が中継します（TTL を 1 減らし、フレームを作り直す）。` : `${node.name} から送ります。`,
          at: id,
          moves: [seg.sw ? [id, seg.sw, target.node] : [id, target.node]],
          rest: [{ node: target.node, type }],
          packet: ipPacket(pkt, eth),
          table: null,
        });
        if (seg.sw) macTable.set(eth.src, id);
        return;
      }

      add({
        title: `${node.name} → ${seg.sw ? nameOf(seg.sw) : dstName} へ送り出す`,
        text,
        at: id,
        moves: [[id, seg.sw || target.node]],
        rest: [{ node: seg.sw || target.node, type }],
        packet: ipPacket(pkt, eth),
        table: null,
      });

      if (seg.sw) {
        macTable.set(eth.src, id);
        const known = macTable.get(eth.dst);
        add({
          title: `${nameOf(seg.sw)}が ${dstName} のポートにだけ送る`,
          text:
            `スイッチは MAC アドレス表で、あて先 MAC \`${eth.dst}\` がどのポートの先にあるかを調べます` +
            (known ? "（さっきの ARP のやりとりで覚えました）。" : "。") +
            `\nスイッチは**フレームの中身を書きかえません**。MAC も IP も TTL もそのままです。`,
          at: seg.sw,
          moves: [[seg.sw, target.node]],
          rest: [{ node: target.node, type }],
          packet: ipPacket(pkt, eth),
          table: macTableView(out.seg, macTable, eth.dst),
        });
      }
    }

    /** 受け取った側の処理。次に送る {node, pkt, inIf} か null */
    function receive(id, ifName, pkt, eth) {
      const node = NODES[id];
      const mine = node.ifaces[ifName];

      if (node.type === "host") {
        const ok = pkt.dst === mine.ip;
        if (pkt.proto === "ICMP") {
          add({
            title: `${node.name} に知らせ（ICMP）が届いた`,
            text:
              `「${pkt.data}」という知らせです。送ったパケットは届かなかったことがわかります。` +
              (pkt.reason === "ttl"
                ? "\n`traceroute`（Windows では `tracert`）は、TTL を 1, 2, 3… と増やしながら送り、この知らせを返してきたルーターを順に並べて、通り道を調べています。"
                : ""),
            at: id,
            rest: [{ node: id, type: "icmp" }],
            packet: ipPacket(pkt, eth),
            table: null,
            tone: "ok",
          });
          return null;
        }
        add({
          title: ok ? `${node.name} が受け取った！` : `${node.name} あてではない`,
          text: ok
            ? `あて先 MAC も、あて先 IP（\`${pkt.dst}\`）も自分なので受け取ります。フレームと IP の部分を外して、中身（${pkt.data}）をプログラムにわたします。`
            : "自分あてではないので捨てます。",
          at: id,
          rest: [{ node: id, type: ok ? "ip" : "drop" }],
          packet: ipPacket(pkt, eth),
          table: null,
          tone: ok ? "ok" : "drop",
        });
        return null;
      }

      // ルーター
      const p2 = { ...pkt, ttl: pkt.ttl - 1 };
      if (pkt.proto !== "ICMP") hops.push(id);
      if (!pkt.brief) {
        add({
          title: `${node.name} が受け取って、TTL を 1 減らす`,
          text:
            `あて先 MAC が自分（${node.name} の \`${ifName}\`）なので受け取り、フレームの部分を外します。` +
            `あて先 IP \`${pkt.dst}\` は自分ではないので、**中継**します。` +
            `\nルーターを通るたびに TTL を 1 減らします: \`${pkt.ttl}\` → \`${p2.ttl}\`。`,
          at: id,
          rest: [{ node: id, type: "ip" }],
          packet: ipPacket(p2, null),
          table: null,
        });
      }
      if (p2.ttl <= 0) {
        if (pkt.proto !== "ICMP") result = "ttl";
        add({
          title: `TTL が 0 になったので、${node.name} が捨てる`,
          text:
            "TTL が 0 になったパケットは、そこで捨てられます。" +
            "道がぐるぐる回って（ループして）いても、パケットがネットワークにいつまでも残らないようにするためのしくみです。",
          at: id,
          rest: [{ node: id, type: "drop" }],
          packet: ipPacket(p2, null),
          table: null,
          tone: "drop",
        });
        return icmpBack(id, ifName, p2, "ttl");
      }
      return { node: id, pkt: p2, inIf: ifName };
    }

    /** ルーターが送り主に「届かなかった」と知らせる（ICMP） */
    function icmpBack(id, inIf, orig, reason) {
      const node = NODES[id];
      if (orig.proto === "ICMP" || node.type !== "router" || !inIf) return null;
      const back = {
        pid: ++pidSeq,
        src: node.ifaces[inIf].ip,
        dst: orig.src,
        ttl: 64,
        proto: "ICMP",
        brief: true,
        reason,
        data: reason === "ttl" ? "ICMP 時間切れ（Time Exceeded）" : "ICMP あて先に届けられません（Destination Unreachable）",
      };
      add({
        title: `${node.name} が送り主に知らせ（ICMP）を返す`,
        text:
          `だまって捨てるだけでなく、送り主 \`${orig.src}\`（${ipLabel(orig.src)}）に「${back.data}」という **ICMP** パケットを送ります。` +
          "\nこの知らせも、ふつうのパケットと同じようにルーティング表を見て運ばれます（ここからは少し早送り）。",
        at: id,
        rest: [{ node: id, type: "icmp" }],
        packet: ipPacket(back, null),
        table: null,
      });
      return { node: id, pkt: back, inIf: null };
    }

    function summaryStep() {
      const routerNames = hops.map(nameOf);
      const lines = [];
      if (result === "delivered") {
        lines.push(`${nameOf(from)} から \`${dst}\` に届きました。通ったルーター: ${routerNames.length ? routerNames.join(" → ") : "なし（同じネットワークの中）"}。`);
        lines.push("**IP アドレス**（送り主とあて先）は、最初から最後まで変わりませんでした。");
        if (routerNames.length) {
          lines.push("**MAC アドレス**は、ルーターを通るたびに、その区間の送り手と受け手に書きかわりました。");
          lines.push(`**TTL** は、ルーターを ${routerNames.length} 台通ったので \`${ttl0}\` → \`${ttl0 - routerNames.length}\`。`);
        } else {
          lines.push("同じネットワークの中なので、ルーターは通らず、TTL も減りませんでした。スイッチは MAC アドレスだけを見て中継します。");
        }
      } else if (result === "ttl") {
        lines.push(`TTL \`${ttl0}\` で送ったので、${routerNames.length} 台目の ${routerNames[routerNames.length - 1]} で TTL が 0 になり、捨てられました。`);
        lines.push("TTL を大きくすれば、もっと先まで届きます。上の TTL の数字を変えて、どこまで届くか試してみましょう。");
      } else if (result === "noroute") {
        lines.push(`\`${dst}\` への道を知っているルーターがなく、途中で捨てられました。`);
        lines.push("ルーターは、自分のルーティング表に書いてあることしか知りません。どの行にも当てはまらず、デフォルトルートもないと、パケットは捨てられます。");
      } else {
        lines.push(`\`${dst}\` を持っている機械が、同じネットワークにいませんでした。ARP に返事がないと、MAC アドレスがわからず送れません。`);
      }
      return {
        title: "まとめ",
        text: lines.join("\n"),
        at: null,
        rest: steps.length ? steps[steps.length - 1].rest : [],
        packet: null,
        table: null,
        tone: result === "delivered" ? "ok" : "drop",
        summary: true,
      };
    }
  }

  const api = {
    NODES,
    SEGMENTS,
    DESTINATIONS,
    SOURCES,
    PRESETS,
    simulate,
    networkOf,
    maskOf,
    lookup,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.NetSim = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
