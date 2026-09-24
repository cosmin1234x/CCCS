// McAssist V4 — POST /api/ai-chat (alias /api/mcassist).
//
// An OpenAI tool-calling loop over the store's Firestore data. Reads run
// straight away; writes are validated and STAGED during the loop, then the
// server's risk policy decides: a single low-risk valid write runs at once,
// anything else becomes ONE pending plan the user confirms or cancels with
// { confirm: { pendingId, decision } }. Role and store are re-checked on every
// request and every write is audited. See PLAN.md "McAssist V4 API contract".
import { authenticateRequest, cleanText } from "../server/portal-admin.js";
import { createSession, defaultDeps, loadContext } from "../server/mcassist-session.js";
import { dispatchTool, planDecision, toolSchemasFor } from "../server/mcassist-tools.js";
import { executeOp, newPlanState, validateOp } from "../server/mcassist-ops.js";
import { describePlan, latestPendingPlan, resolvePlan, savePlan } from "../server/mcassist-pending.js";
import { createProvider } from "../server/mcassist-provider.js";
import { contextMessage, systemPrompt } from "../server/mcassist-prompt.js";

async function authenticate(req) {
  const { decoded } = await authenticateRequest(req);
  return decoded;
}

const YES = /^(?:yes|yeah|yep|yup|ok|okay|sure|confirm(?:ed)?|approve[d]?|go ahead|do it|go for it|please do|sounds good|send it|publish(?: it| them)?|apply(?: it| them)?)(?:,? (?:please|thanks|thank you|do it|go ahead|confirm))?[.! ]*$/i;
const NO = /^(?:no|nope|nah|cancel(?: it| that)?|stop|don'?t|do not|never ?mind|forget it|scrap (?:it|that))(?:,? thanks| thank you)?[.! ]*$/i;

function tidy(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/^\s*[*•]\s+/gm, "- ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 3000);
}

const CLAIMS_DONE =
  /(^|\n)\s*(done|all done|all set|sorted)\b|\b(i('ve| have)|we('ve| have)) (now )?(created|deleted|removed|updated|set|added|published|changed|made|saved|deactivated|promoted|approved)\b|\b(has|have) been (created|deleted|removed|updated|saved|published|deactivated|changed)\b|\bsuccessfully\b/i;
const NEGATED = /\b(nothing|not|cannot|unable|won't|haven't|hasn't|can't|couldn't|isn't|aren't)\b|n't\b/i;

// True when the text says a change already happened (and doesn't negate it).
function claimsDone(text) {
  return CLAIMS_DONE.test(text) && !NEGATED.test(text);
}
const TALKS_ABOUT_PLAN = /\b(confirm|approve|review the plan|pending|staged|plan card|buttons?)\b/i;

function normalised(text) {
  return String(text || "").replace(/\s+/g, " ").trim().toLowerCase().slice(0, 240);
}

function planPrompt(pending) {
  if (pending.items.length === 1)
    return "Here's the plan: " + pending.items[0].label + ". Review it below and confirm to apply it.";
  return "Here's the plan — " + pending.title + " (" + pending.summary + "). Review it below and confirm to apply it.";
}

function respond(res, status, body) {
  const out = { reply: body.reply, dataChanged: Boolean(body.dataChanged) };
  if (body.uiAction) out.uiAction = body.uiAction;
  if (body.actions?.length) out.actions = body.actions;
  if (body.steps?.length) out.steps = body.steps;
  if (body.suggestions?.length) out.suggestions = body.suggestions.slice(0, 4);
  if (body.pending) out.pending = body.pending;
  if (body.results) out.results = body.results;
  if (body.error) out.error = body.error;
  return res.status(status).json(out);
}

// Applies the risk policy to everything staged this turn.
async function finalise(session, { modelText, question, suggestions, message }) {
  const steps = session.steps;
  if (question) {
    return {
      reply: tidy(question),
      suggestions,
      steps,
      dataChanged: false,
    };
  }
  let reply = tidy(modelText);
  const decision = planDecision(session.staged);
  if (decision === "execute") {
    const item = session.staged[0];
    const v = await validateOp(session, item.kind, item.args, newPlanState());
    if (v.status === "ok") {
      try {
        const result = await executeOp(session, item.kind, item.args, v);
        if (!reply || TALKS_ABOUT_PLAN.test(reply)) reply = "Done — " + result.message.charAt(0).toLowerCase() + result.message.slice(1) + ".";
        return {
          reply,
          dataChanged: true,
          actions: [result.message],
          steps,
          uiAction: result.uiAction || session.uiAction,
        };
      } catch (error) {
        console.error("McAssist immediate write failed", { kind: item.kind, message: error?.message });
        return {
          reply: "I couldn't save that just now" + (error?.status ? ": " + error.message : ". Please try again."),
          dataChanged: false,
          steps,
        };
      }
    }
    // Something changed since staging: fall through to a confirmation.
    Object.assign(item, { status: v.status, note: v.note || item.note, label: v.label || item.label });
    if (v.status === "blocked") return { reply: "I couldn't do that: " + (v.note || "it's no longer valid."), dataChanged: false, steps };
  }
  if (decision === "confirm" || decision === "execute") {
    if (claimsDone(reply)) reply = "";
    if (!reply) reply = planPrompt({ ...describePlan(session.staged), items: session.staged });
    // The stored reply lets a typed "yes" straight afterwards resolve this plan.
    const pending = await savePlan(session, { message, reply });
    return { reply, dataChanged: false, steps, pending };
  }
  if (session.staged.length) {
    const notes = [...new Set(session.staged.map((s) => s.note).filter(Boolean))].slice(0, 2).join(" ");
    return {
      reply: reply || "I couldn't do that: " + (notes || "it isn't possible right now."),
      dataChanged: false,
      steps,
      suggestions: session.ambiguity?.candidates,
    };
  }
  // Nothing was written, so never let the reply claim otherwise.
  if (session.forbidden && claimsDone(reply)) reply = "";
  return {
    reply:
      reply ||
      (session.forbidden
        ? "Sorry — your role can't do that, so nothing was changed. Ask a Manager if it needs doing."
        : "Sorry, I didn't quite catch that. Could you say it another way?"),
    dataChanged: false,
    steps,
    uiAction: session.uiAction,
    suggestions: session.ambiguity ? session.ambiguity.candidates : undefined,
  };
}

// Deterministic shortcuts that work even without the AI provider. They go
// through exactly the same staging and risk policy as model tool calls.
function fastPath(session, message) {
  if (session.permissions.canVerify) {
    const m = message.match(/^\s*(?:verify|start (?:a )?verification for|open verification for)\s+(.+?)\s+(?:on|for)\s+(.+?)\s*[.!]?\s*$/i);
    if (m) return { name: "start_verification", args: { member: m[1], station: m[2] } };
  }
  if (session.permissions.canPlanShifts) {
    const rate = message.match(
      /^\s*(?:set|change|update)\s+(.+?)(?:'s|’s)?\s+(?:hourly\s+)?(?:pay\s+)?rate\s+(?:to|at)\s*£?\s*(\d+(?:\.\d{1,2})?)\s*(?:an hour|per hour|\/h(?:ou)?r)?\s*[.!]?\s*$/i,
    );
    if (rate) return { name: "manager_set_hourly_rate", args: { member: rate[1].trim(), hourlyRate: Number(rate[2]) } };
    const role = message.match(/^\s*(?:promote|make|set)\s+(.+?)\s+(?:to|as)\s+(?:a\s+)?(manager|crew\s*trainer|trainer|crew\s*member|crew)\s*[.!]?\s*$/i);
    if (role) {
      const raw = role[2].toLowerCase().replace(/\s+/g, "");
      return {
        name: "manager_set_role",
        args: { member: role[1].trim(), role: raw === "manager" ? "manager" : raw.includes("trainer") ? "crewTrainer" : "crew" },
      };
    }
  }
  return null;
}

export function createHandler({
  verifyUser = authenticate,
  fetchAPI = fetch,
  contextLoader = null,
  deps: depsOverride = null,
  budgetMs = 42000,
  callTimeoutMs = 20000,
  maxRounds = 8,
  rateLimit = 30,
} = {}) {
  const deps = { ...defaultDeps(), ...(depsOverride || {}) };
  const loadCtx = contextLoader || ((user) => loadContext(user, deps));
  const windows = new Map();

  return async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ reply: "Method not allowed", error: "Method not allowed" });
    }

    try {
      let body;
      try {
        body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      } catch {
        return res.status(400).json({ reply: "Please send a valid message.", error: "Invalid JSON" });
      }
      if (!body || typeof body !== "object") return res.status(400).json({ reply: "Please send a valid message.", error: "Invalid body" });

      const confirm = body.confirm && typeof body.confirm === "object" ? body.confirm : null;
      if (confirm) {
        if (typeof confirm.pendingId !== "string" || !confirm.pendingId || !["approve", "cancel"].includes(confirm.decision))
          return res.status(400).json({ reply: "That confirmation wasn't valid.", error: "Invalid confirmation" });
      } else if (typeof body.message !== "string" || !body.message.trim() || body.message.length > 2000) {
        return res.status(400).json({ reply: "Enter a message between 1 and 2,000 characters.", error: "Invalid message" });
      }

      const user = await verifyUser(req);
      const now = Date.now();
      for (const [uid, w] of windows) if (now - w.start > 60000) windows.delete(uid);
      const rate = windows.get(user.uid) || { start: now, count: 0 };
      if (rate.count >= rateLimit) {
        res.setHeader("Retry-After", "60");
        return res.status(429).json({ reply: "Please wait a minute before sending more messages.", error: "Rate limited" });
      }
      rate.count++;
      windows.set(user.uid, rate);

      const context = await loadCtx(user, req);
      const session = createSession({ user, context, deps });
      session.plan = newPlanState();

      if (confirm) {
        const result = await resolvePlan(session, confirm);
        return respond(res, 200, result);
      }

      const message = body.message.trim();
      const history = (Array.isArray(body.history) ? body.history : [])
        .filter((m) => m && ["user", "assistant"].includes(m.role) && typeof m.content === "string" && m.content.trim())
        .slice(-12)
        .map((m) => ({ role: m.role, content: m.content.slice(0, 1500) }));

      // A typed "yes" / "cancel" straight after a plan resolves that plan. It
      // only counts when McAssist's last message was that plan, so a "yes" to
      // some later question can never approve an older plan by accident.
      let waitingPlan = null;
      if (YES.test(message) || NO.test(message)) {
        const lastAssistant = [...history].reverse().find((m) => m.role === "assistant");
        waitingPlan = await latestPendingPlan(session).catch(() => null);
        // Permanent or high-risk plans need a clear "yes" / "confirm", not "ok" or "sure".
        const casual = /^(?:ok|okay|sure|sounds good)\b/i.test(message);
        if (
          waitingPlan &&
          lastAssistant &&
          !(casual && waitingPlan.risk === "high" && YES.test(message)) &&
          normalised(waitingPlan.reply) &&
          normalised(lastAssistant.content).startsWith(normalised(waitingPlan.reply).slice(0, 120))
        ) {
          const result = await resolvePlan(session, { pendingId: waitingPlan.id, decision: YES.test(message) ? "approve" : "cancel" });
          return respond(res, 200, result);
        }
      }

      const shortcut = fastPath(session, message);
      if (shortcut) {
        const result = await dispatchTool(session, shortcut.name, shortcut.args);
        if (!session.staged.length) {
          const problem = result.forModel || {};
          const candidates = session.ambiguity?.candidates || [];
          return respond(res, 200, {
            reply: candidates.length
              ? "More than one person matches \"" + session.ambiguity.query + "\" — who did you mean?"
              : problem.error || "I couldn't do that.",
            suggestions: candidates.length ? candidates : (problem.closestMatches || []).map((c) => c.replace(/ \(.*\)$/, "")),
            steps: session.steps,
            dataChanged: false,
          });
        }
        return respond(res, 200, await finalise(session, { modelText: "", message }));
      }

      if (!process.env.OPENAI_API_KEY)
        return res.status(503).json({
          reply: "McAssist is connected to your crew data, but the AI provider key is not configured yet.",
          error: "AI provider not configured",
        });

      const provider = createProvider({ fetchAPI, env: process.env, budgetMs, callTimeoutMs });
      const tools = await toolSchemasFor(session);
      const appContext = body.appContext && typeof body.appContext === "object" ? body.appContext : {};
      const messages = [
        { role: "system", content: systemPrompt(session) },
        {
          role: "user",
          content: contextMessage(session, {
            page: cleanText(appContext.page, 40),
            selectedModule: appContext.selectedModule || null,
            clientTime: cleanText(appContext.clientTime, 40),
            waitingPlan,
          }),
        },
        ...history,
        { role: "user", content: message },
      ];

      let modelText = null;
      let question = null;
      let suggestions = [];
      let providerError = null;
      let toolCalls = 0;
      let rounds = 0;
      for (let round = 0; round < maxRounds; round++) {
        rounds = round + 1;
        let answer;
        try {
          answer = await provider.complete({ messages, tools });
        } catch (error) {
          providerError = error;
          break;
        }
        const calls = (Array.isArray(answer.tool_calls) ? answer.tool_calls : []).filter((c) => c?.function?.name);
        if (!calls.length) {
          modelText = typeof answer.content === "string" ? answer.content : "";
          break;
        }
        messages.push({
          role: "assistant",
          content: typeof answer.content === "string" && answer.content ? answer.content : null,
          tool_calls: calls.map((c, i) => ({
            id: c.id || "call_" + round + "_" + i,
            type: "function",
            function: { name: c.function.name, arguments: c.function.arguments || "{}" },
          })),
        });
        let terminal = false;
        for (const [i, call] of calls.entries()) {
          const id = call.id || "call_" + round + "_" + i;
          if (terminal || toolCalls >= 40) {
            messages.push({ role: "tool", tool_call_id: id, content: JSON.stringify({ ok: false, skipped: true }) });
            continue;
          }
          toolCalls++;
          let args;
          try {
            args = JSON.parse(call.function.arguments || "{}") || {};
          } catch {
            messages.push({ role: "tool", tool_call_id: id, content: JSON.stringify({ ok: false, error: "The arguments were not valid JSON." }) });
            continue;
          }
          const result = await dispatchTool(session, call.function.name, args);
          if (result.terminal) {
            terminal = true;
            question = result.question;
            suggestions = result.suggestions || [];
          }
          messages.push({ role: "tool", tool_call_id: id, content: JSON.stringify(result.forModel ?? { ok: true }).slice(0, 24000) });
        }
        if (terminal || toolCalls >= 40) break;
      }

      // Out of tool rounds without a final answer: ask once more for a plain reply.
      if (modelText === null && !question && !providerError && rounds > 0) {
        try {
          const answer = await provider.complete({ messages, tools, toolChoice: "none" });
          modelText = typeof answer.content === "string" ? answer.content : "";
        } catch (error) {
          providerError = error;
        }
      }

      if (providerError && !session.staged.length && !question) {
        const status = providerError.status === 429 ? 429 : providerError.status === 504 ? 504 : 502;
        const reply =
          status === 429
            ? "McAssist has reached its current usage limit. Please try again in a moment."
            : status === 504
              ? "McAssist took too long to reply. Please try again."
              : "McAssist could not connect right now. Please try again shortly.";
        return respond(res, status, { reply, error: reply, steps: session.steps });
      }

      const out = await finalise(session, { modelText, question, suggestions, message });
      if (out.pending) delete out.uiAction;
      return respond(res, 200, out);
    } catch (error) {
      if (error?.status) return res.status(error.status).json({ reply: error.message, error: error.message });
      console.error("McAssist request failed", { name: error?.name, message: error?.message });
      return res.status(error?.name === "TimeoutError" ? 504 : 500).json({
        reply:
          error?.name === "TimeoutError"
            ? "McAssist took too long to reply. Please try again."
            : "Something went wrong while McAssist was working with the crew hub. Please try again.",
        error: "McAssist request failed",
      });
    }
  };
}

export default createHandler();
