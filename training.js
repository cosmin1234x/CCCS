// ================================================
// training.js — Training Page Upgrade (Instant Open + Q&A + Quizzes)
// ✅ Local module library (no Firestore needed)
// ✅ "open grill training module" instantly opens best match
// ✅ AI answers from relevant modules (lightweight local retrieval)
// ✅ Quiz UI runs locally; AI can also generate quiz variants
// ================================================

import { auth, db } from "./firebase-init.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

/* ===================== OPTIONAL USER DOC ENSURE ===================== */

function loadSessionUser() {
  try { return JSON.parse(localStorage.getItem("mc_session_user")); } catch { return null; }
}
function saveSessionUser(u) {
  localStorage.setItem("mc_session_user", JSON.stringify(u));
}

async function ensureUserDoc(firebaseUser) {
  const userRef = doc(db, "users", firebaseUser.uid);
  const snap = await getDoc(userRef);
  if (snap.exists()) return snap.data();

  const cached = loadSessionUser() || {};
  const payload = {
    name: cached.name || firebaseUser.displayName || firebaseUser.email || "User",
    email: String(firebaseUser.email || "").toLowerCase(),
    role: cached.role || "crew",
    storeId: cached.storeId || "store001",
    createdAt: serverTimestamp(),
    trainingStatus: "—",
    badge: "—",
    stars: 0
  };
  await setDoc(userRef, payload);
  return payload;
}

/* ===================== DOM ===================== */

const trainingSearch = document.getElementById("trainingSearch");
const trainingSearchBtn = document.getElementById("trainingSearchBtn");
const trainingModuleGrid = document.getElementById("trainingModuleGrid");

const trainingChat = document.getElementById("trainingChat");
const trainingAiForm = document.getElementById("trainingAiForm");
const trainingAiInput = document.getElementById("trainingAiInput");
const trainingAiSend = document.getElementById("trainingAiSend");
const trainingQuickChips = document.getElementById("trainingQuickChips");
const trainingAiSubtitle = document.getElementById("trainingAiSubtitle");

const moduleOverlay = document.getElementById("moduleOverlay");
const moduleTitle = document.getElementById("moduleTitle");
const moduleMeta = document.getElementById("moduleMeta");
const moduleBody = document.getElementById("moduleBody");
const closeModuleBtn = document.getElementById("closeModuleBtn");
const startQuizBtn = document.getElementById("startQuizBtn");
const quizArea = document.getElementById("quizArea");

// Optional: if you have logout button on training page
const logoutBtn = document.getElementById("logoutBtn");

/* ===================== STATE ===================== */

let sessionUser = null;
let storeId = "store001";
let activeModule = null;

/* ===================== MODULE LIBRARY ===================== */
/**
 * Write your modules here. Keep them short & practical.
 * If you want, I can also convert these into Firestore later.
 */
