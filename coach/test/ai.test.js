const test = require("node:test");
const assert = require("node:assert");
const { createAi } = require("../src/ai.js");

/** Claude API のにせもの。呼ばれた引数を記録して、決めた答えを返す */
function fakeClient(responder) {
  const calls = [];
  return {
    calls,
    beta: { messages: { create: async (params) => { calls.push(params); return responder(params); } } },
  };
}
const textRes = (obj, stop = "end_turn") => ({ stop_reason: stop, content: [{ type: "text", text: JSON.stringify(obj) }] });

test("リクエストの形: モデル・JSON の形の指定・断られたときの引きつぎ", async () => {
  const client = fakeClient(() => textRes({ score: 0.7, verdict: "partial", feedback: "おしい" }));
  const ai = await createAi({ client });
  const r = await ai.gradeFree({ type: "free", prompt: "説明して", model: "模範" }, "答え");
  assert.deepStrictEqual(r, { score: 0.7, verdict: "partial", feedback: "おしい" });
  const p = client.calls[0];
  assert.strictEqual(p.model, "claude-opus-5-5");
  assert.strictEqual(p.output_config.format.type, "json_schema");
  assert.strictEqual(p.output_config.effort, "low");
  assert.strictEqual(p.fallbacks, "default");
  assert.deepStrictEqual(p.betas, ["server-side-fallback-2026-07-01"]);
  assert.match(p.messages[0].content, /<student_answer>\n答え\n<\/student_answer>/);
});

test("点数は 0〜1 におさめる", async () => {
  const ai = await createAi({ client: fakeClient(() => textRes({ score: 3, verdict: "correct", feedback: "" })) });
  assert.strictEqual((await ai.gradeFree({ prompt: "q", model: "m" }, "a")).score, 1);
});

test("断られた・途中で切れた・JSON でない ときは、わかるエラーにする", async () => {
  for (const [res, re] of [
    [{ stop_reason: "refusal", content: [] }, /答えられない/],
    [{ stop_reason: "max_tokens", content: [{ type: "text", text: "{" }] }, /切れました/],
    [{ stop_reason: "end_turn", content: [{ type: "text", text: "こんにちは" }] }, /読みとれません/],
  ]) {
    const ai = await createAi({ client: fakeClient(() => res) });
    await assert.rejects(ai.gradeFree({ prompt: "q", model: "m" }, "a"), re);
  }
});

test("問題づくり: 問題集と同じ形にして返す", async () => {
  const client = fakeClient(() => textRes({ items: [
    { type: "choice", prompt: "Q1", code: "", choices: ["a", "b", "c", "d"], answer: 2, answers: [], explanation: "E", level: 2 },
    { type: "input", prompt: "Q2", code: "int x = 1;", choices: [], answer: -1, answers: ["1"], explanation: "E", level: 3 },
  ] }));
  const ai = await createAi({ client });
  const raw = await ai.generateItems({ tag: "loop", tagLabel: "くり返し", count: 2, level: 2, examples: [{ prompt: "既存" }], mistakes: [{ prompt: "まちがい", answer: "x" }] });
  assert.strictEqual(raw.length, 2);
  assert.deepStrictEqual({ ...raw[0], id: undefined }, { id: undefined, tag: "loop", type: "choice", prompt: "Q1", explanation: "E", level: 2, code: undefined, choices: ["a", "b", "c", "d"], answer: 2 });
  assert.deepStrictEqual(raw[1].answers, ["1"]);
  assert.strictEqual(raw[1].code, "int x = 1;");
  assert.match(raw[0].id, /^ai\/loop-/);
  assert.match(client.calls[0].messages[0].content, /既存[\s\S]*まちがい（学生の答え: x）/);
});

test("キーも SDK もないときは、オフで動く", async () => {
  const saved = { k: process.env.ANTHROPIC_API_KEY, t: process.env.ANTHROPIC_AUTH_TOKEN, p: process.env.ANTHROPIC_PROFILE };
  delete process.env.ANTHROPIC_API_KEY; delete process.env.ANTHROPIC_AUTH_TOKEN; delete process.env.ANTHROPIC_PROFILE;
  try {
    const ai = await createAi();
    assert.strictEqual(ai.enabled, false);
    assert.ok(ai.reason);
  } finally {
    for (const [k, v] of [["ANTHROPIC_API_KEY", saved.k], ["ANTHROPIC_AUTH_TOKEN", saved.t], ["ANTHROPIC_PROFILE", saved.p]]) if (v !== undefined) process.env[k] = v;
  }
});
