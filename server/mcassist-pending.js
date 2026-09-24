// Pending plans: when a chat turn stages risky or multiple writes, they are
// stored as ONE plan in stores/{storeId}/assistantPending/{id} for 15 minutes.
// Approving re-validates every item against live data, executes the ones that
// are still valid, audits each write and marks the plan done. Cancelling marks
// it cancelled. Only the person who created a plan can resolve it.
import { clean, db, httpError } from "./mcassist-session.js";
import { OPS, executeOp, newPlanState, validateOp } from "./mcassist-ops.js";
import { rangeLabel } from "./mcassist-time.js";
import { hoursLabel, paidMinutes } from "./mcassist-shifts.js";

export const PENDING_TTL_MS = 15 * 60 * 1000;
const RISK_ORDER = { low: 0, medium: 1, high: 2 };

function pendingCollection(session) {
  return db(session).collection("stores").doc(session.storeId).collection("assistantPending");
}

const plural = (n, word, many = word + "s") => n + " " + (n === 1 ? word : many);

function names(items) {
  return [...new Set(items.map((i) => i.args?.memberName).filter(Boolean))];
}

// Human title, summary and button labels for a set of staged items.
export function describePlan(staged) {
  const usable = staged.filter((s) => s.status !== "blocked");
  const blocked = staged.length - usable.length;
  // A permanent delete always carries its own warning; don't double count it.
  const warnings = usable.filter((s) => s.status === "warning" && s.kind !== "delete_member").length;
  const kinds = new Set(staged.map((s) => s.kind));
  const risk = usable.reduce((r, s) => (RISK_ORDER[s.risk] > RISK_ORDER[r] ? s.risk : r), "low");
  const who = names(staged);
  const forWho = who.length === 1 ? " for " + who[0] : who.length > 1 ? " for " + plural(who.length, "person", "people") : "";
  let title;
  let confirmLabel;
  const parts = [];

  if (kinds.size === 1 && kinds.has("create_shift")) {
    title = "Create " + plural(staged.length, "shift") + forWho;
    confirmLabel = usable.length === 1 ? "Create shift" : "Create " + usable.length + " shifts";
    const dates = usable.map((s) => s.args.date).sort();
    const minutes = usable.reduce((sum, s) => sum + paidMinutes(s.args), 0);
    if (dates.length) parts.push(rangeLabel(dates[0], dates[dates.length - 1]));
    if (minutes) parts.push(hoursLabel(minutes) + " paid in total");
  } else if (kinds.size === 1 && kinds.has("delete_shift")) {
    title = "Delete " + plural(staged.length, "shift");
    confirmLabel = usable.length === 1 ? "Delete shift" : "Delete " + usable.length + " shifts";
  } else if (staged.length === 1) {
    const only = staged[0];
    const person = only.args?.memberName || "";
    const map = {
      delete_member: ["Delete " + person + "'s account", "Delete account"],
      deactivate_member: ["Deactivate " + person + "'s account", "Deactivate"],
      reactivate_member: ["Reactivate " + person + "'s account", "Reactivate"],
      create_member: ["Create an account for " + (only.args?.name || "a new starter"), "Create account"],
      set_role: ["Change " + person + "'s role", "Change role"],
      set_hourly_rate: ["Change " + person + "'s pay rate", "Update pay"],
      review_role_request: [
        (only.args?.decision === "reject" ? "Reject " : "Approve ") + person + "'s role request",
        only.args?.decision === "reject" ? "Reject request" : "Approve request",
      ],
      revoke_station: ["Revoke a station for " + person, "Revoke"],
      update_shift: ["Change a shift" + (person ? " for " + person : ""), "Update shift"],
      set_member_availability: ["Update " + person + "'s availability", "Update availability"],
      set_own_availability: ["Update your availability", "Save availability"],
      update_profile: ["Update " + person + "'s profile", "Save changes"],
      adjust_stars: ["Update " + person + "'s McStars", "Confirm"],
      set_training_progress: ["Update " + person + "'s learning", "Confirm"],
      start_verification: ["Start a verification for " + person, "Start verification"],
      create_shift: ["Create a shift" + forWho, "Create shift"],
      delete_shift: ["Delete a shift", "Delete shift"],
    };
    [title, confirmLabel] = map[only.kind] || ["Apply this change", "Confirm"];
  } else {
    title = "Apply " + plural(staged.length, "change") + forWho;
    confirmLabel = "Apply " + (usable.length === 1 ? "1 change" : usable.length + " changes");
  }

  if (kinds.size > 1 || !(kinds.has("create_shift") || kinds.has("delete_shift"))) parts.unshift(plural(usable.length, "change"));
  else parts.unshift(plural(usable.length, "shift"));
  if (warnings) parts.push(plural(warnings, "warning"));
  if (blocked) parts.push(blocked + " can't be done (will be skipped)");
  if (kinds.has("delete_member")) parts.push("permanent — can't be undone");
  return { title, summary: parts.join(" · "), confirmLabel, cancelLabel: "Cancel", risk };
}

