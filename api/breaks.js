// Break orders: crew put their own break food through.
//
//   GET  /api/breaks[?day=YYYY-MM-DD]      → { ok, settings, menu, mine, log? }
//   POST /api/breaks { action: "place", items: [{ id, mods }], note }  → { ok, order, …state }
//   POST /api/breaks { action: "void", id }                    → managers
//   POST /api/breaks { action: "config", settings?, menu? }    → managers
//
// Every request needs a Firebase ID token. The crew member is always the
// signed-in account, orders stay inside the caller's store, and the crew meal
// rules (breaks-core.js) are checked again here inside a transaction, so two
// quick taps cannot spend more than the day's points.
//
// Firestore (written by this endpoint only, see firestore.rules):
//   stores/{storeId}/breakConfig/current   { settings, menu, updatedAt, updatedBy, updatedByName }
//   stores/{storeId}/breakOrders/{id}      one order (status "placed" or "void"), crewDay = "uid|day"
//   stores/{storeId}/breakDays/{day}       { seq } daily order numbers B-001…
import { adminDb, cleanText, getAuthenticatedProfile, normalizeRole } from "../server/portal-admin.js";
import * as B from "../breaks-core.js";

const HISTORY_DAYS = 14;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const fail = (status, error, extra = {}) => ({ status, body: { ok: false, error, ...extra } });

const refs = (db, storeId) => {
  const store = db.collection("stores").doc(storeId);
  return {
    config: store.collection("breakConfig").doc("current"),
    orders: store.collection("breakOrders"),
    day: (day) => store.collection("breakDays").doc(day),
  };
};

function readConfig(snap) {
  const data = snap?.exists ? snap.data() || {} : {};
  return {
    settings: B.normalizeSettings(data.settings),
    menu: B.normalizeMenu(data.menu),
    updatedAt: data.updatedAt || null,
    updatedByName: data.updatedByName || "",
  };
}

const orderOf = (doc) => ({ ...doc.data(), id: doc.id });
// One field for "this crew member on this day" keeps every query on a
// single-field index (no composite indexes to deploy).
const crewDayKey = (uid, day) => `${uid}|${day}`;
const byNewest = (a, b) => String(b.createdAt).localeCompare(String(a.createdAt));

async function stateFor(db, { profile, uid, day }, now) {
  const r = refs(db, profile.storeId);
  const manager = normalizeRole(profile.role) === "manager";
  const today = B.dayKey(now);
  const days = Array.from({ length: HISTORY_DAYS }, (_, i) => B.shiftDay(today, -i));
  const [configSnap, mineSnap, logSnap] = await Promise.all([
    r.config.get(),
    r.orders.where("crewDay", "in", days.map((d) => crewDayKey(uid, d))).get(),
    manager ? r.orders.where("day", "==", day).get() : null,
  ]);
  const config = readConfig(configSnap);
  return {
    ok: true,
    manager,
    today,
    day,
    settings: config.settings,
    menu: config.menu,
    configUpdatedAt: config.updatedAt,
    configUpdatedBy: config.updatedByName,
    mine: mineSnap.docs.map(orderOf).sort(byNewest),
    ...(manager ? { log: logSnap.docs.map(orderOf).sort(byNewest) } : {}),
  };
}

async function place(db, { profile, uid, body }, now) {
  const r = refs(db, profile.storeId);
  const today = B.dayKey(now);
  const crew = { id: uid, name: cleanText(profile.name, 80) || "Crew member" };
  // Tray lines ({ id, mods } or plain ids); breaks-core cleans them and keeps
  // only each item's own customisations.
  const items = B.normalizeLines(body.items);
  const note = cleanText(body.note, 80);
  return db.runTransaction(async (t) => {
    const [configSnap, todaySnap, daySnap] = await Promise.all([
      t.get(r.config),
      t.get(r.orders.where("crewDay", "==", crewDayKey(uid, today))),
      t.get(r.day(today)),
    ]);
    const { settings, menu } = readConfig(configSnap);
    const orders = todaySnap.docs.map(orderOf);
    const args = { crew, items, note, menu, settings, orders, now };
    B.createOrder({ ...args, no: 0 }); // throws RULES before a number is used
    const no = (Number(daySnap.exists ? daySnap.data()?.seq : 0) || 0) + 1;
    const ref = r.orders.doc();
    const order = B.createOrder({ ...args, no, id: ref.id });
    t.set(r.day(today), { day: today, seq: no }, { merge: true });
    t.set(ref, { ...order, storeId: profile.storeId, crewDay: crewDayKey(uid, today) });
    return order;
  });
}

