// Manager-only account lifecycle operations for McAssist: create an account
// (with an invite link), deactivate, reactivate and permanently delete. They
// follow the same validate → confirm → execute → audit flow as every other
// McAssist write (see mcassist-ops.js) and are always high-impact, so the risk
// policy always asks the Manager to confirm them.
import { normalizeRole, roleLabel } from "./portal-admin.js";
import {
  clean,
  db,
  deleteDocsInChunks,
  forgetMember,
  futureShiftsOf,
  loadMember,
  serialise,
  shiftsRef,
  writeAudit,
} from "./mcassist-session.js";

const MANAGER = ["manager"];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function blocked(label, note) {
  return { status: "blocked", label, note };
}

function roleValue(value) {
  const raw = String(value || "crew").trim().toLowerCase().replace(/[\s_-]/g, "");
  if (["crew", "crewmember", "member"].includes(raw)) return "crew";
  if (["crewtrainer", "trainer"].includes(raw)) return "crewTrainer";
  if (["manager", "shiftmanager"].includes(raw)) return "manager";
  return null;
}

async function ignoreMissingUser(promise) {
  try {
    return await promise;
  } catch (error) {
    if (error?.code === "auth/user-not-found") return null;
    throw error;
  }
}

async function authUserByEmail(session, email) {
  try {
    return await session.deps.auth().getUserByEmail(email);
  } catch (error) {
    if (error?.code === "auth/user-not-found") return null;
    throw error;
  }
}

function plural(n, word) {
  return n + " " + word + (n === 1 ? "" : "s");
}

