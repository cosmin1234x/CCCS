// ================================
// main.js – FULL VERSION
// ================================
//
// Features:
// - Firestore-backed dashboard (users + stores + shifts + crewSummary)
// - Hours & pay ALWAYS computed from shifts (no Firestore hours/pay)
// - UK break rules (Option A)
// - ShiftCreator role & navigation
// - Crew & Manager dashboards
// - McAssist integration + voice + wake word
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
   SESSION + GLOBAL DATA
============================================================ */

let sessionUser = null;
let allShifts = []; // all shifts for this store

function loadSessionUser() {
  try {
    return JSON.parse(localStorage.getItem("mc_session_user"));
  } catch {
    return null;
  }
}

/* ============================================================
   DATA MODELS (hours/pay/schedule always computed)
============================================================ */

const crewDataDefault = {
  position: "Crew Member",
  hourlyRate: 12.22, // UK crew rate
  hoursThisWeek: 0,
  estimatedPayThisWeek: 0,
  nextShift: { day: "-", date: "", start: "", end: "" },
  certifications: [],
  trainingTodo: [],
  achievements: [],
  schedule: [] // computed from Firestore shifts only
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

// Voice UI
const micBtn = document.getElementById("aiMicBtn");
const overlay = document.getElementById("voiceOverlay");
const overlayText = document.getElementById("overlayText");
const overlayMic = document.getElementById("overlayMic");
const wakeToggle = document.getElementById("wakeToggle");

// Crew profile overlay
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

// Sidebar toggle (mobile)
const sidebar = document.querySelector(".sidebar");
const sidebarToggle = document.getElementById("sidebarToggle");

/* ============================================================
   GENERIC HELPERS
============================================================ */

function hasSpeechSupport() {
  return "SpeechRecognition" in window || "webkitSpeechRecognition" in window;
}

function beep(freq = 900, ms = 90, vol = 0.1) {
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
  } catch {
    // ignore if blocked
  }
}

/* ---------------- Date helpers ---------------- */

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

function getWeekRange(offsetWeeks = 0, baseDate = new Date()) {
  const monday = getMonday(baseDate);
  const start = new Date(monday);
  start.setDate(start.getDate() + offsetWeeks * 7);
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

  if (end < start) end += 24; // crosses midnight

  return Math.max(0, end - start);
}

/* ---------------- UK breaks (Option A) ---------------- */
// Under 5h   → 15 min
// 5–8h       → 30 min
// Over 8h    → 45 min
function calculateBreakMinutes(hours) {
  if (hours <= 0) return 0;
  if (hours < 5) return 15;
  if (hours < 8) return 30;
  return 45;
}

/* ---------------- Star label helper ---------------- */

function describeStars(n) {
  n = Number(n) || 0;
  if (n === 0) return "☆ New";
  if (n === 1) return "⭐ Bronze McStar";
  if (n === 2) return "⭐⭐ Silver McStar";
  return "⭐⭐⭐ Gold McStar";
}

/* ============================================================
   FIRESTORE LOADERS
============================================================ */

async function loadCrewUserExtraFields() {
  // Extra crew-specific profile fields (position, hourlyRate, etc.)
  if (!sessionUser) return;

  try {
    const ref = doc(db, "users", sessionUser.id);
    const snap = await getDoc(ref);
    if (!snap.exists()) return;

    const d = snap.data();

    if (typeof d.position === "string") crewData.position = d.position;
    if (typeof d.hourlyRate === "number") crewData.hourlyRate = d.hourlyRate;
    if (Array.isArray(d.certifications)) crewData.certifications = d.certifications;
    if (Array.isArray(d.trainingTodo)) crewData.trainingTodo = d.trainingTodo;
    if (Array.isArray(d.achievements)) crewData.achievements = d.achievements;
  } catch (err) {
    console.error("[Crew] extra user fields error:", err);
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

    /* ---------- Store data (manager metrics) ---------- */
    if (storeSnap.exists()) {
      Object.assign(managerData, managerDataDefault, storeSnap.data());
      if (typeof managerData.staffNeeded !== "number") {
        managerData.staffNeeded = 10;
      }
    } else {
      managerData = JSON.parse(JSON.stringify(managerDataDefault));
    }

    /* ---------- Shifts ---------- */
    allShifts = [];
    shiftsSnap.forEach((s) => {
      const d = s.data();
      if (!d.date || !d.start || !d.end || !d.userId) return;

      allShifts.push({
        id: s.id,
        date: d.date,
        start: d.start,
        end: d.end,
        userId: d.userId,
        userName: d.userName || "Unknown",
        station: d.station || "",
        role: d.role || "crew"
      });
    });

    // Expose this user's shifts for McAssist & crew dashboard
    const myShifts = allShifts.filter((sh) => sh.userId === sessionUser.id);
    window.loadedShiftsForCrew = myShifts;

    computeManagerMetrics();
    if (sessionUser.role === "crew") {
      computeCrewMetrics(myShifts);
    }

    /* ---------- Crew summary list ---------- */
    const crewList = [];
    crewSnap.forEach((snap) => {
      const d = snap.data();
      crewList.push({
        id: snap.id,
        name: d.name,
        status: d.status,
        badge: d.badge,
        stars: typeof d.stars === "number" ? d.stars : 0
      });
    });

    managerData.crewTrainingSummary = crewList;
  } catch (err) {
    console.error("[Store] load error:", err);
  }
}

