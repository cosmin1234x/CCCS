// ========================================
// training.js — FULL VERSION (Explorer + AI + Overlay + Quiz + Firestore Progress)
// ✅ IMPORTANT: imports MUST be at the top (or the whole file won't run)
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
   DOM
========================= */

// sidebar
const sidebarUserName = document.getElementById("sidebarUserName");
const sidebarUserRole = document.getElementById("sidebarUserRole");
const logoutBtn = document.getElementById("logoutBtn");
const sidebar = document.querySelector(".sidebar");
const sidebarToggle = document.getElementById("sidebarToggle");

// header
const headerLevel = document.getElementById("headerLevel");
const headerXP = document.getElementById("headerXP");

// path + lesson panel
const pathList = document.getElementById("pathList");
const lessonTitle = document.getElementById("lessonTitle");
const lessonSubtitle = document.getElementById("lessonSubtitle");
const lessonTag = document.getElementById("lessonTag");
const lessonContent = document.getElementById("lessonContent");

// progress panel
const statusPill = document.getElementById("statusPill");
const moduleXPInfo = document.getElementById("moduleXPInfo");
const moduleXpFill = document.getElementById("moduleXpFill");
const checklistEl = document.getElementById("checklist");
const reflectionInput = document.getElementById("reflectionInput");
const completeModuleBtn = document.getElementById("completeModuleBtn");
const resetModuleBtn = document.getElementById("resetModuleBtn");

// toast
const toastEl = document.getElementById("toast");

// module explorer
const trainingSearch = document.getElementById("trainingSearch");
const trainingSearchBtn = document.getElementById("trainingSearchBtn");
const trainingModuleGrid = document.getElementById("trainingModuleGrid");

// ai (these exist in your HTML)
const trainingChat = document.getElementById("trainingChat");
const trainingAiForm = document.getElementById("trainingAiForm");
const trainingAiInput = document.getElementById("trainingAiInput");
const trainingAiSend = document.getElementById("trainingAiSend");
const trainingQuickChips = document.getElementById("trainingQuickChips");

// overlay
const moduleOverlay = document.getElementById("moduleOverlay");
const moduleTitle = document.getElementById("moduleTitle");
const moduleMeta = document.getElementById("moduleMeta");
const moduleBody = document.getElementById("moduleBody");
const closeModuleBtn = document.getElementById("closeModuleBtn");
const startQuizBtn = document.getElementById("startQuizBtn");
const quizArea = document.getElementById("quizArea");

/* =========================
   STATE
========================= */

let sessionUser = null;
let selectedModuleId = null;
let userDocCache = null;

let unsubUser = null;

// quiz state
let activeQuiz = null; // { moduleId, questions, index, score }
let quizLocked = false;

// one-time event delegation binds
let moduleGridBound = false;

/* =========================
   MODULE LIBRARY (UK-focused training style)
========================= */

