// Scripted, OpenAI-compatible model for the e2e harness.
//
// McAssist's REAL server loop (api/ai-chat.js) runs unchanged against the
// Firestore emulator; only the model is replaced. The dev server is started
// with OPENAI_BASE_URL=http://127.0.0.1:4010/v1 so every
// POST /v1/chat/completions lands here. Each reply is chosen from the latest
// user message plus the tool calls/results already in this turn, and every
// tool call is built from the tool schemas the server actually offered, so the
// fake keeps working when tool names or parameters evolve.
//
// Scenarios (case-insensitive):
//   "create 3 shifts for Cosmin next week"  → reads availability/shifts when
//        read tools exist, then asks which times/station (clarifying question)
//   "16:00-23:00 on fries" (after the above) → proposes the N shifts (writes)
//   "delete Amelia's account"               → calls the account-deletion tool;
//        when the caller was NOT offered one (crew), it deliberately calls a
//        manager tool anyway, like a jailbroken model, to prove the server
//        refuses it
//   anything else                            → friendly plain-text answer
//
// Test helpers: GET /__e2e/log (recent requests), POST /__e2e/reset,
//               GET /health.
//   PORT (default 4010)
import http from "node:http";
import { assertLocalEmulators, e2eEnv } from "./e2e-guard.mjs";

for (const [key, value] of Object.entries(e2eEnv()))
  if (process.env[key] === undefined) process.env[key] = value;
assertLocalEmulators(process.env, "fake-openai");

const port = Number(process.env.PORT) || 4010;
let log = [];
const seenTools = new Map(); // name -> function schema, across all requests
let callCounter = 0;

// ---------------------------------------------------------------- helpers
const textOf = (content) =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((p) => (typeof p === "string" ? p : p?.text || "")).join("\n")
      : content == null
        ? ""
        : JSON.stringify(content);

const NUMBER_WORDS = { a: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, couple: 2, few: 3 };
const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DAY_NAMES = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };
const STATIONS = [
  ["front counter", "Front Counter"],
  ["counter", "Front Counter"],
  ["drive-thru", "Drive-thru"],
  ["drive thru", "Drive-thru"],
  ["fries", "Fries"],
  ["grill", "Grill"],
  ["kitchen", "Kitchen"],
  ["lobby", "Lobby"],
  ["drinks", "Drinks & McCafé"],
  ["breakfast", "Breakfast"],
];

const iso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function weekDates(offset = 0, now = new Date()) {
  const start = new Date(now);
  start.setHours(12, 0, 0, 0);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7) + offset * 7);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    return iso(d);
  });
}

function parseCount(text) {
  const m = text.match(/\b(\d{1,2}|a|one|two|three|four|five|six|seven|eight|nine|ten|couple|few)\s+(?:more\s+)?(?:new\s+)?shifts?\b/i);
  if (!m) return 1;
  const raw = m[1].toLowerCase();
  return Math.max(1, Math.min(10, Number(raw) || NUMBER_WORDS[raw] || 1));
}

function to24(h, m, ap) {
  let hour = Number(h);
  if (ap) {
    ap = ap.toLowerCase();
    if (ap === "pm" && hour < 12) hour += 12;
    if (ap === "am" && hour === 12) hour = 0;
  }
  return `${String(hour).padStart(2, "0")}:${String(Number(m || 0)).padStart(2, "0")}`;
}

