import { auth, db } from "./firebase-init.js";
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  updateProfile,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const V2 = {
  data: null,
  dataAt: 0,
  enhancing: false,
  listenerInstalled: false,
  chatBusy: false,
};

const $ = (id) => document.getElementById(id);
const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]);

const params = new URLSearchParams(location.search);
const preview = params.get("preview");
const path = location.pathname.split("/").pop() || "main.html";

function normaliseRole(role) {
  const value = String(role || "").toLowerCase().replace(/[\s_-]/g, "");
  if (["manager", "shiftcreator", "admin"].includes(value)) return "manager";
  if (["crewtrainer", "trainer"].includes(value)) return "crewTrainer";
  return "crew";
}

function roleLabel(role) {
  const value = normaliseRole(role);
  return value === "manager" ? "Manager" : value === "crewTrainer" ? "Crew Trainer" : "Crew Member";
}

function initials(name) {
  return String(name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "?";
}

function formatDate(value) {
  if (!value) return "—";
  try {
    return new Date(value + (String(value).length === 10 ? "T12:00:00" : "")).toLocaleDateString("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
    });
  } catch {
    return String(value);
  }
}

function waitForUser() {
  if (auth.currentUser) return Promise.resolve(auth.currentUser);
  return new Promise((resolve) => {
    const off = onAuthStateChanged(auth, (user) => {
      off();
      resolve(user);
    });
  });
}

async function api(pathname, options = {}) {
  const user = await waitForUser();
  if (!user) throw new Error("Sign in to continue.");
  const token = await user.getIdToken();
  const response = await fetch(pathname, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || data.reply || "Request failed.");
  return data;
}

async function clientFallbackData() {
  const user = await waitForUser();
  if (!user) throw new Error("Sign in to continue.");
  const profileSnap = await getDoc(doc(db, "users", user.uid));
  if (!profileSnap.exists()) throw new Error("Crew profile not found.");
  const profile = { id: user.uid, ...profileSnap.data() };
  profile.role = normaliseRole(profile.role);
  profile.roleLabel = roleLabel(profile.role);
  profile.verifiedStations = Array.isArray(profile.verifiedStations) ? profile.verifiedStations : [];

  const team = [];
  if (["manager", "crewTrainer"].includes(profile.role)) {
    try {
      const snap = await getDocs(query(collection(db, "users"), where("storeId", "==", profile.storeId)));
      snap.forEach((d) => {
        const value = { id: d.id, ...d.data() };
        value.role = normaliseRole(value.role);
        value.roleLabel = roleLabel(value.role);
        value.verifiedStations = Array.isArray(value.verifiedStations) ? value.verifiedStations : [];
        team.push(value);
      });
    } catch {}
  }

  return {
    profile,
    team,
    shifts: [],
    progress: {},
    verifications: [],
    roleRequests: [],
    permissions: {
      canPlanShifts: profile.role === "manager",
      canVerify: profile.role === "crewTrainer",
      canSeeTeam: ["manager", "crewTrainer"].includes(profile.role),
    },
  };
}

function previewData() {
  const role = preview === "manager" ? "manager" : "crew";
  return {
    profile: {
      id: "preview-self",
      name: "Cosmin Blidaru",
      role,
      roleLabel: roleLabel(role),
      storeId: "1170",
      storeName: "1170 · Hayle",
      stars: 12,
      badge: "Team player",
      verifiedStations: ["Fries", "Front Counter"],
      notes: "Ready for the next station.",
    },
    team: role === "manager"
      ? [
          { id: "preview-a", name: "Amelia Wilson", role: "crew", roleLabel: "Crew Member", stars: 7, verifiedStations: ["Fries"] },
          { id: "preview-b", name: "Ryan Davies", role: "crew", roleLabel: "Crew Member", stars: 5, verifiedStations: [] },
        ]
      : [],
    shifts: [],
    progress: { "first-shift": { completed: true } },
    verifications: [],
    roleRequests: [],
    permissions: { canPlanShifts: role === "manager", canVerify: false, canSeeTeam: role === "manager" },
  };
}

async function loadData(force = false) {
  if (preview) return previewData();
  if (!force && V2.data && Date.now() - V2.dataAt < 12000) return V2.data;
  try {
    V2.data = await api("/api/portal-data");
  } catch (error) {
    console.warn("V2 portal-data API unavailable, using browser data fallback", error);
    V2.data = await clientFallbackData();
  }
  V2.dataAt = Date.now();
  return V2.data;
}

function pageFor(name) {
  const map = {
    home: "/main.html",
    schedule: "/schedule.html",
    training: "/training.html",
    availability: "/main.html?view=availability",
    rewards: "/break-rewards.html",
    assistant: "/main.html?view=assistant",
    team: "/admin.html",
    manage: "/shifts-admin.html",
    verification: "/verification.html",
  };
  let url = map[name] || "/main.html";
  if (preview) url += (url.includes("?") ? "&" : "?") + "preview=" + encodeURIComponent(preview);
  return url;
}

