import "./portal-enhancements.js";
import {
  managerRole,
  isoDate,
  weekDates,
  shiftMinutes,
  shiftEnd,
  overlap,
  availabilityAllows,
  durationLabel,
  escapeHTML as esc,
} from "./portal-core.js";
import { renderPage } from "./portal-pages.js";
const $ = (id) => document.getElementById(id);
const icons = {
  home: "M3 10 12 3l9 7v11h-6v-7H9v7H3Z",
  calendar:
    "M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2M7 14h2m4 0h2m-8 4h2",
  book: "M12 6C8 3 4 4 2 5v15c4-2 7-1 10 1m0-15c4-3 8-2 10-1v15c-4-2-7-1-10 1V6",
  star: "m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9Z",
  team: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.9M13 3a4 4 0 0 1 0 8M9 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8",
  arrow: "M5 12h14m-6-6 6 6-6 6",
  chevron: "m9 5 7 7-7 7",
  clock: "M12 8v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
  spark: "m12 2 2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5Z",
  bell: "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4",
  logout: "M9 3H4v18h5m0-9h12m-4-4 4 4-4 4",
  check: "m5 12 4 4L19 6",
  plus: "M12 5v14M5 12h14",
  close: "m6 6 12 12M6 18 18 6",
  send: "m3 3 18 9-18 9 4-9-4-9Zm4 9h14",
  shield: "m12 3 8 3v7c0 5-8 9-8 9s-8-4-8-9V6l8-3Zm-4 9 3 3 5-5",
  wallet: "M3 7h18v14H3V7Zm0 0V4h15v3m-2 6h5v4h-5Z",
  coffee:
    "M4 8h12v8a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V8Zm12 1h2a3 3 0 0 1 0 6h-2M7 2v3m5-3v3M2 23h18",
};
const icon = (name) =>
  `<svg class="icon" aria-hidden="true" viewBox="0 0 24 24"><path d="${icons[name] || icons.star}"/></svg>`;
const params = new URLSearchParams(location.search),
  preview = ["crew", "manager"].includes(params.get("preview"))
    ? params.get("preview")
    : null;
const path =
  location.pathname.split("/").pop()?.replace(".html", "") || "index";
const routes = {
  main: "home",
  schedule: "schedule",
  "shifts-admin": "manage",
  training: "training",
  module: "module",
  "break-rewards": "rewards",
  wrapped: "training",
  admin: "team",
};
let page = params.get("view") || routes[path] || "home";
if (
  ![
    "home",
    "schedule",
    "manage",
    "training",
    "module",
    "rewards",
    "team",
    "availability",
    "assistant",
  ].includes(page)
)
  page = "home";
const state = {
  user: null,
  shifts: [],
  team: [],
  progress: {},
  offset: 0,
  selected: isoDate(),
  chat: [],
  busy: false,
  dataError: "",
  loaded: false,
};
let fb,
  auth,
  db,
  unsubscribers = [];
function persistPreview() {
  if (preview)
    sessionStorage.setItem(
      "mc_preview_" + preview,
      JSON.stringify({
        user: state.user,
        shifts: state.shifts,
        team: state.team,
        progress: state.progress,
      }),
    );
}
const modules = window.McModules.modules;
const currency = (value) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(
    value,
  );
const dateLabel = (
  date,
  options = { weekday: "short", day: "numeric", month: "short" },
) => new Date(`${date}T12:00`).toLocaleDateString("en-GB", options);
const isManager = () => managerRole(state.user?.role);
const url = (target = "home", extra = {}) => {
  const paths = {
    home: "main",
    schedule: "schedule",
    manage: "shifts-admin",
    training: "training",
    module: "module",
    rewards: "break-rewards",
    team: "admin",
  };
  const p = new URLSearchParams(extra);
  if (!paths[target]) p.set("view", target);
  if (preview) p.set("preview", preview);
  return `/${paths[target] || "main"}.html${p.size ? "?" + p : ""}`;
};
function toast(text) {
  $("toast").textContent = text;
  $("toast").classList.add("show");
  setTimeout(() => $("toast").classList.remove("show"), 3500);
}
const pill = (text, type = "") =>
  `<span class="pill ${type}">${esc(text)}</span>`;
