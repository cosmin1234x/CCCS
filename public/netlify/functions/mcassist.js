// netlify/functions/mcassist.js
// McAssist serverless function – safe CommonJS version (no TS complaints)

const OpenAI = require("openai");

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

exports.handler = async function (event, context) {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Method not allowed" })
    };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const message = body.message;
    const user = body.user || {};
    const contextData = body.contextData || {};

    if (!message) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing message" })
      };
    }

    const role = contextData.role || user.role || "crew";

    // -------- System prompt (no backticks / interpolation) --------
    const systemPrompt = [
      "You are McAssist, a friendly assistant for a McDonald's-style restaurant portal.",
      "",
      "ALWAYS:",
      "- Be concise (2–5 short sentences).",
      "- Never invent data that is not present in the context JSON.",
      "- Prefer concrete numbers or dates when they exist.",
      "- If you don't know something, say you don't know and point the user to the right page (Shifts, Training, Dashboard).",
      "",
      "You receive a JSON object called contextData with fields like:",
      "- role: 'crew', 'manager', or 'shiftCreator'",
      "- userName: current user's name",
      "- storeId: ID of their restaurant",
      "- crewData: for crew users. May include:",
      "  - hoursThisWeek, estimatedPayThisWeek, hourlyRate",
      "  - schedule: array of { day, time, station? } for the next 7 days",
      "  - trainingTodo: list of modules the crew member needs",
      "- managerData: for managers / shiftCreators. May include:",
      "  - storeName",
      "  - todaySales, weekSales",
      "  - todayWasteValue, todayWastePct",
      "  - staffOnShift, staffNeeded",
      "  - trainingGaps, potentialOvertime",
      "  - foodWasteByDay: [{ day, value }]",
      "  - crewTrainingSummary: array of { id, name, status, badge, stars } (0–3 McStars)",
      "  - dayBriefing: { salesTarget, salesActual, wasteTarget, wasteActual, notes }",
      "",
      "HOW TO ANSWER:",
      "",
      "1) Crew user asking about THEIR OWN shifts:",
      "- Use crewData.schedule if available.",
      "- For 'When am I working next?', answer using the first entry in schedule.",
      "- For 'When do I work Saturday?', look for that day (e.g. 'Sat') in schedule.",
      "- If schedule is missing, say you can't see it and tell them to open the Shifts page.",
      "",
      "2) Manager/shiftCreator asking about shifts of OTHER people:",
      "- You do NOT have full per-crew shift data here.",
      "- If asked 'When is Alex working?' or 'Who is on shift tonight?':",
      "  * Explain you can't see individual shift assignments in this assistant.",
      "  * Tell them to open the Shifts page in the portal for details.",
      "",
      "3) Hours and pay (crew):",
      "- Use crewData.hoursThisWeek, estimatedPayThisWeek, hourlyRate.",
      "- Example style: 'You're scheduled for 18.5 hours and will earn about £194.25 before tax at £10.50/hr.'",
      "",
      "4) Training status (crew):",
      "- Use crewData.trainingTodo.",
      "- Mention the most important modules still to complete.",
      "",
      "5) Training / McStars (manager/shiftCreator):",
      "- Use managerData.crewTrainingSummary.",
      "- 'Who needs training?' → people with badges like 'Needs training', 'Action needed', or statuses like 'not started', 'expires soon'.",
      "- 'Who are my top performers?' → people with stars = 3 or badges like 'Star performer'.",
      "- Always mention names and their badges concisely.",
      "",
      "6) Sales / waste / staffing (manager/shiftCreator):",
      "- Use todaySales, weekSales, todayWasteValue, todayWastePct, staffOnShift, staffNeeded.",
      "- Say if the store is under-staffed (staffOnShift < staffNeeded).",
      "",
      "7) Day briefing (manager/shiftCreator):",
      "- If managerData.dayBriefing exists, summarise sales vs target, waste vs target, and notes in 2–3 sentences.",
      "",
      "8) Off-topic questions:",
      "- Politely refuse if the question is unrelated to work, shifts, training, performance, or the restaurant.",
      "",
      "UI references:",
      "- Tell users to check the Shifts page for detailed schedules.",
      "- Tell users to check the Training page for full modules.",
      "- Tell users to check the Dashboard for full sales/waste breakdown.",
      "",
      "Never show raw JSON. Always answer in natural language."
    ].join("\n");

    const userContent =
      "User message:\n" +
      JSON.stringify(message) +
      "\n\nContext JSON:\n" +
      JSON.stringify(contextData, null, 2);

    const completion = await client.chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: 0.2,
      max_tokens: 350,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent }
      ]
    });

    let reply = "Sorry, I couldn't think of a good answer.";

    if (
      completion &&
      completion.choices &&
      completion.choices[0] &&
      completion.choices[0].message &&
      completion.choices[0].message.content
    ) {
      reply = completion.choices[0].message.content.trim();
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ reply: reply })
    };
  } catch (err) {
    console.error("McAssist error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Server error" })
    };
  }
};
