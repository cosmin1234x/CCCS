// main.js – Dashboard + McAssist + Voice + Roles (crew / manager / shiftCreator)

import { auth, db } from "./firebase-init.js";
import {
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  doc,
  getDoc,
  collection,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

/* ========= DOM ELEMENTS ========= */

// Sidebar / header
const sidebarUserName = document.getElementById("sidebarUserName");
const sidebarUserRole = document.getElementById("sidebarUserRole");
const avatarCircle = document.getElementById("avatarCircle");
const roleBadge = document.getElementById("roleBadge");
const logoutBtn = document.getElementById("logoutBtn");
const sidebar = document.querySelector(".sidebar");
const sidebarToggle = document.getElementById("sidebarToggle");

// Dashboard content
const welcomeTitle = document.getElementById("welcomeTitle");
const welcomeSubtitle = document.getElementById("welcomeSubtitle");
const topCards = document.getElementById("topCards");
const bottomSection = document.getElementById("bottomSection");

// McAssist panel
const aiChat = document.getElementById("aiChat");
const aiSuggestions = document.getElementById("aiSuggestions");
const aiForm = document.getElementById("aiForm");
const aiInput = document.getElementById("aiInput");
const aiSendBtn = document.getElementById("aiSendBtn");
const aiSubtitle = document.getElementById("aiSubtitle");
const aiMicBtn = document.getElementById("aiMicBtn");
const wakeToggle = document.getElementById("wakeToggle");

// Voice overlay
const voiceOverlay = document.getElementById("voiceOverlay");
const overlayText = document.getElementById("overlayText");
const overlayMic = document.getElementById("overlayMic");

/* ========= SESSION STATE ========= */

let sessionUser = null; // {id, role, name, storeId}
let storeDoc = null;    // store-level metrics
let crewSummary = [];   // [{id, name, trainingStatus, mcStars, ...}]
let mcassistBusy = false;
let mcassistInitialShown = false;

function loadSessionUser() {
  try {
    return JSON.parse(localStorage.getItem("mc_session_user"));
  } catch {
    return null;
  }
}

/* ========= FIRESTORE HELPERS ========= */

async function loadUserProfile(uid) {
  try {
    const userRef = doc(db, "users", uid);
    const snap = await getDoc(userRef);
    if (snap.exists()) {
      return snap.data();
    }
  } catch (err) {
    console.error("[main] loadUserProfile error:", err);
  }
  return null;
}

async function loadStore(storeId) {
  try {
    const storeRef = doc(db, "stores", storeId);
    const snap = await getDoc(storeRef);
    if (snap.exists()) {
      return snap.data();
    }
  } catch (err) {
    console.error("[main] loadStore error:", err);
  }
  return null;
}

async function loadCrewSummary(storeId) {
  const result = [];
  try {
    const colRef = collection(db, "stores", storeId, "crewSummary");
    const snap = await getDocs(colRef);
    snap.forEach((docSnap) => {
      const d = docSnap.data();
      result.push({
        id: docSnap.id,
        name: d.name || "Crew",
        trainingStatus: d.trainingStatus || "OK",
        notes: d.notes || "",
        mcStars: typeof d.mcStars === "number" ? d.mcStars : 0,
        primaryStation: d.primaryStation || "",
        versatility: d.versatility || 0
      });
    });
  } catch (err) {
    console.error("[main] loadCrewSummary error:", err);
  }
  return result;
}

/* ========= DASHBOARD RENDERING ========= */

function renderShell() {
  if (!sessionUser) return;

  const role = sessionUser.role;
  const isManagerLike = role === "manager" || role === "shiftCreator";

  // Sidebar labels
  if (sidebarUserName) sidebarUserName.textContent = sessionUser.name;
  if (sidebarUserRole) {
    sidebarUserRole.textContent =
      role === "shiftCreator"
        ? "Shift Creator"
        : role === "manager"
        ? "Restaurant Manager"
        : "Crew Member";
  }

  if (roleBadge) {
    roleBadge.textContent =
      role === "shiftCreator" ? "Shift Creator" :
      role === "manager"      ? "Manager" :
                                "Crew";
  }

  if (avatarCircle) {
    avatarCircle.textContent = sessionUser.name.charAt(0).toUpperCase();
  }

  // Welcome copy
  if (welcomeTitle) {
    welcomeTitle.textContent = isManagerLike
      ? `Good shift, ${sessionUser.name.split(" ")[0] || "Manager"}`
      : `Hi ${sessionUser.name.split(" ")[0] || "there"}`;
  }

  if (welcomeSubtitle) {
    welcomeSubtitle.textContent = isManagerLike
      ? "Live snapshot for your restaurant."
      : "Your hours, training and McStars in one place.";
  }

  if (aiSubtitle) {
    aiSubtitle.textContent = isManagerLike
      ? "Ask about waste, sales, crew or training."
      : "Ask about your hours, pay, training or McStars.";
  }
}

function formatMoney(val) {
  if (val == null || isNaN(val)) return "£0";
  const num = Number(val);
  return "£" + num.toLocaleString("en-GB", { maximumFractionDigits: 0 });
}

function renderTopCards() {
  if (!topCards) return;
  topCards.innerHTML = "";

  const role = sessionUser.role;
  const isManagerLike = role === "manager" || role === "shiftCreator";

  if (isManagerLike) {
    const sales = storeDoc?.todaySales || 0;
    const waste = storeDoc?.foodWaste || storeDoc?.foodwaste || 0;
    const staffOnShift = storeDoc?.staffOnShift || 0;
    const staffTarget = storeDoc?.staffTarget || 10;

    topCards.innerHTML = `
      <article class="card">
        <div class="card-header">
          <div class="card-title">Today's sales</div>
          <div class="card-icon">💷</div>
        </div>
        <div class="card-main-value">${formatMoney(sales)}</div>
        <div class="card-subtext">Week-to-date: £${(storeDoc?.weekToDateSales || 0).toLocaleString(
          "en-GB"
        )}</div>
      </article>

      <article class="card">
        <div class="card-header">
          <div class="card-title">Food waste</div>
          <div class="card-icon">♻️</div>
        </div>
        <div class="card-main-value">${formatMoney(waste)}</div>
        <div class="card-subtext">${
          storeDoc?.wastePercent != null
            ? `${storeDoc.wastePercent}% of sales today`
            : "Ask McAssist for a breakdown by day."
        }</div>
      </article>

      <article class="card">
        <div class="card-header">
          <div class="card-title">Staffing</div>
          <div class="card-icon">👥</div>
        </div>
        <div class="card-main-value">${staffOnShift}/${staffTarget}</div>
        <div class="card-subtext">${
          storeDoc?.staffNote || "Tap Shifts to see full schedule."
        }</div>
      </article>

      <article class="card">
        <div class="card-header">
          <div class="card-title">Training health</div>
          <div class="card-icon">🎓</div>
        </div>
        <div class="card-main-value">
          ${storeDoc?.trainingCompletionPercent ?? 0}%
        </div>
        <div class="card-subtext">
          ${storeDoc?.trainingOverdueCount ?? 0} overdue ·
          ${storeDoc?.trainingRecertCount ?? 0} need recert.
        </div>
      </article>
    `;
  } else {
    // Crew / normal view – personal metrics (using user doc if available)
    const hours = sessionUser.hoursThisWeek || 0;
    const payRate = sessionUser.hourlyRate || 0;
    const estPay = hours * payRate;
    const mcStars = sessionUser.mcStars || 0;

    topCards.innerHTML = `
      <article class="card">
        <div class="card-header">
          <div class="card-title">Hours this week</div>
          <div class="card-icon">⏰</div>
        </div>
        <div class="card-main-value">${hours.toFixed(1)} hrs</div>
        <div class="card-subtext">Based on posted rota.</div>
      </article>

      <article class="card">
        <div class="card-header">
          <div class="card-title">Estimated pay</div>
          <div class="card-icon">💵</div>
        </div>
        <div class="card-main-value">${formatMoney(estPay)}</div>
        <div class="card-subtext">Rate: £${payRate.toFixed(2)} / hour</div>
      </article>

      <article class="card">
        <div class="card-header">
          <div class="card-title">Training</div>
          <div class="card-icon">🎓</div>
        </div>
        <div class="card-main-value">${
          sessionUser.trainingCompletedPercent ?? 0
        }%</div>
        <div class="card-subtext">View details on the Training tab.</div>
      </article>

      <article class="card">
        <div class="card-header">
          <div class="card-title">McStars</div>
          <div class="card-icon">⭐</div>
        </div>
        <div class="card-main-value">${mcStars}</div>
        <div class="card-subtext">Earn more by completing modules & shifts.</div>
      </article>
    `;
  }
}

function renderBottomSection() {
  if (!bottomSection) return;
  bottomSection.innerHTML = "";

  const role = sessionUser.role;
  const isManagerLike = role === "manager" || role === "shiftCreator";

  if (isManagerLike) {
    const overdue = storeDoc?.trainingOverdueCount ?? 0;
    const needsRecert = storeDoc?.trainingRecertCount ?? 0;
    const highVers = storeDoc?.trainingHighVersatilityCrewCount ?? 0;

    const crewRows = crewSummary
      .map((c) => {
        const stars = c.mcStars || 0;

        // Decide McStar tier
        let tierLabel = "No McStars yet";
        let tierClass = "mcstar-pill--none";

        if (stars >= 10) {
          tierLabel = "Gold McStar";
          tierClass = "mcstar-pill--gold";
        } else if (stars >= 5) {
          tierLabel = "Silver McStar";
          tierClass = "mcstar-pill--silver";
        } else if (stars >= 1) {
          tierLabel = "Bronze McStar";
          tierClass = "mcstar-pill--bronze";
        }

        // Training status chip text
        let trainingLabel = "all training completed";
        let trainingClass = "training-chip--ok";

        const status = (c.trainingStatus || "OK").toLowerCase();
        if (status.includes("overdue")) {
          trainingLabel = "training overdue";
          trainingClass = "training-chip--overdue";
        } else if (status.includes("recert")) {
          trainingLabel = "recertification needed";
          trainingClass = "training-chip--recert";
        }

        return `
          <li class="crew-row" data-crew-id="${c.id}">
            <div class="crew-row-main">
              <div class="crew-row-name">${c.name}</div>
              <div class="crew-row-sub">
                ${c.primaryStation || "All stations"}
                ${
                  c.versatility
                    ? ` · ${c.versatility}+ stations`
                    : ""
                }
              </div>
            </div>

            <div class="crew-row-actions">
              <button type="button"
                      class="mcstar-pill ${tierClass}"
                      data-crew-id="${c.id}">
                <span>⭐</span>
                <span>${tierLabel}</span>
              </button>

              <button type="button"
                      class="training-chip ${trainingClass}"
                      data-crew-id="${c.id}">
                ${trainingLabel}
              </button>

              <button type="button"
                      class="crew-row-btn"
                      data-crew-id="${c.id}">
                Profile
              </button>
              <button type="button"
                      class="crew-row-btn crew-row-btn--outline"
                      data-crew-id="${c.id}">
                Edit
              </button>
            </div>
          </li>
        `;
      })
      .join("");

    bottomSection.innerHTML = `
      <div class="subsection-title">Crew Training & McStars</div>
      <div class="subsection-sub">
        Quick overview of who needs training and who can flex to more stations.
      </div>

      <ul class="list crew-list">
        ${
          crewRows ||
          "<li><span>No crew profiles yet. Add some in Firestore.</span></li>"
        }
      </ul>

      <div class="crew-summary-footer">
        <span class="badge-soft-warn">
          ${overdue} crew with overdue modules
        </span>
        <span class="badge-soft">
          ${highVers} high versatility crew
        </span>
        <span class="badge-soft-danger">
          ${needsRecert} need recertification
        </span>
      </div>
    `;

    attachCrewRowHandlers();   // <-- hook up buttons
  } else {
    // Crew view – personal card
    bottomSection.innerHTML = `
      <div class="subsection-title">Your training & McStars</div>
      <div class="subsection-sub">
        See which stations you’re signed off on and what to do next.
      </div>
      <p style="font-size:0.8rem; color:#4b5563; margin-bottom:8px;">
        Use the Training tab for full details. When you complete a module or get signed off on a new station,
        your McStars and profile update here automatically.
      </p>
      <button class="btn" type="button" onclick="window.location.href='training.html'">
        <span>🎓</span>
        <span>Open training</span>
      </button>
    `;
  }
}


function attachCrewRowHandlers() {
  if (!bottomSection) return;

  const rows = bottomSection.querySelectorAll(".crew-row");
  rows.forEach((row) => {
    const crewId = row.dataset.crewId;
    const crew = crewSummary.find((c) => c.id === crewId);
    if (!crew) return;

    const buttons = row.querySelectorAll(".crew-row-btn");

    buttons.forEach((btn) => {
      const isEdit = btn.classList.contains("crew-row-btn--outline");

      if (isEdit) {
        // EDIT – for demo, just a nice message
        btn.addEventListener("click", () => {
          alert(
            `Edit training for ${crew.name}\n\n` +
            `For now, update this in Firestore (stores/${sessionUser.storeId}/crewSummary).`
          );
        });
      } else {
        // PROFILE – show a quick profile popup
        btn.addEventListener("click", () => {
          const text =
            `${crew.name}\n\n` +
            `Primary station: ${crew.primaryStation || "All stations"}\n` +
            `Versatility: ${crew.versatility || 0}+ stations\n` +
            `McStars: ${crew.mcStars || 0}\n` +
            `Training status: ${crew.trainingStatus || "OK"}\n\n` +
            `Notes: ${crew.notes || "—"}`;
          alert(text);
        });
      }
    });
  });
}



/* ========= MCASSIST CHAT ========= */

const mcassistEndpoint = "/.netlify/functions/mcassist"; // adjust if needed

function addMessage(role, text, options = {}) {
  if (!aiChat) return;
  const wrapper = document.createElement("div");
  wrapper.className = `message ${role === "user" ? "msg-user" : "msg-bot"}`;
  wrapper.dataset.role = role;
  if (options.id) wrapper.dataset.id = options.id;

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.innerHTML = text;

  wrapper.appendChild(bubble);

  if (options.meta) {
    const meta = document.createElement("div");
    meta.className = "msg-meta";
    meta.textContent = options.meta;
    wrapper.appendChild(meta);
  }

  aiChat.appendChild(wrapper);
  aiChat.scrollTop = aiChat.scrollHeight;

  return wrapper;
}

function addThinkingMessage() {
  const id = "thinking-" + Date.now();
  const dots = `
    <span class="thinking-dot"></span>
    <span class="thinking-dot"></span>
    <span class="thinking-dot"></span>
  `;
  const el = addMessage("assistant", dots, { id });
  if (el) el.classList.add("thinking");
  return id;
}

function replaceThinkingMessage(id, newText) {
  if (!aiChat) return;
  const node = aiChat.querySelector(`[data-id="${id}"]`);
  if (!node) return;
  node.classList.remove("thinking");
  const bubble = node.querySelector(".bubble");
  if (bubble) bubble.innerHTML = newText;
}

function renderSuggestions() {
  if (!aiSuggestions) return;
  const role = sessionUser?.role || "crew";
  const isManagerLike = role === "manager" || role === "shiftCreator";

  const managerChips = [
    "Show me today's food waste.",
    "Which crew need training?",
    "How are our sales this week?",
    "Who is close to overtime?"
  ];

  const crewChips = [
    "How many hours am I on this week?",
    "What’s my estimated pay?",
    "Which training should I do next?",
    "How do I earn more McStars?"
  ];

  const chips = isManagerLike ? managerChips : crewChips;

  aiSuggestions.innerHTML = chips
    .map(
      (txt) => `
      <button class="suggestion-chip" data-question="${txt}">
        ${txt}
      </button>
    `
    )
    .join("");

  aiSuggestions.addEventListener("click", (e) => {
    const btn = e.target.closest(".suggestion-chip");
    if (!btn) return;
    const q = btn.dataset.question;
    if (q) {
      aiInput.value = q;
      aiInput.focus();
    }
  });
}

async function sendUserMessage(text) {
  if (!text || mcassistBusy) return;
  mcassistBusy = true;

  const nowStr = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  addMessage("user", text, { meta: nowStr });

  const thinkingId = addThinkingMessage();

  try {
    aiSendBtn.disabled = true;

    const payload = {
      message: text,
      userRole: sessionUser?.role || "crew",
      userName: sessionUser?.name || "",
      storeId: sessionUser?.storeId || "store001"
    };

    const res = await fetch(mcassistEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      console.error("McAssist HTTP error:", res.status);
      replaceThinkingMessage(
        thinkingId,
        "Sorry, I couldn’t reach my brain (server). Try again in a moment."
      );
      return;
    }

    const data = await res.json();
    const reply = data.reply || "All good. (No detailed answer was returned.)";

    replaceThinkingMessage(thinkingId, reply);
  } catch (err) {
    console.error("[McAssist] error:", err);
    replaceThinkingMessage(
      thinkingId,
      "Oops, something went wrong. Please try again."
    );
  } finally {
    mcassistBusy = false;
    aiSendBtn.disabled = false;
    aiInput.value = "";
    aiInput.focus();
  }
}

/* ========= AI FORM HANDLERS ========= */

if (aiForm) {
  aiForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = aiInput.value.trim();
    if (!text) return;
    sendUserMessage(text);
  });
}

