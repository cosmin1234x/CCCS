export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        error: "Missing OPENAI_API_KEY",
        reply: "AI is not connected yet. Add OPENAI_API_KEY in Vercel Environment Variables, then redeploy."
      });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const message = String(body.message || "").trim();
    const session = body.session || {};
    const appContext = body.appContext || {};
    const history = Array.isArray(body.history) ? body.history.slice(-8) : [];

    if (!message) return res.status(400).json({ error: "Missing message" });
    if (message.length > 2000) return res.status(400).json({ error: "Message too long" });

    const systemPrompt = `You are McAssist, a friendly AI assistant inside a McTraining web app for restaurant crew and managers.

You help with:
- crew training and module guidance
- shift/rota questions
- McStars and rewards
- profile and team questions
- manager planning advice
- customer service practice
- food safety reminders at a general training level
- app navigation
- corporate pitch explanations

User role: ${session.role || "crew"}
User name: ${session.name || "User"}
Store ID: ${session.storeId || "store001"}
Current page: ${appContext.page || "unknown"}

Important permissions:
- Crew members can view shifts/training/rewards/profile, but cannot generate, create, delete or clear shifts.
- Managers and shift creators can generate/create/delete/clear shifts.
- If user asks to generate/create/delete/clear shifts, do not pretend you did it. Tell them the app command will handle it if allowed.
- Give short, useful answers. Use simple daily words.
- If the question is about official company policy, say to check the official manager/company guidance.
- Do not claim to be official McDonald's corporate.
- Do not provide legal/medical advice.`;

    const messages = [
      { role: "system", content: systemPrompt },
      ...history.map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: String(m.content || "").slice(0, 1200)
      })),
      { role: "user", content: message }
    ];

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        messages,
        temperature: 0.65,
        max_tokens: 450
      })
    });

    const data = await response.json();
    if (!response.ok) {
      console.error("OpenAI error", data);
      return res.status(response.status).json({
        error: data?.error?.message || "AI request failed",
        reply: "The AI connection had a problem. Check your Vercel OPENAI_API_KEY and billing/limits."
      });
    }

    const reply = data?.choices?.[0]?.message?.content?.trim() || "I’m not sure how to answer that yet.";
    return res.status(200).json({ reply });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error: "Server error",
      reply: "Something went wrong while talking to the AI. Try again in a moment."
    });
  }
}
