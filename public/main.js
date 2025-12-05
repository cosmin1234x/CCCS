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
  updateDoc,
  setDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

/* ============================================================
   DEFAULT DATA (fallbacks)
============================================================ */

const crewDataDefault = {
  position: "Front Counter",
  hourlyRate: 10.5,
  hoursThisWeek: 18.5,
  estimatedPayThisWeek: 194.25,
  nextShift: { day: "Mon", date: "2025-11-17", start: "17:00", end: "23:00" },
  certifications: ["Front Counter", "Fries"],
  trainingTodo: ["Drive-Thru Module 2", "Food Safety Level 2"],
  achievements: [
    { title: "Customer Compliment", date: "2025-11-10" },
    { title: "Perfect Mystery Shop", date: "2025-11-01" }
  ],
  schedule: [
    { day: "Mon", time: "17:00–23:00" },
    { day: "Wed", time: "10:00–16:00" },
    { day: "Sat", time: "12:00–20:00" }
  ]
};

let crewData = JSON.parse(JSON.stringify(crewDataDefault));

const managerDataDefault = {
  storeName: "Your restaurant",
  todaySales: 4320,
  weekSales: 25500,
  todayWasteValue: 43,
  todayWastePct: 1.0,
  staffOnShift: 9,
  staffNeeded: 10,
  trainingGaps: 3,
  potentialOvertime: 2,
  foodWasteByDay: [
    { day: "Mon", value: 52 },
    { day: "Tue", value: 39 },
    { day: "Wed", value: 47 },
    { day: "Thu", value: 41 },
    { day: "Fri", value: 65 }
  ],
  crewTrainingSummary: [
    {
      id: "alex",
      name: "Alex Johnson",
      status: "Drive-Thru not started",
      badge: "Needs training",
      stars: 1
    },
    {
      id: "maria",
      name: "Maria Lopez",
      status: "All stations certified",
      badge: "Star performer",
      stars: 3
    },
    {
      id: "james",
      name: "James Lee",
      status: "Food Safety expires soon",
      badge: "Action needed",
      stars: 2
    }
  ],
  dayBriefing: null
};

let managerData = JSON.parse(JSON.stringify(managerDataDefault));

/* ============================================================
   SESSION + DOM ELEMENTS
============================================================ */

let sessionUser = null;

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
const dailyBriefCard = document.getElementById("dailyBriefCard");
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

// Sidebar toggle (mobile)
const sidebar = document.querySelector(".sidebar");
const sidebarToggle = document.getElementById("sidebarToggle");

/* ============================================================
   HELPERS
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

function toISODateString(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dayShortLabelFromISO(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return days[d.getDay()];
}

/* ============================================================
   AUTH + INITIAL LOAD
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

  const isManagerLike =
    sessionUser.role === "manager" || sessionUser.role === "shiftCreator";

  if (isManagerLike) {
    await loadManagerDataFromFirestore();
  } else {
    await loadCrewDataFromFirestore();
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

async function recomputeTodayStaffingFromShifts(storeId) {
  const todayISO = toISODateString(new Date());
  try {
    const col = collection(db, "stores", storeId, "shifts");
    const snap = await getDocs(col);
    let count = 0;
    snap.forEach((docSnap) => {
      const d = docSnap.data();
      if (d.date === todayISO) count += 1;
    });
    managerData.staffOnShift = count;
  } catch (err) {
    console.error("[Dashboard] Error recomputing staffing:", err);
  }
}

async function loadDayBriefingFromFirestore(storeId) {
  const today = new Date();
  const todayISO = toISODateString(today);

  try {
    const ref = doc(db, "stores", storeId, "dayBriefings", todayISO);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      managerData.dayBriefing = snap.data();
    } else {
      managerData.dayBriefing = {
        date: todayISO,
        salesTarget: managerData.dayBriefing?.salesTarget || 5000,
        salesActual:
          managerData.dayBriefing?.salesActual || managerData.todaySales || 0,
        wasteTarget: managerData.dayBriefing?.wasteTarget || 40,
        wasteActual:
          managerData.dayBriefing?.wasteActual ||
          managerData.todayWasteValue ||
          0,
        notes: ""
      };
    }
  } catch (err) {
    console.error("[Dashboard] loadDayBriefing error:", err);
  }
}

async function saveDayBriefingToFirestore(storeId, data) {
  const todayISO = data.date;
  try {
    const ref = doc(db, "stores", storeId, "dayBriefings", todayISO);
    await setDoc(ref, data, { merge: true });
  } catch (err) {
    console.error("[Dashboard] saveDayBriefing error:", err);
  }
}

async function loadManagerDataFromFirestore() {
  const storeId = sessionUser.storeId || "store001";

  try {
    const storeRef = doc(db, "stores", storeId);
    const storeSnap = await getDoc(storeRef);

    if (storeSnap.exists()) {
      Object.assign(managerData, storeSnap.data());
    }

    const crewCol = collection(db, "stores", storeId, "crewSummary");
    const crewSnap = await getDocs(crewCol);

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

    await recomputeTodayStaffingFromShifts(storeId);
    await loadDayBriefingFromFirestore(storeId);
  } catch (e) {
    console.error("Error loading manager data:", e);
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

async function loadCrewScheduleFromShifts(storeId, userId) {
  const today = new Date();
  const startISO = toISODateString(today);
  const end = new Date(today);
  end.setDate(end.getDate() + 6);
  const endISO = toISODateString(end);

  const out = [];

  try {
    const colRef = collection(db, "stores", storeId, "shifts");
    const snap = await getDocs(colRef);

    snap.forEach((docSnap) => {
      const d = docSnap.data();
      if (!d.date || !d.start || !d.end || !d.userId) return;
      if (d.userId !== userId) return;
      if (d.date < startISO || d.date > endISO) return;

      out.push({
        date: d.date,
        day: dayShortLabelFromISO(d.date),
        time: `${d.start}–${d.end}`,
        station: d.station || ""
      });
    });

    out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    crewData.schedule = out.map((s) => ({
      day: s.day,
      time: s.time,
      station: s.station
    }));
  } catch (err) {
    console.error("[Dashboard] loadCrewScheduleFromShifts error:", err);
  }
}

async function loadCrewDataFromFirestore() {
  try {
    const uRef = doc(db, "users", sessionUser.id);
    const snap = await getDoc(uRef);
    if (snap.exists()) {
      Object.assign(crewData, snap.data());
    }
  } catch (e) {
    console.error("Crew load error", e);
  }

  const storeId = sessionUser.storeId || "store001";
  await loadCrewScheduleFromShifts(storeId, sessionUser.id);
}

/* ============================================================
   DASHBOARD RENDERING
============================================================ */

