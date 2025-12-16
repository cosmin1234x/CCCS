// ================================
// main.js – FULL VERSION (Vercel) — WORKING + PERMISSIONS FIX
// Uses Firestore paths:
//   users/{uid}
//   stores/{storeId}
//   stores/{storeId}/Shifts   (capital S)
//   stores/{storeId}/crewSummary
// ================================

import { auth, db } from "./firebase-init.js";
import {
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

import {
  doc,
  getDoc,
  setDoc,
  collection,
  getDocs,
  updateDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

/* ============================================================
   SESSION HANDLING
============================================================ */

let sessionUser = null;
let allShifts = []; // all shifts in this store

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

/* ============================================================
   DEFAULT DATA MODELS (overwritten by Firestore)
============================================================ */

const crewDataDefault = {
  position: "Crew Member",
  hourlyRate: 12.22,
  hoursThisWeek: 0,
  estimatedPayThisWeek: 0,
  nextShift: { day: "-", date: "", start: "", end: "" },
  certifications: [],
  trainingTodo: [],
  achievements: [],
  schedule: []
};

let crewData = JSON.parse(JSON.stringify(crewDataDefault));

const managerDataDefault = {
  storeName: "Your restaurant",
  todaySales: 0,
  weekSales: 0,
  todayWasteValue: 0,
  todayWastePct: 0,
  staffOnShift: 0,
  staffNeeded: 10,
  trainingGaps: 0,
  potentialOvertime: 0,
  foodWasteByDay: [],
  crewTrainingSummary: []
};

let managerData = JSON.parse(JSON.stringify(managerDataDefault));

/* ============================================================
   DOM ELEMENTS
============================================================ */

const sidebarUserName = document.getElementById("sidebarUserName");
const sidebarUserRole = document.getElementById("sidebarUserRole");
const welcomeTitle = document.getElementById("welcomeTitle");
const welcomeSubtitle = document.getElementById("welcomeSubtitle");
const roleBadge = document.getElementById("roleBadge");
const avatarCircle = document.getElementById("avatarCircle");

const topCards = document.getElementById("topCards");
const bottomSection = document.getElementById("bottomSection");

const aiSubtitle = document.getElementById("aiSubtitle");
const aiSuggestions = document.getElementById("aiSuggestions");
const aiChat = document.getElementById("aiChat");
const aiForm = document.getElementById("aiForm");
const aiInput = document.getElementById("aiInput");
const aiSendBtn = document.getElementById("aiSendBtn");

const logoutBtn = document.getElementById("logoutBtn");
const navShiftCreator = document.getElementById("navShiftCreator");
const myProfileBtn = document.getElementById("myProfileBtn");

// Voice
const micBtn = document.getElementById("aiMicBtn");
const overlay = document.getElementById("voiceOverlay");
const overlayText = document.getElementById("overlayText");
const overlayMic = document.getElementById("overlayMic");
const wakeToggle = document.getElementById("wakeToggle");

// Crew Profile Overlay
const crewProfileOverlay = document.getElementById("crewProfileOverlay");
const crewProfileClose = document.getElementById("crewProfileClose");
const crewProfileName = document.getElementById("crewProfileName");
const crewProfileRole = document.getElementById("crewProfileRole");
const crewProfileStore = document.getElementById("crewProfileStore");
const crewProfileStatus = document.getElementById("crewProfileStatus");
const crewProfileBadge = document.getElementById("crewProfileBadge");
const crewProfileNextShift = document.getElementById("crewProfileNextShift");
const crewProfileStations = document.getElementById("crewProfileStations");
const crewProfileNotes = document.getElementById("crewProfileNotes");
const crewProfileAvatar = document.getElementById("crewProfileAvatar");
const crewProfileStars = document.getElementById("crewProfileStars");

// Sidebar toggle
const sidebar = document.querySelector(".sidebar");
const sidebarToggle = document.getElementById("sidebarToggle");

/* ============================================================
   DATE HELPERS
============================================================ */

function toISODateString(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getMonday(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0–6
  const diff = (day === 0 ? -6 : 1) - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getWeekRange(offset = 0, base = new Date()) {
  const monday = getMonday(base);
  const start = new Date(monday);
  start.setDate(start.getDate() + offset * 7);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { start, end };
}

function parseShiftHours(startHHMM, endHHMM) {
  if (!startHHMM || !endHHMM) return 0;
  const [sh, sm] = startHHMM.split(":").map((x) => parseInt(x, 10) || 0);
  const [eh, em] = endHHMM.split(":").map((x) => parseInt(x, 10) || 0);

  let start = sh + sm / 60;
  let end = eh + em / 60;
  if (end < start) end += 24; // crossing midnight
  return Math.max(0, end - start);
}

/* ============================================================
   UK BREAK RULES
============================================================ */

function calculateBreakMinutes(hours) {
  if (hours <= 0) return 0;
  if (hours < 5) return 15;
  if (hours < 8) return 30;
  return 45;
}

/* ============================================================
   IMPORTANT FIX: Ensure /users/{uid} exists
   Otherwise your Firestore rules will block store reads.
============================================================ */

async function ensureUserDoc(firebaseUser) {
  const userRef = doc(db, "users", firebaseUser.uid);
  const snap = await getDoc(userRef);
  if (snap.exists()) return snap.data();

  // If missing, create minimal profile so rules allow store reads.
  const cached = loadSessionUser() || {};
  const payload = {
    name: cached.name || firebaseUser.displayName || firebaseUser.email || "User",
    email: String(firebaseUser.email || "").toLowerCase(),
    role: cached.role || "crew",
    storeId: cached.storeId || "store001",
    createdAt: serverTimestamp()
  };

  await setDoc(userRef, payload);
  return payload;
}

/* ============================================================
   FIRESTORE LOADERS
============================================================ */

async function loadCrewUserFromFirestore() {
  if (!sessionUser) return;

  try {
    const ref = doc(db, "users", sessionUser.id);
    const snap = await getDoc(ref);
    if (!snap.exists()) return;

    const d = snap.data();

    if (d.role && d.role !== sessionUser.role) sessionUser.role = d.role;
    if (d.storeId && d.storeId !== sessionUser.storeId) sessionUser.storeId = d.storeId;
    if (d.name && d.name !== sessionUser.name) sessionUser.name = d.name;
    saveSessionUser(sessionUser);

    // optional crew fields
    if (typeof d.position === "string") crewData.position = d.position;
    if (typeof d.hourlyRate === "number") crewData.hourlyRate = d.hourlyRate;
    if (Array.isArray(d.certifications)) crewData.certifications = d.certifications;
    if (Array.isArray(d.trainingTodo)) crewData.trainingTodo = d.trainingTodo;
    if (Array.isArray(d.achievements)) crewData.achievements = d.achievements;
  } catch (err) {
    console.error("[Crew] Firestore load error:", err);
  }
}

async function loadStoreAndShiftsFromFirestore() {
  if (!sessionUser) return;

  const storeId = sessionUser.storeId || "store001";

  try {
    const storeRef = doc(db, "stores", storeId);

    const [storeSnap, shiftsSnap, crewSnap] = await Promise.all([
      getDoc(storeRef),
      // ✅ IMPORTANT: match schedule.js ("Shifts" capital S)
      getDocs(collection(db, "stores", storeId, "Shifts")),
      getDocs(collection(db, "stores", storeId, "crewSummary"))
    ]);

    // Store doc is optional — fallback if missing
    if (storeSnap.exists()) {
      Object.assign(managerData, managerDataDefault, storeSnap.data());
      if (typeof managerData.staffNeeded !== "number") managerData.staffNeeded = 10;
    } else {
      Object.assign(managerData, managerDataDefault, { storeName: storeId });
    }

    // Shifts
    allShifts = [];
    shiftsSnap.forEach((docSnap) => {
      const d = docSnap.data();
      if (!d.date || !d.start || !d.end || !d.userId) return;

      allShifts.push({
        id: docSnap.id,
        date: d.date,
        start: d.start,
        end: d.end,
        userId: d.userId,
        userName: d.userName || "Unknown",
        station: d.station || "",
        role: d.role || "crew",
        isShiftManager: !!d.isShiftManager,
        generatedByAI: !!d.generatedByAI
      });
    });

    const myShifts = allShifts.filter((s) => s.userId === sessionUser.id);
    window.loadedShiftsForCrew = myShifts;

    computeManagerMetrics();
    if (sessionUser.role === "crew") computeCrewMetrics(myShifts);

    // Crew Summary
    const list = [];
    crewSnap.forEach((snap) => {
      const d = snap.data();
      list.push({
        id: snap.id,
        name: d.name || "Crew",
        status: d.status || "—",
        badge: d.badge || "—",
        stars: typeof d.stars === "number" ? d.stars : 0
      });
    });
    managerData.crewTrainingSummary = list;
  } catch (err) {
    console.error("[Store] Firestore load error:", err);
  }
}

/* ============================================================
   METRIC CALCULATIONS
============================================================ */

function computeManagerMetrics() {
  const todayISO = toISODateString(new Date());
  const todays = allShifts.filter((s) => s.date === todayISO);
  managerData.staffOnShift = todays.length;
}

function computeCrewMetrics(myShifts) {
  if (!myShifts) return;

  const { start, end } = getWeekRange(0);
  const weekStart = toISODateString(start);
  const weekEnd = toISODateString(end);
  const now = new Date();

  let totalPaid = 0;
  const scheduleMap = {};
  let nextShiftObj = null;

  myShifts.forEach((s) => {
    const rawHours = parseShiftHours(s.start, s.end);
    const breakMin = calculateBreakMinutes(rawHours);
    const paid = rawHours - breakMin / 60;

    s.breakMinutes = breakMin;

    if (s.date >= weekStart && s.date <= weekEnd) {
      totalPaid += paid;
      if (!scheduleMap[s.date]) scheduleMap[s.date] = [];
      scheduleMap[s.date].push(`${s.start}–${s.end} (Break ${breakMin}m)`);
    }

    const shiftDateTime = new Date(`${s.date}T${s.start || "00:00"}:00`);
    if (shiftDateTime > now) {
      if (!nextShiftObj || shiftDateTime < nextShiftObj._dt) {
        nextShiftObj = { _dt: shiftDateTime, ...s };
      }
    }
  });

  crewData.schedule = Object.entries(scheduleMap)
    .sort(([a], [b]) => (a > b ? 1 : -1))
    .map(([date, times]) => {
      const d = new Date(`${date}T00:00:00`);
      const dayName = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()];
      return { day: dayName, time: times.join(", ") };
    });

  crewData.hoursThisWeek = Number(totalPaid.toFixed(2));
  crewData.estimatedPayThisWeek = Number((crewData.hoursThisWeek * crewData.hourlyRate).toFixed(2));

  if (nextShiftObj) {
    const dt = nextShiftObj._dt;
    const dn = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][dt.getDay()];
    crewData.nextShift = {
      day: dn,
      date: nextShiftObj.date,
      start: nextShiftObj.start,
      end: nextShiftObj.end
    };
  } else {
    crewData.nextShift = { day: "-", date: "", start: "", end: "" };
  }
}

/* ============================================================
   AUTH INIT
============================================================ */

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    localStorage.removeItem("mc_session_user");
    window.location.href = "index.html";
    return;
  }

  // load session (if exists) then ensure Firestore user doc exists
  sessionUser = loadSessionUser() || {
    id: user.uid,
    role: "crew",
    name: user.displayName || user.email || "User",
    storeId: "store001"
  };

  // ✅ Create missing users/{uid} if needed (fixes permissions)
  const userDoc = await ensureUserDoc(user);

  // sync session with Firestore
  sessionUser.id = user.uid;
  sessionUser.role = userDoc.role || sessionUser.role;
  sessionUser.storeId = userDoc.storeId || sessionUser.storeId;
  sessionUser.name = userDoc.name || sessionUser.name;
  saveSessionUser(sessionUser);

  try {
    if (sessionUser.role === "crew") {
      await Promise.all([
        loadCrewUserFromFirestore(),
        loadStoreAndShiftsFromFirestore()
      ]);
    } else {
      await loadStoreAndShiftsFromFirestore();
    }
  } catch (err) {
    console.error("[Main] init load error:", err);
  }

  initialiseDashboard();
});

