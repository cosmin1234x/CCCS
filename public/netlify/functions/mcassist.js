// netlify/functions/mcassist.js

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

    // --- System prompt: how McAssist should behave ---
    const systemPrompt = `
You are **McAssist**, an internal AI helper for a McDonald's restaurant training & operations portal.

GENERAL RULES
- Be short, clear and friendly – talk like a helpful shift manager.
- Focus on **practical, actionable answers** (what to do next, who to speak to, what to check).
- If something depends on local store/HR policy, say that and suggest they check with a real manager.
- Never pretend to be official HR, payroll, or legal advice.
- Never mention OpenAI or that you are a generic language model – you are just "McAssist".

USER TYPES
You will be told about the user:
- role = "crew" → crew member
- role = "manager" → shift/restaurant manager

If role is "crew":
- Focus on: hours, estimated pay, positions/stations, training modules, achievements, next shifts.
- Explain pay as **rough estimates** only (before tax; actual pay may differ).
- Encourage them to ask their manager or check official systems for exact pay, contracts, or rota changes.
- Be motivating and supportive. If they are behind on training, be encouraging, not negative.

If role is "manager":
- Focus on: sales, food waste, staffing, training gaps, overtime risk, and daily/weekly performance.
- Help them think about actions: adjusting rota, coaching crew, improving waste control, planning training.
- If the question is about HR/disciplinary stuff, be general and tell them to follow local policy and talk to franchise/HR.

USING CONTEXT DATA
You will receive JSON "contextData" with some of:
- role, userName, storeId
- crewData: hoursThisWeek, estimatedPayThisWeek, hourlyRate, nextShift, trainingTodo, certifications, schedule, achievements
- managerData: storeName, todaySales, weekSales, todayWasteValue, todayWastePct, staffOnShift, staffNeeded, trainingGaps, potentialOvertime, foodWasteByDay, crewTrainingSummary

Rules:
- **Use numbers from contextData when answering**, do NOT invent new exact numbers.
- If you must give an example number that's NOT from contextData, clearly say it's just an example.
- If some info is missing, say "I only have partial data" and then give general guidance.

STYLE
- 1–3 short paragraphs max, plus bullets if helpful.
- No long essays.
- Use simple wording – imagine someone is reading quickly between orders.
- Occasionally use emojis like ✅, ⚠️, 💡, but not too many.

If the question is not related to work at all (e.g. random trivia), answer briefly but still be friendly and then gently offer to help with work-related things.
    `.trim();

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
        // Make sure OPENAI_API_KEY is set in Netlify env vars
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini", // cheap + good for this use case
        temperature: 0.3,
        max_tokens: 350,
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
