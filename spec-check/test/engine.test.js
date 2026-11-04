// 実行: npm test  （node --test）
const test = require("node:test");
const assert = require("node:assert");
const { parseType, compareTypes, sameValue, closest } = require("../src/common.js");
const { parseCode } = require("../src/code.js");
const { parseSpec, findSignatures } = require("../src/spec.js");
const { compare, toMarkdown, normPath } = require("../src/compare.js");
const { SAMPLES } = require("../src/samples.js");

function run(spec, files) {
  return compare(parseSpec(spec), files.map(([name, text]) => parseCode(text, name)));
}
const titles = (rep) => rep.findings.map((f) => [f.title, ...f.more].join(" / "));
const has = (rep, re) => assert.ok(titles(rep).some((t) => re.test(t)), `見つからない: ${re}\n${titles(rep).join("\n")}`);
const hasNot = (rep, re) => assert.ok(!titles(rep).some((t) => re.test(t)), `出てほしくない: ${re}\n${titles(rep).join("\n")}`);

// ---------------------------------------------------------------- 共通

test("型の比較", () => {
  const t = (a, b, la, lb) => compareTypes(parseType(a, la || "spec"), parseType(b, lb || "java"));
  assert.strictEqual(t("int", "Integer"), "same");
  assert.strictEqual(t("整数", "long"), "same");
  assert.strictEqual(t("int", "long"), "minor");
  assert.strictEqual(t("int", "String"), "diff");
  assert.strictEqual(t("number", "double"), "same");
  assert.strictEqual(t("文字列のリスト", "List<String>"), "same");
  assert.strictEqual(t("List<String>", "string[]", "spec", "ts"), "same");
  assert.strictEqual(t("List<Integer>", "list[str]", "spec", "python"), "diff");
  assert.strictEqual(t("User", "Promise<User>", "spec", "ts"), "same");
  assert.strictEqual(t("float", "float", "spec", "python"), "same");
  assert.strictEqual(t("なし", "void"), "same");
  assert.strictEqual(t("OrderStatus", "String"), "diff");
  assert.strictEqual(t("str", "Optional[str]", "spec", "python"), "same");
});

test("値の比較", () => {
  assert.strictEqual(sameValue("5,000", "5_000"), true);
  assert.strictEqual(sameValue("0.10", "0.1"), true);
  assert.strictEqual(sameValue("100", "100L"), true);
  assert.strictEqual(sameValue("3600", "60 * 60"), true);
  assert.strictEqual(sameValue("'abc'", '"abc"'), true);
  assert.strictEqual(sameValue("100", "50"), false);
  assert.strictEqual(sameValue("100", "computeLimit()"), null, "式は判断しない");
});

test("似た名前を探す", () => {
  assert.deepStrictEqual(closest("user_id", ["userId", "username"]), { name: "userId", dist: 0 });
  assert.strictEqual(closest("calcTotl", ["calcTotal", "cancel"]).name, "calcTotal");
  assert.strictEqual(closest("zzzz", ["calcTotal"]), null);
});

// ---------------------------------------------------------------- コード

test("Java を読む", () => {
  const m = parseCode(`
@RestController
@RequestMapping("/api/orders")
public class OrderController {
  public static final int MAX = 10;
  private final Repo repo;
  public OrderController(Repo repo) { this.repo = repo; }
  @GetMapping("/{id}")
  public ResponseEntity<Order> get(@PathVariable("id") long id) { Runnable r = () -> {}; return null; }
  @RequestMapping(value = {"/a", "/b"}, method = RequestMethod.POST)
  public <T> List<T> post(final Map<String, List<Integer>> m, String... tags) throws Exception { return null; }
  enum Status { A("a"), B { void f() {} }, C; Status() {} Status(String s) {} }
  record Point(int x, int y) {}
}`, "OrderController.java");
  const get = m.funcs.find((f) => f.name === "get");
  assert.strictEqual(get.returns, "ResponseEntity<Order>");
  assert.deepStrictEqual(get.params.map((p) => [p.name, p.type]), [["id", "long"]]);
  const post = m.funcs.find((f) => f.name === "post");
  assert.deepStrictEqual(post.params.map((p) => p.name), ["m", "tags"]);
  assert.ok(post.params[1].variadic);
  assert.deepStrictEqual(m.endpoints.map((e) => `${e.method} ${e.path}`), ["GET /api/orders/{id}", "POST /api/orders/a", "POST /api/orders/b"]);
  assert.deepStrictEqual(m.types.find((t) => t.name === "Status").values.map((v) => v.name), ["A", "B", "C"]);
  assert.deepStrictEqual(m.types.find((t) => t.name === "Point").fields.map((f) => f.name), ["x", "y"]);
  assert.deepStrictEqual(m.consts.map((c) => [c.name, c.value]), [["MAX", "10"]]);
  assert.ok(!m.funcs.some((f) => f.name === "r"), "メソッドの中の変数は読まない");
});