/* Logout */
if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    await signOut(auth);
    localStorage.removeItem("mc_session_user");
    window.location.href = "index.html";
  });
}

/* ============================================================
   DASHBOARD INITIALISATION
============================================================ */

function initialiseDashboard() {
  if (!sessionUser) return;

  const isCrew = sessionUser.role === "crew";
  const profile = isCrew ? crewData : managerData;

  if (sidebarUserName) sidebarUserName.textContent = sessionUser.name || "User";

  if (sidebarUserRole) {
    if (isCrew) sidebarUserRole.textContent = "Crew Member";
    else if (sessionUser.role === "shiftCreator") sidebarUserRole.textContent = "Shift Creator";
    else sidebarUserRole.textContent = "Restaurant Manager";
  }

  if (roleBadge) {
    roleBadge.textContent = isCrew
      ? "CREW"
      : sessionUser.role === "shiftCreator"
      ? "SHIFT CREATOR"
      : "MANAGER";
  }

  if (avatarCircle) avatarCircle.textContent = (sessionUser.name || "U").charAt(0).toUpperCase();

  if (welcomeTitle) {
    welcomeTitle.textContent = isCrew
      ? `Welcome back, ${String(sessionUser.name).split(" ")[0]}`
      : `Good shift, ${String(sessionUser.name).split(" ")[0]}`;
  }

  if (welcomeSubtitle) {
    welcomeSubtitle.textContent = isCrew
      ? "Here’s your week at a glance."
      : `Live store view for ${managerData.storeName || "your restaurant"}.`;
  }

  if (aiSubtitle) {
    aiSubtitle.textContent = isCrew
      ? "Ask about hours, pay, breaks and shifts."
      : "Ask about waste, sales, staffing and crew info.";
  }

  if (navShiftCreator) navShiftCreator.style.display = sessionUser.role === "shiftCreator" ? "" : "none";

  if (myProfileBtn) {
    myProfileBtn.style.display = isCrew ? "" : "none";
    if (isCrew) myProfileBtn.onclick = () => openSelfProfile();
  }

  renderTopCards(isCrew, profile);
  renderBottomSection(isCrew, profile);
  renderSuggestions(isCrew);
  seedIntroMessages(isCrew);
}

