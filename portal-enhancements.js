import { auth, db } from "./firebase-init.js";
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  updateProfile,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { renderTraining, renderModule } from "./training-ui.js";
import { renderAssistant, installAssistantLauncher } from "./mcassist-ui.js";
import { renderWaste } from "./waste-page.js";
import {
  setButtonState,
  shake,
  leaveTo,
  authErrorMessage,
} from "./motion.js";
import {
  buildPreviewData,
  loadPreviewState,
  savePreviewState,
} from "./preview-data.js";
import { openSheet } from "./pages-ui.js";
import {
  ic,
  avatar,
  stationStyle,
  timeAgo,
  learningStats,
  isInactive,
} from "./pages-views.js";
import { shiftEnd, VERIFY_STATIONS } from "./portal-core.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const V2 = {
  data: null,
  dataAt: 0,
  enhancing: false,
  listenerInstalled: false,
  chatBusy: false,
  chatCache: new Map(),
};

const $ = (id) => document.getElementById(id);
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c],
  );

const params = new URLSearchParams(location.search);
// Only the two supported sample roles count as preview mode (matches portal.js).
const preview = ["crew", "manager"].includes(params.get("preview"))
  ? params.get("preview")
  : null;
const route = location.pathname.split("/").pop() || "main.html";
const path = route.includes(".") ? route : route + ".html";

function normaliseRole(role) {
  const value = String(role || "")
    .toLowerCase()
    .replace(/[\s_-]/g, "");
  if (["manager", "shiftcreator", "admin"].includes(value)) return "manager";
  if (["crewtrainer", "trainer"].includes(value)) return "crewTrainer";
  return "crew";
}

function roleLabel(role) {
  const value = normaliseRole(role);
  return value === "manager"
    ? "Manager"
    : value === "crewTrainer"
      ? "Crew Trainer"
      : "Crew Member";
}

function initials(name) {
  return (
    String(name || "?")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "?"
  );
}

function formatDate(value) {
  if (!value) return "—";
  try {
    return new Date(
      value + (String(value).length === 10 ? "T12:00:00" : ""),
    ).toLocaleDateString("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
    });
  } catch {
    return String(value);
  }
}

function waitForUser() {
  if (auth.currentUser) return Promise.resolve(auth.currentUser);
  return new Promise((resolve) => {
    const off = onAuthStateChanged(auth, (user) => {
      off();
      resolve(user);
    });
  });
}