const MODULES = [
  {
    id: "grill-101",
    title: "Grill Training 101",
    tags: ["grill", "kitchen", "beef", "temperature", "timers", "safety"],
    minutes: 12,
    sections: [
      { h: "Goal", p: "Cook safe, consistent patties using timers, correct placement, and clean working habits." },
      { h: "Core steps", bullets: [
        "Wash hands, glove up, check grill area is clean and clear.",
        "Confirm correct product and correct timer program.",
        "Place patties evenly; avoid stacking or overlapping.",
        "Close grill properly; start correct timer.",
        "When timer ends: remove, stage correctly, and follow holding-time rules."
      ]},
      { h: "Safety & quality checks", bullets: [
        "Never guess cook times—use the correct timer.",
        "Keep raw and cooked tools separate.",
        "If anything looks wrong (undercooked, off smell), stop and tell a manager."
      ]},
      { h: "Common mistakes", bullets: [
        "Wrong timer program.",
        "Crowding the grill.",
        "Not cleaning between runs.",
        "Cross-contamination with raw tools."
      ]}
    ],
    quiz: [
      { q: "What should you use to ensure correct cook time?", choices: ["A stopwatch", "The correct grill timer/program", "Guess based on experience"], a: 1, explain: "Use the correct programmed timer for consistent safe cooking." },
      { q: "Why should patties not overlap?", choices: ["It wastes space", "It can cook unevenly", "It makes them taste better"], a: 1, explain: "Overlapping can cause uneven cooking and safety issues." },
      { q: "What do you do if a batch looks undercooked?", choices: ["Serve it anyway", "Throw it away silently", "Stop and tell a manager / follow procedure"], a: 2, explain: "Escalate and follow food safety procedure." }
    ]
  },
  {
    id: "fries-station",
    title: "Fries Station Basics",
    tags: ["fries", "oil", "salt", "holding", "portion"],
    minutes: 10,
    sections: [
      { h: "Goal", p: "Fast, consistent fries with correct salt, portioning, and holding time." },
      { h: "Core steps", bullets: [
        "Check oil level/temperature and basket condition.",
        "Cook correct batch size; shake basket if required by your process.",
        "Drain properly; salt evenly; portion correctly.",
        "Respect holding time—rotate stock, don’t top-up old fries."
      ]},
      { h: "Quality checks", bullets: [
        "Color: golden, not pale or burnt.",
        "Texture: crisp outside, soft inside.",
        "Portion: consistent scoops."
      ]}
    ],
    quiz: [
      { q: "What’s the best way to handle old fries nearing holding time?", choices: ["Top-up with new fries", "Serve them first no matter what", "Replace/rotate following holding-time rules"], a: 2, explain: "Rotate stock and follow holding-time rules to maintain quality." }
    ]
  },
  {
    id: "front-counter",
    title: "Front Counter Customer Service",
    tags: ["front", "counter", "service", "orders", "smile"],
    minutes: 8,
    sections: [
      { h: "Goal", p: "Accurate orders, friendly service, and quick recovery when something goes wrong." },
      { h: "Service basics", bullets: [
        "Greet, confirm order, repeat key items.",
        "Keep eye contact, speak clearly, stay calm.",
        "If an issue happens: apologise, fix, and escalate if needed."
      ]},
      { h: "Accuracy habits", bullets: [
        "Read back order.",
        "Double-check drinks/sides.",
        "Label or separate special requests."
      ]}
    ],
    quiz: [
      { q: "Best first step if a customer says their order is wrong?", choices: ["Argue back", "Apologise and check the receipt/order", "Ignore it"], a: 1, explain: "Acknowledge and verify, then fix quickly." }
    ]
  },
  {
    id: "drive-thru",
    title: "Drive-Thru Flow & Accuracy",
    tags: ["drive", "drivethru", "headset", "accuracy", "speed"],
    minutes: 10,
    sections: [
      { h: "Goal", p: "Keep the line moving while maintaining order accuracy." },
      { h: "Core steps", bullets: [
        "Confirm each order clearly.",
        "Repeat total and key items.",
        "Coordinate with runners/kitchen.",
        "Handle changes politely and quickly."
      ]},
      { h: "Speed tips", bullets: [
        "Use short, clear phrases.",
        "If it’s busy, suggest quick add-ons once, not repeatedly."
      ]}
    ],
    quiz: [
      { q: "Why repeat the key items back to the customer?", choices: ["It’s annoying", "It improves accuracy", "It wastes time"], a: 1, explain: "Repeating reduces mistakes and remakes." }
    ]
  },
  {
    id: "food-safety",
    title: "Food Safety & Hygiene Essentials",
    tags: ["hygiene", "safety", "handwashing", "cross contamination", "allergens"],
    minutes: 12,
    sections: [
      { h: "Goal", p: "Prevent contamination and keep food safe every shift." },
      { h: "Non-negotiables", bullets: [
        "Wash hands properly and often.",
        "Separate raw and cooked tools/areas.",
        "Keep surfaces sanitised.",
        "Follow holding times and temperature checks."
      ]},
      { h: "Allergens", bullets: [
        "Take allergen requests seriously—use the correct process.",
        "If unsure, stop and ask a manager."
      ]}
    ],
    quiz: [
      { q: "If you’re unsure about an allergen request, what do you do?", choices: ["Guess", "Ask a manager / follow allergen process", "Ignore it"], a: 1, explain: "Always follow allergen procedure; escalate if unsure." }
    ]
  },
  {
    id: "close-clean",
    title: "Close Down & Cleaning Routine",
    tags: ["close", "clean", "hygiene", "checklist"],
    minutes: 15,
    sections: [
      { h: "Goal", p: "Leave the store clean, stocked, and safe for the next team." },
      { h: "Routine", bullets: [
        "Do tasks little-by-little before rush ends.",
        "Follow the close checklist (stations, floors, bins, surfaces).",
        "Restock essentials for open.",
        "Final walk-through with shift manager."
      ]}
    ],
    quiz: [
      { q: "Best way to avoid a huge cleanup at the end?", choices: ["Ignore cleaning until close", "Clean as you go", "Ask someone else"], a: 1, explain: "Cleaning as you go prevents end-of-night overload." }
    ]
  },
  {
    id: "cash-handling",
    title: "Cash Handling Basics",
    tags: ["cash", "till", "money", "refunds"],
    minutes: 9,
    sections: [
      { h: "Goal", p: "Accurate tills and safe handling to reduce errors." },
      { h: "Basics", bullets: [
        "Count change back clearly.",
        "Keep till closed when not in use.",
        "Don’t share logins.",
        "Follow refund/void rules (manager approval if required)."
      ]}
    ],
    quiz: [
      { q: "Why shouldn’t you share till logins?", choices: ["It’s faster", "It breaks accountability", "It’s required"], a: 1, explain: "Accountability matters for errors and audits." }
    ]
  }
];

