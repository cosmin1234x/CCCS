// ================================
// main.js – FULL VERSION
// Includes:
// - Full Firestore sync
// - UK Break Rules
// - ShiftCreator Permissions
// - Crew & Manager Metrics
// - McAssist Integration
// - Voice Mode + Wake Word
// ================================

import { auth, db } from "./firebase-init.js";
import {
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  doc,
  getDoc,
  collection,
  getDocs,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

/* ============================================================
   SESSION HANDLING
============================================================ */

let sessionUser = null;
let allShifts = []; // store-wide shifts

function loadSessionUser() {
  try {
    return JSON.parse(localStorage.getItem("mc_session_user"));
  } catch {
    return null;
  }
}

/* ============================================================
   DEFAULT DATA MODELS (always overwritten by Firestore)
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

// Voice
const micBtn = document.getElementById("aiMicBtn");
const overlay = document.getElementById("voiceOverlay");
const overlayText = document.getElementById("overlayText");
const overlayMic = document.getElementById("overlayMic");
const wakeToggle = document.getElementById("wakeToggle");

// Crew Profile
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
  return d.toISOString().split("T")[0];
}

function getMonday(date) {
  const d = new Date(date);
  let day = d.getDay();
  let diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff));
}

function getWeekRange(offset = 0) {
  const monday = getMonday(new Date());
  const start = new Date(monday);
  start.setDate(start.getDate() + offset * 7);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { start, end };
}

function parseShiftHours(startHHMM, endHHMM) {
  if (!startHHMM || !endHHMM) return 0;
  const [sh, sm] = startHHMM.split(":").map(Number);
  const [eh, em] = endHHMM.split(":").map(Number);

  let start = sh + sm / 60;
  let end = eh + em / 60;

  if (end < start) end += 24; // midnight crossing

  return end - start;
}

/* ============================================================
   UK BREAK RULES (Option A)
   - Under 5h → 15min
   - 5h–8h → 30min
   - Over 8h → 45min
============================================================ */

function calculateBreakMinutes(hours) {
  if (hours <= 0) return 0;
  if (hours < 5) return 15;
  if (hours < 8) return 30;
  return 45;
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

    if (d.position) crewData.position = d.position;
    if (d.hourlyRate) crewData.hourlyRate = d.hourlyRate;
    if (Array.isArray(d.certifications)) crewData.certifications = d.certifications;
    if (Array.isArray(d.trainingTodo)) crewData.trainingTodo = d.trainingTodo;
    if (Array.isArray(d.achievements)) crewData.achievements = d.achievements;

  } catch (err) {
    console.error("[Crew] Firestore load error:", err);
  }
}

async function loadStoreAndShiftsFromFirestore() {
  const storeId = sessionUser.storeId || "store001";

  try {
    const storeRef = doc(db, "stores", storeId);

    const [storeSnap, shiftsSnap, crewSnap] = await Promise.all([
      getDoc(storeRef),
      getDocs(collection(db, "stores", storeId, "shifts")),
      getDocs(collection(db, "stores", storeId, "crewSummary"))
    ]);

    /* ---------- Store Data ---------- */
    if (storeSnap.exists()) {
      Object.assign(managerData, managerDataDefault, storeSnap.data());
    }

    /* ---------- Shifts ---------- */
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
        role: d.role || "crew"
      });
    });

    // Expose your own shifts for AI
    window.loadedShiftsForCrew = allShifts.filter(
      (s) => s.userId === sessionUser.id
    );

    computeManagerMetrics();
    if (sessionUser.role === "crew") computeCrewMetrics(window.loadedShiftsForCrew);

    /* ---------- Crew Summary ---------- */
    managerData.crewTrainingSummary = [];
    crewSnap.forEach((snap) => {
      const d = snap.data();
      managerData.crewTrainingSummary.push({
        id: snap.id,
        name: d.name,
        status: d.status,
        badge: d.badge,
        stars: d.stars || 0
      });
    });

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

  let totalPaid = 0;
  let scheduleMap = {};
  let nextShiftObj = null;

  myShifts.forEach((s) => {
    const rawHours = parseShiftHours(s.start, s.end);
    const breakMin = calculateBreakMinutes(rawHours);
    const paid = rawHours - breakMin / 60;

    s.breakMinutes = breakMin;

    // Weekly schedule
    if (s.date >= weekStart && s.date <= weekEnd) {
      totalPaid += paid;

      if (!scheduleMap[s.date]) scheduleMap[s.date] = [];
      scheduleMap[s.date].push(`${s.start}–${s.end} (Break ${breakMin}m)`);
    }

    // Next shift
    const dt = new Date(`${s.date}T${s.start}:00`);
    if (!nextShiftObj || dt < nextShiftObj._dt) {
      nextShiftObj = { _dt: dt, ...s };
    }
  });

  // Convert schedule map → list
  crewData.schedule = Object.entries(scheduleMap)
    .sort(([a], [b]) => (a > b ? 1 : -1))
    .map(([date, times]) => {
      const d = new Date(`${date}T00:00:00`);
      const dayName = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d.getDay()];
      return { day: dayName, time: times.join(", ") };
    });

  crewData.hoursThisWeek = Number(totalPaid.toFixed(2));
  crewData.estimatedPayThisWeek = Number(
    (crewData.hoursThisWeek * crewData.hourlyRate).toFixed(2)
  );

  if (nextShiftObj) {
    const dt = nextShiftObj._dt;
    const dn = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][dt.getDay()];
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
   DASHBOARD INITIALISATION