async function api(pathname, options = {}) {
  const user = await waitForUser();
  if (!user) throw new Error("Sign in to continue.");
  const token = await user.getIdToken();
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    pathname === "/api/ai-chat" ? 45000 : 12000,
  );
  try {
    const response = await fetch(pathname, {
      ...options,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
        ...(options.headers || {}),
      },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok)
      // status/code let callers tell an account problem (e.g. code
      // "profile-missing") from a connection problem.
      throw Object.assign(
        new Error(data.error || data.reply || "Request failed."),
        { status: response.status, code: data.code || "" },
      );
    return data;
  } catch (error) {
    if (error.name === "AbortError")
      throw new Error("The connection took too long. Please try again.");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

// Used when /api/portal-data is unreachable (e.g. the server has no Firebase
// Admin credentials). Reads only what the security rules allow this user.
async function clientFallbackData() {
  const user = await waitForUser();
  if (!user) throw new Error("Sign in to continue.");
  const profileSnap = await getDoc(doc(db, "users", user.uid));
  if (!profileSnap.exists()) throw new Error("Crew profile not found.");
  const profile = { id: user.uid, ...profileSnap.data() };
  profile.role = normaliseRole(profile.role);
  profile.roleLabel = roleLabel(profile.role);
  profile.verifiedStations = Array.isArray(profile.verifiedStations)
    ? profile.verifiedStations
    : [];
  const store = profile.storeId;
  const manager = profile.role === "manager";
  const trainer = profile.role === "crewTrainer";
  const list = async (ref) => {
    try {
      const snap = await getDocs(ref);
      return snap.docs.map((d) => {
        const value = { id: d.id, ...d.data() };
        for (const key of Object.keys(value))
          if (typeof value[key]?.toMillis === "function")
            value[key] = value[key].toMillis();
        return value;
      });
    } catch {
      return [];
    }
  };
  const verifications = collection(db, "stores", store, "verifications");
  const [team, verificationRows, trainerRows, roleRequests, recognition] =
    await Promise.all([
      manager || trainer
        ? list(query(collection(db, "users"), where("storeId", "==", store)))
        : [],
      manager
        ? list(verifications)
        : list(query(verifications, where("crewId", "==", user.uid))),
      trainer
        ? list(query(verifications, where("trainerId", "==", user.uid)))
        : [],
      manager
        ? list(
            query(
              collection(db, "roleRequests"),
              where("storeId", "==", store),
              where("status", "==", "pending"),
            ),
          )
        : [],
      manager
        ? list(collection(db, "stores", store, "recognition"))
        : list(
            query(
              collection(db, "stores", store, "recognition"),
              where("userId", "==", user.uid),
            ),
          ),
    ]);
  const seen = new Set();
  const allVerifications = [...verificationRows, ...trainerRows]
    .filter((v) => !seen.has(v.id) && seen.add(v.id))
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  return {
    profile,
    team: team.map((value) => ({
      ...value,
      role: normaliseRole(value.role),
      roleLabel: roleLabel(value.role),
      verifiedStations: Array.isArray(value.verifiedStations)
        ? value.verifiedStations
        : [],
    })),
    shifts: [],
    progress: {},
    verifications: allVerifications,
    roleRequests,
    recognition: recognition
      .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
      .slice(0, 60),
    teamProgress: {},
    permissions: {
      canPlanShifts: manager,
      canVerify: trainer,
      canSeeTeam: manager || trainer,
    },
  };
}

// Preview data mirrors portal.js state (so edits made in the preview show up
// on every page) and falls back to the shared sample restaurant.
function previewData() {
  const base = V2.portalState?.user
    ? V2.portalState
    : loadPreviewState(preview) || buildPreviewData(preview);
  const role = normaliseRole(base.user.role);
  const shape = (p) => ({
    ...p,
    role: normaliseRole(p.role),
    roleLabel: roleLabel(p.role),
    verifiedStations: Array.isArray(p.verifiedStations)
      ? p.verifiedStations
      : [],
  });
  return {
    profile: shape(base.user),
    team: (base.team || []).map(shape),
    shifts: base.shifts || [],
    progress: base.progress || {},
    verifications: base.extras?.verifications || [],
    roleRequests: base.extras?.roleRequests || [],
    recognition: base.extras?.recognition || [],
    teamProgress: base.extras?.teamProgress || {},
    permissions: {
      canPlanShifts: role === "manager",
      canVerify: role === "crewTrainer",
      canSeeTeam: role === "manager" || role === "crewTrainer",
    },
    preview: true,
  };
}

// One request at a time: concurrent callers share the in-flight load. A
// forced load (e.g. after McAssist changed something) never reuses a request
// that started before the change.
async function loadData(force = false) {
  if (preview) return previewData();
  if (!force && V2.data && Date.now() - V2.dataAt < 12000) return V2.data;
  if (V2.loading && force) {
    const stale = V2.loading;
    await stale.catch(() => {});
    if (V2.loading && V2.loading !== stale) return V2.loading;
  } else if (V2.loading) return V2.loading;
  V2.loading = (async () => {
    try {
      V2.data = await api("/api/portal-data");
    } catch (error) {
      console.warn(
        "Portal data API unavailable, using browser data fallback",
        error,
      );
      V2.data = await clientFallbackData();
    }
    V2.dataAt = Date.now();
    window.dispatchEvent(new CustomEvent("portal:data", { detail: V2.data }));
    return V2.data;
  })();
  try {
    return await V2.loading;
  } finally {
    V2.loading = null;
  }
}

function pageFor(name) {
  const map = {
    home: "/main.html",
    schedule: "/schedule.html",
    training: "/training.html",
    availability: "/main.html?view=availability",
    rewards: "/break-rewards.html",
    assistant: "/main.html?view=assistant",
    team: "/admin.html",
    manage: "/shifts-admin.html",
    verification: "/verification.html",
    waste: "/waste.html",
  };
  let url = map[name] || "/main.html";
  if (preview)
    url +=
      (url.includes("?") ? "&" : "?") +
      "preview=" +
      encodeURIComponent(preview);
  return url;
}

function isAssistantRoute() {
  return params.get("view") === "assistant";
}

function isTrainingRoute() {
  // wrapped.html is a legacy address that portal.js also routes to learning.
  return (path === "training.html" || path === "wrapped.html") && !params.get("id");
}

function isVerificationRoute() {
  return path === "verification.html";
}

function applyRoleUI(data) {
  const role = normaliseRole(data.profile.role);
  // Role line in the sidebar and the phone More sheet. The approved role from
  // the server wins over the client profile. Only write when it changed, so
  // live re-renders never cause DOM churn.
  const store = data.profile.storeName || data.profile.storeId || "";
  const roleLine = roleLabel(role) + (store ? " · " + store : "");
  document.querySelectorAll(".js-role-line").forEach((el) => {
    if (el.textContent !== roleLine) el.textContent = roleLine;
  });
  // New accounts get their store name from the server on first load.
  document.querySelectorAll(".topbar .store-pill").forEach((el) => {
    if (store && el.textContent !== store) el.textContent = store;
  });

  // portal.js renders every destination (sidebar, tablet rail, phone tabs and
  // the phone More sheet). Only the verification label depends on the role.
  const verifyLabel =
    role === "crewTrainer"
      ? "Verify crew"
      : role === "manager"
        ? "Verifications"
        : "My verifications";
  document
    .querySelectorAll('[data-nav="verification"] .nav-text')
    .forEach((el) => {
      if (el.textContent !== verifyLabel) el.textContent = verifyLabel;
    });
  const crumb = document.querySelector(
    '.app-shell[data-page="verification"] .breadcrumb b',
  );
  if (crumb && crumb.textContent !== verifyLabel) crumb.textContent = verifyLabel;

  const profileButton = $("profileButton");
  if (profileButton) {
    const letter = initials(data.profile.name).slice(0, 1);
    if (profileButton.textContent !== letter) profileButton.textContent = letter;
    profileButton.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      showProfile(data.profile, data);
    };
  }

}

