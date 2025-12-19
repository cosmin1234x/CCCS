// ========================================
// training.js — McTraining 3.0 (MATCHES YOUR HTML)
// - Module library + filters + search
// - Module player (tabs) + checklist + reflection
// - Quiz (Start + Next fixed)
// - Firestore progress + XP/Level
// - AI chat: open module / quiz / ask via /api/mcassist
// ========================================

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
   DOM — matches your HTML
========================= */

// sidebar
const sidebarUserName = document.getElementById("sidebarUserName");
const sidebarUserRole = document.getElementById("sidebarUserRole");
const logoutBtn = document.getElementById("logoutBtn");
const sidebar = document.querySelector(".sidebar");
const sidebarToggle = document.getElementById("sidebarToggle");

// top bar
const headerLevel = document.getElementById("headerLevel");
const headerXP = document.getElementById("headerXP");
const xpProgressFill = document.getElementById("xpProgressFill");
const topUserName = document.getElementById("topUserName");
const topUserRole = document.getElementById("topUserRole");
const userAvatar = document.getElementById("userAvatar");
const quickQuizBtn = document.getElementById("quickQuizBtn");

// library
const moduleSearch = document.getElementById("moduleSearch");
const moduleSearchBtn = document.getElementById("moduleSearchBtn");
const refreshModulesBtn = document.getElementById("refreshModulesBtn");
const filterRow = document.getElementById("filterRow");
const moduleGrid = document.getElementById("moduleGrid");

// player header
const playerTitle = document.getElementById("playerTitle");
const playerSubtitle = document.getElementById("playerSubtitle");
const playerMeta = document.getElementById("playerMeta");
const playerStatus = document.getElementById("playerStatus");

// tabs
const tabs = Array.from(document.querySelectorAll(".tab"));
const tabPanels = Array.from(document.querySelectorAll(".tabPanel"));
const tabStage = document.getElementById("tabStage");

// lesson
const lessonSteps = document.getElementById("lessonSteps");
const doList = document.getElementById("doList");
const dontList = document.getElementById("dontList");
const moduleXPInfo = document.getElementById("moduleXPInfo");
const moduleBarFill = document.getElementById("moduleBarFill");
const reflectionInput = document.getElementById("reflectionInput");
const completeModuleBtn = document.getElementById("completeModuleBtn");
const resetModuleBtn = document.getElementById("resetModuleBtn");

// checklist
const checklistEl = document.getElementById("checklist");

// quiz
const quizArea = document.getElementById("quizArea");
const quizCounter = document.getElementById("quizCounter");
const quizScore = document.getElementById("quizScore");
const quizQuestion = document.getElementById("quizQuestion");
const quizOptions = document.getElementById("quizOptions");
const quizExplain = document.getElementById("quizExplain");
const startQuizBtn = document.getElementById("startQuizBtn");
const nextQuizBtn = document.getElementById("nextQuizBtn");

// chat
const trainingChat = document.getElementById("trainingChat");
const trainingAiForm = document.getElementById("trainingAiForm");
const trainingAiInput = document.getElementById("trainingAiInput");
const trainingAiSend = document.getElementById("trainingAiSend");
const trainingQuickChips = document.getElementById("trainingQuickChips");

// toast
const toastEl = document.getElementById("toast");

/* =========================
   STATE
========================= */

let sessionUser = null;
let userDocCache = null;
let unsubUser = null;

let selectedModuleId = null;
let activeFilter = "All";

// quiz state
let activeQuiz = null; // { moduleId, questions:[{q, options, answer, explain}], index, score, locked }
let lastQuizModuleId = null;

/* =========================
   MODULE LIBRARY (edit freely)
========================= */