async function updateCrewFieldsInFirestore(crewId, fields) {
  if (!sessionUser) return;
  const storeId = sessionUser.storeId || "store001";
  const ref = doc(db, "stores", storeId, "crewSummary", crewId);

  try {
    await updateDoc(ref, fields);
  } catch (err) {
    console.error("[Crew summary update] error:", err);
  }
}

/* ============================================================
   METRIC CALCULATIONS
============================================================ */

function computeManagerMetrics() {
  const todayISO = toISODateString(new Date());
  const todaysShifts = allShifts.filter((s) => s.date === todayISO);
  managerData.staffOnShift = todaysShifts.length;
}

function computeCrewMetrics(myShifts) {
  const shifts = Array.isArray(myShifts) ? myShifts : [];

  const today = new Date();
  const { start, end } = getWeekRange(0, today);
  const weekStartISO = toISODateString(start);
  const weekEndISO = toISODateString(end);

  let totalPaidHours = 0;
  const scheduleMap = {};
  let nextShiftObj = null;

  shifts.forEach((s) => {
    const rawHours = parseShiftHours(s.start, s.end);
    const breakMinutes = calculateBreakMinutes(rawHours);
    const paidHours = rawHours - breakMinutes / 60;

    // Weekly totals
    if (s.date >= weekStartISO && s.date <= weekEndISO) {
      totalPaidHours += paidHours;

      if (!scheduleMap[s.date]) scheduleMap[s.date] = [];
      scheduleMap[s.date].push(`${s.start}–${s.end} (Break ${breakMinutes}m)`);
    }

    // Next upcoming shift
    const shiftDateTime = new Date(`${s.date}T${s.start}:00`);
    if (!nextShiftObj || shiftDateTime < nextShiftObj._dt) {
      nextShiftObj = {
        _dt: shiftDateTime,
        date: s.date,
        start: s.start,
        end: s.end
      };
    }
  });

  // Build schedule array sorted by date
  const schedule = Object.keys(scheduleMap)
    .sort()
    .map((dateISO) => {
      const d = new Date(`${dateISO}T00:00:00`);
      const dayName = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()];
      return {
        day: dayName,
        time: scheduleMap[dateISO].join(", ")
      };
    });

  crewData.schedule = schedule;
  crewData.hoursThisWeek = Number(totalPaidHours.toFixed(2));
  crewData.estimatedPayThisWeek = Number(
    (totalPaidHours * crewData.hourlyRate).toFixed(2)
  );

  if (nextShiftObj) {
    const dt = nextShiftObj._dt;
    const dayName = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][dt.getDay()];
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
   AUTH INITIALISATION
============================================================ */

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    localStorage.removeItem("mc_session_user");
    window.location.href = "index.html";
    return;
  }

  try {
    // Firestore is the source of truth for role & storeId
    const userRef = doc(db, "users", user.uid);
    const userSnap = await getDoc(userRef);

    if (userSnap.exists()) {
      const d = userSnap.data();
      sessionUser = {
        id: user.uid,
        name: d.name || user.displayName || user.email || "User",
        role: d.role || "crew",
        storeId: d.storeId || "store001"
      };
    } else {
      // Fallback to previous session or default
      sessionUser =
        loadSessionUser() || {
          id: user.uid,
          name: user.displayName || user.email || "User",
          role: "crew",
          storeId: "store001"
        };
    }

    localStorage.setItem("mc_session_user", JSON.stringify(sessionUser));

    if (sessionUser.role === "crew") {
      // Crew: load extra profile + store + shifts
      await Promise.all([
        loadCrewUserExtraFields(),
        loadStoreAndShiftsFromFirestore()
      ]);
    } else {
      // Manager / shiftCreator
      await loadStoreAndShiftsFromFirestore();
    }
  } catch (err) {
    console.error("[Auth init] error:", err);
  }

  initialiseDashboard();
});

