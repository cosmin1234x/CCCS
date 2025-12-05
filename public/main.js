// ================================
// main.js – McTraining Dashboard
// Fully Firestore-driven
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
   BASIC HELPERS
============================================================ */

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

function toISODateString(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getMonday(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0 = Sun
  const diff = (day === 0 ? -6 : 1) - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getWeekRange(offsetWeeks = 0, baseDate = new Date()) {
  const monday = getMonday(baseDate);
  const start = new Date(monday);
  start.setDate(start.getDate() + offsetWeeks * 7);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { start, end };
}

function parseTimeToMinutes(t) {
  if (!t || typeof t !== "string") return 0;
  const [h, m] = t.split(":").map((x) => parseInt(x, 10));
  if (isNaN(h) || isNaN(m)) return 0;
  return h * 60 + m;
}

function hoursBetween(start, end) {
  const diff = parseTimeToMinutes(end) - parseTimeToMinutes(start);
  return diff > 0 ? diff / 60 : 0;
}

function formatDayLabelShort(d) {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return `${days[d.getDay()]}`;
}

function hasSpeechSupport() {
  return "SpeechRecognition" in window || "webkitSpeechRecognition" in window;
}

function beep(f = 880, ms = 90, v = 0.08) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = f;
    gain.gain.value = v;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    setTimeout(() => {
      osc.stop();
      ctx.close();
    }, ms);
  } catch {
    // ignore
  }
}

function describeStars(stars) {
  const n = typeof stars === "number" ? stars : 0;
  if (n <= 0) return "☆ New McStar";
  if (n === 1) return "⭐ Bronze McStar";
  if (n === 2) return "⭐⭐ Silver McStar";
  return "⭐⭐⭐ Gold McStar";
}

/* ============================================================
   GLOBAL STATE
============================================================ */

let sessionUser = null;          // { id, role, name, storeId, hourlyRate }
let crewData = {};               // computed for crew dashboard
let managerData = {};            // computed for manager/shiftCreator dashboard
let allShifts = [];              // all shifts for this store (for staffing + AI)
window.loadedShiftsForCrew = []; // used by McAssist

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

// voice / overlay
const micBtn = document.getElementById("aiMicBtn");
const overlay = document.getElementById("voiceOverlay");
const overlayText = document.getElementById("overlayText");
const overlayMic = document.getElementById("overlayMic");
const wakeToggle = document.getElementById("wakeToggle");

// crew profile overlay (manager side)
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

// sidebar toggle
const sidebar = document.querySelector(".sidebar");
const sidebarToggle = document.getElementById("sidebarToggle");

/* ============================================================
   FIRESTORE LOADERS
============================================================ */

// Load all shifts for the store (used for both crew + manager)
async function loadShiftsForStore(storeId) {
  allShifts = [];
  try {
    const colRef = collection(db, "stores", storeId, "shifts");
    const snap = await getDocs(colRef);
    snap.forEach((docSnap) => {
      const d = docSnap.data();
      if (!d.date || !d.start || !d.end || !d.userId) return;
      allShifts.push({
        id: docSnap.id,
        date: d.date,
        start: d.start,
        end: d.end,
        userId: d.userId,
        userName: d.userName || "Unknown",
        role: d.role || "crew",
        station: d.station || "",
        isShiftManager: !!d.isShiftManager
      });
    });
  } catch (err) {
    console.error("[Dashboard] loadShiftsForStore error:", err);
  }
}

// Load crew user profile (users collection)
async function loadCrewUserData(userId) {
  crewData = {
    hourlyRate: 10.5,
    trainingTodo: [],
    achievements: []
  };

  try {
    const uRef = doc(db, "users", userId);
    const snap = await getDoc(uRef);
    if (snap.exists()) {
      const d = snap.data();
      crewData.hourlyRate =
        typeof d.hourlyRate === "number" ? d.hourlyRate : crewData.hourlyRate;
      crewData.trainingTodo = Array.isArray(d.trainingTodo)
        ? d.trainingTodo
        : crewData.trainingTodo;
      crewData.achievements = Array.isArray(d.achievements)
        ? d.achievements
        : crewData.achievements;
      crewData.certifications = Array.isArray(d.certifications)
        ? d.certifications
        : ["Front Counter"]; // fallback
    }
  } catch (err) {
    console.error("[Dashboard] loadCrewUserData error:", err);
  }

  // derive schedule + hours from shifts
  computeCrewDerivedFromShifts();
}

