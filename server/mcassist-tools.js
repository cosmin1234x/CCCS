// McAssist tool catalogue: the OpenAI tool schemas offered to each role, and
// the dispatcher that runs read tools, stages write tools (validate now,
// execute later under the server's risk policy) and handles the terminal
// ask_user / open_page tools. Manager tools are neither offered to nor
// executable by Crew or Crew Trainers.
import { cleanText } from "./portal-admin.js";
import { READ_TOOLS } from "./mcassist-reads.js";
import { OPS, validateOp } from "./mcassist-ops.js";
import { findPerson, memberShifts, personProblem, addStep } from "./mcassist-session.js";
import { defaultBreak, durationMinutes, normaliseShiftStation } from "./mcassist-shifts.js";
import { expandDays, fromMinutes, parseDateInput, parseTime, rangeLabel, toMinutes, timeOk } from "./mcassist-time.js";
import { VERIFY_STATIONS } from "./mcassist-catalog.js";

export const MAX_STAGED = 40;
export const PAGES = ["home", "schedule", "training", "availability", "rewards", "assistant", "team", "manage", "verification", "waste"];

const MANAGER = ["manager"];
const TEAM = ["manager", "crewTrainer"];
const EVERYONE = ["crew", "crewTrainer", "manager"];

const fn = (name, description, properties = {}, required = []) => ({
  type: "function",
  function: {
    name,
    description,
    parameters: { type: "object", properties, required, additionalProperties: false },
  },
});

const member = { type: "string", description: "The person's name as the user wrote it (fuzzy matched server-side), or their user ID." };
const date = (what) => ({ type: "string", description: what + " date, YYYY-MM-DD (Europe/London)." });
const time = (what) => ({ type: "string", description: what + " time, 24-hour HH:MM." });
const dayEntry = {
  type: "object",
  properties: {
    day: { type: "string", description: "mon, tue, wed, thu, fri, sat, sun, or weekdays / weekend / every day." },
    available: { type: "boolean", description: "false = not available that day." },
    start: time("Available from"),
    end: time("Available until (earlier than start = past midnight)"),
  },
  required: ["day", "available"],
  additionalProperties: false,
};

