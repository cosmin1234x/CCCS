const sidebarUserName = document.getElementById("sidebarUserName");
const sidebarUserRole = document.getElementById("sidebarUserRole");
const navShiftCreator = document.getElementById("navShiftCreator");
const logoutBtn = document.getElementById("logoutBtn");

const moduleSearch = document.getElementById("moduleSearch");
const moduleSearchBtn = document.getElementById("moduleSearchBtn");
const resetSearchBtn = document.getElementById("resetSearchBtn");
const moduleGrid = document.getElementById("moduleGrid");
const filterRow = document.getElementById("filterRow");

const quickActionRow = document.getElementById("quickActionRow");
const smartMiniList = document.getElementById("smartMiniList");
const openRecommendedBtn = document.getElementById("openRecommendedBtn");

const headerLevel = document.getElementById("headerLevel");
const headerXP = document.getElementById("headerXP");
const headerCompleted = document.getElementById("headerCompleted");

const playerTitle = document.getElementById("playerTitle");
const playerSubtitle = document.getElementById("playerSubtitle");
const playerDifficulty = document.getElementById("playerDifficulty");
const playerXP = document.getElementById("playerXP");
const playerStatus = document.getElementById("playerStatus");

const lessonState = document.getElementById("lessonState");
const lessonSteps = document.getElementById("lessonSteps");
const doList = document.getElementById("doList");
const dontList = document.getElementById("dontList");
const moduleXPInfo = document.getElementById("moduleXPInfo");
const moduleBarFill = document.getElementById("moduleBarFill");
const reflectionInput = document.getElementById("reflectionInput");
const completeModuleBtn = document.getElementById("completeModuleBtn");
const resetModuleBtn = document.getElementById("resetModuleBtn");

const checklistState = document.getElementById("checklistState");
const checklist = document.getElementById("checklist");

const quizCounter = document.getElementById("quizCounter");
const quizScore = document.getElementById("quizScore");
const quizQuestion = document.getElementById("quizQuestion");
const quizOptions = document.getElementById("quizOptions");
const quizExplain = document.getElementById("quizExplain");
const startQuizBtn = document.getElementById("startQuizBtn");
const nextQuizBtn = document.getElementById("nextQuizBtn");

const trainingChat = document.getElementById("trainingChat");
const trainingAiForm = document.getElementById("trainingAiForm");
const trainingAiInput = document.getElementById("trainingAiInput");
const trainingQuickChips = document.getElementById("trainingQuickChips");

const toast = document.getElementById("toast");

const STORAGE_KEY = "mc_training_smart_v2";

const sessionUser = loadSessionUser() || {
  id: "local-user",
  name: "Crew Member",
  role: "crew",
  storeId: "store001"
};

const state = {
  activeFilter: "all",
  activeModuleId: null,
  search: "",
  xp: 0,
  completed: [],
  reflections: {},
  checklistProgress: {},
  chatSeeded: false,
  quiz: {
    index: 0,
    score: 0,
    questions: [],
    selected: null,
    running: false
  }
};

