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

/* Modals */
const rewardModal = document.getElementById("rewardModal");
const rewardTitle = document.getElementById("rewardTitle");
const rewardText = document.getElementById("rewardText");
const rewardClose = document.getElementById("rewardClose");

const quizModal = document.getElementById("quizModal");
const quizQuestionEl = document.getElementById("quizQuestion");
const quizOptionsEl = document.getElementById("quizOptions");
const quizSubmit = document.getElementById("quizSubmit");

/* ============================================================
   USER SESSION
   ============================================================ */

let sessionUser = null;

function loadSession() {
  try {
    return JSON.parse(localStorage.getItem("mc_session_user"));
  } catch {
    return null;
  }
}

/* ============================================================
   TRAINING BATTLE PASS (10 Stages)
   ============================================================ */

const trainingStages = [
  { id: 1, name: "Welcome to McDonald’s", xp: 50 },
  { id: 2, name: "Crew Basics", xp: 60 },
  { id: 3, name: "Food Safety & Hygiene", xp: 80 },
  { id: 4, name: "Kitchen Essentials", xp: 100 },
  { id: 5, name: "Front Counter Service", xp: 120 },
  { id: 6, name: "Drive-Thru Service", xp: 140 },
  { id: 7, name: "Peak Time Efficiency", xp: 160 },
  { id: 8, name: "Customer Experience", xp: 180 },
  { id: 9, name: "Advanced Station Training", xp: 200 },
  { id: 10, name: "Certification Challenge", xp: 250 }
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

function addXP(amount) {
  trainingData.xp += amount;

  const required = getXpRequired(trainingData.level);

  if (trainingData.xp >= required) {
    trainingData.xp -= required;
    trainingData.level++;
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

  trainingStages.forEach(stage => {
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
   COMPLETING A STAGE → XP + Unlock next + Quiz + Reward
   ============================================================ */

function openStage(stage) {
  showQuizModal(stage);
}

function completeStage(stage) {
  if (!trainingData.completedStages.includes(stage.id)) {
    trainingData.completedStages.push(stage.id);

    // unlock next
    if (trainingData.unlocked < trainingStages.length) {
      trainingData.unlocked = stage.id + 1;
    }

    addXP(stage.xp);

    showRewardModal(
      "Training Complete!",
      `You completed **${stage.name}** and earned **${stage.xp} XP**!`
    );

    saveTrainingProfile();
    renderTrainingTrack();
  }
}

/* ============================================================
   QUIZ SYSTEM
   ============================================================ */

function showQuizModal(stage) {
  quizQuestionEl.textContent = generateQuizQuestion(stage.id);
  quizOptionsEl.innerHTML = "";
  quizModal.classList.add("show");

  const options = generateQuizOptions(stage.id);

  options.forEach(opt => {
    const el = document.createElement("div");
    el.className = "quiz-option";
    el.textContent = opt.text;
    el.dataset.correct = opt.correct;
    el.onclick = () => {
      document.querySelectorAll(".quiz-option")
        .forEach(o => o.classList.remove("selected"));
      el.classList.add("selected");
    };
    quizOptionsEl.appendChild(el);
  });

  quizSubmit.onclick = () => {
    const selected = document.querySelector(".quiz-option.selected");
    if (!selected) return;

    if (selected.dataset.correct === "true") {
      quizModal.classList.remove("show");
      completeStage(stage);
    } else {
      selected.style.background = "#fee2e2";
      setTimeout(() => {
        showRewardModal("Try Again", "Oops! Incorrect answer. Give it another go!");
      }, 200);
    }
  };
}

/* Example quiz questions */
function generateQuizQuestion(id) {
  const questions = {
    1: "What is the #1 priority at McDonald's?",
    2: "Which item is PPE?",
    3: "What temperature must cooked patties reach?",
    4: "Which station handles buns?",
    5: "What is the proper greeting?",
    6: "Who takes Drive-Thru money?",
    7: "When do fries get salted?",
    8: "What improves customer satisfaction?",
    9: "What is cross-training?",
    10: "What must you do before certification?"
  };
  return questions[id] || "Question missing.";
}

function generateQuizOptions(id) {
  const answers = {
    1: [
      { text: "Customer safety", correct: true },
      { text: "Speed only", correct: false },
      { text: "Cleaning only", correct: false },
    ],
    2: [
      { text: "Gloves", correct: true },
      { text: "Fries", correct: false },
      { text: "Apron label", correct: false }
    ],
    3: [
      { text: "Minimum 75°C", correct: true },
      { text: "30°C", correct: false },
      { text: "45°C", correct: false }
    ]
    // ...continue as needed
  };

  return answers[id] || [{ text: "OK", correct: true }];
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
  sidebarUserRole.textContent = sessionUser.role === "manager"
    ? "Restaurant Manager"
    : "Crew Member";

  await loadTrainingProfile(sessionUser.id);

  updateXPUI();
  renderTrainingTrack();
});

/* ============================================================
   LOGOUT
   ============================================================ */

logoutBtn.onclick = async () => {
  await signOut(auth);
  localStorage.removeItem("mc_session_user");
  window.location.href = "index.html";
};
