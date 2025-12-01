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
const wakeToggle = document.getElementById("wakeToggle");

/* ---------- AUTH GUARD ---------- */

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    localStorage.removeItem("mc_session_user");
    window.location.href = "index.html";
    return;
  }

  sessionUser = loadSessionUser();

  if (!sessionUser) {
    const fallbackSession = {
      id: user.uid,
      role: "crew",
      name: user.displayName || user.email || "User",
      storeId: "store001"
    };
    sessionUser = fallbackSession;
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
    try {
      await signOut(auth);
    } catch (e) {
      console.error(e);
    } finally {
      localStorage.removeItem("mc_session_user");
      window.location.href = "index.html";
    }
  });
}

/* ---------- FIRESTORE: MANAGER DATA ---------- */

async function loadManagerDataFromFirestore() {
  const storeId = sessionUser.storeId || "store001";

  try {
    const storeRef = doc(db, "stores", storeId);
    const storeSnap = await getDoc(storeRef);

    if (storeSnap.exists()) {
      const data = storeSnap.data();
      managerData.storeName = data.name || managerDataDefault.storeName;
      managerData.todaySales = data.todaySales ?? managerDataDefault.todaySales;
      managerData.weekSales = data.weekSales ?? managerDataDefault.weekSales;
      managerData.todayWasteValue =
        data.todayWasteValue ?? managerDataDefault.todayWasteValue;
      managerData.todayWastePct =
        data.todayWastePct ?? managerDataDefault.todayWastePct;
      managerData.staffOnShift =
        data.staffOnShift ?? managerDataDefault.staffOnShift;
      managerData.staffNeeded =
        data.staffNeeded ?? managerDataDefault.staffNeeded;
      managerData.trainingGaps =
        data.trainingGaps ?? managerDataDefault.trainingGaps;
      managerData.potentialOvertime =
        data.potentialOvertime ?? managerDataDefault.potentialOvertime;
      managerData.foodWasteByDay =
        data.foodWasteByDay ?? managerDataDefault.foodWasteByDay;
    }

    const crewCol = collection(db, "stores", storeId, "crewSummary");
    const crewSnap = await getDocs(crewCol);
    const list = [];
    crewSnap.forEach((docSnap) => {
      const d = docSnap.data();
      list.push({
        id: docSnap.id,
        name: d.name || "Crew member",
        status: d.status || "",
        badge: d.badge || "Crew"
      });
    });

    if (list.length) {
      managerData.crewTrainingSummary = list;
    }
  } catch (e) {
    console.error("Failed to load manager data from Firestore", e);
  }
}

async function updateCrewStatusInFirestore(crewId, newStatus) {
  const storeId = sessionUser.storeId || "store001";
  const ref = doc(db, "stores", storeId, "crewSummary", crewId);
  await updateDoc(ref, { status: newStatus });
}

/* ---------- FIRESTORE: CREW DATA ---------- */

async function loadCrewDataFromFirestore() {
  try {
    const userRef = doc(db, "users", sessionUser.id);
    const snap = await getDoc(userRef);
    if (!snap.exists()) return;

    const data = snap.data();

    crewData.position = data.position || crewData.position;
    crewData.hourlyRate = data.hourlyRate ?? crewData.hourlyRate;
    crewData.hoursThisWeek = data.hoursThisWeek ?? crewData.hoursThisWeek;
    crewData.estimatedPayThisWeek =
      data.estimatedPayThisWeek ??
      crewData.hoursThisWeek * crewData.hourlyRate;

    if (data.nextShift) {
      crewData.nextShift = {
        day: data.nextShift.day || crewData.nextShift.day,
        date: data.nextShift.date || crewData.nextShift.date,
        start: data.nextShift.start || crewData.nextShift.start,
        end: data.nextShift.end || crewData.nextShift.end
      };
    }

    if (Array.isArray(data.certifications)) {
      crewData.certifications = data.certifications;
    }
    if (Array.isArray(data.trainingTodo)) {
      crewData.trainingTodo = data.trainingTodo;
    }
    if (Array.isArray(data.achievements)) {
      crewData.achievements = data.achievements;
    }
    if (Array.isArray(data.schedule)) {
      crewData.schedule = data.schedule;
    }
  } catch (e) {
    console.error("Failed to load crew data from Firestore", e);
  }
}

/* ---------- DASHBOARD RENDER ---------- */