const modules = [
  {
    id: "fry-station",
    title: "Fry Station Basics",
    category: "Kitchen",
    difficulty: "Easy",
    xp: 40,
    tags: ["fries", "oil", "holding", "salt"],
    description: "Run fry station smoothly, safely, and fast during busy periods.",
    do: ["Check basket flow", "Salt correctly", "Keep holding times in mind"],
    dont: ["Overfill baskets", "Ignore timer", "Mix fresh with old stock"],
    steps: [
      "Check oil and equipment are ready before service starts.",
      "Load fries in correct portions so baskets cook evenly.",
      "Drop, lift and season quickly to keep quality high.",
      "Watch holding times and discard old product properly."
    ],
    checklist: [
      "Checked station is clean and stocked",
      "Used correct fry portions",
      "Salted product correctly",
      "Kept an eye on holding times"
    ],
    quiz: [
      {
        q: "What should you avoid when loading fry baskets?",
        options: ["Overfilling", "Using timers", "Seasoning fries", "Checking stock"],
        answer: 0,
        explain: "Overfilled baskets cook badly and slow the station down."
      },
      {
        q: "Why are holding times important?",
        options: ["For uniform only", "To protect quality and food safety", "To save trays", "To count portions"],
        answer: 1,
        explain: "Holding times help keep product fresh, safe and up to standard."
      }
    ]
  },
  {
    id: "food-safety",
    title: "Food Safety Essentials",
    category: "Safety",
    difficulty: "Easy",
    xp: 60,
    tags: ["cleanliness", "safe", "hygiene", "temps"],
    description: "Core hygiene and safe food handling you need every shift.",
    do: ["Wash hands often", "Use clean surfaces", "Follow temp rules"],
    dont: ["Cross contaminate", "Ignore handwashing", "Use dirty cloths"],
    steps: [
      "Wash hands at the right times, not just when you remember.",
      "Keep raw and ready-to-eat product separate.",
      "Use clean cloths, tools and sanitised surfaces.",
      "Follow temperature and storage rules exactly."
    ],
    checklist: [
      "Washed hands at key moments",
      "Kept surfaces clean",
      "Avoided cross contamination",
      "Checked food storage properly"
    ],
    quiz: [
      {
        q: "What is one key food safety habit?",
        options: ["Rush everything", "Skip handwashing", "Separate products properly", "Leave surfaces dirty"],
        answer: 2,
        explain: "Separating products properly helps avoid contamination."
      }
    ]
  },
  {
    id: "drive-thru",
    title: "Drive-Thru Speed & Accuracy",
    category: "Front",
    difficulty: "Medium",
    xp: 75,
    tags: ["headset", "speed", "accuracy", "service"],
    description: "Take orders faster while still keeping customer experience strong.",
    do: ["Repeat key items", "Stay calm", "Confirm changes clearly"],
    dont: ["Talk over customer", "Rush mistakes", "Forget modifiers"],
    steps: [
      "Greet clearly and listen before speaking too much.",
      "Repeat important items and check modifications.",
      "Keep tone friendly even when queue is long.",
      "Pass clean info to the next station to avoid mistakes."
    ],
    checklist: [
      "Used clear greeting",
      "Repeated key order items",
      "Confirmed custom requests",
      "Kept service tone friendly"
    ],
    quiz: [
      {
        q: "What improves drive-thru accuracy most?",
        options: ["Guessing the order", "Repeating key items", "Speaking faster only", "Ignoring changes"],
        answer: 1,
        explain: "Repeating the important parts cuts mistakes and reassures the customer."
      }
    ]
  },
  {
    id: "grill-close",
    title: "Grill Close Down",
    category: "Kitchen",
    difficulty: "Hard",
    xp: 90,
    tags: ["closing", "grill", "cleaning", "shutdown"],
    description: "A cleaner, clearer guide for closing grill safely and properly.",
    do: ["Follow cool-down steps", "Use correct tools", "Clean in the right order"],
    dont: ["Rush hot equipment", "Skip detail areas", "Leave dirty surfaces"],
    steps: [
      "Reduce production and prepare the station for shutdown.",
      "Follow safe cool-down steps before touching hot areas.",
      "Use correct cleaning tools and approved chemicals.",
      "Finish with a final detail check so morning shift starts clean."
    ],
    checklist: [
      "Prepared station before shutdown",
      "Waited for safe clean-down timing",
      "Cleaned key grill surfaces",
      "Finished final close check"
    ],
    quiz: [
      {
        q: "What should never happen during grill close?",
        options: ["Safe timing", "Correct tools", "Rushing hot equipment", "Final checks"],
        answer: 2,
        explain: "Rushing hot equipment is unsafe and leads to poor cleaning."
      }
    ]
  },
  {
    id: "front-counter",
    title: "Front Counter Confidence",
    category: "Front",
    difficulty: "Easy",
    xp: 45,
    tags: ["counter", "service", "till", "guests"],
    description: "Feel more confident speaking to customers and handling front counter smoothly.",
    do: ["Smile", "Repeat order", "Ask clear questions"],
    dont: ["Ignore customer", "Mumble", "Forget extras"],
    steps: [
      "Welcome the customer clearly and confidently.",
      "Listen carefully and repeat order details if needed.",
      "Offer missing items naturally without sounding robotic.",
      "Keep till area tidy and ready for the next guest."
    ],
    checklist: [
      "Used clear greeting",
      "Repeated or confirmed order",
      "Kept station tidy",
      "Spoke confidently"
    ],
    quiz: [
      {
        q: "What helps front counter confidence?",
        options: ["Looking away", "Clear greeting", "Ignoring extras", "Mumbling"],
        answer: 1,
        explain: "A clear greeting sets the tone and makes service smoother."
      }
    ]
  }
];