function isAssistantRoute() {
  return params.get("view") === "assistant";
}

function isTrainingRoute() {
  return path === "training.html" && !params.get("id");
}

function isVerificationRoute() {
  return path === "verification.html";
}

function setActiveNav(href) {
  document.querySelectorAll(".side-nav a").forEach((a) => a.classList.remove("active"));
  const target = document.querySelector('.side-nav a[href="' + href + '"]');
  target?.classList.add("active");
}

function applyRoleUI(data) {
  const role = data.profile.role;
  const sideSmall = document.querySelector(".side-profile small");
  if (sideSmall) {
    const store = data.profile.storeName || data.profile.storeId || "";
    sideSmall.textContent = roleLabel(role) + (store ? " · " + store : "");
  }

  const sideNav = document.querySelector(".side-nav");
  if (sideNav && !sideNav.querySelector(".v2-nav-link")) {
    const assistant = [...sideNav.querySelectorAll("a")].find((a) => a.textContent.includes("McAssist"));
    const link = document.createElement("a");
    link.className = "v2-nav-link";
    link.href = pageFor("verification");
    const verifyLabel = role === "crewTrainer"
      ? "Verify crew"
      : role === "manager"
        ? "Verifications"
        : "My verifications";
    link.innerHTML =
      '<svg class="icon" aria-hidden="true" viewBox="0 0 24 24"><path d="m12 3 8 3v7c0 5-8 9-8 9s-8-4-8-9V6l8-3Zm-4 9 3 3 5-5"/></svg><span>' + esc(verifyLabel) + '</span>';
    sideNav.insertBefore(link, assistant || null);
  }

  const mobileNav = document.querySelector(".mobile-nav");
  if (mobileNav && !mobileNav.querySelector(".v2-mobile-verify")) {
    const link = document.createElement("a");
    link.className = "v2-mobile-verify";
    link.href = pageFor("verification");
    link.innerHTML =
      '<svg class="icon" aria-hidden="true" viewBox="0 0 24 24"><path d="m12 3 8 3v7c0 5-8 9-8 9s-8-4-8-9V6l8-3Zm-4 9 3 3 5-5"/></svg><span>Verify</span>';
    mobileNav.appendChild(link);
  }

  if (isVerificationRoute()) {
    const href = pageFor("verification");
    setActiveNav(href);
    document.querySelector(".v2-mobile-verify")?.classList.add("active");
  }

  if (isAssistantRoute()) setActiveNav(pageFor("assistant"));

  const profileButton = $("profileButton");
  if (profileButton) {
    profileButton.textContent = initials(data.profile.name).slice(0, 1);
    profileButton.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      showProfile(data.profile, data);
    };
  }

  installTeamProfileCapture();
}

function nextShiftFor(profile, data) {
  const now = new Date();
  const shifts = (data.shifts || []).filter((s) => s.userId === profile.id);
  const next = shifts
    .filter((s) => {
      if (!s.date || !s.start) return false;
      const d = new Date(s.date + "T" + s.start + ":00");
      return d >= now;
    })
    .sort((a, b) => String(a.date + a.start).localeCompare(String(b.date + b.start)))[0];
  return next ? formatDate(next.date) + " " + next.start + "–" + next.end : "No upcoming shift loaded";
}

function trainingStatus(profile, data) {
  if (profile.id !== data.profile.id) {
    const count = (profile.verifiedStations || []).length;
    return count ? count + " station" + (count === 1 ? "" : "s") + " verified" : "No station verifications yet";
  }
  const modules = window.McModules?.modules || [];
  const done = Object.values(data.progress || {}).filter((p) => p?.completed).length;
  return modules.length ? done + " of " + modules.length + " learning modules completed" : "Learning ready";
}