const MODULES = [
  {
    id: "food_safety_basics",
    title: "Food Safety Basics",
    tag: "Food safety",
    level: 1,
    xp: 40,
    durationMins: 8,
    keywords: ["food safety", "hygiene", "contamination", "temps", "allergens", "uk"],
    summary: "Prevent contamination, follow time/temp rules, and protect customers (UK focus).",
    steps: [
      "Wash hands properly: warm water + soap, scrub all areas, dry fully.",
      "Avoid cross-contamination: separate raw vs ready-to-eat items and tools.",
      "Follow time/temp rules for holding, chilling, and reheating (use store logs).",
      "Clean-as-you-go: sanitise surfaces and tools using approved solution.",
      "Allergens: follow your store allergen process and prevent contact."
    ],
    doDont: {
      do: ["Change gloves between tasks", "Use separate tools for raw/cooked", "Use sanitiser correctly"],
      dont: ["Store raw above cooked", "Ignore allergen requests", "Reuse dirty cloths without sanitiser"]
    },
    checklist: [
      "I know the handwash steps",
      "I can explain cross-contamination",
      "I know how to use sanitiser correctly",
      "I take allergen requests seriously"
    ],
    quiz: [
      {
        q: "Best way to prevent cross-contamination?",
        options: ["Use same tools for speed", "Separate raw and ready-to-eat items + tools", "Only wipe surfaces at end"],
        answer: 1,
        explain: "Separation prevents bacteria/allergens spreading."
      },
      {
        q: "When should you change gloves?",
        options: ["Only if ripped", "Between tasks/foods", "Once per hour"],
        answer: 1,
        explain: "Change gloves between tasks to stop transferring bacteria/allergens."
      }
    ]
  },

  {
    id: "grill_station",
    title: "Grill Station – Core",
    tag: "Kitchen",
    level: 1,
    xp: 55,
    durationMins: 10,
    keywords: ["grill", "meat", "burger", "cook", "timers", "uk"],
    summary: "Cook safely, use timers, and keep quality consistent during rush.",
    steps: [
      "Pre-shift: confirm grill is ready, tools are clean, timers are working.",
      "Load patties evenly; don’t overcrowd.",
      "Use the correct cook cycle/timer every time (no guessing).",
      "Hold product correctly and rotate (first-in-first-out).",
      "Between rushes: quick scrape/clean using approved method."
    ],
    doDont: {
      do: ["Use timers every cook", "Call out product levels", "Rotate held product"],
      dont: ["Guess cook time", "Mix old/new without rotation", "Ignore holding rules"]
    },
    checklist: [
      "I can do pre-shift setup",
      "I use timers every cook",
      "I rotate held product properly",
      "I keep tools separated"
    ],
    quiz: [
      {
        q: "What prevents over/under cooking best?",
        options: ["Cook by eye", "Use timers consistently", "Flip early"],
        answer: 1,
        explain: "Timers remove guessing and keep results consistent."
      }
    ]
  },

  {
    id: "fryer_station",
    title: "Fry Station – Quality & Safety",
    tag: "Kitchen",
    level: 1,
    xp: 50,
    durationMins: 9,
    keywords: ["fryer", "fries", "oil", "timers", "burns", "uk"],
    summary: "Crisp fries, safe oil handling, and fast rhythm without burns.",
    steps: [
      "Check fryer is operating normally and baskets are safe to use.",
      "Use correct basket fill guideline to prevent soggy fries.",
      "Use the timer for every drop; shake as per store practice.",
      "Season consistently (if your store uses salting station).",
      "Hold correctly, rotate, and keep the station tidy."
    ],
    doDont: {
      do: ["Use timer every drop", "Keep area dry to prevent slips", "Rotate fries properly"],
      dont: ["Overfill baskets", "Rush and splash oil", "Serve fries out of quality window"]
    },
    checklist: [
      "I follow fill guidelines",
      "I use timers for every drop",
      "I understand holding/rotation",
      "I work safely around hot oil"
    ]
  },

  {
    id: "uk_build_big_mac",
    title: "Build – Big Mac (UK training)",
    tag: "Product build",
    level: 2,
    xp: 70,
    durationMins: 10,
    keywords: ["big mac", "build", "uk", "assemble", "sandwich"],
    summary: "Build a Big Mac cleanly and consistently using your store build card order.",
    steps: [
      "Prep area: clean hands/gloves, correct packaging ready.",
      "Use correct bun set and toast per store process.",
      "Apply correct sauce/condiment amounts (follow your build card).",
      "Add salad/pickles in the correct order for even coverage.",
      "Add patties using correct tools; keep the build neat and stable.",
      "Close, wrap/box, and present cleanly."
    ],
    doDont: {
      do: ["Follow build card order", "Keep ingredients centered", "Wipe spills immediately"],
      dont: ["Guess sauce amounts", "Over-stack and crush the build", "Cross-contaminate tools"]
    },
    checklist: [
      "I follow a consistent build order",
      "I keep portions consistent",
      "I package neatly"
    ],
    quiz: [
      {
        q: "What matters most for consistency on builds?",
        options: ["Going fast only", "Following build card order + portions", "Adding extra sauce automatically"],
        answer: 1,
        explain: "Order + correct portions = consistent results."
      }
    ]
  },

  {
    id: "drive_thru_speed",
    title: "Drive-thru – Speed & Clarity",
    tag: "Drive-thru",
    level: 2,
    xp: 60,
    durationMins: 10,
    keywords: ["drive thru", "drive-thru", "speed", "headset", "park", "uk"],
    summary: "Clear communication and fast workflow without mistakes.",
    steps: [
      "Speak clearly on headset and confirm key items/drinks.",
      "Use a calm pace; accuracy beats redoing orders.",
      "Use 'park' when needed per store process and manager guidance.",
      "Prep condiments/napkins while payment happens.",
      "Hand-off with a final confirmation."
    ],
    doDont: {
      do: ["Repeat key items", "Keep calm tone", "Prep while payment happens"],
      dont: ["Rush and mishear", "Forget final confirmation", "Skip park process"]
    },
    checklist: [
      "I speak clearly on headset",
      "I repeat the order back",
      "I understand when to park",
      "I confirm at hand-off"
    ]
  },

  {
    id: "customer_recovery",
    title: "Customer Recovery – Fixing Mistakes",
    tag: "Customer experience",
    level: 2,
    xp: 55,
    durationMins: 9,
    keywords: ["complaint", "refund", "apology", "replacement", "uk"],
    summary: "Own the issue, fix it fast, keep the customer calm.",
    steps: [
      "Listen without interrupting.",
      "Apologise and acknowledge the issue.",
      "Offer the correct fix (replace/remake/manager support).",
      "Thank them for telling you.",
      "Share the learning with the team."
    ],
    doDont: {
      do: ["Stay calm", "Fix quickly", "Ask manager if needed"],
      dont: ["Argue", "Blame the customer", "Delay the fix"]
    },
    checklist: [
      "I stay calm with complaints",
      "I follow apology + fix flow",
      "I can get help quickly"
    ]
  }
];