async function voidOne(db, { profile, uid, body }, now) {
  const id = cleanText(body.id, 120);
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(id)) return fail(400, "Choose an order to void.");
  const ref = refs(db, profile.storeId).orders.doc(id);
  const snap = await ref.get();
  if (!snap.exists || snap.data()?.storeId !== profile.storeId) return fail(404, "That order was not found in your store.");
  const next = B.voidOrder(orderOf(snap), { id: uid, name: profile.name }, now);
  const { id: _id, ...fields } = next;
  await ref.set(fields, { merge: true });
  return null;
}

async function saveConfig(db, { profile, uid, body }, now) {
  const r = refs(db, profile.storeId);
  const current = readConfig(await r.config.get());
  const settings = body.settings && typeof body.settings === "object" ? B.normalizeSettings({ ...current.settings, ...body.settings }) : current.settings;
  const menu = Array.isArray(body.menu) ? B.normalizeMenu(body.menu) : current.menu;
  await r.config.set(
    {
      settings,
      menu: B.menuForSave(menu),
      updatedAt: new Date(now).toISOString(),
      updatedBy: uid,
      updatedByName: cleanText(profile.name, 80),
    },
    { merge: true },
  );
  return null;
}

// The request logic, separate from auth so it can be tested with a fake db.
export async function breaksRequest(db, { profile, uid, method, query = {}, body = {}, now = new Date() }) {
  if (!profile?.storeId) return fail(403, "Your profile needs a store ID.");
  const manager = normalizeRole(profile.role) === "manager";
  const today = B.dayKey(now);
  const askedDay = cleanText(query.day, 10);
  // Managers can look back through the log; crew always see today + their own history.
  const day = manager && DAY_RE.test(askedDay) && askedDay <= today ? askedDay : today;
  const ctx = { profile, uid, body, day };

  if (method === "GET") return { status: 200, body: await stateFor(db, ctx, now) };
  if (method !== "POST") return fail(405, "Method not allowed");

  const action = cleanText(body.action, 20);
  if (action === "place") {
    try {
      const order = await place(db, ctx, now);
      return { status: 201, body: { ...(await stateFor(db, { ...ctx, day: today }, now)), order } };
    } catch (error) {
      if (error.code === "RULES") return fail(422, error.message, { code: "RULES", errors: error.errors });
      throw error;
    }
  }
  if (action === "void" || action === "config") {
    if (!manager) return fail(403, "Only managers can change break orders and rules.");
    const problem = action === "void" ? await voidOne(db, ctx, now) : await saveConfig(db, ctx, now);
    if (problem) return problem;
    return { status: 200, body: await stateFor(db, ctx, now) };
  }
  return fail(400, "Unknown break order action.");
}

const inactive = (profile) => String(profile?.status || "").toLowerCase() === "inactive" || profile?.deactivated === true;

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    const { decoded, profile } = await getAuthenticatedProfile(req);
    if (inactive(profile)) return res.status(403).json({ ok: false, error: "Your account has been deactivated." });
    let body = req.body || {};
    if (typeof body === "string") {
      try {
        body = JSON.parse(body || "{}");
      } catch {
        return res.status(400).json({ ok: false, error: "Invalid request." });
      }
    }
    const result = await breaksRequest(adminDb(), {
      profile,
      uid: decoded.uid,
      method: req.method,
      query: req.query || {},
      body,
    });
    return res.status(result.status).json(result.body);
  } catch (error) {
    if (!error.status) console.error("Break orders failed", error);
    return res.status(error.status || 500).json({ ok: false, error: error.status ? error.message : "Could not update break orders. Try again." });
  }
}