// The signed-in person's profile panel (topbar avatar). Uses live portal
// state when available so McStars, learning and shifts are current.
function showProfile(profile, data) {
  const live = V2.portalState?.user?.id === profile.id ? V2.portalState : null;
  const person = live ? { ...profile, ...live.user } : profile;
  const role = normaliseRole(person.role);
  const now = new Date();
  const shifts = (live?.shifts || data.shifts || [])
    .filter((s) => s.userId === person.id && s.date && s.start && s.end)
    .filter((s) => shiftEnd(s) > now)
    .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  const next = shifts[0];
  const completed = Object.entries(live?.progress || data.progress || {})
    .filter(([, p]) => p?.completed)
    .map(([id]) => id);
  const learn = learningStats(window.McModules?.modules || [], role, completed);
  const stations = Array.isArray(person.verifiedStations)
    ? person.verifiedStations
    : [];
  const pending =
    person.roleRequestStatus === "pending" && person.requestedRole
      ? '<span class="pg-role r-pending">' +
        esc(roleLabel(person.requestedRole)) +
        " requested · waiting for a manager</span>"
      : "";
  const link = (href, iconName, title, sub) =>
    '<a class="pg-profile-link" href="' +
    href +
    '"><span class="pg-action-icon">' +
    ic(iconName) +
    "</span><span class=\"grow\"><b>" +
    title +
    "</b><small>" +
    sub +
    "</small></span>" +
    ic("arrow") +
    "</a>";
  const body =
    '<div class="pg-profile">' +
    '<div class="pg-drawer-top">' +
    avatar(person.name, "xl") +
    "<div><b class=\"pg-profile-name\">" +
    esc(person.name || "Crew member") +
    '</b><span class="pg-role r-' +
    role +
    '">' +
    esc(roleLabel(role)) +
    '</span><p class="pg-muted">' +
    esc(person.storeName || "Store " + (person.storeId || "—")) +
    (person.email ? " · " + esc(person.email) : "") +
    "</p>" +
    pending +
    "</div></div>" +
    '<div class="pg-drawer-stats"><div><b>' +
    (Number(person.stars) || 0) +
    '<span class="pg-star">★</span></b><small>McStars</small></div><div><b>' +
    learn.pct +
    "%</b><small>Learning</small></div><div><b>" +
    stations.length +
    "</b><small>Stations</small></div><div><b>" +
    shifts.length +
    "</b><small>Upcoming</small></div></div>" +
    '<section class="pg-drawer-sec"><h3>' +
    (next && new Date(next.date + "T" + next.start) <= now
      ? "On shift now"
      : "Next shift") +
    "</h3><p>" +
    (next
      ? esc(formatDate(next.date)) +
        " · " +
        esc(next.start) +
        "–" +
        esc(next.end) +
        " · " +
        esc(next.station || "Station TBC")
      : "No upcoming shifts published yet.") +
    "</p></section>" +
    (person.badge
      ? '<section class="pg-drawer-sec"><h3>Badge</h3><p>' +
        esc(person.badge) +
        "</p></section>"
      : "") +
    '<nav class="pg-profile-links" aria-label="Your pages">' +
    link(pageFor("availability"), "clock", "My availability", "When you can work") +
    link(pageFor("rewards"), "star", "My McStars", "Recognition and history") +
    link(pageFor("verification"), "shield", "Station sign-offs", stations.length ? stations.length + " verified" : "Start with your Crew Trainer") +
    link(pageFor("training"), "book", "My learning", learn.completed + " of " + learn.total + " modules") +
    "</nav>" +
    '<div class="pg-sheet-actions"><span class="grow"></span>' +
    (preview
      ? '<a class="btn light" href="/">Sign in to your account</a>'
      : '<button type="button" class="btn dark" id="v2ProfileLogout">Sign out</button>') +
    "</div></div>";
  const sheet = openSheet({ title: "Your profile", body, variant: "panel" });
  sheet.querySelector("#v2ProfileLogout")?.addEventListener("click", async (event) => {
    event.currentTarget.disabled = true;
    try {
      await signOut(auth);
    } finally {
      localStorage.removeItem("mc_session_user");
      location.href = "/";
    }
  });
}

function enhanceSignup() {
  if (path !== "signup.html") return;
  const form = $("authForm");
  if (!form || form.dataset.v2RolePicker === "1") return;
  form.dataset.v2RolePicker = "1";

  const storeField = $("storeId")?.closest(".field");
  if (!storeField) return;

  const oldNote = [...form.querySelectorAll(".form-note")].find((el) =>
    el.textContent.includes("New accounts join as crew"),
  );
  oldNote?.remove();

  // Role picker: selectable cards (styles in portal.css "Signup role picker").
  const svg = (d) =>
    '<svg class="icon" aria-hidden="true" viewBox="0 0 24 24"><path d="' +
    d +
    '"/></svg>';
  const roles = [
    [
      "crew",
      "Crew Member",
      "My shifts, learning and McStars",
      "M19 21a7 7 0 0 0-14 0M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10",
    ],
    [
      "crewTrainer",
      "Crew Trainer",
      "Train crew and sign off stations",
      "m12 3 8 3v7c0 5-8 9-8 9s-8-4-8-9V6l8-3Zm-4 9 3 3 5-5",
    ],
    [
      "manager",
      "Manager",
      "Team, rota and shift planning",
      "M9 4h6v3H9V4Zm6 1h3a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h3m0 8 2 2 4-4",
    ],
  ];
  const notes = {
    crew: "Crew access starts straight away.",
    request:
      "Crew Trainer and Manager access is a request that a Manager at your store approves, so nobody can give themselves extra access. You can use Crew access in the meantime.",
  };
  const picker = document.createElement("fieldset");
  picker.className = "v2-role-picker";
  picker.style.setProperty("--d", "7");
  picker.innerHTML =
    "<legend>What is your role?</legend>" +
    '<div class="v2-role-options">' +
    roles
      .map(
        ([value, title, text, icon], index) =>
          '<label class="v2-role-option"><input type="radio" name="v2Role" value="' +
          value +
          '"' +
          (index === 0 ? " checked" : "") +
          '><span class="role-card"><span class="role-icon">' +
          svg(icon) +
          "</span><span><b>" +
          esc(title) +
          "</b><small>" +
          esc(text) +
          '</small></span><span class="role-check">' +
          svg("m5 12 4 4L19 6") +
          "</span></span></label>",
      )
      .join("") +
    "</div>" +
    '<p class="v2-role-note" aria-live="polite">' +
    esc(notes.crew) +
    "</p>";
  storeField.after(picker);
  const note = picker.querySelector(".v2-role-note");
  picker.addEventListener("change", () => {
    const value = form.querySelector('input[name="v2Role"]:checked')?.value;
    note.textContent = value === "crew" ? notes.crew : notes.request;
    note.classList.toggle("is-pending", value !== "crew");
  });

  form.onsubmit = async (event) => {
    event.preventDefault();
    const button = form.querySelector('[type="submit"]');
    const result = $("authResult");
    const data = new FormData(form);
    const selectedRole = normaliseRole(data.get("v2Role"));
    setButtonState(button, "loading");
    if (result) result.innerHTML = "";

    try {
      const credential = await createUserWithEmailAndPassword(
        auth,
        String(data.get("email") || ""),
        String(data.get("password") || ""),
      );
      await updateProfile(credential.user, {
        displayName: String(data.get("name") || ""),
      });

      const baseProfile = {
        name: String(data.get("name") || "").trim(),
        email: credential.user.email,
        role: "crew",
        requestedRole: selectedRole === "crew" ? "" : selectedRole,
        roleRequestStatus: selectedRole === "crew" ? "approved" : "pending",
        storeId: String(data.get("storeId") || "").trim(),
        stars: 0,
        verifiedStations: [],
        createdAt: serverTimestamp(),
      };
      await setDoc(doc(db, "users", credential.user.uid), baseProfile);

      if (selectedRole !== "crew") {
        await setDoc(doc(db, "roleRequests", credential.user.uid), {
          uid: credential.user.uid,
          name: baseProfile.name,
          email: baseProfile.email,
          storeId: baseProfile.storeId,
          requestedRole: selectedRole,
          status: "pending",
          createdAt: serverTimestamp(),
        });
      }

      setButtonState(button, "success");
      if (result) {
        result.innerHTML =
          '<div class="success">' +
          (selectedRole === "crew"
            ? "Account created. Opening your crew hub…"
            : roleLabel(selectedRole) +
              " requested. You can use Crew access until a Manager approves it.") +
          "</div>";
      }
      setTimeout(
        () => leaveTo("/main.html", document.querySelector(".auth-layout")),
        selectedRole === "crew" ? 650 : 1600,
      );
    } catch (error) {
      setButtonState(button, "idle");
      if (result)
        result.innerHTML =
          '<div class="error">' + esc(authErrorMessage(error)) + "</div>";
      shake(form);
    }
  };
}