/* =========================
   HELPERS
========================= */

function showToast(msg) {
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  setTimeout(() => toastEl.classList.remove("show"), 2200);
}

function normalize(s) {
  return String(s || "").toLowerCase().trim();
}

function calcLevelFromXP(xp) {
  xp = Number(xp) || 0;
  if (xp < 200) return 1;
  if (xp < 450) return 2;
  if (xp < 800) return 3;
  if (xp < 1250) return 4;
  return 5;
}

function levelRange(level) {
  // keep in sync with calcLevelFromXP
  if (level <= 1) return { min: 0, max: 200 };
  if (level === 2) return { min: 200, max: 450 };
  if (level === 3) return { min: 450, max: 800 };
  if (level === 4) return { min: 800, max: 1250 };
  return { min: 1250, max: 1600 };
}

function getProgressMap() {
  const p = userDocCache?.trainingProgress;
  return (p && typeof p === "object") ? p : {};
}

function isCompleted(moduleId) {
  const p = getProgressMap()[moduleId];
  return !!p?.completed;
}

function getSelectedModule() {
  return selectedModuleId ? MODULES.find(m => m.id === selectedModuleId) : null;
}

function findBestModuleByText(text) {
  const q = normalize(text);
  if (!q) return null;

  const exact = MODULES.find(m => normalize(m.id) === q);
  if (exact) return exact;

  const scored = MODULES.map(m => {
    const hay = `${m.title} ${m.tag} ${(m.keywords || []).join(" ")} ${m.summary || ""}`.toLowerCase();
    let score = 0;
    q.split(/\s+/).forEach(w => {
      if (!w) return;
      if (hay.includes(w)) score += 2;
      if (normalize(m.title).includes(w)) score += 3;
      if (normalize(m.tag).includes(w)) score += 2;
    });
    if (normalize(m.title).includes(q)) score += 8;
    return { m, score };
  }).sort((a,b) => b.score - a.score);

  if (!scored.length || scored[0].score <= 0) return null;
  return scored[0].m;
}

