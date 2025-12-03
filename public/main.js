// main.js
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

/* ---------- DEFAULT CREW DATA (fallback) ---------- */
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

/* ---------- DEFAULT MANAGER DATA (fallback) ---------- */
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
      badge: "Needs training"
    },
    {
      id: "maria",
      name: "Maria Lopez",
      status: "All stations certified",
      badge: "Star performer"
    },
    {
      id: "james",
      name: "James Lee",
      status: "Food Safety expires soon",
      badge: "Action needed"
    }
  ]
};

let managerData = JSON.parse(JSON.stringify(managerDataDefault));

/* ---------- SESSION + DOM ---------- */

let sessionUser = null;

function loadSessionUser() {
  try {
    const raw = localStorage.getItem("mc_session_user");
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
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

// voice + wake
const micBtn = document.getElementById("aiMicBtn");
const overlay = document.getElementById("voiceOverlay");
const overlayText = document.getElementById("overlayText"); // NEW
const wakeToggle = document.getElementById("wakeToggle");

/* ---------- SMALL HELPERS ---------- */

function hasSpeechSupport() {
  return (
    "SpeechRecognition" in window ||
    "webkitSpeechRecognition" in window
  );
}

function beep(f = 880, ms = 90, v = 0.08) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = f;
    g.gain.value = v;
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    setTimeout(() => {
      o.stop();
      ctx.close();
    }, ms);
  } catch {}
}

