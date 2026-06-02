// Pitch-ready McTraining front-end helpers

const DEMO_USER = {
  id: "demo-manager-001",
  name: "Cosmin",
  role: "manager",
  storeId: "store001"
};

const crew = [
  { name: "Amelia", role: "Crew", status: "Shift-ready", station: "Front Counter", next: "Today 14:00", stars: 4 },
  { name: "Ryan", role: "Crew Trainer", status: "Needs fries refresh", station: "Kitchen", next: "Today 16:00", stars: 7 },
  { name: "Maya", role: "Crew", status: "New starter", station: "Lobby", next: "Tomorrow 09:00", stars: 1 },
  { name: "Leo", role: "Manager", status: "Ready", station: "Shift Lead", next: "Today 12:00", stars: 9 }
];

const shifts = [
  { day: "Today", time: "12:00 - 20:00", person: "Leo", station: "Shift Lead", risk: "Covered" },
  { day: "Today", time: "14:00 - 22:00", person: "Amelia", station: "Front Counter", risk: "Busy 17:30" },
  { day: "Today", time: "16:00 - 23:00", person: "Ryan", station: "Kitchen", risk: "Training gap" },
  { day: "Tomorrow", time: "09:00 - 17:00", person: "Maya", station: "Lobby", risk: "New starter" }
];

const modules = [
  { title: "First shift confidence", xp: 80, progress: 92, tag: "Almost done" },
  { title: "Food safety basics", xp: 120, progress: 68, tag: "Priority" },
  { title: "Front counter service", xp: 70, progress: 45, tag: "In progress" },
  { title: "Drive-thru communication", xp: 90, progress: 31, tag: "Optional" }
];

const menu = [
  { item: "Crew Burger", cost: 2, emoji: "🍔" },
  { item: "Medium Fries", cost: 1, emoji: "🍟" },
  { item: "Nuggets", cost: 2, emoji: "🍗" },
  { item: "Soft Drink", cost: 1, emoji: "🥤" },
  { item: "McFlurry", cost: 2, emoji: "🍦" },
  { item: "Apple Pie", cost: 1, emoji: "🥧" }
];

function qs(id) { return document.getElementById(id); }
function money(v) { return `£${Number(v || 0).toFixed(2)}`; }

function getSessionUser() {
  try {
    const raw = localStorage.getItem("mc_session_user");
    return raw ? JSON.parse(raw) : DEMO_USER;
  } catch {
    return DEMO_USER;
  }
}

function saveDemoSession() {
  if (!localStorage.getItem("mc_session_user")) {
    localStorage.setItem("mc_session_user", JSON.stringify(DEMO_USER));
  }
}

function roleLabel(role) {
  if (role === "shiftCreator") return "Shift Creator";
  if (role === "manager") return "Manager";
  return "Crew Member";
}

function initChrome(activePage = "dashboard") {
  const user = getSessionUser();
  const name = user.name || "Crew Member";
  const role = roleLabel(user.role || "crew");

  const sideName = qs("sidebarUserName");
  const sideRole = qs("sidebarUserRole");
  const avatar = qs("avatarCircle");
  const roleBadge = qs("roleBadge");
  const welcome = qs("welcomeTitle");

  if (sideName) sideName.textContent = name;
  if (sideRole) sideRole.textContent = role;
  if (avatar) avatar.textContent = name.trim().charAt(0).toUpperCase() || "U";
  if (roleBadge) roleBadge.textContent = role;
  if (welcome) welcome.textContent = `Welcome back, ${name.split(" ")[0]}`;

  document.querySelectorAll(".nav a").forEach((a) => {
    a.classList.toggle("active", a.dataset.page === activePage);
  });

  const navShiftCreator = qs("navShiftCreator");
  if (navShiftCreator) {
    navShiftCreator.style.display = ["manager", "shiftCreator"].includes(user.role) ? "flex" : "none";
  }

  const sidebar = qs("sidebar");
  const toggle = qs("sidebarToggle");
  if (sidebar && toggle) {
    toggle.addEventListener("click", () => sidebar.classList.toggle("open"));
  }

  const logout = qs("logoutBtn");
  if (logout) {
    logout.addEventListener("click", () => {
      localStorage.removeItem("mc_session_user");
      window.location.href = "index.html";
    });
  }
}