test("TypeScript / JavaScript を読む", () => {
  const m = parseCode(`
export const LIMIT = 3;
export const Status = Object.freeze({ OPEN: "open", DONE: "done" });
export interface User { id: number; name?: string
  email: string }
export type Role = "admin" | "member";
enum Color { Red = "r", Green }
const router = express.Router();
router.get("/:id", async (req, res) => { res.send(1); });
router.route("/x").get(h).post(h);
app.use("/api", router);
export async function save(user: User, force = false): Promise<void> { function inner() {} }
export const fmt = (n: number): string => String(n);
class Svc { private repo: Repo; constructor(private readonly db: Db) {} get size(): number { return 1 } #hidden() {} [Symbol.iterator]() {} handle = (e) => { this.router.get("/inner", h); } }
const re = /a{1}"/g; const s = \`x \${ { a: 1 }.a } y\`;
function afterRegex(a, b) {}
`, "app.ts");
  const names = m.funcs.map((f) => f.name);
  for (const n of ["save", "fmt", "constructor", "hidden", "handle", "afterRegex"]) assert.ok(names.includes(n), n);
  assert.ok(m.funcs.find((f) => f.name === "inner").local);
  assert.deepStrictEqual(m.funcs.find((f) => f.name === "save").params.map((p) => [p.name, p.type, p.default]), [["user", "User", null], ["force", null, "false"]]);
  assert.strictEqual(m.funcs.find((f) => f.name === "fmt").returns, "string");
  assert.deepStrictEqual(m.types.find((t) => t.name === "User").fields.map((f) => f.name), ["id", "name", "email"]);
  assert.deepStrictEqual(m.types.find((t) => t.name === "Role").values.map((v) => v.name), ["admin", "member"]);
  assert.deepStrictEqual(m.types.find((t) => t.name === "Status").values.map((v) => v.name), ["OPEN", "DONE"]);
  assert.deepStrictEqual(m.types.find((t) => t.name === "Svc").fields.map((f) => f.name), ["repo", "db", "size"]);
  const eps = m.endpoints.map((e) => `${e.method} ${e.path}`);
  for (const e of ["GET /api/:id", "GET /api/x", "POST /api/x"]) assert.ok(eps.includes(e), e);
});

test("Python を読む", () => {
  const m = parseCode(`
from enum import Enum
LIMIT: int = 100
router = APIRouter(prefix="/orders")

class Status(str, Enum):
    PENDING = "pending"
    PAID = "paid"

@dataclass
class Order:
    """説明
    複数行"""
    id: int
    items: list[Item] = field(default_factory=list)

    def total(self, tax: float = 0.1) -> int:
        return 1

class Svc:
    def __init__(self, repo: Repo, limit: int = 3):
        self.repo = repo
        self.limit = limit

    def _private(self):
        pass

@router.get("/{order_id}", response_model=Order)
async def get_order(order_id: int,
                    verbose: bool = False) -> Order:
    def inner():
        pass
    return None

@app.route("/x", methods=["GET", "POST"])
def x():
    pass
`, "orders.py");
  const f = (n) => m.funcs.find((x) => x.name === n);
  assert.deepStrictEqual(f("total").params.map((p) => [p.name, p.type, p.default]), [["tax", "float", "0.1"]]);
  assert.strictEqual(f("total").owner, "Order");
  assert.deepStrictEqual(f("get_order").params.map((p) => p.name), ["order_id", "verbose"]);
  assert.ok(f("inner").local);
  assert.ok(f("_private").private);
  assert.deepStrictEqual(m.types.find((t) => t.name === "Status").values.map((v) => v.name), ["PENDING", "PAID"]);
  assert.deepStrictEqual(m.types.find((t) => t.name === "Order").fields.map((x) => x.name), ["id", "items"]);
  assert.deepStrictEqual(m.types.find((t) => t.name === "Svc").fields.map((x) => [x.name, x.type]), [["repo", "Repo"], ["limit", "int"]]);
  assert.deepStrictEqual(m.endpoints.map((e) => `${e.method} ${e.path}`), ["GET /orders/{order_id}", "GET /x", "POST /x"]);
  assert.deepStrictEqual(m.consts.map((c) => c.name), ["LIMIT"]);
});