/* ============================================================
   TOP CARDS
============================================================ */

function renderTopCards(isCrew, profile) {
  if (!topCards) return;
  topCards.innerHTML = "";

  if (isCrew) {
    const nextLabel =
      profile.nextShift && profile.nextShift.start
        ? `${profile.nextShift.day} ${profile.nextShift.start}-${profile.nextShift.end}`
        : "No shifts";

    const cards = [
      { title: "This Week’s Hours", icon: "⏱️", main: `${profile.hoursThisWeek.toFixed(2)} hrs`, sub: `Next shift: ${nextLabel}` },
      { title: "Estimated Pay", icon: "💷", main: `£${profile.estimatedPayThisWeek.toFixed(2)}`, sub: `£${profile.hourlyRate.toFixed(2)}/hr` },
      {
        title: "Stations",
        icon: "🍔",
        main: profile.certifications.length ? profile.certifications.join(", ") : "No certifications yet",
        sub: profile.trainingTodo[0] || ""
      },
      { title: "Achievements", icon: "🏅", main: `${profile.achievements.length} badges`, sub: profile.achievements[0]?.title || "Do something great to earn a badge!" }
    ];

    cards.forEach((c) => {
      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = `
        <div class="card-header">
          <div class="card-title">${c.title}</div>
          <div class="card-icon">${c.icon}</div>
        </div>
        <div class="card-main-value">${c.main}</div>
        <div class="card-subtext">${c.sub}</div>
      `;
      topCards.appendChild(card);
    });
  } else {
    const cards = [
      { title: "Today's Sales", icon: "💰", main: `£${managerData.todaySales}`, sub: `Week: £${managerData.weekSales}` },
      { title: "Food Waste", icon: "♻️", main: `£${managerData.todayWasteValue}`, sub: `${Number(managerData.todayWastePct || 0).toFixed(1)}%` },
      {
        title: "Staffing",
        icon: "👥",
        main: `${managerData.staffOnShift}/${managerData.staffNeeded}`,
        sub: managerData.staffNeeded - managerData.staffOnShift > 0 ? "Short on shift" : "Good coverage"
      },
      { title: "Training Gaps", icon: "📚", main: `${managerData.trainingGaps}`, sub: `${managerData.potentialOvertime} near overtime` }
    ];

    cards.forEach((c) => {
      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = `
        <div class="card-header">
          <div class="card-title">${c.title}</div>
          <div class="card-icon">${c.icon}</div>
        </div>
        <div class="card-main-value">${c.main}</div>
        <div class="card-subtext">${c.sub}</div>
      `;
      topCards.appendChild(card);
    });
  }
}

