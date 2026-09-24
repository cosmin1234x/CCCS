// McAssist read tools. Reads never change data and never need confirmation,
// but they still respect the caller's approved role: Managers see the store,
// Crew Trainers see the team's learning and verifications, Crew see only
// themselves. Every read adds a human "step" so the UI can show what McAssist
// checked before answering.
import { normalizeRole, roleLabel } from "./portal-admin.js";
import {
  addStep,
  db,
  findPerson,
  getRoster,
  loadMember,
  memberShifts,
  personProblem,
  serialise,
  storeShifts,
} from "./mcassist-session.js";
import {
  availabilityObject,
  compactShift,
  coverage,
  describeAvailability,
  firstName,
  hoursLabel,
  normaliseShiftStation,
  paidMinutes,
  span,
  suggestSlots,
} from "./mcassist-shifts.js";
import {
  WEEK_ORDER,
  addDays,
  dateLabel,
  datesInRange,
  dayNumber,
  formatDateTime,
  londonDate,
  parseDateInput,
  parseDayKey,
  parseTime,
  rangeLabel,
  weekRange,
  weekStart,
} from "./mcassist-time.js";
import { modulesForRole, moduleCatalog } from "./mcassist-catalog.js";

const MANAGER = ["manager"];
const TEAM = ["manager", "crewTrainer"];
const EVERYONE = ["crew", "crewTrainer", "manager"];