/* ========= VOICE MODE + WAKE WORD ========= */

const SpeechRecognition =
  window.SpeechRecognition || window.webkitSpeechRecognition || null;

let wakeRecognition = null;
let wakeRunning = false;

let queryRecognition = null;
let queryRunning = false;
let lastQueryTranscript = "";

// Start / stop voice overlay
function openVoiceOverlay(promptText = "Ask me anything") {
  if (!voiceOverlay) return;
  overlayText.textContent = promptText;
  voiceOverlay.classList.add("open");
}

function closeVoiceOverlay() {
  if (!voiceOverlay) return;
  voiceOverlay.classList.remove("open");
}

// Start recognition to capture the question
function startQueryRecognition() {
  if (!SpeechRecognition) {
    alert("Voice recognition is not supported in this browser.");
    return;
  }
  if (queryRunning) return;

  queryRecognition = new SpeechRecognition();
  queryRecognition.lang = "en-GB";
  queryRecognition.interimResults = true;
  queryRecognition.continuous = false;

  lastQueryTranscript = "";
  queryRunning = true;
  openVoiceOverlay("Listening… ask your question");

  queryRecognition.onresult = (event) => {
    let full = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      full += event.results[i][0].transcript + " ";
    }
    full = full.trim();
    overlayText.textContent = full || "Listening…";
    lastQueryTranscript = full;
  };

  queryRecognition.onerror = (event) => {
    console.warn("[Voice] query error:", event.error);
  };

  queryRecognition.onend = () => {
    queryRunning = false;
    closeVoiceOverlay();

    const text = (lastQueryTranscript || "").trim();
    if (text) {
      aiInput.value = text;
      sendUserMessage(text);
    }
  };

  try {
    queryRecognition.start();
  } catch (err) {
    console.error("[Voice] start query error:", err);
    queryRunning = false;
    closeVoiceOverlay();
  }
}