function showProfile(profile, data) {
  const modal = $("modal");
  if (!modal) return;
  modal.classList.add("v2-profile-dialog");
  modal.addEventListener("close", () => modal.classList.remove("v2-profile-dialog"), { once: true });
  const stations = (profile.verifiedStations || []).length
    ? profile.verifiedStations.join(", ")
    : "No stations yet";
  const pending =
    profile.id === data.profile.id &&
    profile.roleRequestStatus === "pending" &&
    profile.requestedRole
      ? '<span class="role-chip pending">Pending ' + esc(roleLabel(profile.requestedRole)) + " approval</span>"
      : "";
  const roleClass = profile.role === "manager" ? "manager" : profile.role === "crewTrainer" ? "trainer" : "";
  const canStartVerify =
    data.permissions?.canVerify &&
    profile.id !== data.profile.id &&
    normaliseRole(profile.role) === "crew";
  const actions =
    '<div class="v2-profile-actions">' +
    (canStartVerify
      ? '<a class="btn" href="' + pageFor("verification") + "?crewId=" + encodeURIComponent(profile.id) + '">Verify station</a>'
      : "") +
    (profile.id === data.profile.id
      ? '<a class="btn light" href="' + pageFor("availability") + '">Availability</a><button class="btn dark" id="v2ProfileLogout" type="button">Sign out</button>'
      : "") +
    "</div>";

  modal.innerHTML =
    '<section class="v2-profile-card">' +
      '<button class="v2-profile-close" id="v2ProfileClose" aria-label="Close">×</button>' +
      '<div class="v2-profile-avatar">' + esc(initials(profile.name).slice(0, 1)) + "</div>" +
      "<h2>" + esc(profile.name || "Crew member") + "</h2>" +
      '<div class="v2-profile-sub">' + esc(roleLabel(profile.role)) + "</div>" +
      '<div class="v2-profile-store">' + esc(profile.storeName || ("Store " + (profile.storeId || "—"))) + "</div>" +
      '<div style="margin-top:8px">' + pending + "</div>" +
      '<div class="v2-profile-table">' +
        '<div class="v2-profile-row"><span>Training status</span><span>' + esc(trainingStatus(profile, data)) + "</span></div>" +
        '<div class="v2-profile-row"><span>Badge</span><span>' + esc(profile.badge || "No badge set") + "</span></div>" +
        '<div class="v2-profile-row"><span>McStars</span><span>☆ ' + esc(Number(profile.stars) || 0) + "</span></div>" +
        '<div class="v2-profile-row"><span>Next shift</span><span>' + esc(nextShiftFor(profile, data)) + "</span></div>" +
        '<div class="v2-profile-row"><span>Stations</span><span>' + esc(stations) + "</span></div>" +
      "</div>" +
      '<div class="v2-profile-notes"><label>Notes</label><textarea readonly>' + esc(profile.notes || "No notes yet.") + "</textarea></div>" +
      actions +
    "</section>";

  $("v2ProfileClose").onclick = () => modal.close();
  $("v2ProfileLogout")?.addEventListener("click", async () => {
    await signOut(auth);
    location.href = "/";
  });
  if (!modal.open) modal.showModal();
}

function installTeamProfileCapture() {
  if (V2.listenerInstalled) return;
  V2.listenerInstalled = true;
  document.addEventListener(
    "click",
    (event) => {
      const button = event.target.closest("[data-person]");
      if (!button || !V2.data?.team?.length) return;
      const person = V2.data.team.find((item) => item.id === button.dataset.person);
      if (!person) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      showProfile(person, V2.data);
    },
    true,
  );
}

function enhanceSignup() {
  if (path !== "signup.html") return;
  const form = $("authForm");
  if (!form || form.dataset.v2RolePicker === "1") return;
  form.dataset.v2RolePicker = "1";

  const storeField = $("storeId")?.closest(".field");
  if (!storeField) return;

  const oldNote = [...form.querySelectorAll(".form-note")].find((el) =>
    el.textContent.includes("New accounts join as crew"),
  );
  oldNote?.remove();

  const picker = document.createElement("div");
  picker.className = "v2-role-picker";
  picker.innerHTML =
    '<label>What is your role?</label>' +
    '<div class="v2-role-options">' +
      '<label class="v2-role-option"><input type="radio" name="v2Role" value="crew" checked><span>👤<b>Crew Member</b>My shifts and learning</span></label>' +
      '<label class="v2-role-option"><input type="radio" name="v2Role" value="crewTrainer"><span>🛡️<b>Crew Trainer</b>Training and verification</span></label>' +
      '<label class="v2-role-option"><input type="radio" name="v2Role" value="manager"><span>📋<b>Manager</b>Team and shift planning</span></label>' +
    "</div>" +
    '<p class="v2-role-note">Crew Trainer and Manager access is stored as a role request and must be approved by a Manager. This stops anyone creating an account and giving themselves elevated access.</p>';
  storeField.after(picker);

  form.onsubmit = async (event) => {
    event.preventDefault();
    const button = form.querySelector('[type="submit"]');
    const result = $("authResult");
    const data = new FormData(form);
    const selectedRole = normaliseRole(data.get("v2Role"));
    button.disabled = true;
    if (result) result.innerHTML = "";

    try {
      const credential = await createUserWithEmailAndPassword(
        auth,
        String(data.get("email") || ""),
        String(data.get("password") || ""),
      );
      await updateProfile(credential.user, { displayName: String(data.get("name") || "") });

      const baseProfile = {
        name: String(data.get("name") || "").trim(),
        email: credential.user.email,
        role: "crew",
        requestedRole: selectedRole === "crew" ? "" : selectedRole,
        roleRequestStatus: selectedRole === "crew" ? "approved" : "pending",
        storeId: String(data.get("storeId") || "").trim(),
        stars: 0,
        verifiedStations: [],
        createdAt: serverTimestamp(),
      };
      await setDoc(doc(db, "users", credential.user.uid), baseProfile);

      if (selectedRole !== "crew") {
        await setDoc(doc(db, "roleRequests", credential.user.uid), {
          uid: credential.user.uid,
          name: baseProfile.name,
          email: baseProfile.email,
          storeId: baseProfile.storeId,
          requestedRole: selectedRole,
          status: "pending",
          createdAt: serverTimestamp(),
        });
      }

      if (result) {
        result.innerHTML =
          '<div class="success">' +
          (selectedRole === "crew"
            ? "Account created. Opening your crew hub…"
            : roleLabel(selectedRole) + " requested. You can use Crew access until a Manager approves it.") +
          "</div>";
      }
      setTimeout(() => {
        location.href = "/main.html";
      }, 650);
    } catch (error) {
      if (result) result.innerHTML = '<div class="error">' + esc(error.message || "Could not create account.") + "</div>";
    } finally {
      button.disabled = false;
    }
  };
}

