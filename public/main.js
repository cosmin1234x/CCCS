// ================================
// main.js – McTraining Dashboard
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
   DEFAULT DATA (fallbacks, will be overridden by Firestore)
============================================================ */

const crewDataDefault = {
  position: "Crew Member",
  hourlyRate: 10.5,
  hoursThisWeek: 0,
  estimatedPayThisWeek: 0,
  nextShift: { day: "-", date: "", start: "", end: "" },
  certifications: ["Front Counter"],
  trainingTodo: ["Drive-Thru Module 2", "Food Safety Level 2"],
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
   SESSION + DOM ELEMENTS
============================================================ */

let sessionUser = null;
let allShifts = []; // all store shifts for today/week, used in multiple places

function loadSessionUser() {
  try {
    return JSON.parse(localStorage.getItem("mc_session_user"));
  } catch {
    return null;
  }
}

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

// Voice + overlay
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

/* Sidebar toggle (mobile) */
const sidebar = document.querySelector(".sidebar");
const sidebarToggle = document.getElementById("sidebarToggle");

/* ============================================================
   GENERIC HELPERS
============================================================ */

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
    // ignore if AudioContext is blocked
  }
}

function describeStars(stars) {
  const n = typeof stars === "number" ? stars : 0;
  if (n <= 0) return "☆ New";
  if (n === 1) return "⭐ Bronze McStar";
  if (n === 2) return "⭐⭐ Silver McStar";
  return "⭐⭐⭐ Gold McStar";
}

/* ===== Date helpers (for shifts & weeks) ===== */

function toISODateString(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getMonday(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0 (Sun) - 6 (Sat)
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

function parseShiftDurationHours(startHHMM, endHHMM) {
  if (!startHHMM || !endHHMM) return 0;
  const [sh, sm] = startHHMM.split(":").map((x) => parseInt(x, 10) || 0);
  const [eh, em] = endHHMM.split(":").map((x) => parseInt(x, 10) || 0);
  let start = sh + sm / 60;
  let end = eh + em / 60;
  // naive – if end is after midnight and smaller, push it forward 24h
  if (end < start) end += 24;
  return Math.max(0, end - start);
}

/* ============================================================
   AUTH + FIRESTORE LOAD
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
      role: "crew", // default
      name: user.displayName || user.email || "User",
      storeId: "store001"
    };
    localStorage.setItem("mc_session_user", JSON.stringify(sessionUser));
  }

  try {
    const isCrew = sessionUser.role === "crew";

    if (isCrew) {
      await Promise.all([
        loadCrewUserFromFirestore(),
        loadStoreAndShiftsFromFirestore()
      ]);
      // crew metrics are computed from shifts in loadStoreAndShiftsFromFirestore()
    } else {
      await loadStoreAndShiftsFromFirestore();
      // managerData will be filled from store doc & shifts
    }
  } catch (err) {
    console.error("[Main] Error during data load:", err);
  }

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
   FIRESTORE HELPERS
============================================================ */

async function loadCrewUserFromFirestore() {
  if (!sessionUser) return;
  try {
    const uRef = doc(db, "users", sessionUser.id);
    const snap = await getDoc(uRef);
    if (snap.exists()) {
      const d = snap.data();
      crewData.position = d.position || crewData.position;
      if (typeof d.hourlyRate === "number") {
        crewData.hourlyRate = d.hourlyRate;
      }
      if (Array.isArray(d.certifications)) {
        crewData.certifications = d.certifications;
      }
      if (Array.isArray(d.trainingTodo)) {
        crewData.trainingTodo = d.trainingTodo;
      }
      if (Array.isArray(d.achievements)) {
        crewData.achievements = d.achievements;
      }
    }
  } catch (e) {
    console.error("[Crew] load user error:", e);
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

    // ----- Store (manager) data -----
    if (storeSnap.exists()) {
      Object.assign(managerData, managerDataDefault, storeSnap.data());
      if (typeof managerData.staffNeeded !== "number") {
        managerData.staffNeeded = 10;
      }
    }

    // ----- Shifts -----
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
        role: d.role || "crew",
        station: d.station || "",
        isShiftManager: !!d.isShiftManager
      });
    });

    // Expose per-user shifts for McAssist + crew dashboard
    const myShifts = allShifts.filter((s) => s.userId === sessionUser.id);
    window.loadedShiftsForCrew = myShifts;

    // Compute staffing for manager today
    computeManagerMetricsFromShifts();

    // Compute crew metrics from shifts (if logged in as crew)
    if (sessionUser.role === "crew") {
      computeCrewMetricsFromShifts(myShifts);
    }

    // ----- Crew training summary for manager card -----
    const list = [];
    crewSnap.forEach((snap) => {
      const d = snap.data();
      list.push({
        id: snap.id,
        name: d.name,
        status: d.status,
        badge: d.badge,
        stars: typeof d.stars === "number" ? d.stars : 0
      });
    });
    if (list.length) {
      managerData.crewTrainingSummary = list;
    }
  } catch (err) {
    console.error("[Store] load store/shifts error:", err);
  }
}