// Wake-word continuous recognition
function startWakeRecognition() {
  if (!SpeechRecognition) return;
  if (wakeRunning) return;

  wakeRecognition = new SpeechRecognition();
  wakeRecognition.lang = "en-GB";
  wakeRecognition.interimResults = false;
  wakeRecognition.continuous = true;

  const HEY_AMY_VARIANTS = ["hey amy", "hey emmy", "hey ami", "hey army"];

  wakeRecognition.onresult = (event) => {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const res = event.results[i];
      const transcript = res[0].transcript.toLowerCase().trim();
      const hit = HEY_AMY_VARIANTS.some((kw) => transcript.includes(kw));
      if (hit && res[0].confidence >= 0.5) {
        try {
          wakeRecognition.stop();
        } catch {}
        wakeRunning = false;
        startQueryRecognition();
        break;
      }
    }
  };

  wakeRecognition.onerror = (event) => {
    console.warn("[Wake] error:", event.error);
    // Common "no-speech" error, just restart after a small delay
    if (event.error === "no-speech" || event.error === "network") {
      setTimeout(() => {
        if (wakeToggle?.checked) startWakeRecognition();
      }, 700);
    }
  };

  wakeRecognition.onend = () => {
    wakeRunning = false;
    if (wakeToggle?.checked && !queryRunning) {
      // restart loop
      setTimeout(() => startWakeRecognition(), 400);
    }
  };

  try {
    wakeRecognition.start();
    wakeRunning = true;
    console.log("[Wake] listening for 'Hey Amy'");
  } catch (err) {
    console.error("[Wake] start error:", err);
  }
}