function toast(msg) {
  const t = qs("toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2200);
}

function renderDashboard() {
  const topCards = qs("topCards");
  if (topCards) {
    topCards.innerHTML = `
      <article class="card stat"><span>Staff on shift</span><strong>18</strong><p class="muted">2 more needed for dinner rush</p></article>
      <article class="card stat"><span>Training completion</span><strong>76%</strong><p class="muted">4 modules due this week</p></article>
      <article class="card stat"><span>Shift coverage</span><strong>91%</strong><p class="muted">Friday evening needs review</p></article>
      <article class="card stat"><span>Break rewards</span><strong>42</strong><p class="muted">Points used by crew today</p></article>
    `;
  }

  const bottom = qs("bottomSection");
  if (bottom) {
    bottom.innerHTML = `
      <div class="between wrap">
        <div><h3>Manager command centre</h3><p class="muted">One screen for staffing, training, breaks, and store readiness.</p></div>
        <span class="pill ok">✅ Demo data active</span>
      </div>
      <div class="grid two" style="margin-top:14px;">
        <div class="mini">
          <h3>Today’s priorities</h3>
          <ul style="margin:10px 0 0 18px;line-height:1.8;color:var(--muted);font-weight:800;">
            <li>Move Ryan from kitchen support to fries training before peak.</li>
            <li>Ask McAssist for a 5pm staffing risk check.</li>
            <li>Approve 2 break reward requests before dinner rush.</li>
          </ul>
        </div>
        <div class="mini">
          <h3>Crew pulse</h3>
          <div class="grid" style="margin-top:10px;">
            ${crew.map(c => `<div class="between"><span><b>${c.name}</b><br><small class="muted">${c.station} • ${c.status}</small></span><span class="pill">⭐ ${c.stars}</span></div>`).join("")}
          </div>
        </div>
      </div>
    `;
  }
}

function renderTraining() {
  const box = qs("trainingModules");
  if (!box) return;
  box.innerHTML = modules.map(m => `
    <article class="card">
      <div class="between"><h3>${m.title}</h3><span class="pill ${m.progress > 80 ? "ok" : m.tag === "Priority" ? "bad" : "warn"}">${m.tag}</span></div>
      <p class="muted">${m.xp} XP • built for quick crew learning and manager sign-off.</p>
      <div class="progress" style="margin-top:12px"><div class="bar" style="width:${m.progress}%"></div></div>
      <div class="between" style="margin-top:10px"><small class="muted">${m.progress}% complete</small><button class="btn alt" type="button" onclick="window.McPitch.toast('Module opened')">Open</button></div>
    </article>
  `).join("");
}

function renderSchedule() {
  const table = qs("shiftTable");
  if (!table) return;
  table.innerHTML = `
    <table class="table">
      <thead><tr><th>Day</th><th>Time</th><th>Crew</th><th>Station</th><th>Risk</th></tr></thead>
      <tbody>
        ${shifts.map(s => `<tr><td>${s.day}</td><td>${s.time}</td><td>${s.person}</td><td>${s.station}</td><td><span class="pill ${s.risk === "Covered" ? "ok" : "warn"}">${s.risk}</span></td></tr>`).join("")}
      </tbody>
    </table>
  `;
}

function renderRewards() {
  const grid = qs("menuGrid");
  if (!grid) return;
  let points = Number(localStorage.getItem("reward_points") || 4);
  let total = 0;
  const pointsNow = qs("pointsNow");
  const cartTotal = qs("cartTotal");
  const cart = qs("cartList");
  function update() {
    if (pointsNow) pointsNow.textContent = points;
    if (cartTotal) cartTotal.textContent = total;
  }
  grid.innerHTML = menu.map(m => `
    <article class="mini">
      <div style="font-size:2rem">${m.emoji}</div>
      <h3>${m.item}</h3>
      <p class="muted">${m.cost} break point${m.cost > 1 ? "s" : ""}</p>
      <button class="btn alt add-food" data-item="${m.item}" data-cost="${m.cost}" type="button">Add</button>
    </article>
  `).join("");
  document.querySelectorAll(".add-food").forEach(btn => {
    btn.addEventListener("click", () => {
      const cost = Number(btn.dataset.cost);
      if (total + cost > points) return toast("Cart is over your available points");
      total += cost;
      if (cart) cart.insertAdjacentHTML("beforeend", `<div class="mini between"><span>${btn.dataset.item}</span><b>${cost} pts</b></div>`);
      update();
    });
  });
  qs("claimBonusBtn")?.addEventListener("click", () => { points += 1; localStorage.setItem("reward_points", String(points)); update(); toast("Bonus point added"); });
  qs("clearCartBtn")?.addEventListener("click", () => { total = 0; if (cart) cart.innerHTML = ""; update(); });
  qs("checkoutBtn")?.addEventListener("click", () => { points -= total; total = 0; localStorage.setItem("reward_points", String(points)); if (cart) cart.innerHTML = ""; update(); toast("Break order saved"); });
  update();
}

function renderShiftCreator() {
  renderSchedule();
  const crewBox = qs("crewPicker");
  if (crewBox) {
    crewBox.innerHTML = crew.map(c => `<option>${c.name} - ${c.role}</option>`).join("");
  }
  qs("saveShiftBtn")?.addEventListener("click", () => toast("Shift saved for demo"));
}

const answers = {
  "shift": "Today’s main risk is the 5pm-7pm dinner rush. I’d move Ryan to fries training before peak, keep Leo as shift lead, and add one extra front counter person if possible.",
  "training": "Training priority: food safety basics first, then fries refresh for Ryan, then front counter service practice for newer crew. Managers can use the dashboard to see who needs sign-off.",
  "break": "Break Rewards gives crew a simple daily points budget. It helps managers reward good teamwork while keeping break food controlled and trackable.",
  "corporate": "Best pitch: this portal reduces manager admin, helps new crew learn faster, makes shift risks visible, and gives staff a fun reason to engage with training.",
  "pay": "For pay questions, connect this to approved payroll data only. The app can estimate hours, but official pay should always come from company payroll systems.",
  "default": "I can help with shifts, crew training, break rewards, station confidence, manager priorities, and presentation talking points. Try asking: ‘What should I fix before dinner rush?’"
};

function botReply(text) {
  const q = String(text || "").toLowerCase();
  if (q.includes("shift") || q.includes("rota") || q.includes("rush")) return answers.shift;
  if (q.includes("train") || q.includes("module") || q.includes("crew")) return answers.training;
  if (q.includes("break") || q.includes("reward") || q.includes("food")) return answers.break;
  if (q.includes("corporate") || q.includes("pitch") || q.includes("show")) return answers.corporate;
  if (q.includes("pay") || q.includes("hour")) return answers.pay;
  return answers.default;
}

function addMsg(who, text) {
  const chat = qs("aiChat");
  if (!chat) return;
  const div = document.createElement("div");
  div.className = `msg ${who}`;
  div.innerHTML = `<div class="bubble">${text}</div>`;
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
}

function initChat() {
  const chat = qs("aiChat");
  const form = qs("aiForm");
  const input = qs("aiInput");
  const suggestions = qs("aiSuggestions");
  if (!chat || !form || !input) return;
  if (!chat.dataset.ready) {
    addMsg("bot", "Hi, I’m McAssist 👋 Ask me about shift risks, crew training, break rewards, or what to say in your corporate pitch.");
    chat.dataset.ready = "1";
  }
  const chips = ["What should I fix before dinner rush?", "Pitch this to corporate", "Who needs training?", "How do rewards help managers?"];
  if (suggestions) {
    suggestions.innerHTML = chips.map(c => `<button type="button">${c}</button>`).join("");
    suggestions.querySelectorAll("button").forEach(b => b.addEventListener("click", () => {
      input.value = b.textContent;
      form.requestSubmit();
    }));
  }
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    addMsg("user", text);
    input.value = "";
    setTimeout(() => addMsg("bot", botReply(text)), 250);
  });
}

function initAuth() {
  const demo = qs("demoLoginBtn");
  demo?.addEventListener("click", () => {
    saveDemoSession();
    window.location.href = "main.html";
  });
}

function initPage(page) {
  initChrome(page);
  initChat();
  if (page === "dashboard") renderDashboard();
  if (page === "training") renderTraining();
  if (page === "schedule") renderSchedule();
  if (page === "rewards") renderRewards();
  if (page === "shifts") renderShiftCreator();
}

window.McPitch = { initPage, initAuth, toast, saveDemoSession };