// Shared helpers handed to the feature modules (training-ui.js,
// mcassist-ui.js, waste-page.js). Keep this the only coupling point.
function createKit() {
  return {
    $,
    esc,
    api,
    preview,
    params,
    path,
    pageFor,
    roleLabel,
    normaliseRole,
    initials,
    formatDate,
    loadData,
    invalidateData() {
      V2.data = null;
      V2.dataAt = 0;
    },
    portalState: () => V2.portalState,
    // Firebase ID token for modules that need a raw response (status + JSON
    // body), e.g. McAssist plan confirmations that answer 404/410 kindly.
    async idToken() {
      const user = await waitForUser();
      if (!user) throw new Error("Sign in to continue.");
      return user.getIdToken();
    },
    // Persist preview-mode edits (e.g. McAssist demo changes) for this tab so
    // every page of the preview shows them.
    savePreview(state) {
      const target = state?.user ? state : V2.portalState;
      if (preview && target?.user) savePreviewState(preview, target);
    },
    // This tab's saved sample restaurant (same shape savePreview writes), or
    // null. Use it instead of reading sessionStorage keys directly.
    loadPreview() {
      return preview ? loadPreviewState(preview) : null;
    },
    saveProgress,
    toast(text, type) {
      // Stacked, animated toasts from motion.js (design system).
      if (window.McMotion?.toast) return void window.McMotion.toast(text, type);
      const el = $("toast");
      if (!el) return;
      el.textContent = text;
      el.classList.add("show");
      clearTimeout(V2.toastTimer);
      V2.toastTimer = setTimeout(() => el.classList.remove("show"), 3500);
    },
  };
}

// Learning progress lives in users/{uid}/portalTraining/{moduleId}. Preview
// mode keeps progress in this tab only.
async function saveProgress(moduleId, progress) {
  if (preview) {
    const state = V2.portalState;
    if (state?.user) {
      state.progress = { ...(state.progress || {}), [moduleId]: progress };
      savePreviewState(preview, state);
    } else {
      const saved = loadPreviewState(preview) || buildPreviewData(preview);
      saved.progress = { ...(saved.progress || {}), [moduleId]: progress };
      savePreviewState(preview, saved);
    }
    return;
  }
  const user = await waitForUser();
  if (!user) throw new Error("Sign in to save your learning progress.");
  await setDoc(doc(db, "users", user.uid, "portalTraining", moduleId), progress, {
    merge: true,
  });
  if (V2.portalState?.progress) V2.portalState.progress[moduleId] = progress;
}


// ---------------------------------------------------------------------------
// Station verification (verification.html). Two signatures are required: the
// assigned Crew Trainer and the Crew Member. Writes go through the server
// endpoint; preview mode signs sample records in this tab only.
// ---------------------------------------------------------------------------
const verificationHref = (id) =>
  "/verification.html" +
  (id ? "?id=" + encodeURIComponent(id) : "") +
  (preview ? (id ? "&" : "?") + "preview=" + preview : "");

function statusLabel(v) {
  if (v.status === "verified") return "Verified";
  if (v.trainerSignature && !v.crewSignature) return "Crew signature next";
  if (v.crewSignature && !v.trainerSignature) return "Trainer signature next";
  return "Needs both signatures";
}