============================================================ */

function initialiseDashboard() {
  const isCrew = sessionUser.role === "crew";
  const isManager = sessionUser.role === "manager" || sessionUser.role === "shiftCreator";

  const profile = isCrew ? crewData : managerData;

  // Sidebar info
  sidebarUserName.textContent = sessionUser.name;
  sidebarUserRole.textContent = isCrew
    ? "Crew Member"
    : sessionUser.role === "shiftCreator"
      ? "Shift Creator"
      : "Restaurant Manager";

  roleBadge.textContent = isCrew ? "CREW" : sessionUser.role === "shiftCreator" ? "SHIFT CREATOR" : "MANAGER";
  avatarCircle.textContent = sessionUser.name.charAt(0).toUpperCase();

  welcomeTitle.textContent = isCrew
    ? `Welcome back, ${sessionUser.name.split(" ")[0]}`
    : `Good shift, ${sessionUser.name.split(" ")[0]}`;
  welcomeSubtitle.textContent = isCrew
    ? "Here’s your week at a glance."
    : `Live store view for ${managerData.storeName}.`;

  aiSubtitle.textContent = isCrew
    ? "Ask about hours, pay, shifts and training."
    : "Ask about waste, sales and crew levels.";

  renderTopCards(isCrew, profile);
  renderBottomSection(isCrew, profile);
  renderSuggestions(isCrew);
  seedIntroMessages(isCrew);
}

/* ============================================================
   TOP CARDS
============================================================ */

