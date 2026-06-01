/**
 * api/mcassist.js — Vercel Serverless Function
 *
 * McAssist chat backend.
 * Also handles manager commands like:
 * "replace team rota for this week 6am-11pm"
 */

import admin from "firebase-admin";

let cachedDb = null;

function parseServiceAccount(raw) {
  if (!raw) return null;

  let text = String(raw).trim();

  // Allows base64 service account JSON as well as normal JSON.
  if (!text.startsWith("{")) {
    try {
      text = Buffer.from(text, "base64").toString("utf8");
    } catch {}
  }

  const account = JSON.parse(text);

  if (account.private_key) {
    account.private_key = String(account.private_key).replace(/\\n/g, "\n");
  }

  return account;
}

function getAdminDb() {
  if (cachedDb) return cachedDb;

  if (!admin.apps.length) {
    const rawServiceAccount =
      process.env.FIREBASE_SERVICE_ACCOUNT_KEY ||
      process.env.FIREBASE_SERVICE_ACCOUNT ||
      process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
      process.env.FIREBASE_ADMIN_JSON;

    const projectId =
      process.env.FIREBASE_PROJECT_ID ||
      process.env.GCLOUD_PROJECT ||
      process.env.GOOGLE_CLOUD_PROJECT;

    if (rawServiceAccount) {
      const serviceAccount = parseServiceAccount(rawServiceAccount);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: serviceAccount.project_id || projectId
      });
    } else if (projectId) {
      admin.initializeApp({
        credential: admin.credential.applicationDefault(),
        projectId
      });
    } else {
      throw new Error(
        "Firebase Admin is not configured. Add FIREBASE_SERVICE_ACCOUNT_KEY in Vercel environment variables."
      );
    }
  }

  cachedDb = admin.firestore();
  return cachedDb;
}

const dayKeys = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const stationNames = [
  "Front Counter",
  "Kitchen",
  "Drive-Thru",
  "Fries",
  "Line",
  "Grill",
  "Lobby",
  "Floater"
];

function toISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getMonday(baseDate = new Date()) {
  const d = new Date(baseDate);
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getWeekDays(offsetWeeks = 0) {
  const monday = getMonday(new Date());
  monday.setDate(monday.getDate() + offsetWeeks * 7);

  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    days.push(d);
  }
  return days;
}