// Load store-level data for manager/shiftCreator
async function loadManagerStoreData(storeId) {
  managerData = {
    storeName: "Your restaurant",
    todaySales: 0,
    weekSales: 0,
    todayWasteValue: 0,
    todayWastePct: 0,
    staffOnShift: 0,
    staffNeeded: 0,
    trainingGaps: 0,
    potentialOvertime: 0,
    foodWasteByDay: [],
    crewTrainingSummary: []
  };

  try {
    const storeRef = doc(db, "stores", storeId);
    const storeSnap = await getDoc(storeRef);
    if (storeSnap.exists()) {
      const d = storeSnap.data();
      managerData.storeName = d.name || managerData.storeName;
      managerData.todaySales = d.todaySales ?? managerData.todaySales;
      managerData.weekSales = d.weekSales ?? managerData.weekSales;
      managerData.todayWasteValue =
        d.foodwaste ?? d.todayWasteValue ?? managerData.todayWasteValue;
      managerData.todayWastePct =
        d.todayWastePct ?? managerData.todayWastePct;
      managerData.trainingGaps =
        d.trainingCompletionPercent != null
          ? d.trainingCompletionPercent
          : managerData.trainingGaps;
      managerData.potentialOvertime =
        d.trainingOverdueCount ?? managerData.potentialOvertime;
      // demo food waste by day if not present
      if (Array.isArray(d.foodWasteByDay)) {
        managerData.foodWasteByDay = d.foodWasteByDay;
      } else {
        managerData.foodWasteByDay = [
          { day: "Mon", value: 52 },
          { day: "Tue", value: 39 },
          { day: "Wed", value: 47 },
          { day: "Thu", value: 41 },
          { day: "Fri", value: 65 }
        ];
      }
    }

    // crew training summary
    const crewCol = collection(db, "stores", storeId, "crewSummary");
    const crewSnap = await getDocs(crewCol);
    const list = [];
    crewSnap.forEach((snap) => {
      const d = snap.data();
      list.push({
        id: snap.id,
        name: d.name || "Crew",
        status: d.status || "",
        badge: d.badge || "OK",
        stars: typeof d.stars === "number" ? d.stars : 0
      });
    });
    if (list.length) {
      managerData.crewTrainingSummary = list;
    }
  } catch (err) {
    console.error("[Dashboard] loadManagerStoreData error:", err);
  }

  // derive staffing from shifts
  computeManagerStaffingFromShifts();
}

// Update crew summary fields in Firestore
async function updateCrewFieldsInFirestore(crewId, fields) {
  const storeId = sessionUser.storeId || "store001";
  const ref = doc(db, "stores", storeId, "crewSummary", crewId);
  try {
    await updateDoc(ref, fields);
  } catch (e) {
    console.error("[Dashboard] updateCrewFields error:", e);
  }
}

/* ============================================================
   DERIVED DATA FROM SHIFTS
============================================================ */

