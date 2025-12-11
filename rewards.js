/** ============================================================
 *  REWARD ENGINE — McStars • Badges • Achievements
 *  Works together with training-new.js
 * ============================================================ */

import { db } from "./firebase-init.js";
import { doc, updateDoc, getDoc, setDoc } from 
"https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

let sessionUser = null;

/* ============================================================
   BADGE DEFINITIONS
   ============================================================ */

export const badgeCatalog = {
  beginner: {
    id: "beginner",
    title: "New Crew Member",
    desc: "Completed your first training stage.",
    icon: "🥇",
    xpBoost: 0
  },

  safety_star: {
    id: "safety_star",
    title: "Safety Star",
    desc: "Passed a food safety quiz on first try.",
    icon: "🛡️",
    xpBoost: 10
  },

  perfect_run: {
    id: "perfect_run",
    title: "Perfect Run",
    desc: "Completed 3 stages without failing a quiz.",
    icon: "🔥",
    xpBoost: 20
  },

  multi_station: {
    id: "multi_station",
    title: "Versatile Crew",
    desc: "Completed Kitchen + Front Counter + Drive-Thru training.",
    icon: "🍔",
    xpBoost: 25
  },

  golden_arch: {
    id: "golden_arch",
    title: "Golden Arch Award",
    desc: "Reached Level 10 — a true McDonald's expert.",
    icon: "🏆",
    xpBoost: 50
  }
};

/* ============================================================
   RANK TIERS — McStars-Like Progression
   ============================================================ */

export const rankTiers = [
  { id: "crew", label: "Crew Member", minLevel: 1 },
  { id: "silver", label: "Silver Crew", minLevel: 5 },
  { id: "gold", label: "Gold Crew", minLevel: 10 },
  { id: "trainer", label: "Crew Trainer", minLevel: 15 },
  { id: "smanager", label: "Shift Manager", minLevel: 20 }
];

/* ============================================================
   LOAD / SAVE REWARD PROFILE
   ============================================================ */

let rewardData = {
  badges: [],
  achievements: [],
  rank: "crew"
};

export async function loadRewardProfile(userId) {
  sessionUser = userId;
  const ref = doc(db, "users", userId, "training", "rewards");

  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, rewardData);
    return rewardData;
  }

  rewardData = { ...rewardData, ...snap.data() };
  return rewardData;
}

async function saveRewardProfile() {
  const ref = doc(db, "users", sessionUser, "training", "rewards");
  await updateDoc(ref, rewardData);
}

/* ============================================================
   BADGE UNLOCKING
   ============================================================ */

export async function unlockBadge(id, showPopup = true) {
  if (rewardData.badges.includes(id)) return;

  rewardData.badges.push(id);
  await saveRewardProfile();

  const badge = badgeCatalog[id];
  if (showPopup) showRewardPopup(badge.icon, badge.title, badge.desc);
}

/* ============================================================
   RANK UPDATE
   ============================================================ */

export async function updateRank(level) {
  let newRank = rewardData.rank;

  for (let r of rankTiers) {
    if (level >= r.minLevel) newRank = r.id;
  }

  if (newRank !== rewardData.rank) {
    rewardData.rank = newRank;
    await saveRewardProfile();

    const tier = rankTiers.find(t => t.id === newRank);
    showRewardPopup("⭐", "Rank Up!", `You are now ${tier.label}`);
  }
}

/* ============================================================
   ACHIEVEMENTS
   ============================================================ */

export async function checkAchievements(trainingData) {
  // Ach 1 — First stage
  if (trainingData.completedStages.length >= 1)
    await unlockAchievement("first_step", "First Step", "Completed your first training stage.");

  // Ach 2 — 3 stages completed
  if (trainingData.completedStages.length >= 3)
    await unlockAchievement("stage3", "Getting Serious", "Completed 3 training stages.");

  // Ach 3 — All stages
  if (trainingData.completedStages.length >= 10)
    await unlockAchievement("full_clear", "Expert", "Completed ALL training stages.");
}

async function unlockAchievement(id, title, desc) {
  if (rewardData.achievements.includes(id)) return;

  rewardData.achievements.push(id);
  await saveRewardProfile();

  showRewardPopup("🎉", title, desc);
}

/* ============================================================
   POPUP UI (Animated)
   ============================================================ */

const popupContainer = document.getElementById("rewardPopupContainer");

export function showRewardPopup(icon, title, desc) {
  const el = document.createElement("div");
  el.className = "reward-popup";

  el.innerHTML = `
    <div class="reward-icon">${icon}</div>
    <div class="reward-text">
      <h3>${title}</h3>
      <p>${desc}</p>
    </div>
  `;

  popupContainer.appendChild(el);

  setTimeout(() => {
    el.classList.add("show");
  }, 50);

  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 300);
  }, 3500);
}
