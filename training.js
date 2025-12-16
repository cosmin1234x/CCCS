// ========================================
// training.js — FULL VERSION (AI + Modules + Quiz + Firestore Progress)
// Works with the training.html I provided.
//
// Firestore:
//  users/{uid}
//    - trainingXP (number)
//    - trainingLevel (number)
//    - trainingProgress (map)
//        trainingProgress[moduleId] = { completed: boolean, completedAt, reflection, xpEarned }
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

// new module explorer
const trainingSearch = document.getElementById("trainingSearch");
const trainingSearchBtn = document.getElementById("trainingSearchBtn");
const trainingModuleGrid = document.getElementById("trainingModuleGrid");

// ai
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
let activeQuiz = null; // { moduleId, questions: [{q, options, answer, explain}], index, score }
let quizLocked = false;

/* =========================
   MODULE LIBRARY (edit freely)
========================= */

const MODULES = [
  // FOOD SAFETY
  {
    id: "food_safety_basics",
    title: "Food Safety Basics",
    tag: "Food safety",
    level: 1,
    xp: 40,
    durationMins: 8,
    keywords: ["food safety", "hygiene", "contamination", "temps", "temperature", "handwash", "allergens"],
    summary: "Prevent contamination, follow temp rules, and protect customers.",
    steps: [
      "Wash hands properly: 20 seconds, warm water, soap, dry fully.",
      "Avoid cross-contamination: raw vs cooked separation.",
      "Follow time/temp rules: hot holding, chilling, reheating.",
      "Clean-as-you-go: sanitize surfaces and tools.",
      "Allergens: prevent contact and label correctly."
    ],
    doDont: {
      do: ["Use separate tongs for raw/cooked", "Change gloves between tasks", "Check holding temps regularly"],
      dont: ["Reuse wiping cloths without sanitizer", "Store raw above cooked", "Ignore allergen requests"]
    },
    scenario: {
      title: "Rush hour spill",
      text: "A raw chicken tray leaks in the fridge. What do you do immediately and what do you check after cleaning?"
    },
    checklist: [
      "I know the handwash steps",
      "I can explain cross-contamination",
      "I know where the sanitizer is and how to use it",
      "I understand allergen prevention basics"
    ],
    quiz: [
      {
        q: "What’s the best way to prevent cross-contamination?",
        options: ["Use the same tools for speed", "Separate raw and cooked items + tools", "Only wipe surfaces at end of shift"],
        answer: 1,
        explain: "Separation of raw/cooked food and tools is key."
      },
      {
        q: "When should you change gloves?",
        options: ["Only if ripped", "Between different tasks/foods", "Once per hour"],
        answer: 1,
        explain: "Change gloves between tasks to stop transferring bacteria/allergens."
      }
    ]
  },

  // KITCHEN
  {
    id: "grill_station",
    title: "Grill Station – Core",
    tag: "Kitchen",
    level: 1,
    xp: 55,
    durationMins: 10,
    keywords: ["grill", "meat", "burger", "cook", "temps", "timers", "clamshell", "seasoning"],
    summary: "Cook safely, keep timing consistent, and avoid quality drops.",
    steps: [
      "Pre-shift: check grill temp, scrape + sanitize tools, set timers.",
      "Load patties evenly, avoid overcrowding, use correct cycle.",
      "Season correctly (if your store uses seasoning).",
      "Remove on time, stack correctly, follow holding rules.",
      "Clean between rushes: quick scrape + wipe with approved cloth."
    ],
    doDont: {
      do: ["Use timers every time", "Keep raw/cooked tools separate", "Communicate 'down' counts"],
      dont: ["Guess cook time", "Leave product outside holding rules", "Mix old/new product without rotation"]
    },
    scenario: {
      title: "Quality check",
      text: "A burger looks overcooked. What’s the fastest way to prevent it happening again during rush?"
    },
    checklist: [
      "I know the pre-shift grill setup steps",
      "I use timers every cook",
      "I can explain holding/rotation",
      "I keep tools separated (raw/cooked)"
    ],
    quiz: [
      {
        q: "What’s the best habit to stop over/under cooking?",
        options: ["Cook by eye", "Use timers consistently", "Flip burgers early"],
        answer: 1,
        explain: "Timers remove guessing and keep results consistent."
      },
      {
        q: "Why is rotation important in holding?",
        options: ["It looks nicer", "It prevents old product being served", "It speeds up cooking"],
        answer: 1,
        explain: "Rotation ensures customers don’t get old product."
      }
    ]
  },

  {
    id: "fryer_station",
    title: "Fry Station – Quality & Speed",
    tag: "Kitchen",
    level: 1,
    xp: 50,
    durationMins: 9,
    keywords: ["fryer", "fries", "oil", "salt", "timers", "basket", "burns"],
    summary: "Crisp fries, safe oil handling, and fast rush rhythm.",
    steps: [
      "Check oil level + filter status (per store process).",
      "Use basket fill guidelines to avoid soggy fries.",
      "Use timers and shake basket (if required by your process).",
      "Salt immediately after dumping (as per store standard).",
      "Keep heat-safe zone: protect from burns and spills."
    ],
    checklist: [
      "I know basket fill guidelines",
      "I use timers for every drop",
      "I salt correctly and consistently",
      "I know how to reduce burn risk"
    ]
  },

  // FRONT COUNTER
  {
    id: "front_counter_greeting",
    title: "Front Counter – Greeting & Order Accuracy",
    tag: "Front counter",
    level: 1,
    xp: 45,
    durationMins: 8,
    keywords: ["front counter", "greeting", "order", "accuracy", "upsell", "customer"],
    summary: "Friendly greeting, correct orders, and calm under pressure.",
    steps: [
      "Greet within 5 seconds with a smile and eye contact.",
      "Repeat the order back to confirm accuracy.",
      "Clarify customizations (no pickles, extra sauce, etc.).",
      "Handle payment smoothly, offer receipt.",
      "Thank the customer and direct them clearly."
    ],
    checklist: [
      "I greet within 5 seconds",
      "I repeat orders back",
      "I clarify custom items",
      "I stay calm during rush"
    ]
  },

  // DRIVE THRU
  {
    id: "drive_thru_speed",
    title: "Drive-thru – Speed & Clarity",
    tag: "Drive-thru",
    level: 2,
    xp: 60,
    durationMins: 10,
    keywords: ["drive thru", "drive-thru", "speed", "window", "headset", "timer"],
    summary: "Clear communication and fast workflow without mistakes.",
    steps: [
      "Confirm greeting script and speak clearly.",
      "Repeat key items + drinks to reduce errors.",
      "Use 'park' smartly when needed (per store rules).",
      "Prep condiments/napkins during payment moment.",
      "Hand-off with a final confirmation."
    ],
    checklist: [
      "I speak clearly on headset",
      "I repeat the order back",
      "I understand when to park",
      "I confirm at hand-off"
    ]
  },

  // CUSTOMER EXPERIENCE
  {
    id: "customer_recovery",
    title: "Customer Recovery – Fixing Mistakes",
    tag: "Customer experience",
    level: 2,
    xp: 55,
    durationMins: 9,
    keywords: ["complaint", "refund", "apology", "replacement", "customer recovery"],
    summary: "Own the issue, fix it fast, and keep the customer calm.",
    steps: [
      "Listen without interrupting.",
      "Apologize and acknowledge the issue.",
      "Offer the correct fix (replace/remake/manager).",
      "Thank them for telling you.",
      "Share the learning with the team."
    ],
    checklist: [
      "I can stay calm with complaints",
      "I know the apology + fix flow",
      "I can get help quickly if needed",
      "I share learnings with team"
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
  if (typeof x === "string") return x;
  return fallback;
}

function calcLevelFromXP(xp) {
  // simple curve: 0-199 = L1, 200-449 = L2, 450-799 = L3, etc.
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

  // exact id
  const exact = MODULES.find(m => normalize(m.id) === q);
  if (exact) return exact;

  // contains title/tag
  const scored = MODULES.map(m => {
    const hay = `${m.title} ${m.tag} ${(m.keywords || []).join(" ")} ${m.summary || ""}`.toLowerCase();
    let score = 0;

    // strong match by words
    q.split(/\s+/).forEach(w => {
      if (!w) return;
      if (hay.includes(w)) score += 2;
      if (normalize(m.title).includes(w)) score += 3;
      if (normalize(m.tag).includes(w)) score += 2;
    });

    // extra for direct phrase in title
    if (normalize(m.title).includes(q)) score += 8;
    return { m, score };
  }).sort((a,b) => b.score - a.score);

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

    // training fields
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

    // header UI
    const xp = Number(userDocCache.trainingXP) || 0;
    const lvl = Number(userDocCache.trainingLevel) || calcLevelFromXP(xp);

    if (headerXP) headerXP.textContent = `${xp} XP total`;
    if (headerLevel) headerLevel.textContent = String(lvl);

    // keep level consistent
    const computed = calcLevelFromXP(xp);
    if (computed !== lvl) {
      // best-effort fix (don’t block UI)
      updateDoc(doc(db, "users", uid), { trainingLevel: computed }).catch(() => {});
    }

    // re-render completion styles
    renderPathRail();
    renderModuleGrid(trainingSearch?.value || "");
    refreshProgressPanel();
  });
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

  if (completeModuleBtn) completeModuleBtn.disabled = completed ? true : false;
  if (resetModuleBtn) resetModuleBtn.disabled = completed ? false : true;

  // restore reflection if saved
  const prog = getProgressMap()[m.id];
  if (reflectionInput) reflectionInput.value = prog?.reflection || "";
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

  pathList.querySelectorAll(".path-item").forEach((li) => {
    li.addEventListener("click", () => {
      const id = li.dataset.id;
      openModuleInLesson(id);
    });
  });
}

