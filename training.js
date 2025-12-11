/** ============================================================
 *  McTRAINING — GAMIFIED TRAINING ENGINE
 *  XP System • Leveling • Rewards • Battle-Pass Track • Quizzes
 *  Firestore Sync • Manager Analytics
 * ============================================================ */

import { auth, db } from "./firebase-init.js";
import {
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

import {
  doc,
  getDoc,
  setDoc,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

/* ============================================================
   DOM ELEMENTS
   ============================================================ */

const sidebarUserName = document.getElementById("sidebarUserName");
const sidebarUserRole = document.getElementById("sidebarUserRole");
const logoutBtn = document.getElementById("logoutBtn");

/* XP UI */
const levelCircle = document.getElementById("levelCircle");
const xpFill = document.getElementById("xpFill");
const xpLabel = document.getElementById("xpLabel");

/* Battle Track */
const trackContainer = document.getElementById("trackContainer");

/* Lesson area */
const lessonTitleEl = document.getElementById("lessonTitle");
const lessonTagEl = document.getElementById("lessonTag");
const lessonBodyEl = document.getElementById("lessonBody");
const lessonTipsEl = document.getElementById("lessonTips");
const startQuizBtn = document.getElementById("startQuizBtn");
const quizHint = document.getElementById("quizHint");

/* Modals */
const rewardModal = document.getElementById("rewardModal");
const rewardTitle = document.getElementById("rewardTitle");
const rewardText = document.getElementById("rewardText");
const rewardClose = document.getElementById("rewardClose");

const quizModal = document.getElementById("quizModal");
const quizQuestionEl = document.getElementById("quizQuestion");
const quizOptionsEl = document.getElementById("quizOptions");
const quizSubmit = document.getElementById("quizSubmit");
const quizCloseBtn = document.getElementById("quizCloseBtn");

/* Sidebar toggle (mobile) */
const sidebar = document.querySelector(".sidebar");
const sidebarToggle = document.getElementById("sidebarToggle");
if (sidebar && sidebarToggle) {
  sidebarToggle.addEventListener("click", () => {
    sidebar.classList.toggle("sidebar-open");
  });
}

/* ============================================================
   USER SESSION
   ============================================================ */

let sessionUser = null;
let currentStage = null; // which stage is selected for lesson/quiz

function loadSession() {
  try {
    return JSON.parse(localStorage.getItem("mc_session_user"));
  } catch {
    return null;
  }
}

/* ============================================================
   TRAINING STAGES  (with actual lesson content)
   ============================================================ */

const trainingStages = [
  {
    id: 1,
    name: "Welcome to McDonald's",
    xp: 50,
    tag: "Orientation",
    lesson: {
      summary:
        "Get familiar with our values, basic policies and how shifts work at your restaurant.",
      bullets: [
        "Customer safety and food safety always come first.",
        "Always arrive in full, clean uniform and clock in on time.",
        "If you’re unsure, ask a manager or trainer — never guess."
      ],
      tips:
        "Tip: Spend your first week watching how experienced crew handle rushes. Notice how they stay calm, communicate, and follow the same steps every time."
    }
  },
  {
    id: 2,
    name: "Crew Basics",
    xp: 60,
    tag: "Core skills",
    lesson: {
      summary:
        "Learn the fundamental behaviours expected from every crew member, in any store.",
      bullets: [
        "Follow the '4 steps of service': Greet, Take order, Prepare, Hand over & thank.",
        "Use the correct PPE when handling food (gloves, apron, hat / hairnet).",
        "Keep your station tidy between orders — quick wipes save time later."
      ],
      tips:
        "Tip: When you’re not serving a guest, scan your station: wipes, restock, or help another crew member."
    }
  },
  {
    id: 3,
    name: "Food Safety & Hygiene",
    xp: 80,
    tag: "Food safety",
    lesson: {
      summary:
        "Understand how we keep food safe from delivery to serving the guest.",
      bullets: [
        "Wash hands for at least 20 seconds at the correct sink, then dry with paper towel.",
        "Follow colour-coded equipment rules and avoid cross-contamination.",
        "Cooked patties must reach the required temperature before serving."
      ],
      tips:
        "Tip: If you are ever unsure whether food is safe, treat it as unsafe and ask a manager — we never risk it for speed."
    }
  },
  {
    id: 4,
    name: "Kitchen Essentials",
    xp: 100,
    tag: "Kitchen",
    lesson: {
      summary:
        "Learn how the kitchen is organised so you can move quickly and safely.",
      bullets: [
        "Know where each ingredient lives and label products correctly.",
        "Follow build charts exactly — consistency matters to guests.",
        "Keep cooking surfaces and utensils sanitised between tasks."
      ],
      tips:
        "Tip: Before busy periods, restock your line so you’re not searching for items during a rush."
    }
  },
  {
    id: 5,
    name: "Front Counter Service",
    xp: 120,
    tag: "Service",
    lesson: {
      summary:
        "Deliver friendly, accurate service on front counter, kiosks and mobile orders.",
      bullets: [
        "Greet every guest within a few seconds with a smile and eye contact.",
        "Repeat orders back to confirm and check screens before handing food out.",
        "Handle complaints calmly — apologise, fix the issue, and involve a manager when needed."
      ],
      tips:
        "Tip: Use names (when shown on kiosk/mobile orders) — it personalises the experience and reduces mix-ups."
    }
  },
  {
    id: 6,
    name: "Drive-Thru Service",
    xp: 140,
    tag: "Drive-Thru",
    lesson: {
      summary:
        "Work as a tight team to keep the Drive-Thru fast, accurate and friendly.",
      bullets: [
        "Use the headset correctly — short, clear phrases and repeat the total.",
        "Check drinks, bags and condiments match the order on screen.",
        "Never lean too far out of the window; prioritise safety."
      ],
      tips:
        "Tip: Listen for repeat orders and anticipate the next car — small seconds saved on each order add up."
    }
  },
  {
    id: 7,
    name: "Peak Time Efficiency",
    xp: 160,
    tag: "Rush times",
    lesson: {
      summary:
        "Stay organised when the restaurant is busy so guests still feel looked after.",
      bullets: [
        "Communicate constantly: call out large orders and low stock early.",
        "Use simple phrases like 'I’ll take orders', 'I’ll bag', 'I’ll drinks'.",
        "Move with purpose but never run — safety before speed."
      ],
      tips:
        "Tip: Agree roles with the team before the rush starts. Changing roles mid-rush slows everyone down."
    }
  },
  {
    id: 8,
    name: "Customer Experience",
    xp: 180,
    tag: "Guest focus",
    lesson: {
      summary:
        "Create small moments of 'wow' that make guests want to come back.",
      bullets: [
        "Keep dining and counter areas clean and welcoming.",
        "Look for chances to help: highchairs, carrying trays, topping up sauces.",
        "Thank guests sincerely and invite them back."
      ],
      tips:
        "Tip: A simple 'Thanks for waiting, I really appreciate your patience' can turn a delay into a positive experience."
    }
  },
  {
    id: 9,
    name: "Advanced Station Training",
    xp: 200,
    tag: "Cross-training",
    lesson: {
      summary:
        "Become confident working across multiple stations so you can support any shift.",
      bullets: [
        "Once you’re solid on one station, ask to shadow another during quieter times.",
        "Use training checklists to track which tasks you can do independently.",
        "Share tips with newer crew — teaching others reinforces your own knowledge."
      ],
      tips:
        "Tip: Aim to be signed off on 3+ stations; it makes you more valuable on the rota and opens progression paths."
    }
  },
  {
    id: 10,
    name: "Certification Challenge",
    xp: 250,
    tag: "Certification",
    lesson: {
      summary:
        "Pull together everything you’ve learned to demonstrate you’re certification-ready.",
      bullets: [
        "Show safe behaviours without reminders: handwashing, PPE, sanitising.",
        "Hit expected times on your stations while staying calm and polite.",
        "Explain key safety and service steps to your trainer or manager."
      ],
      tips:
        "Tip: Before your assessment, re-read earlier stages and ask for feedback on one thing to tighten up each shift."
    }
  }
];

/* ============================================================
   USER TRAINING DATA (Synced with Firestore)
   ============================================================ */

let trainingData = {
  xp: 0,
  level: 1,
  completedStages: [],   // [1,2,3,...]
  unlocked: 1,           // first stage unlocked
  rewardsClaimed: []
};

/* ============================================================
   FIRESTORE: LOAD OR CREATE USER PROFILE
   ============================================================ */

async function loadTrainingProfile(userId) {
  try {
    const ref = doc(db, "users", userId, "training", "profile");
    const snap = await getDoc(ref);

    if (!snap.exists()) {
      console.log("Training profile does not exist — creating new one.");
      await setDoc(ref, trainingData);
      return trainingData;
    }

    const data = snap.data();
    trainingData = { ...trainingData, ...data };

    console.log("Loaded training profile:", trainingData);
    return trainingData;
  } catch (err) {
    console.error("Error loading training profile:", err);
  }
}

/* ============================================================
   FIRESTORE: SAVE PROFILE
   ============================================================ */

async function saveTrainingProfile() {
  if (!sessionUser) return;
  try {
    const ref = doc(db, "users", sessionUser.id, "training", "profile");
    await updateDoc(ref, trainingData);
  } catch (err) {
    console.error("Error saving training profile:", err);
  }
}

/* ============================================================
   XP + LEVEL SYSTEM
   ============================================================ */

function getXpRequired(level) {
  return 100 + (level - 1) * 50; // increases each level
}

function bumpLevelCircle() {
  if (!levelCircle) return;
  levelCircle.classList.remove("level-circle-bump");
  // trigger reflow
  void levelCircle.offsetWidth;
  levelCircle.classList.add("level-circle-bump");
}

function addXP(amount) {
  trainingData.xp += amount;

  const required = getXpRequired(trainingData.level);

  if (trainingData.xp >= required) {
    trainingData.xp -= required;
    trainingData.level++;
    bumpLevelCircle();
    showRewardModal("LEVEL UP!", `You reached Level ${trainingData.level}! ⭐`);
  }

  updateXPUI();
  saveTrainingProfile();
}

function updateXPUI() {
  if (!xpFill || !xpLabel || !levelCircle) return;

  const needed = getXpRequired(trainingData.level);
  const pct = Math.min(100, (trainingData.xp / needed) * 100);

  xpFill.style.width = pct + "%";
  xpLabel.textContent = `${trainingData.xp} / ${needed} XP`;
  levelCircle.textContent = trainingData.level;
}

/* ============================================================
   TRACK RENDERING
   ============================================================ */

function renderTrainingTrack() {
  trackContainer.innerHTML = "";

  trainingStages.forEach((stage) => {
    const card = document.createElement("div");
    const completed = trainingData.completedStages.includes(stage.id);
    const locked = stage.id > trainingData.unlocked;

    card.className = "track-card";
    if (completed) card.classList.add("completed");
    if (locked) card.classList.add("locked");

    card.innerHTML = `
      <div class="stage-number">Stage ${stage.id}</div>
      <h3>${stage.name}</h3>
      <div class="xp-reward">+${stage.xp} XP</div>
    `;

    card.onclick = () => {
      if (locked) return;
      openStage(stage);
    };

    trackContainer.appendChild(card);
  });
}

/* ============================================================
   LESSON RENDERING + STAGE OPEN
   ============================================================ */

function renderLesson(stage) {
  currentStage = stage;

  if (!lessonTitleEl || !lessonBodyEl || !lessonTagEl) return;

  lessonTitleEl.textContent = stage.name;
  lessonTagEl.textContent = stage.tag || "Training";
  lessonBodyEl.classList.remove("lesson-placeholder");

  const lesson = stage.lesson || {};
  const bullets = (lesson.bullets || [])
    .map((b) => `<li>${b}</li>`)
    .join("");

  lessonBodyEl.innerHTML = `
    <p>${lesson.summary || ""}</p>
    ${
      bullets
        ? `<ul>${bullets}</ul>`
        : ""
    }
  `;

  if (lessonTipsEl) {
    if (lesson.tips) {
      lessonTipsEl.style.display = "block";
      lessonTipsEl.textContent = lesson.tips;
    } else {
      lessonTipsEl.style.display = "none";
    }
  }

  if (startQuizBtn) {
    startQuizBtn.disabled = false;
    startQuizBtn.textContent = `Start quiz for "${stage.name}"`;
  }
  if (quizHint) {
    quizHint.textContent = "When you’re ready, take the quiz to complete this stage.";
  }
}

function openStage(stage) {
  renderLesson(stage);
}

/* ============================================================
   COMPLETING A STAGE → XP + Unlock next + Reward
   ============================================================ */

function completeStage(stage) {
  if (!trainingData.completedStages.includes(stage.id)) {
    trainingData.completedStages.push(stage.id);

    // unlock next
    if (trainingData.unlocked < trainingStages.length) {
      trainingData.unlocked = stage.id + 1;
    }

    addXP(stage.xp);

    showRewardModal(
      "Training complete!",
      `You completed <strong>${stage.name}</strong> and earned <strong>${stage.xp} XP</strong>.`
    );

    saveTrainingProfile();
    renderTrainingTrack();
  }
}

/* ============================================================
   QUIZ SYSTEM
   ============================================================ */

function showQuizModal(stage) {
  if (!stage) return;
  quizModal.classList.add("show");
  populateQuiz(stage);
}

function hideQuizModal() {
  quizModal.classList.remove("show");
}

function populateQuiz(stage) {
  const question = generateQuizQuestion(stage.id);
  const options = generateQuizOptions(stage.id);

  quizQuestionEl.textContent = question;
  quizOptionsEl.innerHTML = "";

  options.forEach((opt) => {
    const el = document.createElement("div");
    el.className = "quiz-option";
    el.textContent = opt.text;
    el.dataset.correct = opt.correct ? "true" : "false";
    el.onclick = () => {
      document
        .querySelectorAll(".quiz-option")
        .forEach((o) => o.classList.remove("selected"));
      el.classList.add("selected");
    };
    quizOptionsEl.appendChild(el);
  });
}

/* Example quiz questions */
function generateQuizQuestion(id) {
  const questions = {
    1: "What is the #1 priority at McDonald's?",
    2: "Which item is considered PPE?",
    3: "What temperature must cooked patties reach before serving?",
    4: "Why is following build charts important?",
    5: "What should you do after taking a guest’s order?",
    6: "What’s key for great Drive-Thru service?",
    7: "What should the team do before a busy period?",
    8: "Which action most improves customer experience?",
    9: "What is cross-training?",
    10: "What should you do before your certification assessment?"
  };
  return questions[id] || "Question missing.";
}

function generateQuizOptions(id) {
  const answers = {
    1: [
      { text: "Customer and food safety", correct: true },
      { text: "Speed only", correct: false },
      { text: "Cleaning only", correct: false }
    ],
    2: [
      { text: "Gloves", correct: true },
      { text: "Fries", correct: false },
      { text: "Drink lids", correct: false }
    ],
    3: [
      { text: "At least 75°C", correct: true },
      { text: "30°C", correct: false },
      { text: "45°C", correct: false }
    ],
    4: [
      { text: "They keep products consistent for guests", correct: true },
      { text: "They make burgers look bigger", correct: false },
      { text: "They are optional suggestions", correct: false }
    ],
    5: [
      { text: "Repeat the order and thank the guest", correct: true },
      { text: "Turn away and start another task", correct: false },
      { text: "Hand over food without checking", correct: false }
    ],
    6: [
      { text: "Clear communication and accuracy", correct: true },
      { text: "Speaking as fast as possible", correct: false },
      { text: "Ignoring screens and guessing orders", correct: false }
    ],
    7: [
      { text: "Agree roles and restock stations", correct: true },
      { text: "Wait until it’s busy, then decide", correct: false },
      { text: "All swap roles randomly during the rush", correct: false }
    ],
    8: [
      { text: "Thank guests and keep areas clean", correct: true },
      { text: "Avoid eye contact", correct: false },
      { text: "Only focus on drive-thru cars", correct: false }
    ],
    9: [
      { text: "Training to work confidently on multiple stations", correct: true },
      { text: "Doing the same task all shift", correct: false },
      { text: "Skipping training modules", correct: false }
    ],
    10: [
      {
        text: "Review earlier stages and ask for feedback",
        correct: true
      },
      { text: "Avoid talking to your trainer", correct: false },
      { text: "Ignore food safety rules", correct: false }
    ]
  };

  return answers[id] || [{ text: "OK", correct: true }];
}

/* Quiz submit handler */
if (quizSubmit) {
  quizSubmit.onclick = () => {
    const selected = document.querySelector(".quiz-option.selected");
    if (!selected) return;

    const isCorrect = selected.dataset.correct === "true";

    if (!currentStage) return;

    if (isCorrect) {
      hideQuizModal();
      completeStage(currentStage);
    } else {
      selected.style.background = "#fee2e2";
      setTimeout(() => {
        selected.style.background = "";
      }, 500);
      showRewardModal("Try again", "Oops! That wasn’t quite right. Read the lesson once more and try again.");
    }
  };
}

/* ============================================================
   REWARD MODAL
   ============================================================ */

function showRewardModal(title, text) {
  rewardTitle.textContent = title;
  rewardText.innerHTML = text;
  rewardModal.classList.add("show");
}

rewardClose.onclick = () => rewardModal.classList.remove("show");

/* Close quiz modal via X */
if (quizCloseBtn) {
  quizCloseBtn.onclick = () => hideQuizModal();
}

/* Start quiz from side card */
if (startQuizBtn) {
  startQuizBtn.onclick = () => {
    if (!currentStage) return;
    showQuizModal(currentStage);
  };
}

/* ============================================================
   AUTH INIT
   ============================================================ */

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }

  sessionUser = loadSession() || {
    id: user.uid,
    role: "crew",
    name: user.displayName || user.email || "User"
  };

  sidebarUserName.textContent = sessionUser.name;
  sidebarUserRole.textContent =
    sessionUser.role === "manager" ? "Restaurant Manager" : "Crew Member";

  await loadTrainingProfile(sessionUser.id);

  updateXPUI();
  renderTrainingTrack();
});

/* ============================================================
   LOGOUT
   ============================================================ */

if (logoutBtn) {
  logoutBtn.onclick = async () => {
    await signOut(auth);
    localStorage.removeItem("mc_session_user");
    window.location.href = "index.html";
  };
}