/* ============================================================
   BOTTOM SECTION
============================================================ */

function renderBottomSection(isCrew, profile) {
  if (!bottomSection) return;

  if (isCrew) {
    const scheduleHTML = profile.schedule.length
      ? profile.schedule
          .map(
            (s) => `
        <li>
          <span>${s.day}</span>
          <span class="badge-soft">${s.time}</span>
        </li>`
          )
          .join("")
      : `<li><span>No shifts scheduled this week.</span></li>`;

    const trainingHTML = profile.trainingTodo.length
      ? profile.trainingTodo
          .map(
            (t) => `
        <li>
          <span>${t}</span>
          <span class="badge-soft-warn">To do</span>
        </li>`
          )
          .join("")
      : `<li><span>No training tasks right now.</span></li>`;

    bottomSection.innerHTML = `
      <div class="subsection-title">Weekly Schedule</div>
      <ul class="list">${scheduleHTML}</ul>

      <div class="subsection-title" style="margin-top:20px;">Training Focus</div>
      <ul class="list">${trainingHTML}</ul>
    `;
  } else {
    bottomSection.innerHTML = `
      <div class="subsection-title">Crew Training & McStars</div>
      <ul class="list">
        ${
          managerData.crewTrainingSummary.length
            ? managerData.crewTrainingSummary
                .map(
                  (c) => `
          <li data-id="${c.id}">
            <span>
              <strong>${c.name}</strong><br>
              <small>${c.status}</small>
            </span>
            <span class="crew-actions">
              <span class="mcstar-pill">${describeStars(c.stars)}</span>
              <span class="badge-soft">${c.badge}</span>
              <button class="crew-profile-btn" data-id="${c.id}">Profile</button>
              <button class="crew-edit-btn" data-id="${c.id}">Edit</button>
            </span>
          </li>`
                )
                .join("")
            : `<li><span>No crew data available.</span></li>`
        }
      </ul>
    `;

    attachCrewListHandlers();
  }
}