const quickActions = [
  "Show me food safety",
  "Open fry station",
  "What should I learn next?",
  "How do I close grill?",
  "Give me a quick quiz"
];

const quickAIChips = [
  "Show me easiest module",
  "Explain holding times",
  "Open drive-thru training",
  "How do I avoid mistakes on front counter?",
  "Give me a short recap"
];

init();

function init() {
  hydrateUserUI();
  loadState();
  bindEvents();
  renderQuickActions();
  renderQuickAIChips();
  renderFilters();
  renderModules();
  renderSmartPanel();
  renderHeaderStats();
  seedAIChat();
}

function loadSessionUser() {
  try {
    return JSON.parse(localStorage.getItem("mc_session_user"));
  } catch {
    return null;
  }
}

function hydrateUserUI() {
  if (sidebarUserName) sidebarUserName.textContent = sessionUser.name || "User";

  if (sidebarUserRole) {
    if (sessionUser.role === "crew") sidebarUserRole.textContent = "Crew Member";
    else if (sessionUser.role === "shiftCreator") sidebarUserRole.textContent = "Shift Creator";
    else sidebarUserRole.textContent = "Restaurant Manager";
  }

  if (navShiftCreator) {
    navShiftCreator.style.display = sessionUser.role === "shiftCreator" ? "" : "none";
  }
}

function bindEvents() {
  moduleSearchBtn?.addEventListener("click", applySearch);
  resetSearchBtn?.addEventListener("click", resetSearch);
  moduleSearch?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      applySearch();
    }
  });

  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  completeModuleBtn?.addEventListener("click", completeActiveModule);
  resetModuleBtn?.addEventListener("click", resetActiveModule);

  startQuizBtn?.addEventListener("click", startQuiz);
  nextQuizBtn?.addEventListener("click", nextQuizQuestion);

  trainingAiForm?.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = trainingAiInput.value.trim();
    if (!text) return;
    handleAI(text);
    trainingAiInput.value = "";
  });

  openRecommendedBtn?.addEventListener("click", () => {
    const best = getRecommendedModules()[0];
    if (!best) return;
    openModule(best.id);
    showToast(`Opened ${best.title}`);
  });

  logoutBtn?.addEventListener("click", () => {
    localStorage.removeItem("mc_session_user");
    window.location.href = "index.html";
  });
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved) return;
    Object.assign(state, saved);
  } catch {}
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    activeFilter: state.activeFilter,
    activeModuleId: state.activeModuleId,
    search: state.search,
    xp: state.xp,
    completed: state.completed,
    reflections: state.reflections,
    checklistProgress: state.checklistProgress
  }));
}

function renderHeaderStats() {
  if (headerXP) headerXP.textContent = state.xp;
  if (headerCompleted) headerCompleted.textContent = state.completed.length;
  if (headerLevel) headerLevel.textContent = Math.max(1, Math.floor(state.xp / 100) + 1);
}

function renderQuickActions() {
  quickActionRow.innerHTML = "";
  quickActions.forEach((text) => {
    const btn = document.createElement("button");
    btn.className = "pill-filter";
    btn.type = "button";
    btn.textContent = text;
    btn.onclick = () => runQuickAction(text);
    quickActionRow.appendChild(btn);
  });
}

function renderQuickAIChips() {
  trainingQuickChips.innerHTML = "";
  quickAIChips.forEach((text) => {
    const chip = document.createElement("button");
    chip.className = "suggestion-chip";
    chip.type = "button";
    chip.textContent = text;
    chip.onclick = () => handleAI(text);
    trainingQuickChips.appendChild(chip);
  });
}

function renderFilters() {
  const categories = ["all", ...new Set(modules.map(m => m.category))];
  filterRow.innerHTML = "";

  categories.forEach((cat) => {
    const btn = document.createElement("button");
    btn.className = `pill-filter ${state.activeFilter === cat ? "active" : ""}`;
    btn.type = "button";
    btn.textContent = cat === "all" ? "All" : cat;
    btn.onclick = () => {
      state.activeFilter = cat;
      renderFilters();
      renderModules();
    };
    filterRow.appendChild(btn);
  });
}