// ---------------------------------------------------------------- schemas
const SCHEMAS = [
  // Reads
  [EVERYONE, fn("get_my_schedule", "The signed-in user's own shifts in a date range, paid hours per week, next shift and a pay estimate (if an hourly rate is set).", { from: date("First"), to: date("Last") })],
  [TEAM, fn("get_team_roster", "The store team: names, roles, status, McStars, badges, verified stations; for Managers also email, pay rate, availability summary and shifts in the next 7 days.", { includeInactive: { type: "boolean", description: "Include deactivated accounts." } })],
  [EVERYONE, fn("get_member_profile", "One person's profile: role, availability (per weekday), upcoming shifts and hours, learning progress, verifications; Managers also see pay rate, email and notes. Crew can only look up themselves; Crew Trainers get a coaching view.", { member }, ["member"])],
  [EVERYONE, fn("list_shifts", "Shifts in a date range. Managers see the whole store (optionally one member and/or station); everyone else sees only their own shifts. Returns shift IDs for editing or deleting.", { member, from: date("First"), to: date("Last"), station: { type: "string" } })],
  [MANAGER, fn("suggest_shift_slots", "ALWAYS use before planning shifts. For one member and date range it checks recorded availability and existing shifts and returns valid candidate dates (inside availability, no overlaps, 11h rest, weeks over 48h flagged). Without start/length it returns the free days and availability windows so you can ask what hours to use.", {
    member,
    from: date("First candidate"),
    to: date("Last candidate"),
    count: { type: "integer", description: "How many shifts are wanted." },
    start: time("Shift start"),
    end: time("Shift end"),
    lengthHours: { type: "number", description: "Shift length in hours when only a length is given (placed at the start of their availability)." },
    station: { type: "string" },
    daysOfWeek: { type: "array", items: { type: "string" }, description: "Only these weekdays, e.g. [\"sat\",\"sun\"]." },
    breakMinutes: { type: "integer" },
  }, ["member"])],
  [MANAGER, fn("get_coverage", "Who works when on a day or range (max 14 days): people per shift, headcount by hour, hours with no cover or only one person between 06:00 and 23:00, and counts per station.", { from: date("First"), to: date("Last (optional)") })],
  [EVERYONE, fn("get_training_overview", "Learning progress. Managers/Crew Trainers: team completion by person and by module, or one member's detail. Crew: their own progress.", { member })],
  [EVERYONE, fn("list_verifications", "Station verifications (crew: only their own). Filter by member or status (pending, verified, revoked).", { member, status: { type: "string", enum: ["pending", "verified", "revoked"] } })],
  [MANAGER, fn("list_role_requests", "Crew Trainer / Manager role requests waiting for review in this store.", { status: { type: "string", enum: ["pending", "approved", "rejected", "all"] } })],
  [MANAGER, fn("get_recent_changes", "Recent changes McAssist made in this store (audit log): who, what, when, before/after.", { limit: { type: "integer" } })],
  ["waste", fn("get_waste_overview", "The store's waste log from the Waste tab: sheets saved, RAW/FULL totals, top wasted items, totals by day and shift, and the current unsaved count.", { days: { type: "integer", description: "How many days back (default 7)." } })],

  // Writes (all staged and checked by the server; risky or bulk ones need the user's confirmation)
  [EVERYONE, fn("update_my_availability", "Change the signed-in user's own regular weekly availability. Several days in one call.", { days: { type: "array", items: dayEntry, minItems: 1 } }, ["days"])],
  [MANAGER, fn("create_shifts", "Create 1–40 shifts in ONE call (all shifts for this request). Check availability with suggest_shift_slots first. Each shift needs a date, start and end; the server adds a 30 min break to shifts over 6h unless breakMinutes is given.", {
    member: { ...member, description: "Default person for every shift (fuzzy name or ID)." },
    station: { type: "string", description: "Default station, e.g. Front Counter, Kitchen, Drive-thru, Fries, Grill, Lobby, Shift Lead, Training. Use \"TBC\" only if the user said any station is fine." },
    shifts: {
      type: "array",
      minItems: 1,
      maxItems: 40,
      items: {
        type: "object",
        properties: {
          member: { type: "string", description: "Person for this shift if different from the default." },
          date: date("Shift"),
          start: time("Start"),
          end: time("End (earlier than start = finishes after midnight)"),
          station: { type: "string" },
          breakMinutes: { type: "integer" },
        },
        required: ["date", "start", "end"],
        additionalProperties: false,
      },
    },
  }, ["shifts"])],
  [MANAGER, fn("update_shift", "Change one existing shift (use the id from list_shifts / get_member_profile).", {
    shiftId: { type: "string" },
    date: date("New"),
    start: time("New start"),
    end: time("New end"),
    station: { type: "string" },
    breakMinutes: { type: "integer" },
  }, ["shiftId"])],
  [MANAGER, fn("delete_shifts", "Delete shifts: either explicit shift IDs, or every shift for one member between two dates.", {
    shiftIds: { type: "array", items: { type: "string" } },
    member,
    from: date("First"),
    to: date("Last"),
  })],
  [MANAGER, fn("manager_set_availability", "Change a team member's regular weekly availability (several days in one call).", { member, days: { type: "array", items: dayEntry, minItems: 1 } }, ["member", "days"])],
  [MANAGER, fn("manager_set_hourly_rate", "Set a team member's hourly pay rate in GBP.", { member, hourlyRate: { type: "number" } }, ["member", "hourlyRate"])],
  [MANAGER, fn("manager_set_role", "Change a team member's approved role.", { member, role: { type: "string", enum: ["crew", "crewTrainer", "manager"] } }, ["member", "role"])],
  [MANAGER, fn("manager_update_profile", "Update a team member's display name, badge or manager notes. Only include fields to change.", { member, newName: { type: "string", description: "Their corrected full name." }, badge: { type: "string" }, notes: { type: "string" } }, ["member"])],
  [MANAGER, fn("manager_adjust_mcstars", "Give (positive) or remove (negative) McStars recognition.", { member, amount: { type: "integer" }, note: { type: "string", description: "Why, e.g. 'great drive-thru times'." } }, ["member", "amount"])],
  [MANAGER, fn("manager_set_training_progress", "Mark a learning module completed or not completed for a team member (learning only — never a station verification).", { member, module: { type: "string", description: "Module title or id, e.g. 'Fries Station'." }, completed: { type: "boolean" } }, ["member", "module", "completed"])],
  [MANAGER, fn("manager_review_role_request", "Approve or reject a pending Crew Trainer / Manager role request.", { member, decision: { type: "string", enum: ["approve", "reject"] } }, ["member", "decision"])],
  [MANAGER, fn("manager_revoke_station", "Revoke a verified station (retraining needed). Cannot grant verifications.", { member, station: { type: "string" }, reason: { type: "string" } }, ["member", "station"])],
  [MANAGER, fn("manager_create_member", "Create a new team account in this store (sign-in + profile). Returns an invite link for the manager to share.", {
    name: { type: "string", description: "Full name." },
    email: { type: "string" },
    role: { type: "string", enum: ["crew", "crewTrainer", "manager"] },
    hourlyRate: { type: "number" },
    badge: { type: "string" },
  }, ["name", "email"])],
  [MANAGER, fn("manager_deactivate_member", "Deactivate (suspend) an account: signs them out and blocks sign-in; reversible. Optionally delete their upcoming shifts.", { member, deleteFutureShifts: { type: "boolean" }, reason: { type: "string" } }, ["member"])],
  [MANAGER, fn("manager_reactivate_member", "Re-enable a deactivated account.", { member }, ["member"])],
  [MANAGER, fn("manager_delete_member", "PERMANENTLY delete a team member's account: sign-in, profile, learning records, role request and upcoming shifts (past shifts are kept for history). Use for 'delete X's account'.", { member }, ["member"])],
  [["crewTrainer"], fn("start_verification", "Start (or reopen) a station verification for a Crew Member. Both people must sign on the verification page; you never sign. Stations: " + VERIFY_STATIONS.join(", ") + ".", { member, station: { type: "string" } }, ["member", "station"])],

  // UI and conversation
  [EVERYONE, fn("open_page", "Open a page in the crew hub, only when the user asks to go somewhere.", { page: { type: "string", enum: PAGES } }, ["page"])],
  [EVERYONE, fn("ask_user", "Ask the user ONE concise clarifying question when a detail is missing or a name is ambiguous. Ends your turn. Include what you already found and 2–4 short quick-reply suggestions.", {
    question: { type: "string" },
    suggestions: { type: "array", items: { type: "string" }, maxItems: 4 },
  }, ["question"])],
];