function escapeHTML(str) {
  return String(str || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* =========================
   FIRESTORE: USER DOC
========================= */

function loadSessionUser() {
  try { return JSON.parse(localStorage.getItem("mc_session_user")); }
  catch { return null; }
}

function saveSessionUser(u) {
  localStorage.setItem("mc_session_user", JSON.stringify(u));
}

async function ensureUserDoc(firebaseUser) {
  const userRef = doc(db, "users", firebaseUser.uid);
  const snap = await getDoc(userRef);
  if (snap.exists()) return snap.data();

  const cached = loadSessionUser() || {};
  const payload = {
    name: cached.name || firebaseUser.displayName || firebaseUser.email || "User",
    email: String(firebaseUser.email || "").toLowerCase(),
    role: cached.role || "crew",
    storeId: cached.storeId || "store001",
    createdAt: serverTimestamp(),
    trainingXP: 0,
    trainingLevel: 1,
    trainingProgress: {}
  };

  await setDoc(userRef, payload);
  return payload;
}

function stopRealtime() {
  try { unsubUser?.(); } catch {}
  unsubUser = null;
}

function startRealtime(uid) {
  stopRealtime();
  unsubUser = onSnapshot(doc(db, "users", uid), (snap) => {
    if (!snap.exists()) return;
    userDocCache = snap.data() || {};

    // top bar + user
    const xp = Number(userDocCache.trainingXP) || 0;
    const lvlStored = Number(userDocCache.trainingLevel) || calcLevelFromXP(xp);
    const lvl = calcLevelFromXP(xp);

    if (headerXP) headerXP.textContent = String(xp);
    if (headerLevel) headerLevel.textContent = String(lvl);

    const range = levelRange(lvl);
    const pct = range.max > range.min ? Math.max(0, Math.min(1, (xp - range.min) / (range.max - range.min))) : 0;
    if (xpProgressFill) xpProgressFill.style.width = `${Math.round(pct * 100)}%`;

    if (lvlStored !== lvl) {
      updateDoc(doc(db, "users", uid), { trainingLevel: lvl }).catch(() => {});
    }

    // re-render UI pieces that depend on completion
    renderFilters();
    renderModuleGrid();
    refreshPlayer();
  });
}

/* =========================
   RENDER: FILTERS + GRID
========================= */

function renderFilters() {
  if (!filterRow) return;

  const tags = Array.from(new Set(MODULES.map(m => m.tag))).sort();
  const all = ["All", ...tags];

  filterRow.innerHTML = all.map(t => {
    const active = t === activeFilter ? "active" : "";
    return `<button class="chip ${active}" type="button" data-tag="${escapeHTML(t)}">${escapeHTML(t)}</button>`;
  }).join("");

  // (re)bind clicks via delegation once
  if (!filterRow.dataset.bound) {
    filterRow.addEventListener("click", (e) => {
      const btn = e.target.closest(".chip");
      if (!btn) return;
      activeFilter = btn.dataset.tag || "All";
      renderFilters();
      renderModuleGrid();
    });
    filterRow.dataset.bound = "1";
  }
}

function renderModuleGrid() {
  if (!moduleGrid) return;

  const q = normalize(moduleSearch?.value || "");
  const list = MODULES.filter(m => {
    if (activeFilter !== "All" && m.tag !== activeFilter) return false;
    if (!q) return true;
    const hay = `${m.title} ${m.tag} ${(m.keywords || []).join(" ")} ${m.summary || ""}`.toLowerCase();
    return hay.includes(q);
  });

  moduleGrid.innerHTML = list.length ? list.map(m => {
    const done = isCompleted(m.id);
    return `
      <div class="mcard" data-id="${escapeHTML(m.id)}">
        <div class="top">
          <div>
            <h3>${escapeHTML(m.title)}</h3>
            <div class="meta">
              <span class="tag">${escapeHTML(m.tag)}</span>
              <span>${m.xp} XP</span>
              <span>~${m.durationMins || 8}m</span>
              <span>Lvl ${m.level || 1}</span>
            </div>
          </div>
          ${done ? `<span class="badgeDone">Completed</span>` : ``}
        </div>
        <p>${escapeHTML(m.summary || "")}</p>
        <div class="actions">
          <button class="btn btn-ghost openBtn" type="button" data-id="${escapeHTML(m.id)}">Open</button>
        </div>
      </div>
    `;
  }).join("") : `<div style="color:rgba(238,242,255,.72); font-size:.9rem;">No modules found.</div>`;

  // bind open via delegation once
  if (!moduleGrid.dataset.bound) {
    moduleGrid.addEventListener("click", (e) => {
      const btn = e.target.closest(".openBtn");
      const card = e.target.closest(".mcard");
      const id = btn?.dataset.id || card?.dataset.id;
      if (!id) return;
      openModule(id);
    });
    moduleGrid.dataset.bound = "1";
  }
}

/* =========================
   PLAYER (LESSON/CHECKLIST/QUIZ/ASK)
========================= */

function openModule(moduleId) {
  const m = MODULES.find(x => x.id === moduleId);
  if (!m) return;

  selectedModuleId = m.id;
  lastQuizModuleId = m.id;

  // hero
  if (playerTitle) playerTitle.textContent = m.title;
  if (playerSubtitle) playerSubtitle.textContent = m.summary || "Training module";
  if (playerMeta) playerMeta.textContent = `${m.tag} • ${m.xp} XP • ~${m.durationMins || 8}m • Level ${m.level || 1}`;

  // lesson lists
  if (lessonSteps) {
    lessonSteps.innerHTML = (m.steps || []).length
      ? m.steps.map(s => `<li>${escapeHTML(s)}</li>`).join("")
      : `<li>No steps added yet.</li>`;
  }

  const doItems = m.doDont?.do || [];
  const dontItems = m.doDont?.dont || [];
  if (doList) doList.innerHTML = doItems.length ? doItems.map(s => `<li>${escapeHTML(s)}</li>`).join("") : `<li>—</li>`;
  if (dontList) dontList.innerHTML = dontItems.length ? dontItems.map(s => `<li>${escapeHTML(s)}</li>`).join("") : `<li>—</li>`;

  // checklist
  renderChecklist(m);

  // progress UI
  refreshPlayer();

  // quiz buttons
  if (startQuizBtn) startQuizBtn.disabled = false;
  resetQuizUI();

  // small animation restart
  if (tabStage) {
    tabStage.style.animation = "none";
    // force reflow
    void tabStage.offsetHeight;
    tabStage.style.animation = "";
  }
}

function renderChecklist(m) {
  if (!checklistEl) return;
  const items = Array.isArray(m.checklist) ? m.checklist : [];
  checklistEl.innerHTML = items.length ? items.map((t, idx) => {
    return `
      <div class="checkitem">
        <input type="checkbox" id="ck_${idx}" />
        <span>${escapeHTML(t)}</span>
      </div>
    `;
  }).join("") : `<div style="color:rgba(238,242,255,.75)">No checklist items.</div>`;
}

function refreshPlayer() {
  const m = getSelectedModule();

  if (!m) {
    if (playerStatus) playerStatus.textContent = "No module selected";
    if (moduleXPInfo) moduleXPInfo.textContent = "—";
    if (moduleBarFill) moduleBarFill.style.width = "0%";
    if (completeModuleBtn) completeModuleBtn.disabled = true;
    if (resetModuleBtn) resetModuleBtn.disabled = true;
    if (startQuizBtn) startQuizBtn.disabled = true;
    return;
  }

  const done = isCompleted(m.id);
  if (playerStatus) playerStatus.textContent = done ? "Completed ✅" : "In progress";

  if (moduleXPInfo) moduleXPInfo.textContent = `${m.xp || 0} XP`;
  if (moduleBarFill) moduleBarFill.style.width = done ? "100%" : "35%";

  if (completeModuleBtn) completeModuleBtn.disabled = done;
  if (resetModuleBtn) resetModuleBtn.disabled = !done;

  // restore reflection
  const prog = getProgressMap()[m.id];
  if (reflectionInput) reflectionInput.value = prog?.reflection || "";
}

/* =========================
   TABS
========================= */

function setActiveTab(name) {
  tabs.forEach(t => t.classList.toggle("active", t.dataset.tab === name));
  tabPanels.forEach(p => {
    const show = p.dataset.panel === name;
    p.style.display = show ? "" : "none";
  });

  // little stage animation bump
  if (tabStage) {
    tabStage.style.animation = "none";
    void tabStage.offsetHeight;
    tabStage.style.animation = "";
  }
}

/* =========================
   PROGRESS SAVE (complete/reset)
========================= */

async function markModuleComplete() {
  if (!sessionUser || !selectedModuleId) return;
  const m = getSelectedModule();
  if (!m) return;

  const progress = getProgressMap();
  if (progress[m.id]?.completed) return;

  const reflection = reflectionInput ? reflectionInput.value.trim() : "";
  const xpEarn = Number(m.xp) || 0;

  const currentXP = Number(userDocCache?.trainingXP) || 0;
  const nextXP = currentXP + xpEarn;
  const nextLevel = calcLevelFromXP(nextXP);

  const patch = {
    trainingXP: nextXP,
    trainingLevel: nextLevel,
    [`trainingProgress.${m.id}`]: {
      completed: true,
      completedAt: serverTimestamp(),
      xpEarned: xpEarn,
      reflection
    }
  };

  try {
    await updateDoc(doc(db, "users", sessionUser.id), patch);
    showToast(`+${xpEarn} XP • Module completed ✅`);
  } catch (e) {
    console.error("markModuleComplete error:", e);
    showToast("Could not save progress.");
  }
}

async function resetModule() {
  if (!sessionUser || !selectedModuleId) return;
  const m = getSelectedModule();
  if (!m) return;

  const progress = getProgressMap();
  const existing = progress[m.id];
  if (!existing?.completed) return;

  const xpEarned = Number(existing.xpEarned) || 0;
  const currentXP = Number(userDocCache?.trainingXP) || 0;
  const nextXP = Math.max(0, currentXP - xpEarned);
  const nextLevel = calcLevelFromXP(nextXP);

  const patch = {
    trainingXP: nextXP,
    trainingLevel: nextLevel,
    [`trainingProgress.${m.id}`]: {
      completed: false,
      completedAt: null,
      xpEarned: 0,
      reflection: ""
    }
  };

  try {
    await updateDoc(doc(db, "users", sessionUser.id), patch);
    showToast("Module reset ↩️");
    resetQuizUI();
  } catch (e) {
    console.error("resetModule error:", e);
    showToast("Could not reset module.");
  }
}

/* =========================
   QUIZ (Start + Next FIXED)
========================= */

function buildQuizFromModule(m) {
  const base = Array.isArray(m.quiz) ? m.quiz : [];
  if (base.length) return [...base].sort(() => Math.random() - 0.5).slice(0, Math.min(6, base.length));

  // fallback generator from steps/checklist
  const items = [...(m.steps || []), ...(m.checklist || [])].filter(Boolean);
  const pick = items.slice(0, 6);
  if (!pick.length) return [];

  return pick.slice(0, 4).map((t, idx) => {
    const correct = t;
    const wrong1 = items[(idx + 1) % items.length] || "Do nothing";
    const wrong2 = items[(idx + 2) % items.length] || "Skip checks";
    const options = [correct, wrong1, wrong2].sort(() => Math.random() - 0.5);
    return {
      q: `Which is a correct step for: ${m.title}?`,
      options,
      answer: options.indexOf(correct),
      explain: "This comes from the module’s key steps/checklist."
    };
  });
}

function resetQuizUI() {
  activeQuiz = null;
  if (quizCounter) quizCounter.textContent = "Quiz";
  if (quizScore) quizScore.textContent = "Score: 0";
  if (quizQuestion) quizQuestion.textContent = selectedModuleId ? "Press Start quiz to begin." : "Open a module, then start a quiz.";
  if (quizOptions) quizOptions.innerHTML = "";
  if (quizExplain) {
    quizExplain.style.display = "none";
    quizExplain.textContent = "";
  }
  if (nextQuizBtn) {
    nextQuizBtn.disabled = true;
    nextQuizBtn.textContent = "Next";
  }
  if (startQuizBtn) startQuizBtn.disabled = !selectedModuleId;
}

function startQuiz() {
  const m = getSelectedModule();
  if (!m) return;

  const questions = buildQuizFromModule(m);
  if (!questions.length) {
    showToast("No quiz questions for this module yet.");
    return;
  }

  activeQuiz = {
    moduleId: m.id,
    questions,
    index: 0,
    score: 0,
    locked: false
  };

  if (quizScore) quizScore.textContent = "Score: 0";
  if (nextQuizBtn) {
    nextQuizBtn.disabled = true;
    nextQuizBtn.textContent = "Next";
  }
  renderQuizQuestion();
  setActiveTab("quiz");
}

function renderQuizQuestion() {
  if (!activeQuiz) return;

  const qObj = activeQuiz.questions[activeQuiz.index];

  // finished
  if (!qObj) {
    const total = activeQuiz.questions.length;
    if (quizCounter) quizCounter.textContent = `Complete`;
    if (quizQuestion) quizQuestion.textContent = `Quiz complete ✅ You scored ${activeQuiz.score}/${total}.`;
    if (quizOptions) {
      quizOptions.innerHTML = `
        <div style="margin-top:10px; display:flex; gap:10px; justify-content:flex-end; flex-wrap:wrap;">
          <button id="retryQuizBtn" class="btn btn-primary" type="button">Retry</button>
          <button id="reviewLessonBtn" class="btn btn-ghost" type="button">Back to lesson</button>
        </div>
      `;
      document.getElementById("retryQuizBtn")?.addEventListener("click", () => startQuiz());
      document.getElementById("reviewLessonBtn")?.addEventListener("click", () => setActiveTab("lesson"));
    }
    if (quizExplain) {
      quizExplain.style.display = "none";
      quizExplain.textContent = "";
    }
    if (nextQuizBtn) {
      nextQuizBtn.disabled = true;
      nextQuizBtn.textContent = "Next";
    }
    return;
  }

  activeQuiz.locked = false;

  if (quizCounter) quizCounter.textContent = `Question ${activeQuiz.index + 1}/${activeQuiz.questions.length}`;
  if (quizQuestion) quizQuestion.textContent = qObj.q;

  if (quizExplain) {
    quizExplain.style.display = "none";
    quizExplain.textContent = "";
  }

  const opts = (qObj.options || []).map((t, idx) => {
    const letter = String.fromCharCode(65 + idx);
    return `<button class="opt" type="button" data-idx="${idx}">${letter}. ${escapeHTML(t)}</button>`;
  }).join("");

  if (quizOptions) quizOptions.innerHTML = opts;

  // clicking an option enables NEXT
  quizOptions?.querySelectorAll(".opt").forEach(btn => {
    btn.addEventListener("click", () => {
      if (!activeQuiz || activeQuiz.locked) return;
      activeQuiz.locked = true;

      const chosen = Number(btn.dataset.idx);
      const correct = Number(qObj.answer);

      quizOptions.querySelectorAll(".opt").forEach(b => {
        const idx = Number(b.dataset.idx);
        const isCorrect = idx === correct;
        const isChosen = idx === chosen;

        b.disabled = true;
        b.style.borderColor = isCorrect ? "rgba(34,197,94,.60)" : "rgba(255,255,255,.12)";
        b.style.background = isCorrect ? "rgba(34,197,94,.14)" : (isChosen ? "rgba(218,41,28,.12)" : "rgba(255,255,255,.06)");
      });

      if (chosen === correct) {
        activeQuiz.score += 1;
        showToast("Correct ✅");
      } else {
        showToast("Not quite ❌");
      }

      if (quizScore) quizScore.textContent = `Score: ${activeQuiz.score}`;

      if (quizExplain) {
        quizExplain.style.display = "block";
        quizExplain.innerHTML = `<strong>Explanation:</strong> ${escapeHTML(qObj.explain || "Review the module steps.")}`;
      }

      if (nextQuizBtn) {
        nextQuizBtn.disabled = false;
        nextQuizBtn.textContent = (activeQuiz.index + 1 >= activeQuiz.questions.length) ? "Finish" : "Next";
      }
    });
  });
}

/* =========================
   AI CHAT
========================= */

function addChatMessage(text, from = "bot") {
  if (!trainingChat) return;
  const wrap = document.createElement("div");
  wrap.className = `msg ${from === "user" ? "user" : ""}`;
  wrap.innerHTML = `<div class="bubble">${text}</div>`;
  trainingChat.appendChild(wrap);
  trainingChat.scrollTop = trainingChat.scrollHeight;
}

function renderAIChips() {
  if (!trainingQuickChips) return;
  const chips = [
    "Open grill training module",
    "Open Big Mac UK build module",
    "Quiz me on food safety",
    "Quiz me on fry station",
    "What are the key steps for drive-thru speed?"
  ];
  trainingQuickChips.innerHTML = chips.map(t => `<button class="chip" type="button">${escapeHTML(t)}</button>`).join("");
  trainingQuickChips.querySelectorAll("button").forEach(btn => {
    btn.addEventListener("click", () => handleTrainingAI(btn.textContent));
  });
}

function parseAICommand(text) {
  const t = normalize(text);

  if (t.startsWith("open ") || t.includes(" open ")) {
    const cleaned = t
      .replace("training module", "")
      .replace("module", "")
      .replace("open", "")
      .replace("the", "")
      .trim();
    return { type: "open", query: cleaned || t };
  }

  const isQuiz =
    t.startsWith("quiz") ||
    t.includes("quiz me") ||
    t.includes("start quiz") ||
    (t.includes("make me") && t.includes("quiz"));

  if (isQuiz) {
    const cleaned = t
      .replace("quiz me on", "")
      .replace("quiz me", "")
      .replace("start quiz", "")
      .replace("make me a", "")
      .replace("question", "")
      .replace("questions", "")
      .replace("quiz", "")
      .trim();
    return { type: "quiz", query: cleaned || t };
  }

  return { type: "ask", query: text };
}

async function handleTrainingAI(text) {
  if (!text || !text.trim()) return;
  const clean = text.trim();

  setActiveTab("ask");
  addChatMessage(escapeHTML(clean), "user");
  if (trainingAiInput) trainingAiInput.value = "";

  const cmd = parseAICommand(clean);

  // OPEN
  if (cmd.type === "open") {
    const best = findBestModuleByText(cmd.query);
    if (!best) {
      addChatMessage("I couldn’t find that module. Try: grill, fryer, food safety, Big Mac UK, drive-thru.", "bot");
      return;
    }
    addChatMessage(`Opening: <strong>${escapeHTML(best.title)}</strong> ✅`, "bot");
    openModule(best.id);
    setActiveTab("lesson");
    return;
  }

  // QUIZ
  if (cmd.type === "quiz") {
    const best = findBestModuleByText(cmd.query) || getSelectedModule();
    if (!best) {
      addChatMessage("Which module do you want a quiz on? Example: “Quiz me on grill station”.", "bot");
      return;
    }
    addChatMessage(`Starting quiz for <strong>${escapeHTML(best.title)}</strong> 🧠`, "bot");
    openModule(best.id);
    startQuiz();
    return;
  }

  // ASK (backend)
  const selected = getSelectedModule();
  const contextData = {
    page: "training",
    region: "UK",
    tone: "McDonald's UK training assistant",
    user: sessionUser,
    selectedModule: selected ? {
      id: selected.id,
      title: selected.title,
      tag: selected.tag,
      summary: selected.summary,
      steps: selected.steps,
      checklist: selected.checklist,
      doDont: selected.doDont
    } : null,
    allModules: MODULES.map(m => ({
      id: m.id,
      title: m.title,
      tag: m.tag,
      level: m.level,
      xp: m.xp,
      keywords: m.keywords || []
    }))
  };

  try {
    if (trainingAiSend) trainingAiSend.disabled = true;

    const thinkingId = `t_${Date.now()}`;
    addChatMessage(`<span id="${thinkingId}" style="opacity:.75;">Thinking…</span>`, "bot");

    const res = await fetch("/api/mcassist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: clean,
        user: sessionUser,
        contextData
      })
    });

    let data = {};
    try { data = await res.json(); } catch { data = {}; }

    // remove thinking
    const thinkingEl = document.getElementById(thinkingId);
    thinkingEl?.closest(".msg")?.remove?.();

    addChatMessage(data.reply ? data.reply : "I’m not sure — try asking about a module or say “open … module”.", "bot");
  } catch (e) {
    console.error("AI error:", e);
    addChatMessage("Sorry — McAssist had a problem. Try again.", "bot");
  } finally {
    if (trainingAiSend) trainingAiSend.disabled = false;
  }
}