export const accountOps = {
  create_member: {
    roles: MANAGER,
    risk: (args) => (roleValue(args.role) === "manager" ? "high" : "medium"),
    async validate(session, args) {
      const name = String(args.name || "").replace(/\s+/g, " ").trim().slice(0, 100);
      const email = String(args.email || "").trim().toLowerCase().slice(0, 200);
      const role = roleValue(args.role);
      const rate = args.hourlyRate == null || args.hourlyRate === "" ? null : Math.round(Number(args.hourlyRate) * 100) / 100;
      const label =
        "New account · " +
        (name || "?") +
        " · " +
        (email || "no email") +
        " · " +
        (role ? roleLabel(role) : String(args.role)) +
        (rate != null && Number.isFinite(rate) ? " · £" + rate.toFixed(2) + "/h" : "");
      if (name.length < 2) return blocked(label, "I need the person's full name.");
      if (!EMAIL.test(email)) return blocked(label, "I need a valid email address so they can sign in.");
      if (!role) return blocked(label, "Role must be Crew Member, Crew Trainer or Manager.");
      if (rate != null && (!Number.isFinite(rate) || rate < 0 || rate > 100))
        return blocked(label, "Hourly rate must be between £0 and £100.");
      const existing = await authUserByEmail(session, email);
      if (existing) return blocked(label, email + " already has an account.");
      const profiles = await db(session).collection("users").where("email", "==", email).limit(1).get();
      if (!profiles.empty) return blocked(label, email + " already has a crew profile.");
      return {
        status: "ok",
        label,
        detail:
          "Creates their sign-in and a " +
          roleLabel(role) +
          " profile in " +
          (session.profile.storeName || "your store") +
          ". You'll get an invite link to share so they can set their password.",
        note: role === "manager" ? "They'll have full Manager access to your store." : "",
        name,
        email,
        role,
        rate,
        badge: String(args.badge || "").trim().slice(0, 80),
      };
    },
    async execute(session, args, v) {
      const auth = session.deps.auth();
      const created = await auth.createUser({ email: v.email, displayName: v.name, emailVerified: false, disabled: false });
      const FV = session.deps.FieldValue;
      const profile = clean({
        name: v.name,
        email: v.email,
        role: v.role,
        storeId: session.storeId,
        storeName: session.profile.storeName || "",
        hourlyRate: v.rate ?? undefined,
        stars: 0,
        badge: v.badge || "",
        notes: "",
        availability: {},
        verifiedStations: [],
        status: "active",
        createdAt: FV.serverTimestamp(),
        createdBy: session.uid,
        source: "mcassist",
      });
      try {
        await db(session).collection("users").doc(created.uid).set(profile);
      } catch (error) {
        await ignoreMissingUser(auth.deleteUser(created.uid)).catch(() => null);
        throw error;
      }
      let link = null;
      try {
        link = await auth.generatePasswordResetLink(v.email);
      } catch (error) {
        console.warn("McAssist invite link unavailable", { code: error?.code });
      }
      session.roster.push({ id: created.uid, name: v.name, email: v.email, role: v.role, storeId: session.storeId, status: "active" });
      return {
        message:
          "Created " +
          v.name +
          "'s account (" +
          roleLabel(v.role) +
          ")" +
          (link
            ? ". Invite link to share with them: " + link
            : ". They can use “Forgot password” on the sign-in page with " + v.email + " to set a password."),
        target: { id: created.uid, name: v.name },
        after: { email: v.email, role: v.role, hourlyRate: v.rate ?? null },
        invite: { name: v.name, email: v.email, link },
      };
    },
  },

  deactivate_member: {
    roles: MANAGER,
    risk: () => "high",
    async validate(session, args) {
      const member = await loadMember(session, args.memberId, { fresh: true });
      const label = "Deactivate " + (member?.name || args.memberName || "team member") + "'s account";
      if (!member) return blocked(label, "That person is no longer in your store.");
      if (member.id === session.uid) return blocked(label, "You can't deactivate your own account.");
      if (String(member.status || "").toLowerCase() === "inactive") return blocked(label, (member.name || "They") + " is already deactivated.");
      const { future } = await futureShiftsOf(session, member.id);
      const removeShifts = args.deleteFutureShifts === true;
      return {
        status: "ok",
        label,
        detail:
          "Signs them out and blocks sign-in. " +
          (future.length
            ? removeShifts
              ? plural(future.length, "upcoming shift") + " will be removed."
              : "Their " + plural(future.length, "upcoming shift") + " stay on the rota."
            : "They have no upcoming shifts.") +
          " You can reactivate them later.",
        note: normalizeRole(member.role) === "manager" ? (member.name || "They") + " is a Manager." : "",
        member,
        removeShifts,
        futureCount: future.length,
        reason: String(args.reason || "").trim().slice(0, 300),
      };
    },
    async execute(session, args, v) {
      const auth = session.deps.auth();
      await ignoreMissingUser(auth.updateUser(v.member.id, { disabled: true }));
      await ignoreMissingUser(auth.revokeRefreshTokens(v.member.id));
      const FV = session.deps.FieldValue;
      await db(session)
        .collection("users")
        .doc(v.member.id)
        .set(
          { status: "inactive", deactivatedAt: FV.serverTimestamp(), deactivatedBy: session.uid, deactivationReason: v.reason },
          { merge: true },
        );
      let removed = 0;
      if (v.removeShifts) {
        const { future } = await futureShiftsOf(session, v.member.id);
        await deleteDocsInChunks(session, future.map((s) => shiftsRef(session).doc(s.id)));
        removed = future.length;
      }
      forgetMember(session, v.member.id);
      return {
        message:
          "Deactivated " + (v.member.name || "their") + "'s account" + (removed ? " and removed " + plural(removed, "upcoming shift") : ""),
        target: v.member,
        before: { status: v.member.status || "active" },
        after: { status: "inactive", futureShiftsRemoved: removed },
        details: { reason: v.reason },
      };
    },
  },

  reactivate_member: {
    roles: MANAGER,
    risk: () => "medium",
    async validate(session, args) {
      const member = await loadMember(session, args.memberId, { fresh: true });
      const label = "Reactivate " + (member?.name || args.memberName || "team member") + "'s account";
      if (!member) return blocked(label, "That person is no longer in your store.");
      if (String(member.status || "").toLowerCase() !== "inactive") return blocked(label, (member.name || "They") + " is already active.");
      return { status: "ok", label, detail: "Lets them sign in again with their existing password.", member };
    },
    async execute(session, args, v) {
      await ignoreMissingUser(session.deps.auth().updateUser(v.member.id, { disabled: false }));
      const FV = session.deps.FieldValue;
      await db(session)
        .collection("users")
        .doc(v.member.id)
        .set({ status: "active", reactivatedAt: FV.serverTimestamp(), reactivatedBy: session.uid }, { merge: true });
      forgetMember(session, v.member.id);
      return {
        message: "Reactivated " + (v.member.name || "their") + "'s account",
        target: v.member,
        before: { status: "inactive" },
        after: { status: "active" },
      };
    },
  },

  delete_member: {
    roles: MANAGER,
    risk: () => "high",
    auditsItself: true,
    async validate(session, args) {
      const member = await loadMember(session, args.memberId, { fresh: true });
      const label = "Delete " + (member?.name || args.memberName || "team member") + "'s account permanently";
      if (!member) return blocked(label, "That person is no longer in your store.");
      if (member.id === session.uid) return blocked(label, "You can't delete your own account.");
      const { future, past } = await futureShiftsOf(session, member.id);
      return {
        status: "warning",
        label,
        detail:
          "Removes their sign-in, profile, learning records and role request" +
          (future.length ? ", plus " + plural(future.length, "upcoming shift") + "." : ". They have no upcoming shifts.") +
          (past.length ? " " + plural(past.length, "past shift") + (past.length === 1 ? " stays" : " stay") + " for history." : ""),
        note:
          "Permanent — this can't be undone." +
          (normalizeRole(member.role) === "manager" ? " " + (member.name || "They") + " is a Manager." : ""),
        member,
        futureCount: future.length,
        pastCount: past.length,
      };
    },
    async execute(session, args, v, { pendingId } = {}) {
      const store = db(session);
      const member = v.member;
      const { future, past } = await futureShiftsOf(session, member.id);
      // Audit first so there is always a record, even if a later step fails.
      await writeAudit(session, {
        action: "delete_member",
        target: member,
        before: {
          name: member.name || "",
          email: member.email || "",
          role: normalizeRole(member.role),
          hourlyRate: member.hourlyRate ?? null,
          stars: Number(member.stars) || 0,
          badge: member.badge || "",
          verifiedStations: Array.isArray(member.verifiedStations) ? member.verifiedStations : [],
        },
        after: null,
        details: { futureShiftsDeleted: future.length, pastShiftsKept: past.length },
        pendingId,
      });
      await deleteDocsInChunks(session, future.map((s) => shiftsRef(session).doc(s.id)));
      const training = await store.collection("users").doc(member.id).collection("portalTraining").limit(500).get();
      await deleteDocsInChunks(session, training.docs.map((d) => d.ref));
      const request = await store.collection("roleRequests").doc(member.id).get();
      if (request.exists && (!request.data()?.storeId || request.data().storeId === session.storeId))
        await store.collection("roleRequests").doc(member.id).delete();
      await store.collection("users").doc(member.id).delete();
      await ignoreMissingUser(session.deps.auth().deleteUser(member.id));
      forgetMember(session, member.id);
      session.roster = session.roster.filter((m) => m.id !== member.id);
      return {
        message:
          "Deleted " +
          (member.name || "their") +
          "'s account" +
          (future.length ? " and " + plural(future.length, "upcoming shift") : "") +
          (past.length ? " (" + plural(past.length, "past shift") + " kept for history)" : ""),
        target: member,
        before: serialise({ name: member.name, role: member.role }),
      };
    },
  },
};