function initialiseDashboard() {
  if (!sessionUser) return;

  const isCrew = sessionUser.role === "crew";
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
    if (isCrew) roleBadge.textContent = "Crew";
    else if (sessionUser.role === "shiftCreator") roleBadge.textContent = "Shift creator";
    else roleBadge.textContent = "Manager";
  }

  if (avatarCircle) {
    avatarCircle.textContent = sessionUser.name.charAt(0).toUpperCase();
  }

  if (welcomeTitle) {
    const first = sessionUser.name.split(" ")[0];
    welcomeTitle.textContent = isCrew ? `Welcome back, ${first}` : `Good shift, ${first}`;
  }

  if (welcomeSubtitle) {
    welcomeSubtitle.textContent = isCrew
      ? "Here’s your week at a glance."
      : `Live snapshot for ${profile.storeName}.`;
  }

  if (aiSubtitle) {
    aiSubtitle.textContent = isCrew
      ? "Ask about your hours, pay, shifts or training."
      : "Ask about waste, crew or sales.";
  }

  renderDailyBriefCard();
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
          title: "This Week’s Hours",
          icon: "⏱️",
          main: `${profile.hoursThisWeek} hrs`,
          sub: `Next shift: ${profile.nextShift.day} ${profile.nextShift.start}-${profile.nextShift.end}`
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
          sub: `Next: ${profile.trainingTodo[0] || "None"}`
        },
        {
          title: "Achievements",
          icon: "🏅",
          main: `${profile.achievements.length} badges`,
          sub: profile.achievements[0]?.title || "Start something new"
        }
      ]
    : [
        {
          title: "Today's Sales",
          icon: "💰",
          main: `£${profile.todaySales}`,
          sub: `Week: £${profile.weekSales}`
        },
        {
          title: "Food Waste",
          icon: "♻️",
          main: `£${profile.todayWasteValue}`,
          sub: `${profile.todayWastePct.toFixed(1)}%`
        },
        {
          title: "Staffing",
          icon: "👥",
          main: `${profile.staffOnShift}/${profile.staffNeeded}`,
          sub:
            profile.staffNeeded - profile.staffOnShift > 0
              ? "Short on shift"
              : "Good coverage"
        },
        {
          title: "Training Gaps",
          icon: "📚",
          main: `${profile.trainingGaps}`,
          sub: `${profile.potentialOvertime} near overtime`
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
    const scheduleItems =
      profile.schedule && profile.schedule.length
        ? profile.schedule
            .map(
              (s) => `
        <li>
          <span>${s.day}</span>
          <span class="badge-soft">
            ${s.time}${s.station ? " · " + s.station : ""}
          </span>
        </li>`
            )
            .join("")
        : `<li><span>No shifts posted for the next 7 days.</span></li>`;

    bottomSection.innerHTML = `
      <div class="subsection-title">Weekly Schedule</div>
      <ul class="list">
        ${scheduleItems}
      </ul>

      <div class="subsection-title" style="margin-top:15px;">Training Focus</div>
      <ul class="list">
        ${profile.trainingTodo
          .map(
            (t) => `
          <li>
            <span>${t}</span>
            <span class="badge-soft-warn">To do</span>
          </li>`
          )
          .join("")}
      </ul>
    `;
  } else {
    bottomSection.innerHTML = `
      <div class="subsection-title">Food Waste (Week)</div>
      <ul class="list">
        ${profile.foodWasteByDay
          .map(
            (d) => `
          <li>
            <span>${d.day}</span>
            <span class="badge-soft-danger">£${d.value}</span>
          </li>`
          )
          .join("")}
      </ul>
      <div class="subsection-title" style="margin-top:15px;">Crew Training & McStars</div>
      <ul class="list">
        ${profile.crewTrainingSummary
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
          .join("")}
      </ul>
    `;

    attachCrewEditHandlers();
  }
}

