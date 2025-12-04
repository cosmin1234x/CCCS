// main.js – Dashboard + McAssist + Voice + Crew Profiles (with modal)
// Roles supported: crew / manager / shiftCreator

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

/* ========= SESSION & DATA ========= */

let sessionUser = null;   // {id, role, name, storeId, ...}
let storeDoc = null;      // store metrics
let crewSummary = [];     // crew list for current store
let mcassistBusy = false;
let mcassistInitialShown = false;

// Profile modal refs
let profileModal = null;
let profileModalCard = null;
let profileModalClose = null;

/* ========= FIRESTORE HELPERS ========= */

function loadSessionUser() {
  try {
    return JSON.parse(localStorage.getItem("mc_session_user"));
  } catch {
    return null;
  }
}

async function loadUserProfile(uid) {
  try {
    const userRef = doc(db, "users", uid);
    const snap = await getDoc(userRef);
    if (snap.exists()) return snap.data();
  } catch (err) {
    console.error("[main] loadUserProfile error:", err);
  }
  return null;
}

async function loadStore(storeId) {
  try {
    const ref = doc(db, "stores", storeId);
    const snap = await getDoc(ref);
    if (snap.exists()) return snap.data();
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
        name: d.name || "Crew member",
        trainingStatus: d.trainingStatus || "OK",
        notes: d.notes || "",
        mcStars: typeof d.mcStars === "number" ? d.mcStars : 0,
        primaryStation: d.primaryStation || "All stations",
        versatility: d.versatility || 0,
        badge: d.badge || "",        // e.g. "Crew trainer in development"
        nextShift: d.nextShift || "",// optional string
        stations: d.stations || ""   // optional string
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

  if (welcomeTitle) {
    const first = sessionUser.name.split(" ")[0] || "there";
    welcomeTitle.textContent =
      isManagerLike ? `Good shift, ${first}` : `Hi ${first}`;
  }

  if (welcomeSubtitle) {
    welcomeSubtitle.textContent = isManagerLike
      ? "Live snapshot for your restaurant."
      : "Your hours, training and McStars in one place.";
  }

  if (aiSubtitle) {
    aiSubtitle.textContent = isManagerLike
      ? "Ask about sales, waste or which crew need training."
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
    const sales = storeDoc?.todaySales || storeDoc?.todaySalesValue || 0;
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
    // Crew: personal view (using profile fields when present)
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

/* ========= CREW LIST + PROFILE MODAL ========= */

/**
 * Builds the bottom section with crew rows + McStars + buttons.
 * Manager / ShiftCreator see the crew list; crew see their own summary card.
 */
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

        // McStar tier
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

        // Training status
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
                      class="crew-row-btn crew-row-btn-profile"
                      data-crew-id="${c.id}">
                Profile
              </button>
              <button type="button"
                      class="crew-row-btn crew-row-btn--outline crew-row-btn-edit"
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

    attachCrewRowHandlers();
  } else {
    bottomSection.innerHTML = `
      <div class="subsection-title">Your training & McStars</div>
      <div class="subsection-sub">
        See which stations you’re signed off on and what to do next.
      </div>
      <p style="font-size:0.8rem; color:#4b5563; margin-bottom:8px;">
        Use the Training tab for full details. When you complete a module or get signed off on
        a new station, your McStars and profile update here automatically.
      </p>
      <button class="btn" type="button" onclick="window.location.href='training.html'">
        <span>🎓</span>
        <span>Open training</span>
      </button>
    `;
  }
}

/**
 * Attach click handlers to Profile / Edit buttons in crew list.
 */
function attachCrewRowHandlers() {
  if (!bottomSection) return;

  bottomSection.addEventListener("click", (e) => {
    const profileBtn = e.target.closest(".crew-row-btn-profile");
    const editBtn = e.target.closest(".crew-row-btn-edit");
    if (!profileBtn && !editBtn) return;

    const crewId = (profileBtn || editBtn).dataset.crewId;
    const crew = crewSummary.find((c) => c.id === crewId);
    if (!crew) return;

    if (profileBtn) {
      showCrewProfileModal(crew);
    } else if (editBtn) {
      // For your demo this can be a simple note.
      alert(
        `Edit training for ${crew.name}\n\n` +
          `For now, update this in Firestore (stores/${sessionUser.storeId}/crewSummary).`
      );
    }
  });
}

/**
 * Lazy-create the profile modal DOM once.
 */
function ensureProfileModal() {
  if (profileModal) return;

  profileModal = document.createElement("div");
  profileModal.id = "crewProfileModal";
  profileModal.style.cssText = `
    position: fixed;
    inset: 0;
    background: rgba(15, 23, 42, 0.45);
    display: none;
    align-items: center;
    justify-content: center;
    z-index: 60;
  `;

  profileModalCard = document.createElement("div");
  profileModalCard.style.cssText = `
    background: #fff7ed;
    border-radius: 22px;
    padding: 18px 20px 16px;
    max-width: 520px;
    width: 100%;
    box-shadow: 0 22px 50px rgba(0,0,0,0.35);
    border: 1px solid rgba(250,204,21,0.85);
    position: relative;
    font-size: 0.85rem;
  `;

  profileModalClose = document.createElement("button");
  profileModalClose.textContent = "✕";
  profileModalClose.style.cssText = `
    position: absolute;
    top: 10px;
    right: 12px;
    border: none;
    background: transparent;
    font-size: 1rem;
    cursor: pointer;
  `;

  profileModalCard.appendChild(profileModalClose);
  profileModal.appendChild(profileModalCard);
  document.body.appendChild(profileModal);

  profileModal.addEventListener("click", (e) => {
    if (e.target === profileModal) hideCrewProfileModal();
  });
  profileModalClose.addEventListener("click", hideCrewProfileModal);
}

function hideCrewProfileModal() {
  if (profileModal) profileModal.style.display = "none";
}

/**
 * Show the profile modal for one crew member.
 * This is the “card” style like your photo.
 */
function showCrewProfileModal(crew) {
  ensureProfileModal();

  const storeName =
    storeDoc?.name || storeDoc?.storeName || "Your restaurant";

  // McStar tier
  const stars = crew.mcStars || 0;
  let tierLabel = "No McStars yet";
  if (stars >= 10) tierLabel = "Gold McStar";
  else if (stars >= 5) tierLabel = "Silver McStar";
  else if (stars >= 1) tierLabel = "Bronze McStar";

  const trainingStatus = crew.trainingStatus || "OK";
  const badge = crew.badge || "";
  const nextShift = crew.nextShift || "Not scheduled";
  const stations =
    crew.stations ||
    `${crew.primaryStation || "All stations"}${
      crew.versatility ? ` · ${crew.versatility}+ stations` : ""
    }`;
  const notes = crew.notes || "No manager notes yet.";

  profileModalCard.innerHTML = `
    ${profileModalClose.outerHTML}  <!-- close button placeholder, will be replaced below -->
    <div style="display:flex; align-items:center; gap:10px; margin-bottom:10px;">
      <div style="
          width: 42px;
          height: 42px;
          border-radius: 999px;
          background: #f97316;
          color: #fefce8;
          font-weight: 800;
          display:flex;
          align-items:center;
          justify-content:center;
          box-shadow: 0 4px 8px rgba(248,113,22,0.6);
        ">
        ${crew.name.charAt(0).toUpperCase()}
      </div>
      <div>
        <div style="font-weight: 800; font-size: 1rem;">${crew.name}</div>
        <div style="font-size: 0.78rem; color:#6b7280;">
          Crew Member · ${storeName}
        </div>
      </div>
    </div>

    <div style="display:grid; grid-template-columns: 130px 1fr; row-gap:6px; column-gap:10px; font-size:0.8rem; margin-top:6px;">
      <div style="color:#9ca3af;">Training status</div>
      <div>
        ${badge || trainingStatus}
      </div>

      <div style="color:#9ca3af;">Badge</div>
      <div>
        ${badge || "—"}
      </div>

      <div style="color:#9ca3af;">McStars</div>
      <div>
        ⭐ ${tierLabel} (${stars})
      </div>

      <div style="color:#9ca3af;">Next shift</div>
      <div>
        ${nextShift}
      </div>

      <div style="color:#9ca3af;">Stations</div>
      <div>
        ${stations}
      </div>
    </div>

    <div style="margin-top:10px; font-size:0.8rem;">
      <div style="color:#9ca3af; margin-bottom:4px;">Manager notes</div>
      <div style="
        background:#fff;
        border-radius:12px;
        border:1px solid #fed7aa;
        padding:8px 10px;
      ">
        ${notes}
      </div>
    </div>
  `;

  // Re-wire close button after innerHTML reset
  profileModalClose = profileModalCard.querySelector("button");
  profileModalClose.addEventListener("click", hideCrewProfileModal);

  profileModal.style.display = "flex";
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

  const nowStr = new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });
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
        "Sorry, I couldn’t reach my brain. Try again in a moment."
      );
      return;
    }

    const data = await res.json();
    const reply = data.reply || "All good – no detailed answer returned.";

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

