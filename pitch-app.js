// pitch-app.js — real-session UI helpers, role-based dashboard, McStars and profiles

const crew = [
  { id: "amelia", name: "Amelia", role: "Crew Member", status: "Shift-ready", station: "Front Counter", next: "Today 14:00 - 22:00", stars: 4, badge: "Service Star", training: "Front Counter 91%", strengths: ["Customer service", "Drive-thru", "Lobby"] },
  { id: "ryan", name: "Ryan", role: "Crew Trainer", status: "Needs fries refresh", station: "Kitchen", next: "Today 16:00 - 23:00", stars: 7, badge: "Trainer", training: "Fries refresh 31%", strengths: ["Kitchen", "Line", "Coaching"] },
  { id: "maya", name: "Maya", role: "Crew Member", status: "New starter", station: "Lobby", next: "Tomorrow 09:00 - 17:00", stars: 1, badge: "New Starter", training: "First Shift 35%", strengths: ["Friendly", "Learning fast", "Lobby"] },
  { id: "leo", name: "Leo", role: "Manager", status: "Ready", station: "Shift Lead", next: "Today 12:00 - 20:00", stars: 9, badge: "Shift Lead", training: "Rush Planning 88%", strengths: ["Leadership", "Kitchen", "Rush planning"] },
  { id: "sophia", name: "Sophia", role: "Crew Member", status: "Steady", station: "Drive-thru", next: "Friday 15:00 - 22:00", stars: 5, badge: "Drive-thru Pro", training: "Drive-thru 72%", strengths: ["Headset", "Runner", "Drinks"] },
  { id: "adam", name: "Adam", role: "Crew Member", status: "Learning", station: "Grill", next: "Saturday 10:00 - 18:00", stars: 3, badge: "Kitchen Path", training: "Grill 54%", strengths: ["Grill", "Stock", "Chicken"] }
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
function safe(v) { return String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }

function normalRole(role) {
  const r = String(role || "crew").toLowerCase().replace(/\s+/g, "");
  if (r === "shiftcreator") return "shiftCreator";
  if (r === "manager") return "manager";
  return "crew";
}

function roleLabel(role) {
  const r = normalRole(role);
  if (r === "shiftCreator") return "Shift Creator";
  if (r === "manager") return "Manager";
  return "Crew Member";
}

function getSessionUser() {
  try {
    const user = JSON.parse(localStorage.getItem("mc_session_user") || "null");
    if (!user || !user.id || !user.role) return null;
    const id = String(user.id || "");
    if (["pitch-user", "test-profile", "demo-manager-001", "demo-crew-001"].includes(id) || id.startsWith("demo-")) return null;
    user.role = normalRole(user.role);
    return user;
  } catch {
    return null;
  }
}

function requireSession() {
  const user = getSessionUser();
  if (!user) {
    localStorage.removeItem("mc_session_user");
    window.location.href = "index.html";
    return null;
  }
  return user;
}

function isManagerLike(user) {
  const r = normalRole(user?.role);
  return r === "manager" || r === "shiftCreator";
}

function findProfile(user) {
  const name = String(user?.name || "").trim().toLowerCase();
  return crew.find((c) => c.name.toLowerCase() === name) || crew.find((c) => c.name.toLowerCase().startsWith(name)) || {
    id: user?.id || "me",
    name: user?.name || "Crew Member",
    role: roleLabel(user?.role),
    status: normalRole(user?.role) === "crew" ? "Ready to learn" : "Ready",
    station: normalRole(user?.role) === "crew" ? "Front Counter" : "Shift Lead",
    next: normalRole(user?.role) === "crew" ? "Today 14:00 - 22:00" : "Today 12:00 - 20:00",
    stars: Number(user?.stars ?? (normalRole(user?.role) === "crew" ? 0 : 5)),
    badge: user?.badge || (normalRole(user?.role) === "crew" ? "Crew Path" : "Manager"),
    training: normalRole(user?.role) === "crew" ? "First Shift 35%" : "Rush Planning 88%",
    strengths: normalRole(user?.role) === "crew" ? ["Learning", "Teamwork", "Service"] : ["Planning", "Support", "Leadership"]
  };
}

function toast(msg) {
  const t = qs("toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2200);
}

function initChrome(activePage = "dashboard") {
  const user = requireSession();
  if (!user) return null;
  const profile = findProfile(user);
  const role = roleLabel(user.role);

  qs("sidebarUserName") && (qs("sidebarUserName").textContent = user.name || profile.name);
  qs("sidebarUserRole") && (qs("sidebarUserRole").innerHTML = `${role}<br><span class="pill" style="margin-top:7px;">⭐ ${profile.stars} McStars</span>`);
  qs("avatarCircle") && (qs("avatarCircle").textContent = (user.name || profile.name || "U").charAt(0).toUpperCase());
  qs("roleBadge") && (qs("roleBadge").textContent = role);
  qs("welcomeTitle") && (qs("welcomeTitle").textContent = `Welcome back, ${(user.name || profile.name || "Crew").split(" ")[0]}`);

  document.querySelectorAll(".nav a").forEach((a) => a.classList.toggle("active", a.dataset.page === activePage));
  const navShiftCreator = qs("navShiftCreator");
  if (navShiftCreator) navShiftCreator.style.display = isManagerLike(user) ? "flex" : "none";

  const sidebar = qs("sidebar");
  const toggle = qs("sidebarToggle");
  if (sidebar && toggle && !toggle.dataset.ready) {
    toggle.dataset.ready = "1";
    toggle.addEventListener("click", () => sidebar.classList.toggle("open"));
  }

  const logout = qs("logoutBtn");
  if (logout && !logout.dataset.ready) {
    logout.dataset.ready = "1";
    logout.addEventListener("click", () => {
      localStorage.setItem("mc_force_logout", "1");
      localStorage.removeItem("mc_session_user");
      window.location.href = "index.html";
    });
  }

  return { user, profile };
}

function profileCard(c, compact = false) {
  return `
    <article class="mini profile-card" data-profile="${safe(c.id)}" style="cursor:pointer;transition:.18s;">
      <div class="between wrap">
        <div class="row"><div class="logo" style="width:46px;height:46px;font-size:1.1rem;">${safe(c.name.charAt(0))}</div><div><h3 style="margin-bottom:2px;">${safe(c.name)}</h3><p class="muted">${safe(c.role)} • ${safe(c.station)}</p></div></div>
        <span class="pill">⭐ ${c.stars}</span>
      </div>
      ${compact ? "" : `<div class="grid two" style="margin-top:12px;"><span class="pill ${c.status.includes("Needs") ? "warn" : c.status.includes("New") ? "bad" : "ok"}">${safe(c.status)}</span><span class="pill">${safe(c.badge)}</span></div><p class="muted" style="margin-top:10px;">Next: ${safe(c.next)}</p>`}
    </article>
  `;
}

function profileModalHTML() {
  return `<div id="profileModal" class="modal"><div class="modal-card"><div class="between wrap"><h3>Profile</h3><button id="profileModalClose" class="btn alt" type="button">Close</button></div><div id="profileModalBody" style="margin-top:14px;"></div></div></div>`;
}

function openProfile(profileId) {
  const c = crew.find((p) => p.id === profileId) || findProfile(getSessionUser());
  const modal = qs("profileModal");
  const body = qs("profileModalBody");
  if (!modal || !body) return;
  body.innerHTML = `
    <div class="between wrap"><div class="row"><div class="logo" style="width:64px;height:64px;">${safe(c.name.charAt(0))}</div><div><h2>${safe(c.name)}</h2><p class="muted">${safe(c.role)} • ${safe(c.badge)}</p></div></div><span class="pill" style="font-size:1rem;">⭐ ${c.stars} McStars</span></div>
    <div class="grid two" style="margin-top:16px;"><div class="mini"><b>Status</b><br><span class="muted">${safe(c.status)}</span></div><div class="mini"><b>Main station</b><br><span class="muted">${safe(c.station)}</span></div><div class="mini"><b>Next shift</b><br><span class="muted">${safe(c.next)}</span></div><div class="mini"><b>Training</b><br><span class="muted">${safe(c.training)}</span></div></div>
    <div class="card" style="margin-top:16px;box-shadow:none;"><h3>Strengths</h3><div class="hero-actions" style="margin-top:10px;">${c.strengths.map((s) => `<span class="pill ok">${safe(s)}</span>`).join("")}</div></div>`;
  modal.classList.add("show");
}

function attachProfileEvents() {
  document.querySelectorAll("[data-profile]").forEach((card) => {
    if (card.dataset.ready) return;
    card.dataset.ready = "1";
    card.addEventListener("click", () => openProfile(card.dataset.profile));
  });
  qs("profileModalClose")?.addEventListener("click", () => qs("profileModal")?.classList.remove("show"));
  qs("profileModal")?.addEventListener("click", (e) => { if (e.target.id === "profileModal") e.currentTarget.classList.remove("show"); });
}

function renderManagerDashboard(user, profile) {
  const totalStars = crew.reduce((sum, c) => sum + c.stars, 0);
  qs("welcomeSubtitle") && (qs("welcomeSubtitle").textContent = "Manager view: staffing, training, McStars, profiles and shift risk.");
  const heroActions = document.querySelector(".hero .hero-actions");
  if (heroActions) heroActions.innerHTML = `<a class="btn" href="schedule.html">📅 Check shift risk</a><a class="btn alt" href="training.html">🎓 View training gaps</a><button class="btn dark" onclick="document.getElementById('aiInput').value='Generate next week shifts';document.getElementById('aiForm').requestSubmit();">🤖 Generate shifts</button>`;
  const topCards = qs("topCards");
  if (topCards) topCards.innerHTML = `<article class="card stat"><span>Staff on shift</span><strong>18</strong><p class="muted">2 more useful for dinner rush</p></article><article class="card stat"><span>Total McStars</span><strong>${totalStars}</strong><p class="muted">Across crew profiles</p></article><article class="card stat"><span>Training gaps</span><strong>4</strong><p class="muted">Food safety + fries refresh</p></article><article class="card stat"><span>Shift coverage</span><strong>91%</strong><p class="muted">Friday evening needs review</p></article>`;
  const bottom = qs("bottomSection");
  if (bottom) bottom.innerHTML = `<div class="between wrap"><div><h3>Manager command centre</h3><p class="muted">Crew profiles, McStars, training status and station readiness in one place.</p></div><span class="pill ok">Manager view</span></div><div class="grid two" style="margin-top:14px;"><div class="mini"><h3>Today’s manager priorities</h3><ul style="margin:10px 0 0 18px;line-height:1.8;color:var(--muted);font-weight:800;"><li>Move Ryan to fries refresh before peak.</li><li>Pair Maya with Amelia for first 60 minutes.</li><li>Use McStars to recognise strong teamwork.</li></ul></div><div class="mini"><h3>McStars leaderboard</h3><div class="grid" style="margin-top:10px;">${[...crew].sort((a,b)=>b.stars-a.stars).map((c,i)=>`<div class="between"><span><b>#${i+1} ${safe(c.name)}</b><br><small class="muted">${safe(c.badge)} • ${safe(c.station)}</small></span><span class="pill">⭐ ${c.stars}</span></div>`).join("")}</div></div></div><div class="card" style="margin-top:16px;box-shadow:none;"><div class="between wrap"><div><h3>Everyone’s profiles</h3><p class="muted">Click a profile to see role, stars, next shift, training and strengths.</p></div><span class="pill">${crew.length} profiles</span></div><div class="grid three" style="margin-top:14px;">${crew.map((c)=>profileCard(c)).join("")}</div></div>${profileModalHTML()}`;
  attachProfileEvents();
}

function renderCrewDashboard(user, profile) {
  const points = Number(localStorage.getItem("reward_points") || 4);
  qs("welcomeSubtitle") && (qs("welcomeSubtitle").textContent = "Crew view: your shifts, stars, training and rewards — no manager tools.");
  const heroActions = document.querySelector(".hero .hero-actions");
  if (heroActions) heroActions.innerHTML = `<a class="btn" href="schedule.html">📅 My shifts</a><a class="btn alt" href="training.html">🎓 My training</a><a class="btn dark" href="break-rewards.html">🍔 My rewards</a>`;
  const topCards = qs("topCards");
  if (topCards) topCards.innerHTML = `<article class="card stat"><span>My next shift</span><strong style="font-size:1.35rem;">${safe(profile.next.split(" - ")[0])}</strong><p class="muted">${safe(profile.station)}</p></article><article class="card stat"><span>My McStars</span><strong>⭐ ${profile.stars}</strong><p class="muted">${safe(profile.badge)}</p></article><article class="card stat"><span>Training</span><strong style="font-size:1.35rem;">${safe(profile.training)}</strong><p class="muted">Open modules to improve</p></article><article class="card stat"><span>Break points</span><strong>${points}</strong><p class="muted">Spend in Break Rewards</p></article>`;
  const bottom = qs("bottomSection");
  if (bottom) bottom.innerHTML = `<div class="between wrap"><div><h3>My crew dashboard</h3><p class="muted">This is the crew member page. It shows only your useful info: profile, stars, shifts, training and rewards.</p></div><span class="pill ok">Crew view</span></div><div class="grid two" style="margin-top:14px;"><div class="card" style="box-shadow:none;"><h3>My profile</h3>${profileCard(profile)}<div class="hero-actions"><button class="btn" data-profile="${safe(profile.id)}" type="button">View full profile</button><a class="btn alt" href="module.html?id=first-shift">Continue training</a></div></div><div class="card" style="box-shadow:none;"><h3>What should I do next?</h3><div class="grid" style="margin-top:12px;"><div class="mini between"><span>Check your next shift</span><a class="btn alt" href="schedule.html">Open</a></div><div class="mini between"><span>Complete one training module</span><a class="btn alt" href="training.html">Open</a></div><div class="mini between"><span>Use break rewards</span><a class="btn alt" href="break-rewards.html">Open</a></div></div></div></div><div class="card" style="margin-top:16px;box-shadow:none;"><div class="between wrap"><div><h3>Team profiles</h3><p class="muted">Crew can see team profiles and McStars, but not manager shift tools.</p></div><span class="pill">⭐ McStars</span></div><div class="grid three" style="margin-top:14px;">${crew.filter((c)=>c.id!==profile.id).map((c)=>profileCard(c,true)).join("")}</div></div>${profileModalHTML()}`;
  attachProfileEvents();
}

function renderDashboard() {
  const user = getSessionUser();
  if (!user) return;
  const profile = findProfile(user);
  if (isManagerLike(user)) renderManagerDashboard(user, profile);
  else renderCrewDashboard(user, profile);
}

function renderRewards() {
  const grid = qs("menuGrid");
  if (!grid) return;
  let points = Number(localStorage.getItem("reward_points") || 4);
  let total = 0;
  const update = () => { qs("pointsNow") && (qs("pointsNow").textContent = points); qs("cartTotal") && (qs("cartTotal").textContent = total); };
  grid.innerHTML = menu.map(m => `<article class="mini"><div style="font-size:2rem">${m.emoji}</div><h3>${safe(m.item)}</h3><p class="muted">${m.cost} break point${m.cost > 1 ? "s" : ""}</p><button class="btn alt add-food" data-item="${safe(m.item)}" data-cost="${m.cost}" type="button">Add</button></article>`).join("");
  document.querySelectorAll(".add-food").forEach(btn => btn.addEventListener("click", () => { const cost = Number(btn.dataset.cost); if (total + cost > points) return toast("Cart is over your available points"); total += cost; qs("cartList")?.insertAdjacentHTML("beforeend", `<div class="mini between"><span>${safe(btn.dataset.item)}</span><b>${cost} pts</b></div>`); update(); }));
  qs("claimBonusBtn")?.addEventListener("click", () => { points += 1; localStorage.setItem("reward_points", String(points)); update(); toast("Bonus point added"); });
  qs("clearCartBtn")?.addEventListener("click", () => { total = 0; if (qs("cartList")) qs("cartList").innerHTML = ""; update(); });
  qs("checkoutBtn")?.addEventListener("click", () => { if (total <= 0) return toast("Add something first"); points -= total; total = 0; localStorage.setItem("reward_points", String(points)); if (qs("cartList")) qs("cartList").innerHTML = ""; update(); toast("Break order saved"); });
  update();
}

function addMsg(who, text) {
  const chat = qs("aiChat");
  if (!chat) return;
  const div = document.createElement("div");
  div.className = `msg ${who}`;
  div.innerHTML = `<div class="bubble">${safe(text)}</div>`;
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
}

function initChat() {
  const chat = qs("aiChat");
  const form = qs("aiForm");
  const input = qs("aiInput");
  if (!chat || !form || !input || window.McLive) return;
  if (!chat.dataset.ready) { addMsg("bot", "Hi, I’m McAssist 👋 Ask me about shifts, training, McStars, profiles or rewards."); chat.dataset.ready = "1"; }
  if (!form.dataset.pitchReady) {
    form.dataset.pitchReady = "1";
    form.addEventListener("submit", (e) => { e.preventDefault(); const text = input.value.trim(); if (!text) return; addMsg("user", text); input.value = ""; setTimeout(() => addMsg("bot", "I can help with shifts, training, rewards, crew profiles and McStars."), 250); });
  }
}

function initAuth() {}
function saveDemoSession() {}

function initPage(page) {
  const state = initChrome(page);
  if (!state) return;
  initChat();
  if (page === "dashboard") renderDashboard();
  if (page === "rewards") renderRewards();
}

window.McPitch = { initPage, initAuth, toast, saveDemoSession, renderDashboard, openProfile, getSessionUser, isManagerLike };