function moduleVisibleForRole(module, role) {
  if (!Array.isArray(module.roles) || !module.roles.length) return true;
  return module.roles.includes(normaliseRole(role));
}

function renderTraining(data) {
  if (!isTrainingRoute()) return;
  const content = $("content");
  if (!content || content.dataset.v2Training === "1") return;
  content.dataset.v2Training = "1";

  const allModules = (window.McModules?.modules || []).filter((m) =>
    moduleVisibleForRole(m, data.profile.role),
  );
  const categories = ["All", ...new Set(allModules.map((m) => m.category || "Essentials"))];
  const complete = Object.values(data.progress || {}).filter((p) => p?.completed).length;
  const percent = allModules.length ? Math.round((complete / allModules.length) * 100) : 0;

  content.innerHTML =
    '<section class="v2-training-head">' +
      '<div><div class="eyebrow">LEARN BY STATION</div><h1>Find what you need. Fast.</h1><p>Short, station-based learning without endless scrolling. Use search or pick a category, then open one focused module at a time.</p></div>' +
      '<div class="v2-training-progress"><strong>' + complete + "/" + allModules.length + '</strong><small>Modules completed · ' + percent + '%</small><div class="progress"><span style="width:' + percent + '%"></span></div></div>' +
    "</section>" +
    '<div class="v2-station-strip">' +
      [
        ["🍟", "Fries"],
        ["🔥", "Grill"],
        ["🍗", "Chicken"],
        ["🚗", "Drive-thru"],
        ["🧾", "Front counter"],
      ].map((item) => '<button class="v2-station-chip" type="button" data-station-search="' + esc(item[1]) + '"><span>' + item[0] + "</span><b>" + esc(item[1]) + "</b></button>").join("") +
    "</div>" +
    '<section class="v2-training-toolbar">' +
      '<div class="v2-training-search"><input id="v2TrainingSearch" type="search" placeholder="Search grill, chicken, allergens, drive-thru…" autocomplete="off"></div>' +
      '<div class="v2-category-tabs" id="v2CategoryTabs">' +
        categories.map((category, i) => '<button type="button" data-category="' + esc(category) + '" class="' + (i === 0 ? "active" : "") + '">' + esc(category) + "</button>").join("") +
      "</div>" +
    "</section>" +
    '<div class="v2-learning-grid" id="v2LearningGrid"></div>';

  let activeCategory = "All";
  const search = $("v2TrainingSearch");
  const grid = $("v2LearningGrid");

  const draw = () => {
    const q = String(search?.value || "").trim().toLowerCase();
    const filtered = allModules.filter((m) => {
      const catMatch = activeCategory === "All" || (m.category || "Essentials") === activeCategory;
      const text = [m.title, m.tagline, m.category, m.station, ...(m.keywords || [])].join(" ").toLowerCase();
      return catMatch && (!q || text.includes(q));
    });

    grid.innerHTML = filtered.length
      ? filtered.map((m) => {
          const done = Boolean(data.progress?.[m.id]?.completed);
          return (
            '<article class="v2-module-card">' +
              '<div class="v2-module-top"><span class="v2-module-icon">' + esc(m.icon) + '</span><span class="v2-module-category">' + esc(m.category || "Essentials") + "</span></div>" +
              "<h3>" + esc(m.title) + "</h3>" +
              "<p>" + esc(m.tagline) + "</p>" +
              '<div class="v2-module-meta"><span>' + esc(m.time) + " · " + esc(m.xp) + ' XP</span><span class="pill ' + (done ? "green" : "") + '">' + (done ? "Completed" : esc(m.level)) + "</span></div>" +
              '<div class="v2-module-actions"><a class="btn ' + (done ? "light" : "soft") + '" href="/module.html?id=' + encodeURIComponent(m.id) + '">' + (done ? "Review" : "Open module") + "</a></div>" +
            "</article>"
          );
        }).join("")
      : '<div class="v2-empty-search"><b>No modules found.</b><br>Try a different station or keyword.</div>';
  };

  search?.addEventListener("input", draw);
  $("v2CategoryTabs")?.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      activeCategory = button.dataset.category;
      $("v2CategoryTabs").querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === button));
      draw();
    });
  });
  content.querySelectorAll("[data-station-search]").forEach((button) => {
    button.addEventListener("click", () => {
      if (search) search.value = button.dataset.stationSearch;
      activeCategory = "All";
      $("v2CategoryTabs")?.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.category === "All"));
      draw();
      search?.focus();
    });
  });
  draw();
}