function initialiseDashboard() {
  if (!sessionUser) return;

  const isCrew = sessionUser.role === "crew";
  const profile = isCrew ? crewData : managerData;

  sidebarUserName.textContent = sessionUser.name;
  sidebarUserRole.textContent = isCrew ? "Crew Member" : "Restaurant Manager";
  welcomeTitle.textContent = isCrew
    ? `Welcome back, ${firstName(sessionUser.name)}`
    : `Good shift, ${firstName(sessionUser.name)}`;
  welcomeSubtitle.textContent = isCrew
    ? `Here's a quick view of your hours, pay and training.`
    : `Live snapshot for ${profile.storeName}.`;
  roleBadge.textContent = isCrew ? "Crew" : "Manager";
  avatarCircle.textContent = sessionUser.name
    ? sessionUser.name.charAt(0).toUpperCase()
    : "U";

  aiSubtitle.textContent = isCrew
    ? "Ask about your pay, hours or training."
    : "Ask about waste, sales or crew.";

  renderTopCards(isCrew, profile);
  renderBottomSection(isCrew, profile);
  renderSuggestions(isCrew);
  seedIntroMessages(isCrew);
}

function firstName(full) {
  if (!full) return "there";
  return full.split(" ")[0];
}

function renderTopCards(isCrew, profile) {
  topCards.innerHTML = "";

  if (isCrew) {
    const cards = [
      {
        title: "This Week's Hours",
        icon: "⏱️",
        main: `${profile.hoursThisWeek.toFixed(1)} hrs`,
        sub: `Next shift: ${profile.nextShift.day} ${profile.nextShift.start}–${profile.nextShift.end}`
      },
      {
        title: "Estimated Pay",
        icon: "💷",
        main: `£${profile.estimatedPayThisWeek.toFixed(2)}`,
        sub: `Rate: £${profile.hourlyRate.toFixed(2)}/hr (before tax)`
      },
      {
        title: "Stations",
        icon: "🍔",
        main: profile.certifications.length
          ? profile.certifications.join(", ")
          : "No stations yet",
        sub: profile.trainingTodo.length
          ? `Next up: ${profile.trainingTodo[0]}`
          : "All key training complete"
      },
      {
        title: "Achievements",
        icon: "🏅",
        main: `${profile.achievements.length} badges`,
        sub: profile.achievements[0]
          ? `Latest: ${profile.achievements[0].title} (${profile.achievements[0].date})`
          : "Start collecting achievements"
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
    const gap = profile.staffNeeded - profile.staffOnShift;
    const staffingLabel =
      gap > 0 ? `${gap} short on evening` : "Fully staffed or above plan";

    const cards = [
      {
        title: "Today's Sales",
        icon: "💰",
        main: `£${profile.todaySales.toLocaleString()}`,
        sub: `Week-to-date: £${profile.weekSales.toLocaleString()}`
      },
      {
        title: "Food Waste",
        icon: "♻️",
        main: `£${profile.todayWasteValue.toFixed(0)}`,
        sub: `${profile.todayWastePct.toFixed(1)}% of sales today`
      },
      {
        title: "Staffing",
        icon: "👥",
        main: `${profile.staffOnShift}/${profile.staffNeeded}`,
        sub: staffingLabel
      },
      {
        title: "Training Gaps",
        icon: "📚",
        main: `${profile.trainingGaps} crew`,
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
}

function renderBottomSection(isCrew, profile) {
  if (isCrew) {
    bottomSection.innerHTML = `
      <div class="subsection-title">This Week's Shifts</div>
      <div class="subsection-sub">
        Ask McAssist to help you understand your hours or what you'll roughly earn.
      </div>
      <ul class="list">
        ${profile.schedule
          .map(
            (s) => `
          <li>
            <span>${s.day}</span>
            <span class="badge-soft">${s.time}</span>
          </li>
        `
          )
          .join("")}
      </ul>
      <div style="margin-top:10px;"></div>
      <div class="subsection-title">Training Focus</div>
      <div class="subsection-sub">
        You're currently positioned as <strong>${profile.position}</strong>. Completing these will help you grow.
      </div>
      <ul class="list">
        ${profile.trainingTodo
          .map(
            (t) => `
          <li>
            <span>${t}</span>
            <span class="badge-soft-warn">To do</span>
          </li>
        `
          )
          .join("")}
      </ul>
    `;
  } else {
    bottomSection.innerHTML = `
      <div class="subsection-title">Food Waste - This Week</div>
      <div class="subsection-sub">
        Quick glance of waste value by day. Ask McAssist for a breakdown or targets.
      </div>
      <ul class="list">
        ${profile.foodWasteByDay
          .map(
            (d) => `
          <li>
            <span>${d.day}</span>
            <span class="badge-soft-danger">£${d.value.toFixed(0)}</span>
          </li>
        `
          )
          .join("")}
      </ul>
      <div style="margin-top:10px;"></div>
      <div class="subsection-title">Crew Training & Actions</div>
      <div class="subsection-sub">
        Click "Edit" to update training notes for a crew member. Changes save to Firestore.
      </div>
      <ul class="list" id="crewSummaryList">
        ${profile.crewTrainingSummary
          .map(
            (c) => `
          <li data-id="${c.id}">
            <span>
              <strong>${c.name}</strong><br />
              <span style="font-size:0.75rem;color:#6b7280;">${
                c.status || "No notes yet"
              }</span>
            </span>
            <span class="crew-actions">
              <span class="badge-soft">${c.badge}</span>
              <button class="crew-edit-btn" data-id="${c.id}">Edit</button>
            </span>
          </li>
        `
          )
          .join("")}
      </ul>
    `;

    attachCrewEditHandlers();
  }
}

function attachCrewEditHandlers() {
  const buttons = bottomSection.querySelectorAll(".crew-edit-btn");
  buttons.forEach((btn) => {
    btn.addEventListener("click", async () => {
      const crewId = btn.getAttribute("data-id");
      const crew = managerData.crewTrainingSummary.find((c) => c.id === crewId);
      if (!crew) return;

      const newStatus = window.prompt(
        `Update training status for ${crew.name}:`,
        crew.status || ""
      );
      if (newStatus === null) return;

      try {
        await updateCrewStatusInFirestore(crewId, newStatus);
      } catch (e) {
        console.error("Failed to update Firestore", e);
        alert("Could not save change. Check your connection and try again.");
        return;
      }

      crew.status = newStatus;
      renderBottomSection(false, managerData);
    });
  });
}

/* ---------- McASSIST CHAT ---------- */

function renderSuggestions(isCrew) {
  aiSuggestions.innerHTML = "";
  const crewSuggestions = [
    "How many hours am I working this week?",
    "How much will I earn this week?",
    "What training do I still need?",
    "When is my next shift?"
  ];

  const managerSuggestions = [
    "Show me today's food waste.",
    "How are our sales this week?",
    "Which crew need training?",
    "Who is close to overtime?"
  ];

  const suggestions = isCrew ? crewSuggestions : managerSuggestions;

  suggestions.forEach((text) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "suggestion-chip";
    chip.textContent = text;
    chip.addEventListener("click", () => {
      sendUserMessage(text);
    });
    aiSuggestions.appendChild(chip);
  });
}

function addMessage(text, from) {
  const message = document.createElement("div");
  message.className = "message " + (from === "user" ? "msg-user" : "msg-bot");

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;

  const meta = document.createElement("div");
  meta.className = "msg-meta";
  meta.textContent = from === "user" ? "You" : "McAssist";

  message.appendChild(bubble);
  message.appendChild(meta);
  aiChat.appendChild(message);
  aiChat.scrollTop = aiChat.scrollHeight;
}

/* THINKING INDICATOR */

let thinkingMessageEl = null;

function showThinking() {
  if (thinkingMessageEl) return;

  const message = document.createElement("div");
  message.className = "message msg-bot thinking";

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.innerHTML = `
    Thinking
    <span class="thinking-dots">
      <span class="thinking-dot"></span>
      <span class="thinking-dot"></span>
      <span class="thinking-dot"></span>
    </span>
  `;

  const meta = document.createElement("div");
  meta.className = "msg-meta";
  meta.textContent = "McAssist";

  message.appendChild(bubble);
  message.appendChild(meta);
  aiChat.appendChild(message);
  aiChat.scrollTop = aiChat.scrollHeight;

  thinkingMessageEl = message;
}

function hideThinking() {
  if (thinkingMessageEl && thinkingMessageEl.parentNode) {
    thinkingMessageEl.parentNode.removeChild(thinkingMessageEl);
  }
  thinkingMessageEl = null;
}

function seedIntroMessages(isCrew) {
  aiChat.innerHTML = "";
  const first = isCrew
    ? `Hi ${firstName(
        sessionUser.name
      )} 👋 I'm McAssist. I can help you understand your hours, pay and training.`
    : `Hi ${firstName(
        sessionUser.name
      )} 👋 I'm McAssist. I can answer quick questions about waste, sales and your crew.`;
  const second = isCrew
    ? "You can ask things like “How many hours am I working this week?” or “How much will I earn this week?”"
    : "You can ask things like “Show me today's food waste” or “Which crew still need training?”";

  addMessage(first, "bot");
  addMessage(second, "bot");
}

async function sendUserMessage(text) {
  if (!text.trim()) return;
  const cleaned = text.trim();

  addMessage(cleaned, "user");
  aiInput.value = "";
  aiInput.focus();
  aiSendBtn.disabled = true;
  showThinking();

  try {
    const isCrew = sessionUser.role === "crew";
    const profile = isCrew ? crewData : managerData;

    const contextData = {
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
        message: cleaned,
        user: sessionUser,
        contextData
      })
    });

    if (!res.ok) {
      console.error("McAssist HTTP error:", res.status);
      hideThinking();
      addMessage(
        "Sorry, I couldn't reach the McAssist service. Please try again in a moment.",
        "bot"
      );
      return;
    }

    const data = await res.json();
    const reply = data.reply || "Sorry, I couldn't generate a response.";
    hideThinking();
    addMessage(reply, "bot");
  } catch (err) {
    console.error("McAssist error:", err);
    hideThinking();
    addMessage(
      "Something went wrong talking to the AI. Please try again.",
      "bot"
    );
  } finally {
    aiSendBtn.disabled = false;
  }
}

aiForm.addEventListener("submit", (e) => {
  e.preventDefault();
  sendUserMessage(aiInput.value);
});

/* ---------- SIDEBAR MOBILE TOGGLE ---------- */

const sidebar = document.querySelector(".sidebar");
const sidebarToggle = document.getElementById("sidebarToggle");

if (sidebar && sidebarToggle) {
  sidebarToggle.addEventListener("click", () => {
    sidebar.classList.toggle("sidebar-open");
  });
}

/* ========= VOICE INPUT + WAKE WORD ========= */

let recognition = null;
let listening = false;

let wakeRecognition = null;
let wakeEnabled = false;
let wakeRunning = false;

const HEY_AMY_VARIANTS = [
  "hey amy",
  "hey ami",
  "hey amie",
  "hey emi",
  "hey ammy",
  "hi amy",
  "ok amy",
  "okay amy"
];

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
  } catch {
    // ignore
  }
}