export async function toolSchemasFor(session) {
  const out = [];
  for (const [roles, schema] of SCHEMAS) {
    if (roles === "waste") {
      if (await READ_TOOLS.get_waste_overview.available(session).catch(() => false)) out.push(schema);
      continue;
    }
    if (roles.includes(session.role)) out.push(schema);
  }
  return out;
}

const TOOL_ROLES = new Map(SCHEMAS.map(([roles, s]) => [s.function.name, roles === "waste" ? EVERYONE : roles]));

// Older tool names the model (or older clients) may still use.
const ALIASES = {
  create_shift: "create_shifts",
  delete_shift: "delete_shifts",
  add_mcstars: "manager_adjust_mcstars",
  manager_lookup_member: "get_member_profile",
  lookup_member: "get_member_profile",
  get_member: "get_member_profile",
  update_availability: "update_my_availability",
  set_my_availability: "update_my_availability",
  clarify: "ask_user",
};

// ---------------------------------------------------------------- staging
function memberQuery(args) {
  return args.member ?? args.memberName ?? args.memberId ?? args.name ?? args.user ?? null;
}

async function resolveOrProblem(session, query) {
  if (!query) return { problem: { ok: false, error: "Tell me who this is for.", instruction: "Ask the user which person they mean." } };
  const result = await findPerson(session, query);
  if (result.status === "found") return { member: result.member };
  return { problem: personProblem(result, query) };
}

function parseDays(args) {
  let list = Array.isArray(args.days) ? args.days : [];
  if (!list.length && args.day) list = [args];
  if (!list.length) return { error: "Tell me which days to change." };
  const out = {};
  for (const entry of list) {
    const keys = expandDays(entry?.day);
    if (!keys.length) return { error: "\"" + String(entry?.day || "") + "\" isn't a day I recognise." };
    const start = parseTime(entry.start);
    const end = parseTime(entry.end);
    const available = entry.available === false ? false : Boolean(entry.available ?? (start && end));
    for (const key of keys) out[key] = available ? { available: true, start, end } : { available: false };
  }
  return { days: out };
}

const money = (v) => Number(String(v ?? "").replace(/[£,\s]/g, ""));

