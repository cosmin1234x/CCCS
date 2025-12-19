// ========================================
// training.js — FAILSAFE BOOTSTRAP + BUTTON FIX
// If buttons don't work, this will show WHY in console + toast.
// ========================================

// ✅ Catch any runtime error so you SEE it
window.addEventListener("error", (e) => {
  console.error("🔥 training.js error:", e.error || e.message);
});

// ✅ Catch module import promise errors
window.addEventListener("unhandledrejection", (e) => {
  console.error("🔥 training.js unhandled rejection:", e.reason);
});

function toast(msg) {
  const el = document.getElementById("toast");
  if (!el) return console.log("[toast]", msg);
  el.textContent = msg;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2200);
}

console.log("✅ training.js loaded (top of file reached)");
toast("Training loaded ✅");

// IMPORTANT: imports MUST be at top-level in a module file.
// If your environment breaks on imports, you’ll see it in console.
import { auth, db } from "./firebase-init.js";
import { signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

/* =========================
   DOM
========================= */
const logoutBtn = document.getElementById("logoutBtn");
const sidebarToggle = document.getElementById("sidebarToggle");
const sidebar = document.querySelector(".sidebar");

const pathList = document.getElementById("pathList");
const lessonTitle = document.getElementById("lessonTitle");
const lessonSubtitle = document.getElementById("lessonSubtitle");
const lessonTag = document.getElementById("lessonTag");
const lessonContent = document.getElementById("lessonContent");

const statusPill = document.getElementById("statusPill");
const moduleXPInfo = document.getElementById("moduleXPInfo");
const moduleXpFill = document.getElementById("moduleXpFill");
const checklistEl = document.getElementById("checklist");
const reflectionInput = document.getElementById("reflectionInput");
const completeModuleBtn = document.getElementById("completeModuleBtn");
const resetModuleBtn = document.getElementById("resetModuleBtn");

const trainingSearch = document.getElementById("trainingSearch");
const trainingSearchBtn = document.getElementById("trainingSearchBtn");
const trainingModuleGrid = document.getElementById("trainingModuleGrid");

const trainingChat = document.getElementById("trainingChat");
const trainingAiForm = document.getElementById("trainingAiForm");
const trainingAiInput = document.getElementById("trainingAiInput");
const trainingAiSend = document.getElementById("trainingAiSend");
const trainingQuickChips = document.getElementById("trainingQuickChips");

const moduleOverlay = document.getElementById("moduleOverlay");
const moduleTitle = document.getElementById("moduleTitle");
const moduleMeta = document.getElementById("moduleMeta");
const moduleBody = document.getElementById("moduleBody");
const closeModuleBtn = document.getElementById("closeModuleBtn");
const startQuizBtn = document.getElementById("startQuizBtn");
const quizArea = document.getElementById("quizArea");

console.log("DOM check:", {
  trainingModuleGrid: !!trainingModuleGrid,
  trainingChat: !!trainingChat,
  moduleOverlay: !!moduleOverlay,
  pathList: !!pathList
});

// If these are false, your HTML IDs don't match.
if (!trainingModuleGrid) toast("Missing #trainingModuleGrid ❌");
if (!trainingChat) toast("Missing #trainingChat ❌");

/* =========================
   STATE
========================= */
let sessionUser = null;
let selectedModuleId = null;
let userDocCache = null;
let unsubUser = null;

let activeQuiz = null;
let quizLocked = false;

/* =========================
   MODULES (minimal demo)
   You can paste your full MODULES list here.
========================= */
const MODULES = [
  {
    id: "grill_station",
    title: "Grill Station – Core",
    tag: "Kitchen",
    level: 1,
    xp: 55,
    durationMins: 10,
    summary: "Cook safely, use timers, and keep quality consistent.",
    steps: ["Pre-shift checks", "Use timers", "Rotate product"],
    checklist: ["Use timers every cook", "Rotate holding product"]
  },
  {
    id: "food_safety_basics",
    title: "Food Safety Basics",
    tag: "Food safety",
    level: 1,
    xp: 40,
    durationMins: 8,
    summary: "Prevent contamination and follow hygiene rules.",
    steps: ["Wash hands", "Avoid cross-contamination", "Sanitise surfaces"],
    checklist: ["Know handwash steps", "Explain cross-contamination"]
  }
];

function calcLevelFromXP(xp) {
  xp = Number(xp) || 0;
  if (xp < 200) return 1;
  if (xp < 450) return 2;
  if (xp < 800) return 3;
  if (xp < 1250) return 4;
  return 5;
}

function getProgressMap() {
  return (userDocCache && userDocCache.trainingProgress && typeof userDocCache.trainingProgress === "object")
    ? userDocCache.trainingProgress
    : {};
}

function isCompleted(moduleId) {
  const prog = getProgressMap()[moduleId];
  return !!(prog && prog.completed);
}

function buildModuleHTML(m) {
  const steps = (m.steps || []).map(s => `<li>${s}</li>`).join("");
  return `
    <div class="lesson-section">
      <h4>Key steps</h4>
      <ul>${steps || "<li>—</li>"}</ul>
    </div>
    <div class="lesson-highlight"><strong>Focus:</strong> ${m.summary || ""}</div>
  `;
}

function buildChecklist(m) {
  if (!checklistEl) return;
  const items = Array.isArray(m.checklist) ? m.checklist : [];
  checklistEl.innerHTML = items.map((t, idx) => `
    <li class="check-item">
      <input type="checkbox" id="chk_${idx}" />
      <span>${t}</span>
    </li>
  `).join("") || `<li class="check-item"><span>—</span></li>`;
}

function openModuleInLesson(moduleId) {
  const m = MODULES.find(x => x.id === moduleId);
  if (!m) return;

  selectedModuleId = moduleId;

  if (lessonTitle) lessonTitle.textContent = m.title;
  if (lessonSubtitle) lessonSubtitle.textContent = m.summary || "";
  if (lessonTag) lessonTag.textContent = m.tag || "Module";
  if (lessonContent) lessonContent.innerHTML = buildModuleHTML(m);

  buildChecklist(m);
  refreshProgressPanel();
  renderPathRail();
}

function openModuleOverlay(moduleId) {
  const m = MODULES.find(x => x.id === moduleId);
  if (!m) return;

  openModuleInLesson(moduleId);

  if (!moduleOverlay) {
    toast("Opened module ✅ (overlay missing)");
    document.getElementById("lessonPanel")?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }

  if (moduleTitle) moduleTitle.textContent = m.title;
  if (moduleMeta) moduleMeta.textContent = `${m.tag} • ${m.xp} XP • ~${m.durationMins} min`;
  if (moduleBody) moduleBody.innerHTML = buildModuleHTML(m);

  if (quizArea) {
    quizArea.style.display = "none";
    quizArea.innerHTML = "";
  }

  moduleOverlay.classList.add("show");
}

function closeModuleOverlay() {
  moduleOverlay?.classList.remove("show");
}

function renderPathRail() {
  if (!pathList) return;

  pathList.innerHTML = MODULES.map((m, idx) => {
    const completed = isCompleted(m.id);
    const active = selectedModuleId === m.id;
    return `
      <li class="path-item ${completed ? "completed" : ""} ${active ? "active" : ""}" data-id="${m.id}">
        <div class="path-step">${completed ? "✓" : (idx + 1)}</div>
        <div class="path-text">
          <div class="path-title-row">
            <span>${m.title}</span>
            <span class="path-tag">${m.tag}</span>
          </div>
          <div class="path-meta">${m.xp} XP • ~${m.durationMins} min • Level ${m.level}</div>
        </div>
      </li>
    `;
  }).join("");
}

function renderModuleGrid(filterText = "") {
  if (!trainingModuleGrid) return;

  const q = String(filterText || "").toLowerCase().trim();
  const list = !q ? MODULES : MODULES.filter(m => `${m.title} ${m.tag} ${m.summary}`.toLowerCase().includes(q));

  trainingModuleGrid.innerHTML = list.map(m => `
    <div class="card" style="padding:12px; border-radius:16px; border:1px solid #e5e7eb;">
      <div style="display:flex; justify-content:space-between; gap:8px;">
        <div>
          <div style="font-weight:900; font-size:0.9rem;">${m.title}</div>
          <div style="font-size:0.78rem; color:#6b7280; margin-top:2px;">${m.tag} • ${m.xp} XP</div>
        </div>
        <button class="btn-ghost open-module-btn" data-id="${m.id}" type="button">Open</button>
      </div>
    </div>
  `).join("");
}

function refreshProgressPanel() {
  const m = selectedModuleId ? MODULES.find(x => x.id === selectedModuleId) : null;
  if (!m) return;

  const completed = isCompleted(m.id);
  if (statusPill) statusPill.textContent = completed ? "Completed" : "In progress";
  if (moduleXPInfo) moduleXPInfo.textContent = `${m.xp} XP • ~${m.durationMins} min • ${m.tag}`;
  if (moduleXpFill) moduleXpFill.style.width = completed ? "100%" : "35%";

  if (completeModuleBtn) completeModuleBtn.disabled = completed;
  if (resetModuleBtn) resetModuleBtn.disabled = !completed;
}

/* =========================
   CLICK BINDINGS (THIS FIXES DEAD BUTTONS)
========================= */

// ✅ Event delegation: Open buttons always work, even after render
if (trainingModuleGrid) {
  trainingModuleGrid.addEventListener("click", (e) => {
    const btn = e.target.closest(".open-module-btn");
    if (!btn) return;
    const id = btn.dataset.id;
    console.log("Open clicked:", id);
    openModuleOverlay(id);
  });
}

// ✅ Path rail click
if (pathList) {
  pathList.addEventListener("click", (e) => {
    const li = e.target.closest(".path-item");
    if (!li) return;
    openModuleInLesson(li.dataset.id);
  });
}

closeModuleBtn?.addEventListener("click", closeModuleOverlay);
moduleOverlay?.addEventListener("click", (e) => {
  if (e.target === moduleOverlay) closeModuleOverlay();
});

trainingSearchBtn?.addEventListener("click", () => renderModuleGrid(trainingSearch?.value || ""));
trainingSearch?.addEventListener("input", () => renderModuleGrid(trainingSearch?.value || ""));

sidebarToggle?.addEventListener("click", () => sidebar?.classList.toggle("sidebar-open"));

logoutBtn?.addEventListener("click", async () => {
  try {
    unsubUser?.();
    await signOut(auth);
    localStorage.removeItem("mc_session_user");
    window.location.href = "index.html";
  } catch (e) {
    console.error(e);
    toast("Logout failed ❌");
  }
});

/* =========================
   FIRESTORE BOOT
========================= */

async function ensureUserDoc(firebaseUser) {
  const userRef = doc(db, "users", firebaseUser.uid);
  const snap = await getDoc(userRef);
  if (snap.exists()) return snap.data();

  const payload = {
    name: firebaseUser.displayName || firebaseUser.email || "User",
    email: String(firebaseUser.email || "").toLowerCase(),
    role: "crew",
    storeId: "store001",
    createdAt: serverTimestamp(),
    trainingXP: 0,
    trainingLevel: 1,
    trainingProgress: {}
  };

  await setDoc(userRef, payload);
  return payload;
}

function startRealtime(uid) {
  unsubUser?.();
  unsubUser = onSnapshot(doc(db, "users", uid), (snap) => {
    userDocCache = snap.data() || {};
    refreshProgressPanel();
  });
}

/* =========================
   INIT
========================= */

function seed() {
  console.log("✅ UI init running");
  renderPathRail();
  renderModuleGrid("");
  if (MODULES[0]) openModuleInLesson(MODULES[0].id);
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }

  const d = await ensureUserDoc(user);
  sessionUser = { id: user.uid, name: d.name, role: d.role, storeId: d.storeId };

  seed();
  startRealtime(user.uid);
});