function openModuleInLesson(moduleId) {
  const m = MODULES.find(x => x.id === moduleId);
  if (!m) return;

  selectedModuleId = moduleId;

  if (lessonTitle) lessonTitle.textContent = m.title;
  if (lessonSubtitle) lessonSubtitle.textContent = safeText(m.summary, "Training module");
  if (lessonTag) lessonTag.textContent = m.tag || "Module";

  if (lessonContent) {
    lessonContent.innerHTML = buildModuleHTML(m);
  }

  buildChecklist(m);
  refreshProgressPanel();
  renderPathRail();
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
                <button class="btn-ghost open-module-btn" data-id="${m.id}" type="button">
                  Open
                </button>
              </div>
            </div>
            <div style="margin-top:8px; font-size:0.78rem; color:#374151;">
              ${safeText(m.summary, "")}
            </div>
          </div>
        `;
      }).join("")
    : `<div style="font-size:0.82rem; color:#6b7280;">No modules match that search.</div>`;

  trainingModuleGrid.querySelectorAll(".open-module-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      openModuleOverlay(id);
    });
  });
}

/* =========================
   MODULE OVERLAY + QUIZ
========================= */

function openModuleOverlay(moduleId) {
  const m = MODULES.find(x => x.id === moduleId);
  if (!m || !moduleOverlay) return;

  if (moduleTitle) moduleTitle.textContent = m.title;
  if (moduleMeta) moduleMeta.textContent = `${m.tag} • ${m.xp} XP • ~${m.durationMins || 8} min • Level ${m.level || 1}`;
  if (moduleBody) moduleBody.innerHTML = buildModuleHTML(m);

  // also sync the main lesson view
  openModuleInLesson(moduleId);

  // reset quiz UI
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

  // If no predefined quiz, generate simple multiple choice from steps/checklist
  if (!base.length) {
    const items = [...(m.steps || []), ...(m.checklist || [])].filter(Boolean);
    const pick = items.slice(0, 6);

    const generated = pick.slice(0, 3).map((t, idx) => {
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

    return generated;
  }

  // randomize a bit
  const shuffled = [...base].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(5, shuffled.length));
}

function renderQuizQuestion() {
  if (!activeQuiz || !quizArea) return;

  const qObj = activeQuiz.questions[activeQuiz.index];
  if (!qObj) {
    // finished
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
    document.getElementById("quizRetryBtn")?.addEventListener("click", () => {
      const m = MODULES.find(x => x.id === activeQuiz.moduleId);
      if (!m) return;
      startQuizForModule(m.id);
    });

    return;
  }

  const opts = (qObj.options || []).map((t, idx) => {
    return `
      <button class="btn-ghost quiz-opt" data-idx="${idx}" type="button"
        style="justify-content:flex-start; width:100%;">
        ${String.fromCharCode(65 + idx)}. ${t}
      </button>
    `;
  }).join("");

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

    <div id="quizExplain" style="display:none; margin-top:10px; padding:10px; border-radius:12px; border:1px solid #e5e7eb; background:#f9fafb;"></div>

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
        explain.innerHTML = `<strong>Explanation:</strong> ${safeText(qObj.explain, "Review the steps in the module.")}`;
      }
      if (nextBtn) nextBtn.disabled = false;
    });
  });

  nextBtn?.addEventListener("click", () => {
    activeQuiz.index += 1;
    renderQuizQuestion();
  });

  document.getElementById("quizExitBtn")?.addEventListener("click", hideQuiz);
}

function startQuizForModule(moduleId) {
  const m = MODULES.find(x => x.id === moduleId);
  if (!m || !quizArea) return;

  const questions = buildQuizFromModule(m);

  activeQuiz = {
    moduleId: m.id,
    questions,
    index: 0,
    score: 0
  };

  quizArea.style.display = "block";
  renderQuizQuestion();
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
   AI CHAT (open module + answer questions + quiz)
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
    "Quiz me on food safety",
    "What are the key steps for drive-thru speed?",
    "Explain cross-contamination",
    "Make me a 5 question quiz about fry station"
  ];
  trainingQuickChips.innerHTML = chips.map(t => `
    <button class="suggestion-chip" type="button">${t}</button>
  `).join("");

  trainingQuickChips.querySelectorAll("button").forEach(btn => {
    btn.addEventListener("click", () => {
      handleTrainingAI(btn.textContent);
    });
  });
}

// detect commands
function parseAICommand(text) {
  const t = normalize(text);

  // open module command
  if (t.startsWith("open ") || t.includes(" open ")) {
    // try to extract module phrase
    // examples:
    // "open grill training module"
    // "open the fry station module"
    const cleaned = t
      .replace("training module", "")
      .replace("module", "")
      .replace("open", "")
      .replace("the", "")
      .trim();

    return { type: "open", query: cleaned || t };
  }

  // quiz command
  if (t.startsWith("quiz") || t.includes("quiz me") || t.includes("start quiz") || t.includes("make me a") && t.includes("quiz")) {
    // pick module mentioned
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

  // 1) OPEN MODULE
  if (cmd.type === "open") {
    const best = findBestModuleByText(cmd.query);
    if (!best) {
      addChatMessage("I couldn’t find that module. Try: Grill, Fry Station, Food Safety, Front Counter, Drive-thru, Customer Recovery.", "bot");
      return;
    }

    addChatMessage(`Opening: <strong>${best.title}</strong> ✅`, "bot");
    openModuleOverlay(best.id);
    return;
  }

  // 2) QUIZ
  if (cmd.type === "quiz") {
    const best = findBestModuleByText(cmd.query);
    if (!best) {
      addChatMessage("Which module do you want a quiz on? Example: “Quiz me on grill station”.", "bot");
      return;
    }

    addChatMessage(`Starting a quiz for <strong>${best.title}</strong> 🧠`, "bot");
    openModuleOverlay(best.id);
    startQuizForModule(best.id);
    return;
  }

  // 3) ASK QUESTION (send to your backend with module context)
  const chosenModule = selectedModuleId ? MODULES.find(m => m.id === selectedModuleId) : null;

  const contextData = {
    page: "training",
    user: sessionUser,
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

  // simple local answer if question is basically "what modules exist"
  const lower = normalize(clean);
  if (lower.includes("what modules") || lower.includes("list modules")) {
    const list = MODULES.map(m => `• ${m.title} (${m.tag})`).join("<br>");
    addChatMessage(`Here are the modules available:<br>${list}`, "bot");
    return;
  }

  try {
    if (trainingAiSend) trainingAiSend.disabled = true;

    // show a small "thinking"
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

    // remove last "Thinking…" message (best-effort)
    if (trainingChat && trainingChat.lastElementChild) {
      const html = trainingChat.lastElementChild.innerHTML || "";
      if (html.includes("Thinking")) trainingChat.lastElementChild.remove();
    }

    addChatMessage(data.reply || "I’m not sure. Try asking about a specific module.", "bot");
  } catch (e) {
    console.error("Training AI error:", e);

    // remove last "Thinking…" message (best-effort)
    if (trainingChat && trainingChat.lastElementChild) {
      const html = trainingChat.lastElementChild.innerHTML || "";
      if (html.includes("Thinking")) trainingChat.lastElementChild.remove();
    }

    addChatMessage("Sorry, the training assistant had a problem. Try again.", "bot");
  } finally {
    if (trainingAiSend) trainingAiSend.disabled = false;
  }
}

/* =========================
   EVENTS
========================= */

if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    stopRealtime();
    await signOut(auth);
    localStorage.removeItem("mc_session_user");
    window.location.href = "index.html";
  });
}

if (sidebar && sidebarToggle) {
  sidebarToggle.addEventListener("click", () => {
    sidebar.classList.toggle("sidebar-open");
  });
}

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
  const t = trainingAiInput?.value || "";
  handleTrainingAI(t);
});

/* =========================
   INIT
========================= */

function seedTrainingChat() {
  if (!trainingChat) return;
  trainingChat.innerHTML = "";
  addChatMessage("Hi 👋 Ask me anything about training. Try: <strong>“open grill training module”</strong> or <strong>“quiz me on food safety”</strong>.", "bot");
}

function initialRender() {
  renderPathRail();
  renderModuleGrid("");
  renderAIChips();
  refreshProgressPanel();

  // pick a default module for first-time feel
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

  // ensure user doc exists
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