// Each builder turns model arguments into atomic operations (with people
// resolved to store members), or returns a problem for the model to handle.
const BUILDERS = {
  async create_shifts(session, args) {
    let list = Array.isArray(args.shifts) ? args.shifts.filter((s) => s && typeof s === "object") : [];
    if (!list.length && (args.date || args.start)) list = [args];
    if (!list.length) return { problem: { ok: false, error: "No shifts were given." } };
    if (list.length > MAX_STAGED)
      return { problem: { ok: false, error: "I can plan at most " + MAX_STAGED + " shifts in one go. Ask the manager to split the request." } };
    const people = new Map();
    const ops = [];
    for (const s of list) {
      const query = s.member ?? s.memberName ?? s.memberId ?? memberQuery(args);
      const key = String(query || "").toLowerCase();
      if (!people.has(key)) people.set(key, await resolveOrProblem(session, query));
      const who = people.get(key);
      if (who.problem) return who;
      const start = parseTime(s.start) || String(s.start || "");
      let end = parseTime(s.end) || String(s.end || "");
      if (!timeOk(end) && timeOk(start) && Number(s.lengthHours) > 0) end = fromMinutes(toMinutes(start) + Number(s.lengthHours) * 60);
      const duration = durationMinutes(start, end);
      const brk = s.breakMinutes ?? args.breakMinutes;
      ops.push({
        kind: "create_shift",
        args: {
          memberId: who.member.id,
          memberName: who.member.name || "",
          date: parseDateInput(s.date, session.today) || String(s.date || ""),
          start,
          end,
          station: normaliseShiftStation(s.station ?? args.station),
          breakMinutes: brk == null || brk === "" ? defaultBreak(duration) : Math.max(0, Math.min(120, Math.round(Number(brk) || 0))),
        },
      });
    }
    return { ops };
  },

  async update_shift(session, args) {
    const shiftId = cleanText(args.shiftId, 160);
    if (!shiftId) return { problem: { ok: false, error: "I need the shift ID (use list_shifts to find it)." } };
    const patch = {};
    if (args.date) patch.date = parseDateInput(args.date, session.today) || String(args.date);
    if (args.start) patch.start = parseTime(args.start) || String(args.start);
    if (args.end) patch.end = parseTime(args.end) || String(args.end);
    if (args.station) patch.station = normaliseShiftStation(args.station);
    if (args.breakMinutes != null && args.breakMinutes !== "")
      patch.breakMinutes = Math.max(0, Math.min(120, Math.round(Number(args.breakMinutes) || 0)));
    return { ops: [{ kind: "update_shift", args: { shiftId, patch } }] };
  },

  async delete_shifts(session, args) {
    const ids = [
      ...(Array.isArray(args.shiftIds) ? args.shiftIds : []),
      ...(args.shiftId ? [args.shiftId] : []),
    ]
      .map((id) => cleanText(id, 160))
      .filter(Boolean);
    if (ids.length) {
      if (ids.length > MAX_STAGED) return { problem: { ok: false, error: "At most " + MAX_STAGED + " shifts can be deleted in one go." } };
      return { ops: [...new Set(ids)].map((shiftId) => ({ kind: "delete_shift", args: { shiftId } })) };
    }
    const query = memberQuery(args);
    if (!query) return { problem: { ok: false, error: "Tell me which shifts: give shift IDs, or a person and dates." } };
    const who = await resolveOrProblem(session, query);
    if (who.problem) return who;
    if (!args.from && !args.to)
      return {
        problem: {
          ok: false,
          error: "Which dates? I won't delete all of " + (who.member.name || "their") + "'s shifts without a date range.",
          instruction: "Ask the user which dates or week (ask_user).",
        },
      };
    const from = parseDateInput(args.from, session.today) || session.today;
    const to = parseDateInput(args.to, session.today) || from;
    const shifts = (await memberShifts(session, who.member.id)).filter((s) => s.date >= from && s.date <= to);
    addStep(session, "Found " + shifts.length + " of " + (who.member.name || "their") + "'s shifts " + rangeLabel(from, to));
    if (!shifts.length)
      return { problem: { ok: false, nothingToDo: true, error: (who.member.name || "They") + " has no shifts " + rangeLabel(from, to) + "." } };
    if (shifts.length > MAX_STAGED) return { problem: { ok: false, error: "That's more than " + MAX_STAGED + " shifts; use a shorter date range." } };
    return { ops: shifts.map((s) => ({ kind: "delete_shift", args: { shiftId: s.id } })) };
  },

  async update_my_availability(session, args) {
    const parsed = parseDays(args);
    if (parsed.error) return { problem: { ok: false, error: parsed.error } };
    return { ops: [{ kind: "set_own_availability", args: { days: parsed.days } }] };
  },

  async manager_set_availability(session, args) {
    const who = await resolveOrProblem(session, memberQuery(args));
    if (who.problem) return who;
    const parsed = parseDays(args);
    if (parsed.error) return { problem: { ok: false, error: parsed.error } };
    return { ops: [{ kind: "set_member_availability", args: { memberId: who.member.id, memberName: who.member.name || "", days: parsed.days } }] };
  },

  async manager_set_hourly_rate(session, args) {
    const who = await resolveOrProblem(session, memberQuery(args));
    if (who.problem) return who;
    return { ops: [{ kind: "set_hourly_rate", args: { memberId: who.member.id, memberName: who.member.name || "", hourlyRate: money(args.hourlyRate ?? args.rate) } }] };
  },

  async manager_set_role(session, args) {
    const who = await resolveOrProblem(session, memberQuery(args));
    if (who.problem) return who;
    return { ops: [{ kind: "set_role", args: { memberId: who.member.id, memberName: who.member.name || "", role: String(args.role || "") } }] };
  },

  async manager_update_profile(session, args) {
    const who = await resolveOrProblem(session, memberQuery(args));
    if (who.problem) return who;
    const patch = {};
    const newName = args.newName ?? (args.member || args.memberName ? args.name : undefined);
    if (newName !== undefined) patch.name = cleanText(newName, 100);
    if (args.badge !== undefined) patch.badge = cleanText(args.badge, 80);
    if (args.notes !== undefined) patch.notes = cleanText(args.notes, 1000);
    return { ops: [{ kind: "update_profile", args: { memberId: who.member.id, memberName: who.member.name || "", patch } }] };
  },

  async manager_adjust_mcstars(session, args) {
    const who = await resolveOrProblem(session, memberQuery(args));
    if (who.problem) return who;
    return {
      ops: [{ kind: "adjust_stars", args: { memberId: who.member.id, memberName: who.member.name || "", amount: Number(args.amount), note: cleanText(args.note, 240) } }],
    };
  },

  async manager_set_training_progress(session, args) {
    const who = await resolveOrProblem(session, memberQuery(args));
    if (who.problem) return who;
    return {
      ops: [
        {
          kind: "set_training_progress",
          args: { memberId: who.member.id, memberName: who.member.name || "", moduleId: cleanText(args.module ?? args.moduleId, 120), completed: args.completed !== false },
        },
      ],
    };
  },

  async manager_review_role_request(session, args) {
    const who = await resolveOrProblem(session, memberQuery(args));
    if (who.problem) return who;
    const decision = String(args.decision ?? args.action ?? "").toLowerCase() === "reject" ? "reject" : "approve";
    return { ops: [{ kind: "review_role_request", args: { memberId: who.member.id, memberName: who.member.name || "", decision } }] };
  },

  async manager_revoke_station(session, args) {
    const who = await resolveOrProblem(session, memberQuery(args));
    if (who.problem) return who;
    return {
      ops: [{ kind: "revoke_station", args: { memberId: who.member.id, memberName: who.member.name || "", station: cleanText(args.station, 80), reason: cleanText(args.reason, 300) } }],
    };
  },

  async start_verification(session, args) {
    const who = await resolveOrProblem(session, memberQuery(args));
    if (who.problem) return who;
    return { ops: [{ kind: "start_verification", args: { memberId: who.member.id, memberName: who.member.name || "", station: cleanText(args.station, 80) } }] };
  },

  async manager_create_member(session, args) {
    return {
      ops: [
        {
          kind: "create_member",
          args: {
            name: cleanText(args.name ?? args.fullName, 100),
            email: cleanText(args.email, 200),
            role: cleanText(args.role || "crew", 20),
            hourlyRate: args.hourlyRate == null || args.hourlyRate === "" ? null : money(args.hourlyRate),
            badge: cleanText(args.badge, 80),
          },
        },
      ],
    };
  },

  async manager_deactivate_member(session, args) {
    const who = await resolveOrProblem(session, memberQuery(args));
    if (who.problem) return who;
    return {
      ops: [
        {
          kind: "deactivate_member",
          args: { memberId: who.member.id, memberName: who.member.name || "", deleteFutureShifts: args.deleteFutureShifts === true, reason: cleanText(args.reason, 300) },
        },
      ],
    };
  },

  async manager_reactivate_member(session, args) {
    const who = await resolveOrProblem(session, memberQuery(args));
    if (who.problem) return who;
    return { ops: [{ kind: "reactivate_member", args: { memberId: who.member.id, memberName: who.member.name || "" } }] };
  },

  async manager_delete_member(session, args) {
    const who = await resolveOrProblem(session, memberQuery(args));
    if (who.problem) return who;
    return { ops: [{ kind: "delete_member", args: { memberId: who.member.id, memberName: who.member.name || "" } }] };
  },
};