/* Logout */
if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    try {
      await signOut(auth);
    } finally {
      localStorage.removeItem("mc_session_user");
      window.location.href = "index.html";
    }
  });
}

/* Sidebar toggle */
if (sidebar && sidebarToggle) {
  sidebarToggle.addEventListener("click", () => {
    sidebar.classList.toggle("sidebar-open");
  });
}

/* ============================================================
   DASHBOARD RENDERING
============================================================ */

function initialiseDashboard() {
  if (!sessionUser) return;

  const isCrew = sessionUser.role === "crew";
  const isShiftCreator = sessionUser.role === "shiftCreator";
  const profile = isCrew ? crewData : managerData;

  // Sidebar name + role
  if (sidebarUserName) sidebarUserName.textContent = sessionUser.name;
  if (sidebarUserRole) {
    if (isCrew) sidebarUserRole.textContent = "Crew Member";
    else if (isShiftCreator) sidebarUserRole.textContent = "Shift Creator";
    else sidebarUserRole.textContent = "Restaurant Manager";
  }

  // Badge + avatar
  if (roleBadge) {
    roleBadge.textContent = isCrew
      ? "CREW"
      : isShiftCreator
      ? "SHIFT CREATOR"
      : "MANAGER";
  }
  if (avatarCircle) {
    avatarCircle.textContent = sessionUser.name.charAt(0).toUpperCase();
  }

  // Top title/subtitle
  if (welcomeTitle) {
    welcomeTitle.textContent = isCrew
      ? `Welcome back, ${sessionUser.name.split(" ")[0]}`
      : `Good shift, ${sessionUser.name.split(" ")[0]}`;
  }

  if (welcomeSubtitle) {
    welcomeSubtitle.textContent = isCrew
      ? "Here’s your week at a glance."
      : `Live store view for ${managerData.storeName || "your restaurant"}.`;
  }

  // McAssist subtitle
  if (aiSubtitle) {
    aiSubtitle.textContent = isCrew
      ? "Ask about hours, pay, breaks, shifts or training."
      : "Ask about waste, sales, staffing or crew training.";
  }

  // Shift creator nav visibility
  if (navShiftCreator) {
    navShiftCreator.style.display = isShiftCreator ? "flex" : "none";
  }

  // My profile button (crew only)
  if (myProfileBtn) {
    myProfileBtn.style.display = isCrew ? "inline-flex" : "none";
  }

  renderTopCards(isCrew, profile);
  renderBottomSection(isCrew, profile);
  renderSuggestions(isCrew);
  seedIntroMessages(isCrew);
}

/* ---------------- TOP CARDS ---------------- */