export function pendingForClient(id, plan) {
  return {
    id,
    title: plan.title,
    summary: plan.summary,
    risk: plan.risk,
    confirmLabel: plan.confirmLabel,
    cancelLabel: plan.cancelLabel,
    expiresAt: plan.expiresAt,
    items: plan.items,
  };
}

export async function savePlan(session, { message = "", reply = "" } = {}) {
  const staged = session.staged;
  const described = describePlan(staged);
  const expiresAt = session.deps.now() + PENDING_TTL_MS;
  const items = staged.map((s) =>
    clean({
      id: s.itemId,
      label: s.label,
      detail: s.detail || undefined,
      status: s.status,
      note: s.note || undefined,
    }),
  );
  const calls = staged.map((s) =>
    clean({
      itemId: s.itemId,
      kind: s.kind,
      args: s.args,
      risk: s.risk,
      status: s.status,
      note: s.note || "",
      label: s.label,
    }),
  );
  // Only one plan per person is live at a time: a newer plan replaces older ones,
  // so a stale card can never be approved by accident.
  const older = await pendingCollection(session)
    .where("uid", "==", session.uid)
    .where("status", "==", "pending")
    .limit(20)
    .get()
    .catch(() => null);
  const ref = pendingCollection(session).doc();
  if (older && !older.empty) {
    const batch = db(session).batch();
    for (const d of older.docs)
      batch.set(d.ref, { status: "cancelled", supersededBy: ref.id, cancelledAtMs: session.deps.now() }, { merge: true });
    await batch.commit().catch((error) => console.error("McAssist could not supersede old plans", { message: error?.message }));
  }
  const doc = clean({
    uid: session.uid,
    storeId: session.storeId,
    actorName: session.profile.name || "",
    actorRole: session.role,
    createdAt: session.deps.FieldValue.serverTimestamp(),
    createdAtMs: session.deps.now(),
    expiresAt,
    status: "pending",
    calls,
    items,
    title: described.title,
    summary: described.summary,
    risk: described.risk,
    confirmLabel: described.confirmLabel,
    cancelLabel: described.cancelLabel,
    request: String(message).slice(0, 500),
    reply: String(reply).slice(0, 2000),
  });
  await ref.set(doc);
  return pendingForClient(ref.id, { ...doc, items });
}

// Latest unexpired pending plan for this user (used for typed "yes"/"cancel").
export async function latestPendingPlan(session) {
  const snap = await pendingCollection(session)
    .where("uid", "==", session.uid)
    .where("status", "==", "pending")
    .limit(20)
    .get();
  const now = session.deps.now();
  return (
    snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((p) => p.status === "pending" && Number(p.expiresAt) > now)
      .sort((a, b) => Number(b.createdAtMs || 0) - Number(a.createdAtMs || 0))[0] || null
  );
}

function outcomeReply(plan, results, executed) {
  const ok = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);
  const kinds = new Set((plan.calls || []).map((c) => c.kind));
  if (!ok.length)
    return "Nothing was changed — " + (failed[0]?.message || "none of the changes could be applied") + (failed.length > 1 ? " (and " + (failed.length - 1) + " more)." : "");
  let head;
  if (kinds.size === 1 && kinds.has("create_shift")) {
    const who = names(plan.calls || []);
    head = "Done — created " + plural(ok.length, "shift") + (who.length === 1 ? " for " + who[0] : "") + ".";
  } else if (kinds.size === 1 && kinds.has("delete_shift")) {
    head = "Done — deleted " + plural(ok.length, "shift") + ".";
  } else if (ok.length === 1) {
    const text = executed[0]?.message || ok[0].message;
    head = "Done — " + text.charAt(0).toLowerCase() + text.slice(1) + (/[.!?]$/.test(text) ? "" : ".");
  } else {
    head = "Done — applied " + plural(ok.length, "change") + ".";
  }
  if (!failed.length) return head;
  return (
    head +
    " " +
    plural(failed.length, "item was", "items were") +
    " skipped: " +
    failed
      .slice(0, 3)
      .map((f) => f.message.replace(/^Skipped — /, ""))
      .join(" ") +
    (failed.length > 3 ? " …" : "")
  );
}