/* ============================================================
   CREW PROFILES + EDITING
============================================================ */

function describeStars(n) {
  n = Number(n) || 0;
  if (n === 0) return "☆ New";
  if (n === 1) return "⭐ Bronze McStar";
  if (n === 2) return "⭐⭐ Silver McStar";
  return "⭐⭐⭐ Gold McStar";
}

function attachCrewListHandlers() {
  bottomSection.querySelectorAll(".crew-profile-btn").forEach((btn) => {
    btn.onclick = () => openCrewProfile(btn.dataset.id);
  });

  bottomSection.querySelectorAll(".crew-edit-btn").forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.dataset.id;
      const crew = managerData.crewTrainingSummary.find((x) => x.id === id);
      if (!crew) return;

      const newStatus = prompt("Update training status:", crew.status);
      if (newStatus === null) return;

      const newBadge = prompt("Update badge:", crew.badge);
      if (newBadge === null) return;

      let newStars = Number(prompt("Update McStars (0–3):", crew.stars));
      if (isNaN(newStars)) newStars = crew.stars;
      newStars = Math.max(0, Math.min(3, newStars));

      try {
        await updateDoc(doc(db, "stores", sessionUser.storeId || "store001", "crewSummary", id), {
          status: newStatus,
          badge: newBadge,
          stars: newStars
        });
      } catch (e) {
        console.error("Update crew fields error:", e);
      }

      crew.status = newStatus;
      crew.badge = newBadge;
      crew.stars = newStars;

      renderBottomSection(false, managerData);
    };
  });
}