/* =============== DAILY BRIEF CARD ================= */

function renderDailyBriefCard() {
  if (!dailyBriefCard || !sessionUser) return;

  const role = sessionUser.role;
  const isManagerLike = role === "manager" || role === "shiftCreator";
  if (!isManagerLike) {
    dailyBriefCard.style.display = "none";
    dailyBriefCard.innerHTML = "";
    return;
  }

  const today = new Date();
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const label = `${days[today.getDay()]} ${today.getDate()}`;

  const b = managerData.dayBriefing || {};
  const salesTarget = b.salesTarget ?? 5000;
  const salesActual = b.salesActual ?? managerData.todaySales ?? 0;
  const wasteTarget = b.wasteTarget ?? 40;
  const wasteActual = b.wasteActual ?? managerData.todayWasteValue ?? 0;
  const notes = b.notes ?? "";

  const staffing = `${managerData.staffOnShift}/${managerData.staffNeeded}`;

  dailyBriefCard.style.display = "block";
  dailyBriefCard.innerHTML = `
    <div class="card-header">
      <div class="card-title">Today’s briefing</div>
      <div class="card-icon">📋</div>
    </div>
    <div class="card-subtext" style="margin-bottom:6px;">
      ${label} · Live snapshot for ${managerData.storeName || "your restaurant"}
    </div>

    <div style="display:flex; flex-wrap:wrap; gap:10px; margin-top:6px;">
      <div class="brief-metric-pill">
        <div class="brief-label">Sales</div>
        <div class="brief-value">£${salesActual} / £${salesTarget}</div>
      </div>
      <div class="brief-metric-pill">
        <div class="brief-label">Waste</div>
        <div class="brief-value">£${wasteActual} / £${wasteTarget}</div>
      </div>
      <div class="brief-metric-pill">
        <div class="brief-label">Staffing</div>
        <div class="brief-value">${staffing}</div>
      </div>
    </div>

    <div style="margin-top:10px;">
      <div class="subsection-sub" style="margin-bottom:4px;">
        Manager notes for this day
      </div>
      <textarea id="dailyBriefNotes" class="brief-notes-textarea"
        placeholder="Notes for today’s shift handover…">${notes}</textarea>
      <button id="dailyBriefSaveBtn" class="brief-save-btn">
        Save notes
      </button>
      <span id="dailyBriefSaved" class="brief-saved-label" style="display:none;">
        ✓ Saved
      </span>
    </div>
  `;

  const notesEl = document.getElementById("dailyBriefNotes");
  const saveBtn = document.getElementById("dailyBriefSaveBtn");
  const savedLabel = document.getElementById("dailyBriefSaved");

  if (saveBtn && notesEl) {
    saveBtn.onclick = async () => {
      const storeId = sessionUser.storeId || "store001";
      const updated = {
        ...(managerData.dayBriefing || {}),
        date: toISODateString(today),
        salesTarget,
        salesActual,
        wasteTarget,
        wasteActual,
        notes: notesEl.value || ""
      };

      managerData.dayBriefing = updated;
      await saveDayBriefingToFirestore(storeId, updated);

      if (savedLabel) {
        savedLabel.style.display = "inline";
        setTimeout(() => {
          savedLabel.style.display = "none";
        }, 1500);
      }
    };
  }
}

/* ============================================================
   CREW EDIT + PROFILE HANDLERS
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
  if (crewProfileStatus) crewProfileStatus.textContent = crew.status;
  if (crewProfileBadge) crewProfileBadge.textContent = crew.badge;
  if (crewProfileAvatar) {
    crewProfileAvatar.textContent = crew.name.charAt(0).toUpperCase();
  }
  if (crewProfileStars) {
    crewProfileStars.textContent = describeStars(crew.stars);
  }

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
  const first = sessionUser.name.split(" ")[0];
  const msg = isCrew
    ? `Hi ${first} 👋 I can help with hours, pay, shifts and training.`
    : `Hi ${first} 👋 I can help with waste, sales and crew info.`;
  addMessage(msg, "bot");
}

/* SEND TO AI BACKEND */

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

    const ctx = {
      role: sessionUser.role,
      userName: sessionUser.name,
      storeId: sessionUser.storeId,
      crewData: isCrew ? profile : undefined,
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

  // small mic button near input
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

  // big mic in overlay = STOP
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

  // ----- WAKE WORD: "HEY AMY" -----

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