// Server-side risk policy (never decided by the model):
//   "none"    – nothing executable (everything blocked)
//   "execute" – exactly one low-risk, fully valid write → runs immediately
//   "confirm" – anything else becomes ONE pending plan the user must approve
export function planDecision(staged) {
  const usable = staged.filter((s) => s.status !== "blocked");
  if (!usable.length) return "none";
  if (staged.length === 1 && usable[0].risk === "low" && usable[0].status === "ok") return "execute";
  return "confirm";
}

// Validates and stages ops for this turn's plan.
export async function stageOps(session, ops) {
  const added = [];
  for (const op of ops) {
    if (session.staged.length >= MAX_STAGED) break;
    const signature = op.kind + ":" + JSON.stringify(op.args);
    if (session.staged.some((s) => s.signature === signature)) continue;
    const v = await validateOp(session, op.kind, op.args, session.plan);
    const person = v.member?.name || v.shift?.userName || v.current?.userName;
    if (!op.args.memberName && person) op.args = { ...op.args, memberName: person };
    const item = {
      itemId: "i" + (session.staged.length + 1),
      kind: op.kind,
      args: op.args,
      signature,
      risk: v.risk || (OPS[op.kind]?.risk(op.args) ?? "high"),
      status: v.status,
      label: String(v.label || op.kind),
      detail: String(v.detail || ""),
      note: String(v.note || ""),
      forbidden: Boolean(v.forbidden),
    };
    if (item.forbidden) session.forbidden = true;
    session.staged.push(item);
    added.push(item);
  }
  return added;
}