function openCrewProfile(id) {
  const crew = managerData.crewTrainingSummary.find((x) => x.id === id);
  if (!crew) return;
  if (!crewProfileOverlay) return;

  crewProfileOverlay.classList.add("show");

  crewProfileName.textContent = crew.name;
  crewProfileRole.textContent = "Crew Member";
  crewProfileStore.textContent = managerData.storeName || sessionUser.storeId || "Restaurant";
  crewProfileStatus.textContent = crew.status;
  crewProfileBadge.textContent = crew.badge;
  crewProfileAvatar.textContent = crew.name.charAt(0).toUpperCase();
  crewProfileStars.textContent = describeStars(crew.stars);

  crewProfileNextShift.textContent = "Next shift: check Shifts page.";
  crewProfileStations.textContent = "Stations: view in Training / Shifts.";
  crewProfileNotes.textContent = `${crew.name.split(" ")[0]} is progressing well.`;
}

function openSelfProfile() {
  if (!crewProfileOverlay || !sessionUser) return;

  crewProfileOverlay.classList.add("show");

  const firstName = String(sessionUser.name || "Crew").split(" ")[0];

  crewProfileName.textContent = sessionUser.name;
  crewProfileRole.textContent = crewData.position || "Crew Member";
  crewProfileStore.textContent = managerData.storeName || sessionUser.storeId || "Restaurant";
  crewProfileStatus.textContent = crewData.trainingTodo.length ? "Training in progress" : "All required training complete";
  crewProfileBadge.textContent = crewData.achievements[0]?.title || "No badge assigned yet";
  crewProfileAvatar.textContent = String(sessionUser.name || "U").charAt(0).toUpperCase();
  crewProfileStars.textContent = describeStars(crewData.achievements.length);

  if (crewData.nextShift && crewData.nextShift.start) {
    crewProfileNextShift.textContent = `${crewData.nextShift.day} ${crewData.nextShift.start}-${crewData.nextShift.end}`;
  } else {
    crewProfileNextShift.textContent = "No upcoming shift on file.";
  }

  crewProfileStations.textContent = crewData.certifications.join(" · ") || "No stations assigned yet.";
  crewProfileNotes.textContent = `${firstName} is doing well. Keep building skills and McStars.`;
}

if (crewProfileOverlay && crewProfileClose) {
  crewProfileClose.onclick = () => crewProfileOverlay.classList.remove("show");
  crewProfileOverlay.addEventListener("click", (e) => {
    if (e.target === crewProfileOverlay) crewProfileOverlay.classList.remove("show");
  });
}

/* ============================================================
   AI SUGGESTIONS
============================================================ */

function renderSuggestions(isCrew) {
  if (!aiSuggestions) return;
  aiSuggestions.innerHTML = "";

  const suggestions = isCrew
    ? ["How many hours do I work this week?", "How much will I earn?", "When is my next shift?", "What training do I need?"]
    : ["Show me today’s waste.", "Which crew need training?", "Who are my top performers?", "How many staff are working today?"];

  suggestions.forEach((text) => {
    const chip = document.createElement("button");
    chip.className = "suggestion-chip";
    chip.textContent = text;
    chip.onclick = () => sendUserMessage(text);
    aiSuggestions.appendChild(chip);
  });
}

/* ============================================================
   CHAT UI + THINKING INDICATOR
============================================================ */

function addMessage(text, from) {
  if (!aiChat) return;

  const msg = document.createElement("div");
  msg.className = `message ${from === "user" ? "msg-user" : "msg-bot"}`;

  msg.innerHTML = `
    <div class="bubble">${text}</div>
    <div class="msg-meta">${from === "user" ? "You" : "McAssist"}</div>
  `;

  aiChat.appendChild(msg);
  aiChat.scrollTop = aiChat.scrollHeight;
}