function stopWakeRecognition() {
  if (wakeRecognition && wakeRunning) {
    try {
      wakeRecognition.stop();
    } catch {}
  }
  wakeRunning = false;
}

/* Small mic button */
if (aiMicBtn) {
  aiMicBtn.addEventListener("click", () => {
    if (!SpeechRecognition) {
      alert("Voice recognition is not supported in this browser.");
      return;
    }
    startQueryRecognition();
  });
}

/* Big overlay mic – tap to cancel */
if (overlayMic) {
  overlayMic.addEventListener("click", () => {
    if (queryRecognition && queryRunning) {
      try {
        queryRecognition.stop();
      } catch {}
      queryRunning = false;
      closeVoiceOverlay();
    } else {
      startQueryRecognition();
    }
  });
}

/* Wake word toggle */
if (wakeToggle) {
  wakeToggle.addEventListener("change", () => {
    if (!SpeechRecognition) {
      alert("Voice recognition is not supported on this device.");
      wakeToggle.checked = false;
      return;
    }
    if (wakeToggle.checked) {
      startWakeRecognition();
    } else {
      stopWakeRecognition();
    }
  });
}

/* ========= SIDEBAR & LOGOUT ========= */

if (sidebar && sidebarToggle) {
  sidebarToggle.addEventListener("click", () => {
    sidebar.classList.toggle("sidebar-open");
  });
}

