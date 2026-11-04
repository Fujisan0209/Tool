/*
 * pytest + requests のテストを書き出します。
 * 実行時の関数（リクエストの組み立て、スキーマの確認）は runtime.js と同じ動きを Python で書いたものです。
 */
(function (root) {
  "use strict";
  const isNode = typeof module !== "undefined" && module.exports;
  const C = isNode ? require("./common.js") : root.ApiTestGen.emit.common;

  const PY_RUNTIME = String.raw`
# ---------- ここから下は、テストを動かすための関数です ----------

_NO_BODY = object()


def _to_str(v):
    if v is None:
        return ""
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (dict, list)):
        return json.dumps(v, ensure_ascii=False, separators=(",", ":"))
    return str(v)


def _enc(v):
    return quote(_to_str(v), safe="-_.!~*'()")


def build_request(req):
    def path_value(m):
        name = m.group(1)
        overrides = req.get("pathParams") or {}
        return _enc(overrides[name] if name in overrides else PARAMS.get(name))

    url = BASE_URL.rstrip("/") + re.sub(r"\{([^}]+)\}", path_value, req["path"])
    qs, headers, cookies = [], {}, []
    for k, v in (req.get("query") or {}).items():
        if isinstance(v, list):
            qs += [_enc(k) + "=" + _enc(x) for x in v]
        elif isinstance(v, dict):
            qs += [_enc(k + "[" + sub + "]") + "=" + _enc(x) for sub, x in v.items()]
        else:
            qs.append(_enc(k) + "=" + _enc(v))
    for k, v in (req.get("headers") or {}).items():
        headers[k] = ",".join(map(_to_str, v)) if isinstance(v, list) else _to_str(v)
    for k, v in (req.get("cookies") or {}).items():
        cookies.append(k + "=" + _enc(v))
    for name in req.get("auth") or []:
        s, c = SCHEMES.get(name), CREDENTIALS.get(name) or {}
        if not s:
            continue
        if s["kind"] == "bearer" and c.get("token"):
            headers["Authorization"] = "Bearer " + c["token"]
        elif s["kind"] == "basic" and c.get("user"):
            raw = (c["user"] + ":" + (c.get("password") or "")).encode("utf-8")
            headers["Authorization"] = "Basic " + base64.b64encode(raw).decode("ascii")
        elif s["kind"] == "apiKey" and c.get("key"):
            if s.get("in") == "query":
                qs.append(_enc(s["name"]) + "=" + _enc(c["key"]))
            elif s.get("in") == "cookie":
                cookies.append(s["name"] + "=" + _enc(c["key"]))
            else:
                headers[s["name"]] = c["key"]
    if cookies:
        headers["Cookie"] = "; ".join(cookies)
    headers.setdefault("Accept", "application/json")
    kwargs = {}
    if "body" in req:
        body, ct = req["body"], req.get("contentType") or "application/json"
        if "json" in ct.lower():
            kwargs["data"] = json.dumps(body, ensure_ascii=False).encode("utf-8")
            headers["Content-Type"] = ct
        elif "x-www-form-urlencoded" in ct.lower() and isinstance(body, dict):
            kwargs["data"] = "&".join(_enc(k) + "=" + _enc(v) for k, v in body.items())
            headers["Content-Type"] = ct
        elif "multipart/form-data" in ct.lower() and isinstance(body, dict):
            kwargs["files"] = {k: (None, _to_str(v)) for k, v in body.items()}
        else:
            kwargs["data"] = (body if isinstance(body, str) else json.dumps(body, ensure_ascii=False)).encode("utf-8")
            headers["Content-Type"] = ct
    if qs:
        url += ("&" if "?" in url else "?") + "&".join(qs)
    return req["method"].upper(), url, headers, kwargs


class Response:
    def __init__(self, raw, method):
        self.raw, self.method, self.url = raw, method, raw.url
        self.status = raw.status_code
        self.text = raw.text
        try:
            self.body = json.loads(self.text) if self.text else _NO_BODY
        except ValueError:
            self.body = self.text


def send(req):
    method, url, headers, kwargs = build_request(req)
    return Response(requests.request(method, url, headers=headers, timeout=TIMEOUT, **kwargs), method)


def status_matches(status, expected):
    code = str(status)
    for e in expected:
        e = str(e).upper()
        if e == code or (len(e) == 3 and e.endswith("XX") and e[0] == code[0]):
            return True
    return False


def pick_response_schema(status, responses):
    if not responses:
        return None
    code = str(status)
    return responses.get(code) or responses.get(code[0] + "XX") or responses.get("DEFAULT")


def expect_status(res, expected):
    assert status_matches(res.status, expected), (
        "ステータスは %s のはずが %s でした (%s %s)\n%s" % (" か ".join(expected), res.status, res.method, res.url, res.text[:500])
    )


def expect_schema(res, responses):
    schema = pick_response_schema(res.status, responses)
    if not schema:
        return
    assert res.body is not _NO_BODY, "レスポンスのボディが空です"
    assert not isinstance(res.body, str) or schema.get("type") == "string", "レスポンスが JSON ではありません: " + res.text[:200]
    errors = validate_schema(schema, res.body, SCHEMA_ROOT)
    assert not errors, "レスポンスが仕様と違います:\n  - " + "\n  - ".join(errors)


def needs_auth(*names):
    missing = [n for n in names if not any((CREDENTIALS.get(n) or {}).get(k) for k in ("token", "key", "user"))]
    return pytest.mark.skipif(bool(missing), reason="環境変数 %s がないのでスキップ" % ", ".join(CREDENTIAL_ENV[n] for n in missing))


_FORMATS = {
    "date-time": re.compile(r"^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?([Zz]|[+-]\d{2}:?\d{2})?$"),
    "date": re.compile(r"^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$"),
    "email": re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$"),
    "uuid": re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"),
    "ipv4": re.compile(r"^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$"),
}


def validate_schema(schema, value, root):
    """レスポンスがスキーマに合っているか調べ、合わないところを文の一覧で返す"""
    errors = []

    def resolve(s):
        guard = 0
        while isinstance(s, dict) and isinstance(s.get("$ref"), str) and guard < 32:
            guard += 1
            cur = root
            for part in s["$ref"].lstrip("#").split("/"):
                if not part:
                    continue
                part = unquote(part).replace("~1", "/").replace("~0", "~")
                cur = cur.get(part) if isinstance(cur, dict) else None
            s = cur if cur is not None else {}
        return s

    def kind(v):
        if v is None:
            return "null"
        if isinstance(v, bool):
            return "boolean"
        if isinstance(v, int) or (isinstance(v, float) and v.is_integer()):
            return "integer"
        if isinstance(v, float):
            return "number"
        if isinstance(v, str):
            return "string"
        if isinstance(v, list):
            return "array"
        return "object"

    def type_ok(t, v):
        k = kind(v)
        return t == k or (t == "number" and k == "integer")

    def show(v):
        s = json.dumps(v, ensure_ascii=False)
        return s[:57] + "..." if len(s) > 60 else s

    def push(path, msg):
        if len(errors) < 20:
            errors.append(path + ": " + msg)

    def passes(s, v, path, depth):
        nonlocal errors
        saved, errors = errors, []
        check(s, v, path, depth)
        ok = not errors
        errors = saved
        return ok

    def num(x):
        return isinstance(x, (int, float)) and not isinstance(x, bool)

    def check(s, v, path, depth):
        if depth > 64:
            return
        s = resolve(s)
        if s is True or s is None:
            return
        if s is False:
            return push(path, "この場所には値があってはいけません")
        if not isinstance(s, dict):
            return
        types = None if "type" not in s else (s["type"] if isinstance(s["type"], list) else [s["type"]])
        if v is None and (s.get("nullable") is True or (types and "null" in types)):
            return
        if types and not any(type_ok(t, v) for t in types):
            return push(path, "型は %s のはずが %s でした (%s)" % (" か ".join(types), kind(v), show(v)))
        if isinstance(s.get("enum"), list) and v not in s["enum"]:
            push(path, "決められた値 (%s) のどれでもありません: %s" % (", ".join(map(show, s["enum"])), show(v)))
        if "const" in s and s["const"] != v:
            push(path, "%s のはずが %s でした" % (show(s["const"]), show(v)))
        if isinstance(v, str):
            if num(s.get("minLength")) and len(v) < s["minLength"]:
                push(path, "%s文字以上のはずが %s文字でした" % (s["minLength"], len(v)))
            if num(s.get("maxLength")) and len(v) > s["maxLength"]:
                push(path, "%s文字以下のはずが %s文字でした" % (s["maxLength"], len(v)))
            if isinstance(s.get("pattern"), str):
                try:
                    if not re.search(s["pattern"], v):
                        push(path, "パターン /%s/ に合いません: %s" % (s["pattern"], show(v)))
                except re.error:
                    pass
            fmt = _FORMATS.get(s.get("format"))
            if fmt and not fmt.match(v):
                push(path, "%s の形ではありません: %s" % (s["format"], show(v)))
        if num(v):
            ex_min, ex_max = s.get("exclusiveMinimum"), s.get("exclusiveMaximum")
            if num(s.get("minimum")) and (v <= s["minimum"] if ex_min is True else v < s["minimum"]):
                push(path, "%s%sはずが %s でした" % (s["minimum"], " より大きい" if ex_min is True else " 以上の", v))
            if num(s.get("maximum")) and (v >= s["maximum"] if ex_max is True else v > s["maximum"]):
                push(path, "%s%sはずが %s でした" % (s["maximum"], " より小さい" if ex_max is True else " 以下の", v))
            if num(ex_min) and v <= ex_min:
                push(path, "%s より大きいはずが %s でした" % (ex_min, v))
            if num(ex_max) and v >= ex_max:
                push(path, "%s より小さいはずが %s でした" % (ex_max, v))
            if num(s.get("multipleOf")) and s["multipleOf"] > 0:
                q = v / s["multipleOf"]
                if abs(q - round(q)) > 1e-9:
                    push(path, "%s の倍数ではありません: %s" % (s["multipleOf"], v))
        if isinstance(v, list):
            if num(s.get("minItems")) and len(v) < s["minItems"]:
                push(path, "要素が %s 個以上のはずが %s 個でした" % (s["minItems"], len(v)))
            if num(s.get("maxItems")) and len(v) > s["maxItems"]:
                push(path, "要素が %s 個以下のはずが %s 個でした" % (s["maxItems"], len(v)))
            if s.get("uniqueItems") is True:
                keys = [json.dumps(x, sort_keys=True) for x in v]
                if len(set(keys)) != len(keys):
                    push(path, "同じ要素が重なっています")
            if isinstance(s.get("items"), dict):
                for i, item in enumerate(v):
                    check(s["items"], item, "%s[%d]" % (path, i), depth + 1)
        if isinstance(v, dict):
            props = s.get("properties") or {}
            for name in s.get("required") or []:
                if name in v:
                    continue
                ps = resolve(props[name]) if name in props else None
                if isinstance(ps, dict) and ps.get("writeOnly"):
                    continue
                push(path, '必須の項目 "%s" がありません' % name)
            extra = s.get("additionalProperties")
            for k, item in v.items():
                if k in props:
                    check(props[k], item, path + "." + k, depth + 1)
                elif extra is False:
                    push(path, '仕様にない項目 "%s" があります' % k)
                elif isinstance(extra, dict):
                    check(extra, item, path + "." + k, depth + 1)
            if num(s.get("minProperties")) and len(v) < s["minProperties"]:
                push(path, "項目が %s 個以上のはずが %s 個でした" % (s["minProperties"], len(v)))
            if num(s.get("maxProperties")) and len(v) > s["maxProperties"]:
                push(path, "項目が %s 個以下のはずが %s 個でした" % (s["maxProperties"], len(v)))
        for sub in s.get("allOf") or []:
            check(sub, v, path, depth + 1)
        alts = s.get("oneOf") or s.get("anyOf")
        if isinstance(alts, list) and alts:
            if not any(passes(a, v, path, depth + 1) for a in alts):
                push(path, "%s の選択肢のどれにも当てはまりません" % ("oneOf" if "oneOf" in s else "anyOf"))
        if "not" in s and passes(s["not"], v, path, depth + 1):
            push(path, "not で禁止された形になっています")

    check(schema, value, "$", 0)
    return errors
`;

  function docText(text) {
    let t = String(text).replace(/\\/g, "\\\\").replace(/"""/g, '\\"\\"\\"');
    if (t.endsWith('"')) t += " ";
    return t;
  }

  function emitPython(model) {
    const L = (v, level) => C.literal(v, "py", 4, level || 0);
    const file = "test_" + C.fileBase(model.title).replace(/-/g, "_") + ".py";
    const envNames = Object.values(model.credentialEnv).flatMap((e) => Object.values(e));
    const envExample = envNames.filter((n) => !/PASSWORD/.test(n)).map((n) => `${n}=xxxx `).join("");
    const out = [];
    out.push(`"""
${model.title}${model.apiVersion ? " " + model.apiVersion : ""} のAPIテスト（${model.cases.length}件: ${C.counts(model.cases)}）
「API テスト自動生成」で仕様書から作りました。

実行方法:
    pip install pytest requests
    BASE_URL=${model.baseUrl} ${envExample}pytest ${file} -v

- PARAMS の値は、実在するデータのIDなどに書きかえてください。
- POST / PUT / PATCH / DELETE のテストはデータを変更します。本番ではなく、テスト用の環境で実行してください。
- 認証が必要なテストは、環境変数に認証情報がないとスキップされます。
"""
import base64
import json
import os
import re
from urllib.parse import quote, unquote

import pytest
import requests

BASE_URL = os.environ.get("BASE_URL", ${JSON.stringify(model.baseUrl)})
TIMEOUT = float(os.environ.get("TIMEOUT", "15"))

# パスに入れる値（実在するIDなどに書きかえてください）
PARAMS = ${L(model.params)}
`);
    const creds = {};
    for (const [name, env] of Object.entries(model.credentialEnv)) {
      creds[name] = Object.fromEntries(Object.entries(env).map(([k, v]) => [k, `@@os.environ.get("${v}")@@`]));
    }
    out.push(`# 認証情報（環境変数から読みます）
CREDENTIALS = ${L(creds).replace(/"@@(.*?)@@"/g, (_, x) => x.replace(/\\"/g, '"'))}
CREDENTIAL_ENV = ${L(C.envHint(model))}
SCHEMES = ${L(model.schemes)}

# レスポンスの形（仕様書から取り出したもの）
RESPONSES = ${L(model.responses)}
SCHEMA_ROOT = ${L(model.schemaRoot)}
${PY_RUNTIME}

# ---------- テスト ----------
`);
    const used = new Set();
    for (const g of C.groupByOp(model.cases)) {
      out.push(`\n# ${C.groupName(g.op)}`);
      for (const c of g.cases) {
        const req = C.requestFor(c);
        let fn = `test_${c.id.toLowerCase()}_${C.slug(c.op.key)}_${C.slug(c.category)}`;
        while (used.has(fn)) fn += "_";
        used.add(fn);
        if (req.auth && req.auth.length) out.push(`@needs_auth(${req.auth.map((a) => JSON.stringify(a)).join(", ")})`);
        out.push(`def ${fn}():`);
        out.push(`    """${docText(C.caseName(c))}"""`);
        out.push(`    res = send(${L(req, 1)})`);
        out.push(`    expect_status(res, ${L(c.expect.status)})`);
        if (model.responses[c.op.key]) out.push(`    expect_schema(res, RESPONSES[${JSON.stringify(c.op.key)}])`);
        out.push(``, ``);
      }
    }
    return { filename: file, language: "python", code: out.join("\n").replace(/\n{4,}/g, "\n\n\n") };
  }

  if (isNode) module.exports = { emitPython };
  else root.ApiTestGen.emit.python = emitPython;
})(typeof globalThis !== "undefined" ? globalThis : this);