/* ===================== SEARCH + OPEN MODULE ===================== */

function normalise(str) {
  return String(str || "").toLowerCase().trim();
}

function scoreModule(mod, queryText) {
  const q = normalise(queryText);
  if (!q) return 0;

  const title = normalise(mod.title);
  const tags = (mod.tags || []).map(normalise);
  const body = normalise(
    (mod.sections || [])
      .map((s) => [s.h, s.p, ...(s.bullets || [])].join(" "))
      .join(" ")
  );

  let score = 0;

  // strong signals
  if (title.includes(q)) score += 50;
  if (tags.some((t) => t.includes(q) || q.includes(t))) score += 30;

  // word overlap
  const words = q.split(/\s+/).filter(Boolean);
  for (const w of words) {
    if (w.length < 3) continue;
    if (title.includes(w)) score += 12;
    if (tags.some((t) => t.includes(w))) score += 8;
    if (body.includes(w)) score += 3;
  }

  return score;
}

function findBestModule(queryText) {
  const scored = MODULES
    .map((m) => ({ m, s: scoreModule(m, queryText) }))
    .sort((a, b) => b.s - a.s);

  return scored[0]?.s > 0 ? scored[0].m : null;
}

function renderModules(list = MODULES) {
  if (!trainingModuleGrid) return;

  trainingModuleGrid.innerHTML = "";
  const sorted = [...list].sort((a, b) => a.title.localeCompare(b.title));

  sorted.forEach((m) => {
    const card = document.createElement("div");
    card.className = "card";
    card.style.cursor = "pointer";
    card.innerHTML = `
      <div class="card-header">
        <div class="card-title">${m.title}</div>
        <div class="card-icon">🎓</div>
      </div>
      <div class="card-subtext" style="margin-top:6px;">
        ${m.minutes ? `${m.minutes} min` : "Module"} · ${(m.tags || []).slice(0, 4).join(", ")}
      </div>
      <div style="margin-top:10px; display:flex; gap:6px; flex-wrap:wrap;">
        <span class="badge-soft">Open</span>
        <span class="badge-soft-warn">Quiz</span>
      </div>
    `;
    card.onclick = () => openModuleById(m.id);
    trainingModuleGrid.appendChild(card);
  });
}

