// api/mcassist.js
// McAssist serverless function – Vercel version

import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Explicit check so we don't silently 500 if the key is missing
  if (!process.env.OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY is not set on the server");
    return res
      .status(500)
      .json({ error: "OPENAI_API_KEY is not set on the server" });
  }

  try {
    let body = req.body || {};
    if (typeof body === "string") {
      body = JSON.parse(body || "{}");
    }

    const message = body.message;
    const user = body.user || {};
    const contextData = body.contextData || {};

    if (!message) {
      return res.status(400).json({ error: "Missing message" });
    }

    const role = contextData.role || user.role || "crew";
    const crewData = contextData.crewData || {};
    const managerData = contextData.managerData || {};

    // ====== DERIVED HELPERS ======
    const derived = {};

    const realShifts = Array.isArray(crewData.realShifts)
      ? crewData.realShifts
      : [];

    if (realShifts.length > 0) {
      const sorted = realShifts
        .slice()
        .sort((a, b) => {
          const keyA = (a.date || "") + "T" + (a.start || "");
          const keyB = (b.date || "") + "T" + (b.start || "");
          return keyA.localeCompare(keyB);
        });

      derived.realShiftsSummary = sorted.map((s) => ({
        date: s.date || "",
        start: s.start || "",
        end: s.end || "",
        station: s.station || "",
        isShiftManager: !!s.isShiftManager
      }));

      const now = new Date();
      const pad = (n) => (n < 10 ? "0" + n : "" + n);
      const nowKey =
        now.getFullYear() +
        "-" +
        pad(now.getMonth() + 1) +
        "-" +
        pad(now.getDate()) +
        "T" +
        pad(now.getHours()) +
        ":" +
        pad(now.getMinutes());

      let next = null;
      for (const s of sorted) {
        const key = (s.date || "") + "T" + (s.start || "00:00");
        if (key >= nowKey) {
          next = s;
          break;
        }
      }

      if (next) {
        derived.nextShift = {
          date: next.date || "",
          start: next.start || "",
          end: next.end || "",
          station: next.station || "",
          isShiftManager: !!next.isShiftManager
        };
      } else {
        const first = sorted[0];
        derived.nextShift = {
          date: first.date || "",
          start: first.start || "",
          end: first.end || "",
          station: first.station || "",
          isShiftManager: !!first.isShiftManager,
          note:
            "All shifts appear to be in the past; this is the earliest one."
        };
      }
    }

    if (
      Array.isArray(managerData.crewTrainingSummary) &&
      managerData.crewTrainingSummary.length > 0
    ) {
      const needsTraining = [];
      const topPerformers = [];

      managerData.crewTrainingSummary.forEach((c) => {
        const badge = (c.badge || "").toLowerCase();
        const status = (c.status || "").toLowerCase();
        const stars = typeof c.stars === "number" ? c.stars : 0;

        if (
          badge.includes("needs training") ||
          badge.includes("action needed") ||
          status.includes("not started") ||
          status.includes("expires")
        ) {
          needsTraining.push({
            name: c.name || "",
            status: c.status || "",
            badge: c.badge || "",
            stars
          });
        }

        if (
          stars >= 3 ||
          badge.includes("star performer") ||
          badge.includes("top")
        ) {
          topPerformers.push({
            name: c.name || "",
            status: c.status || "",
            badge: c.badge || "",
            stars
          });
        }
      });

      derived.training = { needsTraining, topPerformers };
    }

    // ====== SYSTEM PROMPT ======
    const systemPrompt = [
      "You are McAssist, a friendly assistant for a McDonald's-style restaurant portal.",
      "",
      "ALWAYS:",
      "- Be concise (2–5 short sentences).",
      "- Never invent data that is not present in the context JSON or derived helpers.",
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
      "  - realShifts: array of full shift objects from Firestore",
      "  - trainingTodo: list of modules the crew member needs",
      "- managerData: for managers / shiftCreators. May include:",
      "  - storeName, todaySales, weekSales, todayWasteValue, todayWastePct",
      "  - staffOnShift, staffNeeded, trainingGaps, potentialOvertime",
      "  - foodWasteByDay, crewTrainingSummary, dayBriefing",
      "",
      "You also get a 'derived' object from the server containing:",
      "- realShiftsSummary, nextShift, training.needsTraining, training.topPerformers.",
      "",
      "Answer using these rules and never show raw JSON."
    ].join("\n");

    const userContent =
      "User message:\n" +
      JSON.stringify(message) +
      "\n\ncontextData:\n" +
      JSON.stringify(contextData, null, 2) +
      "\n\nderived helpers:\n" +
      JSON.stringify(derived, null, 2);

    const completion = await client.chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: 0.2,
      max_tokens: 350,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent }
      ]
    });

    const reply =
      completion?.choices?.[0]?.message?.content?.trim() ||
      "Sorry, I couldn't think of a good answer.";

    return res.status(200).json({ reply });
  } catch (err) {
    console.error("McAssist error:", err);
    // send message back so you can see it in the browser Network tab
    return res
      .status(500)
      .json({ error: "Server error", detail: String(err.message || err) });
  }
}