let thinkingEl = null;

function showThinking() {
  if (!aiChat) return;
  hideThinking();

  thinkingEl = document.createElement("div");
  thinkingEl.className = "message msg-bot thinking";
  thinkingEl.innerHTML = `
    <div class="bubble">
      Thinking
      <span class="thinking-dots">
        <span class="thinking-dot"></span>
        <span class="thinking-dot"></span>
        <span class="thinking-dot"></span>
      </span>
    </div>
    <div class="msg-meta">McAssist</div>
  `;

  aiChat.appendChild(thinkingEl);
  aiChat.scrollTop = aiChat.scrollHeight;
}

function hideThinking() {
  if (thinkingEl) thinkingEl.remove();
  thinkingEl = null;
}

/* ============================================================
   INTRO MESSAGE
============================================================ */

function seedIntroMessages(isCrew) {
  if (!aiChat) return;
  aiChat.innerHTML = "";

  const first = isCrew
    ? `Hi ${String(sessionUser.name).split(" ")[0]} 👋 I can help with hours, pay, breaks and shifts.`
    : `Hi ${String(sessionUser.name).split(" ")[0]} 👋 I can help with waste, sales, staffing and crew info.`;

  addMessage(first, "bot");
}

/* ============================================================
   SEND MESSAGE TO BACKEND (McAssist on VERCEL)
   IMPORTANT: uses /api/mcassist
============================================================ */

async function sendUserMessage(text) {
  if (!text || !text.trim()) return;
  if (!sessionUser) return;

  const cleanText = text.trim();
  addMessage(cleanText, "user");
  if (aiInput) aiInput.value = "";
  if (aiSendBtn) aiSendBtn.disabled = true;

  showThinking();

  try {
    const isCrew = sessionUser.role === "crew";

    const context = {
      role: sessionUser.role,
      userName: sessionUser.name,
      storeId: sessionUser.storeId,
      crewData: isCrew
        ? {
            ...crewData,
            realShifts: Array.isArray(window.loadedShiftsForCrew) ? window.loadedShiftsForCrew : []
          }
        : undefined,
      managerData: !isCrew ? managerData : undefined
    };

    const res = await fetch("/api/mcassist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: cleanText,
        user: sessionUser,
        contextData: context
      })
    });

    let data = {};
    try {
      data = await res.json();
    } catch {
      data = {};
    }

    hideThinking();
    addMessage(data.reply || "I’m not sure about that.", "bot");
  } catch (err) {
    console.error("McAssist error:", err);
    hideThinking();
    addMessage("Sorry, something went wrong with McAssist.", "bot");
  }

  if (aiSendBtn) aiSendBtn.disabled = false;
}

/* ============================================================
   CHAT INPUT HANDLER
============================================================ */

if (aiForm) {
  aiForm.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!aiInput) return;
    sendUserMessage(aiInput.value);
  });
}

/* ============================================================
   SIDEBAR MOBILE TOGGLE
============================================================ */

if (sidebar && sidebarToggle) {
  sidebarToggle.addEventListener("click", () => {
    sidebar.classList.toggle("sidebar-open");
  });
}

/* ============================================================
   VOICE MODE + WAKE WORD ("HEY AMY")
============================================================ */

let recognition = null;
let listening = false;
let voiceTimeout = null;

function hasSpeechSupport() {
  return "SpeechRecognition" in window || "webkitSpeechRecognition" in window;
}

function beep(freq = 900, ms = 100, vol = 0.1) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = freq;
    gain.gain.value = vol;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    setTimeout(() => {
      osc.stop();
      ctx.close();
    }, ms);
  } catch {}
}