/* ---------- AUTH ---------- */

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

  if (sessionUser.role === "manager") {
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

/* ---------- Firestore Loader Functions ---------- */

async function loadManagerDataFromFirestore() {
  const storeId = sessionUser.storeId || "store001";
  try {
    const storeRef = doc(db, "stores", storeId);
    const storeSnap = await getDoc(storeRef);
    if (storeSnap.exists()) {
      const d = storeSnap.data();
      Object.assign(managerData, d);
    }
    const crewCol = collection(db, "stores", storeId, "crewSummary");
    const crewSnap = await getDocs(crewCol);
    let list = [];
    crewSnap.forEach((snap) => {
      const d = snap.data();
      list.push({
        id: snap.id,
        name: d.name,
        status: d.status,
        badge: d.badge
      });
    });
    if (list.length) managerData.crewTrainingSummary = list;
  } catch (e) {
    console.error("Error loading manager data:", e);
  }
}

async function updateCrewStatusInFirestore(crewId, newStatus) {
  const storeId = sessionUser.storeId || "store001";
  const ref = doc(db, "stores", storeId, "crewSummary", crewId);
  await updateDoc(ref, { status: newStatus });
}

async function loadCrewDataFromFirestore() {
  try {
    const uRef = doc(db, "users", sessionUser.id);
    const snap = await getDoc(uRef);
    if (snap.exists()) {
      Object.assign(crewData, snap.data());
    }
  } catch (e) {
    console.error(e);
  }
}

/* ---------- Dashboard Rendering ---------- */

function initialiseDashboard() {
  if (!sessionUser) return;

  const isCrew = sessionUser.role === "crew";
  const profile = isCrew ? crewData : managerData;

  sidebarUserName.textContent = sessionUser.name;
  sidebarUserRole.textContent = isCrew ? "Crew Member" : "Restaurant Manager";
  roleBadge.textContent = isCrew ? "Crew" : "Manager";
  avatarCircle.textContent = sessionUser.name.charAt(0).toUpperCase();
  welcomeTitle.textContent = isCrew
    ? `Welcome back, ${sessionUser.name.split(" ")[0]}`
    : `Good shift, ${sessionUser.name.split(" ")[0]}`;
  welcomeSubtitle.textContent = isCrew
    ? "Here’s your week at a glance."
    : `Live snapshot for ${profile.storeName}.`;
  aiSubtitle.textContent = isCrew
    ? "Ask about your hours, pay, shifts, or training."
    : "Ask about waste, crew, or sales.";

  renderTopCards(isCrew, profile);
  renderBottomSection(isCrew, profile);
  renderSuggestions(isCrew);
  seedIntroMessages(isCrew);
}

function renderTopCards(isCrew, profile) {
  topCards.innerHTML = "";
  if (isCrew) {
    const cards = [
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
    ];
    cards.forEach((c) => addCard(c));
  } else {
    const cards = [
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
    cards.forEach((c) => addCard(c));
  }

  function addCard(item) {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div class="card-header">
        <div class="card-title">${item.title}</div>
        <div class="card-icon">${item.icon}</div>
      </div>
      <div class="card-main-value">${item.main}</div>
      <div class="card-subtext">${item.sub}</div>
    `;
    topCards.appendChild(card);
  }
}

function renderBottomSection(isCrew, profile) {
  if (isCrew) {
    bottomSection.innerHTML = `
      <div class="subsection-title">Weekly Schedule</div>
      <ul class="list">
        ${profile.schedule
          .map(
            (s) => `
          <li>
            <span>${s.day}</span>
            <span class="badge-soft">${s.time}</span>
          </li>`
          )
          .join("")}
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
      <div class="subsection-title" style="margin-top:15px;">Crew Training & Actions</div>
      <ul class="list">
        ${profile.crewTrainingSummary
          .map(
            (c) => `
          <li data-id="${c.id}">
            <span><strong>${c.name}</strong><br><small>${c.status}</small></span>
            <span class="crew-actions">
              <span class="badge-soft">${c.badge}</span>
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

function attachCrewEditHandlers() {
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

      await updateCrewStatusInFirestore(id, newStatus);
      crew.status = newStatus;
      renderBottomSection(false, managerData);
    });
  });
}

/* ---------- McAssist Chat ---------- */

function renderSuggestions(isCrew) {
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
  thinkingMessageEl = el;
}

function hideThinking() {
  if (thinkingMessageEl) thinkingMessageEl.remove();
  thinkingMessageEl = null;
}

function seedIntroMessages(isCrew) {
  aiChat.innerHTML = "";
  const first = isCrew
    ? `Hi ${sessionUser.name.split(" ")[0]} 👋 I can help with hours, pay, shifts and training.`
    : `Hi ${sessionUser.name.split(" ")[0]} 👋 I can help with waste, sales and crew info.`;

  addMessage(first, "bot");
}

/* ---------- Send to AI Backend ---------- */

async function sendUserMessage(text) {
  if (!text.trim()) return;
  addMessage(text.trim(), "user");
  aiInput.value = "";
  aiSendBtn.disabled = true;

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
      body: JSON.stringify({ message: text, user: sessionUser, contextData: ctx })
    });

    const data = await res.json();
    hideThinking();
    addMessage(data.reply || "I couldn't answer that.", "bot");
  } catch (e) {
    hideThinking();
    addMessage("Something went wrong talking to me.", "bot");
  }

  aiSendBtn.disabled = false;
}

aiForm.addEventListener("submit", (e) => {
  e.preventDefault();
  sendUserMessage(aiInput.value);
});

/* ---------- SIDEBAR MOBILE ---------- */

const sidebar = document.querySelector(".sidebar");
const sidebarToggle = document.getElementById("sidebarToggle");

if (sidebarToggle) {
  sidebarToggle.addEventListener("click", () => {
    sidebar.classList.toggle("sidebar-open");
  });
}

/* ============================================================
   VOICE INPUT (CLICK MIC) + WAKE WORD “HEY AMY”
   ============================================================ */

let recognition = null;
let listening = false;

// Setup main recognizer
if (micBtn && overlay && hasSpeechSupport()) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

  recognition = new SR();
  recognition.lang = "en-US";
  recognition.continuous = false;
  recognition.interimResults = false;

  function startFullListening() {
    try {
      overlayText.textContent = "Listening…";
      beep(1000, 70, 0.12);
      listening = true;
      recognition.start();
    } catch (err) {
      listening = false;
      overlay.classList.remove("active");
      overlayText.textContent = "";
      console.error("Microphone error:", err);
      alert("Couldn't start microphone. Allow mic access.");
    }
  }

  micBtn.onclick = () => {
    if (listening) {
      recognition.stop();
    } else {
      overlay.classList.add("active");
      overlayText.textContent = "Ask me anything";
      setTimeout(startFullListening, 600);
    }
  };

  // ----- FIXED onresult: stop immediately after user finishes speaking -----
recognition.onresult = (e) => {
  const transcript = e.results[0][0].transcript;
  console.log("[Voice] Final transcript:", transcript);

  // force stop mic immediately
  try { recognition.stop(); } catch {}

  // close UI
  overlay.classList.remove("active");
  overlayText.textContent = "";
  listening = false;

  aiInput.value = transcript;
  sendUserMessage(transcript);
};

// ----- SAFETY TIMEOUT: close listening even if Chrome gets stuck -----
let voiceTimeout = null;

recognition.onstart = () => {
  listening = true;
  console.log("[Voice] Started listening");

  // reset timeout
  if (voiceTimeout) clearTimeout(voiceTimeout);

  // fallback auto-stop (5 seconds)
  voiceTimeout = setTimeout(() => {
    console.log("[Voice] Timeout triggered — forcing stop");
    try { recognition.stop(); } catch {}
  }, 5000);
};


  recognition.onerror = (e) => {
    listening = false;
    overlay.classList.remove("active");
    overlayText.textContent = "";
    if (e.error === "not-allowed" || e.error === "denied") {
      alert("Microphone permission blocked.");
    }
  };

recognition.onend = () => {
  console.log("[Voice] onend fired");
  listening = false;

  // close overlay only if still open
  overlay.classList.remove("active");
  overlayText.textContent = "";

  // cancel timeout
  if (voiceTimeout) clearTimeout(voiceTimeout);

  // restart wake listener if enabled
  if (wakeEnabled && !document.hidden && !wakeRunning) {
    setTimeout(startWakeListener, 400);
  }
};


  /* ========= WAKE WORD “HEY AMY” (continuous) ========= */

  let wakeRecognition = null;
  let wakeEnabled = false;
  let wakeRunning = false;

  const HEY_AMY_VARIANTS = [
    "hey amy",
    "hey ami",
    "hey amie",
    "hey emmy",
    "hey ammy",
    "okay amy",
    "ok amy"
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
        alert("Mic permission blocked for wake word.");
        wakeEnabled = false;
        if (wakeToggle) wakeToggle.checked = false;
        return;
      }

      if (e.error === "no-speech") {
        // ignore
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

        console.log("[Wake] heard:", transcript, "conf:", res[0].confidence);

        const hit = HEY_AMY_VARIANTS.some((kw) =>
          transcript.includes(kw)
        );

        if (hit && res[0].confidence >= 0.25) {
          console.log("[Wake] Trigger detected!");

          try {
            wakeRecognition.stop();
          } catch {}

          wakeRunning = false;

          overlay.classList.add("active");
          overlayText.textContent = "Ask me anything";

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
    if (document.hidden) stopWakeListener();
    else startWakeListener();
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
        stopWakeListener();
        console.log("[Wake] Disabled");
      }
    });
  }
} else {
  if (micBtn) micBtn.style.display = "none";
  if (wakeToggle) wakeToggle.disabled = true;
}