function parseTimes(text) {
  const m = text.match(/\b(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?\s*(?:-|–|—|to|until|till)\s*(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?\b/i);
  if (!m) return null;
  return { start: to24(m[1], m[2], m[3]), end: to24(m[4], m[5], m[6] || (m[3] && !m[6] ? null : m[6])) };
}

function parseStation(text) {
  const lower = text.toLowerCase();
  const hit = STATIONS.find(([k]) => lower.includes(k));
  return hit ? hit[1] : null;
}

const firstNameIn = (text, pattern) => text.match(pattern)?.[1] || null;

// Walks every JSON value found in the conversation (context blocks and tool
// results) and returns objects that look like the named team member.
function* jsonValues(messages) {
  for (const m of messages) {
    const text = textOf(m.content);
    // Try the whole message, then the JSON that follows a text preamble.
    const candidates = [text, text.slice(text.indexOf("{")), text.slice(text.indexOf("["))];
    for (const c of candidates) {
      try {
        yield JSON.parse(c);
        break;
      } catch {}
    }
  }
}

function findMember(messages, firstName) {
  if (!firstName) return null;
  const wanted = firstName.toLowerCase();
  let best = null;
  const visit = (v, depth = 0) => {
    if (!v || depth > 8) return;
    if (Array.isArray(v)) return v.forEach((x) => visit(x, depth + 1));
    if (typeof v !== "object") return;
    const name = typeof v.name === "string" ? v.name : typeof v.userName === "string" ? v.userName : null;
    if (name && name.toLowerCase().split(/\s+/)[0] === wanted && (v.id || v.uid || v.userId || v.memberId)) {
      const score = (v.availability ? 2 : 0) + (v.id || v.uid ? 1 : 0);
      if (!best || score > best.score) best = { score, value: v };
    }
    Object.values(v).forEach((x) => visit(x, depth + 1));
  };
  for (const value of jsonValues(messages)) visit(value);
  if (!best) {
    // Context blocks may be truncated JSON: fall back to a nearby "id".
    for (const m of messages) {
      const text = textOf(m.content);
      const safe = firstName.replace(/[^A-Za-z]/g, "");
      const re = new RegExp('"(?:name|userName)"\\s*:\\s*"(' + safe + '[^"]*)"', "i");
      const hit = text.match(re);
      if (!hit) continue;
      const around = text.slice(Math.max(0, hit.index - 400), hit.index + 400);
      const id = around.match(/"(?:id|uid)"\s*:\s*"([^"]+)"/);
      if (id) return { id: id[1], name: hit[1], availability: null };
    }
    return null;
  }
  const v = best.value;
  return { id: v.id || v.uid || v.memberId || v.userId, name: v.name || v.userName, availability: v.availability || null };
}

function availabilitySentence(member) {
  const a = member?.availability;
  if (!a || typeof a !== "object") return "";
  const on = [];
  const offDays = [];
  for (const d of DAY_KEYS) {
    const e = a[d];
    if (e && e.available && e.start && e.end) on.push(`${DAY_NAMES[d]} ${e.start}–${e.end}`);
    else if (e) offDays.push(DAY_NAMES[d]);
  }
  if (!on.length) return "";
  const same = on.every((x) => x.slice(4) === on[0].slice(4));
  const first = member.name?.split(" ")[0] || "They";
  return (
    (same ? `${first} is available ${on.map((x) => x.slice(0, 3)).join(", ")} ${on[0].slice(4)}` : `${first} is available ${on.join(", ")}`) +
    (offDays.length ? ` and off on ${offDays.join(", ")}` : "") +
    "."
  );
}

// ------------------------------------------------------- tool selection
const fnOf = (t) => t?.function || t;
const nameOf = (t) => String(fnOf(t)?.name || "");
const descOf = (t) => String(fnOf(t)?.description || "");
const WRITE_WORDS = /(create|add|update|set|save|delete|remove|change|publish|approve|reject|revoke|grant|assign|propose|plan|deactivate|reset|complete|start|adjust|edit|write|move|swap|cancel)/i;

function findTool(tools, { name = [], desc = [], exclude = [] }) {
  const list = tools.filter((t) => !exclude.some((re) => re.test(nameOf(t))));
  for (const re of name) {
    const hit = list.find((t) => re.test(nameOf(t)));
    if (hit) return fnOf(hit);
  }
  for (const re of desc) {
    const hit = list.find((t) => re.test(descOf(t)));
    if (hit) return fnOf(hit);
  }
  return null;
}

const readTools = (tools) => tools.filter((t) => !WRITE_WORDS.test(nameOf(t)));

// Builds arguments for any function schema from loose hints, so the fake
// adapts to whatever parameter names the backend chooses.
function fillArgs(fn, hints) {
  const props = fn?.parameters?.properties || {};
  const out = {};
  for (const [key, schema] of Object.entries(props)) {
    const v = valueFor(key, schema || {}, hints);
    if (v !== undefined) out[key] = v;
  }
  return out;
}

function valueFor(key, schema, h) {
  const k = key.toLowerCase();
  const type = Array.isArray(schema.type) ? schema.type.find((t) => t !== "null") : schema.type;
  if (type === "array") {
    const items = schema.items || {};
    if ((items.type === "object" || items.properties) && h.shifts && /shift|item|entr|plan|change|action|op/.test(k))
      return h.shifts.map((s) => fillArgs({ parameters: items }, { ...h, ...s, shifts: undefined }));
    if (/date|day/.test(k) && h.dates) return h.dates;
    if (/suggest|option|choice|quick|repl/.test(k) && h.suggestions) return h.suggestions;
    if (/member|user|people|name/.test(k) && h.memberName) return [h.memberName];
    return undefined;
  }
  if (type === "object") {
    if (schema.properties) {
      const nested = fillArgs({ parameters: schema }, h);
      return Object.keys(nested).length ? nested : undefined;
    }
    return undefined;
  }
  if (schema.enum && Array.isArray(schema.enum)) {
    const pick = (want) => schema.enum.find((e) => String(e).toLowerCase() === String(want).toLowerCase());
    if (/risk/.test(k)) return pick(h.risk || "medium") ?? schema.enum[0];
    if (/station/.test(k) && h.station) return pick(h.station) ?? schema.enum[0];
    if (/day/.test(k) && h.day) return pick(h.day) ?? undefined;
    if (/confirm|approve|decision/.test(k)) return undefined;
    return undefined;
  }
  if (type === "boolean") {
    if (/confirm|approved|force|skip/.test(k)) return undefined;
    if (/available/.test(k)) return h.available ?? undefined;
    return undefined;
  }
  if (type === "number" || type === "integer") {
    if (/break/.test(k)) return h.breakMinutes ?? 30;
    if (/count|number|how ?many|quantity/.test(k)) return h.count;
    if (/limit/.test(k)) return 50;
    if (/days/.test(k)) return 14;
    return undefined;
  }
  // strings
  if (/question|prompt|ask/.test(k)) return h.question;
  if (/reason|why|note|summary|message|explanation|rationale/.test(k)) return h.reason;
  if (/(member|user|crew|staff|person|target|employee)_?(id|uid)$|^uid$|^userid$|^memberid$/.test(k)) return h.memberId || h.memberName;
  if (/shift_?id$/.test(k)) return h.shiftId;
  if (/(member|user|crew|staff|person|target|employee|who)(_?name)?$|^name$|^query$|^search$|^person$/.test(k)) return h.memberName;
  if (/^(from|start_?date|date_?from|from_?date|week_?start|range_?start|since)$/.test(k)) return h.fromDate;
  if (/^(to|end_?date|date_?to|to_?date|week_?end|range_?end|until)$/.test(k)) return h.toDate;
  if (/^week$|week_?of/.test(k)) return h.fromDate;
  if (/date/.test(k)) return h.date || h.fromDate;
  if (/^day$|weekday/.test(k)) return h.day;
  if (/start|from|begin/.test(k)) return h.start;
  if (/end|finish|until|to$/.test(k)) return h.end;
  if (/station|position|area/.test(k)) return h.station;
  if (/role/.test(k)) return h.role;
  if (/page/.test(k)) return h.page;
  return undefined;
}

// ------------------------------------------------------------- scenarios
const SHIFT_REQUEST = /\b(?:create|add|plan|schedule|make|book|put|give|set up|rota)\b[^.?!]*\bshifts?\b[^.?!]*\bfor\s+([A-Za-z][a-z]+)/i;
const SHIFT_REQUEST_ALT = /\bshifts?\b[^.?!]*\bfor\s+([A-Za-z][a-z]+)\b/i;
const DELETE_ACCOUNT = /\b(?:delete|remove|deactivate|erase|wipe|get rid of)\b\s+([A-Za-z][a-z]+)(?:'s|’s|s')?\s+(?:account|profile|user|login)\b/i;
const DELETE_ACCOUNT_ALT = /\b(?:delete|remove|erase)\b\s+(?:the\s+)?(?:account|profile|user)\s+(?:of|for)\s+([A-Za-z][a-z]+)/i;

function decide(body) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const tools = Array.isArray(body.tools) ? body.tools : [];
  for (const t of tools) if (nameOf(t)) seenTools.set(nameOf(t), fnOf(t));

  let lastUser = -1;
  for (let i = messages.length - 1; i >= 0; i--)
    if (messages[i].role === "user") {
      lastUser = i;
      break;
    }
  const userText = lastUser >= 0 ? textOf(messages[lastUser].content).trim() : "";
  const tail = lastUser >= 0 ? messages.slice(lastUser + 1) : [];
  const callsThisTurn = tail.filter((m) => m.role === "assistant").flatMap((m) => m.tool_calls || []);
  const idToName = Object.fromEntries(callsThisTurn.map((c) => [c.id, c.function?.name]));
  const results = tail
    .filter((m) => m.role === "tool")
    .map((m) => {
      let content = textOf(m.content);
      try {
        content = JSON.parse(content);
      } catch {}
      return { name: idToName[m.tool_call_id] || m.name || "", content };
    });
  const earlierUserTexts = messages
    .slice(0, Math.max(0, lastUser))
    .filter((m) => m.role === "user")
    .map((m) => textOf(m.content))
    .filter((t) => t.length < 600);
  const assistantTexts = messages.filter((m) => m.role === "assistant").map((m) => textOf(m.content));
  const now = new Date();
  const next = weekDates(1, now);

  // ---- delete an account
  const delName = firstNameIn(userText, DELETE_ACCOUNT) || firstNameIn(userText, DELETE_ACCOUNT_ALT);
  if (delName) {
    const member = findMember(messages, delName);
    const hints = {
      memberName: member?.name || delName,
      memberId: member?.id,
      reason: `The manager asked to delete ${delName}'s account.`,
      risk: "high",
    };
    if (results.length) {
      const failed = results.find((r) => r.content?.ok === false || r.content?.error);
      if (failed?.content?.forbidden)
        return say("Sorry, I can't do that — only a Manager can delete someone's account. Nothing has been changed.");
      if (failed)
        return say(
          `I can't do that: ${String(failed.content.error || failed.content.reply || "it isn't allowed for your account.")} Nothing has been changed.`,
        );
      return say(
        `Deleting ${hints.memberName}'s account is permanent: it removes their login and profile. Please review the plan and confirm if you're sure.`,
      );
    }
    const offered = findTool(tools, {
      name: [/delete.*(account|member|user|profile)/i, /(account|member|user).*delete/i, /remove.*(account|member|user)/i, /deactivate/i],
      desc: [/delete.*account/i, /remove.*account/i],
    });
    if (offered) return callTools([{ name: offered.name, args: fillArgs(offered, hints) }]);
    // Not offered (crew / trainer). Behave like a jailbroken model and try a
    // manager tool anyway: the server must refuse it.
    const known = [...seenTools.values()].find((f) => /delete.*(account|member|user)|(account|member|user).*delete/i.test(f.name)) || {
      name: "manager_delete_member",
      parameters: { type: "object", properties: { member: { type: "string" } } },
    };
    if (!callsThisTurn.length) return callTools([{ name: known.name, args: fillArgs(known, hints) }]);
    return say(
      "I can't delete accounts. Only a Manager can remove a team member's account, so I haven't changed anything.",
    );
  }

  // ---- plan several shifts for someone
  const shiftTarget = firstNameIn(userText, SHIFT_REQUEST) || firstNameIn(userText, SHIFT_REQUEST_ALT);
  const priorShiftRequest = [...earlierUserTexts].reverse().find((t) => SHIFT_REQUEST.test(t) || SHIFT_REQUEST_ALT.test(t));
  const matchAvailability = /match (?:his|her|their) availability|use (?:his|her|their) availability|full availability/i.test(userText);
  const originalRequest = shiftTarget ? userText : priorShiftRequest;
  const target = shiftTarget || (priorShiftRequest && (firstNameIn(priorShiftRequest, SHIFT_REQUEST) || firstNameIn(priorShiftRequest, SHIFT_REQUEST_ALT)));

  if (target && originalRequest) {
    const member = findMember(messages, target);
    const count = parseCount(originalRequest);
    const station = parseStation(userText) || parseStation(originalRequest || "") || "Fries";
    const allText = [originalRequest, userText].join(" ");
    const timeSpec = parseTimes(allText) || (matchAvailability ? { start: "09:00", end: "17:00" } : null);
    const hintsBase = {
      memberName: member?.name || target,
      memberId: member?.id,
      fromDate: next[0],
      toDate: next[6],
      count,
      station,
      reason: originalRequest,
    };

    const slotsTool = findTool(tools, { name: [/^suggest_shift_slots$/, /suggest.*(slot|shift)/i, /(free|available).*(slot|day)/i] });
    const calledNames = callsThisTurn.map((c) => c.function?.name);
    const slotsResult = [...results].reverse().find((r) => slotsTool && r.name === slotsTool.name)?.content;
    const availText = (slotsResult && typeof slotsResult.availabilitySummary === "string" && slotsResult.availabilitySummary) || "";

    if (!timeSpec) {
      // Phase 1: look before leaping. Prefer the server's slot checker, which
      // reads availability and existing shifts in one go.
      if (slotsTool && !calledNames.includes(slotsTool.name))
        return callTools([{ name: slotsTool.name, args: fillArgs(slotsTool, hintsBase) }]);
      if (!slotsTool && !callsThisTurn.length) {
        const reads = [];
        const avail = findTool(readTools(tools), {
          name: [/availability/i, /member.*(detail|profile|info)/i, /(get|find|lookup|look_up|read|view|search).*(member|person|crew|team)/i, /team/i],
          desc: [/availability/i],
        });
        if (avail) reads.push({ name: avail.name, args: fillArgs(avail, hintsBase) });
        const shiftsRead = findTool(readTools(tools), {
          name: [/(list|get|find|read|view|search|check).*shifts?/i, /shifts?.*(list|for|lookup|search)/i, /rota/i],
          desc: [/(list|existing|current).*shifts/i],
          exclude: avail ? [new RegExp("^" + avail.name + "$")] : [],
        });
        if (shiftsRead) reads.push({ name: shiftsRead.name, args: fillArgs(shiftsRead, hintsBase) });
        if (reads.length) return callTools(reads);
      }
      const known = findMember(messages, target);
      const availability = availText
        ? `I've checked ${slotsResult.member?.name || hintsBase.memberName}'s availability: ${availText.replace(/\.$/, "")}.`
        : availabilitySentence(known);
      const existing = Array.isArray(slotsResult?.existingShiftsInRange) ? slotsResult.existingShiftsInRange.length : 0;
      const question =
        `Happy to plan ${count} shift${count === 1 ? "" : "s"} for ${slotsResult?.member?.name || hintsBase.memberName} next week. ` +
        (availability ? availability + " " : "") +
        (existing ? `He already has ${existing} shift${existing === 1 ? "" : "s"} that week, so I'll plan around ${existing === 1 ? "it" : "them"}. ` : "") +
        "You didn't say what times — what hours should they be, and which station?";
      const suggestions = ["16:00–23:00 on Fries", "09:00–17:00 on Front Counter", "11:00–19:00 on Drive-thru"];
      const ask = findTool(tools, { name: [/ask|clarif|question/i], desc: [/clarifying question/i] });
      if (ask && !callsThisTurn.some((c) => c.function?.name === ask.name))
        return callTools([{ name: ask.name, args: fillArgs(ask, { ...hintsBase, question, suggestions }) }]);
      return say(question + "\n- " + suggestions.join("\n- "));
    }

    // Phase 2: times known → check the exact slots, then propose the writes
    // (the server turns 2+ writes into ONE pending plan to confirm).
    if (slotsTool && !calledNames.includes(slotsTool.name))
      return callTools([
        {
          name: slotsTool.name,
          args: fillArgs(slotsTool, { ...hintsBase, start: timeSpec.start, end: timeSpec.end }),
        },
      ]);
    if (results.some((r) => /shift/i.test(r.name) && WRITE_WORDS.test(r.name)) || callsThisTurn.some((c) => WRITE_WORDS.test(c.function?.name || ""))) {
      const failed = results.filter((r) => r.content?.ok === false || r.content?.error);
      if (failed.length && failed.length === results.length)
        return say(`I couldn't prepare those shifts: ${failed.map((f) => f.content.error || f.content.reply).join(" ")}`);
      return say(
        `I've prepared ${count} shift${count === 1 ? "" : "s"} for ${hintsBase.memberName} next week, ${timeSpec.start}–${timeSpec.end} on ${station}, avoiding Wednesday (day off) and his existing Friday shift. Review the plan and confirm to publish.`,
      );
    }
    const avail = member?.availability || {};
    const busy = new Set();
    for (const value of jsonValues(messages)) {
      const visit = (v, d = 0) => {
        if (!v || d > 8) return;
        if (Array.isArray(v)) return v.forEach((x) => visit(x, d + 1));
        if (typeof v !== "object") return;
        if (v.date && v.start && (v.userId === member?.id || (v.userName && v.userName.split(" ")[0].toLowerCase() === target.toLowerCase())))
          busy.add(v.date);
        Object.values(v).forEach((x) => visit(x, d + 1));
      };
      visit(value);
    }
    // Use the server's recommended slots when it gave them.
    const recommended = Array.isArray(slotsResult?.recommended) ? slotsResult.recommended : null;
    const candidates = Array.isArray(slotsResult?.candidates) ? slotsResult.candidates : [];
    const days = (
      recommended?.length
        ? recommended.map((date) => ({ date, key: DAY_KEYS[next.indexOf(date)] || "" }))
        : next
            .map((date, i) => ({ date, key: DAY_KEYS[i] }))
            .filter(({ date, key }) => !busy.has(date) && (avail[key] ? avail[key].available !== false : key !== "sun"))
    ).slice(0, count);
    const shifts = days.map(({ date, key }) => ({
      date,
      day: key,
      start: candidates.find((c) => c.date === date)?.start || (matchAvailability && avail[key]?.start) || timeSpec.start,
      end: candidates.find((c) => c.date === date)?.end || (matchAvailability && avail[key]?.end) || timeSpec.end,
      station,
      breakMinutes: 30,
    }));
    if (!shifts.length)
      return say(`I couldn't find ${count} free slot${count === 1 ? "" : "s"} for ${hintsBase.memberName} next week at those times. Want me to try the week after?`);
    const bulk = findTool(tools, {
      name: [/(create|add|plan|propose|publish|bulk).*shifts$/i, /shifts?_?(batch|bulk)/i, /bulk/i],
      desc: [/several shifts|multiple shifts|bulk/i],
    });
    const bulkHasArray = bulk && Object.values(bulk.parameters?.properties || {}).some((p) => p?.type === "array");
    if (bulk && bulkHasArray) return callTools([{ name: bulk.name, args: fillArgs(bulk, { ...hintsBase, shifts, date: shifts[0]?.date, start: shifts[0]?.start, end: shifts[0]?.end }) }]);
    const single = findTool(tools, {
      name: [/^(create|add|publish|plan)_?shift$/i, /(create|add|publish|plan).*shift(?!s)/i],
      desc: [/(create|publish|plan).*shift/i],
      exclude: [/update|delete|remove|swap/i],
    });
    if (single)
      return callTools(shifts.map((s) => ({ name: single.name, args: fillArgs(single, { ...hintsBase, ...s }) })));
    return say(`I can't plan shifts from here. Use the shift planner to add ${hintsBase.memberName}'s shifts.`);
  }

  // ---- anything else: a helpful plain reply
  if (/prepare|next shift|shift prep/i.test(userText))
    return say(
      "Here's a quick plan for your next shift:\n- Check your start time and station on My shifts\n- Arrive a few minutes early and find your shift lead\n- Ask what the team needs before the rush",
    );
  if (!userText) return say("How can I help?");
  return say(`Happy to help with that. (${assistantTexts.length ? "Following on from our chat" : "Scripted e2e reply"}.)`);
}