if (micBtn && overlay && hasSpeechSupport()) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SR();
  recognition.lang = "en-US";
  recognition.interimResults = false;
  recognition.continuous = false;

  function startFullListening() {
    try {
      overlayText.textContent = "Listening…";
      beep(1100, 90, 0.12);

      listening = true;
      recognition.start();

      voiceTimeout = setTimeout(() => {
        try {
          recognition.stop();
        } catch {}
      }, 7000);
    } catch (err) {
      console.error("Voice start error:", err);
      listening = false;
      overlay.classList.remove("active");
    }
  }

  micBtn.onclick = () => {
    if (listening) {
      try {
        recognition.stop();
      } catch {}
    } else {
      overlay.classList.add("active");
      overlayText.textContent = "Ask me anything";
      setTimeout(startFullListening, 400);
    }
  };

  overlayMic.onclick = () => {
    listening = false;
    try {
      recognition.stop();
    } catch {}
    overlay.classList.remove("active");
  };

  recognition.onresult = (e) => {
    const transcript = e.results[0][0].transcript;
    overlay.classList.remove("active");
    listening = false;
    if (voiceTimeout) clearTimeout(voiceTimeout);

    if (aiInput) aiInput.value = transcript;
    sendUserMessage(transcript);
  };

  recognition.onerror = (e) => {
    console.warn("Voice error:", e.error);
    listening = false;
    overlay.classList.remove("active");
    if (voiceTimeout) clearTimeout(voiceTimeout);
  };

  recognition.onend = () => {
    listening = false;
    overlay.classList.remove("active");
    if (voiceTimeout) clearTimeout(voiceTimeout);

    if (wakeEnabled && !wakeRunning && !document.hidden) {
      setTimeout(startWakeListener, 400);
    }
  };

  // Wake word
  let wakeRecognition = null;
  let wakeEnabled = false;
  let wakeRunning = false;

  const HEY_AMY_VARIANTS = ["hey amy", "hey ami", "hey amie", "hey emmy", "hey ammy", "ok amy", "okay amy"];

  function startWakeListener() {
    if (!wakeEnabled || wakeRunning || !hasSpeechSupport()) return;

    const SR2 = window.SpeechRecognition || window.webkitSpeechRecognition;
    wakeRecognition = new SR2();
    wakeRecognition.lang = "en-US";
    wakeRecognition.continuous = true;
    wakeRecognition.interimResults = true;

    wakeRecognition.onstart = () => {
      wakeRunning = true;
      console.log("[Wake] Listening for Hey Amy…");
    };

    wakeRecognition.onerror = (e) => {
      if (e.error === "not-allowed") {
        alert("Microphone blocked. Wake-word disabled.");
        wakeEnabled = false;
        if (wakeToggle) wakeToggle.checked = false;
        return;
      }
      wakeRunning = false;
      if (wakeEnabled && !document.hidden) setTimeout(startWakeListener, 700);
    };

    wakeRecognition.onend = () => {
      wakeRunning = false;
      if (wakeEnabled && !document.hidden) setTimeout(startWakeListener, 400);
    };

    wakeRecognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const text = event.results[i][0].transcript.toLowerCase().trim();
        const conf = event.results[i][0].confidence;

        if (conf > 0.25 && HEY_AMY_VARIANTS.some((w) => text.includes(w))) {
          console.log("[Wake] Triggered:", text);

          try {
            wakeRecognition.stop();
          } catch {}
          wakeRunning = false;

          overlay.classList.add("active");
          overlayText.textContent = "Ask me anything";

          beep(1400, 90, 0.15);
          setTimeout(startFullListening, 500);
          return;
        }
      }
    };

    try {
      wakeRecognition.start();
    } catch (err) {
      console.error("[Wake] start error", err);
    }
  }

  function stopWakeListener() {
    try {
      wakeRecognition?.stop();
    } catch {}
    wakeRunning = false;
  }

  if (wakeToggle) {
    wakeToggle.addEventListener("change", () => {
      if (wakeToggle.checked) {
        wakeEnabled = true;
        beep(900, 80, 0.12);
        startWakeListener();
      } else {
        wakeEnabled = false;
        stopWakeListener();
      }
    });
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopWakeListener();
    else if (wakeEnabled) startWakeListener();
  });
} else {
  if (micBtn) micBtn.style.display = "none";
  if (wakeToggle) wakeToggle.disabled = true;
}