function verificationRow(v, me) {
  const mine =
    v.status !== "verified" &&
    ((v.crewId === me && !v.crewSignature) ||
      (v.trainerId === me && !v.trainerSignature));
  const tick = (done, label) =>
    '<span class="vf-sig ' +
    (done ? "done" : "") +
    '" title="' +
    label +
    (done ? " signed" : " not signed yet") +
    '">' +
    (done ? ic("check") : "") +
    label +
    "</span>";
  return (
    '<li><a class="vf-row ' +
    (mine ? "is-mine" : "") +
    '" href="' +
    verificationHref(v.id) +
    '"><span class="pg-station-dot" style="' +
    stationStyle(v.station) +
    '" aria-hidden="true"></span><span class="grow"><b>' +
    esc(v.crewName || "Crew member") +
    " · " +
    esc(v.station || "Station") +
    "</b><small>Crew Trainer: " +
    esc(v.trainerName || "—") +
    (v.createdAt ? " · " + esc(timeAgo(v.createdAt)) : "") +
    '</small><span class="vf-sigs">' +
    tick(Boolean(v.trainerSignature), "Trainer") +
    tick(Boolean(v.crewSignature), "Crew") +
    '</span></span><span class="vf-status ' +
    (v.status === "verified" ? "done" : mine ? "mine" : "") +
    '">' +
    esc(mine ? "Your turn" : statusLabel(v)) +
    "</span></a></li>"
  );
}

function verificationList(list, me, emptyText) {
  return list.length
    ? '<ul class="vf-list">' +
        list.map((v) => verificationRow(v, me)).join("") +
        "</ul>"
    : '<p class="pg-muted vf-empty">' + esc(emptyText) + "</p>";
}

function verificationSource(data) {
  // Preview edits live in portal state so they survive navigation in the tab.
  return preview && V2.portalState?.extras
    ? V2.portalState.extras.verifications || []
    : data.verifications || [];
}

async function renderVerificationQueue(data) {
  const content = $("content");
  if (!content) return;
  const role = data.profile.role;
  const me = data.profile.id;
  const all = [...verificationSource(data)].sort(
    (a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0),
  );
  const mine = all.filter(
    (v) =>
      v.status !== "verified" &&
      ((v.crewId === me && !v.crewSignature) ||
        (v.trainerId === me && !v.trainerSignature)),
  );
  const waiting = all.filter(
    (v) => v.status !== "verified" && !mine.includes(v),
  );
  const complete = all.filter((v) => v.status === "verified");
  const title =
    role === "crewTrainer"
      ? "Train. Check. Sign off."
      : role === "manager"
        ? "Station sign-offs"
        : "Your sign-offs";
  const crewOptions = (data.team || [])
    .filter(
      (p) =>
        normaliseRole(p.role) === "crew" && p.id !== me && !isInactive(p),
    )
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const startForm = data.permissions?.canVerify
    ? '<section class="pg-card vf-start"><div class="pg-card-head"><div><h2>Start a verification</h2><p class="pg-muted">Choose a Crew Member and station. It stays open until you both sign.</p></div></div>' +
      (crewOptions.length
        ? '<form id="v2StartVerification" class="pg-form-grid"><label class="pg-field"><span>Crew Member</span><select name="crewId" required><option value="">Choose a Crew Member</option>' +
          crewOptions
            .map(
              (p) =>
                '<option value="' +
                esc(p.id) +
                '">' +
                esc(p.name) +
                "</option>",
            )
            .join("") +
          '</select></label><label class="pg-field"><span>Station</span><select name="station" required>' +
          VERIFY_STATIONS.map(
            (s) => "<option>" + esc(s) + "</option>",
          ).join("") +
          '</select></label><p class="pg-muted pg-span-2" id="v2VerifyHint" aria-live="polite"></p><div id="v2VerifyResult" class="pg-span-2" role="status"></div><div class="pg-form-foot pg-span-2"><span></span><button class="btn" type="submit">' +
          ic("shield") +
          "Open verification</button></div></form>"
        : '<p class="pg-muted">No Crew Members found in your store yet.</p>') +
      "</section>"
    : "";
  const own =
    role === "crew"
      ? (() => {
          const verified = new Set(
            V2.portalState?.user?.verifiedStations ||
              data.profile.verifiedStations ||
              [],
          );
          return (
            '<section class="pg-card"><div class="pg-card-head"><div><h2>Your stations</h2><p class="pg-muted">' +
            verified.size +
            " of " +
            VERIFY_STATIONS.length +
            ' stations verified</p></div></div><div class="vf-stations">' +
            VERIFY_STATIONS.map(
              (s) =>
                '<span class="vf-station ' +
                (verified.has(s) ? "done" : "") +
                '" style="' +
                stationStyle(s) +
                '">' +
                (verified.has(s) ? ic("check") : "") +
                esc(s) +
                "</span>",
            ).join("") +
            "</div></section>"
          );
        })()
      : "";
  content.innerHTML =
    '<div class="pg-page vf-page">' +
    '<header class="pg-head"><div class="pg-head-copy"><p class="pg-eyebrow">Station verification</p><h1>' +
    title +
    '</h1><p class="pg-sub">A verification records a real station check with two signatures: the Crew Trainer’s and the Crew Member’s. It is separate from finishing a learning module.</p></div><div class="pg-head-actions"><span class="pg-role r-' +
    role +
    '">' +
    esc(roleLabel(role)) +
    "</span></div></header>" +
    '<div class="pg-kpis pg-kpis-3">' +
    '<article class="pg-kpi ' +
    (mine.length ? "is-attention" : "") +
    '"><span class="pg-kpi-icon">' +
    ic("spark") +
    "</span><strong>" +
    mine.length +
    '</strong><span class="pg-kpi-label">Waiting for you</span></article>' +
    '<article class="pg-kpi"><span class="pg-kpi-icon">' +
    ic("clock") +
    "</span><strong>" +
    waiting.length +
    '</strong><span class="pg-kpi-label">In progress</span></article>' +
    '<article class="pg-kpi"><span class="pg-kpi-icon">' +
    ic("check") +
    "</span><strong>" +
    complete.length +
    '</strong><span class="pg-kpi-label">Verified</span></article></div>' +
    startForm +
    (role !== "manager" || mine.length
      ? '<section class="pg-card"><div class="pg-card-head"><h2>Needs your signature</h2>' +
        (mine.length
          ? '<span class="pg-pill warn">' + mine.length + "</span>"
          : "") +
        "</div>" +
        verificationList(
          mine,
          me,
          "Nothing to sign right now. When your " +
            (role === "crewTrainer" ? "Crew Member" : "Crew Trainer") +
            " asks you to sign, it appears here.",
        ) +
        "</section>"
      : "") +
    '<section class="pg-card"><div class="pg-card-head"><h2>Waiting for signatures</h2><span class="pg-pill">' +
    waiting.length +
    "</span></div>" +
    verificationList(waiting, me, "No verifications are waiting for anyone else.") +
    "</section>" +
    own +
    '<section class="pg-card"><div class="pg-card-head"><h2>Verified</h2><span class="pg-pill ok">' +
    complete.length +
    "</span></div>" +
    verificationList(complete, me, "No completed verifications yet.") +
    "</section></div>";

  const form = $("v2StartVerification");
  if (!form) return;
  const hint = () => {
    const member = crewOptions.find((p) => p.id === form.crewId.value);
    const done =
      member && (member.verifiedStations || []).includes(form.station.value);
    const open =
      member &&
      all.find(
        (v) =>
          v.crewId === member.id &&
          v.station === form.station.value &&
          v.status !== "verified",
      );
    $("v2VerifyHint").textContent = !member
      ? ""
      : done
        ? member.name + " is already verified on " + form.station.value + "."
        : open
          ? "An open " + form.station.value + " verification already exists. Opening it will take you there."
          : member.name + " has " + (member.verifiedStations || []).length + " verified station(s).";
  };
  const preselect = params.get("crewId");
  if (preselect && crewOptions.some((p) => p.id === preselect))
    form.crewId.value = preselect;
  form.addEventListener("change", hint);
  hint();
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector('[type="submit"]');
    if (button.disabled) return;
    if (!form.crewId.value) {
      $("v2VerifyResult").innerHTML =
        '<div class="error">Choose a Crew Member first.</div>';
      return;
    }
    button.disabled = true;
    try {
      const result = await api("/api/verification", {
        method: "POST",
        body: JSON.stringify({
          action: "create",
          crewId: form.crewId.value,
          station: form.station.value,
        }),
      });
      V2.data = null;
      location.href = verificationHref(result.verification.id);
    } catch (error) {
      $("v2VerifyResult").innerHTML =
        '<div class="error">' + esc(error.message) + "</div>";
      button.disabled = false;
    }
  });
}