const count = (n, word) => n + " " + word + (n === 1 ? "" : "s");
const STAGE_STEPS = {
  create_shift: (n) => "Checked " + count(n, "new shift") + " against availability, rest and existing shifts",
  update_shift: () => "Checked the shift change against availability and other shifts",
  delete_shift: (n) => "Looked up " + count(n, "shift") + " to remove",
  set_own_availability: () => "Checked your upcoming shifts against the new hours",
  set_member_availability: (n, who) => "Checked " + who + "'s upcoming shifts against the new hours",
  set_hourly_rate: (n, who) => "Checked " + who + "'s current pay rate",
  set_role: (n, who) => "Checked " + who + "'s current role",
  update_profile: (n, who) => "Checked " + who + "'s profile",
  adjust_stars: (n, who) => "Checked " + who + "'s McStars",
  set_training_progress: (n, who) => "Checked " + who + "'s learning record",
  review_role_request: (n, who) => "Checked " + who + "'s role request",
  revoke_station: (n, who) => "Checked " + who + "'s verified stations",
  start_verification: (n, who) => "Checked " + who + "'s role and open verifications",
  create_member: () => "Checked the email isn't already registered",
  deactivate_member: (n, who) => "Checked " + who + "'s account and upcoming shifts",
  reactivate_member: (n, who) => "Checked " + who + "'s account",
  delete_member: (n, who) => "Checked " + who + "'s account, shifts and learning records",
};

function stagingSteps(session, added) {
  const byKind = new Map();
  for (const item of added) byKind.set(item.kind, [...(byKind.get(item.kind) || []), item]);
  for (const [kind, items] of byKind) {
    const people = [...new Set(items.map((i) => i.args?.memberName).filter(Boolean))];
    const who = people.length === 1 ? people[0] : "their";
    const step = STAGE_STEPS[kind]?.(items.length, who);
    if (step) addStep(session, step.replace("their's", "their"));
  }
}