/* ========= AI FORM ========= */

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

// Overlay helpers
function openVoiceOverlay(promptText = "Ask me anything") {
  if (!voiceOverlay) return;
  overlayText.textContent = promptText;
  voiceOverlay.classList.add("open");
}

function closeVoiceOverlay() {
  if (!voiceOverlay) return;
  voiceOverlay.classList.remove("open");
}

// Capture one question
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

// Wake word loop
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
    if (event.error === "no-speech" || event.error === "network") {
      setTimeout(() => {
        if (wakeToggle?.checked) startWakeRecognition();
      }, 700);
    }
  };

  wakeRecognition.onend = () => {
    wakeRunning = false;
    if (wakeToggle?.checked && !queryRunning) {
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

// Small mic
if (aiMicBtn) {
  aiMicBtn.addEventListener("click", () => {
    if (!SpeechRecognition) {
      alert("Voice recognition is not supported in this browser.");
      return;
    }
    startQueryRecognition();
  });
}

// Big overlay mic
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

// Wake toggle
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

  const stored = loadSessionUser();
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

  localStorage.setItem("mc_session_user", JSON.stringify(sessionUser));

  storeDoc = await loadStore(sessionUser.storeId);
  crewSummary = await loadCrewSummary(sessionUser.storeId);

  renderShell();
  renderTopCards();
  renderBottomSection();
  renderSuggestions();

  // Initial McAssist greeting – only once
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
