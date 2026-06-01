/**
 * api/mcassist.js — Vercel Serverless Function
 *
 * McAssist chat backend.
 * Handles real manager rota commands BEFORE OpenAI so the bot does not fake shift creation.
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

function getRequestedDays(message) {
  const text = String(message || "").toLowerCase();
  const weekOffset = text.includes("next week") ? 1 : 0;

  if (text.includes("today")) {
    return [new Date()];
  }

  if (text.includes("tomorrow")) {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return [d];
  }

  return getWeekDays(weekOffset);
}

function getRangeLabel(days, message) {
  const text = String(message || "").toLowerCase();
  if (text.includes("today")) return "today";
  if (text.includes("tomorrow")) return "tomorrow";
  return text.includes("next week") ? "next week" : "this week";
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

function extractRequestedStaffCount(message, fallback) {
  const text = String(message || "").toLowerCase();
  const match = text.match(/(?:with|use|for|need|staff)\s*(\d{1,2})\s*(?:people|person|crew|staff|workers|members)?/);
  if (match) return Math.max(1, Math.min(20, Number(match[1]) || fallback));
  return fallback;
}

function isManagerLike(user, context) {
  const role = String(user?.role || context?.role || "").toLowerCase();
  return role === "manager" || role === "shiftcreator" || role === "admin";
}

function isHelpCommand(message) {
  const text = String(message || "").toLowerCase();
  return (
    (text.includes("command") || text.includes("what can you do") || text.includes("help")) &&
    (text.includes("rota") || text.includes("shift") || text.includes("schedule") || text.includes("manager"))
  );
}

function isDeleteShiftCommand(message) {
  const text = String(message || "").toLowerCase();

  const deleteWords =
    text.includes("delete") ||
    text.includes("remove") ||
    text.includes("clear") ||
    text.includes("wipe");

  const shiftWords =
    text.includes("shift") ||
    text.includes("shifts") ||
    text.includes("rota") ||
    text.includes("schedule");

  return deleteWords && shiftWords;
}

function isRotaWriteCommand(message) {
  const text = String(message || "").toLowerCase();

  const rotaWords =
    text.includes("rota") ||
    text.includes("schedule") ||
    text.includes("shifts") ||
    text.includes("shift") ||
    text.includes("staffing");

  const actionWords =
    text.includes("replace") ||
    text.includes("redo") ||
    text.includes("rebuild") ||
    text.includes("generate") ||
    text.includes("create") ||
    text.includes("make") ||
    text.includes("plan") ||
    text.includes("fill");

  // The time range makes commands like "team rota this week 6am-11pm" count too.
  const hasTimeRange = /\d{1,2}\s*(am|pm)?\s*(?:-|–|to|until|till)\s*\d{1,2}/.test(text);

  return rotaWords && (actionWords || hasTimeRange);
}

function shouldReplaceBeforeCreate(message) {
  const text = String(message || "").toLowerCase();
  if (text.includes("add") || text.includes("extra")) return false;
  return true;
}

function commandHelpReply() {
  return {
    reply:
      "Manager rota commands I can run now:\n\n" +
      "• replace team rota for this week 6am-11pm\n" +
      "• replace team rota for next week 6am-11pm\n" +
      "• create team rota this week 7am-10pm with 5 people\n" +
      "• add extra shifts today 12pm-8pm\n" +
      "• delete all shifts for this week\n" +
      "• delete all shifts for next week\n" +
      "• delete today’s shifts\n\n" +
      "Tip: use “replace” when you want the old rota removed first. Use “add extra shifts” when you want to keep existing shifts."
  };
}

function buildShiftTemplates(startHHMM, endHHMM, peopleCount, staffNeeded) {
  const start = timeToMinutes(startHHMM);
  let end = timeToMinutes(endHHMM);
  if (end <= start) end += 24 * 60;

  const windowMinutes = end - start;
  const targetCount = Math.min(
    peopleCount,
    Math.max(2, Math.min(8, Number(staffNeeded) || 4))
  );

  if (targetCount <= 1) {
    return [{ start: startHHMM, end: endHHMM }];
  }

  // Stagger shifts across the full opening window. A 06:00–23:00 rota becomes multiple overlapping shifts,
  // not one person stuck on a 17-hour shift.
  const shiftLength = Math.min(8 * 60, Math.max(4 * 60, Math.ceil(windowMinutes / 2)));
  const latestStart = Math.max(start, end - shiftLength);
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

async function deleteShiftsForDays(db, storeId, days) {
  const shiftsRef = db.collection("stores").doc(storeId).collection("Shifts");
  const dates = days.map(toISO);

  let deleted = 0;
  let batch = db.batch();
  let ops = 0;

  // Firestore "in" supports up to 30 values, and we only use max 7 here.
  const snap = await shiftsRef.where("date", "in", dates).get();

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

  // Fallback if the server cannot see users but the dashboard sent crew names.
  const summary = context?.managerData?.crewTrainingSummary;
  if (Array.isArray(summary)) {
    return summary
      .filter((c) => c.id && c.name)
      .map((c) => ({ id: c.id, name: c.name, role: "crew" }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  return [];
}

async function runDeleteCommand({ db, storeId, message }) {
  const days = getRequestedDays(message);
  const label = getRangeLabel(days, message);
  const deleted = await deleteShiftsForDays(db, storeId, days);

  return {
    reply: `Done ✅ I deleted ${deleted} shift(s) for ${label}.`
  };
}

async function publishTeamRota({ db, storeId, user, context, message }) {
  const days = getRequestedDays(message);
  const label = getRangeLabel(days, message);
  const { start, end } = parseTimeRange(message);
  const replaceFirst = shouldReplaceBeforeCreate(message);

  const crew = await loadCrewForStore(db, storeId, context);

  if (crew.length < 2) {
    return {
      reply:
        crew.length === 1
          ? `I found only 1 crew member in this store, so I can’t build a team rota yet. Add more crew users first, then try again.`
          : `I couldn’t find any crew users for this store yet. Add crew users first, then try again.`
    };
  }

  let deleted = 0;
  if (replaceFirst) {
    deleted = await deleteShiftsForDays(db, storeId, days);
  }

  const requestedStaff = extractRequestedStaffCount(message, context?.managerData?.staffNeeded || 4);
  const templates = buildShiftTemplates(start, end, crew.length, requestedStaff);
  const shiftsRef = db.collection("stores").doc(storeId).collection("Shifts");

  let created = 0;
  let pointer = 0;
  const usedPeople = new Set();
  let batch = db.batch();
  let ops = 0;

  for (let dayIndex = 0; dayIndex < days.length; dayIndex++) {
    const dateISO = toISO(days[dayIndex]);
    const dayKey = dayKeys[days[dayIndex].getDay()];

    for (let slotIndex = 0; slotIndex < templates.length; slotIndex++) {
      const person = crew[pointer % crew.length];
      pointer += 1;
      usedPeople.add(person.id);

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

  const firstFewNames = crew.slice(0, Math.min(usedPeople.size, 5)).map((p) => p.name).join(", ");

  return {
    reply:
      `Done ✅ I ${replaceFirst ? "replaced" : "added"} the ${label} team rota from ${start}–${end}.\n\n` +
      `${replaceFirst ? `Deleted old shifts: ${deleted}\n` : "Kept existing shifts.\n"}` +
      `Created new shifts: ${created}\n` +
      `People used: ${usedPeople.size}/${crew.length}${firstFewNames ? ` (${firstFewNames}${usedPeople.size > 5 ? ", …" : ""})` : ""}\n` +
      `Daily shift slots: ${templates.map((t) => `${t.start}-${t.end}`).join(", ")}`
  };
}

async function tryHandleManagerCommand({ message, user, context }) {
  const text = String(message || "").toLowerCase();

  if (isHelpCommand(message)) return commandHelpReply();

  const looksLikeManagerCommand =
    isDeleteShiftCommand(message) ||
    isRotaWriteCommand(message) ||
    text.includes("team rota") ||
    text.includes("delete all shifts");

  if (!looksLikeManagerCommand) return null;

  if (!isManagerLike(user, context)) {
    return { reply: "Only a manager or shift creator can edit or delete the rota." };
  }

  const storeId = user?.storeId || context?.storeId || "store001";

  try {
    const db = getAdminDb();

    if (isDeleteShiftCommand(message)) {
      return await runDeleteCommand({ db, storeId, message });
    }

    return await publishTeamRota({ db, storeId, user, context, message });
  } catch (err) {
    console.error("Manager command failed:", err);
    return {
      reply:
        "I understood that as a rota command, but I couldn’t write to Firestore from the server. " +
        "Check Vercel env has FIREBASE_SERVICE_ACCOUNT_KEY set, redeploy, then try again."
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

    // Real commands run before OpenAI. This prevents fake "shifts created" replies.
    const managerCommand = await tryHandleManagerCommand({ message, user, context });
    if (managerCommand) {
      return res.status(200).json(managerCommand);
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

ROTA SAFETY RULE:
- Never claim you created, replaced, deleted, saved, or published shifts in text-only chat.
- If a rota command reaches you, say: "Use the manager rota command format, for example: replace team rota for this week 6am-11pm".
- Do not invent fake rota counts, fake coverage gaps, or fake shift creation results.

GROUNDING RULES:
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
