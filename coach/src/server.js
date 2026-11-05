/*
 * 画面用の小さな HTTP サーバー（自分のPCの中だけ: 127.0.0.1）
 *
 *   GET  /                 画面（public/index.html）
 *   GET  /api/dashboard    ダッシュボードのまとめ
 *   GET  /api/next?session=ID      次の問題
 *   POST /api/answer       { session, itemId, answer, latencyMs, hintUsed, selfScore? }
 *   POST /api/override     { attemptId, grade }
 *   POST /api/suspend      { itemId, on }
 *   POST /api/explain      { attemptId }
 *   POST /api/daily        { force }       定期実行を今すぐ
 *   GET  /api/report       いちばん新しい日のまとめ（Markdown）
 */
"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { runDaily } = require("./daily.js");

const PUBLIC = path.join(__dirname, "..", "public");

function send(res, status, body, type = "application/json; charset=utf-8") {
  const data = type.startsWith("application/json") ? JSON.stringify(body) : body;
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(data);
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > 1e6) throw Object.assign(new Error("データが大きすぎます"), { status: 413 });
    chunks.push(c);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("JSON が読めません"), { status: 400 });
  }
}

function createServer(coach, { log = () => {} } = {}) {
  const routes = {
    "GET /api/dashboard": () => coach.dashboard(),
    "GET /api/next": (q) => ({ next: coach.next(q.get("session") || "default"), dashboard: coach.dashboard() }),
    "POST /api/answer": (_, b) => coach.answer({ sessionId: b.session || "default", itemId: b.itemId, answer: b.answer, latencyMs: Number(b.latencyMs) || 0, hintUsed: !!b.hintUsed, selfScore: b.selfScore === undefined ? undefined : Number(b.selfScore) }),
    "POST /api/override": (_, b) => coach.override(b.attemptId, Number(b.grade)),
    "POST /api/suspend": (_, b) => (coach.suspend(b.itemId, b.on !== false), { ok: true }),
    "POST /api/explain": (_, b) => coach.explain(b.attemptId),
    "POST /api/daily": (_, b) => runDaily(coach, { force: !!b.force }),
    "GET /api/report": () => {
      const dir = path.join(coach.dataDir, "reports");
      const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".md")).sort() : [];
      const f = files[files.length - 1];
      return f ? { date: f.replace(/\.md$/, ""), markdown: fs.readFileSync(path.join(dir, f), "utf8") } : { date: null, markdown: "" };
    },
  };

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    try {
      // 自分のPCの名前で来たリクエストだけ受けつける（DNS リバインディング対策）
      if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host || "")) return send(res, 403, { error: "localhost から開いてください" });
      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
        return send(res, 200, fs.readFileSync(path.join(PUBLIC, "index.html")), "text/html; charset=utf-8");
      }
      const route = routes[`${req.method} ${url.pathname}`];
      if (!route) return send(res, 404, { error: "見つかりません" });
      if (req.method === "POST") {
        // ほかのサイトから勝手に POST されないように、同じオリジンだけ受けつける
        const origin = req.headers.origin;
        if (origin && origin !== `http://${req.headers.host}`) return send(res, 403, { error: "別のサイトからは使えません" });
      }
      const body = req.method === "POST" ? await readJson(req) : null;
      send(res, 200, await route(url.searchParams, body));
    } catch (e) {
      log(`[${req.method} ${url.pathname}] ${e.message}`);
      send(res, e.status || 400, { error: e.message });
    }
  });
}

module.exports = { createServer };