function getFilteredModules() {
  const search = state.search.trim().toLowerCase();

  return modules.filter((m) => {
    const filterOk = state.activeFilter === "all" || m.category === state.activeFilter;
    const searchOk =
      !search ||
      m.title.toLowerCase().includes(search) ||
      m.description.toLowerCase().includes(search) ||
      m.tags.some(tag => tag.toLowerCase().includes(search)) ||
      m.steps.some(step => step.toLowerCase().includes(search));

    return filterOk && searchOk;
  });
}

function renderModules() {
  const list = getFilteredModules();
  moduleGrid.innerHTML = "";

  if (!list.length) {
    moduleGrid.innerHTML = `
      <div class="empty-state">
        No modules matched that search. Try something simpler like <strong>fries</strong>, <strong>safety</strong>, or <strong>drive-thru</strong>.
      </div>
    `;
    return;
  }

  list.forEach((mod) => {
    const card = document.createElement("div");
    card.className = `module-card ${state.activeModuleId === mod.id ? "active" : ""}`;
    card.innerHTML = `
      <div class="module-card-title">${mod.title}</div>
      <div class="module-card-desc">${mod.description}</div>
      <div class="module-card-tags">
        <span class="tiny-tag">${mod.category}</span>
        <span class="tiny-tag">${mod.difficulty}</span>
        <span class="tiny-tag">${mod.xp} XP</span>
        ${state.completed.includes(mod.id) ? `<span class="tiny-tag">Done</span>` : ""}
      </div>
    `;
    card.addEventListener("click", () => openModule(mod.id));
    moduleGrid.appendChild(card);
  });
}

function getRecommendedModules() {
  return [...modules]
    .sort((a, b) => {
      const aDone = state.completed.includes(a.id) ? 1 : 0;
      const bDone = state.completed.includes(b.id) ? 1 : 0;
      if (aDone !== bDone) return aDone - bDone;
      return a.xp - b.xp;
    })
    .slice(0, 3);
}

function renderSmartPanel() {
  const recommended = getRecommendedModules();
  smartMiniList.innerHTML = "";

  recommended.forEach((mod, index) => {
    const row = document.createElement("div");
    row.className = "smart-mini-item";
    row.innerHTML = `
      <span><strong>${index + 1}. ${mod.title}</strong><br><small>${mod.category} · ${mod.difficulty}</small></span>
      <button class="btn" type="button" style="margin-top:0; padding:6px 10px;" data-open="${mod.id}">Open</button>
    `;
    row.querySelector("button").onclick = () => openModule(mod.id);
    smartMiniList.appendChild(row);
  });
}

function openModule(moduleId) {
  state.activeModuleId = moduleId;
  saveState();
  renderModules();
  renderActiveModule();
  switchTab("lesson");
}

function renderActiveModule() {
  const mod = modules.find(m => m.id === state.activeModuleId);

  if (!mod) {
    playerTitle.textContent = "Pick a module to begin";
    playerSubtitle.textContent = "Open something from the library or ask McAssist a question like “show me fry station cleaning”.";
    playerDifficulty.textContent = "Difficulty: —";
    playerXP.textContent = "XP: —";
    playerStatus.textContent = "Not started";
    lessonState.style.display = "";
    lessonSteps.innerHTML = "";
    checklist.innerHTML = "";
    checklistState.style.display = "";
    startQuizBtn.disabled = true;
    completeModuleBtn.disabled = true;
    resetModuleBtn.disabled = true;
    return;
  }

  playerTitle.textContent = mod.title;
  playerSubtitle.textContent = mod.description;
  playerDifficulty.textContent = `Difficulty: ${mod.difficulty}`;
  playerXP.textContent = `XP: ${mod.xp}`;
  playerStatus.textContent = state.completed.includes(mod.id) ? "Completed" : "In progress";

  lessonState.style.display = "none";
  lessonSteps.innerHTML = mod.steps.map((step, i) => `
    <div class="lesson-step">
      <strong>Step ${i + 1}</strong>
      <p>${step}</p>
    </div>
  `).join("");

  doList.innerHTML = mod.do.map(item => `<li><span>${item}</span><span class="badge-soft-success">Do</span></li>`).join("");
  dontList.innerHTML = mod.dont.map(item => `<li><span>${item}</span><span class="badge-soft-danger">Avoid</span></li>`).join("");

  moduleXPInfo.textContent = state.completed.includes(mod.id)
    ? `Completed · earned ${mod.xp} XP`
    : `Complete this module to earn ${mod.xp} XP`;

  moduleBarFill.style.width = state.completed.includes(mod.id) ? "100%" : "35%";
  reflectionInput.value = state.reflections[mod.id] || "";

  renderChecklist(mod);

  startQuizBtn.disabled = false;
  completeModuleBtn.disabled = false;
  resetModuleBtn.disabled = false;
}