function range(session, args, { days = 14, max = 62, defaultFrom } = {}) {
  const from = parseDateInput(args.from ?? args.date, session.today) || defaultFrom || session.today;
  let to = parseDateInput(args.to, session.today) || (args.date && !args.from ? from : addDays(from, days - 1));
  if (to < from) to = from;
  if (dayNumber(to) - dayNumber(from) > max - 1) to = addDays(from, max - 1);
  return { from, to };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function rateOf(profile) {
  const n = Number(profile?.hourlyRate);
  return profile?.hourlyRate !== null && profile?.hourlyRate !== "" && Number.isFinite(n) && n > 0 ? n : null;
}

function weeksSummary(shifts, rate) {
  const weeks = new Map();
  for (const s of shifts) {
    const key = weekStart(s.date);
    const w = weeks.get(key) || { week: rangeLabel(key, addDays(key, 6)), shifts: 0, minutes: 0 };
    w.shifts += 1;
    w.minutes += paidMinutes(s);
    weeks.set(key, w);
  }
  return [...weeks.values()].map((w) => ({
    week: w.week,
    shifts: w.shifts,
    paidHours: round2(w.minutes / 60),
    payEstimate: rate ? "£" + ((w.minutes / 60) * rate).toFixed(2) : null,
  }));
}

async function trainingFor(session, member) {
  const snap = await db(session).collection("users").doc(member.id).collection("portalTraining").limit(200).get();
  const progress = Object.fromEntries(snap.docs.map((d) => [d.id, serialise(d.data())]));
  const required = modulesForRole(normalizeRole(member.role));
  const done = required.filter((m) => progress[m.id]?.completed);
  const todo = required.filter((m) => !progress[m.id]?.completed);
  return {
    completed: done.length,
    total: required.length,
    percent: required.length ? Math.round((done.length / required.length) * 100) : 0,
    completedModules: done.map((m) => m.title),
    toDo: todo.map((m) => m.title),
  };
}

async function verificationsFor(session, memberId) {
  const snap = await db(session)
    .collection("stores")
    .doc(session.storeId)
    .collection("verifications")
    .where("crewId", "==", memberId)
    .limit(100)
    .get();
  return snap.docs.map((d) => verificationRow({ id: d.id, ...serialise(d.data()) }));
}

function verificationRow(v) {
  return {
    id: v.id,
    crewName: v.crewName || "Crew member",
    trainerName: v.trainerName || "",
    station: v.station || "",
    status: v.status === "pending_signatures" ? "waiting for signatures" : v.status || "",
    crewSigned: Boolean(v.crewSignature),
    trainerSigned: Boolean(v.trainerSignature),
    started: v.createdAt ? formatDateTime(v.createdAt) : "",
  };
}

// Resolve a person or explain why not (crew can only ever look at themselves).
async function personOrProblem(session, query) {
  if (!query || /^(me|myself|my|i)$/i.test(String(query).trim())) {
    const self = await loadMember(session, session.uid);
    return { member: self || session.profile };
  }
  const result = await findPerson(session, query);
  if (result.status === "found") return { member: result.member };
  if (!session.permissions.canSeeTeam)
    return { problem: { ok: false, forbidden: true, error: "Crew Members can only look at their own details." } };
  return { problem: personProblem(result, query) };
}

export const READ_TOOLS = {
  get_my_schedule: {
    roles: EVERYONE,
    async run(session, args) {
      const { from, to } = range(session, args, { days: 28, max: 90 });
      const all = await memberShifts(session, session.uid);
      const shifts = all.filter((s) => s.date >= from && s.date <= to);
      const rate = rateOf(session.profile);
      const nowAbs = dayNumber(session.today) * 1440 + session.nowMinutes;
      const next = all.find((s) => (span(s)?.end || 0) > nowAbs);
      const minutes = shifts.reduce((sum, s) => sum + paidMinutes(s), 0);
      addStep(session, "Checked your shifts " + rangeLabel(from, to));
      return {
        range: { from, to },
        nextShift: next ? compactShift(next) : null,
        shifts: shifts.slice(0, 40).map(compactShift),
        totals: {
          shifts: shifts.length,
          paidHours: round2(minutes / 60),
          payEstimate: rate ? "£" + ((minutes / 60) * rate).toFixed(2) : null,
        },
        weeks: weeksSummary(shifts, rate),
        hourlyRate: rate,
        payNote: rate
          ? "Estimate only: scheduled hours minus unpaid breaks × hourly rate. Not payroll."
          : "No hourly rate is recorded, so there is no pay estimate.",
      };
    },
  },

  get_team_roster: {
    roles: TEAM,
    async run(session, args) {
      const manager = session.role === "manager";
      const roster = (await getRoster(session)).filter(
        (m) => args.includeInactive || String(m.status || "").toLowerCase() !== "inactive",
      );
      let counts = new Map();
      if (manager) {
        const week = await storeShifts(session, session.today, addDays(session.today, 6));
        for (const s of week) counts.set(s.userId, (counts.get(s.userId) || 0) + 1);
      }
      addStep(session, "Checked the team roster");
      return {
        people: roster
          .slice()
          .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")))
          .map((m) => ({
            id: m.id,
            name: m.name || "Crew member",
            role: roleLabel(m.role),
            status: String(m.status || "active"),
            stars: Number(m.stars) || 0,
            badge: m.badge || "",
            verifiedStations: Array.isArray(m.verifiedStations) ? m.verifiedStations : [],
            ...(manager
              ? {
                  email: m.email || "",
                  hourlyRate: rateOf(m),
                  availability: describeAvailability(m.availability),
                  shiftsNext7Days: counts.get(m.id) || 0,
                  roleRequest: m.roleRequestStatus === "pending" ? roleLabel(m.requestedRole) : "",
                }
              : {}),
          })),
      };
    },
  },

  get_member_profile: {
    roles: EVERYONE,
    async run(session, args) {
      const found = await personOrProblem(session, args.member ?? args.memberName ?? args.memberId);
      if (found.problem) return found.problem;
      const member = (await loadMember(session, found.member.id, { fresh: true })) || found.member;
      const self = member.id === session.uid;
      const manager = session.role === "manager";
      const training = await trainingFor(session, member);
      const base = {
        id: member.id,
        name: member.name || "Crew member",
        role: roleLabel(member.role),
        status: String(member.status || "active"),
        stars: Number(member.stars) || 0,
        badge: member.badge || "",
        verifiedStations: Array.isArray(member.verifiedStations) ? member.verifiedStations : [],
        training,
      };
      if (!manager && !self) {
        // Crew Trainers get the coaching view only.
        addStep(session, "Checked " + (member.name || "their") + "'s learning and verifications");
        return { ...base, verifications: await verificationsFor(session, member.id) };
      }
      const shifts = await memberShifts(session, member.id);
      const upcoming = shifts.filter((s) => s.date >= session.today && s.date <= addDays(session.today, 27));
      const thisWeek = weekRange(session.today);
      const nextWeek = weekRange(session.today, 1);
      const hoursIn = (r) =>
        hoursLabel(shifts.filter((s) => s.date >= r.from && s.date <= r.to).reduce((sum, s) => sum + paidMinutes(s), 0));
      addStep(session, "Checked " + (self ? "your" : (member.name || "their") + "'s") + " profile and availability");
      return {
        ...base,
        ...(manager ? { email: member.email || "", notes: member.notes || "" } : {}),
        hourlyRate: rateOf(member),
        availabilitySummary: describeAvailability(member.availability),
        availability: availabilityObject(member.availability),
        upcomingShifts: upcoming.slice(0, 30).map(compactShift),
        hoursThisWeek: hoursIn(thisWeek),
        hoursNextWeek: hoursIn(nextWeek),
        roleRequest:
          member.roleRequestStatus === "pending" && member.requestedRole ? roleLabel(member.requestedRole) + " (pending)" : "",
        verifications: await verificationsFor(session, member.id),
      };
    },
  },

  list_shifts: {
    roles: EVERYONE,
    async run(session, args) {
      const { from, to } = range(session, args, { days: 14, max: 62 });
      const manager = session.role === "manager";
      let shifts;
      let who = "the rota";
      const query = args.member ?? args.memberName ?? args.memberId;
      if (query && manager) {
        const found = await personOrProblem(session, query);
        if (found.problem) return found.problem;
        shifts = (await memberShifts(session, found.member.id)).filter((s) => s.date >= from && s.date <= to);
        who = (found.member.name || "their") + "'s shifts";
      } else if (manager) {
        shifts = await storeShifts(session, from, to);
      } else {
        if (query && !/^(me|myself|my|i)$/i.test(String(query).trim())) {
          const found = await personOrProblem(session, query);
          if (found.problem || found.member?.id !== session.uid)
            return { ok: false, forbidden: true, error: "Only Managers can see other people's shifts." };
        }
        shifts = (await memberShifts(session, session.uid)).filter((s) => s.date >= from && s.date <= to);
        who = "your shifts";
      }
      if (args.station) {
        const station = normaliseShiftStation(args.station).toLowerCase();
        shifts = shifts.filter((s) => String(s.station || "").toLowerCase() === station);
      }
      addStep(session, "Checked " + who + " " + rangeLabel(from, to));
      return {
        range: { from, to },
        count: shifts.length,
        paidHours: round2(shifts.reduce((sum, s) => sum + paidMinutes(s), 0) / 60),
        shifts: shifts.slice(0, 90).map(compactShift),
        ...(shifts.length > 90 ? { truncated: "Showing the first 90 — narrow the dates or pick a person for the rest." } : {}),
      };
    },
  },

  suggest_shift_slots: {
    roles: MANAGER,
    async run(session, args) {
      const found = await personOrProblem(session, args.member ?? args.memberName ?? args.memberId);
      if (found.problem) return found.problem;
      const member = (await loadMember(session, found.member.id, { fresh: true })) || found.member;
      const count = Math.max(0, Math.min(40, Math.floor(Number(args.count) || 0)));
      const { from, to } = range(session, args, { days: count > 7 ? 28 : 14, max: 62 });
      const start = parseTime(args.start);
      const end = parseTime(args.end);
      const lengthHours = Number(args.lengthHours);
      const days = (Array.isArray(args.daysOfWeek) ? args.daysOfWeek : [])
        .map(parseDayKey)
        .filter((d) => WEEK_ORDER.includes(d));
      const existing = await memberShifts(session, member.id);
      const result = suggestSlots({
        member,
        existing,
        from,
        to,
        count,
        start,
        end: start ? end : null,
        lengthMinutes: Number.isFinite(lengthHours) && lengthHours > 0 ? Math.min(12, lengthHours) * 60 : start && end ? 0 : 0,
        station: args.station ? normaliseShiftStation(args.station) : "TBC",
        breakMinutes: args.breakMinutes == null ? null : Math.max(0, Math.min(120, Number(args.breakMinutes) || 0)),
        daysOfWeek: days,
        today: session.today,
        nowMinutes: session.nowMinutes,
      });
      const name = member.name || "They";
      addStep(session, "Checked " + name + "'s availability and existing shifts");
      if (!result.needsTimes)
        addStep(session, "Found " + result.candidates.length + " free slot" + (result.candidates.length === 1 ? "" : "s") + " for " + firstName(name));
      const inRange = existing.filter((s) => s.date >= from && s.date <= to);
      return {
        member: { id: member.id, name, status: String(member.status || "active") },
        range: { from, to, label: rangeLabel(from, to) },
        availabilitySummary: describeAvailability(member.availability),
        availability: availabilityObject(member.availability),
        existingShiftsInRange: inRange.map(compactShift),
        needsTimes: result.needsTimes,
        ...(result.needsTimes
          ? {
              availableDays: result.availableDays,
              guidance:
                "No times were given. Ask the manager what hours the shifts should be (offer their availability window as one option), unless they already told you.",
            }
          : {
              candidates: result.candidates.slice(0, 40).map((c) => ({
                date: c.date,
                day: c.day,
                start: c.start,
                end: c.end,
                breakMinutes: c.breakMinutes,
                status: c.status,
                notes: c.notes,
              })),
              recommended: result.recommended.map((c) => c.date),
              enoughSlots: result.enough,
            }),
        excluded: result.excluded,
        rules: "Slots stay inside availability, never overlap, keep 11h rest where possible and flag weeks over 48h.",
      };
    },
  },

  get_coverage: {
    roles: MANAGER,
    async run(session, args) {
      const { from, to } = range(session, args, { days: 1, max: 14 });
      const shifts = await storeShifts(session, addDays(from, -1), to);
      const dates = datesInRange(from, to, 14);
      addStep(session, "Checked coverage for " + rangeLabel(from, to));
      return {
        coreHours: "06:00–23:00 (used to spot gaps)",
        days: coverage(shifts, dates),
      };
    },
  },

  get_training_overview: {
    roles: EVERYONE,
    async run(session, args) {
      const query = args.member ?? args.memberName ?? args.memberId;
      if (session.role === "crew" || (query && !session.permissions.canSeeTeam)) {
        const me = (await loadMember(session, session.uid)) || session.profile;
        addStep(session, "Checked your learning progress");
        return { you: await trainingFor(session, me) };
      }
      if (query) {
        const found = await personOrProblem(session, query);
        if (found.problem) return found.problem;
        addStep(session, "Checked " + (found.member.name || "their") + "'s learning");
        return { name: found.member.name, role: roleLabel(found.member.role), ...(await trainingFor(session, found.member)) };
      }
      const roster = (await getRoster(session))
        .filter((m) => String(m.status || "").toLowerCase() !== "inactive")
        .slice(0, 80);
      const rows = await Promise.all(roster.map(async (m) => ({ member: m, t: await trainingFor(session, m) })));
      const modules = moduleCatalog().map((mod) => {
        const eligible = rows.filter((r) => mod.roles.includes(normalizeRole(r.member.role)));
        const done = eligible.filter((r) => r.t.completedModules.includes(mod.title));
        return { module: mod.title, completed: done.length, of: eligible.length };
      });
      addStep(session, "Checked the team's learning progress");
      return {
        team: rows
          .map((r) => ({
            name: r.member.name || "Crew member",
            role: roleLabel(r.member.role),
            completed: r.t.completed,
            total: r.t.total,
            percent: r.t.percent,
            nextUp: r.t.toDo.slice(0, 2),
          }))
          .sort((a, b) => a.percent - b.percent),
        byModule: modules,
      };
    },
  },

  list_verifications: {
    roles: EVERYONE,
    async run(session, args) {
      const ref = db(session).collection("stores").doc(session.storeId).collection("verifications");
      let rows;
      if (session.role === "crew") {
        const snap = await ref.where("crewId", "==", session.uid).limit(100).get();
        rows = snap.docs.map((d) => ({ id: d.id, ...serialise(d.data()) }));
        addStep(session, "Checked your station verifications");
      } else {
        const snap = await ref.limit(300).get();
        rows = snap.docs.map((d) => ({ id: d.id, ...serialise(d.data()) }));
        const query = args.member ?? args.memberName;
        if (query) {
          const found = await personOrProblem(session, query);
          if (found.problem) return found.problem;
          rows = rows.filter((v) => v.crewId === found.member.id);
        }
        addStep(session, "Checked station verifications");
      }
      const wanted = String(args.status || "").toLowerCase();
      if (wanted) {
        const map = { pending: "pending_signatures", waiting: "pending_signatures", verified: "verified", revoked: "revoked" };
        rows = rows.filter((v) => v.status === (map[wanted] || wanted));
      }
      rows.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
      return { count: rows.length, verifications: rows.slice(0, 40).map(verificationRow) };
    },
  },

  list_role_requests: {
    roles: MANAGER,
    async run(session, args) {
      const snap = await db(session).collection("roleRequests").where("storeId", "==", session.storeId).limit(100).get();
      const wanted = String(args.status || "pending").toLowerCase();
      const rows = snap.docs
        .map((d) => ({ id: d.id, ...serialise(d.data()) }))
        .filter((r) => wanted === "all" || String(r.status || "") === wanted);
      addStep(session, "Checked role requests");
      return {
        requests: rows.map((r) => ({
          memberId: r.uid || r.id,
          name: r.name || "Crew member",
          requestedRole: roleLabel(r.requestedRole),
          status: r.status || "",
          requested: r.createdAt ? formatDateTime(r.createdAt) : "",
        })),
      };
    },
  },

  get_recent_changes: {
    roles: MANAGER,
    async run(session, args) {
      const limit = Math.max(1, Math.min(25, Number(args.limit) || 12));
      const snap = await db(session)
        .collection("stores")
        .doc(session.storeId)
        .collection("assistantAudit")
        .orderBy("createdAt", "desc")
        .limit(limit)
        .get();
      addStep(session, "Checked recent McAssist changes");
      return {
        changes: snap.docs.map((d) => {
          const a = serialise(d.data());
          return {
            when: formatDateTime(a.createdAt || a.createdAtMs),
            by: a.actorName || "",
            action: String(a.action || "").replace(/_/g, " "),
            person: a.targetUserName || "",
            before: a.before ?? null,
            after: a.after ?? null,
          };
        }),
      };
    },
  },

  get_waste_overview: {
    roles: EVERYONE,
    async available(session) {
      return Boolean(await session.deps.loadWaste?.());
    },
    async run(session, args) {
      const mod = await session.deps.loadWaste?.();
      if (!mod) return { ok: false, error: "Waste insights aren't available right now." };
      const days = Math.max(1, Math.min(60, Math.floor(Number(args.days) || 7)));
      let record;
      try {
        record = await mod.readWasteRecord({ timeoutMs: 8000 });
      } catch {
        return { ok: false, error: "The waste log couldn't be reached just now. Try again in a moment." };
      }
      const state = record?.state || record?.record?.state || (Array.isArray(record?.history) ? record : null) || {};
      const history = Array.isArray(state.history) ? state.history.filter((s) => s && typeof s === "object") : [];
      const since = addDays(session.today, -(days - 1));
      const sheets = history
        .map((s) => ({ ...s, day: londonDate(Date.parse(s.createdAt) || 0) }))
        .filter((s) => s.day >= since && s.day <= session.today);
      const totals = { raw: 0, full: 0 };
      const items = new Map();
      const byDay = new Map();
      const byShift = new Map();
      for (const sheet of sheets) {
        const entries = Array.isArray(sheet.entries) ? sheet.entries : [];
        let sheetTotal = 0;
        for (const e of entries) {
          const n = Math.max(0, Number(e?.count) || 0);
          if (!n) continue;
          sheetTotal += n;
          if (e.type === "full") totals.full += n;
          else totals.raw += n;
          const key = String(e.name || "Item") + (e.type ? " (" + String(e.type).toUpperCase() + ")" : "");
          items.set(key, (items.get(key) || 0) + n);
        }
        byDay.set(sheet.day, (byDay.get(sheet.day) || 0) + sheetTotal);
        const shift = String(sheet.shift || "all");
        byShift.set(shift, (byShift.get(shift) || 0) + sheetTotal);
      }
      const counts = state.counts && typeof state.counts === "object" ? state.counts : {};
      const itemNames = new Map((Array.isArray(state.items) ? state.items : []).map((i) => [i?.id, i?.name]));
      const unsaved = Object.entries(counts)
        .map(([id, n]) => ({ item: itemNames.get(id) || id, count: Math.max(0, Number(n) || 0) }))
        .filter((x) => x.count > 0)
        .sort((a, b) => b.count - a.count);
      const latest = history
        .slice()
        .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))[0];
      addStep(session, "Checked the waste log for the last " + days + " day" + (days === 1 ? "" : "s"));
      return {
        period: rangeLabel(since, session.today),
        sheetsSaved: sheets.length,
        totals: { raw: totals.raw, full: totals.full, total: totals.raw + totals.full },
        topItems: [...items.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8)
          .map(([item, count]) => ({ item, count })),
        byDay: [...byDay.entries()].sort().map(([day, total]) => ({ day: dateLabel(day), total })),
        byShift: Object.fromEntries(byShift),
        latestSheet: latest
          ? {
              when: formatDateTime(Date.parse(latest.createdAt) || 0),
              label: String(latest.label || "").slice(0, 80),
              total: (Array.isArray(latest.entries) ? latest.entries : []).reduce((n, e) => n + (Number(e?.count) || 0), 0),
            }
          : null,
        currentUnsavedCount: {
          total: unsaved.reduce((n, x) => n + x.count, 0),
          top: unsaved.slice(0, 5),
        },
      };
    },
  },
};


