/* ためしに使える仕様書の例 */
(function (root) {
  "use strict";

  const SAMPLES = [
    {
      label: "書籍API（Markdown）",
      pkg: "com.example.library",
      spec: `# 書籍管理 API 仕様書 v1.0

共通
- ベースパス: /api/books
- リクエスト・レスポンスは JSON（Content-Type: application/json）
- エラーは RFC 9457 の Problem Details で返す（type, title, status, detail）。入力チェックのエラーは、さらに errors: [{ field, message }] を付ける。

## 1. 書籍を1件取得  GET /api/books/{id}
- id: 数値（1以上）
- 200: { id, title, author, isbn, price, publishedOn }
- 404: 指定した id の書籍がない

## 2. 書籍を検索  GET /api/books
クエリパラメータ
| 名前 | 型 | 必須 | 説明 |
| --- | --- | --- | --- |
| keyword | 文字列 | いいえ | title か author に部分一致 |
| page | 数値 | いいえ | 0 から。省略時 0 |
| size | 数値 | いいえ | 1〜100。省略時 20 |

- 200: { content: [書籍], page, size, totalElements }。並び順は id の昇順。
- 400: size が 1〜100 の外

## 3. 書籍を登録  POST /api/books
リクエスト
| 項目 | 型 | 必須 | ルール |
| --- | --- | --- | --- |
| title | 文字列 | はい | 1〜100文字 |
| author | 文字列 | はい | 1〜50文字 |
| isbn | 文字列 | はい | 13桁の数字。登録済みの isbn は登録できない |
| price | 数値 | はい | 0〜100000 |
| publishedOn | 日付 | いいえ | yyyy-MM-dd |

- 201: 登録した書籍。Location ヘッダに /api/books/{id}
- 400: 入力チェックのエラー
- 409: isbn がすでに登録されている

## 4. 書籍を削除  DELETE /api/books/{id}
- 管理者（ADMIN ロール）だけができる
- 204: 削除した
- 401: ログインしていない
- 403: ADMIN ではない
- 404: 指定した id の書籍がない
`,
    },
    {
      label: "タスクAPI（OpenAPI）",
      pkg: "com.example.todo",
      spec: `openapi: 3.0.3
info:
  title: Task API
  version: 1.0.0
paths:
  /tasks:
    get:
      summary: タスクの一覧
      parameters:
        - name: status
          in: query
          required: false
          schema:
            type: string
            enum: [TODO, DOING, DONE]
      responses:
        "200":
          description: OK
          content:
            application/json:
              schema:
                type: array
                items: { $ref: "#/components/schemas/Task" }
    post:
      summary: タスクを作る
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/TaskCreate" }
      responses:
        "201":
          description: Created
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Task" }
        "400":
          description: 入力が正しくない
  /tasks/{id}/status:
    patch:
      summary: タスクの状態を変える
      description: DONE のタスクは TODO に戻せない（409）
      parameters:
        - name: id
          in: path
          required: true
          schema: { type: integer, format: int64 }
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [status]
              properties:
                status: { type: string, enum: [TODO, DOING, DONE] }
      responses:
        "200": { description: OK }
        "404": { description: タスクがない }
        "409": { description: 変えられない状態 }
components:
  schemas:
    TaskCreate:
      type: object
      required: [title]
      properties:
        title: { type: string, minLength: 1, maxLength: 80 }
        dueDate: { type: string, format: date }
    Task:
      type: object
      properties:
        id: { type: integer, format: int64 }
        title: { type: string }
        status: { type: string, enum: [TODO, DOING, DONE] }
        dueDate: { type: string, format: date }
`,
    },
  ];

  root.SpringTestSamples = SAMPLES;
})(typeof window !== "undefined" ? window : globalThis);