function renderChecklist(mod) {
  checklistState.style.display = "none";
  const saved = state.checklistProgress[mod.id] || [];

  checklist.innerHTML = mod.checklist.map((item, index) => `
    <label class="check-row">
      <input type="checkbox" data-check-index="${index}" ${saved.includes(index) ? "checked" : ""} />
      <span>${item}</span>
    </label>
  `).join("");

  checklist.querySelectorAll("input[type='checkbox']").forEach((box) => {
    box.addEventListener("change", () => {
      const idx = Number(box.dataset.checkIndex);
      const arr = new Set(state.checklistProgress[mod.id] || []);
      if (box.checked) arr.add(idx);
      else arr.delete(idx);
      state.checklistProgress[mod.id] = [...arr];
      saveState();
    });
  });
}

function completeActiveModule() {
  const mod = modules.find(m => m.id === state.activeModuleId);
  if (!mod) return;

  if (!state.completed.includes(mod.id)) {
    state.completed.push(mod.id);
    state.xp += mod.xp;
  }

  state.reflections[mod.id] = reflectionInput.value.trim();
  saveState();
  renderHeaderStats();
  renderModules();
  renderActiveModule();
  renderSmartPanel();
  showToast(`${mod.title} completed +${mod.xp} XP`);
}

function resetActiveModule() {
  const mod = modules.find(m => m.id === state.activeModuleId);
  if (!mod) return;

  state.completed = state.completed.filter(id => id !== mod.id);
  delete state.reflections[mod.id];
  delete state.checklistProgress[mod.id];
  saveState();
  renderHeaderStats();
  renderModules();
  renderActiveModule();
  renderSmartPanel();
  showToast(`${mod.title} reset`);
}

function applySearch() {
  state.search = moduleSearch.value.trim();
  renderModules();
}

function resetSearch() {
  state.search = "";
  moduleSearch.value = "";
  state.activeFilter = "all";
  renderFilters();
  renderModules();
}

function switchTab(tab) {
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.tab === tab);
  });

  document.querySelectorAll(".tabPanel").forEach(panel => {
    panel.style.display = panel.dataset.panel === tab ? "" : "none";
  });
}

function startQuiz() {
  const mod = modules.find(m => m.id === state.activeModuleId);
  if (!mod || !mod.quiz?.length) return;

  state.quiz.questions = mod.quiz;
  state.quiz.index = 0;
  state.quiz.score = 0;
  state.quiz.selected = null;
  state.quiz.running = true;

  quizScore.textContent = "Score: 0";
  quizExplain.style.display = "none";
  nextQuizBtn.disabled = true;
  renderQuizQuestion();
}

function renderQuizQuestion() {
  const q = state.quiz.questions[state.quiz.index];
  if (!q) return;

  quizCounter.textContent = `Question ${state.quiz.index + 1} of ${state.quiz.questions.length}`;
  quizQuestion.textContent = q.q;
  quizOptions.innerHTML = "";

  q.options.forEach((opt, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn quiz-option";
    btn.textContent = opt;
    btn.onclick = () => selectQuizOption(i);
    quizOptions.appendChild(btn);
  });
}

function selectQuizOption(index) {
  const q = state.quiz.questions[state.quiz.index];
  if (!q) return;

  state.quiz.selected = index;
  const correct = index === q.answer;
  if (correct) state.quiz.score += 1;

  quizScore.textContent = `Score: ${state.quiz.score}`;
  quizExplain.style.display = "";
  quizExplain.textContent = correct ? `Correct. ${q.explain}` : `Not quite. ${q.explain}`;
  nextQuizBtn.disabled = false;

  [...quizOptions.children].forEach((btn, i) => {
    btn.disabled = true;
    if (i === q.answer) btn.classList.add("active");
  });
}

