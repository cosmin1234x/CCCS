/** ============================================================
 * McTRAINING – Learning Hub v2
 * Real lessons + checklists + light XP system
 * Firestore sync at users/{id}/trainingV2/profile
 * ============================================================ */

import { auth, db } from "./firebase-init.js";
import {
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

/* ---------- DOM ---------- */

const sidebarUserName = document.getElementById("sidebarUserName");
const sidebarUserRole = document.getElementById("sidebarUserRole");
const logoutBtn = document.getElementById("logoutBtn");
const sidebar = document.querySelector(".sidebar");
const sidebarToggle = document.getElementById("sidebarToggle");

const headerLevel = document.getElementById("headerLevel");
const headerXP = document.getElementById("headerXP");

const pathList = document.getElementById("pathList");

const lessonPanel = document.getElementById("lessonPanel");
const lessonTitle = document.getElementById("lessonTitle");
const lessonSubtitle = document.getElementById("lessonSubtitle");
const lessonTag = document.getElementById("lessonTag");
const lessonContent = document.getElementById("lessonContent");

const statusPill = document.getElementById("statusPill");
const moduleXPInfo = document.getElementById("moduleXPInfo");
const moduleXpFill = document.getElementById("moduleXpFill");
const checklistEl = document.getElementById("checklist");
const reflectionInput = document.getElementById("reflectionInput");
const completeModuleBtn = document.getElementById("completeModuleBtn");
const resetModuleBtn = document.getElementById("resetModuleBtn");

const toastEl = document.getElementById("toast");

/* ---------- Mobile sidebar toggle ---------- */
if (sidebar && sidebarToggle) {
  sidebarToggle.addEventListener("click", () => {
    sidebar.classList.toggle("sidebar-open");
  });
}

/* ---------- Session ---------- */

let sessionUser = null;

function loadSession() {
  try {
    return JSON.parse(localStorage.getItem("mc_session_user"));
  } catch {
    return null;
  }
}

/* ---------- Learning content ---------- */

const modules = [
  {
    id: "welcome",
    index: 1,
    title: "Welcome to McDonald's",
    tag: "Orientation",
    estMinutes: 5,
    xp: 40,
    focus: "What McDonald's expects from every crew member.",
    objectives: [
      "Understand our three priorities: safety, quality, and service.",
      "Know who to speak to when you’re unsure about something.",
      "Understand how the rota, clock-in and breaks work in your store."
    ],
    keySteps: [
      "Arrive on time in full, clean uniform and clock in correctly.",
      "Introduce yourself to the shift manager and check your station.",
      "Ask questions early — it’s better than guessing."
    ],
    do: [
      "Use people’s names where possible.",
      "Keep phones away unless your manager agrees otherwise.",
      "Tell a manager if you feel unsafe or unsure."
    ],
    dont: [
      "Guess temperatures or food safety steps.",
      "Ignore unsafe behaviour because you’re new.",
      "Leave your station without telling anyone."
    ],
    scenario: {
      title: "It’s your first Friday shift",
      text:
        "You’re not sure where to put your bag, how breaks work, or what to do when there are no guests. A good first step is to ask your shift manager to quickly walk you through the basics, then look for small ways to help: wiping, restocking or shadowing another crew member."
    }
  },
  {
    id: "crew-basics",
    index: 2,
    title: "Crew Basics",
    tag: "Core skills",
    estMinutes: 8,
    xp: 60,
    focus: "The behaviours and habits that make every shift smoother.",
    objectives: [
      "Use the basic service steps on any station.",
      "Communicate clearly with other crew and managers.",
      "Know what to do when you’re not directly serving a guest."
    ],
    keySteps: [
      "Follow the service pattern: Greet → Take order → Prepare → Hand over & thank.",
      "Talk out loud: call orders, low stock and issues so the team can react.",
      "In quiet moments: clean, restock or help a nearby station."
    ],
    do: [
      "Smile and make eye contact with every guest.",
      "Repeat orders back to avoid mistakes.",
      "Check screens before handing food out."
    ],
    dont: [
      "Turn away from guests when they approach.",
      "Leave mess or spills for someone else.",
      "Say 'I don’t know' without trying to get help."
    ],
    scenario: {
      title: "You have a short queue",
      text:
        "There are three guests in line and you’re on front counter. You greet the next guest, repeat their order back and check the screen before handing food out. Between guests, you wipe your counter and check sauce stock so you’re ready for the next mini-rush."
    }
  },
  {
    id: "food-safety",
    index: 3,
    title: "Food Safety & Hygiene",
    tag: "Food safety",
    estMinutes: 10,
    xp: 80,
    focus: "Keeping food safe from delivery to serving the guest.",
    objectives: [
      "Wash hands correctly and use PPE when needed.",
      "Avoid cross-contamination between raw and ready-to-eat food.",
      "Know what to do if you think food might be unsafe."
    ],
    keySteps: [
      "Wash hands at the correct sink for at least 20 seconds, then dry with paper towels.",
      "Use colour-coded equipment and follow raw / cooked separation rules.",
      "If you’re unsure whether food is safe, treat it as unsafe and call a manager."
    ],
    do: [
      "Change gloves when switching tasks.",
      "Keep sanitiser bottles and cloths where they’re meant to be.",
      "Record checks (temperatures, holding times) on time."
    ],
    dont: [
      "Touch your face or phone and then handle food.",
      "Ignore a timer that has expired.",
      "Serve food that looks undercooked or wrong."
    ],
    scenario: {
      title: "A holding timer has just expired",
      text:
        "You see a timer expire on the UHC. Instead of re-starting the timer, you call a manager, discard the product and cook fresh. This slows things down for one order but protects guests and the brand."
    }
  },
  {
    id: "kitchen",
    index: 4,
    title: "Kitchen Essentials",
    tag: "Kitchen",
    estMinutes: 10,
    xp: 80,
    focus: "Moving confidently around the kitchen without losing control.",
    objectives: [
      "Know the layout and key pieces of equipment in your kitchen.",
      "Follow build charts accurately for each product.",
      "Keep your line stocked and clean through the rush."
    ],
    keySteps: [
      "Learn the build chart for your main products and keep a copy nearby.",
      "Set up your station before the rush: sauces, wraps, boxes, trays.",
      "Call out low stock early so there’s time to cook more."
    ],
    do: [
      "Check cook times and holding times regularly.",
      "Label and rotate products so oldest is used first.",
      "Move with purpose but never run."
    ],
    dont: [
      "Guess builds because you’re in a hurry.",
      "Leave tongs or utensils on dirty surfaces.",
      "Block walkways or emergency exits with boxes or trays."
    ],
    scenario: {
      title: "You’re on the bun station at lunch",
      text:
        "Orders are building up. You keep your bun area tidy, call out when you’re running low, and follow the build charts without skipping steps. When you fall behind, you ask a manager for short-term help rather than trying to do everything alone."
    }
  },
  {
    id: "front-counter",
    index: 5,
    title: "Front Counter Service",
    tag: "Service",
    estMinutes: 8,
    xp: 70,
    focus: "Making face-to-face service fast, accurate and friendly.",
    objectives: [
      "Handle kiosk, app and front counter orders confidently.",
      "Use positive language even when guests are frustrated.",
      "Know simple ways to recover a poor experience."
    ],
    keySteps: [
      "Greet every guest within a few seconds, even if you’re still finishing the last order.",
      "Repeat orders back and check names / table numbers.",
      "If something goes wrong, apologise, fix it and involve a manager when needed."
    ],
    do: [
      "Thank guests for waiting when it’s busy.",
      "Use the guest’s name when it appears on the screen.",
      "Offer clear options rather than saying 'I don’t know'."
    ],
    dont: [
      "Blame other crew in front of guests.",
      "Ignore guests who look unsure about kiosks.",
      "Let long queues build without telling a manager."
    ],
    scenario: {
      title: "An order has missing fries",
      text:
        "A guest says their fries are missing. You stay calm, apologise and quickly check their receipt and the screen. You fix the mistake, re-check the rest of the order and thank them for their patience."
    }
  },
  {
    id: "drive-thru",
    index: 6,
    title: "Drive-Thru Teamwork",
    tag: "Drive-Thru",
    estMinutes: 8,
    xp: 70,
    focus: "Working as a team across order, pay and handout windows.",
    objectives: [
      "Use headsets and screens correctly.",
      "Coordinate with the kitchen so food is ready at the right time.",
      "Handle payments safely and accurately."
    ],
    keySteps: [
      "Use short, clear phrases on the headset and repeat totals.",
      "Check bags, drinks and condiments before handing them out.",
      "Tell a manager if there’s a long delay or system problem."
    ],
    do: [
      "Stay polite even if guests sound stressed.",
      "Call out special items (like no salt fries) so the team can react.",
      "Keep windows and counters clean between cars."
    ],
    dont: [
      "Lean too far out of the window.",
      "Guess orders without checking screens.",
      "Talk over other crew on the headset."
    ],
    scenario: {
      title: "Cars are backed up to the road",
      text:
        "You have a queue of cars and the kitchen is behind. You stay calm, update guests with realistic times and tell your manager so they can add support or hold cars in the bays instead of blocking the road."
    }
  }
];

/* ---------- Training state (synced with Firestore) ---------- */

let trainingState = {
  xp: 0,
  completedModules: [],       // [moduleId,...]
  reflections: {}             // {moduleId: text}
};

let currentModule = null;

/* Firestore helpers */

async function loadTrainingState(userId) {
  try {
    const ref = doc(db, "users", userId, "trainingV2", "profile");
    const snap = await getDoc(ref);

    if (!snap.exists()) {
      await setDoc(ref, trainingState);
      return trainingState;
    }

    const data = snap.data() || {};
    trainingState = { ...trainingState, ...data };
    return trainingState;
  } catch (err) {
    console.error("[Training] Failed to load training state:", err);
    return trainingState;
  }
}

async function saveTrainingState() {
  if (!sessionUser) return;
  try {
    const ref = doc(db, "users", sessionUser.id, "trainingV2", "profile");
    await updateDoc(ref, trainingState);
  } catch (err) {
    // if update fails because doc doesn't exist, fall back to setDoc once
    try {
      const ref = doc(db, "users", sessionUser.id, "trainingV2", "profile");
      await setDoc(ref, trainingState, { merge: true });
    } catch (err2) {
      console.error("[Training] Failed to save training state:", err2);
    }
  }
}

/* ---------- XP & level ---------- */

function xpToLevel(xp) {
  // simple curve: each level is +150 xp
  return Math.floor(xp / 150) + 1;
}

function showToast(message) {
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.classList.add("show");
  setTimeout(() => toastEl.classList.remove("show"), 2600);
}

function addXP(amount) {
  trainingState.xp += amount;
  updateHeaderXP();
  saveTrainingState();
  showToast(`+${amount} XP added to your training.`);
}

function updateHeaderXP() {
  const xp = trainingState.xp || 0;
  const level = xpToLevel(xp);
  if (headerLevel) headerLevel.textContent = level;
  if (headerXP) headerXP.textContent = `${xp} XP total`;
}

/* ---------- Rendering: path rail ---------- */

function renderPathRail() {
  if (!pathList) return;
  pathList.innerHTML = "";

  modules.forEach((m) => {
    const li = document.createElement("li");
    li.className = "path-item";
    li.dataset.moduleId = m.id;

    const completed = trainingState.completedModules.includes(m.id);
    if (completed) li.classList.add("completed");
    if (currentModule && currentModule.id === m.id) li.classList.add("active");

    li.innerHTML = `
      <div class="path-step">${m.index}</div>
      <div class="path-text">
        <div class="path-title-row">
          <span>${m.title}</span>
          <span class="path-tag">${m.tag}</span>
        </div>
        <div class="path-meta">
          ${m.estMinutes} min • ${m.xp} XP
        </div>
      </div>
    `;

    li.addEventListener("click", () => {
      selectModule(m.id);
    });

    pathList.appendChild(li);
  });
}

/* ---------- Rendering: lesson panel ---------- */

function renderLesson(module) {
  if (!lessonPanel || !lessonTitle || !lessonSubtitle || !lessonTag) return;

  // restart animation
  lessonPanel.classList.remove("lesson-panel-anim");
  void lessonPanel.offsetWidth;
  lessonPanel.classList.add("lesson-panel-anim");

  lessonTitle.textContent = module.title;
  lessonSubtitle.textContent = module.focus;
  lessonTag.textContent = module.tag;

  const objectives = module.objectives
    .map((o) => `<li>${o}</li>`)
    .join("");

  const steps = module.keySteps
    .map((s) => `<li>${s}</li>`)
    .join("");

  const doList = module.do
    .map((d) => `<li>✅ ${d}</li>`)
    .join("");

  const dontList = module.dont
    .map((d) => `<li>⚠️ ${d}</li>`)
    .join("");

  const scenario = module.scenario || {};

  lessonContent.innerHTML = `
    <section class="lesson-section">
      <h4>What you'll learn</h4>
      <ul>${objectives}</ul>
    </section>

    <section class="lesson-section">
      <h4>Step-by-step on shift</h4>
      <ul>${steps}</ul>
    </section>

    <section class="lesson-section">
      <h4>Do & don't</h4>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:6px;">
        <ul>${doList}</ul>
        <ul>${dontList}</ul>
      </div>
    </section>

    <section class="lesson-section">
      <h4>Real shift scenario</h4>
      <div class="lesson-scenario">
        <strong>${scenario.title || "On a busy shift"}</strong>
        <span>${scenario.text || ""}</span>
      </div>
    </section>

    <section class="lesson-highlight">
      Tip: Pick one thing from this lesson and write it in your own words
      in the note box on the right. Then try it on your very next shift.
    </section>
  `;
}

/* ---------- Rendering: progress panel ---------- */

function renderProgressPanel(module) {
  if (!statusPill || !moduleXPInfo || !moduleXpFill || !checklistEl) return;

  const completed = trainingState.completedModules.includes(module.id);

  statusPill.textContent = completed ? "Completed" : "In progress";
  statusPill.classList.toggle("completed", completed);

  moduleXPInfo.textContent = `${module.xp} XP when you complete this module.`;

  // simple module completion bar: full if completed, half if not yet
  moduleXpFill.style.width = completed ? "100%" : "40%";

  // checklist: just echo key steps in short form
  checklistEl.innerHTML = "";
  module.keySteps.forEach((step, idx) => {
    const li = document.createElement("li");
    li.className = "check-item";
    li.innerHTML = `
      <input type="checkbox" data-step="${idx}">
      <span>${step}</span>
    `;
    checklistEl.appendChild(li);
  });

  // reflection
  const storedReflection = trainingState.reflections?.[module.id] || "";
  if (reflectionInput) {
    reflectionInput.value = storedReflection;
    reflectionInput.disabled = false;
  }

  completeModuleBtn.disabled = false;
  resetModuleBtn.disabled = !completed;
}

/* ---------- Select module ---------- */

function selectModule(id) {
  const module = modules.find((m) => m.id === id);
  if (!module) return;

  currentModule = module;

  // update path rail highlighting
  document.querySelectorAll(".path-item").forEach((item) => {
    item.classList.toggle(
      "active",
      item.dataset.moduleId === module.id
    );
  });

  renderLesson(module);
  renderProgressPanel(module);
}

/* ---------- Complete / reset module ---------- */

function completeCurrentModule() {
  if (!currentModule) return;

  if (!trainingState.completedModules.includes(currentModule.id)) {
    trainingState.completedModules.push(currentModule.id);
    addXP(currentModule.xp);
    saveTrainingState();
  }

  renderPathRail();
  renderProgressPanel(currentModule);
  showToast(`Nice work – "${currentModule.title}" marked as complete.`);
}

function resetCurrentModule() {
  if (!currentModule) return;

  trainingState.completedModules = trainingState.completedModules.filter(
    (id) => id !== currentModule.id
  );

  renderPathRail();
  renderProgressPanel(currentModule);
  saveTrainingState();
  showToast(`Progress for "${currentModule.title}" has been reset.`);
}

/* ---------- Reflection save ---------- */

if (reflectionInput) {
  reflectionInput.addEventListener("blur", () => {
    if (!currentModule) return;
    if (!trainingState.reflections) trainingState.reflections = {};
    trainingState.reflections[currentModule.id] = reflectionInput.value || "";
    saveTrainingState();
  });
}

/* ---------- Buttons ---------- */

if (completeModuleBtn) {
  completeModuleBtn.addEventListener("click", completeCurrentModule);
}

if (resetModuleBtn) {
  resetModuleBtn.addEventListener("click", resetCurrentModule);
}

/* ---------- Auth init ---------- */

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }

  sessionUser =
    loadSession() || {
      id: user.uid,
      role: "crew",
      name: user.displayName || user.email || "User"
    };

  if (sidebarUserName) sidebarUserName.textContent = sessionUser.name;
  if (sidebarUserRole) {
    sidebarUserRole.textContent =
      sessionUser.role === "manager" ? "Restaurant Manager" : "Crew Member";
  }

  await loadTrainingState(sessionUser.id);
  updateHeaderXP();
  renderPathRail();

  // auto-select first module if none selected
  if (modules.length) {
    selectModule(modules[0].id);
  }
});

/* ---------- Logout ---------- */

if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    await signOut(auth);
    localStorage.removeItem("mc_session_user");
    window.location.href = "index.html";
  });
}