/**
 * Signature pad for finger, Apple Pencil and mouse. Strokes are stored as
 * vectors (relative to the pad) so a rotate/resize redraws them crisply.
 */
function setupSignaturePad(canvas, onChange = () => {}) {
  const ctx = canvas.getContext("2d");
  const strokes = [];
  let current = null;
  let width = 0,
    height = 0;
  const lineWidth = (p) =>
    p.type === "pen" ? 1.1 + Math.max(0.1, p.pressure || 0.5) * 2.8 : 2.4;
  const paint = (target, w, h, scale) => {
    target.setTransform(scale, 0, 0, scale, 0, 0);
    target.clearRect(0, 0, w, h);
    target.lineCap = "round";
    target.lineJoin = "round";
    target.strokeStyle = "#1c2433";
    target.fillStyle = "#1c2433";
    for (const stroke of strokes) {
      const pts = stroke.points;
      if (pts.length === 1) {
        target.beginPath();
        target.arc(pts[0].x * w, pts[0].y * h, lineWidth(pts[0]) / 1.6, 0, Math.PI * 2);
        target.fill();
        continue;
      }
      for (let i = 1; i < pts.length; i++) {
        target.lineWidth = lineWidth(pts[i]);
        target.beginPath();
        target.moveTo(pts[i - 1].x * w, pts[i - 1].y * h);
        target.lineTo(pts[i].x * w, pts[i].y * h);
        target.stroke();
      }
    }
  };
  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    if (Math.abs(rect.width - width) < 1 && Math.abs(rect.height - height) < 1)
      return;
    width = rect.width;
    height = rect.height;
    const ratio = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    paint(ctx, width, height, ratio);
  };
  const point = (event) => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
      pressure: event.pressure,
      type: event.pointerType,
    };
  };
  const redraw = () =>
    paint(ctx, width, height, canvas.width / Math.max(1, width));
  canvas.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    resize();
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {}
    current = { points: [point(event)] };
    strokes.push(current);
    canvas.classList.add("has-ink");
    redraw();
    onChange();
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!current) return;
    event.preventDefault();
    const events = event.getCoalescedEvents?.() || [event];
    for (const e of events.length ? events : [event])
      current.points.push(point(e));
    redraw();
  });
  const stop = () => {
    current = null;
  };
  canvas.addEventListener("pointerup", stop);
  canvas.addEventListener("pointercancel", stop);
  canvas.addEventListener("lostpointercapture", stop);
  // Older iPad Safari: stop the page scrolling while signing.
  const block = (event) => event.preventDefault();
  canvas.addEventListener("touchstart", block, { passive: false });
  canvas.addEventListener("touchmove", block, { passive: false });
  if (typeof ResizeObserver === "function")
    new ResizeObserver(() => resize()).observe(canvas);
  window.addEventListener("orientationchange", () => setTimeout(resize, 250));
  resize();
  return {
    clear() {
      strokes.length = 0;
      canvas.classList.remove("has-ink");
      redraw();
      onChange();
    },
    undo() {
      strokes.pop();
      if (!strokes.length) canvas.classList.remove("has-ink");
      redraw();
      onChange();
    },
    hasInk() {
      return strokes.length > 0;
    },
    toDataURL() {
      // Export at up to 2x for a crisp but small PNG (server limit 140 kB).
      for (const scale of [2, 1.25, 1]) {
        const out = document.createElement("canvas");
        out.width = Math.round(width * scale);
        out.height = Math.round(height * scale);
        paint(out.getContext("2d"), width, height, scale);
        const url = out.toDataURL("image/png");
        if (url.length < 130000) return url;
      }
      return "";
    },
  };
}