function computeCrewDerivedFromShifts() {
  const storeId = sessionUser.storeId || "store001";
  const userId = sessionUser.id;

  const { start, end } = getWeekRange(0, new Date());
  const weekStart = toISODateString(start);
  const weekEnd = toISODateString(end);

  const userShifts = allShifts.filter(
    (s) => s.userId === userId && s.date >= weekStart && s.date <= weekEnd
  );

  // expose for McAssist
  window.loadedShiftsForCrew = allShifts.filter((s) => s.userId === userId);

  // weekly hours + schedule list
  let hours = 0;
  const scheduleLines = [];

  userShifts.forEach((s) => {
    hours += hoursBetween(s.start, s.end);
    scheduleLines.push({
      day: s.date,
      label: s.date, // can prettify later
      time: `${s.start}–${s.end}`
    });
  });

  // sort schedule by date/time
  scheduleLines.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));

  // next shift = first future shift (>= today)
  const todayISO = toISODateString(new Date());
  const upcoming = window.loadedShiftsForCrew
    .filter((s) => s.date >= todayISO)
    .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));

  crewData.hoursThisWeek = Number(hours.toFixed(1));
  crewData.estimatedPayThisWeek = crewData.hourlyRate * hours;
  crewData.weeklySchedule = scheduleLines; // used in bottom section

  if (upcoming.length) {
    const n = upcoming[0];
    crewData.nextShift = {
      date: n.date,
      start: n.start,
      end: n.end,
      station: n.station || ""
    };
  } else {
    crewData.nextShift = null;
  }
}

function computeManagerStaffingFromShifts() {
  const todayISO = toISODateString(new Date());
  const todaysShifts = allShifts.filter((s) => s.date === todayISO);

  // count unique people on shift today
  const uniqueIds = new Set(todaysShifts.map((s) => s.userId));
  const staffOnShift = uniqueIds.size;

  managerData.staffOnShift = staffOnShift;
  // if we have no explicit "staffNeeded", assume 1 more than we have
  if (!managerData.staffNeeded || managerData.staffNeeded < staffOnShift) {
    managerData.staffNeeded = staffOnShift > 0 ? staffOnShift + 1 : 0;
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
      storeId: "store001",
      hourlyRate: 10.5
    };
    saveSessionUser(sessionUser);
  }

  // refresh basic values from Firestore users doc
  try {
    const uRef = doc(db, "users", sessionUser.id);
    const snap = await getDoc(uRef);
    if (snap.exists()) {
      const d = snap.data();
      sessionUser.name = d.name || sessionUser.name;
      sessionUser.role = d.role || sessionUser.role;
      sessionUser.storeId = d.storeId || sessionUser.storeId || "store001";
      if (typeof d.hourlyRate === "number") {
        sessionUser.hourlyRate = d.hourlyRate;
      }
      saveSessionUser(sessionUser);
    }
  } catch (err) {
    console.error("[Dashboard] refresh sessionUser error:", err);
  }

  const storeId = sessionUser.storeId || "store001";

  // 1) load all shifts for the store
  await loadShiftsForStore(storeId);

  // 2) load role-specific data
  const isCrew = sessionUser.role === "crew";
  if (isCrew) {
    crewData.hourlyRate = sessionUser.hourlyRate || 10.5;
    await loadCrewUserData(sessionUser.id);
  } else {
    await loadManagerStoreData(storeId);
  }

  // 3) render dashboard
  initialiseDashboard();
});

if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    await signOut(auth);
    localStorage.removeItem("mc_session_user");
    window.location.href = "index.html";
  });
}

/* ============================================================
   DASHBOARD RENDERING
============================================================ */

function initialiseDashboard() {
  if (!sessionUser) return;

  const isCrew = sessionUser.role === "crew";
  const profile = isCrew ? crewData : managerData;

  // sidebar user info
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
      ? "Crew"
      : sessionUser.role === "shiftCreator"
      ? "Shift creator"
      : "Manager";
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
      : "Ask about waste, crew or sales.";
  }

  renderTopCards(isCrew, profile);
  renderBottomSection(isCrew, profile);
  renderSuggestions(isCrew);
  seedIntroMessages(isCrew);
}