function renderTopCards(isCrew, profile) {
  if (!topCards) return;
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
        sub: `£${profile.hourlyRate.toFixed(2)}/hr`
      },
      {
        title: "Stations",
        icon: "🍔",
        main:
          profile.certifications && profile.certifications.length
            ? profile.certifications.join(", ")
            : "No stations yet",
        sub: profile.trainingTodo[0] ? `Next: ${profile.trainingTodo[0]}` : ""
      },
      {
        title: "Achievements",
        icon: "🏅",
        main: `${profile.achievements.length} badges`,
        sub:
          profile.achievements[0]?.title ||
          "Do something great to earn a badge!"
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
        sub: `${Number(managerData.todayWastePct || 0).toFixed(1)}%`
      },
      {
        title: "Staffing",
        icon: "👥",
        main: `${managerData.staffOnShift}/${managerData.staffNeeded}`,
        sub:
          managerData.staffNeeded - managerData.staffOnShift > 0
            ? "Understaffed"
            : "Good coverage"
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

/* ---------------- BOTTOM SECTION ---------------- */

function renderBottomSection(isCrew, profile) {
  if (!bottomSection) return;

  if (isCrew) {
    const scheduleHtml =
      profile.schedule && profile.schedule.length
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

    const trainingHtml =
      profile.trainingTodo && profile.trainingTodo.length
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
      <ul class="list">${scheduleHtml}</ul>

      <div class="subsection-title" style="margin-top: 20px;">Training Focus</div>
      <ul class="list">${trainingHtml}</ul>
    `;
    return;
  }

  // Manager / ShiftCreator section
  bottomSection.innerHTML = `
    <div class="subsection-title">Crew Training & McStars</div>
    <ul class="list">
      ${
        managerData.crewTrainingSummary &&
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
          : `<li><span>No crew summary yet.</span></li>`
      }
    </ul>
  `;

  attachCrewListHandlers();
}

/* ============================================================
   CREW PROFILE + EDIT
============================================================ */

function attachCrewListHandlers() {
  bottomSection
    .querySelectorAll(".crew-profile-btn")
    .forEach((btn) => (btn.onclick = () => openCrewProfile(btn.dataset.id)));

  bottomSection
    .querySelectorAll(".crew-edit-btn")
    .forEach(
      (btn) =>
        (btn.onclick = async () => {
          const id = btn.dataset.id;
          const crew = managerData.crewTrainingSummary.find((c) => c.id === id);
          if (!crew) return;

          const newStatus = prompt("Update training status:", crew.status);
          if (newStatus === null) return;

          const newBadge = prompt("Update badge:", crew.badge);
          if (newBadge === null) return;

          let starsInput = prompt(
            "Update McStars (0 = New, 1 = Bronze, 2 = Silver, 3 = Gold):",
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
        })
    );
}

function openCrewProfile(crewId) {
  if (!crewProfileOverlay) return;
  const crew = managerData.crewTrainingSummary.find((c) => c.id === crewId);
  if (!crew) return;

  const firstName = crew.name.split(" ")[0] || crew.name;

  crewProfileName.textContent = crew.name;
  crewProfileRole.textContent = "Crew Member";
  crewProfileStore.textContent =
    managerData.storeName || sessionUser.storeId || "Restaurant";
  crewProfileStatus.textContent = crew.status;
  crewProfileBadge.textContent = crew.badge;
  crewProfileAvatar.textContent = crew.name.charAt(0).toUpperCase();
  crewProfileStars.textContent = describeStars(crew.stars);
  crewProfileNextShift.textContent = "Next shift: check schedule.";
  crewProfileStations.textContent = "Stations data coming soon.";
  crewProfileNotes.textContent = `${firstName} is progressing well.`;

  crewProfileOverlay.classList.add("show");
}

// "My profile" for the logged-in crew member
function openSelfProfile() {
  if (!crewProfileOverlay || !sessionUser) return;

  const firstName = sessionUser.name.split(" ")[0];

  crewProfileName.textContent = sessionUser.name;
  crewProfileRole.textContent = crewData.position || "Crew Member";
  crewProfileStore.textContent =
    managerData.storeName || sessionUser.storeId || "Restaurant";

  // Simple status + badge from training data
  if (crewData.trainingTodo && crewData.trainingTodo.length > 0) {
    crewProfileStatus.textContent = "Training in progress";
    crewProfileBadge.textContent = `${crewData.trainingTodo.length} modules to do`;
  } else {
    crewProfileStatus.textContent = "Up to date";
    crewProfileBadge.textContent = "All training completed";
  }

  crewProfileAvatar.textContent = sessionUser.name.charAt(0).toUpperCase();

  // Use achievements length as a fake McStar level
  let stars = 0;
  if (crewData.achievements.length >= 3) stars = 3;
  else if (crewData.achievements.length === 2) stars = 2;
  else if (crewData.achievements.length === 1) stars = 1;
  crewProfileStars.textContent = describeStars(stars);

  if (crewData.nextShift && crewData.nextShift.start) {
    crewProfileNextShift.textContent = `${crewData.nextShift.day} ${crewData.nextShift.start}–${crewData.nextShift.end}`;
  } else {
    crewProfileNextShift.textContent = "No upcoming shifts.";
  }

  crewProfileStations.textContent =
    crewData.certifications && crewData.certifications.length
      ? crewData.certifications.join(" · ")
      : "No stations yet";

  crewProfileNotes.textContent = `${firstName} is doing great this week.`;

  crewProfileOverlay.classList.add("show");
}

/* Close profile overlay */
if (crewProfileClose && crewProfileOverlay) {
  crewProfileClose.onclick = () =>
    crewProfileOverlay.classList.remove("show");

  crewProfileOverlay.onclick = (e) => {
    if (e.target === crewProfileOverlay) {
      crewProfileOverlay.classList.remove("show");
    }
  };
}

/* My profile button */
if (myProfileBtn) {
  myProfileBtn.addEventListener("click", () => openSelfProfile());
}

/* ============================================================
   McASSIST – SUGGESTIONS + CHAT
============================================================ */

function renderSuggestions(isCrew) {
  if (!aiSuggestions) return;
  aiSuggestions.innerHTML = "";

  const list = isCrew
    ? [
        "How many hours do I work this week?",
        "How much will I earn?",
        "When is my next shift?",
        "What breaks do I get?",
        "What training do I need?"
      ]
    : [
        "Show me today’s waste.",
        "How are sales this week?",
        "Which crew need training?",
        "Who is near overtime?",
        "How many staff are working today?"
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
  div.innerHTML = `
    <div class="bubble">${text}</div>
    <div class="msg-meta">${from === "user" ? "You" : "McAssist"}</div>
  `;
  aiChat.appendChild(div);
  aiChat.scrollTop = aiChat.scrollHeight;
}

/* Thinking indicator */

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

/* Intro message */

function seedIntroMessages(isCrew) {
  if (!aiChat) return;
  aiChat.innerHTML = "";
  const msg = isCrew
    ? `Hi ${sessionUser.name.split(" ")[0]} 👋 I can help with hours, pay, breaks, shifts and training.`
    : `Hi ${sessionUser.name.split(" ")[0]} 👋 I can help with waste, sales, staffing and crew info.`;
  addMessage(msg, "bot");
}

/* ============================================================
   SEND MESSAGE TO NETLIFY FUNCTION
============================================================ */

async function sendUserMessage(text) {
  if (!text || !text.trim()) return;
  if (!sessionUser) return;

  addMessage(text.trim(), "user");
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
            realShifts: Array.isArray(window.loadedShiftsForCrew)
              ? window.loadedShiftsForCrew
              : []
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
    console.error("McAssist error:", err);
    hideThinking();
    addMessage("Something went wrong contacting McAssist.", "bot");
  }

  if (aiSendBtn) aiSendBtn.disabled = false;
}

/* Chat form submit */

if (aiForm) {
  aiForm.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!aiInput) return;
    sendUserMessage(aiInput.value);
  });
}

/* ============================================================
   VOICE MODE + WAKE WORD ("HEY AMY")
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
      beep(1100, 90, 0.12);
      listening = true;
      recognition.start();

      if (voiceTimeout) clearTimeout(voiceTimeout);
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

  // Small mic button
  micBtn.onclick = () => {
    if (listening) {
      try {
        recognition.stop();
      } catch {}
    } else {
      overlay.classList.add("active");
      if (overlayText) overlayText.textContent = "Ask me anything";
      setTimeout(startFullListening, 400);
    }
  };

  // Big overlay mic
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
    console.warn("Voice error:", e.error);
    listening = false;
    overlay.classList.remove("active");
    if (overlayText) overlayText.textContent = "";
    if (voiceTimeout) clearTimeout(voiceTimeout);
  };

  /* ---------- Wake word "Hey Amy" ---------- */

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
      console.warn("[Wake] error:", e.error);
      if (e.error === "not-allowed") {
        alert("Microphone blocked. Wake word disabled.");
        wakeEnabled = false;
        if (wakeToggle) wakeToggle.checked = false;
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
        const conf = res[0].confidence;

        const hit =
          conf >= 0.25 &&
          HEY_AMY_VARIANTS.some((kw) => transcript.includes(kw));

        if (hit) {
          console.log("[Wake] TRIGGER:", transcript);
          try {
            wakeRecognition.stop();
          } catch {}
          wakeRunning = false;

          overlay.classList.add("active");
          if (overlayText) overlayText.textContent = "Ask me anything";
          beep(1400, 90, 0.15);
          setTimeout(startFullListening, 600);
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

  // Toggle
  if (wakeToggle) {
    if (!hasSpeechSupport()) {
      wakeToggle.disabled = true;
      wakeToggle.title = "Wake word not supported in this browser.";
    }

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

  // Pause wake word when tab hidden
  document.addEventListener("visibilitychange", () => {
    if (!wakeEnabled) return;
    if (document.hidden) {
      stopWakeListener();
    } else {
      startWakeListener();
    }
  });
} else {
  if (micBtn) micBtn.style.display = "none";
  if (wakeToggle) wakeToggle.disabled = true;
}
