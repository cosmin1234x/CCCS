// ================================
// main.js – McTraining Dashboard
// FULLY FIRESTORE SYNCED
// Includes UK legal break rules
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
let allShifts = []; // all store shifts, used everywhere

function loadSessionUser() {
  try {
    return JSON.parse(localStorage.getItem("mc_session_user"));
  } catch {
    return null;
  }
}

/* ============================================================
   DEFAULT DATA (will be overwritten by Firestore)
============================================================ */

const crewDataDefault = {
  position: "Crew Member",
  hourlyRate: 12.22, // UK Crew National Rate
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

// Voice overlay
const micBtn = document.getElementById("aiMicBtn");
const overlay = document.getElementById("voiceOverlay");
const overlayText = document.getElementById("overlayText");
const overlayMic = document.getElementById("overlayMic");
const wakeToggle = document.getElementById("wakeToggle");

// Crew Profile Modal
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
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
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
  const [sh, sm] = startHHMM.split(":").map(Number);
  const [eh, em] = endHHMM.split(":").map(Number);

  let start = sh + sm / 60;
  let end = eh + em / 60;
  if (end < start) end += 24; // crossing midnight
  return end - start;
}

/* ============================================================
   UK BREAK RULES (Option A)
   — Under 5h → 15 mins
   — 5h–8h → 30 mins
   — Over 8h → 45 mins
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

    if (typeof d.hourlyRate === "number") crewData.hourlyRate = d.hourlyRate;
    if (Array.isArray(d.certifications)) crewData.certifications = d.certifications;
    if (Array.isArray(d.trainingTodo)) crewData.trainingTodo = d.trainingTodo;
    if (Array.isArray(d.achievements)) crewData.achievements = d.achievements;
    if (typeof d.position === "string") crewData.position = d.position;

  } catch (err) {
    console.error("[Crew] load error:", err);
  }
}

async function loadStoreAndShiftsFromFirestore() {
  if (!sessionUser) return;

  const storeId = sessionUser.storeId || "store001";

  try {
    const storeRef = doc(db, "stores", storeId);

    const [storeSnap, shiftsSnap, crewSnap] = await Promise.all([
      getDoc(storeRef),
      getDocs(collection(db, "stores", storeId, "shifts")),
      getDocs(collection(db, "stores", storeId, "crewSummary"))
    ]);

    /* ----------------------
       STORE DATA (MANAGER)
    ---------------------- */
    if (storeSnap.exists()) {
      Object.assign(managerData, managerDataDefault, storeSnap.data());
    }

    /* ----------------------
       SHIFTS
    ---------------------- */
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
        breakMinutes: d.breakMinutes || 0
      });
    });

    // Make available for McAssist
    window.loadedShiftsForCrew = allShifts.filter(
      (s) => s.userId === sessionUser.id
    );

    // Compute dashboard metrics
    computeManagerMetrics();
    if (sessionUser.role === "crew") {
      computeCrewMetrics(window.loadedShiftsForCrew);
    }

    /* ----------------------
       CREW SUMMARY
    ---------------------- */
    const list = [];
    crewSnap.forEach((snap) => {
      const d = snap.data();
      list.push({
        id: snap.id,
        name: d.name,
        status: d.status,
        badge: d.badge,
        stars: d.stars || 0
      });
    });

    managerData.crewTrainingSummary = list;

  } catch (err) {
    console.error("[Store] load error:", err);
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

  const today = new Date();
  const { start, end } = getWeekRange(0, today);
  const weekStart = toISODateString(start);
  const weekEnd = toISODateString(end);

  let totalPaidHours = 0;
  let schedule = {};
  let nextShiftObj = null;

  myShifts.forEach((s) => {
    const rawHours = parseShiftHours(s.start, s.end);
    const breakMin = calculateBreakMinutes(rawHours);
    const paid = rawHours - breakMin / 60;

    // Save break into local shift (not Firestore)
    s.breakMinutes = breakMin;

    // Convert into weekly metrics
    if (s.date >= weekStart && s.date <= weekEnd) {
      totalPaidHours += paid;

      if (!schedule[s.date]) schedule[s.date] = [];
      schedule[s.date].push(`${s.start}–${s.end} (Break ${breakMin}m)`);
    }

    // Next shift
    const dt = new Date(`${s.date}T${s.start}:00`);
    if (!nextShiftObj || dt < nextShiftObj._dt) {
      nextShiftObj = { _dt: dt, ...s };
    }
  });

  // Convert schedule map → array
  crewData.schedule = Object.entries(schedule)
    .sort(([a], [b]) => (a > b ? 1 : -1))
    .map(([date, items]) => {
      const d = new Date(`${date}T00:00:00`);
      const dayName = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()];
      return { day: dayName, time: items.join(", ") };
    });

  crewData.hoursThisWeek = Number(totalPaidHours.toFixed(2));
  crewData.estimatedPayThisWeek = Number(
    (totalPaidHours * crewData.hourlyRate).toFixed(2)
  );

  if (nextShiftObj) {
    const dt = nextShiftObj._dt;
    const dayName = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][dt.getDay()];
    crewData.nextShift = {
      day: dayName,
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

  sessionUser = loadSessionUser();

  if (!sessionUser) {
    sessionUser = {
      id: user.uid,
      role: "crew",
      name: user.displayName || user.email || "User",
      storeId: "store001"
    };
    localStorage.setItem("mc_session_user", JSON.stringify(sessionUser));
  }

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

/* ============================================================
   DASHBOARD RENDERING
============================================================ */

function initialiseDashboard() {
  if (!sessionUser) return;

  const isCrew = sessionUser.role === "crew";
  const isManagerLike =
    sessionUser.role === "manager" || sessionUser.role === "shiftCreator";

  const profile = isCrew ? crewData : managerData;

  // Sidebar user info
  if (sidebarUserName) sidebarUserName.textContent = sessionUser.name;
  if (sidebarUserRole) {
    sidebarUserRole.textContent = isCrew
      ? "Crew Member"
      : sessionUser.role === "shiftCreator"
      ? "Shift Creator"
      : "Restaurant Manager";
  }

  if (roleBadge) {
    roleBadge.textContent = isCrew
      ? "CREW"
      : sessionUser.role === "shiftCreator"
      ? "SHIFT CREATOR"
      : "MANAGER";
  }

  if (avatarCircle) {
    avatarCircle.textContent = sessionUser.name.charAt(0).toUpperCase();
  }

  if (welcomeTitle) {
    welcomeTitle.textContent = isCrew
      ? `Welcome back, ${sessionUser.name.split(" ")[0]}`
      : `Good shift, ${sessionUser.name.split(" ")[0]}`;
  }

  if (welcomeSubtitle) {
    welcomeSubtitle.textContent = isCrew
      ? "Here’s your week at a glance."
      : `Live snapshot for ${profile.storeName || "your restaurant"}.`;
  }

  if (aiSubtitle) {
    aiSubtitle.textContent = isCrew
      ? "Ask about your hours, pay, shifts or training."
      : "Ask about waste, staff, sales or crew.";
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
    const nextShiftLabel =
      profile.nextShift && profile.nextShift.start
        ? `${profile.nextShift.day} ${profile.nextShift.start}-${profile.nextShift.end}`
        : "No shifts scheduled";

    const cards = [
      {
        title: "This Week’s Hours",
        icon: "⏱️",
        main: `${profile.hoursThisWeek.toFixed(2)} hrs`,
        sub: `Next shift: ${nextShiftLabel}`
      },
      {
        title: "Estimated Pay",
        icon: "💷",
        main: `£${profile.estimatedPayThisWeek.toFixed(2)}`,
        sub: `£${profile.hourlyRate.toFixed(2)}/hr`
      },
      {
        title: "Stations",
        icon: "🍔",
        main: profile.certifications.join(", ") || "None",
        sub: profile.trainingTodo[0]
          ? `Next: ${profile.trainingTodo[0]}`
          : "No active training"
      },
      {
        title: "Achievements",
        icon: "🏅",
        main: `${profile.achievements.length} badges`,
        sub:
          profile.achievements[0]?.title || "Do something great to earn one!"
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
  } else {
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
        sub: `${managerData.todayWastePct.toFixed(1)}%`
      },
      {
        title: "Staffing",
        icon: "👥",
        main: `${managerData.staffOnShift}/${managerData.staffNeeded}`,
        sub:
          managerData.staffNeeded - managerData.staffOnShift > 0
            ? "Short on shift"
            : "Fully staffed"
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
   BOTTOM SECTION (Schedule / Waste / Crew Summary)
============================================================ */

function renderBottomSection(isCrew, profile) {
  if (!bottomSection) return;

  if (isCrew) {
    const scheduleHTML =
      profile.schedule.length > 0
        ? profile.schedule
            .map(
              (s) => `
        <li>
          <span>${s.day}</span>
          <span class="badge-soft">${s.time}</span>
        </li>`
            )
            .join("")
        : `<li><span>No shifts posted this week.</span></li>`;

    const trainingHTML =
      profile.trainingTodo.length > 0
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

      <div class="subsection-title" style="margin-top:15px;">Training Focus</div>
      <ul class="list">${trainingHTML}</ul>
    `;
  } else {
    bottomSection.innerHTML = `
      <div class="subsection-title">Food Waste (Week)</div>
      <ul class="list">
        ${
          managerData.foodWasteByDay.length
            ? managerData.foodWasteByDay
                .map(
                  (d) => `
          <li>
            <span>${d.day}</span>
            <span class="badge-soft-danger">£${d.value}</span>
          </li>`
                )
                .join("")
            : `<li><span>No waste data.</span></li>`
        }
      </ul>

      <div class="subsection-title" style="margin-top:15px;">
        Crew Training & McStars
      </div>
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
            : `<li><span>No crew summary data.</span></li>`
        }
      </ul>
    `;

    attachCrewEditHandlers();
  }
}
/* ============================================================
   CREW PROFILE + EDITING
============================================================ */

function attachCrewEditHandlers() {
  if (!bottomSection) return;

  // EDIT BUTTONS
  bottomSection.querySelectorAll(".crew-edit-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      const crew = managerData.crewTrainingSummary.find((c) => c.id === id);
      if (!crew) return;

      const newStatus = prompt(
        `Update training status for ${crew.name}:`,
        crew.status
      );
      if (newStatus === null) return;

      const newBadge = prompt(
        `Update badge for ${crew.name}:`,
        crew.badge
      );
      if (newBadge === null) return;

      const starsInput = prompt(
        `Update McStars (0–3) for ${crew.name}:`,
        String(crew.stars || 0)
      );
      if (starsInput === null) return;

      let newStars = parseInt(starsInput);
      if (isNaN(newStars) || newStars < 0) newStars = 0;
      if (newStars > 3) newStars = 3;

      // Save to Firestore
      await updateCrewFieldsInFirestore(id, {
        status: newStatus,
        badge: newBadge,
        stars: newStars
      });

      // Update UI
      crew.status = newStatus;
      crew.badge = newBadge;
      crew.stars = newStars;

      renderBottomSection(false, managerData);
    });
  });

  // PROFILE BUTTON
  bottomSection.querySelectorAll(".crew-profile-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      openCrewProfile(btn.dataset.id);
    });
  });
}

function openCrewProfile(id) {
  const crew = managerData.crewTrainingSummary.find((c) => c.id === id);
  if (!crew) return;

  const firstName = crew.name.split(" ")[0];

  crewProfileName.textContent = crew.name;
  crewProfileRole.textContent = "Crew Member";
  crewProfileStore.textContent =
    managerData.storeName || sessionUser.storeId || "Restaurant";
  crewProfileStatus.textContent = crew.status;
  crewProfileBadge.textContent = crew.badge;
  crewProfileAvatar.textContent = crew.name.charAt(0).toUpperCase();
  crewProfileStars.textContent = describeStars(crew.stars);

  // Demo (could be connected to shifts later)
  crewProfileNextShift.textContent = "Tomorrow 17:00–23:00 — Front counter";
  crewProfileStations.textContent = "Front Counter · Fries · Drinks";
  crewProfileNotes.textContent = `${firstName} performs well during peak times.`;

  crewProfileOverlay.classList.add("show");
}

// Close profile modal
crewProfileClose.addEventListener("click", () => {
  crewProfileOverlay.classList.remove("show");
});
crewProfileOverlay.addEventListener("click", (e) => {
  if (e.target === crewProfileOverlay) {
    crewProfileOverlay.classList.remove("show");
  }
});
/* ============================================================
   AI SUGGESTIONS
============================================================ */

function renderSuggestions(isCrew) {
  if (!aiSuggestions) return;
  aiSuggestions.innerHTML = "";

  const items = isCrew
    ? [
        "How many hours do I work this week?",
        "How much will I earn?",
        "When is my next shift?",
        "What training do I need?"
      ]
    : [
        "Show me today’s waste.",
        "How are today’s sales?",
        "Which crew need training?",
        "Who is near overtime?"
      ];

  items.forEach((text) => {
    const chip = document.createElement("button");
    chip.className = "suggestion-chip";
    chip.textContent = text;
    chip.onclick = () => sendUserMessage(text);
    aiSuggestions.appendChild(chip);
  });
}

/* ============================================================
   CHAT MESSAGES
============================================================ */

function addMessage(text, from) {
  const msg = document.createElement("div");
  msg.className = "message " + (from === "user" ? "msg-user" : "msg-bot");

  msg.innerHTML = `
    <div class="bubble">${text}</div>
    <div class="msg-meta">${from === "user" ? "You" : "McAssist"}</div>
  `;

  aiChat.appendChild(msg);
  aiChat.scrollTop = aiChat.scrollHeight;
}

/* ============================================================
   THINKING INDICATOR
============================================================ */

let thinkingMessageEl = null;

function showThinking() {
  hideThinking();
  const el = document.createElement("div");
  el.className = "message msg-bot thinking";
  el.innerHTML = `
    <div class="bubble">
      Thinking <span class="thinking-dots">
        <span class="thinking-dot"></span>
        <span class="thinking-dot"></span>
        <span class="thinking-dot"></span>
      </span>
    </div>
    <div class="msg-meta">McAssist</div>
  `;
  aiChat.appendChild(el);
  aiChat.scrollTop = aiChat.scrollHeight;
  thinkingMessageEl = el;
}

function hideThinking() {
  if (thinkingMessageEl) thinkingMessageEl.remove();
  thinkingMessageEl = null;
}

/* ============================================================
   INTRO MESSAGE
============================================================ */

function seedIntroMessages(isCrew) {
  if (!aiChat) return;
  aiChat.innerHTML = "";

  const name = sessionUser.name.split(" ")[0];

  const text = isCrew
    ? `Hi ${name} 👋 I can help with hours, pay, shifts and training.`
    : `Hi ${name} 👋 I can help with sales, waste and crew training.`;

  addMessage(text, "bot");
}
/* ============================================================
   VOICE MODE + WAKE WORD
============================================================ */

let recognition = null;
let listening = false;
let voiceTimeout = null;

function hasSpeechSupport() {
  return (
    "SpeechRecognition" in window || "webkitSpeechRecognition" in window
  );
}

if (micBtn && overlay && hasSpeechSupport()) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SR();
  recognition.lang = "en-GB";        // UK voice
  recognition.continuous = false;
  recognition.interimResults = false;

  function startFullListening() {
    try {
      overlayText.textContent = "Listening…";
      listening = true;
      recognition.start();

      // Auto-stop after 6 seconds
      voiceTimeout = setTimeout(() => {
        try {
          recognition.stop();
        } catch {}
      }, 6000);
    } catch (err) {
      console.error("Voice start error:", err);
      overlay.classList.remove("active");
      overlayText.textContent = "";
      alert("Microphone access blocked.");
    }
  }

  /* Small mic button → open overlay then start listening */
  micBtn.onclick = () => {
    if (listening) {
      try {
        recognition.stop();
      } catch {}
    } else {
      overlay.classList.add("active");
      overlayText.textContent = "Ask me anything";
      setTimeout(startFullListening, 500);
    }
  };

  /* STOP button in overlay */
  overlayMic.onclick = () => {
    listening = false;
    try {
      recognition.stop();
    } catch {}
    overlay.classList.remove("active");
    overlayText.textContent = "";
  };

  recognition.onresult = (e) => {
    const transcript = e.results[0][0].transcript;

    try {
      recognition.stop();
    } catch {}

    listening = false;
    clearTimeout(voiceTimeout);
    overlay.classList.remove("active");

    aiInput.value = transcript;
    sendUserMessage(transcript);
  };

  recognition.onerror = (e) => {
    console.warn("Voice error:", e.error);
    listening = false;
    overlay.classList.remove("active");
    overlayText.textContent = "";
    clearTimeout(voiceTimeout);

    if (e.error === "not-allowed") {
      alert("Microphone permission blocked.");
    }
  };

  recognition.onend = () => {
    listening = false;
    overlay.classList.remove("active");
    overlayText.textContent = "";
    clearTimeout(voiceTimeout);

    if (wakeEnabled && !document.hidden && !wakeRunning) {
      setTimeout(startWakeListener, 400);
    }
  };

  /* -----------------------------
      WAKE WORD: “HEY AMY”
  ----------------------------- */

  let wakeRecognition = null;
  let wakeEnabled = false;
  let wakeRunning = false;

  const HEY_AMY_VARIANTS = [
    "hey amy",
    "hey ami",
    "hey emmy",
    "hey ammy",
    "okay amy",
    "ok amy"
  ];

  function startWakeListener() {
    if (!wakeEnabled || wakeRunning || !hasSpeechSupport()) return;

    const SR2 = window.SpeechRecognition || window.webkitSpeechRecognition;
    wakeRecognition = new SR2();
    wakeRecognition.lang = "en-GB";
    wakeRecognition.continuous = true;
    wakeRecognition.interimResults = true;

    wakeRecognition.onstart = () => {
      wakeRunning = true;
      console.log("[Wake] Listening for 'Hey Amy'...");
    };

    wakeRecognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript
          .toLowerCase()
          .trim();
        const confidence = event.results[i][0].confidence;

        const heardWake = HEY_AMY_VARIANTS.some((w) =>
          transcript.includes(w)
        );

        if (heardWake && confidence > 0.25) {
          try {
            wakeRecognition.stop();
          } catch {}

          wakeRunning = false;

          overlay.classList.add("active");
          overlayText.textContent = "Ask me anything";

          setTimeout(startFullListening, 500);
          return;
        }
      }
    };

    wakeRecognition.onerror = (e) => {
      console.warn("[Wake] Error:", e.error);
      wakeRunning = false;
    };

    wakeRecognition.onend = () => {
      wakeRunning = false;
      if (wakeEnabled && !document.hidden) {
        setTimeout(startWakeListener, 600);
      }
    };

    try {
      wakeRecognition.start();
    } catch (err) {
      console.warn("Wake start error:", err);
    }
  }

  function stopWakeListener() {
    if (wakeRecognition) {
      try {
        wakeRecognition.stop();
      } catch {}
    }
    wakeRunning = false;
  }

  // Toggle
  wakeToggle.addEventListener("change", () => {
    wakeEnabled = wakeToggle.checked;

    if (wakeEnabled) {
      startWakeListener();
    } else {
      stopWakeListener();
    }
  });

  // Handle tab hidden
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopWakeListener();
    } else if (wakeEnabled) {
      startWakeListener();
    }
  });
}
