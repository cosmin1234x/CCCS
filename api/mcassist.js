/**
 * api/mcassist.js — Vercel Serverless Function
 * Uses fetch() to call OpenAI (no SDK required)
 */

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    if (!body || !body.message) {
      return res.status(400).json({ error: "Missing message" });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error("Missing OPENAI_API_KEY");
      return res.status(500).json({ error: "Missing API key" });
    }

    // Build prompt (you can add your system prompt, derived data, etc.)
    const systemPrompt = "You are McAssist, a helpful assistant for McDonald's crew and managers.";

    const openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        temperature: 0.2,
        max_tokens: 350,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: JSON.stringify(body) }
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
      result?.choices?.[0]?.message?.content?.trim() ||
      "Sorry, I couldn't generate a response.";

    return res.status(200).json({ reply });

  } catch (err) {
    console.error("McAssist Runtime Error:", err);
    return res.status(500).json({ error: "Server error", details: err.toString() });
  }
}