function signatureBox(title, personName, signature, canSign, party) {
  if (signature) {
    return (
      '<section class="vf-box signed"><div class="vf-box-head"><span class="vf-step done">' +
      ic("check") +
      '</span><div><h3>' +
      esc(title) +
      "</h3><small>" +
      esc(signature.name || signature.typedName || personName) +
      (signature.signedAt ? " · " + esc(timeAgo(signature.signedAt)) : "") +
      '</small></div><span class="vf-status done">Signed</span></div>' +
      (signature.signatureData
        ? '<img class="vf-signature" alt="Signature of ' +
          esc(signature.typedName || personName) +
          '" src="' +
          esc(signature.signatureData) +
          '">'
        : '<p class="vf-typed" aria-label="Typed signature">' +
          esc(signature.typedName || signature.name || personName) +
          "</p>") +
      "</section>"
    );
  }
  if (!canSign) {
    return (
      '<section class="vf-box"><div class="vf-box-head"><span class="vf-step">' +
      (party === "trainer" ? "1" : "2") +
      '</span><div><h3>' +
      esc(title) +
      "</h3><small>" +
      esc(personName) +
      '</small></div><span class="vf-status">Waiting</span></div><p class="pg-muted">Waiting for ' +
      esc(personName) +
      " to sign on their own device or account.</p></section>"
    );
  }
  return (
    '<section class="vf-box is-active"><div class="vf-box-head"><span class="vf-step">' +
    (party === "trainer" ? "1" : "2") +
    '</span><div><h3>' +
    esc(title) +
    "</h3><small>" +
    esc(personName) +
    ' · your signature</small></div><span class="vf-status mine">Your turn</span></div>' +
    '<p class="pg-muted">Sign in the box with your finger, Apple Pencil or mouse, then type your full name. This signs only your side.</p>' +
    '<div class="vf-pad"><canvas class="vf-canvas" id="v2SignatureCanvas" role="img" aria-label="Signature pad"></canvas><span class="vf-pad-hint" aria-hidden="true">Sign here</span><span class="vf-pad-line" aria-hidden="true"></span></div>' +
    '<div class="vf-pad-tools"><button type="button" class="btn light pg-btn-sm" id="v2UndoSignature" disabled>Undo</button><button type="button" class="btn light pg-btn-sm" id="v2ClearSignature" disabled>Clear</button></div>' +
    '<label class="pg-field"><span>Type your full name</span><input id="v2TypedName" autocomplete="name" maxlength="100" placeholder="e.g. ' +
    esc(personName) +
    '"></label>' +
    '<button type="button" class="btn vf-submit" id="v2SubmitSignature" data-party="' +
    esc(party) +
    '" disabled>' +
    ic("check") +
    'Sign verification</button><div id="v2SignResult" role="status"></div></section>'
  );
}

function paintVerificationDetail(content, data, verification) {
  const me = data.profile.id;
  const isCrew = me === verification.crewId;
  const isTrainer =
    me === verification.trainerId && data.permissions?.canVerify;
  const done = verification.status === "verified";
  const steps = [
    ["Trainer signs", Boolean(verification.trainerSignature)],
    ["Crew Member signs", Boolean(verification.crewSignature)],
    ["Station verified", done],
  ];
  content.innerHTML =
    '<div class="pg-page vf-page">' +
    '<a class="pg-link vf-back" href="' +
    verificationHref() +
    '">' +
    ic("left") +
    "All sign-offs</a>" +
    '<section class="vf-hero ' +
    (done ? "is-done" : "") +
    '" style="' +
    stationStyle(verification.station) +
    '"><div><p class="pg-eyebrow">Two-signature check</p><h1>' +
    esc(verification.station) +
    "</h1><p>" +
    esc(verification.crewName) +
    " · Crew Trainer " +
    esc(verification.trainerName) +
    '</p></div><span class="vf-status ' +
    (done ? "done" : "") +
    '">' +
    esc(statusLabel(verification)) +
    "</span></section>" +
    '<ol class="vf-steps" aria-label="Progress">' +
    steps
      .map(
        ([label, ok], i) =>
          '<li class="' +
          (ok ? "done" : "") +
          '"><span>' +
          (ok ? ic("check") : i + 1) +
          "</span>" +
          esc(label) +
          "</li>",
      )
      .join("") +
    "</ol>" +
    (done
      ? '<div class="pg-allclear vf-done">' +
        ic("check") +
        "<div><b>" +
        esc(verification.crewName) +
        " is verified on " +
        esc(verification.station) +
        '.</b><p class="pg-muted">Both signatures are saved and the station is on their profile.</p></div></div>'
      : "") +
    '<div class="vf-grid">' +
    signatureBox(
      "Crew Trainer",
      verification.trainerName,
      verification.trainerSignature,
      isTrainer && !verification.trainerSignature && !done,
      "trainer",
    ) +
    signatureBox(
      "Crew Member",
      verification.crewName,
      verification.crewSignature,
      isCrew && !verification.crewSignature && !done,
      "crew",
    ) +
    "</div>" +
    '<p class="pg-footnote pg-muted">The learning module is preparation. This sign-off records that a Crew Trainer and Crew Member completed the station check together. It does not replace your restaurant’s official training process.' +
    (data.profile.role === "manager"
      ? " Managers can view sign-offs but never sign on someone’s behalf."
      : "") +
    "</p></div>";

  const canvas = $("v2SignatureCanvas");
  if (!canvas) return;
  const submit = $("v2SubmitSignature");
  const name = $("v2TypedName");
  const refresh = () => {
    const ink = pad.hasInk();
    $("v2ClearSignature").disabled = !ink;
    $("v2UndoSignature").disabled = !ink;
    submit.disabled = !ink || name.value.trim().length < 2;
  };
  const pad = setupSignaturePad(canvas, refresh);
  name.addEventListener("input", refresh);
  $("v2ClearSignature").onclick = () => pad.clear();
  $("v2UndoSignature").onclick = () => pad.undo();
  let busy = false;
  submit.onclick = async () => {
    if (busy) return;
    const typedName = name.value.trim();
    const result = $("v2SignResult");
    if (typedName.length < 2) {
      result.innerHTML = '<div class="error">Type your full name first.</div>';
      name.focus();
      return;
    }
    if (!pad.hasInk()) {
      result.innerHTML =
        '<div class="error">Add your signature in the box first.</div>';
      return;
    }
    const signatureData = pad.toDataURL();
    busy = true;
    submit.disabled = true;
    submit.textContent = "Signing…";
    try {
      let fresh, reply;
      if (preview) {
        fresh = signPreviewVerification(verification, isCrew, typedName, signatureData);
        reply =
          fresh.status === "verified"
            ? fresh.crewName + " is now verified on " + fresh.station + "."
            : "Your signature is saved. The other signature is still required.";
      } else {
        const response = await api("/api/verification", {
          method: "POST",
          body: JSON.stringify({
            action: "sign",
            id: verification.id,
            typedName,
            signatureData,
          }),
        });
        fresh = response.verification;
        reply = response.reply;
        V2.data = null;
        V2.dataAt = 0;
      }
      createKit().toast(reply || "Signature saved.");
      paintVerificationDetail(content, data, fresh);
      content.querySelector(".vf-hero")?.scrollIntoView({ block: "start", behavior: "smooth" });
    } catch (error) {
      busy = false;
      submit.textContent = "Sign verification";
      result.innerHTML = '<div class="error">' + esc(error.message) + "</div>";
      refresh();
    }
  };
}