const heading = (title, sub) =>
  `<div class="page-heading"><div class="eyebrow muted" style="margin-bottom:9px">YOUR EVERYDAY, A LITTLE EASIER</div><h1>${title}</h1><p>${sub}</p></div>`;
const empty = (text) => `<div class="empty">${text}</div>`;
const navLink = (target, label, i) =>
  `<a href="${url(target)}" class="${page === target || (target === "training" && page === "module") ? "active" : ""}" ${page === target ? 'aria-current="page"' : ""}>${icon(i)}<span>${label}</span></a>`;
const brand = () =>
  `<a class="brand" href="${url()}"><img src="/favicon.svg" alt=""><div><div class="wordmark">McTraining<span style="color:#b48100">.</span></div><small>THE CREW HUB</small></div></a>`;
const myShifts = () =>
  state.shifts
    .filter((s) => s.userId === state.user.id)
    .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
function shell() {
  const u = state.user;
  if (!preview && !state.chat.length) {
    try {
      state.chat = JSON.parse(
        sessionStorage.getItem("mc_chat_" + u.id) || "[]",
      );
    } catch {}
  }
  $("app").innerHTML =
    `${preview ? `<div class="preview-banner" role="region" aria-label="Sample preview">Sample ${preview} preview · Changes stay in this tab <button id="switchPreview">Try ${preview === "crew" ? "manager" : "crew"} view</button><a href="/" style="margin-left:14px;text-decoration:underline">Sign in to your account</a></div>` : ""}<aside class="sidebar" aria-label="Workspace sidebar">${brand()}<nav class="side-nav" aria-label="Main navigation"><p class="nav-label">YOUR WORKSPACE</p>${navLink("home", "Home", "home")}${navLink("schedule", "My shifts", "calendar")}${navLink("training", "My learning", "book")}${navLink("rewards", "My McStars", "star")}${isManager() ? `${navLink("team", "My team", "team")}${navLink("manage", "Shift planner", "calendar")}` : ""}${navLink("assistant", "McAssist", "spark")}</nav><div class="side-help">${icon("coffee")}<h4 style="margin-top:10px">Good shifts start here.</h4><p>A little preparation. A great team. You've got this.</p><a class="text-btn" href="${url("training")}">Learn something new ${icon("arrow")}</a></div><div class="side-profile between"><div class="row"><span class="avatar">${esc(
      u.name
        .split(" ")
        .map((n) => n[0])
        .slice(0, 2)
        .join(""),
    )}</span><div><b>${esc(u.name)}</b><small>${isManager() ? "Manager" : "Crew member"} · ${esc(u.storeId)}</small></div></div><button class="icon-btn" id="logout" aria-label="Sign out">${icon("logout")}</button></div></aside><main class="workspace"><header class="topbar between"><div class="mobile-brand">${brand()}</div><div class="breadcrumb">My workspace <span style="margin:0 12px">/</span> <b>${{ home: "Home", schedule: "My shifts", training: "My learning", manage: "Shift planner", team: "My team", module: "My learning", rewards: "My McStars", availability: "My availability", assistant: "McAssist" }[page]}</b></div><div class="row"><span class="top-date">${new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}</span><span class="pill store-pill">${esc(u.storeName || u.storeId)}</span><button class="icon-btn" id="notifications" aria-label="View updates">${icon("bell")}</button><button class="avatar" id="profileButton" aria-label="My profile" style="border:0">${esc(u.name[0])}</button></div></header>${state.dataError ? `<div class="data-warning" role="alert">${esc(state.dataError)} <button class="text-btn" id="retryData">Try again</button></div>` : ""}<div class="layout"><section class="content" id="content"></section><aside class="rail" aria-label="Assistant and tips"><section class="assistant-card" id="assistant"><div class="assistant-head between"><div class="row"><div class="assistant-icon">${icon("spark")}</div><div><h3>McAssist</h3><small>A helping hand, always.</small></div></div>${pill(preview ? "Preview" : "AI assistant", preview ? "" : "green")}</div><div id="chat" class="chat" role="log" aria-live="polite"></div><div class="suggestions"><button data-prompt="Help me prepare for my next shift">Shift prep +</button><button data-prompt="Give me a quick customer service practice scenario">Practise with me</button></div><form id="chatForm" class="chat-form"><input id="chatInput" aria-label="Message McAssist" placeholder="Ask McAssist anything…" maxlength="2000" required autocomplete="off"><button class="btn" aria-label="Send message" type="submit">${icon("send")}</button></form><p class="ai-note">For store procedures, always check your official guidance.</p></section><section class="card notice-card">${icon("shield")}<h3>Small things. Big difference.</h3><p>Before your shift, check your station, find your shift lead and take a moment to get ready.</p><a class="text-btn" href="${url("training")}">Your first-shift essentials ${icon("arrow")}</a></section><section class="card" style="padding:20px 22px"><div class="row">${icon("star")}<div><h4>Better, together.</h4><p class="muted" style="font-size:11px;margin-top:4px">Every great shift is a team effort.</p></div></div></section></aside></div><footer class="footer"><span>Made for your everyday. McTraining crew hub.</span><span>Independent team tool · Not an official McDonald's product</span></footer></main><nav class="mobile-nav" aria-label="Mobile navigation">${navLink("home", "Home", "home")}${navLink("schedule", "Shifts", "calendar")}${navLink("training", "Learn", "book")}${navLink("assistant", "McAssist", "spark")}${navLink(isManager() ? "team" : "availability", isManager() ? "Team" : "Availability", isManager() ? "team" : "clock")}</nav>`;
  $("switchPreview")?.addEventListener("click", () => {
    const p = new URL(location.href);
    p.searchParams.set("preview", preview === "crew" ? "manager" : "crew");
    location.href = p;
  });
  $("logout")?.addEventListener("click", async () => {
    if (!preview) await fb.signOut(auth);
    localStorage.removeItem("mc_session_user");
    location.href = "/";
  });
  $("profileButton").onclick = () => {
    showModal(
      "Your profile",
      "<p>" +
        esc(u.name) +
        " · " +
        (isManager() ? "Manager" : "Crew member") +
        '</p><p class="form-note">Store ' +
        esc(u.storeId) +
        '</p><div class="stack"><a class="btn light" href="' +
        url("availability") +
        '">My availability</a><a class="btn light" href="' +
        url("rewards") +
        '">My McStars</a><button class="btn dark" id="profileLogout">Sign out</button></div>',
    );
    $("profileLogout").onclick = () => $("logout").click();
  };
  $("notifications").onclick = () =>
    showModal(
      "Your updates",
      `<p>You have ${myShifts().filter((s) => s.date >= isoDate()).length} upcoming shifts.</p><p class="form-note">Check the schedule for the latest published rota.</p><a class="btn" href="${url("schedule")}">View shifts</a>`,
    );
  $("retryData")?.addEventListener("click", () => location.reload());
  $("chatForm").onsubmit = sendChat;
  document.querySelectorAll("[data-prompt]").forEach(
    (b) =>
      (b.onclick = () => {
        $("chatInput").value = b.dataset.prompt;
        $("chatForm").requestSubmit();
      }),
  );
  renderChat();
  renderContent();
}
function renderContent() {
  // Enhanced pages own their DOM. Live snapshots must not destroy chat or forms.
  if ($("content").dataset.enhancedPage) {
    window.dispatchEvent(new CustomEvent("portal:render", { detail: state }));
    return;
  }
  $("content").innerHTML = renderPage(page, {
    state,
    params,
    modules,
    icon,
    pill,
    heading,
    empty,
    url,
    currency,
    dateLabel,
    isManager,
    myShifts,
  });
  bindContent();
  window.dispatchEvent(new CustomEvent("portal:render", { detail: state }));
}
function showModal(title, html) {
  $("modal").innerHTML =
    `<button class="icon-btn dialog-close" id="closeModal" aria-label="Close dialog">${icon("close")}</button><h2 style="padding-right:40px">${title}</h2>${html}`;
  $("closeModal").onclick = () => $("modal").close();
  $("modal").showModal();
}
function bindContent() {
  document.querySelectorAll("[data-week]").forEach(
    (b) =>
      (b.onclick = () => {
        state.offset = Number(b.dataset.week);
        state.selected = weekDates(state.offset)[0];
        renderContent();
      }),
  );
  document.querySelectorAll("[data-day]").forEach(
    (b) =>
      (b.onclick = () => {
        state.selected = b.dataset.day;
        renderContent();
      }),
  );
  document.querySelectorAll("[data-ask]").forEach(
    (b) =>
      (b.onclick = () => {
        $("chatInput").value = b.dataset.ask;
        $("chatForm").requestSubmit();
        $("assistant").scrollIntoView({ behavior: "smooth" });
      }),
  );
  $("availabilityForm")?.addEventListener("submit", saveAvailability);
  $("shiftForm")?.addEventListener("submit", saveShift);
  $("moduleForm")?.addEventListener("submit", finishModule);
  document.querySelectorAll("[data-person]").forEach(
    (b) =>
      (b.onclick = () => {
        const u = state.team.find((u) => u.id === b.dataset.person);
        showModal(
          esc(u.name),
          `<p>${managerRole(u.role) ? "Manager" : "Crew member"} · ${Number(u.stars) || 0} McStars</p><h3 style="margin-top:22px">Availability</h3>${
            Object.entries(u.availability || {})
              .map(
                ([d, a]) =>
                  `<p class="form-note">${esc(d)}: ${esc(Array.isArray(a) ? a.map((w) => w.start + "–" + w.end).join(", ") || "Unavailable" : a.available ? a.start + "–" + a.end : "Unavailable")}</p>`,
              )
              .join("") ||
            '<p class="form-note">Availability not set yet. Check with this team member before assigning shifts.</p>'
          }<a class="btn" href="${url("manage")}">Plan a shift</a>`,
        );
      }),
  );
  document.querySelectorAll("[data-delete]").forEach(
    (b) =>
      (b.onclick = () => {
        const s = state.shifts.find((s) => s.id === b.dataset.delete);
        showModal(
          "Remove this shift?",
          `<p>${esc(s.userName)} · ${dateLabel(s.date)} · ${esc(s.start)}–${esc(s.end)}</p><p class="form-note">This removes the shift from the shared rota.</p><button class="btn danger" id="confirmDelete">Remove shift</button>`,
        );
        $("confirmDelete").onclick = async () => {
          try {
            $("confirmDelete").disabled = true;
            if (preview)
              state.shifts = state.shifts.filter((x) => x.id !== s.id);
            else
              await fb.deleteDoc(
                fb.doc(db, "stores", state.user.storeId, "Shifts", s.id),
              );
            state.shifts = state.shifts.filter((x) => x.id !== s.id);
            persistPreview();
            $("modal").close();
            renderContent();
            toast("Shift removed.");
          } catch {
            toast("Could not remove the shift. Please try again.");
            $("confirmDelete").disabled = false;
          }
        };
      }),
  );
}
async function formAction(form, resultId, action, success) {
  const button = form.querySelector("[type=submit]");
  button.disabled = true;
  $(resultId).innerHTML = "";
  try {
    await action();
    if ($(resultId))
      $(resultId).innerHTML = `<div class="success">${esc(success)}</div>`;
    toast(success);
    persistPreview();
    return true;
  } catch (e) {
    if ($(resultId))
      $(resultId).innerHTML =
        `<div class="error">${esc(e.code === "permission-denied" ? "Your account could not save this change. Ask your manager to check access." : e.message || "Could not save. Try again.")}</div>`;
    return false;
  } finally {
    button.disabled = false;
  }
}
async function saveAvailability(e) {
  e.preventDefault();
  const form = e.currentTarget,
    data = new FormData(form),
    availability = {};
  for (const d of ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]) {
    availability[d] = {
      available: data.has(d),
      start: data.get(d + "Start"),
      end: data.get(d + "End"),
    };
    if (
      availability[d].available &&
      availability[d].start === availability[d].end
    ) {
      $("availabilityResult").innerHTML =
        '<div class="error">Start and end times must be different.</div>';
      return;
    }
  }
  await formAction(
    form,
    "availabilityResult",
    async () => {
      if (!preview)
        await fb.updateDoc(fb.doc(db, "users", state.user.id), {
          availability,
        });
      state.user.availability = availability;
    },
    preview
      ? "Availability updated in this preview."
      : "Availability saved for your manager.",
  );
}
async function saveShift(e) {
  e.preventDefault();
  const form = e.currentTarget,
    data = new FormData(form),
    person = state.team.find((u) => u.id === data.get("member"));
  const saved = await formAction(
    form,
    "shiftResult",
    async () => {
      if (!person) throw Error("Choose a crew member.");
      const s = {
        userId: person.id,
        userName: person.name,
        role: person.role || "crew",
        date: data.get("date"),
        start: data.get("start"),
        end: data.get("end"),
        station: data.get("station"),
        breakMinutes: Number(data.get("breakMinutes")),
        createdBy: state.user.id,
      };
      const duration = shiftMinutes({ ...s, breakMinutes: 0 });
      if (!duration || duration > 720)
        throw Error(
          "Choose a shift longer than zero and no longer than 12 hours.",
        );
      if (s.breakMinutes >= duration)
        throw Error("The break must be shorter than the shift.");
      if (state.shifts.some((x) => x.userId === s.userId && overlap(x, s)))
        throw Error("This team member already has an overlapping shift.");
      if (!availabilityAllows(person.availability, s))
        throw Error("The shift falls outside this team member’s availability.");
      if (preview) state.shifts.push({ ...s, id: crypto.randomUUID() });
      else {
        const created = await fb.addDoc(
          fb.collection(db, "stores", state.user.storeId, "Shifts"),
          { ...s, createdAt: fb.serverTimestamp() },
        );
        if (!state.shifts.some((x) => x.id === created.id))
          state.shifts.push({ ...s, id: created.id });
      }
    },
    preview
      ? "Shift added to this preview."
      : "Shift published to the team rota.",
  );
  if (saved) {
    renderContent();
    $("shiftResult").innerHTML =
      '<div class="success">' +
      (preview
        ? "Shift added to this preview."
        : "Shift published to the team rota.") +
      "</div>";
  }
}
async function finishModule(e) {
  e.preventDefault();
  const form = e.currentTarget,
    m = modules.find((m) => m.id === params.get("id")),
    data = new FormData(form);
  if (m.quiz.some((q, i) => Number(data.get("quiz" + i)) !== q.correct)) {
    $("quizResult").innerHTML =
      '<div class="error">Not quite yet. Revisit the notes above and give the questions another go.</div>';
    return;
  }
  await formAction(
    form,
    "quizResult",
    async () => {
      const progress = { completed: true, xp: m.xp, completedAt: Date.now() };
      if (!preview)
        await fb.setDoc(
          fb.doc(db, "users", state.user.id, "portalTraining", m.id),
          progress,
        );
      state.progress[m.id] = progress;
      if ($("moduleStatus")) $("moduleStatus").textContent = "Completed";
    },
    preview
      ? "Nicely done! Module completed in this preview."
      : "Nicely done! Your learning progress is saved.",
  );
}
function renderChat() {
  const messages = state.chat.length
    ? state.chat
    : [
        {
          role: "assistant",
          content: `Hey ${state.user.name.split(" ")[0]} 👋\nA little help for your working day. Ask me about your shifts, a training topic, or getting ready for the rush.`,
        },
      ];
  $("chat").innerHTML =
    messages
      .map(
        (m) =>
          `<div><div class="chat-label" style="${m.role === "user" ? "text-align:right" : ""}">${m.role === "user" ? "YOU" : "MCASSIST"}</div><div class="message ${m.role === "user" ? "user" : ""}">${esc(m.content)}</div></div>`,
      )
      .join("") + (state.busy ? '<div class="message">Thinking…</div>' : "");
  $("chat").scrollTop = $("chat").scrollHeight;
  $("chatForm").querySelector("button").disabled = state.busy;
}
async function sendChat(e) {
  e.preventDefault();
  if (state.busy) return;
  const message = $("chatInput").value.trim();
  if (!message) return;
  const history = state.chat.slice(-8);
  state.chat.push({ role: "user", content: message });
  $("chatInput").value = "";
  state.busy = true;
  renderChat();
  try {
    let reply;
    if (preview) {
      reply =
        "You’re exploring the sample preview. Sign in to use the live AI assistant with your account.\n\nFor shift prep: check your start time and station, find your shift lead, and ask what the team needs before the rush.";
    } else {
      const token = await auth.currentUser.getIdToken();
      const next = myShifts()
        .filter((s) => s.date >= isoDate())
        .slice(0, 5)
        .map(({ date, start, end, station }) => ({
          date,
          start,
          end,
          station,
        }));
      const m =
        page === "module"
          ? modules.find((m) => m.id === params.get("id"))
          : null;
      const response = await fetch("/api/ai-chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          message,
          history,
          appContext: {
            page,
            upcomingShifts: next,
            selectedModule: m ? { title: m.title, sections: m.sections } : null,
          },
        }),
        signal: AbortSignal.timeout(30000),
      });
      const data = await response.json();
      if (!response.ok)
        throw Error(
          data.reply || "McAssist is unavailable right now. Please try again.",
        );
      reply = data.reply;
    }
    state.chat.push({ role: "assistant", content: reply });
  } catch (e) {
    state.chat.push({
      role: "assistant",
      content:
        e.name === "TimeoutError"
          ? "That took longer than expected. Please try again."
          : e.message,
    });
  } finally {
    state.busy = false;
    if (!preview)
      sessionStorage.setItem(
        "mc_chat_" + state.user.id,
        JSON.stringify(state.chat.slice(-20)),
      );
    renderChat();
  }
}
async function firebase() {
  const [base, a, f] = await Promise.all([
    import("./firebase-init.js"),
    import("https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js"),
    import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js"),
  ]);
  auth = base.auth;
  db = base.db;
  fb = { ...a, ...f };
}
function authPage(signup = false) {
  $("app").innerHTML =
    `<main class="auth-layout"><section class="auth-art">${brand()}<div><div class="eyebrow" style="margin-top:35px">YOUR TEAM. YOUR DAY. YOUR WAY.</div><h1>A good shift<br>starts here.</h1><p>Your schedule, your learning, and a helping hand. Everything you need to feel ready for your day.</p><div class="auth-shift"><div class="between"><b style="font-size:12px;color:#7b806d">A little more clarity</b>${icon("calendar")}</div><h3>More ready. Less rushed.</h3><p style="font-size:12px;color:#6d745e">Know your shift. Grow your skills.<br>Make every day a little better.</p></div></div><div class="auth-bottom">Made for managers. Made for crew. Made for you.</div></section><section class="auth-form-wrap"><div class="auth-form"><span class="pill yellow" style="margin-bottom:22px">${icon("home")} Your everyday crew hub</span><h2>${signup ? "Join your crew hub." : "Hey, welcome back."}</h2><p>${signup ? "A fresh start to better working days." : "Ready for your next good shift? Let’s get you in."}</p><form id="authForm">${signup ? '<div class="field"><label for="name">Your name</label><input id="name" name="name" autocomplete="name" required maxlength="80" placeholder="First and last name"></div>' : ""}<div class="field"><label for="email">Email address</label><input type="email" id="email" name="email" autocomplete="email" placeholder="you@example.com" required></div><div class="field"><label for="password">Password</label><input type="password" id="password" name="password" autocomplete="${signup ? "new-password" : "current-password"}" placeholder="${signup ? "At least 8 characters" : "Enter your password"}" minlength="${signup ? 8 : 1}" required></div>${signup ? '<div class="field"><label for="storeId">Store ID</label><input id="storeId" name="storeId" placeholder="Ask your manager for your store ID" required pattern="[A-Za-z0-9_-]+" maxlength="80"></div><p class="form-note">New accounts join as crew members. Manager access is assigned by your administrator.</p>' : '<div style="text-align:right;margin:-8px 0 18px"><button class="text-btn" type="button" id="resetPassword">Forgot password?</button></div>'}<div id="authResult" role="status"></div><button class="btn dark full" type="submit">${signup ? "Create my account" : "Sign in"} ${icon("arrow")}</button></form><div class="auth-divider">${signup ? "ALREADY PART OF THE TEAM?" : "NEW AROUND HERE?"}</div><p class="auth-foot">${signup ? '<a href="/">Sign in to your account</a>' : '<a href="/signup.html">Create your crew account</a>'}</p><p class="auth-foot" style="margin-top:24px"><a href="/main.html?preview=crew">Take a look around</a> · No account needed</p><p class="auth-foot" style="font-size:10px;margin-top:30px">Independent team tool. Not an official McDonald’s product.</p></div></section></main>`;
  $("authForm").onsubmit = async (e) => {
    e.preventDefault();
    const form = e.currentTarget,
      data = new FormData(form);
    await formAction(
      form,
      "authResult",
      async () => {
        if (!fb) await firebase();
        if (signup) {
          const c = await fb.createUserWithEmailAndPassword(
            auth,
            data.get("email"),
            data.get("password"),
          );
          await fb.updateProfile(c.user, { displayName: data.get("name") });
          await fb.setDoc(fb.doc(db, "users", c.user.uid), {
            name: data.get("name"),
            email: c.user.email,
            role: "crew",
            storeId: data.get("storeId"),
            stars: 0,
            createdAt: fb.serverTimestamp(),
          });
        } else
          await fb.signInWithEmailAndPassword(
            auth,
            data.get("email"),
            data.get("password"),
          );
        localStorage.removeItem("mc_force_logout");
        location.href = "/main.html";
      },
      "Signed in. Opening your crew hub…",
    );
  };
  $("resetPassword")?.addEventListener("click", async () => {
    const email = $("email").value;
    if (!email || !$("email").checkValidity())
      return toast("Enter your email address first.");
    try {
      if (!fb) await firebase();
      await fb.sendPasswordResetEmail(auth, email);
      $("authResult").innerHTML =
        '<div class="success">If this address has an account, a password reset email is on its way.</div>';
    } catch {
      $("authResult").innerHTML =
        '<div class="error">Could not send the reset email. Please try again.</div>';
    }
  });
  window.dispatchEvent(new CustomEvent("portal:render", { detail: state }));
}
function setupPreview() {
  const dates = weekDates();
  state.user = {
    id: "preview-self",
    name: "Cosmin Blidaru",
    role: preview,
    storeId: "1170",
    storeName: "1170 · Hayle",
    hourlyRate: 12.55,
    stars: 12,
    badge: "Team player",
    availability: {
      mon: { available: true, start: "09:00", end: "23:00" },
      tue: { available: true, start: "09:00", end: "23:00" },
      wed: { available: false },
      thu: { available: true, start: "09:00", end: "23:00" },
      fri: { available: true, start: "09:00", end: "23:00" },
      sat: { available: true, start: "09:00", end: "23:00" },
    },
  };
  state.team = [
    state.user,
    { id: "preview-amelia", name: "Amelia Wilson", role: "crew", stars: 7 },
    { id: "preview-ryan", name: "Ryan Davies", role: "crew", stars: 5 },
    { id: "preview-maya", name: "Maya Patel", role: "crew", stars: 9 },
  ];
  state.shifts = [
    {
      id: "p1",
      date: dates[0],
      start: "16:30",
      end: "01:00",
      breakMinutes: 30,
      userId: "preview-self",
      userName: "Cosmin Blidaru",
      station: "Front Counter",
    },
    {
      id: "p2",
      date: dates[2],
      start: "10:00",
      end: "18:00",
      breakMinutes: 30,
      userId: "preview-self",
      userName: "Cosmin Blidaru",
      station: "Kitchen",
    },
    {
      id: "p3",
      date: dates[4],
      start: "14:00",
      end: "22:00",
      breakMinutes: 30,
      userId: "preview-self",
      userName: "Cosmin Blidaru",
      station: "Drive-thru",
    },
    {
      id: "p4",
      date: dates[5],
      start: "16:30",
      end: "01:00",
      breakMinutes: 30,
      userId: "preview-self",
      userName: "Cosmin Blidaru",
      station: "Front Counter",
    },
    {
      id: "p5",
      date: isoDate(),
      start: "09:00",
      end: "17:00",
      breakMinutes: 30,
      userId: "preview-amelia",
      userName: "Amelia Wilson",
      station: "Fries",
    },
  ];
  state.progress = { "first-shift": { completed: true, xp: 80 } };
  try {
    const saved = JSON.parse(
      sessionStorage.getItem("mc_preview_" + preview) || "null",
    );
    if (saved?.user?.id === "preview-self") Object.assign(state, saved);
  } catch {}
  state.loaded = true;
  state.progressLoaded = true;
  shell();
}
function subscribe() {
  unsubscribers.forEach((fn) => fn());
  unsubscribers = [];
  const uid = state.user.id,
    store = state.user.storeId;
  const fail = (error) => {
    state.loaded = true;
    state.dataError =
      error.code === "permission-denied"
        ? "Some restaurant data could not be loaded because this account does not have permission. Ask your manager to check your access."
        : "Your restaurant data could not be loaded. Check your connection and try again.";
    let warning = document.querySelector(".data-warning");
    if (!warning) {
      warning = document.createElement("div");
      warning.className = "data-warning";
      warning.setAttribute("role", "alert");
      document.querySelector(".topbar")?.after(warning);
    }
    warning.textContent = state.dataError + " ";
    const retry = document.createElement("button");
    retry.className = "text-btn";
    retry.textContent = "Try again";
    retry.onclick = () => location.reload();
    warning.appendChild(retry);
  };
  const shifts = fb.collection(db, "stores", store, "Shifts");
  const shiftQuery = isManager()
    ? shifts
    : fb.query(shifts, fb.where("userId", "==", uid));
  unsubscribers.push(
    fb.onSnapshot(
      shiftQuery,
      (s) => {
        state.shifts = s.docs.map((d) => ({ ...d.data(), id: d.id }));
        state.loaded = true;
        if (page !== "manage" && page !== "module" && page !== "availability")
          renderContent();
      },
      fail,
    ),
  );
  unsubscribers.push(
    fb.onSnapshot(
      fb.collection(db, "users", uid, "portalTraining"),
      (s) => {
        state.progress = Object.fromEntries(
          s.docs.map((d) => [d.id, d.data()]),
        );
        state.progressLoaded = true;
        if (page === "home" || page === "training") renderContent();
        if (page === "module" && $("moduleStatus"))
          $("moduleStatus").textContent = state.progress[params.get("id")]
            ?.completed
            ? "Completed"
            : "In progress";
      },
      fail,
    ),
  );
  if (isManager())
    unsubscribers.push(
      fb.onSnapshot(
        fb.query(fb.collection(db, "users"), fb.where("storeId", "==", store)),
        (s) => {
          state.team = s.docs.map((d) => ({ ...d.data(), id: d.id }));
          if (page === "team" || page === "home") renderContent();
          if (page === "manage" && !$("member")?.value) renderContent();
        },
        fail,
      ),
    );
}
async function boot() {
  if (preview) {
    setupPreview();
    return;
  }
  if (["index", "signup", ""].includes(path)) {
    authPage(path === "signup");
    return;
  }
  try {
    await firebase();
    fb.onAuthStateChanged(auth, async (user) => {
      if (!user) {
        location.replace("/");
        return;
      }
      try {
        const snap = await fb.getDoc(fb.doc(db, "users", user.uid));
        if (!snap.exists())
          throw Error(
            "Your account profile is missing. Contact your manager to restore your store access.",
          );
        state.user = { ...snap.data(), id: user.uid };
        state.user.name = state.user.name || user.displayName || "Crew member";
        if (!state.user.storeId)
          throw Error(
            "Your profile needs a store ID. Please ask your manager to update it.",
          );
        shell();
        subscribe();
      } catch (e) {
        $("app").innerHTML =
          `<main class="boot"><section class="card" style="max-width:500px;margin:20px"><h2>Let’s get your account ready.</h2><p class="form-note">${esc(e.message)}</p><button class="btn" id="accountLogout">Back to sign in</button></section></main>`;
        $("accountLogout").onclick = async () => {
          await fb.signOut(auth);
          location.href = "/";
        };
      }
    });
  } catch {
    $("app").innerHTML =
      '<main class="boot"><h2>Could not connect.</h2><p>Please check your connection, then reload the page.</p><a class="btn" href="/">Back to sign in</a></main>';
  }
}
boot();