test("壊れたコードでも止まらない", () => {
  for (const [name, text] of [
    ["a.java", "public class A { void f( { int x = ; } } }"],
    ["a.ts", "class { function ( => { ` unterminated"],
    ["a.py", "def f(:\n  class\n'''never closed"],
    ["a.js", "}}}{{{ /* never closed"],
  ]) {
    const m = parseCode(text, name);
    assert.ok(Array.isArray(m.funcs), name);
  }
});

// ---------------------------------------------------------------- 仕様書

test("文中のシグネチャを読む", () => {
  const [a] = findSignatures("calcTotal(price: int, qty: int = 1): int");
  assert.deepStrictEqual(a.params.map((p) => [p.name, p.type, p.default]), [["price", "int", null], ["qty", "int", "1"]]);
  assert.strictEqual(a.returns, "int");
  const [b] = findSignatures("public static int calc(int a, String... rest)");
  assert.strictEqual(b.returns, "int");
  assert.deepStrictEqual(b.params.map((p) => [p.name, p.type]), [["a", "int"], ["rest", "String[]"]]);
  const [c] = findSignatures("Order.save(order) -> bool");
  assert.strictEqual(c.owner, "Order");
  assert.strictEqual(c.returns, "bool");
  assert.ok(findSignatures("calcTotal(100, 2) を呼ぶ")[0].callish, "呼び出し例は宣言ではない");
});

test("仕様書のいろいろな書き方を読む", () => {
  const s = parseSpec(`
# 仕様
## 定数
| 定数名 | 値 |
|---|---|
| MAX_ITEMS | 100 |

\`TIMEOUT_SEC\` は 30 秒とする。

## Order クラス
| フィールド名 | 型 | 必須 |
|---|---|---|
| id | long | ○ |
| note | String | × |

### calcTotal(price: int, qty: int): int
- 引数
  - \`price\` (int, 必須): 単価
  - \`qty\` (int): 数量。デフォルト 1

### cancel メソッド
- 引数: reason (String)
- 戻り値: なし

## Status 列挙型
- \`OPEN\`
- \`CLOSED\`

## API
| メソッド | パス |
|---|---|
| GET | /api/orders/{id} |

\`POST /api/orders\` で作る。
`);
  const f = (n) => s.funcs.find((x) => x.name === n);
  assert.deepStrictEqual(f("calcTotal").params.map((p) => [p.name, p.type, p.required, p.default]), [["price", "int", true, null], ["qty", "int", false, "1"]]);
  assert.strictEqual(f("calcTotal").owner, "Order");
  assert.deepStrictEqual(f("cancel").params.map((p) => [p.name, p.type]), [["reason", "String"]]);
  assert.strictEqual(f("cancel").returns, "void");
  assert.deepStrictEqual(s.types.find((t) => t.name === "Order").fields.map((x) => [x.name, x.type, x.required]), [["id", "long", true], ["note", "String", false]]);
  assert.deepStrictEqual(s.types.find((t) => t.name === "Status").values.map((v) => v.name), ["OPEN", "CLOSED"]);
  assert.deepStrictEqual(s.consts.map((c) => [c.name, c.value]), [["MAX_ITEMS", "100"], ["TIMEOUT_SEC", "30"]]);
  assert.deepStrictEqual(s.endpoints.map((e) => `${e.method} ${e.path}`), ["GET /api/orders/{id}", "POST /api/orders"]);
});

test("ふつうの英語の見出しを、型や関数とまちがえない", () => {
  const rep = run("# Overview\n## Usage\n## Installation\nThis tool helps you.\n", [["a.ts", "export function run() {}"]]);
  assert.strictEqual(rep.findings.filter((f) => f.sev !== "info").length, 0, titles(rep).join("\n"));
});

// ---------------------------------------------------------------- 照合

test("パスの正規化", () => {
  assert.strictEqual(normPath("/users/{id}/"), normPath("/users/:userId"));
  assert.strictEqual(normPath("/users/<int:id>"), "/users/{}");
});