function getStoredChat(uid) {
  try {
    return JSON.parse(sessionStorage.getItem("mc_v2_chat_" + uid) || "[]");
  } catch {
    return [];
  }
}

function saveStoredChat(uid, items) {
  sessionStorage.setItem("mc_v2_chat_" + uid, JSON.stringify(items.slice(-30)));
}

function renderV2Chat(profile) {
  const chat = $("chat");
  if (!chat) return;
  const items = getStoredChat(profile.id);
  const messages = items.length
    ? items
    : [{ role: "assistant", content: "Hey " + String(profile.name || "there").split(" ")[0] + " 👋 Ask me about your live shifts, learning, availability, or anything your role allows me to change." }];
  chat.innerHTML =
    messages.map((item) =>
      '<div><div class="chat-label" style="' + (item.role === "user" ? "text-align:right" : "") + '">' +
        (item.role === "user" ? "YOU" : "MCASSIST") +
      '</div><div class="message ' + (item.role === "user" ? "user" : "") + '">' + esc(item.content) + "</div></div>",
    ).join("") +
    (V2.chatBusy ? '<div class="message">Working on it…</div>' : "");
  chat.scrollTop = chat.scrollHeight;
}

function handleUiAction(action) {
  if (!action) return;
  if (action.type === "openVerification" && action.id) {
    V2.data = null;
    setTimeout(() => {
      location.href = "/verification.html?id=" + encodeURIComponent(action.id);
    }, 550);
    return;
  }
  if (action.type === "openPage" && action.page) {
    V2.data = null;
    setTimeout(() => {
      location.href = pageFor(action.page);
    }, 550);
  }
}

async function sendV2Chat(data, message) {
  const profile = data.profile;
  const items = getStoredChat(profile.id);
  items.push({ role: "user", content: message });
  saveStoredChat(profile.id, items);
  V2.chatBusy = true;
  renderV2Chat(profile);

  try {
    const response = await api("/api/ai-chat", {
      method: "POST",
      body: JSON.stringify({
        message,
        history: items.slice(-10),
        appContext: { page: "assistant" },
      }),
    });
    items.push({ role: "assistant", content: response.reply || "Done." });
    if (response.dataChanged) {
      V2.data = null;
      V2.dataAt = 0;
    }
    saveStoredChat(profile.id, items);
    handleUiAction(response.uiAction);
  } catch (error) {
    items.push({ role: "assistant", content: error.message || "McAssist could not complete that." });
    saveStoredChat(profile.id, items);
  } finally {
    V2.chatBusy = false;
    renderV2Chat(profile);
  }
}

function renderAssistant(data) {
  if (!isAssistantRoute()) return;
  const content = $("content");
  const assistant = $("assistant");
  if (!content || !assistant || content.dataset.v2Assistant === "1") return;
  content.dataset.v2Assistant = "1";

  const role = data.profile.role;
  const firstCrew = data.team?.find((person) => normaliseRole(person.role) === "crew")?.name || "Alex";
  const commands = [
    ["My next shift", "What is my next shift and station?"],
    ["Update availability", "Set my Friday availability to 16:00-23:00"],
    ["Learn a station", "Teach me the chicken station basics"],
  ];
  if (role === "crewTrainer") commands.push(["Start verification", "Verify " + firstCrew + " on fries"]);
  if (role === "manager") {
    commands.push(["Plan a shift", "Plan a shift for " + firstCrew + " tomorrow from 16:00 to 23:00 on Fries with a 30 minute break"]);
    commands.push(["Set hourly rate", "Set " + firstCrew + " hourly rate to £13.55"]);
    commands.push(["Promote member", "Promote " + firstCrew + " to Crew Trainer"]);
    commands.push(["Multi-action", "Set " + firstCrew + " hourly rate to £13.55, add a note saying strong progress, and give them 3 McStars"]);
    commands.push(["Team check", "Who is working tomorrow and what stations are they on?"]);
  }

  content.innerHTML =
    '<div class="v2-assistant-page">' +
      '<section class="v2-assistant-hero">' +
        '<div class="eyebrow">MCASSIST · LIVE CREW DATA</div>' +
        "<h1>Ask it. Do it. Keep moving.</h1>" +
        "<p>McAssist now uses your approved role and live Firestore data. It can read what you are allowed to see and perform only the actions your role is allowed to do.</p>" +
        '<div class="v2-assistant-capabilities">' +
          '<span>✓ Live shifts</span><span>✓ Learning</span><span>✓ Availability</span>' +
          (data.permissions?.canVerify ? "<span>✓ Crew verification</span>" : "") +
          (data.permissions?.canPlanShifts ? "<span>✓ Shift planning</span><span>✓ Pay rates</span><span>✓ Roles</span><span>✓ Profiles</span><span>✓ McStars</span>" : "") +
        "</div>" +
      "</section>" +
      '<div class="v2-assistant-shell"><div id="v2AssistantMount"></div>' +
        '<aside class="v2-command-panel"><div class="v2-data-badge">Firestore connected</div><h3 style="margin-top:14px">Try a command</h3><p>Commands use the same role rules as the rest of the crew hub.</p><div class="v2-command-list">' +
          commands.map((item) => '<button class="v2-command" type="button" data-v2-command="' + esc(item[1]) + '"><b>' + esc(item[0]) + "</b>" + esc(item[1]) + "</button>").join("") +
        "</div></aside>" +
      "</div>" +
    "</div>";

  $("v2AssistantMount").appendChild(assistant);
  assistant.querySelector(".assistant-head small").textContent = roleLabel(role) + " access";
  const aiNote = assistant.querySelector(".ai-note");
  if (aiNote) aiNote.textContent = role === "manager"
    ? "Manager actions write directly to Firestore through validated server tools and are recorded in the McAssist audit log."
    : "McAssist can only perform actions allowed by your approved role. Exact store procedures still come from official restaurant guidance.";

  const form = $("chatForm");
  const input = $("chatInput");
  if (form && input) {
    form.onsubmit = async (event) => {
      event.preventDefault();
      if (V2.chatBusy) return;
      const message = input.value.trim();
      if (!message) return;
      input.value = "";
      await sendV2Chat(data, message);
    };
  }

  assistant.querySelectorAll("[data-prompt]").forEach((button) => {
    button.onclick = () => {
      input.value = button.dataset.prompt;
      form.requestSubmit();
    };
  });

  content.querySelectorAll("[data-v2-command]").forEach((button) => {
    button.addEventListener("click", () => {
      input.value = button.dataset.v2Command;
      form.requestSubmit();
    });
  });

  renderV2Chat(data.profile);
}

