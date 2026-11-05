/* 画面の動き。net.js と os.js を先に読みこんでください。 */
(function () {
  "use strict";
  const Net = window.NetSim;
  const Os = window.OsSim;
  const SVGNS = "http://www.w3.org/2000/svg";
  const $ = (id) => document.getElementById(id);
  const reduceMotion = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------- 小さな道具 ----------
  /** `code` と **太字** を要素にする（文字はすべて textContent で入れる） */
  function rich(el, text) {
    String(text)
      .split(/(`[^`]+`|\*\*[^*]+\*\*)/)
      .forEach((part) => {
        if (!part) return;
        if (part[0] === "`" && part.length > 1) {
          const c = document.createElement("code");
          c.textContent = part.slice(1, -1);
          el.appendChild(c);
        } else if (part.startsWith("**")) {
          el.appendChild(rich(document.createElement("b"), part.slice(2, -2)));
        } else el.appendChild(document.createTextNode(part));
      });
    return el;
  }
  function h(tag, cls, text) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined && text !== null) rich(el, text);
    return el;
  }
  function s(tag, attrs, parent) {
    const el = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
    if (parent) parent.appendChild(el);
    return el;
  }
  function stext(parent, x, y, text, cls, anchor) {
    const t = s("text", { x, y, class: cls || "" }, parent);
    if (anchor) t.setAttribute("text-anchor", anchor);
    t.textContent = text;
    return t;
  }
  const store = {
    get(k) {
      try {
        return localStorage.getItem(k);
      } catch (e) {
        return null;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(k, v);
      } catch (e) {
        /* 保存できなくても動く */
      }
    },
  };

  function narrate(box, title, lines, stepText, tone) {
    box.replaceChildren();
    const head = h("div", "narr-head");
    head.appendChild(h("span", "step-no", stepText));
    head.appendChild(h("h2", "", title));
    box.appendChild(head);
    const body = h("div", "narr-text");
    lines.forEach((l) => body.appendChild(h("p", "", l)));
    box.appendChild(body);
    if (tone) box.dataset.tone = tone;
    else delete box.dataset.tone;
  }

  function table(cols, rows, opts) {
    opts = opts || {};
    const t = h("table", "t" + (opts.cls ? " " + opts.cls : ""));
    const thead = h("thead");
    const tr = h("tr");
    cols.forEach((c, i) => {
      const th = h("th", opts.numCols && opts.numCols.includes(i) ? "num" : "", c);
      th.scope = "col";
      tr.appendChild(th);
    });
    thead.appendChild(tr);
    t.appendChild(thead);
    const tb = h("tbody");
    rows.forEach((r, ri) => {
      const row = h("tr", (opts.state && opts.state[ri]) || "");
      r.forEach((cell, ci) => {
        const td = h("td", opts.numCols && opts.numCols.includes(ci) ? "num" : opts.mono && opts.mono.includes(ci) ? "mono" : "");
        if (cell instanceof Node) td.appendChild(cell);
        else rich(td, cell);
        row.appendChild(td);
      });
      tb.appendChild(row);
    });
    t.appendChild(tb);
    const wrap = h("div", "tbl-wrap");
    wrap.appendChild(t);
    return wrap;
  }

  // ---------- 1ステップずつ進めるボタン ----------
  const SPEEDS = { slow: 1.6, normal: 1, fast: 0.55 };

  function makePlayer(root, opts) {
    let n = 0;
    let i = 0;
    let timer = 0;
    let playing = false;

    const btn = (label, cls, aria) => {
      const b = h("button", "pbtn" + (cls ? " " + cls : ""), label);
      b.type = "button";
      if (aria) b.setAttribute("aria-label", aria);
      root.appendChild(b);
      return b;
    };
    const first = btn("⏮", "", "最初にもどる");
    const prev = btn("◀ 前へ", "");
    const next = btn("次へ ▶", "pbtn-main");
    const play = btn("▶ 自動", "");
    const speed = h("select", "speed");
    speed.setAttribute("aria-label", "自動で進む速さ");
    [
      ["slow", "ゆっくり"],
      ["normal", "ふつう"],
      ["fast", "はやい"],
    ].forEach(([v, l]) => {
      const o = h("option", "", l);
      o.value = v;
      speed.appendChild(o);
    });
    speed.value = store.get("zukai-speed") || "normal";
    root.appendChild(speed);
    const bar = h("div", "pbar");
    bar.setAttribute("role", "group");
    bar.setAttribute("aria-label", "ステップの場所");
    root.appendChild(bar);

    const factor = () => SPEEDS[speed.value] || 1;

    function stop() {
      playing = false;
      clearTimeout(timer);
      play.textContent = "▶ 自動";
      play.setAttribute("aria-pressed", "false");
    }
    function schedule() {
      clearTimeout(timer);
      if (!playing) return;
      if (i >= n - 1) return stop();
      timer = setTimeout(() => {
        go(i + 1, true);
        schedule();
      }, opts.delay(i) * factor());
    }
    function paint() {
      first.disabled = prev.disabled = i <= 0;
      next.disabled = i >= n - 1;
      [...bar.children].forEach((b, j) => {
        b.className = j < i ? "past" : j === i ? "now" : "";
        if (j === i) b.setAttribute("aria-current", "step");
        else b.removeAttribute("aria-current");
      });
    }
    function go(j, animate) {
      j = Math.max(0, Math.min(n - 1, j));
      const forward = j === i + 1;
      i = j;
      paint();
      opts.onShow(i, animate && forward, factor());
    }
    function setCount(count) {
      stop();
      n = count;
      bar.replaceChildren();
      for (let j = 0; j < n; j++) {
        const b = h("button");
        b.type = "button";
        b.setAttribute("aria-label", `ステップ ${j + 1}`);
        b.addEventListener("click", () => {
          stop();
          go(j, false);
        });
        bar.appendChild(b);
      }
      i = 0;
      paint();
      opts.onShow(0, false, factor());
    }

    first.addEventListener("click", () => {
      stop();
      go(0, false);
    });
    prev.addEventListener("click", () => {
      stop();
      go(i - 1, false);
    });
    next.addEventListener("click", () => {
      stop();
      go(i + 1, true);
    });
    play.addEventListener("click", () => {
      if (playing) return stop();
      if (i >= n - 1) go(0, false);
      playing = true;
      play.textContent = "⏸ 止める";
      play.setAttribute("aria-pressed", "true");
      go(i + 1, true);
      schedule();
    });
    speed.addEventListener("change", () => store.set("zukai-speed", speed.value));

    return {
      setCount,
      stop,
      prev: () => (stop(), go(i - 1, false)),
      next: () => (stop(), go(i + 1, true)),
      get index() {
        return i;
      },
      get count() {
        return n;
      },
    };
  }

  // =====================================================================
  //  ネットワーク
  // =====================================================================
  const net = {
    steps: [],
    svg: $("net-svg"),
    nodeEls: {},
    tokLayer: null,
    raf: 0,
  };

  // 横長（パソコン）と縦長（スマホ）の2つの配置
  const narrow = window.matchMedia ? window.matchMedia("(max-width: 720px)") : { matches: false };
  const NET_LAYOUT = {
    wide: {
      viewBox: "0 0 860 330",
      maxWidth: "1000px",
      pos: (id) => [Net.NODES[id].x, Net.NODES[id].y],
      labels: { lan1: [210, 222, "middle"], l12: [458, 98, "middle"], l13: [458, 240, "middle"], lan2: [700, 62, "middle"], lan3: [700, 244, "middle"] },
      ifK: 0.36,
    },
    tall: {
      viewBox: "0 0 360 690",
      maxWidth: "440px",
      pos: (id) =>
        ({ pca: [70, 50], pcb: [290, 50], sw1: [180, 160], r1: [180, 300], r2: [70, 460], r3: [290, 460], srv: [70, 620], srv2: [290, 620] }[id]),
      labels: { lan1: [196, 236, "start"], l12: [58, 372, "middle"], l13: [302, 372, "middle"], lan2: [130, 545, "middle"], lan3: [230, 545, "middle"] },
      ifK: 0.45,
    },
  };
  const netLayout = () => (narrow.matches ? NET_LAYOUT.tall : NET_LAYOUT.wide);

  function drawNet() {
    const svg = net.svg;
    const LY = netLayout();
    svg.setAttribute("viewBox", LY.viewBox);
    svg.style.maxWidth = LY.maxWidth;
    svg.replaceChildren();
    net.nodeEls = {};
    const wires = s("g", {}, svg);
    const labels = s("g", {}, svg);
    const nodesG = s("g", {}, svg);
    net.tokLayer = s("g", {}, svg);

    const N = Net.NODES;
    const membersOf = (seg) =>
      Object.entries(N)
        .filter(([, n]) => n.ifaces && Object.values(n.ifaces).some((f) => f.seg === seg))
        .map(([id]) => id);

    for (const [segId, seg] of Object.entries(Net.SEGMENTS)) {
      const mem = membersOf(segId);
      const pairs = seg.sw ? mem.map((m) => [seg.sw, m]) : [[mem[0], mem[1]]];
      for (const [a, b] of pairs) {
        const [x1, y1] = LY.pos(a);
        const [x2, y2] = LY.pos(b);
        s("line", { x1, y1, x2, y2, class: "wire" }, wires);
      }
      const [lx, ly, anchor] = LY.labels[segId] || [0, 0, "middle"];
      stext(labels, lx, ly, seg.net, "net-label", anchor);
    }
    // ルーターの口（インターフェース）の名前と IP の最後の数字
    for (const [id, n] of Object.entries(N)) {
      if (n.type !== "router") continue;
      for (const [ifName, f] of Object.entries(n.ifaces)) {
        const seg = Net.SEGMENTS[f.seg];
        const other = seg.sw || membersOf(f.seg).find((m) => m !== id);
        const [nx, ny] = LY.pos(id);
        const [ox, oy] = LY.pos(other);
        const x = nx + (ox - nx) * LY.ifK;
        const y = ny + (oy - ny) * LY.ifK + 4;
        stext(labels, x, y, `${ifName} .${f.ip.split(".").pop()}`, "if-label", "middle");
      }
    }

    for (const [id, n] of Object.entries(N)) {
      const [nx, ny] = LY.pos(id);
      const g = s("g", { class: "node", transform: `translate(${nx} ${ny})` }, nodesG);
      s("circle", { r: 40, class: "halo" }, g);
      if (n.type === "host") {
        s("rect", { x: -22, y: -18, width: 44, height: 30, rx: 4, class: "shape" }, g);
        s("path", { d: "M-8 18 H8 M0 12 V18", class: "glyph" }, g);
        stext(g, 0, 40, n.name, "name", "middle");
        stext(g, 0, 55, Object.values(n.ifaces)[0].ip, "addr", "middle");
      } else if (n.type === "router") {
        s("circle", { r: 24, class: "shape" }, g);
        s("path", { d: "M-12 -4 H10 M5 -9 L10 -4 L5 1 M12 6 H-10 M-5 1 L-10 6 L-5 11", class: "glyph" }, g);
        stext(g, 0, 44, n.name, "name", "middle");
        stext(g, 0, 59, "ルーター", "addr", "middle");
      } else {
        s("rect", { x: -30, y: -14, width: 60, height: 28, rx: 5, class: "shape" }, g);
        s("path", { d: "M-20 5 h6 M-7 5 h6 M6 5 h6 M-18 -5 H18", class: "glyph" }, g);
        stext(g, 0, 34, n.name, "name", "middle");
      }
      net.nodeEls[id] = g;
    }
  }

  const TOKEN_TEXT = { ip: "IP", arp: "ARP", icmp: "ICMP", drop: "✕" };
  function token(type, x, y) {
    const g = s("g", { class: `tok tok-${type}`, transform: `translate(${x} ${y})` }, net.tokLayer);
    const w = type === "icmp" ? 44 : 36;
    s("rect", { x: -w / 2, y: -11, width: w, height: 22, rx: 5 }, g);
    stext(g, 0, 4, TOKEN_TEXT[type] || "IP", "", "middle");
    return g;
  }
  const center = (id) => netLayout().pos(id);
  const perch = (id) => {
    const [x, y] = netLayout().pos(id);
    return [x, y - (Net.NODES[id].type === "switch" ? 30 : 36)];
  };

  function placeTokens(rest) {
    cancelAnimationFrame(net.raf);
    net.tokLayer.replaceChildren();
    for (const r of rest || []) token(r.type, ...perch(r.node));
  }

  function animateMoves(moves, type, rest, factor) {
    cancelAnimationFrame(net.raf);
    net.tokLayer.replaceChildren();
    const paths = moves.map((ids) => {
      const pts = [perch(ids[0]), ...ids.map(center), perch(ids[ids.length - 1])];
      const lens = [];
      let total = 0;
      for (let k = 1; k < pts.length; k++) {
        const d = Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
        lens.push(d);
        total += d;
      }
      return { pts, lens, total, el: token(type, ...pts[0]) };
    });
    const longest = Math.max(...paths.map((p) => p.total));
    const dur = Math.max(600, Math.min(1900, (longest / 340) * 1000)) * factor;
    const t0 = performance.now();
    const ease = (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);
    const frame = (now) => {
      const p = Math.min(1, (now - t0) / dur);
      const e = ease(p);
      for (const path of paths) {
        let d = e * path.total;
        let k = 0;
        while (k < path.lens.length - 1 && d > path.lens[k]) d -= path.lens[k++];
        const a = path.pts[k];
        const b = path.pts[k + 1];
        const f = path.lens[k] ? Math.min(1, d / path.lens[k]) : 1;
        path.el.setAttribute("transform", `translate(${a[0] + (b[0] - a[0]) * f} ${a[1] + (b[1] - a[1]) * f})`);
      }
      if (p < 1) net.raf = requestAnimationFrame(frame);
      else placeTokens(rest);
    };
    net.raf = requestAnimationFrame(frame);
  }

  function packetPanel(i) {
    const box = $("net-packet");
    box.replaceChildren();
    const st = net.steps[i];
    const pk = st.packet;
    if (!pk) {
      box.appendChild(h("p", "empty", st.summary ? "上の「まとめ」を読んで、もう一度最初から見たり、送り先や TTL を変えたりしてみましょう。" : "このステップではパケットはありません。"));
      return;
    }
    // ひとつ前の、同じパケットのようす（変わったところに色をつける）
    let prevIp = null;
    let prevEth = null;
    for (let j = i - 1; j >= 0; j--) {
      const q = net.steps[j].packet;
      if (!q || q.pid !== pk.pid) continue;
      if (!prevIp && q.ip) prevIp = q.ip;
      if (!prevEth && q.eth) prevEth = q.eth;
      if (prevIp && prevEth) break;
    }
    const wrap = h("div", "pkt");
    const kv = (rows) => {
      const dl = h("dl", "kv");
      for (const [label, value, sub, changed] of rows) {
        dl.appendChild(h("dt", "", label));
        const dd = h("dd", changed ? "changed" : "");
        const c = h("code");
        c.textContent = value;
        dd.appendChild(c);
        if (sub) dd.appendChild(h("small", "", sub));
        dl.appendChild(dd);
      }
      return dl;
    };

    const l2 = h("div", "layer l2" + (pk.eth ? "" : " off"));
    const l2h = h("h4", "", "イーサネット（フレーム）");
    l2h.appendChild(h("small", "", "となりの機械まで"));
    l2.appendChild(l2h);
    if (pk.eth) {
      l2.appendChild(
        kv([
          ["あて先 MAC", pk.eth.dst, pk.eth.dstLabel, prevEth && prevEth.dst !== pk.eth.dst],
          ["送信元 MAC", pk.eth.src, pk.eth.srcLabel, prevEth && prevEth.src !== pk.eth.src],
        ])
      );
    } else {
      l2.appendChild(h("p", "empty", "まだ付けていない／ルーターの中では外してある"));
    }
    wrap.appendChild(l2);

    if (pk.arp) {
      const a = h("div", "layer l3");
      a.appendChild(h("h4", "", pk.arp.op === "request" ? "ARP 問い合わせ" : "ARP 返事"));
      a.appendChild(h("p", "", pk.arp.text));
      wrap.appendChild(a);
    } else {
      const l3 = h("div", "layer l3");
      const l3h = h("h4", "", "IP");
      l3h.appendChild(h("small", "", "最後のあて先まで"));
      l3.appendChild(l3h);
      l3.appendChild(
        kv([
          ["送り主 IP", pk.ip.src, pk.ip.srcLabel, prevIp && prevIp.src !== pk.ip.src],
          ["あて先 IP", pk.ip.dst, pk.ip.dstLabel, prevIp && prevIp.dst !== pk.ip.dst],
          ["TTL", String(pk.ip.ttl), "あと何台のルーターを通れるか", prevIp && prevIp.ttl !== pk.ip.ttl],
        ])
      );
      wrap.appendChild(l3);
      const l4 = h("div", "layer l4");
      l4.appendChild(h("h4", "", "中身（データ）"));
      l4.appendChild(h("p", "", pk.data));
      wrap.appendChild(l4);
    }
    box.appendChild(wrap);
    box.appendChild(h("p", "legend-note", "上が外側のヘッダーです。黄色は、前のステップから変わったところ。"));
  }

  function tablePanel(st) {
    const box = $("net-table");
    const title = $("net-table-title");
    box.replaceChildren();
    const tb = st.table;
    if (!tb) {
      title.textContent = "表";
      box.appendChild(h("p", "empty", "このステップでは表を使いません。ルーティング表・ARP 表・スイッチの MAC アドレス表は、使うときにここに出ます。"));
      return;
    }
    title.textContent = tb.title;
    if (!tb.rows.length) {
      box.appendChild(h("p", "empty", `（${tb.empty || "空"}）`));
      return;
    }
    let cols = tb.cols;
    let rows = tb.rows;
    if (tb.calc) {
      cols = [...cols, "あて先 AND マスク"];
      rows = rows.map((r, k) => {
        const c = tb.calc[k];
        const span = h("span", c.ok ? "ok" : "ng", `${c.text.split(" = ")[1]} ${c.ok ? "✓" : "✕"}`);
        span.title = c.text;
        return [...r, span];
      });
    }
    box.appendChild(table(cols, rows, { state: tb.state, mono: tb.kind === "route" ? [0, 3] : [0, 1] }));
    if (tb.calc) {
      box.appendChild(
        h(
          "p",
          "t-note",
          "あて先 IP を各行のマスク（`/24` なら `255.255.255.0`）で AND して、行のネットワークと同じなら当てはまる（✓）。✓ がいくつもあれば、`/` の数字がいちばん大きい行を使う（最長一致）。"
        )
      );
    } else if (tb.kind === "arp") {
      box.appendChild(h("p", "t-note", "ARP 表は、同じネットワークの相手の「IP アドレス → MAC アドレス」のメモです。"));
    } else if (tb.kind === "mac") {
      box.appendChild(h("p", "t-note", "スイッチは、届いたフレームの送信元 MAC を見て「この MAC はこのポートの先にいる」と覚えます。"));
    }
  }

  function showNet(i, animate, factor) {
    const st = net.steps[i];
    for (const [id, el] of Object.entries(net.nodeEls)) el.classList.toggle("on", id === st.at);
    const type = st.packet ? st.packet.type : (st.rest[0] && st.rest[0].type) || "ip";
    if (animate && st.moves && st.moves.length && !reduceMotion()) animateMoves(st.moves, type, st.rest, factor);
    else placeTokens(st.rest);
    narrate($("net-narr"), st.title, st.text.split("\n"), `${i + 1} / ${net.steps.length}`, st.tone);
    packetPanel(i);
    tablePanel(st);
  }

  const netPlayer = makePlayer($("net-player"), {
    onShow: showNet,
    delay: (i) => (net.steps[i + 1] && net.steps[i + 1].moves ? 2600 : 2300),
  });

  const netFrom = $("net-from");
  const netTo = $("net-to");
  const netTtl = $("net-ttl");

  function runNet() {
    const r = Net.simulate({ from: netFrom.value, to: netTo.value, ttl: netTtl.value });
    net.steps = r.steps;
    for (const b of $("net-presets").querySelectorAll("button")) {
      const p = Net.PRESETS.find((x) => x.id === b.dataset.id);
      const on = p.from === netFrom.value && p.to === netTo.value && Number(p.ttl) === Number(netTtl.value);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    }
    netPlayer.setCount(net.steps.length);
  }

  function initNet() {
    for (const id of Net.SOURCES) {
      const n = Net.NODES[id];
      const o = h("option", "", `${n.name}（${Object.values(n.ifaces)[0].ip}）`);
      o.value = id;
      netFrom.appendChild(o);
    }
    for (const d of Net.DESTINATIONS) {
      const o = h("option", "", d.label);
      o.value = d.ip;
      netTo.appendChild(o);
    }
    for (const p of Net.PRESETS) {
      const b = h("button", "chip-btn", p.label);
      b.type = "button";
      b.dataset.id = p.id;
      b.addEventListener("click", () => {
        netFrom.value = p.from;
        netTo.value = p.to;
        netTtl.value = p.ttl;
        runNet();
      });
      $("net-presets").appendChild(b);
    }
    netFrom.value = "pca";
    netTo.value = "172.16.1.80";
    netFrom.addEventListener("change", runNet);
    netTo.addEventListener("change", runNet);
    let t = 0;
    netTtl.addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(runNet, 350);
    });
    drawNet();
    runNet();
  }

  // =====================================================================
  //  OS
  // =====================================================================
  const os = {
    cfg: null,
    run: null,
    svg: $("os-svg"),
    toks: {},
    arrows: {},
    swap: null,
  };

  const OS_LAYOUT = {
    wide: {
      viewBox: "0 0 660 336",
      maxWidth: "760px",
      head: [338, 152, "先頭 →", "end"],
      swap: [628, 152],
      box: {
        new: { x: 20, y: 12, w: 230, h: 84, label: "新規", sub: "まだ来ていない" },
        done: { x: 410, y: 12, w: 230, h: 84, label: "終了", sub: "" },
        ready: { x: 20, y: 132, w: 330, h: 84, label: "実行可能", sub: "CPU の順番待ちの列" },
        running: { x: 440, y: 132, w: 200, h: 84, label: "実行中", sub: "CPU" },
        blocked: { x: 190, y: 246, w: 280, h: 80, label: "待ち", sub: "I/O が終わるのを待つ" },
      },
      arrows: {
        "new-ready": { d: "M135 96 L135 130", label: "到着", lx: 145, ly: 118, anchor: "start" },
        "ready-running": { d: "M350 160 L438 160", label: "ディスパッチ", lx: 395, ly: 124, anchor: "middle" },
        "running-ready": { d: "M440 192 L352 192", label: "時間切れ・横取り", lx: 395, ly: 236, anchor: "middle" },
        "running-done": { d: "M540 132 L540 98", label: "終了", lx: 550, ly: 120, anchor: "start" },
        "running-blocked": { d: "M560 216 C560 262 530 286 472 286", label: "I/O を始める", lx: 566, ly: 268, anchor: "start" },
        "blocked-ready": { d: "M190 286 C140 286 112 262 112 218", label: "I/O 完了", lx: 100, ly: 262, anchor: "end" },
      },
      slot: {
        new: (k) => [52 + k * 44, 60],
        ready: (k) => [316 - k * 44, 180],
        running: () => [540, 178],
        blocked: (k) => [230 + k * 44, 290],
        done: (k) => [442 + k * 44, 60],
      },
    },
    tall: {
      viewBox: "0 0 360 486",
      maxWidth: "440px",
      head: [338, 152, "左が先頭", "end"],
      swap: [148, 290],
      box: {
        new: { x: 10, y: 10, w: 340, h: 84, label: "新規", sub: "まだ来ていない" },
        ready: { x: 10, y: 132, w: 340, h: 84, label: "実行可能", sub: "順番待ちの列" },
        running: { x: 10, y: 270, w: 150, h: 84, label: "実行中", sub: "" },
        blocked: { x: 210, y: 270, w: 140, h: 84, label: "待ち", sub: "I/O 中" },
        done: { x: 10, y: 392, w: 340, h: 84, label: "終了", sub: "" },
      },
      arrows: {
        "new-ready": { d: "M60 94 L60 130", label: "到着", lx: 70, ly: 118, anchor: "start" },
        "ready-running": { d: "M60 216 L60 268", label: "ディスパッチ", lx: 68, ly: 247, anchor: "start" },
        "running-ready": { d: "M140 270 L140 218", label: "時間切れ・横取り", lx: 148, ly: 247, anchor: "start" },
        "running-done": { d: "M60 354 L60 390", label: "終了", lx: 70, ly: 378, anchor: "start" },
        "running-blocked": { d: "M160 318 L208 318", label: "I/O", lx: 185, ly: 306, anchor: "middle" },
        "blocked-ready": { d: "M300 270 L300 218", label: "I/O 完了", lx: 296, ly: 247, anchor: "end" },
      },
      slot: {
        new: (k) => [40 + k * 44, 58],
        ready: (k) => [40 + k * 44, 180],
        running: () => [85, 318],
        blocked: (k, n) => [234 + k * (n > 3 ? 72 / (n - 1) : 36), 318],
        done: (k) => [40 + k * 44, 440],
      },
    },
  };
  const osLayout = () => (narrow.matches ? OS_LAYOUT.tall : OS_LAYOUT.wide);

  function drawOsBase() {
    const svg = os.svg;
    const LY = osLayout();
    svg.setAttribute("viewBox", LY.viewBox);
    svg.style.maxWidth = LY.maxWidth;
    svg.replaceChildren();
    os.arrows = {};
    const defs = s("defs", {}, svg);
    for (const [id, color] of [
      ["ah", "var(--wire)"],
      ["ah-on", "var(--accent)"],
    ]) {
      const m = s("marker", { id, viewBox: "0 0 10 10", refX: 8, refY: 5, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse" }, defs);
      const p = s("path", { d: "M0 0 L10 5 L0 10 z" }, m);
      p.style.fill = color;
    }
    for (const [k, b] of Object.entries(LY.box)) {
      s("rect", { x: b.x, y: b.y, width: b.w, height: b.h, rx: 10, class: "sbox" + (k === "running" ? " sbox-run" : "") }, svg);
      const t = stext(svg, b.x + 12, b.y + 20, b.label, "slabel");
      if (b.sub) {
        const sub = s("tspan", { class: "ssub", dx: 8 }, t);
        sub.textContent = b.sub;
      }
    }
    const [hx, hy, htext, hanchor] = LY.head;
    stext(svg, hx, hy, htext, "ssub", hanchor);
    os.swap = stext(svg, LY.swap[0], LY.swap[1], "⇄ 切りかえ", "swap", "end");
    for (const [k, a] of Object.entries(LY.arrows)) {
      const path = s("path", { d: a.d, class: "arrow", "marker-end": "url(#ah)" }, svg);
      const label = stext(svg, a.lx, a.ly, a.label, "arrow-label", a.anchor);
      os.arrows[k] = { path, label };
    }
    os.tokLayer = s("g", {}, svg);
  }

  const pcolor = (name) => `var(--p${name.slice(1)})`;

  function drawOsTokens() {
    os.tokLayer.replaceChildren();
    os.toks = {};
    for (const p of os.run.procs) {
      const g = s("g", { class: "ptok" }, os.tokLayer);
      const c = s("circle", { r: 17 }, g);
      c.style.fill = pcolor(p.name);
      stext(g, 0, 4.5, p.name, "pname", "middle");
      const sub = stext(g, 0, 31, "", "psub", "middle");
      os.toks[p.name] = { g, sub };
    }
  }

  function tokenPositions(f) {
    const slot = osLayout().slot;
    const pos = {};
    const names = os.run.procs.map((p) => p.name);
    names.filter((n) => f.states[n] === "new").forEach((n, k) => (pos[n] = slot.new(k)));
    f.ready.forEach((n, k) => (pos[n] = slot.ready(k)));
    if (f.running) pos[f.running] = slot.running();
    f.blocked.forEach((b, k) => (pos[b.name] = slot.blocked(k, f.blocked.length)));
    names
      .filter((n) => f.states[n] === "done")
      .sort((a, b) => f.procs[a].finish - f.procs[b].finish)
      .forEach((n, k) => (pos[n] = slot.done(k)));
    return pos;
  }

  function showOs(i, animate) {
    const f = os.run.frames[i];
    const pos = tokenPositions(f);
    for (const p of os.run.procs) {
      const t = os.toks[p.name];
      const st = f.states[p.name];
      const info = f.procs[p.name];
      const [x, y] = pos[p.name];
      if (!animate) {
        t.g.style.transition = "none";
        t.g.getBoundingClientRect();
      }
      t.g.style.transform = `translate(${x}px, ${y}px)`;
      if (!animate) requestAnimationFrame(() => (t.g.style.transition = ""));
      t.g.style.opacity = st === "new" ? 0.5 : st === "done" ? 0.75 : 1;
      t.sub.textContent =
        st === "new"
          ? `到着 ${p.arrival}`
          : st === "done"
          ? `終了 ${info.finish}`
          : st === "blocked"
          ? `I/O あと${info.ioLeft}`
          : `残り ${info.left}`;
    }
    for (const [k, a] of Object.entries(os.arrows)) {
      const on = f.arrows.includes(k);
      a.path.classList.toggle("on", on);
      a.label.classList.toggle("on", on);
      a.path.setAttribute("marker-end", on ? "url(#ah-on)" : "url(#ah)");
    }
    os.swap.style.display = f.switchFrom ? "" : "none";

    narrate($("os-narr"), f.title, f.lines, `${i + 1} / ${os.run.frames.length}`, f.end ? "ok" : null);
    pcbPanel(f);
    ganttPanel(f);
    resultPanel(f);
  }

  const STATE_SHORT = { new: "新規", ready: "実行可能", running: "実行中", blocked: "待ち（I/O）", done: "終了" };

  function pcbPanel(f) {
    const rows = os.run.procs.map((p) => {
      const info = f.procs[p.name];
      const st = f.states[p.name];
      const name = h("span");
      const dot = h("span", "dot");
      dot.style.background = pcolor(p.name);
      name.appendChild(dot);
      name.appendChild(document.createTextNode(p.name));
      if (f.switchFrom === p.name && st !== "done") name.appendChild(h("span", "badge badge-save", "保存"));
      if (f.switchTo === p.name) name.appendChild(h("span", "badge badge-load", info.used ? "読み出し" : "はじめて"));
      const prog = h("span");
      const bar = h("span", "bar");
      const fill = h("i");
      fill.style.width = `${(info.used / info.cpu) * 100}%`;
      fill.style.background = pcolor(p.name);
      bar.appendChild(fill);
      prog.appendChild(bar);
      prog.appendChild(document.createTextNode(`${info.used} / ${info.cpu}`));
      return [name, h("span", `st-${st}`, STATE_SHORT[st]), prog, String(info.wait)];
    });
    $("os-pcb").replaceChildren(table(["プロセス", "状態", "進み具合（CPU）", "待った時間"], rows, { cls: "pcb", numCols: [3] }));
  }

  function ganttPanel(f) {
    const T = os.run.timeline.length;
    const t = h("table", "gantt");
    const head = h("tr");
    head.appendChild(h("th", "", ""));
    for (let k = 0; k < T; k++) head.appendChild(h("th", k === f.time ? "now" : "", String(k)));
    head.appendChild(h("th", T === f.time ? "now" : "", String(T)));
    t.appendChild(head);
    for (const p of os.run.procs) {
      const tr = h("tr");
      tr.style.setProperty("--pc", pcolor(p.name));
      tr.appendChild(h("td", "name", p.name));
      for (let k = 0; k < T; k++) {
        let cls = "";
        if (k < f.time) {
          const tl = os.run.timeline[k];
          cls = tl.run === p.name ? "run" : tl.states[p.name] === "ready" ? "wait" : tl.states[p.name] === "blocked" ? "io" : "";
        } else if (k === f.time && f.running === p.name) cls = "next";
        else cls = "future";
        const td = h("td", cls);
        if (cls === "run") td.title = `${k}〜${k + 1}: 実行`;
        tr.appendChild(td);
      }
      tr.appendChild(h("td", ""));
      t.appendChild(tr);
    }
    const box = $("os-gantt");
    box.replaceChildren(t);
    const lg = h("div", "g-legend");
    [
      ["run", "CPU を使っている"],
      ["wait", "列で待っている"],
      ["io", "I/O 中"],
    ].forEach(([c, l]) => {
      const sp = h("span");
      sp.appendChild(h("i", c));
      sp.appendChild(document.createTextNode(l));
      lg.appendChild(sp);
    });
    box.appendChild(lg);
  }

  function resultPanel(f) {
    const box = $("os-result");
    box.replaceChildren();
    const rows = os.run.stats.map((x) => {
      const done = f.procs[x.name].finish != null;
      const q = (v) => (done ? String(v) : "—");
      return [x.name, String(x.arrival), String(x.cpu), String(x.io || 0), q(x.finish), q(x.turnaround), q(x.wait)];
    });
    const state = rows.map(() => "");
    if (f.end) {
      const fmt = (v) => (Math.round(v * 100) / 100).toString();
      rows.push(["平均", "", "", "", "", fmt(os.run.average.turnaround), fmt(os.run.average.wait)]);
      state.push("avg");
    }
    box.appendChild(
      table(["プロセス", "到着", "CPU 時間", "I/O", "終了", "ターンアラウンド", "待ち時間"], rows, {
        numCols: [1, 2, 3, 4, 5, 6],
        state,
      })
    );
    box.appendChild(
      h("p", "formula", "ターンアラウンドタイム ＝ 終了 − 到着　／　待ち時間 ＝ ターンアラウンドタイム − CPU 時間 − I/O の時間（＝列で待っていた時間の合計）")
    );
    if (!f.end) {
      box.appendChild(h("p", "formula", "プロセスが終わると、ここに数字が出ます。最後まで進めると、ほかのやり方との比べっこも出ます。"));
      return;
    }
    const cmp = Object.keys(Os.ALGOS).map((a) => ({ a, avg: Os.schedule({ ...os.cfg, algo: a }).average.wait }));
    const best = Math.min(...cmp.map((c) => c.avg));
    box.appendChild(h("p", "formula", "同じプロセスを、ほかのやり方で動かしたときの **平均待ち時間**:"));
    const grid = h("div", "compare");
    for (const c of cmp) {
      const d = h("div", (c.a === os.run.algo ? "cur " : "") + (c.avg === best ? "best" : ""));
      d.appendChild(h("span", "", Os.ALGOS[c.a].label + (c.a === "rr" ? `（${os.run.quantum}）` : "") + (c.a === os.run.algo ? "・いま" : "")));
      d.appendChild(h("b", "", (Math.round(c.avg * 100) / 100).toString()));
      grid.appendChild(d);
    }
    box.appendChild(grid);
  }

  const osPlayer = makePlayer($("os-player"), { onShow: showOs, delay: () => 1700 });

  function cloneCfg(p) {
    return { algo: p.algo, quantum: p.quantum, procs: p.procs.map((x) => ({ ...x })) };
  }

  function runOs() {
    os.run = Os.schedule(os.cfg);
    for (const b of $("os-presets").querySelectorAll("button")) {
      const p = Os.PRESETS.find((x) => x.id === b.dataset.id);
      b.setAttribute("aria-pressed", JSON.stringify(cloneCfg(p)) === JSON.stringify(normalizedCfg()) ? "true" : "false");
    }
    $("os-algo-note").replaceChildren(
      rich(
        document.createElement("span"),
        Os.ALGOS[os.cfg.algo].note +
          (os.cfg.algo === "rr" ? "　同じ時刻に並ぶときは、新しく来たプロセス → I/O が終わったプロセス → 持ち時間を使い切ったプロセス の順です。" : "")
      )
    );
    $("os-q-wrap").hidden = os.cfg.algo !== "rr";
    drawOsTokens();
    osPlayer.setCount(os.run.frames.length);
  }

  /** プリセットとくらべるための形 */
  function normalizedCfg() {
    return {
      algo: os.cfg.algo,
      quantum: Number(os.cfg.quantum),
      procs: Os.normalize(os.cfg.procs).map((p) => {
        const o = { arrival: p.arrival, cpu: p.cpu };
        if (p.ioAt) Object.assign(o, { ioAt: p.ioAt, ioLen: p.ioLen });
        return o;
      }),
    };
  }

  function renderProcRows() {
    const tb = $("os-procs");
    tb.replaceChildren();
    os.cfg.procs.forEach((p, k) => {
      const tr = h("tr");
      const name = h("td");
      const dot = h("span", "dot");
      dot.style.background = pcolor(`P${k + 1}`);
      name.appendChild(dot);
      name.appendChild(h("b", "", `P${k + 1}`));
      tr.appendChild(name);
      [
        ["arrival", 0, 30, "到着時刻"],
        ["cpu", 1, 20, "CPU 時間"],
        ["ioAt", 1, 19, "I/O を始める"],
        ["ioLen", 1, 20, "I/O の長さ"],
      ].forEach(([key, min, max, label]) => {
        const td = h("td");
        const inp = h("input");
        inp.type = "number";
        inp.min = min;
        inp.max = max;
        inp.value = p[key] == null ? "" : p[key];
        inp.setAttribute("aria-label", `P${k + 1} の${label}`);
        if (key.startsWith("io")) inp.placeholder = "なし";
        inp.addEventListener("input", () => {
          p[key] = inp.value === "" ? null : Number(inp.value);
          clearTimeout(os.timer);
          os.timer = setTimeout(runOs, 400);
        });
        td.appendChild(inp);
        tr.appendChild(td);
      });
      const td = h("td");
      const x = h("button", "x", "×");
      x.type = "button";
      x.setAttribute("aria-label", `P${k + 1} を消す`);
      x.disabled = os.cfg.procs.length <= 1;
      x.addEventListener("click", () => {
        os.cfg.procs.splice(k, 1);
        renderProcRows();
        runOs();
      });
      td.appendChild(x);
      tr.appendChild(td);
      tb.appendChild(tr);
    });
    $("os-add").disabled = os.cfg.procs.length >= Os.MAX_PROCS;
  }

  function setAlgoRadios() {
    for (const r of $("os-algo").querySelectorAll("input")) r.checked = r.value === os.cfg.algo;
    $("os-q").value = os.cfg.quantum;
  }

  function initOs() {
    const algoBox = $("os-algo");
    for (const [k, a] of Object.entries(Os.ALGOS)) {
      const lab = h("label");
      lab.title = a.long;
      const r = h("input");
      r.type = "radio";
      r.name = "os-algo";
      r.value = k;
      r.addEventListener("change", () => {
        os.cfg.algo = k;
        runOs();
      });
      lab.appendChild(r);
      lab.appendChild(h("span", "", a.label));
      algoBox.appendChild(lab);
    }
    for (const p of Os.PRESETS) {
      const b = h("button", "chip-btn", p.label);
      b.type = "button";
      b.dataset.id = p.id;
      b.addEventListener("click", () => {
        os.cfg = cloneCfg(p);
        setAlgoRadios();
        renderProcRows();
        runOs();
      });
      $("os-presets").appendChild(b);
    }
    $("os-q").addEventListener("input", () => {
      os.cfg.quantum = Number($("os-q").value) || 1;
      clearTimeout(os.timer);
      os.timer = setTimeout(runOs, 350);
    });
    $("os-add").addEventListener("click", () => {
      if (os.cfg.procs.length >= Os.MAX_PROCS) return;
      const last = os.cfg.procs[os.cfg.procs.length - 1];
      os.cfg.procs.push({ arrival: last ? Number(last.arrival || 0) + 1 : 0, cpu: 3 });
      renderProcRows();
      runOs();
    });
    os.cfg = cloneCfg(Os.PRESETS[0]);
    drawOsBase();
    setAlgoRadios();
    renderProcRows();
    runOs();
  }

  // =====================================================================
  //  タブとキーボード
  // =====================================================================
  const TABS = [
    { tab: $("tab-net"), panel: $("panel-net"), hash: "#net", player: netPlayer },
    { tab: $("tab-os"), panel: $("panel-os"), hash: "#os", player: osPlayer },
  ];
  let active = TABS[0];

  function selectTab(t, focus) {
    for (const x of TABS) {
      const on = x === t;
      x.tab.setAttribute("aria-selected", on ? "true" : "false");
      x.tab.tabIndex = on ? 0 : -1;
      x.panel.hidden = !on;
      if (!on) x.player.stop();
    }
    active = t;
    if (focus) t.tab.focus();
    if (location.hash !== t.hash) history.replaceState(null, "", t.hash);
    store.set("zukai-tab", t.hash);
  }
  TABS.forEach((t, k) => {
    t.tab.addEventListener("click", () => selectTab(t));
    t.tab.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        e.stopPropagation();
        selectTab(TABS[(k + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length], true);
      }
    });
  });

  document.addEventListener("keydown", (e) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    const tag = (e.target && e.target.tagName) || "";
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(tag) || (e.target && e.target.getAttribute && e.target.getAttribute("role") === "tab")) return;
    if (e.key === "ArrowRight") {
      e.preventDefault();
      active.player.next();
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      active.player.prev();
    }
  });

  initNet();
  initOs();
  const relayout = () => {
    drawNet();
    netPlayer.stop();
    showNet(netPlayer.index, false, 1);
    drawOsBase();
    drawOsTokens();
    osPlayer.stop();
    showOs(osPlayer.index, false);
  };
  if (narrow.addEventListener) narrow.addEventListener("change", relayout);
  const start = TABS.find((t) => t.hash === location.hash) || TABS.find((t) => t.hash === store.get("zukai-tab")) || TABS[0];
  selectTab(start);
  window.addEventListener("hashchange", () => {
    const t = TABS.find((x) => x.hash === location.hash);
    if (t && t !== active) selectTab(t);
  });
})();