function moduleToHTML(mod) {
  const parts = [];
  (mod.sections || []).forEach((sec) => {
    if (sec.h) parts.push(`<h4 style="margin:10px 0 6px; font-weight:900;">${sec.h}</h4>`);
    if (sec.p) parts.push(`<p style="margin:0 0 8px; color:#374151; line-height:1.45;">${sec.p}</p>`);
    if (Array.isArray(sec.bullets) && sec.bullets.length) {
      parts.push(`<ul style="margin:0 0 10px 18px; color:#374151;">${sec.bullets.map((b) => `<li>${b}</li>`).join("")}</ul>`);
    }
  });
  return parts.join("");
}

function openModuleById(id) {
  const mod = MODULES.find((m) => m.id === id);
  if (!mod || !moduleOverlay) return;

  activeModule = mod;
  moduleTitle.textContent = mod.title;
  moduleMeta.textContent = `${mod.minutes ? `${mod.minutes} min` : "Module"} · ${(mod.tags || []).join(", ")}`;

  moduleBody.innerHTML = moduleToHTML(mod);

  // hide quiz area initially
  if (quizArea) {
    quizArea.style.display = "none";
    quizArea.innerHTML = "";
  }

  moduleOverlay.style.display = "flex";
}

function closeModule() {
  if (!moduleOverlay) return;
  moduleOverlay.style.display = "none";
  activeModule = null;
}

/* ===================== QUIZ UI ===================== */

function renderQuiz(mod, quiz = mod?.quiz || []) {
  if (!quizArea) return;

  if (!quiz.length) {
    quizArea.style.display = "block";
    quizArea.innerHTML = `<div class="subsection-title">Quiz</div><div class="subsection-sub">No quiz for this module yet.</div>`;
    return;
  }

  quizArea.style.display = "block";
  quizArea.innerHTML = `
    <div class="subsection-title">Quiz: ${mod.title}</div>
    <div class="subsection-sub">Answer the questions, then submit.</div>
    <form id="quizForm" style="margin-top:10px; display:flex; flex-direction:column; gap:10px;"></form>
    <div style="display:flex; gap:8px; margin-top:10px; align-items:center;">
      <button id="quizSubmitBtn" class="btn" type="button">Submit quiz</button>
      <div id="quizResult" style="font-size:0.85rem; color:#374151;"></div>
    </div>
  `;

  const quizForm = document.getElementById("quizForm");
  quiz.forEach((q, idx) => {
    const block = document.createElement("div");
    block.style.border = "1px solid #e5e7eb";
    block.style.borderRadius = "14px";
    block.style.padding = "10px 12px";

    const answers = (q.choices || []).map((c, i) => `
      <label style="display:flex; gap:8px; align-items:center; margin-top:6px; cursor:pointer;">
        <input type="radio" name="q${idx}" value="${i}" />
        <span>${c}</span>
      </label>
    `).join("");

    block.innerHTML = `
      <div style="font-weight:800;">${idx + 1}) ${q.q}</div>
      <div style="margin-top:6px;">${answers}</div>
      <div id="qexp${idx}" style="display:none; margin-top:8px; font-size:0.8rem; color:#6b7280;"></div>
    `;
    quizForm.appendChild(block);
  });

  document.getElementById("quizSubmitBtn")?.addEventListener("click", () => {
    let correct = 0;

    quiz.forEach((q, idx) => {
      const picked = quizForm.querySelector(`input[name="q${idx}"]:checked`);
      const exp = document.getElementById(`qexp${idx}`);
      const pickedIdx = picked ? Number(picked.value) : -1;

      const ok = pickedIdx === q.a;
      if (ok) correct++;

      if (exp) {
        exp.style.display = "block";
        exp.textContent = ok
          ? `✅ Correct. ${q.explain || ""}`
          : `❌ Correct answer: ${(q.choices || [])[q.a] || "—"}. ${q.explain || ""}`;
      }
    });

    const pct = Math.round((correct / quiz.length) * 100);
    const res = document.getElementById("quizResult");
    if (res) res.textContent = `Score: ${correct}/${quiz.length} (${pct}%).`;
  });
}