const MODULES = [
  {
    id: "food_safety_basics",
    title: "Food Safety Basics",
    tag: "Food safety",
    level: 1,
    xp: 40,
    durationMins: 8,
    keywords: ["food safety", "hygiene", "contamination", "temps", "temperature", "handwash", "allergens", "uk"],
    summary: "Prevent contamination, follow time/temp rules, and protect customers (UK focus).",
    steps: [
      "Wash hands properly: warm water + soap, scrub all areas, dry fully.",
      "Avoid cross-contamination: separate raw vs ready-to-eat items and tools.",
      "Follow time/temp rules for holding, chilling, and reheating (use store equipment + logs).",
      "Clean-as-you-go: sanitise surfaces and tools using approved solution.",
      "Allergens: treat requests seriously, avoid contact, and follow store allergen process."
    ],
    doDont: {
      do: ["Change gloves between tasks", "Use separate tools for raw/cooked", "Use sanitiser correctly"],
      dont: ["Store raw above cooked", "Ignore allergen requests", "Reuse dirty cloths without sanitiser"]
    },
    scenario: {
      title: "Rush spill",
      text: "Raw product leaks in the fridge. What do you do immediately, and what do you check after cleaning?"
    },
    checklist: [
      "I know the handwash steps",
      "I can explain cross-contamination",
      "I know where sanitiser is and how to use it",
      "I understand allergen prevention basics"
    ],
    quiz: [
      {
        q: "What’s the best way to prevent cross-contamination?",
        options: ["Use the same tools for speed", "Separate raw and ready-to-eat items + tools", "Only wipe surfaces at end of shift"],
        answer: 1,
        explain: "Separation prevents bacteria/allergens spreading."
      },
      {
        q: "When should you change gloves?",
        options: ["Only if ripped", "Between different tasks/foods", "Once per hour"],
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
    keywords: ["grill", "meat", "burger", "cook", "timers", "clamshell", "seasoning", "uk"],
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
    scenario: {
      title: "Quality drop",
      text: "Burgers are coming out dry. What’s the quickest change to make during rush?"
    },
    checklist: [
      "I know the pre-shift setup steps",
      "I use timers every cook",
      "I can explain holding/rotation",
      "I keep raw/cooked tools separated"
    ],
    quiz: [
      {
        q: "What habit prevents over/under cooking best?",
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
    keywords: ["fryer", "fries", "oil", "salt", "timers", "burns", "holding", "uk"],
    summary: "Crisp fries, safe oil handling, and fast rhythm without burns.",
    steps: [
      "Check fryer is operating normally and baskets are safe to use.",
      "Use the correct basket fill guideline to prevent soggy fries.",
      "Use the timer for every drop; shake as per store practice.",
      "Season consistently (if your store uses salting station).",
      "Hold correctly, rotate, and keep the station tidy."
    ],
    checklist: [
      "I follow fill guidelines",
      "I use timers for every drop",
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
    keywords: ["big mac", "build", "uk", "assemble", "sandwich", "kitchen"],
    summary: "Build a Big Mac consistently using your store’s build card order.",
    steps: [
      "Prep area: clean hands/gloves, correct packaging ready.",
      "Use the correct bun set (top/middle/bottom) and toast per store process.",
      "Apply correct sauce/condiments amounts (follow your store build card).",
      "Add salad/pickles in the correct order.",
      "Add patties using correct tools; keep the build neat and stable.",
      "Close, wrap/box, and present with label if required."
    ],
    checklist: [
      "I follow a consistent build order",
      "I keep the build neat/centered",
      "I package correctly"
    ],
    quiz: [
      {
        q: "What matters most for consistent builds?",
        options: ["Going fast only", "Following the build card order + portions", "Adding extra sauce automatically"],
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
    keywords: ["drive thru", "drive-thru", "speed", "window", "headset", "park", "uk"],
    summary: "Clear communication and fast workflow without mistakes.",
    steps: [
      "Speak clearly on headset and confirm key items/drinks.",
      "Accuracy beats redoing orders.",
      "Use 'park' when needed based on store process.",
      "Prep napkins/condiments while payment happens.",
      "Hand-off with final confirmation."
    ],
    checklist: [
      "I speak clearly",
      "I repeat order back",
      "I confirm at hand-off"
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

function safeText(x, fallback = "") {
  return typeof x === "string" ? x : fallback;
}

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

function normalize(s) {
  return String(s || "").toLowerCase().trim();
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
  }).sort((a, b) => b.score - a.score);

  if (!scored.length || scored[0].score <= 0) return null;
  return scored[0].m;
}

function buildModuleHTML(m) {
  const steps = (m.steps || []).map(s => `<li>${s}</li>`).join("");
  const doList = (m.doDont?.do || []).map(s => `<li>${s}</li>`).join("");
  const dontList = (m.doDont?.dont || []).map(s => `<li>${s}</li>`).join("");

  const scenario = m.scenario
    ? `<div class="lesson-scenario"><strong>${safeText(m.scenario.title)}</strong>${safeText(m.scenario.text)}</div>`
    : "";

  const highlight = m.summary
    ? `<div class="lesson-highlight"><strong>Focus:</strong> ${safeText(m.summary)}</div>`
    : "";

  return `
    <div class="lesson-section">
      <h4>Key steps</h4>
      <ul>${steps || "<li>No steps added yet.</li>"}</ul>
    </div>

    <div class="lesson-section">
      <h4>Do / Don’t</h4>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
        <div style="background:#ecfdf5; border:1px solid #bbf7d0; padding:10px; border-radius:12px;">
          <strong style="font-size:0.8rem; color:#166534;">Do</strong>
          <ul style="margin-top:6px;">${doList || "<li>—</li>"}</ul>
        </div>
        <div style="background:#fef2f2; border:1px solid #fecaca; padding:10px; border-radius:12px;">
          <strong style="font-size:0.8rem; color:#991b1b;">Don’t</strong>
          <ul style="margin-top:6px;">${dontList || "<li>—</li>"}</ul>
        </div>
      </div>
    </div>

    ${scenario}
    ${highlight}
  `;
}

function buildChecklist(m) {
  const items = Array.isArray(m.checklist) ? m.checklist : [];
  if (!checklistEl) return;

  checklistEl.innerHTML = items.length
    ? items.map((t, idx) => `
        <li class="check-item">
          <input type="checkbox" id="chk_${idx}" />
          <span>${t}</span>
        </li>
      `).join("")
    : `<li class="check-item"><span>No checklist items yet.</span></li>`;
}

/* =========================
   AUTH + USER DOC
========================= */

function loadSessionUser() {
  try {
    return JSON.parse(localStorage.getItem("mc_session_user"));
  } catch {
    return null;
  }
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

    const xp = Number(userDocCache.trainingXP) || 0;
    const lvl = Number(userDocCache.trainingLevel) || calcLevelFromXP(xp);

    if (headerXP) headerXP.textContent = `${xp} XP total`;
    if (headerLevel) headerLevel.textContent = String(lvl);

    const computed = calcLevelFromXP(xp);
    if (computed !== lvl) {
      updateDoc(doc(db, "users", uid), { trainingLevel: computed }).catch(() => {});
    }

    renderPathRail();
    renderModuleGrid(trainingSearch?.value || "");
    refreshProgressPanel();
  });
}

/* =========================
   RENDER: PATH + LESSON
========================= */

function renderPathRail() {
  if (!pathList) return;

  const progress = getProgressMap();
  const sorted = [...MODULES].sort((a, b) => {
    const la = Number(a.level) || 1;
    const lb = Number(b.level) || 1;
    if (la !== lb) return la - lb;
    return a.title.localeCompare(b.title);
  });

  pathList.innerHTML = sorted.map((m, idx) => {
    const completed = !!progress[m.id]?.completed;
    const active = selectedModuleId === m.id;
    return `
      <li class="path-item ${completed ? "completed" : ""} ${active ? "active" : ""}" data-id="${m.id}">
        <div class="path-step">${completed ? "✓" : (idx + 1)}</div>
        <div class="path-text">
          <div class="path-title-row">
            <span>${m.title}</span>
            <span class="path-tag">${m.tag}</span>
          </div>
          <div class="path-meta">${m.xp} XP • ~${m.durationMins || 8} min • Level ${m.level || 1}</div>
        </div>
      </li>
    `;
  }).join("");

  // click to open
  pathList.querySelectorAll(".path-item").forEach(li => {
    li.addEventListener("click", () => openModuleInLesson(li.dataset.id));
  });
}

function openModuleInLesson(moduleId) {
  const m = MODULES.find(x => x.id === moduleId);
  if (!m) return;

  selectedModuleId = moduleId;

  if (lessonTitle) lessonTitle.textContent = m.title;
  if (lessonSubtitle) lessonSubtitle.textContent = safeText(m.summary, "Training module");
  if (lessonTag) lessonTag.textContent = m.tag || "Module";
  if (lessonContent) lessonContent.innerHTML = buildModuleHTML(m);

  buildChecklist(m);
  refreshProgressPanel();
  renderPathRail();
}

function refreshProgressPanel() {
  const m = selectedModuleId ? MODULES.find(x => x.id === selectedModuleId) : null;
  if (!m) {
    if (statusPill) statusPill.textContent = "No module selected";
    if (moduleXPInfo) moduleXPInfo.textContent = "Select a module to see its XP value.";
    if (moduleXpFill) moduleXpFill.style.width = "0%";
    if (completeModuleBtn) completeModuleBtn.disabled = true;
    if (resetModuleBtn) resetModuleBtn.disabled = true;
    return;
  }

  const completed = isCompleted(m.id);

  if (statusPill) {
    statusPill.textContent = completed ? "Completed" : "In progress";
    statusPill.classList.toggle("completed", completed);
  }

  if (moduleXPInfo) moduleXPInfo.textContent = `${m.xp || 0} XP • ~${m.durationMins || 8} min • ${m.tag || "Module"}`;
  if (moduleXpFill) moduleXpFill.style.width = completed ? "100%" : "35%";

  if (completeModuleBtn) completeModuleBtn.disabled = completed;
  if (resetModuleBtn) resetModuleBtn.disabled = !completed;

  const prog = getProgressMap()[m.id];
  if (reflectionInput) reflectionInput.value = prog?.reflection || "";
}

/* =========================
   MODULE GRID (Open button FIX)
========================= */

function bindModuleGridClicks() {
  if (!trainingModuleGrid || moduleGridBound) return;

  // event delegation so it works after re-render
  trainingModuleGrid.addEventListener("click", (e) => {
    const btn = e.target.closest(".open-module-btn");
    if (!btn) return;
    const id = btn.dataset.id;
    if (!id) return;
    openModuleOverlay(id);
  });

  moduleGridBound = true;
}

function renderModuleGrid(filterText = "") {
  if (!trainingModuleGrid) return;

  const q = normalize(filterText);
  const list = !q
    ? MODULES
    : MODULES.filter(m => {
        const hay = `${m.title} ${m.tag} ${(m.keywords || []).join(" ")} ${m.summary || ""}`.toLowerCase();
        return hay.includes(q);
      });

  trainingModuleGrid.innerHTML = list.length
    ? list.map(m => {
        const completed = isCompleted(m.id);
        return `
          <div class="card" style="padding:12px; border-radius:16px; border:1px solid #e5e7eb;">
            <div style="display:flex; justify-content:space-between; gap:8px;">
              <div>
                <div style="font-weight:900; font-size:0.9rem;">${m.title}</div>
                <div style="font-size:0.78rem; color:#6b7280; margin-top:2px;">
                  ${m.tag} • ${m.xp} XP • L${m.level || 1}
                </div>
              </div>
              <div style="display:flex; flex-direction:column; align-items:flex-end; gap:6px;">
                <span class="status-pill ${completed ? "completed" : ""}" style="white-space:nowrap;">
                  ${completed ? "Completed" : "Open"}
                </span>
                <button class="btn-ghost open-module-btn" data-id="${m.id}" type="button">Open</button>
              </div>
            </div>
            <div style="margin-top:8px; font-size:0.78rem; color:#374151;">
              ${safeText(m.summary, "")}
            </div>
          </div>
        `;
      }).join("")
    : `<div style="font-size:0.82rem; color:#6b7280;">No modules match that search.</div>`;

  bindModuleGridClicks();
}

/* =========================
   OVERLAY + QUIZ
========================= */

function openModuleOverlay(moduleId) {
  const m = MODULES.find(x => x.id === moduleId);
  if (!m) return;

  openModuleInLesson(moduleId);

  if (!moduleOverlay) {
    showToast("Opened module ✅");
    return;
  }

  if (moduleTitle) moduleTitle.textContent = m.title;
  if (moduleMeta) moduleMeta.textContent = `${m.tag} • ${m.xp} XP • ~${m.durationMins || 8} min • Level ${m.level || 1}`;
  if (moduleBody) moduleBody.innerHTML = buildModuleHTML(m);

  hideQuiz();
  moduleOverlay.classList.add("show");
}

function closeModuleOverlay() {
  moduleOverlay?.classList.remove("show");
  hideQuiz();
}

function hideQuiz() {
  activeQuiz = null;
  quizLocked = false;
  if (quizArea) {
    quizArea.style.display = "none";
    quizArea.innerHTML = "";
  }
}

function buildQuizFromModule(m) {
  const base = Array.isArray(m.quiz) ? m.quiz : [];
  if (base.length) return [...base].sort(() => Math.random() - 0.5).slice(0, Math.min(5, base.length));

  // fallback quiz from steps/checklist
  const items = [...(m.steps || []), ...(m.checklist || [])].filter(Boolean);
  const pick = items.slice(0, 6);

  return pick.slice(0, 3).map((t, idx) => {
    const correct = t;
    const wrong1 = items[(idx + 2) % items.length] || "Do nothing";
    const wrong2 = items[(idx + 3) % items.length] || "Skip the timer";
    const options = [correct, wrong1, wrong2].sort(() => Math.random() - 0.5);

    return {
      q: `Which is a correct step for: ${m.title}?`,
      options,
      answer: options.indexOf(correct),
      explain: "This comes directly from the module’s key steps."
    };
  });
}

function startQuizForModule(moduleId) {
  const m = MODULES.find(x => x.id === moduleId);
  if (!m || !quizArea) return;

  activeQuiz = {
    moduleId: m.id,
    questions: buildQuizFromModule(m),
    index: 0,
    score: 0
  };

  quizArea.style.display = "block";
  renderQuizQuestion();
}

function renderQuizQuestion() {
  if (!activeQuiz || !quizArea) return;

  const qObj = activeQuiz.questions[activeQuiz.index];

  if (!qObj) {
    quizArea.innerHTML = `
      <div style="font-weight:900; font-size:0.95rem;">Quiz complete ✅</div>
      <div style="margin-top:6px; font-size:0.82rem; color:#374151;">
        Score: <strong>${activeQuiz.score}/${activeQuiz.questions.length}</strong>
      </div>
      <div style="margin-top:10px; display:flex; gap:8px; flex-wrap:wrap;">
        <button id="quizCloseBtn" class="btn-ghost" type="button">Close quiz</button>
        <button id="quizRetryBtn" class="btn-main" type="button">Retry quiz</button>
      </div>
    `;
    document.getElementById("quizCloseBtn")?.addEventListener("click", hideQuiz);
    document.getElementById("quizRetryBtn")?.addEventListener("click", () => startQuizForModule(activeQuiz.moduleId));
    return;
  }

  const opts = (qObj.options || []).map((t, idx) => `
    <button class="btn-ghost quiz-opt" data-idx="${idx}" type="button"
      style="justify-content:flex-start; width:100%;">
      ${String.fromCharCode(65 + idx)}. ${t}
    </button>
  `).join("");

  quizArea.innerHTML = `
    <div style="display:flex; justify-content:space-between; gap:10px; align-items:center;">
      <div style="font-weight:900; font-size:0.95rem;">Quiz: ${activeQuiz.index + 1}/${activeQuiz.questions.length}</div>
      <div style="font-size:0.8rem; color:#6b7280;">Score: ${activeQuiz.score}</div>
    </div>

    <div style="margin-top:10px; font-size:0.86rem; color:#111827; font-weight:800;">
      ${qObj.q}
    </div>

    <div style="margin-top:10px; display:flex; flex-direction:column; gap:8px;">
      ${opts}
    </div>

    <div id="quizExplain" style="display:none; margin-top:10px; padding:10px; border-radius:12px; border:1px solid #e5e7eb; background:#ffffff;"></div>

    <div style="margin-top:10px; display:flex; gap:8px; flex-wrap:wrap;">
      <button id="quizNextBtn" class="btn-main" type="button" disabled>Next</button>
      <button id="quizExitBtn" class="btn-ghost" type="button">Exit quiz</button>
    </div>
  `;

  const explain = document.getElementById("quizExplain");
  const nextBtn = document.getElementById("quizNextBtn");

  quizLocked = false;

  quizArea.querySelectorAll(".quiz-opt").forEach(btn => {
    btn.addEventListener("click", () => {
      if (quizLocked) return;
      quizLocked = true;

      const chosen = Number(btn.dataset.idx);
      const correct = Number(qObj.answer);

      // mark buttons
      quizArea.querySelectorAll(".quiz-opt").forEach(b => {
        const idx = Number(b.dataset.idx);
        const isCorrect = idx === correct;
        const isChosen = idx === chosen;

        b.style.borderColor = isCorrect ? "#22c55e" : "#e5e7eb";
        b.style.background = isCorrect ? "#ecfdf5" : (isChosen ? "#fef2f2" : "#f9fafb");
      });

      if (chosen === correct) {
        activeQuiz.score += 1;
        showToast("Correct ✅");
      } else {
        showToast("Not quite ❌");
      }

      if (explain) {
        explain.style.display = "block";
        explain.innerHTML = `<strong>Explanation:</strong> ${safeText(qObj.explain, "Review the module steps.")}`;
      }

      // ✅ FIX: enable Next after answering
      if (nextBtn) nextBtn.disabled = false;
    });
  });

  nextBtn?.addEventListener("click", () => {
    activeQuiz.index += 1;
    renderQuizQuestion();
  });

  document.getElementById("quizExitBtn")?.addEventListener("click", hideQuiz);
}

/* =========================
   PROGRESS SAVE (complete/reset)
========================= */

async function markModuleComplete() {
  if (!sessionUser || !selectedModuleId) return;
  const m = MODULES.find(x => x.id === selectedModuleId);
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
  const m = MODULES.find(x => x.id === selectedModuleId);
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
  } catch (e) {
    console.error("resetModule error:", e);
    showToast("Could not reset module.");
  }
}

/* =========================
   AI CHAT (open module + quiz + ask)
========================= */

function addChatMessage(text, from = "bot") {
  if (!trainingChat) return;
  const div = document.createElement("div");
  div.style.margin = "8px 0";
  div.innerHTML = `
    <div style="
      max-width: 100%;
      display:inline-block;
      padding: 8px 10px;
      border-radius: 14px;
      border: 1px solid #e5e7eb;
      background: ${from === "user" ? "#111827" : "#f9fafb"};
      color: ${from === "user" ? "#f9fafb" : "#111827"};
      font-size: 0.82rem;
      line-height: 1.45;
    ">
      ${text}
    </div>
  `;
  if (from === "user") div.style.textAlign = "right";
  trainingChat.appendChild(div);
  trainingChat.scrollTop = trainingChat.scrollHeight;
}

function renderAIChips() {
  if (!trainingQuickChips) return;
  const chips = [
    "Open grill training module",
    "Open Big Mac UK build module",
    "Quiz me on food safety",
    "What are the key steps for drive-thru speed?"
  ];
  trainingQuickChips.innerHTML = chips.map(t => `
    <button class="suggestion-chip" type="button">${t}</button>
  `).join("");

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

  addChatMessage(clean, "user");
  if (trainingAiInput) trainingAiInput.value = "";

  const cmd = parseAICommand(clean);

  // open module
  if (cmd.type === "open") {
    const best = findBestModuleByText(cmd.query);
    if (!best) {
      addChatMessage("I couldn’t find that module. Try: Grill, Fryer, Big Mac, Food Safety, Drive-thru.", "bot");
      return;
    }
    addChatMessage(`Opening: <strong>${best.title}</strong> ✅`, "bot");
    openModuleOverlay(best.id);
    return;
  }

  // quiz
  if (cmd.type === "quiz") {
    const best = findBestModuleByText(cmd.query || selectedModuleId || "");
    if (!best) {
      addChatMessage("Which module do you want a quiz on? Example: “Quiz me on grill station”.", "bot");
      return;
    }
    addChatMessage(`Starting a quiz for <strong>${best.title}</strong> 🧠`, "bot");
    openModuleOverlay(best.id);
    startQuizForModule(best.id);
    return;
  }

  // ask the backend (mcassist)
  const chosenModule = selectedModuleId ? MODULES.find(m => m.id === selectedModuleId) : null;

  const contextData = {
    page: "training",
    region: "UK",
    selectedModule: chosenModule ? {
      id: chosenModule.id,
      title: chosenModule.title,
      tag: chosenModule.tag,
      summary: chosenModule.summary,
      steps: chosenModule.steps,
      checklist: chosenModule.checklist,
      doDont: chosenModule.doDont,
      scenario: chosenModule.scenario
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
    addChatMessage(`<span style="opacity:0.7;">Thinking…</span>`, "bot");

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

    // remove last thinking bubble (best-effort)
    if (trainingChat && trainingChat.lastElementChild) {
      const html = trainingChat.lastElementChild.innerHTML || "";
      if (html.includes("Thinking")) trainingChat.lastElementChild.remove();
    }

    addChatMessage(data.reply || "I’m not sure. Try asking about a module.", "bot");
  } catch (e) {
    console.error("Training AI error:", e);
    addChatMessage("Sorry, the training assistant had a problem. Try again.", "bot");
  } finally {
    if (trainingAiSend) trainingAiSend.disabled = false;
  }
}

/* =========================
   EVENTS
========================= */

logoutBtn?.addEventListener("click", async () => {
  stopRealtime();
  await signOut(auth);
  localStorage.removeItem("mc_session_user");
  window.location.href = "index.html";
});

sidebarToggle?.addEventListener("click", () => {
  sidebar?.classList.toggle("sidebar-open");
});

trainingSearchBtn?.addEventListener("click", () => {
  renderModuleGrid(trainingSearch?.value || "");
});
trainingSearch?.addEventListener("input", () => {
  renderModuleGrid(trainingSearch?.value || "");
});

completeModuleBtn?.addEventListener("click", markModuleComplete);
resetModuleBtn?.addEventListener("click", resetModule);

closeModuleBtn?.addEventListener("click", closeModuleOverlay);
moduleOverlay?.addEventListener("click", (e) => {
  if (e.target === moduleOverlay) closeModuleOverlay();
});

startQuizBtn?.addEventListener("click", () => {
  if (!selectedModuleId) {
    showToast("Open a module first.");
    return;
  }
  startQuizForModule(selectedModuleId);
});

trainingAiForm?.addEventListener("submit", (e) => {
  e.preventDefault();
  handleTrainingAI(trainingAiInput?.value || "");
});

/* =========================
   INIT
========================= */

function seedTrainingChat() {
  if (!trainingChat) return;
  trainingChat.innerHTML = "";
  addChatMessage(
    "Hi 👋 Ask me anything about training. Try: <strong>“open grill training module”</strong> or <strong>“quiz me on food safety”</strong>.",
    "bot"
  );
}

function initialRender() {
  renderPathRail();
  renderModuleGrid("");
  renderAIChips();
  refreshProgressPanel();

  if (!selectedModuleId && MODULES.length) {
    openModuleInLesson(MODULES[0].id);
  }
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

  if (sidebarUserName) sidebarUserName.textContent = sessionUser.name || "User";
  if (sidebarUserRole) sidebarUserRole.textContent = sessionUser.role === "crew" ? "Crew Member" : "Staff";

  seedTrainingChat();
  initialRender();
  startRealtime(sessionUser.id);
});
