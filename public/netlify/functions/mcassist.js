// netlify/functions/mcassist.js

// Netlify function entrypoint
export async function handler(event, context) {
  // Only allow POST
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Method not allowed" })
    };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const { message, user, contextData } = body;

    if (!message) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing 'message' in request body" })
      };
    }

    // Build a system prompt so the model behaves like McAssist
    const systemPrompt = `
You are McAssist, an AI assistant for a McDonald's restaurant training and operations portal.

- If the user is CREW: focus on explaining hours, estimated pay, training modules, next shifts, and achievements in simple language.
- If the user is MANAGER: focus on sales, food waste, staffing, crew training gaps, and store performance.
- Never invent money numbers or hours that contradict the provided contextData – use the values given.
- If something isn't in the contextData, give general guidance but say it's an estimate or example.
- Keep answers short, friendly, and practical.
    `.trim();

    // Include context (hours, pay, sales, etc.) so AI can refer to it
    const contextText = contextData
      ? JSON.stringify(contextData, null, 2)
      : "{}";

    const userInfoText = user
      ? `User name: ${user.name || "Unknown"}
Role: ${user.role || "unknown"}
Store: ${user.storeId || "unknown"}`
      : "User info unknown";

    // Call OpenAI Chat Completions API
    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // ⚠️ You must set OPENAI_API_KEY in Netlify env vars
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini", // good cheap general model :contentReference[oaicite:0]{index=0}
        temperature: 0.3,
        max_tokens: 300,
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `
${userInfoText}

Relevant app data (JSON):
${contextText}

User question:
${message}
            `.trim()
          }
        ]
      })
    });

    if (!openaiRes.ok) {
      const errText = await openaiRes.text();
      console.error("OpenAI error:", errText);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "OpenAI request failed" })
      };
    }

    const data = await openaiRes.json();
    const reply =
      data.choices?.[0]?.message?.content ||
      "Sorry, I couldn't generate a response.";

    return {
      statusCode: 200,
      body: JSON.stringify({ reply })
    };
  } catch (err) {
    console.error("mcassist function error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Internal server error" })
    };
  }
}
