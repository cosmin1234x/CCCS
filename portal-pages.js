import {
  managerRole,
  isoDate,
  weekDates,
  shiftMinutes,
  shiftEnd,
  durationLabel,
  escapeHTML as esc,
} from "./portal-core.js";
export function renderPage(page, c) {
  const {
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
  } = c;
  const home = () => {
    const u = state.user,
      all = myShifts(),
      next = all.find((s) => shiftEnd(s) > new Date()),
      dates = weekDates(),
      week = all.filter((s) => dates.includes(s.date)),
      minutes = week.reduce((n, s) => n + shiftMinutes(s), 0),
      done = Object.values(state.progress).filter((p) => p.completed).length;
    const hour = new Date().getHours(),
      greeting =
        hour < 12
          ? "Good morning"
          : hour < 17
            ? "Good afternoon"
            : "Good evening";
    const shiftHTML = next
      ? `<div class="row shift-main"><div class="date-tile"><span>${dateLabel(next.date, { weekday: "short" })}</span><b>${dateLabel(next.date, { day: "numeric" })}</b><span>${dateLabel(next.date, { month: "short" })}</span></div><div><h2>${esc(u.storeName || u.storeId)}</h2><div class="shift-time">${esc(next.start)} – ${esc(next.end)}</div><p class="muted" style="font-size:12px">${esc(next.station || "Station to be confirmed")} · ${durationLabel(shiftMinutes(next))} paid time</p></div></div><div class="shift-footer between"><span>${Number.isFinite(u.hourlyRate) ? `<b>${currency((shiftMinutes(next) / 60) * u.hourlyRate)}</b> estimated gross pay` : "Your next shift, all in one place."}</span><a class="text-btn" href="${url("schedule")}">Details ${icon("arrow")}</a></div>`
      : empty(
          state.loaded
            ? "No upcoming shifts yet. Your next published shift will appear here."
            : "Finding your next shift…",
        );
    return `<section class="welcome"><div class="eyebrow">A GOOD DAY STARTS WITH A GREAT TEAM</div><h1>${greeting}, ${esc(u.name.split(" ")[0])}.</h1><p>Here's your day, at a glance. Let's make it a good one.</p><div class="shift-card"><div class="between"><b style="font-size:12px;color:#626a5c">Your next shift</b>${pill(next ? "Scheduled" : "Your rota", "green")}</div>${shiftHTML}</div><a class="welcome-link" href="${url("schedule")}">View all scheduled shifts ${icon("arrow")}</a></section><div class="section-title between"><h2>Your week, at a glance</h2><small>${dateLabel(dates[0], { day: "numeric", month: "short" })} – ${dateLabel(dates[6], { day: "numeric", month: "short" })}</small></div><div class="metrics"><article class="metric"><div class="metric-icon">${icon("clock")}</div><strong>${durationLabel(minutes)}</strong><span>Scheduled hours</span><small>${week.length} shifts this week</small></article><article class="metric"><div class="metric-icon">${icon("wallet")}</div><strong>${Number.isFinite(u.hourlyRate) ? currency((minutes / 60) * u.hourlyRate) : "—"}</strong><span>Estimated gross pay</span><small>${Number.isFinite(u.hourlyRate) ? "Before tax & deductions" : "Hourly rate not set"}</small></article><article class="metric"><div class="metric-icon">${icon("star")}</div><strong>${Number(u.stars) || 0} <span style="font-size:18px;color:#dfaa0c">★</span></strong><span>Your McStars</span><small>A little recognition goes far</small></article></div><div class="two-cols" style="margin-top:23px"><section class="card"><div class="between"><h3>Keep growing</h3><a class="text-btn" href="${url("training")}">View all ${icon("arrow")}</a></div><p class="muted" style="font-size:11px;margin:4px 0 9px">A little learning. A lot more confidence.</p>${modules
      .slice(0, 2)
      .map(
        (m) =>
          `<a class="learning-card" href="${url("module", { id: m.id })}"><span class="tile-icon">${m.icon}</span><div class="learning-copy"><h4>${esc(m.title)}</h4><p>${m.time} · ${state.progress[m.id]?.completed ? "Completed" : "Ready when you are"}</p><div class="progress"><span style="width:${state.progress[m.id]?.completed ? 100 : 0}%"></span></div></div>${icon("chevron")}</a>`,
      )
      .join(
        "",
      )}<p class="muted" style="font-size:10px;margin-top:19px">${done} of ${modules.length} modules completed. One step at a time.</p></section><section class="card"><h3 style="margin-bottom:18px">Make it your day</h3><div class="quick-links"><a class="quick-link" href="${url("availability")}">${icon("clock")}<b>My availability</b></a><a class="quick-link" href="${url("schedule")}">${icon("calendar")}<b>My schedule</b></a><a class="quick-link" href="${url(isManager() ? "manage" : "rewards")}">${icon(isManager() ? "team" : "star")}<b>${isManager() ? "Plan a shift" : "My recognition"}</b></a><a class="quick-link" href="${url("assistant")}">${icon("spark")}<b>Ask McAssist</b></a></div></section></div>${isManager() ? `<section class="card" style="margin-top:23px"><div class="between"><div><h3>Your restaurant today</h3><p class="muted" style="font-size:12px;margin-top:6px">${state.shifts.filter((s) => s.date === isoDate()).length} scheduled shifts · ${state.team.length} team members</p></div><a class="btn soft" href="${url("manage")}">Plan a shift ${icon("arrow")}</a></div></section>` : ""}`;
  };
  const schedule = () => {
    const days = weekDates(state.offset),
      shifts = (isManager() ? state.shifts : myShifts())
        .filter((s) => s.date === state.selected)
        .sort((a, b) => a.start.localeCompare(b.start));
    return `${heading(isManager() ? "The team schedule." : "Your next good shift.", isManager() ? "See who’s in, where they’re working, and what’s ahead." : "A clear view of your week. A little more room to plan.")}<section class="card"><div class="between wrap"><div class="tabs">${["This week", "Next week", "Week after"].map((t, i) => `<button data-week="${i}" class="${state.offset === i ? "active" : ""}">${t}</button>`).join("")}</div>${isManager() ? `<a class="text-btn" href="${url("manage")}">${icon("plus")} Add shift</a>` : ""}</div><div class="week-strip">${days.map((d) => `<button class="day-btn ${d === state.selected ? "active" : ""}" data-day="${d}" aria-label="${dateLabel(d)}"><span>${dateLabel(d, { weekday: "short" })}</span><b>${dateLabel(d, { day: "numeric" })}</b>${(isManager() ? state.shifts : myShifts()).some((s) => s.date === d) ? "<i></i>" : '<i style="opacity:0"></i>'}</button>`).join("")}</div><div class="between"><h3>${dateLabel(state.selected, { weekday: "long", day: "numeric", month: "long" })}</h3>${pill(`${shifts.length} shifts`)}</div>${shifts.length ? shifts.map((s) => `<article class="shift-row"><span class="tile-icon">${icon("calendar")}</span><div class="grow"><h3>${esc(isManager() ? s.userName : s.station || "Your shift")}</h3><p>${esc(isManager() ? s.station || "Station unassigned" : state.user.storeName || state.user.storeId)} · ${durationLabel(shiftMinutes(s))}</p></div><div class="time">${esc(s.start)} – ${esc(s.end)}</div></article>`).join("") : empty(state.loaded ? "No shifts scheduled for this day." : "Loading your schedule…")}</section><section class="card" style="margin-top:20px"><div class="between wrap"><div><h3>Plans changed?</h3><p class="form-note">Keep your availability up to date and speak to your manager about swaps.</p></div><a class="btn light" href="${url("availability")}">Update availability ${icon("arrow")}</a></div></section>`;
  };
  const training = () => {
    const done = Object.values(state.progress).filter(
      (p) => p.completed,
    ).length;
    return `${heading("A little better, every shift.", "Build your confidence with bite-sized learning, made for real working days.")}<section class="card" style="margin-bottom:22px"><div class="between"><div><h3>Your learning journey</h3><p class="form-note">${done} of ${modules.length} modules completed</p></div><span class="tile-icon">${icon("book")}</span></div><div class="progress"><span style="width:${Math.round((done / modules.length) * 100)}%"></span></div></section><div class="training-grid">${modules.map((m) => `<article class="card training-tile"><div class="between"><span class="tile-icon">${m.icon}</span>${pill(state.progress[m.id]?.completed ? "Completed" : m.level, state.progress[m.id]?.completed ? "green" : "")}</div><h3>${esc(m.title)}</h3><p>${esc(m.tagline)}</p><div class="between"><small>${m.time} · ${m.xp} learning XP</small><a class="btn soft" href="${url("module", { id: m.id })}">${state.progress[m.id]?.completed ? "Review" : "Let’s learn"} ${icon("arrow")}</a></div></article>`).join("")}</div>`;
  };
  const modulePage = () => {
    const m = modules.find((m) => m.id === params.get("id"));
    if (!m)
      return `${heading("Module not found.", "Choose another module from your learning hub.")}<a class="btn" href="${url("training")}">Back to learning</a>`;
    return `<a class="text-btn" href="${url("training")}">← Back to my learning</a>${heading(esc(m.title), esc(m.tagline))}<section class="card module-content"><div class="between">${pill(m.time)}<span id="moduleStatus" class="pill yellow">${state.progress[m.id]?.completed ? "Completed" : "In progress"}</span></div>${m.sections.map((s) => `<h3>${esc(s.title)}</h3><p>${esc(s.text)}</p>`).join("")}<p class="form-note" style="margin-top:24px">General learning support. Your restaurant’s official procedures and trainer’s guidance always take priority.</p></section><form id="moduleForm" class="card" style="margin-top:20px"><h3>Your confidence check</h3>${m.checklist.map((item, i) => `<label class="check-row"><input type="checkbox" name="check${i}" required>${esc(item)}</label>`).join("")}<h3 style="margin-top:24px">Put it into practice</h3>${m.quiz.map((q, i) => `<fieldset class="quiz-question"><legend>${i + 1}. ${esc(q.q)}</legend>${q.a.map((a, j) => `<label><input type="radio" required name="quiz${i}" value="${j}">${esc(a)}</label>`).join("")}</fieldset>`).join("")}<div id="quizResult" role="status"></div><button class="btn" type="submit">Complete module ${icon("check")}</button></form>`;
  };
  const availability = () =>
    `${heading("Work that fits your week.", "Let your manager know when you’re available. This does not change published shifts.")}<form id="availabilityForm" class="card"><h3>Your usual availability</h3><p class="form-note">Set a time window for each day. Switch off days you cannot work.</p>${[
      "mon",
      "tue",
      "wed",
      "thu",
      "fri",
      "sat",
      "sun",
    ]
      .map((d) => {
        let v =
          state.user.availability?.[d] ||
          state.user.availability?.[
            {
              mon: "monday",
              tue: "tuesday",
              wed: "wednesday",
              thu: "thursday",
              fri: "friday",
              sat: "saturday",
              sun: "sunday",
            }[d]
          ];
        if (Array.isArray(v))
          v = v[0] ? { ...v[0], available: true } : { available: false };
        return `<div class="availability-row"><label><input name="${d}" type="checkbox" ${v?.available ? "checked" : ""}>${d.toUpperCase()}</label><input aria-label="${d} start time" name="${d}Start" type="time" value="${esc(v?.start || "09:00")}" required><input aria-label="${d} end time" name="${d}End" type="time" value="${esc(v?.end || "17:00")}" required></div>`;
      })
      .join(
        "",
      )}<div id="availabilityResult" role="status"></div><button class="btn" style="margin-top:22px" type="submit">Save availability ${icon("check")}</button></form>`;
  const team = () => {
    if (!isManager()) return empty("This page is available to managers.");
    return `${heading("Great people. Great shifts.", "Your restaurant team, together in one place.")}<div class="between wrap" style="margin-bottom:20px"><a class="btn" href="${url("manage")}">${icon("plus")} Plan a shift</a>${pill(`${state.team.length} team members`)}</div><section class="card">${state.team.length ? state.team.map((u) => `<div class="team-row"><div class="avatar">${esc(u.name?.[0] || "?")}</div><div class="grow"><h3>${esc(u.name || "Crew member")}</h3><p>${managerRole(u.role) ? "Manager" : "Crew member"} · ${Number(u.stars) || 0} McStars</p></div><button class="btn light" data-person="${esc(u.id)}">View</button></div>`).join("") : empty(state.loaded ? "No team profiles available. Team members must belong to the same store." : "Loading your team…")}</section>`;
  };
  const manage = () => {
    if (!isManager())
      return empty(
        "Shift planning is available to managers. You can see your rota in My shifts.",
      );
    return `${heading("Set your team up for a good shift.", "Assign a crew member, choose a station and publish to the shared rota.")}<form id="shiftForm" class="card"><h3 style="margin-bottom:22px">Plan a shift</h3><div class="field"><label for="member">Team member</label><select id="member" name="member" required><option value="">Choose a team member</option>${state.team.map((u) => `<option value="${esc(u.id)}">${esc(u.name || u.email || "Crew member")}</option>`).join("")}</select></div><div class="field-grid"><div class="field"><label for="date">Date</label><input id="date" name="date" type="date" value="${isoDate()}" min="${isoDate()}" required></div><div class="field"><label for="station">Station</label><select id="station" name="station">${["Front Counter", "Kitchen", "Drive-thru", "Fries", "Grill", "Lobby", "Shift Lead", "Training"].map((s) => `<option>${s}</option>`).join("")}</select></div></div><div class="field-grid"><div class="field"><label for="start">Starts at</label><input id="start" name="start" type="time" value="09:00" required></div><div class="field"><label for="end">Finishes at</label><input id="end" name="end" type="time" value="17:00" required></div></div><div class="field"><label for="breakMinutes">Unpaid break (minutes)</label><input id="breakMinutes" name="breakMinutes" type="number" min="0" max="120" value="30" required></div><p class="form-note">An end time earlier than the start means the shift finishes the following day. Check availability before publishing.</p><div id="shiftResult" role="status"></div><button class="btn" type="submit">${icon("plus")} Publish shift</button></form><section class="card" id="upcomingShifts" style="margin-top:22px"><div class="between"><h3>Upcoming shifts</h3><a class="text-btn" href="${url("schedule")}">Full rota ${icon("arrow")}</a></div>${
      state.shifts
        .filter((s) => s.date >= isoDate())
        .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start))
        .slice(0, 12)
        .map(
          (s) =>
            `<div class="shift-row"><div class="grow"><h3>${esc(s.userName)}</h3><p>${dateLabel(s.date)} · ${esc(s.start)}–${esc(s.end)} · ${esc(s.station)}</p></div><button class="icon-btn" data-delete="${esc(s.id)}" aria-label="Delete ${esc(s.userName)} shift">${icon("close")}</button></div>`,
        )
        .join("") || empty("No upcoming shifts. Add your first one above.")
    }</section>`;
  };
  const rewards = () =>
    `${heading("Your good work deserves a star.", "A little recognition for the effort you bring to your team.")}<section class="card reward-hero"><div class="between"><div><div class="eyebrow">YOUR MCSTARS</div><div class="reward-number">${Number(state.user.stars) || 0} <span style="color:#cf9200">★</span></div><p class="muted" style="font-size:13px">${esc(state.user.badge || "Every contribution counts.")}</p></div><span style="font-size:80px">🌟</span></div></section><section class="card" style="margin-top:22px"><h3>There’s more than one way to shine.</h3><div class="reward-grid"><div>${icon("team")}<b>Help your team</b></div><div>${icon("book")}<b>Keep learning</b></div><div>${icon("star")}<b>Make someone’s day</b></div></div><p class="form-note" style="margin-top:22px">Recognition is recorded by your manager. Ask your shift lead about the rewards available at your restaurant.</p></section>`;
  const assistant = () =>
    `${heading("A little help, right when you need it.", "Meet McAssist, your companion for learning and everyday shift questions.")}<section class="card"><h3>What’s on your mind?</h3><p class="form-note">Get help preparing for a shift, practise a customer conversation, or break down a learning topic.</p><div class="stack" style="margin-top:20px">${["Help me prepare for my next shift", "Practise handling a customer complaint with me", "How can I support a new crew member?"].map((s) => `<button class="btn light" data-ask="${esc(s)}">${icon("spark")}${s}</button>`).join("")}</div><p class="form-note">McAssist gives guidance. Changes to shifts are made through the shift planner.</p></section>`;
  // The waste counter is rendered by waste-page.js once the page loads.
  const waste = () =>
    `<div class="page-loading" role="status" aria-live="polite"><span class="spinner" aria-hidden="true"></span><p>Opening the waste counter…</p></div>`;
  return {
    home,
    schedule,
    training,
    module: modulePage,
    availability,
    team,
    manage,
    rewards,
    assistant,
    waste,
  }[page]();
}