function renderTopCards(isCrew, profile) {
  topCards.innerHTML = "";

  if (isCrew) {
    const nextLabel =
      profile.nextShift && profile.nextShift.start
        ? `${profile.nextShift.day} ${profile.nextShift.start}-${profile.nextShift.end}`
        : "No shifts";

    const cards = [
      {
        title: "This Week’s Hours",
        icon: "⏱️",
        main: `${profile.hoursThisWeek.toFixed(2)} hrs`,
        sub: `Next shift: ${nextLabel}`
      },
      {
        title: "Estimated Pay",
        icon: "💷",
        main: `£${profile.estimatedPayThisWeek.toFixed(2)}`,
        sub: `£${profile.hourlyRate}/hr`
      },
      {
        title: "Stations",
        icon: "🍔",
        main: profile.certifications.length
          ? profile.certifications.join(", ")
          : "No certifications",
        sub: profile.trainingTodo[0] || ""
      },
      {
        title: "Achievements",
        icon: "🏅",
        main: `${profile.achievements.length} badges`,
        sub: profile.achievements[0]?.title || "Earn more achievements!"
      }
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

  else {
    const cards = [
      {
        title: "Today's Sales",
        icon: "💰",
        main: `£${managerData.todaySales}`,
        sub: `Week: £${managerData.weekSales}`
      },
      {
        title: "Food Waste",
        icon: "♻️",
        main: `£${managerData.todayWasteValue}`,
        sub: `${managerData.todayWastePct}%`
      },
      {
        title: "Staffing",
        icon: "👥",
        main: `${managerData.staffOnShift}/${managerData.staffNeeded}`,
        sub:
          managerData.staffNeeded - managerData.staffOnShift > 0
            ? "Understaffed"
            : "Fully covered"
      },
      {
        title: "Training Gaps",
        icon: "📚",
        main: `${managerData.trainingGaps}`,
        sub: `${managerData.potentialOvertime} near overtime`
      }
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
   BOTTOM SECTION (Schedule or Crew List)
============================================================ */

function renderBottomSection(isCrew, profile) {
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

      <div class="subsection-title" style="margin-top: 20px;">Training Focus</div>
      <ul class="list">${trainingHTML}</ul>
    `;
    return;
  }

  // Manager / ShiftCreator
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

/* ============================================================
   CREW PROFILES + EDITING
============================================================ */

function describeStars(n) {
  n = Number(n) || 0;
  if (n === 0) return "☆ New";
  if (n === 1) return "⭐ Bronze";
  if (n === 2) return "⭐⭐ Silver";
  return "⭐⭐⭐ Gold";
}

function attachCrewListHandlers() {
  document.querySelectorAll(".crew-profile-btn").forEach((btn) => {
    btn.onclick = () => openCrewProfile(btn.dataset.id);
  });

  document.querySelectorAll(".crew-edit-btn").forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.dataset.id;
      const crew = managerData.crewTrainingSummary.find((x) => x.id === id);
      if (!crew) return;

      const newStatus = prompt("Update status:", crew.status);
      if (newStatus === null) return;

      const newBadge = prompt("Update badge:", crew.badge);
      if (newBadge === null) return;

      let newStars = Number(prompt("Update McStars (0–3):", crew.stars));
      if (isNaN(newStars)) newStars = crew.stars;
      newStars = Math.min(3, Math.max(0, newStars));

      await updateDoc(doc(db, "stores", sessionUser.storeId, "crewSummary", id), {
        status: newStatus,
        badge: newBadge,
        stars: newStars
      });

      // update local
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

  crewProfileOverlay.classList.add("show");

  crewProfileName.textContent = crew.name;
  crewProfileRole.textContent = "Crew Member";
  crewProfileStore.textContent = managerData.storeName;
  crewProfileStatus.textContent = crew.status;
  crewProfileBadge.textContent = crew.badge;
  crewProfileAvatar.textContent = crew.name.charAt(0).toUpperCase();
  crewProfileStars.textContent = describeStars(crew.stars);

  // Example placeholder
  crewProfileNextShift.textContent = "Next shift: Posted in schedule";
  crewProfileStations.textContent = "Stations: Training data";
  crewProfileNotes.textContent = `${crew.name.split(" ")[0]} is progressing well.`;
}

// Close modal
crewProfileClose.onclick = () => crewProfileOverlay.classList.remove("show");
crewProfileOverlay.onclick = (e) => {
  if (e.target === crewProfileOverlay) crewProfileOverlay.classList.remove("show");
};
/* ============================================================
   AI SUGGESTIONS
============================================================ */

function renderSuggestions(isCrew) {
  aiSuggestions.innerHTML = "";

  const suggestions = isCrew
    ? [
        "How many hours do I work this week?",
        "How much will I earn?",
        "When is my next shift?",
        "What training do I need?"
      ]
    : [
        "Show me today’s waste.",
        "Which crew need training?",
        "Who is near overtime?",
        "How many staff are working today?"
      ];

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
  aiChat.innerHTML = "";

  const first = isCrew
    ? `Hi ${sessionUser.name.split(" ")[0]} 👋 I can help with hours, pay, breaks and shifts.`
    : `Hi ${sessionUser.name.split(" ")[0]} 👋 I can help with waste, sales, staffing and crew info.`;

  addMessage(first, "bot");
}

/* ============================================================
   SEND MESSAGE TO BACKEND (McAssist)
============================================================ */

async function sendUserMessage(text) {
  if (!text.trim()) return;

  addMessage(text, "user");
  aiInput.value = "";
  aiSendBtn.disabled = true;
  showThinking();

  try {
    const isCrew = sessionUser.role === "crew";

    // Build AI context
    const context = {
      role: sessionUser.role,
      userName: sessionUser.name,
      storeId: sessionUser.storeId,

      crewData: isCrew
        ? {
            ...crewData,
            realShifts: window.loadedShiftsForCrew || []
          }
        : undefined,

      managerData: !isCrew ? managerData : undefined
    };

    const res = await fetch("/.netlify/functions/mcassist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: text,
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
    console.error("AI error:", err);
    hideThinking();
    addMessage("Sorry, something went wrong with McAssist.", "bot");
  }

  aiSendBtn.disabled = false;
}

/* ============================================================
   CHAT INPUT HANDLER
============================================================ */

aiForm.addEventListener("submit", (e) => {
  e.preventDefault();
  sendUserMessage(aiInput.value);
});
/* ============================================================
   VOICE MODE + WAKE WORD ("HEY AMY")
============================================================ */

let recognition = null;
let listening = false;
let voiceTimeout = null;

/* -----------------------------
   Microphone support check
------------------------------*/
function hasSpeechSupport() {
  return "SpeechRecognition" in window || "webkitSpeechRecognition" in window;
}

/* -----------------------------
   SOUND FEEDBACK
------------------------------*/
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

  /* -----------------------------
     Start full listening mode
  ------------------------------*/
  function startFullListening() {
    try {
      overlayText.textContent = "Listening…";
      beep(1100, 90, 0.12);

      listening = true;
      recognition.start();

      // Auto-stop after 7s of silence
      voiceTimeout = setTimeout(() => {
        try { recognition.stop(); } catch {}
      }, 7000);

    } catch (err) {
      console.error("Voice start error:", err);
      listening = false;
      overlay.classList.remove("active");
    }
  }

  /* -----------------------------
     Mic button next to chat input
  ------------------------------*/
  micBtn.onclick = () => {
    if (listening) {
      try { recognition.stop(); } catch {}
    } else {
      overlay.classList.add("active");
      overlayText.textContent = "Ask me anything";
      setTimeout(startFullListening, 400);
    }
  };

  /* -----------------------------
     Big mic button inside overlay
  ------------------------------*/
  overlayMic.onclick = () => {
    listening = false;
    try { recognition.stop(); } catch {}
    overlay.classList.remove("active");
  };

  /* -----------------------------
     Speech recognition events
  ------------------------------*/
  recognition.onresult = (e) => {
    const transcript = e.results[0][0].transcript;
    overlay.classList.remove("active");
    listening = false;
    if (voiceTimeout) clearTimeout(voiceTimeout);

    aiInput.value = transcript;
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

    // Auto-restart if wake word enabled
    if (wakeEnabled && !wakeRunning && !document.hidden) {
      setTimeout(startWakeListener, 400);
    }
  };

  /* ============================================================
     WAKE WORD SYSTEM — "HEY AMY"
  ============================================================= */

  let wakeRecognition = null;
  let wakeEnabled = false;
  let wakeRunning = false;

  const HEY_AMY_VARIANTS = [
    "hey amy", "hey ami", "hey amie",
    "hey emmy", "hey ammy",
    "ok amy", "okay amy"
  ];

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
        wakeToggle.checked = false;
        return;
      }
      wakeRunning = false;
      if (wakeEnabled) setTimeout(startWakeListener, 700);
    };

    wakeRecognition.onend = () => {
      wakeRunning = false;
      if (wakeEnabled && !document.hidden) {
        setTimeout(startWakeListener, 400);
      }
    };

    wakeRecognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const text = event.results[i][0].transcript.toLowerCase().trim();
        const conf = event.results[i][0].confidence;

        if (conf > 0.25 && HEY_AMY_VARIANTS.some((w) => text.includes(w))) {
          console.log("[Wake] Triggered:", text);

          try { wakeRecognition.stop(); } catch {}
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
    try { wakeRecognition?.stop(); } catch {}
    wakeRunning = false;
  }

  /* -----------------------------
     Toggle switch for wake word
  ------------------------------*/
  wakeToggle?.addEventListener("change", () => {
    if (wakeToggle.checked) {
      wakeEnabled = true;
      beep(900, 80, 0.12);
      startWakeListener();
    } else {
      wakeEnabled = false;
      stopWakeListener();
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopWakeListener();
    } else if (wakeEnabled) {
      startWakeListener();
    }
  });
}