/* =========================
   EVENTS
========================= */

// sidebar toggle
sidebarToggle?.addEventListener("click", () => sidebar?.classList.toggle("sidebar-open"));

// logout
logoutBtn?.addEventListener("click", async () => {
  stopRealtime();
  await signOut(auth);
  localStorage.removeItem("mc_session_user");
  window.location.href = "index.html";
});

// search
moduleSearchBtn?.addEventListener("click", () => renderModuleGrid());
moduleSearch?.addEventListener("input", () => renderModuleGrid());

// refresh
refreshModulesBtn?.addEventListener("click", () => {
  moduleSearch.value = "";
  activeFilter = "All";
  renderFilters();
  renderModuleGrid();
  showToast("Modules refreshed ✅");
});

// tabs click
tabs.forEach(t => t.addEventListener("click", () => setActiveTab(t.dataset.tab)));

// complete/reset
completeModuleBtn?.addEventListener("click", markModuleComplete);
resetModuleBtn?.addEventListener("click", resetModule);

// quiz buttons
startQuizBtn?.addEventListener("click", () => startQuiz());
nextQuizBtn?.addEventListener("click", () => {
  if (!activeQuiz) return;
  activeQuiz.index += 1;
  if (nextQuizBtn) nextQuizBtn.disabled = true;
  renderQuizQuestion();
});