function stagedResult(session, added, requested) {
  const usable = added.filter((i) => i.status !== "blocked");
  const blocked = added.filter((i) => i.status === "blocked");
  const items = added.slice(0, 40).map((i) => ({ label: i.label, status: i.status, ...(i.note ? { note: i.note } : {}) }));
  if (!usable.length) {
    return {
      ok: false,
      staged: 0,
      error: blocked.length
        ? "Couldn't prepare " + (blocked.length === 1 ? "that change" : "these changes") + ": " + [...new Set(blocked.map((b) => b.note))].slice(0, 3).join(" ")
        : "Nothing was staged.",
      items,
      instruction: "Explain the problem to the user in plain words. Nothing was changed.",
    };
  }
  const needsConfirmation = planDecision(session.staged) === "confirm";
  const truncated = requested > added.length;
  return {
    ok: true,
    staged: usable.length,
    blockedCount: blocked.length,
    warnings: added.filter((i) => i.status === "warning").length,
    items,
    needsConfirmation,
    ...(truncated ? { note: "Only the first " + MAX_STAGED + " changes were staged (limit per request)." } : {}),
    message: needsConfirmation
      ? "NOT saved yet. The server will show the user ONE plan card with Confirm/Cancel buttons. In your reply, briefly summarise the plan (count, dates/times, any warnings or blocked items) and ask them to review and confirm. Never say it's done."
      : "This single low-risk change will be saved automatically when you finish your reply (unless you stage more changes). Reply as if it's done, e.g. 'Done — …'.",
  };
}

function problemFor(session, name, roles) {
  session.forbidden = true;
  const who = roles.includes("manager") && roles.length === 1 ? "a Manager" : roles.includes("crewTrainer") && roles.length === 1 ? "a Crew Trainer" : "someone with a different role";
  return {
    ok: false,
    forbidden: true,
    error: "Not allowed: only " + who + " can use " + name + ". Your role is " + session.roleLabel + ".",
    instruction: "Politely tell the user their role can't do this and suggest asking a Manager. Do not try another tool to work around it.",
  };
}

// Runs one tool call from the model. Returns { forModel, terminal?, question?, suggestions? }.
export async function dispatchTool(session, rawName, args) {
  const name = ALIASES[rawName] || rawName;
  const roles = TOOL_ROLES.get(name);
  if (!roles) return { forModel: { ok: false, error: "Unknown tool " + rawName + "." } };
  if (!roles.includes(session.role)) return { forModel: problemFor(session, name, roles) };

  if (name === "ask_user") {
    const question = cleanText(args.question, 600) || "Could you tell me a bit more?";
    const suggestions = (Array.isArray(args.suggestions) ? args.suggestions : [])
      .map((s) => cleanText(s, 60))
      .filter(Boolean)
      .slice(0, 4);
    return { terminal: true, question, suggestions, forModel: { ok: true } };
  }

  if (name === "open_page") {
    const page = String(args.page || "").toLowerCase();
    if (!PAGES.includes(page)) return { forModel: { ok: false, error: "Unknown page." } };
    session.uiAction = { type: "openPage", page };
    return { forModel: { ok: true, opened: page, message: "The app will open that page after your reply." } };
  }

  if (READ_TOOLS[name]) {
    try {
      const data = await READ_TOOLS[name].run(session, args || {});
      return { forModel: data && data.ok === false ? data : { ok: true, ...data } };
    } catch (error) {
      console.error("McAssist read tool failed", { name, message: error?.message });
      return { forModel: { ok: false, error: "I couldn't load that just now." } };
    }
  }

  const builder = BUILDERS[name];
  if (!builder) return { forModel: { ok: false, error: "Unknown tool " + rawName + "." } };
  if (session.staged.length >= MAX_STAGED)
    return { forModel: { ok: false, error: "The limit of " + MAX_STAGED + " changes per request has been reached." } };
  let built;
  try {
    built = await builder(session, args || {});
  } catch (error) {
    console.error("McAssist staging failed", { name, message: error?.message });
    return { forModel: { ok: false, error: "I couldn't prepare that change just now." } };
  }
  if (built.problem) return { forModel: built.problem };
  const added = await stageOps(session, built.ops);
  if (!added.length) return { forModel: { ok: true, staged: 0, message: "Already staged earlier in this request." } };
  stagingSteps(session, added.filter((i) => !i.forbidden));
  return { forModel: stagedResult(session, added, built.ops.length) };
}
