// api/mcassist.js
// McAssist serverless function – Vercel Node.js (no openai npm package)
// Calls OpenAI's HTTP API directly with fetch.

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error("Missing OPENAI_API_KEY env var");
      return res.status(500).json({ error: "Missing OPENAI_API_KEY" });
    }

    // Body parsing (Vercel usually gives parsed JSON already)
    let body = req.body || {};
    if (typeof body === "string") {
      try {
        body = JSON.parse(body || "{}");
      } catch {
        body = {};
      }
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

    // ==========================
    // DERIVED HELPERS
    // ==========================
    const derived = {};

    // ---- Real shifts for this crew member ----
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

    // ---- Manager / shiftCreator training helpers ----
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

      derived.training = {
        needsTraining,
        topPerformers
      };
    }

    // ==========================
    // SYSTEM PROMPT
    // ==========================
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
      "  - schedule: array of { day, time, station? } for the next 7 days (simple view)",
      "  - realShifts: array of full shift objects from Firestore with date, start, end, station, isShiftManager, etc.",
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
      "You also get a 'derived' object from the server containing:",
      "- realShiftsSummary: realShifts cleaned and sorted.",
      "- nextShift: the next upcoming shift for this crew member, if any.",
      "- training.needsTraining: list of crew who need training (manager only).",
      "- training.topPerformers: list of top McStars (manager only).",
      "",
      "HOW TO ANSWER:",
      "",
      "1) Crew user asking about THEIR OWN shifts:",
      "- FIRST use derived.nextShift or derived.realShiftsSummary if available.",
      "- For questions like 'When am I working next?', answer using derived.nextShift.",
      "- For questions like 'What time do I work on Saturday?', look in realShiftsSummary for any shift where the date matches Saturday, or use schedule if only day names exist.",
      "- If both realShifts and schedule are missing, say you can't see their shifts and ask them to open the Shifts page.",
      "",
      "2) Manager/shiftCreator asking about shifts of OTHER people:",
      "- You do NOT have full per-crew shift data for everyone (only the logged-in user may have realShifts).",
      "- If asked 'When is Alex working?' or 'Who is on shift tonight?':",
      "  * Explain you can't see individual shift assignments here.",
      "  * Tell them to open the Shifts page in the portal for full details.",
      "",
      "3) Hours and pay (crew):",
      "- Use crewData.hoursThisWeek, estimatedPayThisWeek, hourlyRate.",
      "- Example style: 'You're scheduled for 18.5 hours and will earn about £194.25 before tax at your current rate.'",
      "",
      "4) Training status (crew):",
      "- Use crewData.trainingTodo to list the most important modules they still need.",
      "",
      "5) Training / McStars (manager/shiftCreator):",
      "- Use derived.training.needsTraining and derived.training.topPerformers when present.",
      "- 'Who needs training?' → summarise names in needsTraining.",
      "- 'Who are my top performers?' → summarise names in topPerformers.",
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
      "\n\ncontextData:\n" +
      JSON.stringify(contextData, null, 2) +
      "\n\nderived helpers:\n" +
      JSON.stringify(derived, null, 2);

    // ==========================
    // CALL OPENAI VIA HTTP
    // ==========================
    const oaRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        temperature: 0.2,
        max_tokens: 350,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent }
        ]
      })
    });

    const oaData = await oaRes.json().catch(() => ({}));

    if (!oaRes.ok) {
      console.error("OpenAI error", oaRes.status, oaData);
      return res.status(500).json({
        error: "OpenAI API error",
        status: oaRes.status,
        details: oaData
      });
    }

    const reply =
      oaData.choices &&
      oaData.choices[0] &&
      oaData.choices[0].message &&
      oaData.choices[0].message.content
        ? oaData.choices[0].message.content.trim()
        : "Sorry, I couldn't think of a good answer.";

    return res.status(200).json({ reply });
  } catch (err) {
    console.error("McAssist error:", err);
    return res.status(500).json({
      error: "Server error",
      message: err.message || "Unknown error"
    });
  }
};