function signPreviewVerification(verification, isCrew, typedName, signatureData) {
  const state = V2.portalState;
  const list = state?.extras?.verifications || [];
  const target = list.find((v) => v.id === verification.id) || verification;
  const signature = {
    uid: state?.user?.id || "preview-self",
    name: state?.user?.name || typedName,
    typedName,
    signatureData,
    signedAt: Date.now(),
  };
  target[isCrew ? "crewSignature" : "trainerSignature"] = signature;
  if (target.crewSignature && target.trainerSignature) {
    target.status = "verified";
    target.completedAt = Date.now();
    const people = [state?.user, ...(state?.team || [])].filter(Boolean);
    for (const person of people)
      if (person.id === target.crewId) {
        person.verifiedStations = [
          ...new Set([...(person.verifiedStations || []), target.station]),
        ];
      }
  }
  if (state) savePreviewState(preview, state);
  return { ...target };
}

async function renderVerificationDetail(data, id) {
  const content = $("content");
  if (!content) return;
  content.innerHTML =
    '<div class="pg-loading" role="status"><span class="pg-spinner" aria-hidden="true"></span>Opening the verification…</div>';
  let verification;
  try {
    if (preview) {
      verification = verificationSource(data).find((v) => v.id === id);
      if (!verification) throw new Error("That verification is not part of this preview.");
    } else {
      const response = await api(
        "/api/verification?id=" + encodeURIComponent(id),
      );
      verification = response.verification;
    }
  } catch (error) {
    content.innerHTML =
      '<div class="pg-page vf-page"><section class="pg-card pg-empty"><h3>We couldn’t open that verification</h3><p>' +
      esc(error.message) +
      '</p><a class="btn" href="' +
      verificationHref() +
      '">Back to sign-offs</a></section></div>';
    return;
  }
  paintVerificationDetail(content, data, verification);
}

async function renderVerification(data) {
  if (!isVerificationRoute()) return;
  const content = $("content");
  if (!content) return;
  if (content.dataset.enhancedPage === "verification") {
    // The queue repaints once after McAssist changed data (e.g. started a
    // verification). An open sign-off (?id=) keeps its signature pad.
    if (!V2.refreshVerification || params.get("id")) return;
  }
  V2.refreshVerification = false;
  content.dataset.enhancedPage = "verification";
  const id = params.get("id");
  if (id) await renderVerificationDetail(data, id);
  else await renderVerificationQueue(data);
}

async function enhanceLoggedIn() {
  const profileButton = $("profileButton");
  if (!profileButton) return;
  const data = await loadData();
  if (V2.portalState?.progressLoaded) data.progress = V2.portalState.progress;
  applyRoleUI(data);
  const kit = createKit();
  if (isTrainingRoute()) renderTraining(data, kit);
  if (path === "module.html") renderModule(data, kit);
  if (isAssistantRoute()) renderAssistant(data, kit);
  else installAssistantLauncher(data, kit);
  if (path === "waste.html") await renderWaste(data, kit);
  await renderVerification(data);
}

async function enhance() {
  if (V2.enhancing) {
    V2.pending = true;
    return;
  }
  V2.enhancing = true;
  try {
    enhanceSignup();
    await enhanceLoggedIn();
  } catch (error) {
    console.warn("McTraining V2 enhancement skipped", error);
  } finally {
    V2.enhancing = false;
    if (V2.pending) {
      V2.pending = false;
      queueMicrotask(enhance);
    }
  }
}

// Explicit lifecycle notifications avoid reacting to our own DOM mutations.
window.addEventListener("portal:render", (event) => {
  V2.portalState = event.detail;
  enhance();
});
// portal.js reloads the data and re-renders; mark the verification queue so
// that render repaints it.
window.addEventListener("mcassist:data-changed", () => {
  V2.refreshVerification = true;
});
window.addEventListener("DOMContentLoaded", enhance);
setTimeout(enhance, 0);

// portal.js shares the data loader and authenticated API helper.
export { loadData, api };