if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    await signOut(auth);
    localStorage.removeItem("mc_session_user");
    window.location.href = "index.html";
  });
}

/* ========= AUTH INIT ========= */

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }

  // build session from localStorage + Firestore
  let stored = loadSessionUser();
  const profile = await loadUserProfile(user.uid);

  sessionUser = {
    id: user.uid,
    name:
      profile?.name ||
      user.displayName ||
      user.email?.split("@")[0] ||
      "User",
    role: profile?.role || stored?.role || "crew",
    storeId: profile?.storeId || stored?.storeId || "store001",
    hoursThisWeek: profile?.hoursThisWeek || stored?.hoursThisWeek || 0,
    hourlyRate: profile?.hourlyRate || stored?.hourlyRate || 0,
    trainingCompletedPercent:
      profile?.trainingCompletedPercent ||
      stored?.trainingCompletedPercent ||
      0,
    mcStars: profile?.mcStars || stored?.mcStars || 0
  };

  // Refresh localStorage so other pages (schedule, training) use the latest
  localStorage.setItem("mc_session_user", JSON.stringify(sessionUser));

  // Load store & crew metrics
  storeDoc = await loadStore(sessionUser.storeId);
  crewSummary = await loadCrewSummary(sessionUser.storeId);

  // Render dashboard + AI
  renderShell();
  renderTopCards();
  renderBottomSection();
  renderSuggestions();

  // initial friendly AI message (only once)
  if (aiChat && !mcassistInitialShown) {
    const role = sessionUser.role;
    const isManagerLike = role === "manager" || role === "shiftCreator";
    addMessage(
      "assistant",
      isManagerLike
        ? "Hi 👋 I’m McAssist. Ask me about sales, waste or which crew need training."
        : "Hi 👋 I’m McAssist. Ask me about your hours, pay, training or McStars.",
      { meta: "McAssist" }
    );
    mcassistInitialShown = true;
  }

});
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }

  // build session from localStorage + Firestore
  let stored = loadSessionUser();
  const profile = await loadUserProfile(user.uid);

  sessionUser = {
    id: user.uid,
    name:
      profile?.name ||
      user.displayName ||
      user.email?.split("@")[0] ||
      "User",
    role: profile?.role || stored?.role || "crew",
    storeId: profile?.storeId || stored?.storeId || "store001",
    hoursThisWeek: profile?.hoursThisWeek || stored?.hoursThisWeek || 0,
    hourlyRate: profile?.hourlyRate || stored?.hourlyRate || 0,
    trainingCompletedPercent:
      profile?.trainingCompletedPercent ||
      stored?.trainingCompletedPercent ||
      0,
    mcStars: profile?.mcStars || stored?.mcStars || 0
  };

  // Refresh localStorage so other pages (schedule, training) use the latest
  localStorage.setItem("mc_session_user", JSON.stringify(sessionUser));

  // Load store & crew metrics
  storeDoc = await loadStore(sessionUser.storeId);
  crewSummary = await loadCrewSummary(sessionUser.storeId);

  // Render dashboard + AI
  renderShell();
  renderTopCards();
  renderBottomSection();
  renderSuggestions();

  // initial friendly AI message
  if (aiChat) {
    const role = sessionUser.role;
    const isManagerLike = role === "manager" || role === "shiftCreator";
    addMessage(
      "assistant",
      isManagerLike
        ? "Hi 👋 I’m McAssist. Ask me about sales, waste or which crew need training."
        : "Hi 👋 I’m McAssist. Ask me about your hours, pay, training or McStars.",
      { meta: "McAssist" }
    );
  }
});
