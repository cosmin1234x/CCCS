// OpenAI Chat Completions client for McAssist with the resilience the demo
// needs: a configurable base URL (the e2e harness points it at a fake server),
// automatic fallback when the configured model is unavailable, temperature
// handling for reasoning models, and per-call timeouts inside an overall
// request budget.

export const DEFAULT_MODEL = "gpt-4.1";
export const FALLBACK_MODEL = "gpt-4o-mini";
export const DEFAULT_BASE_URL = "https://api.openai.com/v1";

export class ProviderError extends Error {
  constructor(message, { status = 502, code = "", kind = "provider" } = {}) {
    super(message);
    this.name = "ProviderError";
    this.status = status;
    this.code = code;
    this.kind = kind;
  }
}

export function isReasoningModel(model) {
  return /^(gpt-5|o1|o3|o4)/i.test(String(model || "").trim());
}

export function modelUnavailable(status, error = {}) {
  const code = String(error.code || "");
  const message = String(error.message || "");
  if (code === "model_not_found" || code === "model_not_available") return true;
  if (status === 404 && (!code || /model/i.test(message) || /model/i.test(code))) return true;
  if (error.param === "model") return true;
  return /model\b.*\b(does not exist|not found|not available|unavailable|not supported|no access|do not have access)/i.test(message) ||
    /(does not exist|do not have access to)\b.*\bmodel/i.test(message);
}

export function temperatureRejected(status, error = {}) {
  if (status !== 400 && status !== 422) return false;
  return error.param === "temperature" || /temperature/i.test(String(error.message || ""));
}

export function createProvider({ fetchAPI = fetch, env = process.env, budgetMs = 48000, callTimeoutMs = 20000, now = () => Date.now() } = {}) {
  const startedAt = now();
  const deadline = startedAt + budgetMs;
  const state = {
    model: String(env.OPENAI_MODEL || "").trim() || DEFAULT_MODEL,
    fellBack: false,
    noTemperature: false,
    calls: 0,
  };
  const baseUrl = (String(env.OPENAI_BASE_URL || "").trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");

  return {
    state,
    remaining: () => deadline - now(),
    async complete({ messages, tools, toolChoice = "auto" }) {
      for (let attempt = 0; attempt < 4; attempt++) {
        const remaining = deadline - now();
        if (remaining < 2500) throw new ProviderError("McAssist ran out of time.", { status: 504, kind: "timeout" });
        const body = {
          model: state.model,
          messages,
          max_completion_tokens: isReasoningModel(state.model) ? 4000 : 1400,
        };
        if (tools?.length) {
          body.tools = tools;
          body.tool_choice = toolChoice;
        }
        if (!state.noTemperature && !isReasoningModel(state.model)) body.temperature = 0.2;
        state.calls++;
        let response;
        try {
          response = await fetchAPI(baseUrl + "/chat/completions", {
            method: "POST",
            headers: {
              Authorization: "Bearer " + env.OPENAI_API_KEY,
              "Content-Type": "application/json",
            },
            signal: AbortSignal.timeout(Math.max(1000, Math.min(callTimeoutMs, remaining - 1500))),
            body: JSON.stringify(body),
          });
        } catch (error) {
          if (error?.name === "TimeoutError" || error?.name === "AbortError")
            throw new ProviderError("McAssist took too long to reply.", { status: 504, kind: "timeout" });
          throw new ProviderError("McAssist could not reach the AI service.", { status: 502, kind: "network" });
        }
        let data = {};
        try {
          data = await response.json();
        } catch {
          data = {};
        }
        const status = Number(response.status) || (response.ok ? 200 : 500);
        if (response.ok) {
          const message = data?.choices?.[0]?.message;
          if (!message) throw new ProviderError("McAssist returned an empty response.", { status: 502, kind: "empty" });
          return message;
        }
        const error = data?.error || {};
        if (!state.fellBack && modelUnavailable(status, error)) {
          console.warn("McAssist model unavailable, falling back", { model: state.model, code: error.code });
          state.model = FALLBACK_MODEL;
          state.fellBack = true;
          continue;
        }
        if (!state.noTemperature && body.temperature !== undefined && temperatureRejected(status, error)) {
          state.noTemperature = true;
          continue;
        }
        console.error("McAssist provider error", { status, code: error.code, type: error.type });
        throw new ProviderError(
          status === 429 ? "McAssist is busy right now." : "McAssist could not connect right now.",
          { status: status === 429 ? 429 : 502, code: String(error.code || ""), kind: status === 429 ? "rate" : "provider" },
        );
      }
      throw new ProviderError("McAssist could not connect right now.", { status: 502 });
    },
  };
}