// topbar quick quiz
quickQuizBtn?.addEventListener("click", () => {
  if (!selectedModuleId && MODULES.length) openModule(MODULES[0].id);
  startQuiz();
});

// AI form
trainingAiForm?.addEventListener("submit", (e) => {
  e.preventDefault();
  handleTrainingAI(trainingAiInput?.value || "");
});

/* =========================
   INIT
========================= */

function seedChat() {
  if (!trainingChat) return;
  trainingChat.innerHTML = "";
  addChatMessage(
    `Hi 👋 I’m McAssist. Try: <strong>open grill training module</strong> or <strong>quiz me on food safety</strong>.`,
    "bot"
  );
}

function initialRender() {
  renderFilters();
  renderModuleGrid();
  renderAIChips();
  resetQuizUI();
  setActiveTab("lesson");

  // default pick
  if (!selectedModuleId && MODULES.length) openModule(MODULES[0].id);
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    stopRealtime();
    localStorage.removeItem("mc_session_user");
    window.location.href = "index.html";
    return;
  }

  sessionUser = loadSessionUser() || {
    id: user.uid,
    role: "crew",
    name: user.displayName || user.email || "User",
    storeId: "store001"
  };

  const d = await ensureUserDoc(user);

  sessionUser.id = user.uid;
  sessionUser.name = d.name || sessionUser.name;
  sessionUser.role = d.role || sessionUser.role;
  sessionUser.storeId = d.storeId || sessionUser.storeId;
  saveSessionUser(sessionUser);

  // sidebar + topbar user
  if (sidebarUserName) sidebarUserName.textContent = sessionUser.name || "User Name";
  if (sidebarUserRole) sidebarUserRole.textContent = sessionUser.role === "crew" ? "Crew Member" : "Staff";
  if (topUserName) topUserName.textContent = sessionUser.name || "User";
  if (topUserRole) topUserRole.textContent = sessionUser.role === "crew" ? "Crew Member" : "Staff";
  if (userAvatar) userAvatar.textContent = (sessionUser.name || "U").trim().slice(0, 1).toUpperCase();

  seedChat();
  initialRender();
  startRealtime(sessionUser.id);
});