async function updateCrewFieldsInFirestore(crewId, fields) {
  const storeId = sessionUser.storeId || "store001";
  const ref = doc(db, "stores", storeId, "crewSummary", crewId);
  try {
    await updateDoc(ref, fields);
  } catch (e) {
    console.error("Update crew fields error:", e);
  }
}

/* ----- Metrics from shifts ----- */

function computeManagerMetricsFromShifts() {
  const today = new Date();
  const todayISO = toISODateString(today);
  const todaysShifts = allShifts.filter((s) => s.date === todayISO);
  managerData.staffOnShift = todaysShifts.length;
}

function computeCrewMetricsFromShifts(myShifts) {
  const shifts = Array.isArray(myShifts) ? myShifts : [];
  const today = new Date();
  const { start, end } = getWeekRange(0, today);
  const weekStartISO = toISODateString(start);
  const weekEndISO = toISODateString(end);

  let totalHours = 0;
  const scheduleMap = {}; // date -> [time strings]
  let nextShiftObj = null;

  shifts.forEach((s) => {
    // Weekly hours & schedule
    if (s.date >= weekStartISO && s.date <= weekEndISO) {
      const hrs = parseShiftDurationHours(s.start, s.end);
      totalHours += hrs;

      if (!scheduleMap[s.date]) scheduleMap[s.date] = [];
      scheduleMap[s.date].push(`${s.start}–${s.end}`);
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

  // Build weekly schedule array sorted by date
  const schedule = Object.keys(scheduleMap)
    .sort()
    .map((dateISO) => {
      const d = new Date(`${dateISO}T00:00:00`);
      const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const dayLabel = days[d.getDay()];
      return {
        day: dayLabel,
        time: scheduleMap[dateISO].join(", ")
      };
    });

  crewData.hoursThisWeek = Number(totalHours.toFixed(1));
  const rate = typeof crewData.hourlyRate === "number" ? crewData.hourlyRate : 0;
  crewData.estimatedPayThisWeek = Number((totalHours * rate).toFixed(2));
  crewData.schedule = schedule;

  if (nextShiftObj) {
    const d = nextShiftObj._dt;
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    crewData.nextShift = {
      day: days[d.getDay()],
      date: nextShiftObj.date,
      start: nextShiftObj.start,
      end: nextShiftObj.end
    };
  } else {
    crewData.nextShift = { day: "-", date: "", start: "", end: "" };
  }
}

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
    if (isCrew) {
      sidebarUserRole.textContent = "Crew Member";
    } else if (sessionUser.role === "shiftCreator") {
      sidebarUserRole.textContent = "Shift Creator";
    } else {
      sidebarUserRole.textContent = "Restaurant Manager";
    }
  }

  if (roleBadge) {
    roleBadge.textContent = isCrew ? "CREW" : isManagerLike ? "MANAGER" : "";
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

  if (isCrew) {
    const nextShiftLabel =
      profile.nextShift && profile.nextShift.start
        ? `${profile.nextShift.day} ${profile.nextShift.start}-${profile.nextShift.end}`
        : "No shifts scheduled";

    const cards = [
      {
        title: "This Week’s Hours",
        icon: "⏱️",
        main: `${profile.hoursThisWeek.toFixed(1)} hrs`,
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
        main: profile.certifications.join(", "),
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
            ? "Short on shift"
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
        : `<li><span>No shifts posted for the next 7 days.</span></li>`;

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
      <ul class="list">
        ${scheduleHtml}
      </ul>
      <div class="subsection-title" style="margin-top:15px;">Training Focus</div>
      <ul class="list">
        ${trainingHtml}
      </ul>
    `;
  } else {
    // Manager / shiftCreator view
    bottomSection.innerHTML = `
      <div class="subsection-title">Food Waste (Week)</div>
      <ul class="list">
        ${
          managerData.foodWasteByDay && managerData.foodWasteByDay.length
            ? managerData.foodWasteByDay
                .map(
                  (d) => `
            <li>
              <span>${d.day}</span>
              <span class="badge-soft-danger">£${d.value}</span>
            </li>`
                )
                .join("")
            : `<li><span>No waste data yet.</span></li>`
        }
      </ul>
      <div class="subsection-title" style="margin-top:15px;">Crew Training & McStars</div>
      <ul class="list">
        ${
          managerData.crewTrainingSummary && managerData.crewTrainingSummary.length
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

    attachCrewEditHandlers();
  }
}

/* ============================================================
   CREW EDIT + PROFILE HANDLERS
============================================================ */

function attachCrewEditHandlers() {
  if (!bottomSection) return;

  // Edit training status + badge + stars
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

      // Save to Firestore
      await updateCrewFieldsInFirestore(id, {
        status: newStatus,
        badge: newBadge,
        stars: newStars
      });

      // Update local data so UI refreshes
      crew.status = newStatus;
      crew.badge = newBadge;
      crew.stars = newStars;

      renderBottomSection(false, managerData);
    });
  });

  // Open profile overlay
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
  if (crewProfileStatus) crewProfileStatus.textContent = crew.status;
  if (crewProfileBadge) crewProfileBadge.textContent = crew.badge;
  if (crewProfileAvatar) {
    crewProfileAvatar.textContent = crew.name.charAt(0).toUpperCase();
  }
  if (crewProfileStars) {
    crewProfileStars.textContent = describeStars(crew.stars);
  }

  // Demo data for now (could be wired to real shifts later)
  if (crewProfileNextShift) {
    crewProfileNextShift.textContent = "Tomorrow 17:00–23:00 — Front counter";
  }
  if (crewProfileStations) {
    crewProfileStations.textContent = "Front counter · Fries · Drinks";
  }
  if (crewProfileNotes) {
    crewProfileNotes.textContent =
      `${firstName} handles peak times well. Recommended for drive-thru training next.`;
  }

  crewProfileOverlay.classList.add("show");
}

// Close profile overlay
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
   AI SUGGESTIONS & CHAT
============================================================ */

function renderSuggestions(isCrew) {
  if (!aiSuggestions) return;
  aiSuggestions.innerHTML = "";

  const list = isCrew
    ? [
        "How many hours do I work this week?",
        "How much will I earn?",
        "What training do I need?",
        "When is my next shift?"
      ]
    : [
        "Show me today’s waste.",
        "How are sales?",
        "Crew needing training?",
        "Who’s near overtime?"
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

/* THINKING INDICATOR */

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

/* INTRO MESSAGE */

function seedIntroMessages(isCrew) {
  if (!aiChat) return;
  aiChat.innerHTML = "";
  const first = isCrew
    ? `Hi ${sessionUser.name.split(" ")[0]} 👋 I can help with hours, pay, shifts and training.`
    : `Hi ${sessionUser.name.split(" ")[0]} 👋 I can help with waste, sales and crew info.`;
  addMessage(first, "bot");
}

/* ============================================================
   SEND TO AI BACKEND (McAssist)
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
      managerData: !isCrew ? profile : undefined
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
        console.log("[Voice] Timeout — forcing stop");
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

  // Small mic button next to input
  micBtn.onclick = () => {
    if (listening) {
      try {
        recognition.stop();
      } catch {}
    } else {
      if (!overlay) return;
      overlay.classList.add("active");
      if (overlayText) overlayText.textContent = "Ask me anything";
      setTimeout(startFullListening, 600);
    }
  };

  // Big mic button inside overlay (STOP)
  if (overlayMic) {
    overlayMic.onclick = () => {
      console.log("[Voice] STOP pressed");
      listening = false;
      try {
        recognition.stop();
      } catch {}
      if (overlay) overlay.classList.remove("active");
      if (overlayText) overlayText.textContent = "";
    };
  }

  recognition.onresult = (e) => {
    const transcript = e.results[0][0].transcript;
    console.log("[Voice] Transcript:", transcript);

    try {
      recognition.stop();
    } catch {}

    if (overlay) overlay.classList.remove("active");
    if (overlayText) overlayText.textContent = "";
    listening = false;

    if (voiceTimeout) clearTimeout(voiceTimeout);

    if (aiInput) aiInput.value = transcript;
    sendUserMessage(transcript);
  };

  recognition.onerror = (e) => {
    console.warn("[Voice] Error:", e.error);
    listening = false;

    if (overlay) overlay.classList.remove("active");
    if (overlayText) overlayText.textContent = "";

    if (voiceTimeout) clearTimeout(voiceTimeout);

    if (e.error === "not-allowed" || e.error === "denied") {
      alert("Microphone permission blocked.");
    }
  };

  recognition.onend = () => {
    console.log("[Voice] onend fired");
    listening = false;
    if (voiceTimeout) clearTimeout(voiceTimeout);
    if (overlay) overlay.classList.remove("active");
    if (overlayText) overlayText.textContent = "";

    if (wakeEnabled && !document.hidden && !wakeRunning) {
      setTimeout(startWakeListener, 400);
    }
  };

  /* --------- WAKE WORD: "HEY AMY" ---------- */

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
    if (!recognition) return;

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
        // ignore; continuous mode, will keep running / restart
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

        console.log("[Wake] Heard:", transcript, "conf:", res[0].confidence);

        if (hit && res[0].confidence >= 0.25) {
          console.log("[Wake] TRIGGER DETECTED!");

          try {
            wakeRecognition.stop();
          } catch {}
          wakeRunning = false;

          if (overlay) overlay.classList.add("active");
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
      console.warn("[Wake] Start error:", err);
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