function statusLabel(v) {
  return v.status === "verified" ? "Verified" : "Needs signatures";
}

function renderVerificationList(container, verifications) {
  container.innerHTML = verifications.length
    ? verifications.map((v) =>
        '<a class="v2-verification-row" href="/verification.html?id=' + encodeURIComponent(v.id) + '">' +
          '<div class="v2-module-icon">✓</div><div class="grow"><b>' + esc(v.crewName || "Crew member") + '</b><small>' + esc(v.station || "Station") + " · Trainer: " + esc(v.trainerName || "—") + '</small></div><span class="v2-verify-status ' + (v.status === "verified" ? "done" : "") + '">' + esc(statusLabel(v)) + "</span>" +
        "</a>",
      ).join("")
    : '<div class="empty">Nothing here yet.</div>';
}

async function renderVerificationQueue(data) {
  const content = $("content");
  if (!content) return;
  const role = data.profile.role;
  const verifications = data.verifications || [];
  const pending = verifications.filter((v) => v.status !== "verified");
  const complete = verifications.filter((v) => v.status === "verified");

  const trainerForm =
    data.permissions?.canVerify
      ? '<section class="v2-verify-card"><h3>Start a verification</h3><p>Choose a Crew Member and station. The verification stays pending until both of you sign.</p><form id="v2StartVerification" style="margin-top:14px"><div class="field"><label>Crew Member</label><select name="crewId" required><option value="">Choose Crew Member</option>' +
        (data.team || []).filter((p) => normaliseRole(p.role) === "crew" && p.id !== data.profile.id).map((p) => '<option value="' + esc(p.id) + '">' + esc(p.name) + "</option>").join("") +
        '</select></div><div class="field"><label>Station</label><select name="station" required>' +
        ["Fries", "Grill", "Chicken & Fryer", "Front Counter", "Drive-thru", "Drinks & McCafé", "Kitchen Assembly", "Breakfast", "Dining Area"].map((s) => "<option>" + esc(s) + "</option>").join("") +
        '</select></div><div id="v2VerifyResult"></div><button class="btn" type="submit">Open verification</button></form></section>'
      : '<section class="v2-verify-card"><h3>Your station sign-offs</h3><p>Open a pending verification when your Crew Trainer asks you to sign. Both signatures are required.</p><div class="v2-verify-list" id="v2OwnPending"></div></section>';

  content.innerHTML =
    '<section class="v2-verify-hero"><div><div class="eyebrow">STATION VERIFICATION</div><h1>' +
      (role === "crewTrainer" ? "Train. Check. Sign off." : role === "manager" ? "Station verification overview." : "Your sign-offs.") +
      '</h1><p>Verification is separate from completing a learning module. It confirms a real station check with two signatures: the Crew Trainer and the Crew Member.</p></div><span class="pill">' + esc(roleLabel(role)) + "</span></section>" +
    '<div class="v2-verify-grid">' +
      trainerForm +
      '<section class="v2-verify-card"><h3>Waiting for signatures</h3><p>' + pending.length + " pending verification" + (pending.length === 1 ? "" : "s") + '.</p><div class="v2-verify-list" id="v2PendingList"></div></section>' +
    "</div>" +
    '<section class="v2-verify-card" style="margin-top:16px"><div class="between"><div><h3>Verified stations</h3><p>Completed two-signature checks.</p></div><span class="pill green">' + complete.length + ' verified</span></div><div class="v2-verify-list" id="v2CompletedList"></div></section>';

  renderVerificationList($("v2PendingList"), pending);
  renderVerificationList($("v2CompletedList"), complete);
  if ($("v2OwnPending")) renderVerificationList($("v2OwnPending"), pending);

  const preselect = params.get("crewId");
  if (preselect && content.querySelector('select[name="crewId"]')) {
    content.querySelector('select[name="crewId"]').value = preselect;
  }

  $("v2StartVerification")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('[type="submit"]');
    const formData = new FormData(form);
    button.disabled = true;
    try {
      const result = await api("/api/verification", {
        method: "POST",
        body: JSON.stringify({
          action: "create",
          crewId: formData.get("crewId"),
          station: formData.get("station"),
        }),
      });
      V2.data = null;
      location.href = "/verification.html?id=" + encodeURIComponent(result.verification.id);
    } catch (error) {
      $("v2VerifyResult").innerHTML = '<div class="error">' + esc(error.message) + "</div>";
    } finally {
      button.disabled = false;
    }
  });
}