test("Java の例: 仕込んだ食い違いを全部見つける", () => {
  const s = SAMPLES.find((x) => x.id === "java");
  const rep = run(s.spec, s.files.map((f) => [f.name, f.text]));
  has(rep, /MAX_ITEMS.*値が違います.*100.*50/);
  has(rep, /OrderStatus に値 CANCELLED がありません/);
  has(rep, /Order にフィールド couponCode がありません/);
  has(rep, /calcTotal.*引数の数が違います.*couponRate/);
  has(rep, /findByStatus.*引数 status の型が違います/);
  has(rep, /DELETE \/api\/orders\/\{id\}.*ありません/);
  has(rep, /\/api\/orders\/\{id\}\/status.*HTTP メソッドが違います.*PUT.*PATCH/);
  has(rep, /GET \/api\/orders.*仕様書に書かれていません/);
  hasNot(rep, /TAX_RATE|FREE_SHIPPING_THRESHOLD|applyCoupon|cancel|findById/);
  hasNot(rep, /getId|getStatus/); // ゲッターは「仕様にない」と言わない
});

test("TypeScript の例", () => {
  const s = SAMPLES.find((x) => x.id === "ts");
  const rep = run(s.spec, s.files.map((f) => [f.name, f.text]));
  has(rep, /パスが違います.*\/api\/users\/\{id\}.*\/api\/user\/:id/);
  has(rep, /User にフィールド lastLoginAt がありません/);
  has(rep, /Role に値 GUEST がありません/);
  has(rep, /PASSWORD_MIN_LENGTH.*8.*6/);
  has(rep, /hashPassword.*デフォルト値が違います/);
  has(rep, /createUser.*引数の数.*notify/);
  has(rep, /findUserByEmail.*仕様書に書かれていません/);
  hasNot(rep, /SESSION_TTL_SEC|validateEmail/);
  assert.strictEqual(rep.findings.find((f) => /createUser/.test(f.title)).sev, "warn", "省略できる引数が増えただけなら要確認");
});

test("Python の例", () => {
  const s = SAMPLES.find((x) => x.id === "python");
  const rep = run(s.spec, s.files.map((f) => [f.name, f.text]));
  has(rep, /LOW_STOCK_THRESHOLD.*10.*5/);
  has(rep, /Item\.price の型が違います/);
  has(rep, /release_stock.*順番が違います/);
  has(rep, /POST \/items\/\{item_id\}\/release.*ありません/);
  has(rep, /reserve_stock.*引数名が違います.*qty → quantity/);
  hasNot(rep, /MAX_RESERVE|is_low_stock|_audit/);
});

test("名前の書き方の違いと打ちまちがい", () => {
  const rep = run("- `get_user(user_id: int): User`\n- `calcTotl(a: int)`\n- 設定は `retryCount` で変える", [
    ["a.ts", "export function getUser(userId: number): User { return null as any }\nexport function calcTotal(a: number) {}\nconst retry_count = 3;"],
  ]);
  has(rep, /get_user.*コードでは.*getUser/);
  has(rep, /calcTotl.*がコードにありません/);
  assert.strictEqual(rep.findings.find((f) => /calcTotl/.test(f.title)).suggestion, "calcTotal");
  has(rep, /retryCount.*コードでは.*retry_count/);
});

test("食い違いがなければ指摘ゼロ", () => {
  const rep = run("### add(a: int, b: int): int\n\n`MAX` = 3\n\nGET /items", [
    ["A.java", '@RestController class A { static final int MAX = 3; public int add(int a, int b) { return a + b; } @GetMapping("/items") public String items() { return ""; } }'],
  ]);
  assert.deepStrictEqual(titles(rep), []);
  assert.strictEqual(rep.stats.ok, rep.stats.checked);
});

test("Markdown のレポート", () => {
  const s = SAMPLES[0];
  const md = toMarkdown(run(s.spec, s.files.map((f) => [f.name, f.text])));
  assert.match(md, /^## 仕様とコードの照合結果/);
  assert.match(md, /- \[ \] .*MAX_ITEMS/);
  assert.match(md, /Constants\.java:4/);
});

test("大きなコードでも速い（10万行で数秒以内）", () => {
  const files = [];
  for (let i = 0; i < 400; i++) for (const s of SAMPLES) for (const f of s.files) files.push([i + "/" + f.name, f.text]);
  const t = Date.now();
  const rep = run(SAMPLES.map((s) => s.spec).join("\n"), files);
  const ms = Date.now() - t;
  assert.ok(rep.findings.length > 0);
  assert.ok(ms < 5000, `${ms}ms`);
});