function renderTopCards(isCrew, profile) {
  if (!topCards) return;
  topCards.innerHTML = "";

  const cards = isCrew
    ? [
        {
          title: "This week’s hours",
          icon: "⏱️",
          main: `${(profile.hoursThisWeek || 0).toFixed(1)} hrs`,
          sub: profile.nextShift
            ? `Next shift: ${profile.nextShift.date} ${profile.nextShift.start}-${profile.nextShift.end}`
            : "No upcoming shifts posted."
        },
        {
          title: "Estimated pay",
          icon: "💷",
          main: `£${(profile.estimatedPayThisWeek || 0).toFixed(2)}`,
          sub: `£${(profile.hourlyRate || sessionUser.hourlyRate || 0).toFixed(
            2
          )}/hr`
        },
        {
          title: "Stations",
          icon: "🍔",
          main: Array.isArray(profile.certifications)
            ? profile.certifications.join(", ")
            : "Not set",
          sub: profile.trainingTodo && profile.trainingTodo.length
            ? `Next: ${profile.trainingTodo[0]}`
            : "No training assigned."
        },
        {
          title: "Achievements",
          icon: "🏅",
          main: `${(profile.achievements || []).length} badges`,
          sub:
            profile.achievements && profile.achievements[0]
              ? profile.achievements[0].title
              : "Earn your next badge!"
        }
      ]
    : [
        {
          title: "Today's sales",
          icon: "💰",
          main: `£${profile.todaySales || 0}`,
          sub: `Week: £${profile.weekSales || 0}`
        },
        {
          title: "Food waste",
          icon: "♻️",
          main: `£${profile.todayWasteValue || 0}`,
          sub: `${(profile.todayWastePct || 0).toFixed(1)}%`
        },
        {
          title: "Staffing",
          icon: "👥",
          main: `${profile.staffOnShift || 0}/${profile.staffNeeded || 0}`,
          sub:
            (profile.staffNeeded || 0) - (profile.staffOnShift || 0) > 0
              ? "Short on shift"
              : "Good coverage"
        },
        {
          title: "Training health",
          icon: "🎓",
          main: `${profile.trainingGaps || 0}%`,
          sub: `${profile.potentialOvertime || 0} overdue modules`
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

function renderBottomSection(isCrew, profile) {
  if (!bottomSection) return;

  if (isCrew) {
    const schedule = Array.isArray(profile.weeklySchedule)
      ? profile.weeklySchedule
      : [];

    bottomSection.innerHTML = `
      <div class="subsection-title">Weekly Schedule</div>
      <ul class="list">
        ${
          schedule.length
            ? schedule
                .map(
                  (s) => `
              <li>
                <span>${s.date}</span>
                <span class="badge-soft">${s.time}</span>
              </li>
            `
                )
                .join("")
            : `<li><span>No shifts posted for the next 7 days.</span></li>`
        }
      </ul>
      <div class="subsection-title" style="margin-top:15px;">Training Focus</div>
      <ul class="list">
        ${
          profile.trainingTodo && profile.trainingTodo.length
            ? profile.trainingTodo
                .map(
                  (t) => `
              <li>
                <span>${t}</span>
                <span class="badge-soft-warn">To do</span>
              </li>
            `
                )
                .join("")
            : `<li><span>No training items assigned.</span></li>`
        }
      </ul>
    `;
  } else {
    bottomSection.innerHTML = `
      <div class="subsection-title">Food Waste (Week)</div>
      <ul class="list">
        ${
          profile.foodWasteByDay && profile.foodWasteByDay.length
            ? profile.foodWasteByDay
                .map(
                  (d) => `
            <li>
              <span>${d.day}</span>
              <span class="badge-soft-danger">£${d.value}</span>
            </li>`
                )
                .join("")
            : `<li><span>No data.</span></li>`
        }
      </ul>
      <div class="subsection-title" style="margin-top:15px;">Crew Training & McStars</div>
      <ul class="list">
        ${
          profile.crewTrainingSummary && profile.crewTrainingSummary.length
            ? profile.crewTrainingSummary
                .map(
                  (c) => `
            <li data-id="${c.id}">
              <span>
                <strong>${c.name}</strong><br>
                <small>${c.status || ""}</small>
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
            : `<li><span>No crew data.</span></li>`
        }
      </ul>
    `;
    attachCrewEditHandlers();
  }
}

/* ============================================================
   CREW EDIT + PROFILE (MANAGER SIDE)
============================================================ */

function attachCrewEditHandlers() {
  if (!bottomSection) return;

  bottomSection.querySelectorAll(".crew-edit-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      const crew = managerData.crewTrainingSummary.find((c) => c.id === id);
      if (!crew) return;

      const newStatus = prompt(
        `Update training status for ${crew.name}:`,
        crew.status || ""
      );
      if (newStatus === null) return;

      const newBadge = prompt(`Update badge for ${crew.name}:`, crew.badge);
      if (newBadge === null) return;

      const starsInput = prompt(
        `Update McStars for ${crew.name} (0 = New, 1 = Bronze, 2 = Silver, 3 = Gold):`,
        String(crew.stars ?? 0)
      );
      if (starsInput === null) return;

      let newStars = parseInt(starsInput, 10);
      if (isNaN(newStars) || newStars < 0) newStars = 0;
      if (newStars > 3) newStars = 3;

      await updateCrewFieldsInFirestore(id, {
        status: newStatus,
        badge: newBadge,
        stars: newStars
      });

      crew.status = newStatus;
      crew.badge = newBadge;
      crew.stars = newStars;

      renderBottomSection(false, managerData);
    });
  });

  bottomSection.querySelectorAll(".crew-profile-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      openCrewProfile(id);
    });
  });
}

function openCrewProfile(id) {
  if (!crewProfileOverlay) return;
  const crew = managerData.crewTrainingSummary.find((c) => c.id === id);
  if (!crew) return;

  const firstName = crew.name.split(" ")[0] || crew.name;

  if (crewProfileName) crewProfileName.textContent = crew.name;
  if (crewProfileRole) crewProfileRole.textContent = "Crew Member";
  if (crewProfileStore) {
    crewProfileStore.textContent =
      managerData.storeName || sessionUser.storeId || "Restaurant";
  }
  if (crewProfileStatus) crewProfileStatus.textContent = crew.status || "";
  if (crewProfileBadge) crewProfileBadge.textContent = crew.badge || "";
  if (crewProfileAvatar) {
    crewProfileAvatar.textContent = crew.name.charAt(0).toUpperCase();
  }
  if (crewProfileStars) {
    crewProfileStars.textContent = describeStars(crew.stars);
  }
  if (crewProfileNextShift) {
    crewProfileNextShift.textContent =
      "Tomorrow 17:00–23:00 — Front counter (demo)";
  }
  if (crewProfileStations) {
    crewProfileStations.textContent = "Front counter · Fries · Drinks (demo)";
  }
  if (crewProfileNotes) {
    crewProfileNotes.textContent =
      `${firstName} handles peak times well. Recommended for drive-thru training next.`;
  }

  crewProfileOverlay.classList.add("show");
}

if (crewProfileOverlay && crewProfileClose) {
  crewProfileClose.addEventListener("click", () => {
    crewProfileOverlay.classList.remove("show");
  });
  crewProfileOverlay.addEventListener("click", (e) => {
    if (e.target === crewProfileOverlay) {
      crewProfileOverlay.classList.remove("show");
    }
  });
}

/* ============================================================
   AI CHAT (McAssist)
============================================================ */

function renderSuggestions(isCrew) {
  if (!aiSuggestions) return;
  aiSuggestions.innerHTML = "";

  const list = isCrew
    ? [
        "How many hours do I work this week?",
        "How much will I earn?",
        "When is my next shift?",
        "What training do I need?"
      ]
    : [
        "Show me today’s waste.",
        "How are our sales this week?",
        "Which crew need training?",
        "Who is near overtime?"
      ];

  list.forEach((text) => {
    const chip = document.createElement("button");
    chip.className = "suggestion-chip";
    chip.textContent = text;
    chip.onclick = () => sendUserMessage(text);
    aiSuggestions.appendChild(chip);
  });
}

function addMessage(text, from) {
  if (!aiChat) return;
  const div = document.createElement("div");
  div.className = "message " + (from === "user" ? "msg-user" : "msg-bot");

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;

  const meta = document.createElement("div");
  meta.className = "msg-meta";
  meta.textContent = from === "user" ? "You" : "McAssist";

  div.appendChild(bubble);
  div.appendChild(meta);
  aiChat.appendChild(div);
  aiChat.scrollTop = aiChat.scrollHeight;
}

// thinking animation
let thinkingMessageEl = null;

function showThinking() {
  if (!aiChat) return;
  hideThinking();
  const el = document.createElement("div");
  el.className = "message msg-bot thinking";
  el.innerHTML = `
    <div class="bubble">
      Thinking
      <span class="thinking-dots">
        <span class="thinking-dot"></span>
        <span class="thinking-dot"></span>
        <span class="thinking-dot"></span>
      </span>
    </div>
    <div class="msg-meta">McAssist</div>`;
  aiChat.appendChild(el);
  aiChat.scrollTop = aiChat.scrollHeight;
  thinkingMessageEl = el;
}

function hideThinking() {
  if (thinkingMessageEl) thinkingMessageEl.remove();
  thinkingMessageEl = null;
}

function seedIntroMessages(isCrew) {
  if (!aiChat) return;
  aiChat.innerHTML = "";
  const first = isCrew
    ? `Hi ${sessionUser.name.split(" ")[0]} 👋 I can help with hours, pay, shifts and training.`
    : `Hi ${sessionUser.name.split(" ")[0]} 👋 I can help with waste, sales and crew info.`;
  addMessage(first, "bot");
}

async function sendUserMessage(text) {
  if (!text || !text.trim()) return;
  if (!sessionUser) return;

  addMessage(text.trim(), "user");
  if (aiInput) aiInput.value = "";
  if (aiSendBtn) aiSendBtn.disabled = true;

  showThinking();

  try {
    const isCrew = sessionUser.role === "crew";
    const profile = isCrew ? crewData : managerData;

    const realShiftsForUser = Array.isArray(window.loadedShiftsForCrew)
      ? window.loadedShiftsForCrew
      : [];

    const ctx = {
      role: sessionUser.role,
      userName: sessionUser.name,
      storeId: sessionUser.storeId,
      crewData: isCrew
        ? {
            ...profile,
            realShifts: realShiftsForUser
          }
        : undefined,
      managerData: !isCrew
        ? {
            ...profile,
            allShiftsForStore: allShifts
          }
        : undefined
    };

    const res = await fetch("/.netlify/functions/mcassist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: text,
        user: sessionUser,
        contextData: ctx
      })
    });

    let data = {};
    try {
      data = await res.json();
    } catch {
      data = {};
    }

    hideThinking();
    addMessage(data.reply || "I couldn't answer that.", "bot");
  } catch (e) {
    console.error("McAssist error:", e);
    hideThinking();
    addMessage("Something went wrong contacting McAssist.", "bot");
  }

  if (aiSendBtn) aiSendBtn.disabled = false;
}

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
   VOICE MODE + WAKE WORD
============================================================ */

let recognition = null;
let listening = false;
let voiceTimeout = null;

if (micBtn && overlay && hasSpeechSupport()) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SR();
  recognition.lang = "en-US";
  recognition.continuous = false;
  recognition.interimResults = false;

  function startFullListening() {
    try {
      if (overlayText) overlayText.textContent = "Listening…";
      beep(1000, 70, 0.12);
      listening = true;
      recognition.start();

      if (voiceTimeout) clearTimeout(voiceTimeout);
      voiceTimeout = setTimeout(() => {
        try {
          recognition.stop();
        } catch {}
      }, 6000);
    } catch (err) {
      console.error("Voice start error:", err);
      listening = false;
      if (overlay) overlay.classList.remove("active");
      if (overlayText) overlayText.textContent = "";
      alert("Microphone blocked. Please allow access.");
    }
  }

  micBtn.onclick = () => {
    if (listening) {
      try {
        recognition.stop();
      } catch {}
    } else {
      overlay.classList.add("active");
      if (overlayText) overlayText.textContent = "Ask me anything";
      setTimeout(startFullListening, 600);
    }
  };

  if (overlayMic) {
    overlayMic.onclick = () => {
      listening = false;
      try {
        recognition.stop();
      } catch {}
      overlay.classList.remove("active");
      if (overlayText) overlayText.textContent = "";
    };
  }

  recognition.onresult = (e) => {
    const transcript = e.results[0][0].transcript;
    try {
      recognition.stop();
    } catch {}
    overlay.classList.remove("active");
    if (overlayText) overlayText.textContent = "";
    listening = false;
    if (voiceTimeout) clearTimeout(voiceTimeout);
    if (aiInput) aiInput.value = transcript;
    sendUserMessage(transcript);
  };

  recognition.onerror = (e) => {
    console.warn("[Voice] Error:", e.error);
    listening = false;
    overlay.classList.remove("active");
    if (overlayText) overlayText.textContent = "";
    if (voiceTimeout) clearTimeout(voiceTimeout);
    if (e.error === "not-allowed" || e.error === "denied") {
      alert("Microphone permission blocked.");
    }
  };

  recognition.onend = () => {
    listening = false;
    if (voiceTimeout) clearTimeout(voiceTimeout);
    overlay.classList.remove("active");
    if (overlayText) overlayText.textContent = "";
    if (wakeEnabled && !document.hidden && !wakeRunning) {
      setTimeout(startWakeListener, 400);
    }
  };

  // ---- Wake word "Hey Amy" ----
  let wakeRecognition = null;
  let wakeEnabled = false;
  let wakeRunning = false;

  const HEY_AMY_VARIANTS = [
    "hey amy",
    "hey ami",
    "hey amie",
    "hey emmy",
    "hey ammy",
    "ok amy",
    "okay amy"
  ];

  function startWakeListener() {
    if (!hasSpeechSupport()) return;
    if (!wakeEnabled || wakeRunning) return;

    const SR2 = window.SpeechRecognition || window.webkitSpeechRecognition;
    wakeRecognition = new SR2();
    wakeRecognition.lang = "en-US";
    wakeRecognition.continuous = true;
    wakeRecognition.interimResults = true;

    wakeRecognition.onstart = () => {
      wakeRunning = true;
      console.log("[Wake] Listening for 'Hey Amy'…");
    };

    wakeRecognition.onend = () => {
      wakeRunning = false;
      if (wakeEnabled && !document.hidden) {
        setTimeout(startWakeListener, 400);
      }
    };

    wakeRecognition.onerror = (e) => {
      console.warn("[Wake] Error:", e.error);
      if (e.error === "not-allowed") {
        alert("Mic blocked. Wake word disabled.");
        wakeEnabled = false;
        if (wakeToggle) wakeToggle.checked = false;
        return;
      }
      if (e.error === "no-speech") {
        return;
      }
      wakeRunning = false;
      if (wakeEnabled && !document.hidden) {
        setTimeout(startWakeListener, 700);
      }
    };

    wakeRecognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        const transcript = res[0].transcript.toLowerCase().trim();
        const hit = HEY_AMY_VARIANTS.some((kw) => transcript.includes(kw));
        if (hit && res[0].confidence >= 0.25) {
          try {
            wakeRecognition.stop();
          } catch {}
          wakeRunning = false;
          overlay.classList.add("active");
          if (overlayText) overlayText.textContent = "Ask me anything";
          beep(1200, 90, 0.12);
          setTimeout(startFullListening, 650);
          break;
        }
      }
    };

    try {
      wakeRecognition.start();
    } catch (err) {
      console.warn("[Wake] start error:", err);
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

  document.addEventListener("visibilitychange", () => {
    if (!wakeEnabled) return;
    if (document.hidden) {
      stopWakeListener();
    } else {
      startWakeListener();
    }
  });

  if (wakeToggle) {
    if (!hasSpeechSupport()) {
      wakeToggle.disabled = true;
      wakeToggle.title = "Wake word not supported in this browser.";
    }
    wakeToggle.addEventListener("change", () => {
      if (wakeToggle.checked) {
        wakeEnabled = true;
        beep(900, 80, 0.1);
        console.log("[Wake] Enabled");
        startWakeListener();
      } else {
        wakeEnabled = false;
        console.log("[Wake] Disabled");
        stopWakeListener();
      }
    });
  }
} else {
  if (micBtn) micBtn.style.display = "none";
  if (wakeToggle) wakeToggle.disabled = true;
}