function normaliseTime(hour, minute = 0, meridiem = "") {
  let h = Number(hour);
  const m = Number(minute || 0);
  const ampm = String(meridiem || "").toLowerCase();

  if (ampm === "pm" && h < 12) h += 12;
  if (ampm === "am" && h === 12) h = 0;

  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function timeToMinutes(hhmm) {
  const [h, m] = String(hhmm || "00:00").split(":").map((n) => Number(n) || 0);
  return h * 60 + m;
}

function minutesToTime(total) {
  const mins = Math.max(0, Math.min(24 * 60 - 1, Math.round(total)));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function parseTimeRange(message) {
  const text = String(message || "").toLowerCase();

  const match = text.match(
    /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|–|to|until|till)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/
  );

  if (!match) {
    return { start: "06:00", end: "23:00" };
  }

  let [, h1, m1, ap1, h2, m2, ap2] = match;

  // If user says 6-11pm, treat it as 6am-11pm for rota commands.
  if (!ap1 && ap2 === "pm" && Number(h1) < Number(h2)) ap1 = "am";

  return {
    start: normaliseTime(h1, m1, ap1),
    end: normaliseTime(h2, m2, ap2)
  };
}

function parseWeekOffset(message) {
  const text = String(message || "").toLowerCase();
  if (text.includes("next week")) return 1;
  return 0;
}

function isTeamRotaCommand(message) {
  const text = String(message || "").toLowerCase();

  const mentionsRota =
    text.includes("rota") ||
    text.includes("schedule") ||
    text.includes("shifts") ||
    text.includes("shift");

  const wantsReplaceOrCreate =
    text.includes("replace") ||
    text.includes("redo") ||
    text.includes("rebuild") ||
    text.includes("generate") ||
    text.includes("create") ||
    text.includes("make");

  const mentionsTeam =
    text.includes("team") ||
    text.includes("everyone") ||
    text.includes("crew") ||
    text.includes("staff");

  return mentionsRota && wantsReplaceOrCreate && mentionsTeam;
}

function buildShiftTemplates(startHHMM, endHHMM, peopleCount, staffNeeded) {
  const start = timeToMinutes(startHHMM);
  let end = timeToMinutes(endHHMM);
  if (end <= start) end += 24 * 60;

  const windowMinutes = end - start;
  const targetCount = Math.min(
    peopleCount,
    Math.max(2, Math.min(6, Number(staffNeeded) || 4))
  );

  if (targetCount <= 1) {
    return [{ start: startHHMM, end: endHHMM }];
  }

  const shiftLength = Math.min(8 * 60, Math.max(4 * 60, Math.ceil(windowMinutes / 2)));
  const latestStart = end - shiftLength;
  const step = targetCount === 1 ? 0 : (latestStart - start) / (targetCount - 1);

  const templates = [];
  for (let i = 0; i < targetCount; i++) {
    const s = Math.round(start + step * i);
    const e = Math.min(s + shiftLength, end);

    templates.push({
      start: minutesToTime(s % (24 * 60)),
      end: minutesToTime(e % (24 * 60))
    });
  }

  return templates;
}

async function deleteWeekShifts(db, storeId, weekStartISO, weekEndISO) {
  const shiftsRef = db.collection("stores").doc(storeId).collection("Shifts");

  const snap = await shiftsRef
    .where("date", ">=", weekStartISO)
    .where("date", "<=", weekEndISO)
    .get();

  let deleted = 0;
  let batch = db.batch();
  let ops = 0;

  for (const docSnap of snap.docs) {
    batch.delete(docSnap.ref);
    deleted += 1;
    ops += 1;

    if (ops >= 450) {
      await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  }

  if (ops > 0) await batch.commit();
  return deleted;
}

async function loadCrewForStore(db, storeId, context) {
  const usersSnap = await db.collection("users").where("storeId", "==", storeId).get();
  const crew = [];

  usersSnap.forEach((docSnap) => {
    const u = docSnap.data() || {};
    const role = String(u.role || "crew").toLowerCase();

    if (role === "manager" || role === "shiftcreator" || role === "admin") return;

    crew.push({
      id: docSnap.id,
      name: u.name || u.email || "Crew",
      role: u.role || "crew"
    });
  });

  if (crew.length) {
    return crew.sort((a, b) => a.name.localeCompare(b.name));
  }

  // Fallback if Firestore query has no users but the page sent manager context.
  const summary = context?.managerData?.crewTrainingSummary;
  if (Array.isArray(summary)) {
    return summary
      .filter((c) => c.id && c.name)
      .map((c) => ({ id: c.id, name: c.name, role: "crew" }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  return [];
}

async function publishTeamRota({ db, storeId, user, context, message }) {
  const weekOffset = parseWeekOffset(message);
  const weekDays = getWeekDays(weekOffset);
  const weekStartISO = toISO(weekDays[0]);
  const weekEndISO = toISO(weekDays[6]);
  const { start, end } = parseTimeRange(message);

  const crew = await loadCrewForStore(db, storeId, context);

  if (crew.length < 2) {
    return {
      reply:
        crew.length === 1
          ? `I found only 1 crew member in this store, so I can’t build a team rota yet. Add more crew users first, then try again.`
          : `I couldn’t find any crew users for this store yet. Add crew users first, then try again.`
    };
  }

  const deleted = await deleteWeekShifts(db, storeId, weekStartISO, weekEndISO);

  const staffNeeded = context?.managerData?.staffNeeded || 4;
  const templates = buildShiftTemplates(start, end, crew.length, staffNeeded);
  const shiftsRef = db.collection("stores").doc(storeId).collection("Shifts");

  let created = 0;
  let pointer = 0;
  let batch = db.batch();
  let ops = 0;

  for (let dayIndex = 0; dayIndex < weekDays.length; dayIndex++) {
    const dateISO = toISO(weekDays[dayIndex]);
    const dayKey = dayKeys[weekDays[dayIndex].getDay()];

    for (let slotIndex = 0; slotIndex < templates.length; slotIndex++) {
      const person = crew[pointer % crew.length];
      pointer += 1;

      const ref = shiftsRef.doc();
      batch.set(ref, {
        date: dateISO,
        dayKey,
        start: templates[slotIndex].start,
        end: templates[slotIndex].end,
        userId: person.id,
        userName: person.name,
        role: person.role || "crew",
        station: stationNames[slotIndex % stationNames.length],
        isShiftManager: false,
        generatedByAI: true,
        source: "mcassist-team-rota",
        demandLevel: "normal",
        createdBy: user?.id || user?.uid || "mcassist",
        createdAt: Date.now()
      });

      created += 1;
      ops += 1;

      if (ops >= 450) {
        await batch.commit();
        batch = db.batch();
        ops = 0;
      }
    }
  }

  if (ops > 0) await batch.commit();

  const uniquePeople = new Set(
    Array.from({ length: created }, (_, i) => crew[i % crew.length]?.id).filter(Boolean)
  ).size;

  return {
    reply:
      `Done ✅ I replaced the ${weekOffset === 1 ? "next week" : "this week"} team rota ` +
      `from ${start}–${end}. I deleted ${deleted} old shift(s) and created ${created} new shift(s) ` +
      `across ${Math.min(uniquePeople, crew.length)} people.`
  };
}

async function tryHandleRotaCommand({ message, user, context }) {
  if (!isTeamRotaCommand(message)) return null;

  const role = String(user?.role || context?.role || "").toLowerCase();
  const canManage = role === "manager" || role === "shiftcreator" || role === "admin";

  if (!canManage) {
    return { reply: "Only a manager or shift creator can replace the team rota." };
  }

  const storeId = user?.storeId || context?.storeId || "store001";

  try {
    const db = getAdminDb();
    return await publishTeamRota({ db, storeId, user, context, message });
  } catch (err) {
    console.error("Team rota command failed:", err);
    return {
      reply:
        "I understood the rota command, but I couldn’t write it to Firestore. " +
        "Check Vercel env has FIREBASE_SERVICE_ACCOUNT_KEY set, then redeploy."
    };
  }
}

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

    const user = body?.user || {};
    const context = body?.contextData || {};

    const rotaResult = await tryHandleRotaCommand({ message, user, context });
    if (rotaResult) {
      return res.status(200).json(rotaResult);
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error("Missing OPENAI_API_KEY");
      return res.status(500).json({ error: "Missing API key" });
    }

    const selectedModule = context?.selectedModule || null;
    const allModules = Array.isArray(context?.allModules) ? context.allModules : [];

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

    const systemPrompt = `
You are **McAssist**, a friendly, fast McDonald's **UK** crew & manager assistant.

STYLE:
- Sound like a practical McDonald's UK helper: short, clear steps, calm tone.
- Use UK wording (e.g., queue, till, chips, takeaway, bins) when relevant.
- Use "store process/SOP" language, not American corporate tone.

GROUNDING RULES (VERY IMPORTANT):
1) If the user asks for exact build steps/recipes/procedures:
   - ONLY provide exact, step-by-step instructions if those specifics appear in SELECTED_MODULE content or explicitly provided context.
   - If not present, DO NOT guess or invent. Say you don't have their UK store's exact spec in your modules yet.

2) For general questions:
   - Answer normally, but prefer the module content when available.

3) If the user asks for a quiz:
   - Create a short quiz (5 questions max) using ONLY the module content if SELECTED_MODULE is available.
   - If no module is selected, ask which module, then provide a short quiz template.

4) If the user asks to "open" a module:
   - Respond with the best matching module name from MODULE_INDEX and say "Opening it now".

OUTPUT:
- Respond with a single message to the user, no JSON, no tool calls.

CONTEXT:
User role: ${user?.role || "unknown"}
User name: ${user?.name || "User"}
StoreId: ${user?.storeId || "unknown"}

${moduleContextText}

${moduleIndexText}
`.trim();

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