/* ===================== TRAINING CHAT ===================== */

function addChatMessage(text, from = "bot") {
  if (!trainingChat) return;

  const msg = document.createElement("div");
  msg.className = `message ${from === "user" ? "msg-user" : "msg-bot"}`;
  msg.innerHTML = `
    <div class="bubble">${text}</div>
    <div class="msg-meta">${from === "user" ? "You" : "McAssist"}</div>
  `;
  trainingChat.appendChild(msg);
  trainingChat.scrollTop = trainingChat.scrollHeight;
}

let thinkingEl = null;
function showThinking() {
  if (!trainingChat) return;
  if (thinkingEl) thinkingEl.remove();

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
  trainingChat.appendChild(thinkingEl);
  trainingChat.scrollTop = trainingChat.scrollHeight;
}
function hideThinking() {
  if (thinkingEl) thinkingEl.remove();
  thinkingEl = null;
}

/**
 * Instant open handler:
 * - catches "open ___ module" / "open ___ training"
 */
function tryInstantOpenFromText(text) {
  const t = normalise(text);

  // basic patterns
  const patterns = [
    /^open\s+(.+?)\s+training\s+module$/,
    /^open\s+(.+?)\s+module$/,
    /^open\s+(.+?)\s+training$/,
    /^start\s+(.+?)\s+training\s+module$/,
    /^show\s+(.+?)\s+module$/
  ];

  let topic = null;
  for (const p of patterns) {
    const m = t.match(p);
    if (m && m[1]) { topic = m[1]; break; }
  }

  if (!topic) return false;

  const best = findBestModule(topic);
  if (!best) {
    addChatMessage(`I couldn’t find a module for “${topic}”. Try: grill, fries, food safety, drive-thru, front counter…`, "bot");
    return true;
  }

  openModuleById(best.id);
  addChatMessage(`Opening **${best.title}** now ✅`, "bot");
  return true;
}

/**
 * Lightweight retrieval: pick top modules relevant to the question
 * and send only those to the backend so the AI can answer accurately.
 */
function getRelevantModuleContext(question, topK = 2) {
  const scored = MODULES
    .map((m) => ({ m, s: scoreModule(m, question) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, topK)
    .filter((x) => x.s > 0)
    .map((x) => x.m);

  const payload = scored.map((m) => ({
    id: m.id,
    title: m.title,
    tags: m.tags,
    minutes: m.minutes,
    text: (m.sections || []).map((s) => [s.h, s.p, ...(s.bullets || [])].join("\n")).join("\n\n"),
    quiz: (m.quiz || []).map((q) => ({ q: q.q, choices: q.choices, answerIndex: q.a, explain: q.explain }))
  }));

  return payload;
}

async function sendTrainingMessage(text) {
  if (!text || !text.trim()) return;
  if (!sessionUser) return;

  const cleanText = text.trim();
  addChatMessage(cleanText, "user");
  if (trainingAiInput) trainingAiInput.value = "";
  if (trainingAiSend) trainingAiSend.disabled = true;

  // instant open without waiting for AI
  if (tryInstantOpenFromText(cleanText)) {
    if (trainingAiSend) trainingAiSend.disabled = false;
    return;
  }

  showThinking();

  try {
    const relevant = getRelevantModuleContext(cleanText, 2);

    // if user asks to "quiz me on X", we can instantly open that module + quiz
    const t = normalise(cleanText);
    if (t.startsWith("quiz me on") || t.startsWith("start quiz on") || t.startsWith("quiz on")) {
      const topic = cleanText.replace(/^(quiz me on|start quiz on|quiz on)\s+/i, "");
      const best = findBestModule(topic);
      if (best) {
        openModuleById(best.id);
        renderQuiz(best, best.quiz || []);
        hideThinking();
        addChatMessage(`Quiz started for **${best.title}** 🧠`, "bot");
        if (trainingAiSend) trainingAiSend.disabled = false;
        return;
      }
    }

    // send to your existing Vercel endpoint
    const res = await fetch("/api/mcassist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: cleanText,
        user: sessionUser,
        contextData: {
          page: "training",
          storeId,
          activeModule: activeModule ? { id: activeModule.id, title: activeModule.title } : null,
          relevantModules: relevant,
          allModuleTitles: MODULES.map((m) => ({ id: m.id, title: m.title, tags: m.tags }))
        }
      })
    });

    let data = {};
    try { data = await res.json(); } catch { data = {}; }

    hideThinking();

    // Optional: allow backend to tell the client to open a module/quiz
    // If your backend returns: { reply, action:{type:'openModule', id:'grill-101'} }
    if (data?.action?.type === "openModule" && data?.action?.id) {
      openModuleById(data.action.id);
    }
    if (data?.action?.type === "startQuiz" && data?.action?.id) {
      openModuleById(data.action.id);
      const mod = MODULES.find((m) => m.id === data.action.id);
      if (mod) renderQuiz(mod, mod.quiz || []);
    }

    addChatMessage(data.reply || "I’m not sure — try asking in a different way.", "bot");
  } catch (err) {
    console.error("[Training] McAssist error:", err);
    hideThinking();
    addChatMessage("Sorry, something went wrong with training AI.", "bot");
  }

  if (trainingAiSend) trainingAiSend.disabled = false;
}

