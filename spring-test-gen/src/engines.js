/*
 * LLM の呼び出し口。どれも同じ形で使えます。
 *   engine.run({ system, specBlock, task, schema, onText, signal }) → { text, usage, stopReason, model }
 *
 *  - claude: claude.ai で公開したページの中から、見ている人の Claude を使う（APIキー不要）
 *  - api:    Anthropic の API キーで、ブラウザから直接呼ぶ（公式 SDK を使用）
 *  - manual: どちらも使えないとき。プロンプトをコピーしてチャットに貼る（app.js で扱う）
 */
(function (root) {
  "use strict";

  const MODELS = {
    "claude-opus-5-5": { label: "Claude Opus 5.5", note: "おすすめ", fallbacks: true, tier: "complex" },
    "claude-sonnet-5-5": { label: "Claude Sonnet 5.5", note: "速い・安い", fallbacks: true, tier: "default" },
    "claude-haiku-5-5": { label: "Claude Haiku 5.5", note: "最安・小さな仕様向け", fallbacks: false, tier: "quick" },
  };

  class EngineError extends Error {
    constructor(code, message, partialText) {
      super(message);
      this.code = code;
      this.partialText = partialText || "";
    }
  }

  // ---------------------------------------------------------------- API キー（公式 SDK）

  function createApiEngine({ apiKey, model, effort }) {
    const Anthropic = root.AnthropicSDK;
    if (!Anthropic) throw new EngineError("no_sdk", "SDK が読みこめていません");
    const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });
    const info = MODELS[model] || MODELS["claude-opus-5-5"];

    return {
      kind: "api",
      model,
      async run({ system, specBlock, task, schema, onText, signal, effort: callEffort }) {
        const params = {
          model,
          max_tokens: 64000,
          // system と仕様書は毎回同じ文字列 → 仕様書ブロックの最後にキャッシュの区切りを置く
          system: [{ type: "text", text: system }],
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: specBlock, cache_control: { type: "ephemeral" } },
                { type: "text", text: task },
              ],
            },
          ],
          output_config: { effort: callEffort || effort || "high" },
        };
        if (schema) params.output_config.format = { type: "json_schema", schema };
        if (info.fallbacks) {
          // 安全のための判定で断られたとき、サーバー側でおすすめのモデルにつなぎ直す
          params.betas = ["server-side-fallback-2026-07-01"];
          params.fallbacks = "default";
        }
        let text = "";
        try {
          const stream = client.beta.messages.stream(params, { signal });
          stream.on("text", (_delta, snapshot) => {
            text = snapshot;
            if (onText) onText(snapshot);
          });
          const msg = await stream.finalMessage();
          text = msg.content
            .filter((b) => b.type === "text")
            .map((b) => b.text)
            .join("");
          if (msg.stop_reason === "refusal") {
            throw new EngineError("refused", "Claude がこの内容への回答を断りました。仕様書の書き方を変えてみてください。");
          }
          return { text, usage: msg.usage, stopReason: msg.stop_reason, model: msg.model };
        } catch (e) {
          throw toEngineError(e, text, Anthropic);
        }
      },
    };
  }

  function toEngineError(e, partial, Anthropic) {
    if (e instanceof EngineError) return e;
    if (Anthropic) {
      if (e instanceof Anthropic.APIUserAbortError) return new EngineError("cancelled", "止めました", partial);
      if (e instanceof Anthropic.AuthenticationError) return new EngineError("auth", "API キーが正しくないようです。もう一度確かめてください。");
      if (e instanceof Anthropic.PermissionDeniedError) return new EngineError("auth", "この API キーでは、このモデルを使えません。");
      if (e instanceof Anthropic.RateLimitError) return new EngineError("rate_limited", "呼び出しが多すぎます。少し待ってからもう一度ためしてください。", partial);
      if (e instanceof Anthropic.BadRequestError) return new EngineError("bad_request", "リクエストが受けつけられませんでした: " + (e.message || ""), partial);
      if (e instanceof Anthropic.APIConnectionError) return new EngineError("network", "Anthropic の API につながりませんでした。ネットワークを確かめてください。", partial);
      if (e instanceof Anthropic.APIError) return new EngineError("upstream", `API のエラーです（${e.status || "?"}）。少し待ってもう一度ためしてください。`, partial);
    }
    return new EngineError("unknown", String((e && e.message) || e), partial);
  }

  // ---------------------------------------------------------------- claude.ai の中（sample）

  /** 公開ページで claude.use("sample") が使えれば、その関数を返す。使えなければ null。 */
  async function detectSample() {
    try {
      if (!root.claude || typeof root.claude.use !== "function") return null;
      return await root.claude.use("sample");
    } catch (_) {
      return null;
    }
  }

  const SAMPLE_MESSAGES = {
    not_granted: "Claude の利用が許可されていません。",
    sampling_disabled: "このアカウントでは Claude を使えません。",
    rate_limited: "Claude の利用が多すぎます。少し待ってからもう一度ためしてください。",
    session_expired: "もう一度 claude.ai にログインしてください。",
    prompt_too_large: "仕様書が長すぎます（256KB まで）。エンドポイントを分けて渡してください。",
    refused: "Claude がこの内容への回答を断りました。仕様書の書き方を変えてみてください。",
    empty_completion: "答えが空でした。もう一度ためしてください。",
    upstream_error: "Claude との通信がとぎれました。もう一度ためしてください。",
  };

  function createSampleEngine(sample, { model, effort }) {
    const info = MODELS[model] || MODELS["claude-opus-5-5"];
    return {
      kind: "claude",
      model,
      async run({ system, specBlock, task, onText, signal, effort: callEffort }) {
        // sample には system がないので、決まり → 仕様書 → お願い の順で1つの文章にする
        const prompt = `${system}\n\n${specBlock}\n\n${task}`;
        const eff = callEffort || effort || "high";
        try {
          const r = await sample(prompt, {
            signal,
            onText: ({ text }) => onText && onText(text),
            modelTier: info.tier,
            model,
            effort: eff === "xhigh" || eff === "max" ? "high" : eff,
            cache: false,
          });
          return { text: r.text, usage: null, stopReason: r.truncated ? "max_tokens" : "end_turn", model: r.modelApplied || info.label };
        } catch (e) {
          const code = (e && e.code) || "upstream_error";
          if (code === "cancelled") throw new EngineError("cancelled", "止めました", e.text);
          const unusable = ["not_granted", "sampling_disabled", "not_declared", "capability_disabled", "capability_removed"].includes(code);
          throw new EngineError(unusable ? "unavailable" : code, SAMPLE_MESSAGES[code] || SAMPLE_MESSAGES.upstream_error, e && e.text);
        }
      },
    };
  }

  root.SpringTestEngines = { MODELS, EngineError, createApiEngine, createSampleEngine, detectSample };
})(typeof window !== "undefined" ? window : globalThis);
