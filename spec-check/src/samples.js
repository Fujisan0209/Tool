/*
 * 画面の「例」とテストで使うサンプル。どれも、わざと食い違いを入れてあります。
 */
(function (root) {
  "use strict";

  const SAMPLES = [
    {
      id: "java",
      label: "Java（注文管理）",
      specName: "注文管理_仕様書.md",
      spec: `# 注文管理 仕様書

## 1. 定数

| 定数名 | 値 | 説明 |
| --- | --- | --- |
| \`MAX_ITEMS\` | 100 | 1回の注文で買える最大数 |
| \`TAX_RATE\` | 0.10 | 消費税率 |

送料無料になる金額 \`FREE_SHIPPING_THRESHOLD\` は 5,000 円とする。

## 2. OrderStatus 列挙型

注文の状態は \`PENDING\` / \`PAID\` / \`SHIPPED\` / \`CANCELLED\` のいずれか。

## 3. Order クラス

### フィールド

| フィールド名 | 型 | 必須 | 説明 |
|---|---|---|---|
| id | long | ○ | 注文ID |
| items | List<OrderItem> | ○ | 明細 |
| status | OrderStatus | ○ | 状態 |
| couponCode | String | × | クーポンコード |

### calcTotal(price: int, qty: int, couponRate: double): int

税込みの合計金額を返す。

- 引数
  - \`price\` (int, 必須): 単価
  - \`qty\` (int, 必須): 数量
  - \`couponRate\` (double): 割引率。0.0〜1.0
- 戻り値: int（税込み）

### cancel メソッド

- 引数: reason (String)
- 戻り値: なし

### \`applyCoupon(code: String): boolean\`

クーポンを適用できたら true を返す。

## 4. OrderRepository

\`\`\`java
public interface OrderRepository {
    Order findById(long id);
    List<Order> findByStatus(OrderStatus status);
}
\`\`\`

## 5. API

| メソッド | パス | 説明 |
|---|---|---|
| GET | /api/orders/{id} | 注文を1件取得 |
| POST | /api/orders | 注文を作成 |
| DELETE | /api/orders/{id} | 注文を削除 |

状態の変更は \`PUT /api/orders/{id}/status\` で行う。
`,
      files: [
        {
          name: "Order.java",
          text: `package shop.order;

import java.time.LocalDateTime;
import java.util.List;

public class Order {
    private long id;
    private List<OrderItem> items;
    private OrderStatus status;
    private String coupon;
    private LocalDateTime createdAt;

    public int calcTotal(int price, int quantity) {
        double total = price * quantity * (1 + Constants.TAX_RATE);
        return (int) Math.round(total);
    }

    public void cancel(String reason) {
        this.status = OrderStatus.CANCELED;
    }

    public boolean applyCoupon(String code) {
        this.coupon = code;
        return code != null && !code.isEmpty();
    }

    public long getId() { return id; }
    public OrderStatus getStatus() { return status; }
}
`,
        },
        {
          name: "OrderStatus.java",
          text: `package shop.order;

public enum OrderStatus {
    PENDING,
    PAID,
    SHIPPED,
    CANCELED
}
`,
        },
        {
          name: "Constants.java",
          text: `package shop.order;

public final class Constants {
    public static final int MAX_ITEMS = 50;
    public static final double TAX_RATE = 0.1;
    public static final int FREE_SHIPPING_THRESHOLD = 5_000;

    private Constants() {}
}
`,
        },
        {
          name: "OrderRepository.java",
          text: `package shop.order;

import java.util.List;

public interface OrderRepository {
    Order findById(long id);
    List<Order> findByStatus(String status);
}
`,
        },
        {
          name: "OrderController.java",
          text: `package shop.order;

import org.springframework.web.bind.annotation.*;
import java.util.List;

@RestController
@RequestMapping("/api/orders")
public class OrderController {
    private final OrderRepository repository;

    public OrderController(OrderRepository repository) {
        this.repository = repository;
    }

    @GetMapping("/{id}")
    public Order get(@PathVariable long id) {
        return repository.findById(id);
    }

    @GetMapping
    public List<Order> list(@RequestParam String status) {
        return repository.findByStatus(status);
    }

    @PostMapping
    public Order create(@RequestBody Order order) {
        return order;
    }

    @PatchMapping("/{id}/status")
    public Order changeStatus(@PathVariable long id, @RequestBody String status) {
        return repository.findById(id);
    }
}
`,
        },
      ],
    },
    {
      id: "ts",
      label: "TypeScript（会員API）",
      specName: "会員API_仕様書.md",
      spec: `# 会員 API 仕様書

## エンドポイント

| メソッド | パス | 内容 |
|---|---|---|
| GET | /api/users/{id} | 会員を1人取得 |
| POST | /api/users | 会員を登録 |
| DELETE | /api/users/{id} | 会員を削除 |

## User 型

| 項目 | 型 | 必須 |
|---|---|---|
| id | number | ○ |
| name | string | ○ |
| email | string | ○ |
| role | Role | ○ |
| lastLoginAt | Date | × |

\`Role\` は \`ADMIN\` / \`MEMBER\` / \`GUEST\` のいずれか。

## 定数

- \`PASSWORD_MIN_LENGTH\`: 8
- \`SESSION_TTL_SEC\`: 3600

## 関数

### validateEmail(email: string): boolean

メールアドレスの形が正しければ true。

### createUser(input: CreateUserInput): Promise<User>

会員を登録して、登録した会員を返す。

### hashPassword(password: string, saltRounds: number = 10): Promise<string>
`,
      files: [
        {
          name: "src/user.ts",
          text: `export type Role = "admin" | "member";

export interface User {
  id: number;
  name: string;
  email: string;
  role: Role;
  createdAt: Date;
}

export interface CreateUserInput {
  name: string;
  email: string;
  password: string;
}

export const PASSWORD_MIN_LENGTH = 6;
export const SESSION_TTL_SEC = 60 * 60;
`,
        },
        {
          name: "src/service.ts",
          text: `import { User, CreateUserInput, PASSWORD_MIN_LENGTH } from "./user";

export function validateEmail(email: string): boolean {
  return /^[^@\\s]+@[^@\\s]+$/.test(email);
}

export async function createUser(input: CreateUserInput, notify = true): Promise<User> {
  if (input.password.length < PASSWORD_MIN_LENGTH) throw new Error("too short");
  return { id: 1, name: input.name, email: input.email, role: "member", createdAt: new Date() };
}

export async function hashPassword(password: string, saltRounds = 12): Promise<string> {
  return password + saltRounds;
}

export function findUserByEmail(email: string): User | undefined {
  return undefined;
}
`,
        },
        {
          name: "src/routes.ts",
          text: `import express from "express";
import { createUser } from "./service";

const app = express();
const router = express.Router();

router.get("/users/:id", async (req, res) => {
  res.json({ id: Number(req.params.id) });
});

router.post("/users", async (req, res) => {
  res.status(201).json(await createUser(req.body));
});

router.delete("/user/:id", async (req, res) => {
  res.status(204).end();
});

app.use("/api", router);
export default app;
`,
        },
      ],
    },
    {
      id: "python",
      label: "Python（在庫API）",
      specName: "在庫_仕様書.md",
      spec: `# 在庫管理 仕様書

## 定数

- 在庫が少ないと判断する数 \`LOW_STOCK_THRESHOLD\` = 10
- 1回に確保できる最大数 \`MAX_RESERVE\` = 20

## Item モデル

- \`id\` (int): 商品ID
- \`name\` (str): 商品名
- \`stock\` (int): 在庫数
- \`price\` (float): 単価

## 関数

\`\`\`python
def reserve_stock(item_id: int, qty: int) -> bool: ...
def release_stock(item_id: int, qty: int) -> None: ...
def is_low_stock(item: Item) -> bool: ...
\`\`\`

## API

- \`GET /items/{item_id}\` 商品を取得
- \`POST /items/{item_id}/reserve\` 在庫を確保
- \`POST /items/{item_id}/release\` 確保を取り消す
`,
      files: [
        {
          name: "app/models.py",
          text: `from pydantic import BaseModel


class Item(BaseModel):
    id: int
    name: str
    stock: int
    price: int
`,
        },
        {
          name: "app/inventory.py",
          text: `from .models import Item

LOW_STOCK_THRESHOLD = 5
MAX_RESERVE = 20


def reserve_stock(item_id: int, quantity: int, warehouse: str = "main") -> bool:
    return quantity <= MAX_RESERVE


def release_stock(qty: int, item_id: int) -> None:
    pass


def is_low_stock(item: Item) -> bool:
    return item.stock < LOW_STOCK_THRESHOLD


def _audit(message: str) -> None:
    print(message)
`,
        },
        {
          name: "app/api.py",
          text: `from fastapi import APIRouter
from .inventory import reserve_stock, release_stock

router = APIRouter(prefix="/items")


@router.get("/{item_id}")
async def get_item(item_id: int):
    return {"id": item_id}


@router.post("/{item_id}/reserve")
async def reserve(item_id: int, qty: int):
    return {"ok": reserve_stock(item_id, qty)}


@router.delete("/{item_id}/reserve")
async def release(item_id: int, qty: int):
    release_stock(qty, item_id)
    return {"ok": True}
`,
        },
      ],
    },
  ];

  const api = { SAMPLES };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SpecCheckSamples = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
