/**
 * api/mcassist.js — Vercel Serverless Function (UPGRADED)
 *
 * Goals:
 * ✅ Sound like a McDonald's UK crew assistant (tone + terms)
 * ✅ Prefer answers grounded in provided training modules/context
 * ✅ Avoid US-specific recipe/build details unless provided by modules
 * ✅ If info isn't in modules/context, respond with safe, store-agnostic guidance
 * ✅ Support quiz requests + "open module" intents (client handles open; server helps content)
 */

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    const message = body?.message?.trim?.();
    if (!message) {
      return res.status(400).json({ error: "Missing message" });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error("Missing OPENAI_API_KEY");
      return res.status(500).json({ error: "Missing API key" });
    }

    // Pull structured context (from main.js / training.js)
    const user = body?.user || {};
    const context = body?.contextData || {};

    // Helpful extracted fields for the model
    const selectedModule = context?.selectedModule || null;
    const allModules = Array.isArray(context?.allModules) ? context.allModules : [];

    // If training page sends module content, we want the model to use it.
    const moduleContextText = selectedModule
      ? `
SELECTED_MODULE:
- id: ${selectedModule.id}
- title: ${selectedModule.title}
- tag: ${selectedModule.tag}
- summary: ${selectedModule.summary || ""}
- steps: ${JSON.stringify(selectedModule.steps || [])}
- checklist: ${JSON.stringify(selectedModule.checklist || [])}
- doDont: ${JSON.stringify(selectedModule.doDont || {})}
- scenario: ${JSON.stringify(selectedModule.scenario || null)}
`
      : "SELECTED_MODULE: none";

    const moduleIndexText =
      allModules.length > 0
        ? `MODULE_INDEX (available modules): ${JSON.stringify(allModules)}`
        : "MODULE_INDEX: none";

    /**
     * System prompt: enforce "UK McDonald's assistant" behaviour.
     * Key rules:
     * - If question is about a specific build/recipe/process that might differ by country/store:
     *   -> ONLY answer with exact steps if present in modules/context.
     *   -> Otherwise, say you don't have the exact UK store spec and suggest opening the module or checking in-store SOP.
     */
    const systemPrompt = `
You are **McAssist**, a friendly, fast McDonald's **UK** crew & manager assistant.

STYLE:
- Sound like a practical McDonald's UK helper: short, clear steps, calm tone.
- Use UK wording (e.g., queue, till, chips, takeaway, bins) when relevant.
- Use "store process/SOP" language, not American corporate tone.

GROUNDING RULES (VERY IMPORTANT):
1) If the user asks for exact build steps/recipes/procedures (e.g., "How do I build a Big Mac?", "exact sauce amount", "exact temps/timers"):
   - ONLY provide exact, step-by-step instructions if those specifics appear in SELECTED_MODULE content or explicitly provided context.
   - If not present, DO NOT guess or invent. Say you don't have their UK store's exact spec in your modules yet and offer:
     a) ask them to open the relevant module, or
     b) give high-level, non-specific guidance (quality/safety/sequence principles), or
     c) advise checking the in-store build chart/SOP.

2) For general questions (customer recovery, hygiene principles, teamwork, shift tips):
   - You can answer normally, but still prefer the module content when available.

3) If the user asks for a quiz:
   - Create a short quiz (5 questions max) using ONLY the module content if SELECTED_MODULE is available.
   - If no module is selected, ask which module, then provide a short quiz template.

4) If the user asks to "open" a module:
   - You can respond with the best matching module name from MODULE_INDEX and say "Opening it now" (the client will actually open it).

OUTPUT:
- Respond with a single message to the user, no JSON, no tool calls.
- If you are unsure or missing UK-specific store specs: be honest and offer the next best action.

CONTEXT:
User role: ${user?.role || "unknown"}
User name: ${user?.name || "User"}
StoreId: ${user?.storeId || "unknown"}

${moduleContextText}

${moduleIndexText}
`.trim();

    // The user message we send: include their raw message, and include useful contextData too.
    // Keep it structured but readable.
    const userPrompt = `
USER_MESSAGE:
${message}

CONTEXT_DATA (raw):
${JSON.stringify(context)}
`.trim();

    const openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        temperature: 0.2,
        max_tokens: 450,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ]
      })
    });

    if (!openaiResponse.ok) {
      const errText = await openaiResponse.text();
      console.error("OpenAI error:", errText);
      return res.status(500).json({ error: "OpenAI API error", details: errText });
    }

    const result = await openaiResponse.json();
    const reply =
      result?.choices?.[0]?.message?.content?.trim?.() ||
      "Sorry — I couldn't generate a response.";

    return res.status(200).json({ reply });
  } catch (err) {
    console.error("McAssist Runtime Error:", err);
    return res.status(500).json({ error: "Server error", details: err?.toString?.() || String(err) });
  }
}