function setupSignaturePad(canvas) {
  const ctx = canvas.getContext("2d");
  let drawing = false;
  let signed = false;
  const resize = () => {
    const ratio = Math.max(1, window.devicePixelRatio || 1);
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(300, Math.floor(rect.width * ratio));
    canvas.height = Math.floor(150 * ratio);
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#24251f";
  };
  resize();

  const point = (event) => {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  canvas.addEventListener("pointerdown", (event) => {
    drawing = true;
    signed = true;
    canvas.setPointerCapture(event.pointerId);
    const p = point(event);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!drawing) return;
    const p = point(event);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  });
  const stop = () => {
    drawing = false;
  };
  canvas.addEventListener("pointerup", stop);
  canvas.addEventListener("pointercancel", stop);

  return {
    clear() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      signed = false;
    },
    hasInk() {
      return signed;
    },
    toDataURL() {
      return canvas.toDataURL("image/png");
    },
  };
}

function signatureBox(title, subtitle, signature, canSign, party) {
  if (signature) {
    return (
      '<section class="v2-sign-box signed"><span class="pill green">Signed</span><h3 style="margin-top:10px">' + esc(title) + '</h3><p>' + esc(signature.name || signature.typedName || subtitle) + " has signed this verification.</p>" +
      (signature.signatureData ? '<img class="v2-signature-preview" alt="Saved signature" src="' + esc(signature.signatureData) + '">' : "") +
      "</section>"
    );
  }
  if (!canSign) {
    return '<section class="v2-sign-box"><span class="pill">Waiting</span><h3 style="margin-top:10px">' + esc(title) + "</h3><p>" + esc(subtitle) + " still needs to sign.</p></section>";
  }
  return (
    '<section class="v2-sign-box"><span class="pill yellow">Your signature</span><h3 style="margin-top:10px">' + esc(title) + "</h3><p>Sign below and type your name. This only signs your side of the verification.</p>" +
    '<canvas class="v2-signature-canvas" id="v2SignatureCanvas" aria-label="Signature pad"></canvas>' +
    '<div class="v2-sign-row"><input id="v2TypedName" placeholder="Type your full name" maxlength="100"><button type="button" class="btn light" id="v2ClearSignature">Clear</button></div>' +
    '<button type="button" class="btn" id="v2SubmitSignature" data-party="' + esc(party) + '" style="margin-top:10px;width:100%">Sign verification</button><div id="v2SignResult"></div></section>'
  );
}