if (micBtn && overlay && hasSpeechSupport()) {
  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;

  recognition = new SpeechRecognition();
  recognition.lang = navigator.language || "en-US";
  recognition.continuous = false;
  recognition.interimResults = false;

  function startQueryRecognition() {
    try {
      overlay.classList.add("active");
      listening = true;
      beep(1000, 70, 0.12);
      recognition.start();
    } catch (err) {
      listening = false;
      overlay.classList.remove("active");
      console.error("Error starting recognition:", err);
      alert(
        "I couldn't start the microphone. Make sure you've allowed mic access in your browser."
      );
    }
  }

  micBtn.addEventListener("click", () => {
    if (listening) {
      recognition.stop();
      return;
    }
    startQueryRecognition();
  });

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    aiInput.value = transcript;
    sendUserMessage(transcript);
    overlay.classList.remove("active");
  };

  recognition.onerror = (event) => {
    console.error("Speech recognition error:", event.error);
    listening = false;
    overlay.classList.remove("active");

    if (event.error === "not-allowed" || event.error === "denied") {
      alert(
        "Microphone access is blocked. Please allow mic access in your browser settings for this site."
      );
    } else if (event.error === "no-speech") {
      alert("I didn't hear anything. Try speaking again.");
    }
  };

  recognition.onend = () => {
    listening = false;
    overlay.classList.remove("active");

    if (wakeEnabled && !document.hidden && !wakeRunning) {
      setTimeout(startWakeListener, 350);
    }
  };

  function startWakeListener() {
    if (wakeRunning || !wakeEnabled) return;

    wakeRecognition = new SpeechRecognition();
    wakeRecognition.lang = navigator.language || "en-US";
    wakeRecognition.continuous = true;
    wakeRecognition.interimResults = true;

    wakeRecognition.onstart = () => {
      wakeRunning = true;
    };

    wakeRecognition.onend = () => {
      wakeRunning = false;
      if (wakeEnabled && !document.hidden) {
        setTimeout(startWakeListener, 250);
      }
    };

    wakeRecognition.onerror = (e) => {
      console.warn("Wake word error:", e.error);
      wakeRunning = false;
      if (
        wakeEnabled &&
        !document.hidden &&
        !["not-allowed", "service-not-allowed"].includes(e.error)
      ) {
        setTimeout(startWakeListener, 600);
      }
    };

    wakeRecognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        const transcript = res[0].transcript.toLowerCase().trim();
        const hit = HEY_AMY_VARIANTS.some((kw) =>
          transcript.includes(kw)
        );
        if (hit && res[0].confidence >= 0.55) {
          try {
            wakeRecognition.stop();
          } catch {}
          wakeRunning = false;
          startQueryRecognition();
          break;
        }
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

  document.addEventListener("visibilitychange", () => {
    if (!wakeEnabled) return;
    if (document.hidden) {
      stopWakeListener();
    } else {
      startWakeListener();
    }
  });

  if (wakeToggle) {
    wakeToggle.disabled = false;

    wakeToggle.addEventListener("change", () => {
      if (!hasSpeechSupport()) return;

      if (wakeToggle.checked) {
        wakeEnabled = true;
        beep(1000, 60, 0.1);
        startWakeListener();
      } else {
        wakeEnabled = false;
        stopWakeListener();
      }
    });
  }
} else {
  if (micBtn) micBtn.style.display = "none";
  if (wakeToggle) {
    wakeToggle.disabled = true;
    wakeToggle.title =
      "Wake word not supported in this browser. Try Chrome/Edge over HTTPS.";
  }
}