function say(content) {
  return { content, tool_calls: [] };
}

function callTools(calls) {
  return {
    content: "",
    tool_calls: calls.map((c) => ({
      id: "call_e2e_" + ++callCounter,
      type: "function",
      function: { name: c.name, arguments: JSON.stringify(c.args || {}) },
    })),
  };
}

function completion(body, decision) {
  const message = { role: "assistant", content: decision.content || null };
  if (decision.tool_calls?.length) message.tool_calls = decision.tool_calls;
  return {
    id: "chatcmpl-e2e-" + Date.now().toString(36),
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: body.model || "fake-e2e",
    choices: [{ index: 0, message, finish_reason: decision.tool_calls?.length ? "tool_calls" : "stop" }],
    usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
  };
}

function send(res, status, data, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(data));
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    let raw = "";
    for await (const chunk of req) raw += chunk;
    if (url.pathname === "/health" || url.pathname === "/") return send(res, 200, { ok: true, fake: "openai" });
    if (url.pathname === "/__e2e/log") return send(res, 200, { requests: log, tools: [...seenTools.keys()] });
    if (url.pathname === "/__e2e/reset" && req.method === "POST") {
      log = [];
      return send(res, 200, { ok: true });
    }
    if (url.pathname === "/v1/models")
      return send(res, 200, { object: "list", data: [{ id: "gpt-4o-mini", object: "model" }] });
    if (!/\/v1\/chat\/completions$/.test(url.pathname) || req.method !== "POST")
      return send(res, 404, { error: { message: "Not found", type: "invalid_request_error" } });
    if (!/^Bearer\s+\S+/.test(String(req.headers.authorization || "")))
      return send(res, 401, { error: { message: "Missing API key", type: "invalid_request_error", code: "invalid_api_key" } });

    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return send(res, 400, { error: { message: "Invalid JSON", type: "invalid_request_error" } });
    }
    let decision;
    try {
      decision = decide(body);
    } catch (error) {
      console.error("[fake-openai] scenario crashed", error);
      decision = say("Sorry, the scripted model hit a problem.");
    }
    // Like the real API, tool_choice "none" forbids tool calls: answer in text.
    if (body.tool_choice === "none" && decision.tool_calls?.length)
      decision = say("Here's where I've got to. Let me know how you'd like to carry on.");
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    log.push({
      at: new Date().toISOString(),
      user: textOf(lastUser?.content).slice(0, 300),
      tools: (body.tools || []).map(nameOf),
      toolResults: messages.filter((m) => m.role === "tool").length,
      reply: decision.content ? String(decision.content).slice(0, 300) : null,
      toolCalls: (decision.tool_calls || []).map((c) => ({ name: c.function.name, args: c.function.arguments })),
    });
    if (log.length > 100) log = log.slice(-100);
    const payload = completion(body, decision);
    if (body.stream) {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
      const message = payload.choices[0].message;
      const delta = { role: "assistant", content: message.content || "" };
      if (message.tool_calls) delta.tool_calls = message.tool_calls.map((c, index) => ({ index, ...c }));
      res.write(`data: ${JSON.stringify({ ...payload, object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ ...payload, object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: payload.choices[0].finish_reason }] })}\n\n`);
      res.end("data: [DONE]\n\n");
      return;
    }
    send(res, 200, payload);
  })
  .listen(port, "127.0.0.1", () => console.log(`[fake-openai] listening on http://127.0.0.1:${port}/v1`));