async function renderVerificationDetail(data, id) {
  const content = $("content");
  if (!content) return;
  let verification;
  try {
    const response = await api("/api/verification?id=" + encodeURIComponent(id));
    verification = response.verification;
  } catch (error) {
    content.innerHTML = '<div class="error">' + esc(error.message) + '</div><a class="btn" href="/verification.html">Back to verification</a>';
    return;
  }

  const isCrew = data.profile.id === verification.crewId;
  const isTrainer = data.profile.id === verification.trainerId && data.permissions?.canVerify;
  const done = verification.status === "verified";

  content.innerHTML =
    '<a class="text-btn" href="/verification.html">← Back to verification</a>' +
    '<section class="v2-verify-hero" style="margin-top:16px"><div><div class="eyebrow">TWO-SIGNATURE CHECK</div><h1>' + esc(verification.station) + '</h1><p>' + esc(verification.crewName) + " · Trainer " + esc(verification.trainerName) + '</p></div><span class="v2-verify-status ' + (done ? "done" : "") + '">' + esc(statusLabel(verification)) + "</span></section>" +
    '<section class="v2-verify-card"><div class="v2-verification-summary">' +
      '<div><small>Crew Member</small><b>' + esc(verification.crewName) + "</b></div>" +
      '<div><small>Crew Trainer</small><b>' + esc(verification.trainerName) + "</b></div>" +
      '<div><small>Station</small><b>' + esc(verification.station) + "</b></div>" +
      '<div><small>Status</small><b>' + esc(statusLabel(verification)) + "</b></div>" +
    '</div><p style="margin-top:14px">The learning module is preparation. This sign-off records that a Crew Trainer and Crew Member have completed the station verification together. Signing does not replace your restaurant\'s official training process.</p></section>' +
    '<div class="v2-sign-layout">' +
      signatureBox("Crew Member", verification.crewName, verification.crewSignature, isCrew && !verification.crewSignature && !done, "crew") +
      signatureBox("Crew Trainer", verification.trainerName, verification.trainerSignature, isTrainer && !verification.trainerSignature && !done, "trainer") +
    "</div>";

  const canvas = $("v2SignatureCanvas");
  if (!canvas) return;
  const pad = setupSignaturePad(canvas);
  $("v2ClearSignature").onclick = () => pad.clear();
  $("v2SubmitSignature").onclick = async () => {
    const typedName = $("v2TypedName").value.trim();
    const result = $("v2SignResult");
    if (!typedName) {
      result.innerHTML = '<div class="error">Type your full name first.</div>';
      return;
    }
    if (!pad.hasInk()) {
      result.innerHTML = '<div class="error">Add your signature in the box first.</div>';
      return;
    }
    $("v2SubmitSignature").disabled = true;
    try {
      const response = await api("/api/verification", {
        method: "POST",
        body: JSON.stringify({
          action: "sign",
          id: verification.id,
          typedName,
          signatureData: pad.toDataURL(),
        }),
      });
      result.innerHTML = '<div class="success">' + esc(response.reply) + "</div>";
      V2.data = null;
      setTimeout(() => location.reload(), 700);
    } catch (error) {
      result.innerHTML = '<div class="error">' + esc(error.message) + "</div>";
      $("v2SubmitSignature").disabled = false;
    }
  };
}

async function renderVerification(data) {
  if (!isVerificationRoute()) return;
  const content = $("content");
  if (!content || content.dataset.v2Verification === "1") return;
  content.dataset.v2Verification = "1";
  const id = params.get("id");
  if (id) await renderVerificationDetail(data, id);
  else await renderVerificationQueue(data);
}

function appendManagerRoleRequests(data) {
  if (path !== "admin.html" || data.profile.role !== "manager") return;
  const content = $("content");
  if (!content || content.querySelector(".v2-manager-requests")) return;
  const requests = data.roleRequests || [];
  const section = document.createElement("section");
  section.className = "card v2-manager-requests";
  section.innerHTML =
    '<div class="between"><div><h3>Role requests</h3><p class="form-note">Approve Crew Trainer or Manager access for people in your store.</p></div><span class="pill">' + requests.length + " pending</span></div>" +
    (requests.length
      ? requests.map((r) =>
          '<div class="v2-request-row"><div class="avatar">' + esc(initials(r.name)) + '</div><div class="grow"><b>' + esc(r.name || r.email || "Crew member") + '</b><small>Requested ' + esc(roleLabel(r.requestedRole)) + '</small></div><button class="btn light" data-role-reject="' + esc(r.uid || r.id) + '">Reject</button><button class="btn" data-role-approve="' + esc(r.uid || r.id) + '">Approve</button></div>',
        ).join("")
      : '<div class="empty">No role requests waiting.</div>');
  content.appendChild(section);

  section.querySelectorAll("[data-role-approve],[data-role-reject]").forEach((button) => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      const approve = button.hasAttribute("data-role-approve");
      const uid = button.getAttribute(approve ? "data-role-approve" : "data-role-reject");
      try {
        await api("/api/role-request", {
          method: "POST",
          body: JSON.stringify({ action: approve ? "approve" : "reject", uid }),
        });
        V2.data = null;
        V2.dataAt = 0;
        const fresh = await loadData(true);
        section.remove();
        appendManagerRoleRequests(fresh);
      } catch (error) {
        alert(error.message);
        button.disabled = false;
      }
    });
  });
}

async function enhanceLoggedIn() {
  const profileButton = $("profileButton");
  if (!profileButton) return;
  if (!isAssistantRoute()) {
    document.getElementById("assistant")?.remove();
  }
  const data = await loadData();
  applyRoleUI(data);
  renderTraining(data);
  renderAssistant(data);
  await renderVerification(data);
  appendManagerRoleRequests(data);
}

async function enhance() {
  if (V2.enhancing) return;
  V2.enhancing = true;
  try {
    enhanceSignup();
    await enhanceLoggedIn();
  } catch (error) {
    console.warn("McTraining V2 enhancement skipped", error);
  } finally {
    V2.enhancing = false;
  }
}

let timer;
const observer = new MutationObserver(() => {
  clearTimeout(timer);
  timer = setTimeout(enhance, 40);
});
observer.observe(document.documentElement, { childList: true, subtree: true });

window.addEventListener("DOMContentLoaded", enhance);
setTimeout(enhance, 0);
