// examples/library.yaml のとおりに動く、テスト用の小さなサーバーです。
// 生成したテストが本当に動くか確かめるために使います。
const http = require("node:http");

const TOKEN = "test-token";
const BOOK = { id: 1, title: "吾輩は猫である", isbn: "978-4101010014", price: 750, genre: "novel", publishedOn: "1905-10-06", available: true };
const GENRES = ["novel", "science", "history", "comic"];

// bugs: わざと仕様とちがう動きをさせる（テストがまちがいを見つけられるか確かめるため）
//   "limit"  … limit の範囲をチェックしない
//   "total"  … 検索結果に total を入れない
//   "auth"   … 認証なしでも本を登録できてしまう
function createServer(bugs = []) {
  return http.createServer((req, res) => {
    // ブラウザから実行できるように CORS を許可する
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept",
      "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    };
    if (req.method === "OPTIONS") {
      res.writeHead(204, cors);
      return res.end();
    }
    const send = (status, body) => {
      res.writeHead(status, body === undefined ? cors : { ...cors, "Content-Type": "application/json; charset=utf-8" });
      res.end(body === undefined ? undefined : JSON.stringify(body));
    };
    const bad = (message) => send(400, { code: "bad_request", message });
    const authed = () => req.headers.authorization === "Bearer " + TOKEN;
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const url = new URL(req.url, "http://x");
      const path = url.pathname.replace(/^\/v1/, "");
      let body;
      if (raw) {
        try {
          body = JSON.parse(raw);
        } catch {
          return bad("JSON ではありません");
        }
      }
      const isInt = (v) => Number.isInteger(v);
      const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);

      if (path === "/books" && req.method === "GET") {
        const q = url.searchParams.get("q");
        const genre = url.searchParams.get("genre");
        const limit = url.searchParams.get("limit");
        if (q != null && q.length > 100) return bad("q が長すぎます");
        if (genre != null && !GENRES.includes(genre)) return bad("genre が不正です");
        if (limit != null && !bugs.includes("limit") && (!/^\d+$/.test(limit) || +limit < 1 || +limit > 100)) return bad("limit が不正です");
        return send(200, bugs.includes("total") ? { items: [BOOK] } : { items: [BOOK], total: 1 });
      }
      if (path === "/books" && req.method === "POST") {
        if (!authed() && !bugs.includes("auth")) return send(401, { code: "unauthorized", message: "認証が必要です" });
        if (!isObj(body)) return bad("ボディが必要です");
        const { title, isbn, price, genre, publishedOn } = body;
        if (typeof title !== "string" || title.length < 1 || title.length > 200) return bad("title が不正です");
        if (typeof isbn !== "string" || !/^97[89]-\d{10}$/.test(isbn)) return bad("isbn が不正です");
        if (price !== undefined && (!isInt(price) || price < 0 || price > 100000)) return bad("price が不正です");
        if (genre !== undefined && !GENRES.includes(genre)) return bad("genre が不正です");
        if (publishedOn !== undefined && (typeof publishedOn !== "string" || !/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(publishedOn))) return bad("publishedOn が不正です");
        return send(201, { ...body, id: 2, available: true });
      }
      const m = /^\/books\/([^/]+)$/.exec(path);
      if (m && (req.method === "GET" || req.method === "DELETE")) {
        if (req.method === "DELETE" && !authed()) return send(401, { code: "unauthorized", message: "認証が必要です" });
        if (!/^\d+$/.test(m[1]) || +m[1] < 1) return bad("bookId が不正です");
        if (+m[1] > 10) return send(404, { code: "not_found", message: "本が見つかりません" });
        return req.method === "GET" ? send(200, { ...BOOK, id: +m[1] }) : send(204);
      }
      if (path === "/loans" && req.method === "POST") {
        if (!authed()) return send(401, { code: "unauthorized", message: "認証が必要です" });
        if (!isObj(body)) return bad("ボディが必要です");
        const { bookId, memberEmail, days } = body;
        if (!isInt(bookId) || bookId < 1) return bad("bookId が不正です");
        if (typeof memberEmail !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(memberEmail)) return bad("memberEmail が不正です");
        if (days !== undefined && (!isInt(days) || days < 1 || days > 14)) return bad("days が不正です");
        return send(201, { id: "3fa85f64-5717-4562-b3fc-2c963f66afa6", bookId, dueOn: "2024-04-08" });
      }
      send(404, { code: "not_found", message: "ありません" });
    });
  });
}

function start(port = 0, bugs = []) {
  return new Promise((resolve) => {
    const server = createServer(bugs);
    server.listen(port, "127.0.0.1", () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/v1` }));
  });
}

module.exports = { start, TOKEN };

if (require.main === module) {
  start(Number(process.env.PORT || 4010)).then(({ url }) => console.log("モックサーバー:", url, " トークン:", TOKEN));
}