/* ===================== UI EVENTS ===================== */

trainingSearchBtn?.addEventListener("click", () => {
  const q = trainingSearch?.value || "";
  if (!q.trim()) return renderModules(MODULES);
  const filtered = MODULES
    .map((m) => ({ m, s: scoreModule(m, q) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.m);
  renderModules(filtered.length ? filtered : MODULES);
});

trainingSearch?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    trainingSearchBtn?.click();
  }
});

trainingAiForm?.addEventListener("submit", (e) => {
  e.preventDefault();
  sendTrainingMessage(trainingAiInput?.value || "");
});

closeModuleBtn?.addEventListener("click", closeModule);
moduleOverlay?.addEventListener("click", (e) => {
  if (e.target === moduleOverlay) closeModule();
});

startQuizBtn?.addEventListener("click", () => {
  if (!activeModule) return;
  renderQuiz(activeModule, activeModule.quiz || []);
});

/* Quick chips */
function renderQuickChips() {
  if (!trainingQuickChips) return;
  trainingQuickChips.innerHTML = "";
  const chips = [
    "Open grill training module",
    "Open food safety module",
    "Quiz me on fries",
    "What’s the most common grill mistake?",
    "How do I handle an allergen request?"
  ];
  chips.forEach((t) => {
    const b = document.createElement("button");
    b.className = "suggestion-chip";
    b.textContent = t;
    b.type = "button";
    b.onclick = () => sendTrainingMessage(t);
    trainingQuickChips.appendChild(b);
  });
}

/* ===================== AUTH INIT ===================== */

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }

  sessionUser =
    loadSessionUser() || {
      id: user.uid,
      role: "crew",
      name: user.displayName || user.email || "User",
      storeId: "store001"
    };

  const userDoc = await ensureUserDoc(user);

  sessionUser.id = user.uid;
  sessionUser.role = userDoc.role || sessionUser.role;
  sessionUser.storeId = userDoc.storeId || sessionUser.storeId;
  sessionUser.name = userDoc.name || sessionUser.name;
  saveSessionUser(sessionUser);

  storeId = sessionUser.storeId || "store001";

  // initial render
  renderModules(MODULES);
  renderQuickChips();

  if (trainingAiSubtitle) {
    trainingAiSubtitle.textContent =
      "Ask anything about any module, or say: “open grill training module” / “quiz me on fries”.";
  }

  if (trainingChat) {
    trainingChat.innerHTML = "";
    addChatMessage(`Hi ${String(sessionUser.name).split(" ")[0]} 👋 What do you want to train on today?`, "bot");
  }
});

/* Logout if button exists */
logoutBtn?.addEventListener("click", async () => {
  await signOut(auth);
  localStorage.removeItem("mc_session_user");
  window.location.href = "index.html";
});
