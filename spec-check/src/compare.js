/*
 * 仕様（SpecModel）とコード（CodeModel の配列）を突き合わせて、食い違いの一覧を作ります。
 *
 * 結果（Report）:
 *   findings : 見つかった食い違い。{ id, sev, cat, kind, name, title, rows, spec, code, hint }
 *     sev  : "error"（食い違い・未実装） / "warn"（要確認） / "info"（仕様に書かれていない）
 *     cat  : "mismatch" / "missing" / "naming" / "extra"
 *     rows : 仕様とコードを並べた比較表 [{ label, spec, code, state: "ok"|"bad"|"warn"|"na" }]
 *   checks   : 仕様の項目ごとの判定（照合表）
 *   stats    : 件数
 */
(function (root) {
  "use strict";

  const node = typeof module !== "undefined" && module.exports;
  const C = node ? require("./common.js") : root.SpecCheckCommon;
  const { normName, closest, parseType, compareTypes, sameValue, IDENT } = C;

  const KIND_LABEL = { func: "関数", type: "型", enum: "列挙型", const: "定数", endpoint: "API", name: "名前", values: "値の一覧" };
  const SEV_RANK = { ok: 0, info: 1, warn: 2, error: 3 };

  const IGNORE_EXTRA = new Set([
    "main", "toString", "equals", "hashCode", "compareTo", "clone", "finalize", "constructor", "__init__", "__str__",
    "__repr__", "__eq__", "__hash__", "__lt__", "__le__", "__gt__", "__ge__", "__len__", "__iter__", "__enter__",
    "__exit__", "__post_init__", "setUp", "tearDown", "ngOnInit", "ngOnDestroy", "componentDidMount", "render",
    "values", "valueOf", "toJSON", "close", "run", "call", "apply", "builder", "build", "of",
  ]);
  const COMMON_WORDS = new Set([
    "String", "string", "int", "Integer", "long", "Long", "double", "Double", "float", "boolean", "Boolean", "bool",
    "char", "byte", "short", "void", "null", "None", "true", "false", "True", "False", "undefined", "number", "Number",
    "List", "ArrayList", "Map", "HashMap", "Set", "HashSet", "Optional", "Object", "Promise", "Array", "Date",
    "LocalDate", "LocalDateTime", "BigDecimal", "list", "dict", "str", "set", "tuple", "any", "unknown", "this",
    "self", "cls", "return", "new", "async", "await", "public", "private", "static", "final", "class", "interface",
    "enum", "id", "ID", "OK", "NG", "TODO", "JSON", "API", "HTTP", "URL", "GET", "POST", "PUT", "PATCH", "DELETE",
    "Exception", "Error", "RuntimeException", "IllegalArgumentException", "IllegalStateException", "NullPointerException",
    "ValueError", "TypeError", "KeyError", "Math", "System", "console", "print", "println", "len", "range", "min", "max",
  ]);
  const FILE_EXT = /^(?:ya?ml|json|md|txt|java|py|ts|tsx|js|jsx|csv|html|xml|properties|env|sh|sql|toml|ini|cfg|conf|log|gradle|kt)$/i;

  // ---------------------------------------------------------------- 表示用

  function typeStr(t) {
    return t ? String(t).replace(/\s*\|\s*undefined$/, "?") : null;
  }
  function paramStr(p) {
    if (!p) return "—";
    let s = (p.variadic ? "..." : "") + p.name;
    if (p.type) s += ": " + typeStr(p.type);
    if (p.default !== null && p.default !== undefined) s += " = " + p.default;
    else if (p.required === false || (p.optional && !p.default)) s += "（省略可）";
    return s;
  }
  function sigStr(name, params, returns) {
    const ps = params === null || params === undefined ? "…" : params.map((p) => p.name + (p.type ? ": " + typeStr(p.type) : "")).join(", ");
    return `${name}(${ps})` + (returns ? ": " + typeStr(returns) : "");
  }

  /** パスを比べやすい形に */
  function normPath(p) {
    let s = String(p || "").trim().split("?")[0];
    s = s.replace(/\{[^}]*\}|<[^>]*>|\[[^\]]*\]|:[A-Za-z_]\w*\??/g, "{}");
    s = s.replace(/\/{2,}/g, "/");
    if (!s.startsWith("/")) s = "/" + s;
    if (s.length > 1) s = s.replace(/\/+$/, "");
    return s.toLowerCase();
  }
  function pathParams(p) {
    return [...String(p || "").matchAll(/\{([^}]*)\}|<(?:\w+:)?([^>]*)>|\[([^\]]*)\]|:([A-Za-z_]\w*)/g)].map((m) => m[1] || m[2] || m[3] || m[4]);
  }

  // ---------------------------------------------------------------- 本体

  function compare(spec, models) {
    const t0 = Date.now();
    const code = buildIndex(models);
    const findings = [];
    const checks = [];
    const matchedCode = new Set();
    let seq = 0;

    const specRef = (item) => ({ line: item.line, text: spec.lines[item.line - 1] ? spec.lines[item.line - 1].trim() : "" });
    const codeRef = (x) => (x ? { file: x.file, line: x.line, text: lineOf(x.file, x.line) } : null);
    function lineOf(file, line) {
      const m = code.byFile.get(file);
      return m && m.lines[line - 1] !== undefined ? m.lines[line - 1].trim() : "";
    }

    function report(item, kind, name, issues, rows, codeItem, extra) {
      const worst = issues.reduce((a, x) => (SEV_RANK[x.sev] > SEV_RANK[a] ? x.sev : a), "ok");
      const check = {
        kind, name, label: extra && extra.label ? extra.label : name, line: item ? item.line : null,
        status: worst === "ok" ? "ok" : worst, cat: issues[0] ? issues[0].cat : null,
        code: codeRef(codeItem), findingId: null,
      };
      if (item) checks.push(check);
      if (!issues.length) return null;
      const order = issues.slice().sort((a, b) => SEV_RANK[b.sev] - SEV_RANK[a.sev]);
      const f = {
        id: "f" + ++seq, sev: worst, cat: order[0].cat, kind, name,
        title: order[0].text, more: order.slice(1).map((x) => x.text), rows: rows || [],
        spec: item ? specRef(item) : null, code: codeRef(codeItem), hint: extra && extra.hint ? extra.hint : order[0].hint || null,
        suggestion: extra && extra.suggestion ? extra.suggestion : null,
      };
      findings.push(f);
      check.findingId = f.id;
      return f;
    }

    function notFound(item, kind, name, candidates, label) {
      const sug = closest(name, candidates);
      const seen = code.words.get(name);
      if (sug && sug.dist === 0) {
        return report(item, kind, name, [{ sev: "warn", cat: "naming", text: `\`${name}\` が、コードでは \`${sug.name}\` と書かれています`, hint: "大文字・小文字や _ の付け方がちがいます。どちらかにそろえましょう。" }], [{ label: "名前", spec: name, code: sug.name, state: "warn" }], code.declByName.get(sug.name), { label });
      }
      if (seen) {
        return report(item, kind, name, [{ sev: "warn", cat: "missing", text: `\`${name}\` の定義がコードに見つかりません（名前は出てきます）`, hint: "コメントや呼び出しにだけ出てくるか、このツールが読めない書き方で定義されています。定義があるか確かめてください。" }], [], { file: seen.file, line: seen.line }, { label });
      }
      if (!item.strong) {
        checks.push({ kind, name, label: label || name, line: item.line, status: "skipped", code: null });
        return null;
      }
      return report(item, kind, name, [{
        sev: "error", cat: "missing", text: `仕様にある${KIND_LABEL[kind] || ""} \`${name}\` がコードにありません`,
        hint: sug ? `打ちまちがいかもしれません。似た名前: \`${sug.name}\`` : "まだ実装されていないか、名前が変わった可能性があります。",
      }], sug ? [{ label: "名前", spec: name, code: sug.name + "（似た名前）", state: "bad" }] : [], sug ? code.declByName.get(sug.name) : null, { label, suggestion: sug ? sug.name : null });
    }

    // ============================================== 関数
    for (const sf of spec.funcs) {
      const label = (sf.owner && sf.ownerExplicit ? sf.owner + "." : "") + sf.name;
      let cands = code.funcsByName.get(sf.name) || [];
      let renamed = null;
      if (!cands.length) {
        const nn = code.funcsByNorm.get(normName(sf.name));
        if (nn) { cands = nn; renamed = nn[0].name; }
      }
      if (!cands.length) {
        const other = code.typesByName.get(sf.name) || code.constsByName.get(sf.name) || code.fieldsByName.get(sf.name);
        if (other) { report(sf, "func", sf.name, [], [], other[0], { label }); continue; }
        if (sf.mentionOnly) {
          if (code.words.has(sf.name)) { report(sf, "func", sf.name, [], [], code.words.get(sf.name), { label }); continue; }
          sf.strong = !!sf.strong;
        }
        notFound(sf, "func", sf.name, code.funcNames, label);
        continue;
      }
      if (sf.owner) {
        const own = cands.filter((c) => c.owner && normName(c.owner) === normName(sf.owner));
        if (own.length) cands = own;
        else if (sf.ownerExplicit && cands.every((c) => c.owner)) {
          /* 別のクラスにある: 下で注記 */
        }
      }
      const best = pickOverload(sf, cands);
      matchedCode.add(best);
      const { issues, rows } = compareFunc(sf, best, renamed);
      if (sf.owner && sf.ownerExplicit && best.owner && normName(best.owner) !== normName(sf.owner))
        issues.push({ sev: "warn", cat: "mismatch", text: `\`${sf.name}\` は仕様では ${sf.owner} にありますが、コードでは ${best.owner} にあります`, hint: "どのクラスに置くか、仕様とコードをそろえてください。" });
      report(sf, "func", sf.name, issues, rows, best, { label });
    }

    // ============================================== 型（クラス・列挙型）
    for (const st of spec.types) {
      const kind = st.typeKind === "enum" ? "enum" : "type";
      let cands = code.typesByName.get(st.name) || [];
      let renamed = null;
      if (!cands.length) {
        const nn = code.typesByNorm.get(normName(st.name));
        if (nn) { cands = nn; renamed = nn[0].name; }
      }
      if (!cands.length) {
        const other = code.funcsByName.get(st.name) || code.constsByName.get(st.name);
        if (other) { report(st, kind, st.name, [], [], other[0]); continue; }
        notFound(st, kind, st.name, code.typeNames);
        continue;
      }
      const ct = cands.slice().sort((a, b) => overlapScore(st, b) - overlapScore(st, a))[0];
      matchedCode.add(ct);
      const issues = [];
      const rows = [];
      if (renamed) {
        issues.push({ sev: "warn", cat: "naming", text: `\`${st.name}\` が、コードでは \`${renamed}\` と書かれています`, hint: "名前の書き方をそろえましょう。" });
        rows.push({ label: "名前", spec: st.name, code: renamed, state: "warn" });
      }
      if (st.fields && st.fields.length) compareFields(st, ct, issues, rows);
      if (st.values && st.values.length) compareValues(st.values.map((v) => v.name), ct, issues, rows, st.name);
      report(st, kind, st.name, issues, rows, ct);
    }

    // ============================================== 名前のない値の一覧（「PENDING / PAID / SHIPPED のいずれか」）
    for (const vl of spec.valueLists) {
      const label = vl.names.join(" / ");
      let best = null;
      let bestScore = 0;
      for (const t of code.enums) {
        const s = vl.names.filter((n) => t.values.some((v) => normName(v.name) === normName(n))).length;
        if (s > bestScore) { bestScore = s; best = t; }
      }
      if (vl.field) {
        const fs = code.fieldsByName.get(vl.field) || [];
        for (const f of fs) {
          const tn = f.field.type ? parseType(f.field.type).name : null;
          const t = code.enums.find((e) => normName(e.name) === tn);
          if (t) { best = t; bestScore = Math.max(bestScore, 1); }
        }
      }
      const item = { line: vl.line, strong: true };
      if (!best || bestScore < Math.max(1, Math.ceil(vl.names.length / 2))) {
        const missing = vl.names.filter((n) => !code.words.has(n) && !code.wordsNorm.has(normName(n)));
        if (!missing.length) { report(item, "values", label, [], [], null); continue; }
        report(item, "values", label, [{ sev: missing.length === vl.names.length ? "warn" : "error", cat: "missing", text: `値 ${missing.map((x) => "`" + x + "`").join(" ")} がコードに見つかりません`, hint: "列挙型や定数として定義されているか確かめてください。" }], [], null);
        continue;
      }
      matchedCode.add(best);
      const issues = [];
      const rows = [];
      compareValues(vl.names, best, issues, rows, best.name);
      report(item, "values", best.name, issues, rows, best, { label: best.name + " の値" });
    }

    // ============================================== 定数
    for (const sc of spec.consts) {
      let cands = code.constsByName.get(sc.name) || [];
      let renamed = null;
      if (!cands.length) {
        const fs = (code.fieldsByName.get(sc.name) || []).filter((f) => f.field.value !== null);
        cands = fs.map((f) => ({ name: f.field.name, value: f.field.value, file: f.type.file, line: f.field.line }));
      }
      if (!cands.length) {
        const nn = code.constsByNorm.get(normName(sc.name));
        if (nn) { cands = nn; renamed = nn[0].name; }
      }
      if (!cands.length) {
        const ev = code.enumValueByName.get(sc.name);
        if (ev) { report(sc, "const", sc.name, [], [], ev); continue; }
        notFound(sc, "const", sc.name, code.constNames);
        continue;
      }
      const issues = [];
      const rows = [];
      let cc = cands[0];
      if (sc.value !== null && sc.value !== undefined) {
        const same = cands.find((c) => sameValue(sc.value, c.value) === true);
        if (same) cc = same;
      }
      matchedCode.add(cc);
      if (renamed) {
        issues.push({ sev: "warn", cat: "naming", text: `\`${sc.name}\` が、コードでは \`${renamed}\` と書かれています`, hint: "名前の書き方をそろえましょう。" });
        rows.push({ label: "名前", spec: sc.name, code: renamed, state: "warn" });
      }
      if (sc.value !== null && sc.value !== undefined) {
        const same = sameValue(sc.value, cc.value);
        rows.push({ label: "値", spec: String(sc.value), code: cc.value === null ? "—" : String(cc.value), state: same === false ? "bad" : same === null ? "na" : "ok" });
        if (same === false) issues.push({ sev: "error", cat: "mismatch", text: `\`${sc.name}\` の値が違います（仕様 ${sc.value} / コード ${cc.value}）`, hint: "どちらが正しいか確認して、片方に合わせてください。" });
      }
      report(sc, "const", sc.name, issues, rows, cc);
    }

    // ============================================== API（エンドポイント）
    // 仕様に別のメソッドで書かれているコードのルートは「メソッド違い」の候補にしない
    const specEpKeys = new Set(spec.endpoints.map((e) => e.method + " " + normPath(e.path)));
    const claimed = (e) => [e.np, ...e.alts].some((p) => specEpKeys.has(e.method + " " + p));
    for (const se of spec.endpoints) {
      const np = normPath(se.path);
      const label = `${se.method} ${se.path}`;
      const onPath = code.endpoints.filter((e) => e.np === np || e.alts.includes(np));
      const exact = onPath.filter((e) => e.method === se.method || e.method === "ANY" || se.method === "ANY");
      const samePath = onPath.filter((e) => !claimed(e));
      if (exact.length) {
        const ce = exact[0];
        matchedCode.add(ce);
        const issues = [];
        const rows = [{ label: "メソッドとパス", spec: label, code: `${ce.method} ${ce.fullPath}`, state: "ok" }];
        const sp = pathParams(se.path);
        const cp = pathParams(ce.fullPath);
        if (sp.length === cp.length && sp.some((x, i) => x !== cp[i])) {
          rows[0].state = "warn";
          issues.push({ sev: "info", cat: "naming", text: `パスの変数名が違います（仕様 ${sp.map((x) => "{" + x + "}").join(" ")} / コード ${cp.map((x) => "{" + x + "}").join(" ")}）`, hint: "動きは同じですが、名前をそろえると読みやすくなります。" });
        }
        report(se, "endpoint", label, issues, rows, ce);
        continue;
      }
      if (samePath.length) {
        const ce = samePath[0];
        matchedCode.add(ce);
        report(se, "endpoint", label, [{ sev: "error", cat: "mismatch", text: `\`${se.path}\` の HTTP メソッドが違います（仕様 ${se.method} / コード ${samePath.map((e) => e.method).join(", ")}）`, hint: "クライアントが仕様どおりに呼ぶと 405 や 404 になります。" }],
          [{ label: "メソッド", spec: se.method, code: samePath.map((e) => e.method).join(", "), state: "bad" }, { label: "パス", spec: se.path, code: ce.fullPath, state: "ok" }], ce);
        continue;
      }
      // 1か所だけ違うパス（/users と /user など）
      const segs = np.split("/");
      const near = code.endpoints.find((e) => {
        if (e.method !== se.method && e.method !== "ANY") return false;
        if (claimed(e)) return false;
        for (const cand of [e.np, ...e.alts]) {
          const cs = cand.split("/");
          if (cs.length !== segs.length) continue;
          let diff = 0;
          for (let i = 0; i < cs.length; i++) if (cs[i] !== segs[i]) diff++;
          if (diff === 1) return true;
        }
        return false;
      });
      if (near) {
        matchedCode.add(near);
        report(se, "endpoint", label, [{ sev: "error", cat: "mismatch", text: `パスが違います（仕様 ${se.path} / コード ${near.fullPath}）`, hint: "1か所だけ違うので、打ちまちがいか、どちらかを変え忘れた可能性があります。" }],
          [{ label: "メソッド", spec: se.method, code: near.method, state: "ok" }, { label: "パス", spec: se.path, code: near.fullPath, state: "bad" }], near);
        continue;
      }
      report(se, "endpoint", label, [{ sev: "error", cat: "missing", text: `API \`${label}\` がコードにありません`, hint: code.endpoints.length ? "ルーティングの定義を確かめてください。" : "コードからルーティングの定義（@GetMapping、app.get(...)、@app.get(...) など）が見つかりませんでした。" }], [], null);
    }

    // ============================================== 仕様の文中に出てくる名前
    const handled = new Set();
    for (const f of spec.funcs) { handled.add(f.name); if (f.params) for (const p of f.params) handled.add(p.name); if (f.owner) handled.add(f.owner); }
    for (const t of spec.types) { handled.add(t.name); for (const x of t.fields || []) handled.add(x.name); for (const v of t.values || []) handled.add(v.name); }
    for (const c of spec.consts) handled.add(c.name);
    for (const v of spec.valueLists) for (const n of v.names) handled.add(n);
    const seenMention = new Set();
    for (const m of spec.mentions) {
      const parts = m.full.split(".");
      if (parts.length > 1 && (FILE_EXT.test(parts[parts.length - 1]) || !code.words.has(parts[0]))) continue;
      const name = m.name;
      if (handled.has(name) || seenMention.has(name) || COMMON_WORDS.has(name) || name.length < 3 || /^\d/.test(name)) continue;
      if (/^[a-z]+$/.test(name) && name.length < 4) continue;
      seenMention.add(name);
      const item = { line: m.line, strong: true };
      if (code.words.has(name)) { checks.push({ kind: "name", name, label: name, line: m.line, status: "ok", code: codeRef(code.words.get(name)) }); continue; }
      const nn = code.wordsNorm.get(normName(name));
      if (nn) {
        report(item, "name", name, [{ sev: "warn", cat: "naming", text: `\`${name}\` が、コードでは \`${nn}\` と書かれています`, hint: "大文字・小文字や _ の付け方がちがいます。" }], [{ label: "名前", spec: name, code: nn, state: "warn" }], code.words.get(nn));
        continue;
      }
      const sug = closest(name, code.declNames);
      report(item, "name", name, [{ sev: "warn", cat: "missing", text: `仕様に出てくる \`${name}\` がコードのどこにもありません`, hint: sug ? `似た名前: \`${sug.name}\`。名前が変わっていないか確かめてください。` : "名前が変わったか、まだ作られていない可能性があります。" }],
        sug ? [{ label: "名前", spec: name, code: sug.name + "（似た名前）", state: "bad" }] : [], sug ? code.declByName.get(sug.name) : null, { suggestion: sug ? sug.name : null });
    }

    // ============================================== コードにだけあるもの
    const mentioned = (n) => spec.words.has(normName(n));
    const extras = [];
    const routeHandlers = new Set(code.endpoints.map((e) => e.handler).filter(Boolean));
    if (spec.funcs.length) {
      const fieldNames = new Set(code.allFields.map((f) => normName(f.field.name)));
      for (const f of code.funcs) {
        if (matchedCode.has(f) || f.private || f.local || f.isCtor || f.iface && code.typesByName.has(f.owner) && matchedCode.has(code.typesByName.get(f.owner)[0])) continue;
        if (IGNORE_EXTRA.has(f.name) || /^__\w+__$/.test(f.name) || isTestFile(f.file)) continue;
        if (f.lang !== "java" && f.lang !== "python" && !f.owner && f.exported === false) continue;
        const acc = f.name.match(/^(?:get|set|is|has)([A-Z_]\w*)$/) || f.name.match(/^(?:get|set|is|has)_(\w+)$/);
        if (acc && fieldNames.has(normName(acc[1]))) continue;
        if (spec.endpoints.length && routeHandlers.has(f.name)) continue;
        const owner = f.owner ? code.typesByName.get(f.owner) : null;
        if (owner && owner.some((t) => t.private || t.local)) continue;
        if (mentioned(f.name)) continue;
        extras.push({ kind: "func", name: (f.owner ? f.owner + "." : "") + f.name, ref: f, detail: sigStr(f.name, f.params, f.returns) });
      }
    }
    if (spec.types.length) {
      for (const t of code.types) {
        if (matchedCode.has(t) || t.private || t.local || isTestFile(t.file) || mentioned(t.name)) continue;
        extras.push({ kind: t.values ? "enum" : "type", name: t.name, ref: t, detail: t.kind });
      }
    }
    if (spec.consts.length) {
      for (const c of code.consts) {
        if (matchedCode.has(c) || isTestFile(c.file) || mentioned(c.name)) continue;
        extras.push({ kind: "const", name: c.name, ref: c, detail: "= " + c.value });
      }
    }
    if (spec.endpoints.length) {
      for (const e of code.endpoints) {
        if (matchedCode.has(e) || isTestFile(e.file)) continue;
        extras.push({ kind: "endpoint", name: `${e.method} ${e.fullPath}`, ref: e, detail: e.handler ? e.handler : "" });
      }
    }
    const EXTRA_LIMIT = 300;
    for (const x of extras.slice(0, EXTRA_LIMIT)) {
      report(null, x.kind, x.name, [{ sev: "info", cat: "extra", text: `${KIND_LABEL[x.kind]} \`${x.name}\` は仕様書に書かれていません`, hint: "仕様書に追記するか、不要なら消してください。" }], [{ label: "コード", spec: "—", code: x.detail, state: "na" }], x.ref);
    }

    const stats = {
      checked: checks.filter((c) => c.status !== "skipped").length,
      ok: checks.filter((c) => c.status === "ok" || c.status === "info").length,
      error: findings.filter((f) => f.sev === "error").length,
      warn: findings.filter((f) => f.sev === "warn").length,
      info: findings.filter((f) => f.sev === "info").length,
      mismatch: findings.filter((f) => f.cat === "mismatch" && f.sev !== "info").length,
      missing: findings.filter((f) => f.cat === "missing").length,
      naming: findings.filter((f) => f.cat === "naming").length,
      extra: findings.filter((f) => f.cat === "extra").length,
      extraTotal: extras.length,
      ms: Date.now() - t0,
      code: {
        files: models.length, funcs: code.funcs.length, types: code.types.length, consts: code.consts.length,
        endpoints: code.endpoints.length, lines: models.reduce((a, m) => a + m.lines.length, 0),
      },
      spec: { funcs: spec.funcs.length, types: spec.types.length, consts: spec.consts.length, endpoints: spec.endpoints.length },
    };
    const sevOrder = { error: 0, warn: 1, info: 2 };
    findings.sort((a, b) => sevOrder[a.sev] - sevOrder[b.sev] || (a.spec ? a.spec.line : 1e9) - (b.spec ? b.spec.line : 1e9));
    checks.sort((a, b) => (a.line || 0) - (b.line || 0));
    return { findings, checks, stats };
  }

  function isTestFile(f) {
    return /(?:^|[\\/])(?:tests?|__tests__|spec)[\\/]|(?:Test|Tests|IT)\.java$|[._-](?:test|spec)\.[jt]sx?$|(?:^|[\\/])test_[^\\/]*\.py$|_test\.py$/.test(String(f || ""));
  }

  // ---------------------------------------------------------------- 関数どうしを比べる

  function overloadScore(sf, c) {
    if (!sf.params) return 0;
    let s = Math.abs(sf.params.length - c.params.length) * 3;
    const names = new Set(c.params.map((p) => normName(p.name)));
    for (const p of sf.params) if (!names.has(normName(p.name))) s += 1;
    return s;
  }
  function pickOverload(sf, cands) {
    let best = cands[0];
    let bs = Infinity;
    for (const c of cands) {
      const s = overloadScore(sf, c) + (c.iface ? 0.5 : 0);
      if (s < bs) { bs = s; best = c; }
    }
    return best;
  }

  function compareFunc(sf, cf, renamed) {
    const issues = [];
    const rows = [];
    const lang = cf.lang || "java";
    if (renamed) {
      issues.push({ sev: "warn", cat: "naming", text: `\`${sf.name}\` が、コードでは \`${renamed}\` と書かれています`, hint: "名前の書き方をそろえましょう。" });
      rows.push({ label: "名前", spec: sf.name, code: renamed, state: "warn" });
    }
    const cps = cf.params;
    if (sf.params === null) {
      rows.push({ label: "引数", spec: "（仕様に書かれていない）", code: cps.length ? cps.map(paramStr).join(", ") : "なし", state: "na" });
    } else {
      const sps = sf.params;
      const pair = new Array(sps.length).fill(-1);
      const used = new Set();
      sps.forEach((p, i) => {
        let j = cps.findIndex((c, k) => !used.has(k) && c.name === p.name);
        if (j < 0) j = cps.findIndex((c, k) => !used.has(k) && normName(c.name) === normName(p.name));
        if (j >= 0) { pair[i] = j; used.add(j); }
      });
      // 名前で合わなかったものは、同じ位置どうしで比べる（名前の変更）
      const renames = [];
      sps.forEach((p, i) => {
        if (pair[i] >= 0) return;
        if (i < cps.length && !used.has(i) && (sps.length === cps.length || !cps.some((c) => c.name === p.name))) {
          pair[i] = i;
          used.add(i);
          renames.push(i);
        }
      });
      const matchedIdx = pair.filter((j) => j >= 0);
      const outOfOrder = matchedIdx.some((j, k) => k > 0 && j < matchedIdx[k - 1]);
      const missing = sps.filter((_, i) => pair[i] < 0);
      const extra = cps.filter((_, j) => !used.has(j));

      if (sps.length !== cps.length) {
        const requiredExtra = extra.filter((p) => !p.optional && !p.variadic);
        const sev = missing.length || requiredExtra.length ? "error" : "warn";
        let detail = [];
        if (missing.length) detail.push(`コードにない: ${missing.map((p) => p.name).join(", ")}`);
        if (extra.length) detail.push(`仕様にない: ${extra.map((p) => p.name).join(", ")}`);
        issues.push({ sev, cat: "mismatch", text: `\`${sf.name}\` の引数の数が違います（仕様 ${sps.length} 個 / コード ${cps.length} 個${detail.length ? "。" + detail.join("、") : ""}）`, hint: sev === "warn" ? "コードにだけある引数は省略できるので、呼び出しは壊れません。仕様書に追記しましょう。" : "呼び出す側とそろわないと、コンパイルエラーや実行時エラーになります。" });
      } else if (missing.length) {
        issues.push({ sev: "error", cat: "mismatch", text: `\`${sf.name}\` の引数 ${missing.map((p) => p.name).join(", ")} がコードにありません`, hint: "引数の名前と並びを確かめてください。" });
      }
      if (outOfOrder) issues.push({ sev: "error", cat: "mismatch", text: `\`${sf.name}\` の引数の順番が違います（仕様 ${sps.map((p) => p.name).join(", ")} / コード ${cps.map((p) => p.name).join(", ")}）`, hint: "同じ型の引数が入れかわると、エラーにならずに計算だけがおかしくなります。" });

      const renameText = [];
      sps.forEach((sp, i) => {
        const j = pair[i];
        const cp = j >= 0 ? cps[j] : null;
        const row = { label: `引数 ${i + 1}`, spec: paramStr(sp), code: cp ? paramStr(cp) : "—", state: "ok" };
        if (!cp) { row.state = "bad"; rows.push(row); return; }
        if (renames.includes(i)) { row.state = "warn"; renameText.push(`${sp.name} → ${cp.name}`); }
        else if (cp.name !== sp.name) row.state = "warn";
        if (outOfOrder && j !== i) row.state = "bad";
        // 型
        const st = parseType(sp.type, "spec");
        const ct = parseType(cp.type, lang);
        const r = compareTypes(st, ct);
        if (r === "diff") {
          row.state = "bad";
          issues.push({ sev: "error", cat: "mismatch", text: `\`${sf.name}\` の引数 ${sp.name} の型が違います（仕様 ${sp.type} / コード ${cp.type}）`, hint: "どちらの型が正しいか確認してください。" });
        } else if (r === "minor") {
          if (row.state === "ok") row.state = "warn";
          issues.push({ sev: "warn", cat: "mismatch", text: `\`${sf.name}\` の引数 ${sp.name} の型が少し違います（仕様 ${sp.type} / コード ${cp.type}）`, hint: "扱える範囲や精度が変わります。意図した違いか確かめてください。" });
        }
        // デフォルト値・必須
        if (sp.default !== null && sp.default !== undefined && cp.default !== null && cp.default !== undefined) {
          if (sameValue(sp.default, cp.default) === false) {
            row.state = "bad";
            issues.push({ sev: "error", cat: "mismatch", text: `\`${sf.name}\` の引数 ${sp.name} のデフォルト値が違います（仕様 ${sp.default} / コード ${cp.default}）`, hint: "省略して呼んだときの動きが変わります。" });
          }
        } else if (sp.default !== null && sp.default !== undefined && !cp.optional && lang !== "java") {
          if (row.state === "ok") row.state = "warn";
          issues.push({ sev: "warn", cat: "mismatch", text: `\`${sf.name}\` の引数 ${sp.name} は、仕様では省略できます（デフォルト ${sp.default}）が、コードでは必須です`, hint: "デフォルト値をコードに書くか、仕様を直してください。" });
        } else if (sp.required === true && cp.optional && !cp.variadic) {
          if (row.state === "ok") row.state = "warn";
          issues.push({ sev: "warn", cat: "mismatch", text: `\`${sf.name}\` の引数 ${sp.name} は、仕様では必須ですが、コードでは省略できます`, hint: "省略されたときの動きが仕様にありません。" });
        }
        rows.push(row);
      });
      if (renameText.length)
        issues.push({ sev: "warn", cat: "naming", text: `\`${sf.name}\` の引数名が違います（${renameText.join("、")}）`, hint: "名前が違うだけなら動きは同じですが、キーワード引数や API の項目名なら呼び出しが壊れます。" });
      extra.forEach((cp) => rows.push({ label: "引数（コードのみ）", spec: "—", code: paramStr(cp), state: cp.optional || cp.variadic ? "warn" : "bad" }));
    }
    // 戻り値
    if (!cf.isCtor) {
      if (sf.returns) {
        const st = parseType(sf.returns, "spec");
        const ct = parseType(cf.returns, lang);
        if (cf.returns === null || cf.returns === undefined) {
          rows.push({ label: "戻り値", spec: sf.returns, code: "（型が書かれていない）", state: "na" });
        } else {
          const r = compareTypes(st, ct);
          rows.push({ label: "戻り値", spec: typeStr(sf.returns), code: typeStr(cf.returns), state: r === "diff" ? "bad" : r === "minor" ? "warn" : "ok" });
          if (r === "diff") issues.push({ sev: "error", cat: "mismatch", text: `\`${sf.name}\` の戻り値の型が違います（仕様 ${sf.returns} / コード ${cf.returns}）`, hint: "呼び出す側が受け取る値の形が変わります。" });
          else if (r === "minor") issues.push({ sev: "warn", cat: "mismatch", text: `\`${sf.name}\` の戻り値の型が少し違います（仕様 ${sf.returns} / コード ${cf.returns}）`, hint: "扱える範囲や精度が変わります。" });
        }
      } else if (cf.returns) rows.push({ label: "戻り値", spec: "（仕様に書かれていない）", code: typeStr(cf.returns), state: "na" });
    }
    return { issues, rows };
  }

  function overlapScore(st, ct) {
    let s = 0;
    for (const f of st.fields || []) if (ct.fields.some((x) => normName(x.name) === normName(f.name))) s++;
    for (const v of st.values || []) if ((ct.values || []).some((x) => normName(x.name) === normName(v.name))) s++;
    return s;
  }

  function compareFields(st, ct, issues, rows) {
    const lang = langOfFile(ct.file);
    const used = new Set();
    const missing = [];
    for (const sf of st.fields) {
      let cf = ct.fields.find((x) => x.name === sf.name);
      if (!cf) cf = ct.fields.find((x) => normName(x.name) === normName(sf.name));
      const row = { label: "フィールド", spec: paramStr(sf), code: cf ? paramStr({ name: cf.name, type: cf.type }) : "—", state: "ok" };
      if (!cf) { row.state = "bad"; missing.push(sf.name); rows.push(row); continue; }
      used.add(cf);
      if (cf.name !== sf.name) {
        row.state = "warn";
        issues.push({ sev: "warn", cat: "naming", text: `フィールド \`${sf.name}\` が、コードでは \`${cf.name}\` と書かれています`, hint: "JSON などで使う項目名なら、受け渡しが壊れます。" });
      }
      const r = compareTypes(parseType(sf.type, "spec"), parseType(cf.type, lang));
      if (r === "diff") {
        row.state = "bad";
        issues.push({ sev: "error", cat: "mismatch", text: `${st.name}.${sf.name} の型が違います（仕様 ${sf.type} / コード ${typeStr(cf.type)}）`, hint: "どちらの型が正しいか確認してください。" });
      } else if (r === "minor") {
        if (row.state === "ok") row.state = "warn";
        issues.push({ sev: "warn", cat: "mismatch", text: `${st.name}.${sf.name} の型が少し違います（仕様 ${sf.type} / コード ${typeStr(cf.type)}）`, hint: "扱える範囲や精度が変わります。" });
      }
      if (sf.required === true && (cf.optional || /\|\s*(?:undefined|null|None)\b|^Optional\b|\?$/.test(cf.type || ""))) {
        if (row.state === "ok") row.state = "warn";
        issues.push({ sev: "warn", cat: "mismatch", text: `${st.name}.${sf.name} は仕様では必須ですが、コードでは空でもよい型です`, hint: "必須チェックがあるか確かめてください。" });
      }
      rows.push(row);
    }
    if (missing.length) issues.push({ sev: "error", cat: "mismatch", text: `${st.name} にフィールド ${missing.join(", ")} がありません`, hint: "仕様どおりに追加するか、仕様書を直してください。" });
    const extra = ct.fields.filter((f) => !used.has(f) && !f.static && f.name !== "serialVersionUID" && !f.accessor);
    if (extra.length) {
      issues.push({ sev: "warn", cat: "mismatch", text: `${st.name} に、仕様にないフィールド ${extra.map((f) => f.name).join(", ")} があります`, hint: "仕様書に追記するか、不要なら消してください。" });
      for (const f of extra) rows.push({ label: "フィールド（コードのみ）", spec: "—", code: paramStr({ name: f.name, type: f.type }), state: "warn" });
    }
  }

  function compareValues(specNames, ct, issues, rows, label) {
    const cvals = ct.values || [];
    const key = (x) => normName(x);
    const cset = new Map(cvals.map((v) => [key(v.name), v.name]));
    const sset = new Set(specNames.map(key));
    const missing = specNames.filter((n) => !cset.has(key(n)));
    const extra = cvals.filter((v) => !sset.has(key(v.name))).map((v) => v.name);
    rows.push({ label: "値", spec: specNames.join(" / "), code: cvals.map((v) => v.name).join(" / ") || "—", state: missing.length ? "bad" : extra.length ? "warn" : "ok" });
    if (missing.length) issues.push({ sev: "error", cat: "mismatch", text: `${label} に値 ${missing.join(", ")} がありません`, hint: "仕様にある状態をコードで表せません。" });
    if (extra.length) issues.push({ sev: "warn", cat: "mismatch", text: `${label} に、仕様にない値 ${extra.join(", ")} があります`, hint: "仕様書に追記するか、不要なら消してください。" });
  }

  function langOfFile(f) {
    if (/\.py$/.test(f)) return "python";
    if (/\.tsx?$/.test(f)) return "ts";
    if (/\.java$/.test(f)) return "java";
    return "js";
  }

  // ---------------------------------------------------------------- コードの索引

  function buildIndex(models) {
    const I = {
      funcs: [], types: [], consts: [], endpoints: [], enums: [], allFields: [],
      funcsByName: new Map(), funcsByNorm: new Map(), typesByName: new Map(), typesByNorm: new Map(),
      constsByName: new Map(), constsByNorm: new Map(), fieldsByName: new Map(), enumValueByName: new Map(),
      declByName: new Map(), words: new Map(), wordsNorm: new Map(), byFile: new Map(),
      funcNames: [], typeNames: [], constNames: [], declNames: [],
    };
    const add = (map, k, v) => {
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(v);
    };
    const prefixes = new Set();
    for (const m of models) {
      I.byFile.set(m.file, m);
      for (const p of m.prefixes || []) prefixes.add(p);
      for (const [w, line] of m.words) {
        if (!I.words.has(w)) I.words.set(w, { file: m.file, line });
        const n = normName(w);
        if (!I.wordsNorm.has(n)) I.wordsNorm.set(n, w);
      }
      for (const f of m.funcs) {
        I.funcs.push(f);
        add(I.funcsByName, f.name, f);
        add(I.funcsByNorm, normName(f.name), f);
        if (!I.declByName.has(f.name)) I.declByName.set(f.name, f);
      }
      for (const t of m.types) {
        I.types.push(t);
        add(I.typesByName, t.name, t);
        add(I.typesByNorm, normName(t.name), t);
        if (!I.declByName.has(t.name)) I.declByName.set(t.name, t);
        if (t.values) {
          I.enums.push(t);
          for (const v of t.values) if (!I.enumValueByName.has(v.name)) I.enumValueByName.set(v.name, { file: t.file, line: v.line });
        }
        for (const f of t.fields) {
          const ref = { field: f, type: t, file: t.file, line: f.line };
          I.allFields.push(ref);
          add(I.fieldsByName, f.name, ref);
          if (!I.declByName.has(f.name)) I.declByName.set(f.name, { file: t.file, line: f.line });
        }
      }
      for (const c of m.consts) {
        I.consts.push(c);
        add(I.constsByName, c.name, c);
        add(I.constsByNorm, normName(c.name), c);
        if (!I.declByName.has(c.name)) I.declByName.set(c.name, c);
      }
    }
    for (const m of models)
      for (const e of m.endpoints) {
        const ep = { ...e, fullPath: e.path, np: normPath(e.path), alts: [...prefixes].map((p) => normPath(p + "/" + e.path)) };
        I.endpoints.push(ep);
      }
    I.funcNames = [...I.funcsByName.keys()];
    I.typeNames = [...I.typesByName.keys()];
    I.constNames = [...I.constsByName.keys(), ...I.enumValueByName.keys()];
    I.declNames = [...I.declByName.keys()];
    return I;
  }

  // ---------------------------------------------------------------- Markdown レポート

  function toMarkdown(rep, opts) {
    const o = opts || {};
    const s = rep.stats;
    const out = [];
    out.push(`## 仕様とコードの照合結果`);
    out.push("");
    out.push(`- 照合した仕様の項目: ${s.checked} 件（一致 ${s.ok} 件）`);
    out.push(`- 食い違い・未実装: ${s.error} 件 / 要確認: ${s.warn} 件 / 仕様にないコード: ${s.extraTotal} 件`);
    if (o.specName || o.files) out.push(`- 対象: ${o.specName || "仕様書"} × ${o.files || s.code.files + " ファイル"}`);
    out.push("");
    const sections = [
      ["error", "### 食い違い・未実装"],
      ["warn", "### 要確認"],
      ["info", "### 仕様に書かれていないコード"],
    ];
    for (const [sev, head] of sections) {
      const list = rep.findings.filter((f) => f.sev === sev);
      if (!list.length) continue;
      out.push(head);
      out.push("");
      for (const f of list) {
        const where = [f.spec ? `仕様 L${f.spec.line}` : null, f.code ? `${f.code.file}:${f.code.line}` : null].filter(Boolean).join(" ↔ ");
        out.push(`- [ ] ${f.title}${where ? `（${where}）` : ""}`);
        for (const m of f.more) out.push(`  - ${m}`);
      }
      out.push("");
    }
    if (!rep.findings.length) out.push("食い違いは見つかりませんでした。");
    return out.join("\n");
  }

  const api = { compare, toMarkdown, normPath, sigStr, paramStr, KIND_LABEL };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SpecCheckCompare = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