function nextQuizQuestion() {
  state.quiz.index += 1;
  state.quiz.selected = null;
  quizExplain.style.display = "none";
  nextQuizBtn.disabled = true;

  if (state.quiz.index >= state.quiz.questions.length) {
    quizQuestion.textContent = `Quiz finished. Final score: ${state.quiz.score}/${state.quiz.questions.length}`;
    quizOptions.innerHTML = "";
    quizCounter.textContent = "Quiz complete";
    showToast("Quiz complete");
    return;
  }

  renderQuizQuestion();
}

function seedAIChat() {
  if (state.chatSeeded) return;
  addAIMessage(`Hi ${String(sessionUser.name || "crew").split(" ")[0]} 👋 Ask me what to learn, how to do a task, or tell me to open a module for you.`);
  state.chatSeeded = true;
}

function handleAI(text) {
  addUserMessage(text);

  const lower = text.toLowerCase();

  if (lower.includes("open")) {
    const match = findBestModuleMatch(lower);
    if (match) {
      openModule(match.id);
      addAIMessage(`I opened <strong>${match.title}</strong> for you. It looks like the best match for what you asked.`);
      return;
    }
  }

  if (lower.includes("learn next") || lower.includes("best module") || lower.includes("recommend")) {
    const rec = getRecommendedModules()[0];
    if (rec) {
      addAIMessage(`Best next pick: <strong>${rec.title}</strong> — ${rec.description}`);
      return;
    }
  }

  if (lower.includes("easy")) {
    const easy = modules.find(m => m.difficulty === "Easy" && !state.completed.includes(m.id));
    if (easy) {
      addAIMessage(`Try <strong>${easy.title}</strong>. It’s an easy module and a good quick win.`);
      return;
    }
  }

  const match = findBestModuleMatch(lower);
  if (match) {
    addAIMessage(`<strong>${match.title}</strong>: ${match.steps[0]} ${match.steps[1] ? "<br><br>Then: " + match.steps[1] : ""}`);
    return;
  }

  if (lower.includes("holding time")) {
    addAIMessage(`Holding times matter because food quality drops fast after cooking. Watch timers, rotate stock, and discard old product properly.`);
    return;
  }

  if (lower.includes("quick quiz")) {
    const active = state.activeModuleId ? modules.find(m => m.id === state.activeModuleId) : getRecommendedModules()[0];
    if (active) {
      openModule(active.id);
      switchTab("quiz");
      startQuiz();
      addAIMessage(`I started a quiz for <strong>${active.title}</strong>.`);
      return;
    }
  }

  addAIMessage(`I can help with modules, steps, cleaning, food safety, and station help. Try asking something like <strong>open fry station</strong> or <strong>how do I close grill?</strong>`);
}

function findBestModuleMatch(text) {
  const clean = text.toLowerCase();

  return modules.find((m) =>
    m.title.toLowerCase().includes(clean) ||
    clean.includes(m.title.toLowerCase()) ||
    m.tags.some(tag => clean.includes(tag.toLowerCase())) ||
    m.category.toLowerCase() === clean
  ) || modules.find((m) =>
    m.tags.some(tag => clean.includes(tag.toLowerCase()))
  ) || null;
}

function runQuickAction(text) {
  if (text === "Open fry station") {
    openModule("fry-station");
    return;
  }

  if (text === "Show me food safety") {
    openModule("food-safety");
    return;
  }

  handleAI(text);
}

function addUserMessage(text) {
  if (!trainingChat) return;
  const div = document.createElement("div");
  div.className = "message msg-user";
  div.innerHTML = `<div class="bubble">${text}</div><div class="msg-meta">You</div>`;
  trainingChat.appendChild(div);
  trainingChat.scrollTop = trainingChat.scrollHeight;
}

function addAIMessage(text) {
  if (!trainingChat) return;
  const div = document.createElement("div");
  div.className = "message msg-bot";
  div.innerHTML = `<div class="bubble">${text}</div><div class="msg-meta">McAssist</div>`;
  trainingChat.appendChild(div);
  trainingChat.scrollTop = trainingChat.scrollHeight;
}

function showToast(text) {
  if (!toast) return;
  toast.textContent = text;
  toast.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.remove("show"), 1800);
}