async function claimPlan(session, pendingId, decision) {
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(String(pendingId || "")))
    throw httpError(404, "I couldn't find that plan. Nothing was changed.");
  const ref = pendingCollection(session).doc(pendingId);
  const now = session.deps.now();
  let expired = false;
  try {
    return await db(session).runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw httpError(404, "I couldn't find that plan — it may have been replaced. Nothing was changed.");
      const plan = snap.data();
      if (plan.uid !== session.uid || (plan.storeId && plan.storeId !== session.storeId))
        throw httpError(404, "I couldn't find that plan. Nothing was changed.");
      if (plan.status === "done") throw httpError(409, "That plan has already been applied.");
      if (plan.status === "executing") throw httpError(409, "That plan is already being applied.");
      if (plan.status === "cancelled")
        throw httpError(
          409,
          plan.supersededBy
            ? "That plan was replaced by a newer one, so nothing was changed. Use the latest plan card."
            : "That plan was cancelled, so nothing was changed. Ask me again if you still want it.",
        );
      if (plan.status === "expired" || !(Number(plan.expiresAt) > now)) {
        expired = plan.status !== "expired";
        throw httpError(410, "That plan expired after 15 minutes, so nothing was changed. Ask me again and I'll re-check everything.");
      }
      const FV = session.deps.FieldValue;
      tx.set(
        ref,
        decision === "approve"
          ? { status: "executing", approvedAt: FV.serverTimestamp(), approvedAtMs: now }
          : { status: "cancelled", cancelledAt: FV.serverTimestamp(), cancelledAtMs: now },
        { merge: true },
      );
      return { ref, plan };
    });
  } finally {
    if (expired) await ref.set({ status: "expired" }, { merge: true }).catch(() => null);
  }
}

// Resolves a plan. Returns the JSON body for the response (throws httpError for 404/409/410).
export async function resolvePlan(session, { pendingId, decision }) {
  const choice = decision === "approve" ? "approve" : "cancel";
  const { ref, plan } = await claimPlan(session, pendingId, choice);
  if (choice === "cancel")
    return { reply: "Cancelled — nothing was changed.", dataChanged: false, results: [], actions: [] };

  const results = [];
  const executed = [];
  let uiAction = null;
  for (const call of plan.calls || []) {
    if (!OPS[call.kind]) {
      results.push({ itemId: call.itemId, ok: false, message: "Skipped — that action isn't supported." });
      continue;
    }
    if (call.status === "blocked") {
      results.push({ itemId: call.itemId, ok: false, message: "Skipped — " + (call.note || "it couldn't be done.") });
      continue;
    }
    const v = await validateOp(session, call.kind, call.args, newPlanState());
    if (v.status === "blocked") {
      results.push({ itemId: call.itemId, ok: false, message: "Skipped — " + (v.note || "it's no longer valid.") });
      continue;
    }
    try {
      const r = await executeOp(session, call.kind, call.args, v, { pendingId: ref.id });
      executed.push(r);
      results.push({ itemId: call.itemId, ok: true, message: r.message });
      if (r.uiAction) uiAction = r.uiAction;
    } catch (error) {
      console.error("McAssist plan item failed", { kind: call.kind, message: error?.message });
      results.push({
        itemId: call.itemId,
        ok: false,
        message: "Failed — " + (error?.status ? error.message : "that change couldn't be saved. Please try again."),
      });
    }
  }
  const FV = session.deps.FieldValue;
  await ref
    .set(
      {
        status: "done",
        completedAt: FV.serverTimestamp(),
        completedAtMs: session.deps.now(),
        results: results.map((r) => clean(r)),
        appliedCount: executed.length,
      },
      { merge: true },
    )
    .catch((error) => console.error("McAssist could not close plan", { message: error?.message }));
  return {
    reply: outcomeReply(plan, results, executed),
    dataChanged: executed.length > 0,
    results,
    actions: executed.map((r) => r.message),
    ...(uiAction ? { uiAction } : {}),
  };
}
