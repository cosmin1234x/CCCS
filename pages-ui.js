// Interactions for the core pages: week navigation, the shift editor and
// "Copy last week", the team drawer (pay, badge, notes, McStars), role
// requests, the availability editor and the notifications panel.
// All writes go through `writes`, which never touches Firebase in preview.
import {
  isoDate,
  weekDates,
  shiftEnd,
  shiftStart,
  durationLabel,
  escapeHTML as esc,
  STATIONS,
  DAY_KEYS,
  normaliseAvailability,
  availabilityFor,
  validateShift,
  planCopy,
  toMinutes,
  fromMinutes,
  grossMinutes,
  validTime,
  weekOffsetOf,
} from "./portal-core.js";
import {
  ic,
  memberDrawer,
  AVAILABILITY_PRESETS,
  normaliseRole,
  roleLabel,
  firstName,
  dateMed,
  dateLong,
  weekRangeLabel,
  clampOffset,
  timeAgo,
  rateOf,
  sortTeam,
  whenLabel,
  stationStyle,
  isInactive,
} from "./pages-views.js";

let ctx = null;
const $ = (id) => document.getElementById(id);
const money = (value) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(
    value,
  );
const finePointer = () =>
  Boolean(window.matchMedia?.("(pointer: fine)").matches);
const reducedMotion = () =>
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const uid = () =>
  "pv-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export function friendlyError(error) {
  const code = String(error?.code || "");
  if (code.includes("permission-denied"))
    return "Your account does not have permission to do that. Ask a manager to check your access.";
  if (code.includes("unavailable") || error?.name === "TypeError")
    return "You seem to be offline. Check your connection and try again.";
  return error?.message || "Something went wrong. Please try again.";
}
const isPermission = (error) =>
  String(error?.code || "").includes("permission-denied");

// -------------------------------------------------------------- the sheet --
// One reusable <dialog>: a centred modal, a side drawer (bottom sheet on
// phones) or a notification panel. Esc, backdrop taps and swipe-down on the
// handle are handled by the design system's dialog behaviour (motion.js),
// which animates via the [data-closing] attribute; closeSheet() matches it.
let sheetOpener = null;
export function openSheet({ title, body, variant = "modal", label = "" }) {
  let dlg = $("pgSheet");
  if (!dlg) {
    dlg = document.createElement("dialog");
    dlg.id = "pgSheet";
    document.body.appendChild(dlg);
    dlg.addEventListener("close", () => {
      document.documentElement.classList.remove("pg-locked");
      dlg.removeAttribute("data-closing");
      const back = sheetOpener;
      sheetOpener = null;
      if (back?.isConnected) back.focus({ preventScroll: true });
    });
  }
  if (!dlg.open) sheetOpener = document.activeElement;
  dlg.removeAttribute("data-closing");
  dlg.className = `pg-sheet pg-sheet--${variant}`;
  dlg.setAttribute("aria-labelledby", "pgSheetTitle");
  // The dialog is the only scroller; the top (handle + header) and the action
  // bar stick to its edges (pages.css "sheets").
  dlg.innerHTML = `<div class="pg-sheet-inner"><div class="pg-sheet-top"><div class="sheet-handle pg-sheet-handle" data-sheet-drag aria-hidden="true"></div><header class="pg-sheet-head"><div><h2 id="pgSheetTitle" tabindex="-1">${title}</h2>${label ? `<p class="pg-muted">${label}</p>` : ""}</div><button type="button" class="pg-iconbtn" data-sheet-close aria-label="Close">${ic("close")}</button></header></div><div class="pg-sheet-body">${body}</div></div>`;
  dlg.querySelectorAll("[data-sheet-close]").forEach((b) => (b.onclick = closeSheet));
  if (!dlg.open) dlg.showModal();
  document.documentElement.classList.add("pg-locked");
  dlg.scrollTop = 0;
  // Start screen readers and keyboards at the title rather than flashing a
  // focus ring on the close button.
  dlg.querySelector("#pgSheetTitle").focus({ preventScroll: true });
  return dlg;
}
export function closeSheet() {
  const dlg = $("pgSheet");
  if (!dlg?.open || dlg.hasAttribute("data-closing")) return;
  if (reducedMotion()) return dlg.close();
  dlg.setAttribute("data-closing", "");
  const done = () => {
    dlg.removeEventListener("animationend", onEnd);
    if (!dlg.hasAttribute("data-closing")) return;
    dlg.removeAttribute("data-closing");
    if (dlg.open) dlg.close();
  };
  const onEnd = (event) => event.target === dlg && done();
  dlg.addEventListener("animationend", onEnd);
  setTimeout(done, 320);
}
const sheetBody = () => $("pgSheet")?.querySelector(".pg-sheet-body");
const rendered = new WeakMap();
const setHTML = (el, html) => {
  if (el && rendered.get(el) !== html) {
    rendered.set(el, html);
    el.innerHTML = html;
  }
};
const setText = (el, text) => {
  if (el && el.textContent !== text) el.textContent = text;
};

// ----------------------------------------------------------------- writes --
const fire = () => ctx.firebase();
const shiftsCol = () => {
  const { fb, db } = fire();
  return fb.collection(db, "stores", ctx.state.user.storeId, "Shifts");
};
const shiftFields = (d) => ({
  userId: d.userId,
  userName: d.userName,
  role: d.role || "crew",
  date: d.date,
  start: d.start,
  end: d.end,
  station: d.station,
  breakMinutes: Number(d.breakMinutes) || 0,
});

export const writes = {
  async createShift(data) {
    const s = ctx.state;
    const record = { ...shiftFields(data), createdBy: s.user.id };
    if (ctx.preview) {
      s.shifts.push({ ...record, id: uid() });
      ctx.persist();
      return;
    }
    const { fb } = fire();
    const ref = await fb.addDoc(shiftsCol(), {
      ...record,
      createdAt: fb.serverTimestamp(),
    });
    if (!s.shifts.some((x) => x.id === ref.id))
      s.shifts.push({ ...record, id: ref.id });
  },
  async updateShift(id, data) {
    const s = ctx.state;
    const fields = shiftFields(data);
    if (!ctx.preview) {
      const { fb, db } = fire();
      await fb.updateDoc(fb.doc(db, "stores", s.user.storeId, "Shifts", id), {
        ...fields,
        updatedBy: s.user.id,
        updatedAt: fb.serverTimestamp(),
      });
    }
    s.shifts = s.shifts.map((x) => (x.id === id ? { ...x, ...fields } : x));
    ctx.persist();
  },
  async deleteShift(id) {
    const s = ctx.state;
    if (!ctx.preview) {
      const { fb, db } = fire();
      await fb.deleteDoc(fb.doc(db, "stores", s.user.storeId, "Shifts", id));
    }
    s.shifts = s.shifts.filter((x) => x.id !== id);
    ctx.persist();
  },
  async createShifts(list) {
    const s = ctx.state;
    const records = list.map((d) => ({ ...shiftFields(d), createdBy: s.user.id }));
    if (ctx.preview) {
      records.forEach((r) => s.shifts.push({ ...r, id: uid() }));
      ctx.persist();
      return;
    }
    const { fb, db } = fire();
    if (typeof fb.writeBatch === "function") {
      for (let i = 0; i < records.length; i += 400) {
        const batch = fb.writeBatch(db);
        const chunk = records.slice(i, i + 400).map((r) => {
          const ref = fb.doc(shiftsCol());
          batch.set(ref, { ...r, createdAt: fb.serverTimestamp() });
          return { ...r, id: ref.id };
        });
        await batch.commit();
        chunk.forEach((r) => {
          if (r.id && !s.shifts.some((x) => x.id === r.id)) s.shifts.push(r);
        });
      }
      return;
    }
    for (const r of records) {
      const ref = await fb.addDoc(shiftsCol(), {
        ...r,
        createdAt: fb.serverTimestamp(),
      });
      if (!s.shifts.some((x) => x.id === ref.id)) s.shifts.push({ ...r, id: ref.id });
    }
  },
  async updateMember(member, patch) {
    const s = ctx.state;
    if (!ctx.preview) {
      const { fb, db } = fire();
      try {
        await fb.updateDoc(fb.doc(db, "users", member.id), {
          ...patch,
          updatedAt: fb.serverTimestamp(),
          updatedBy: s.user.id,
        });
      } catch (error) {
        // Older deployed rules may not allow this yet: the server re-checks
        // manager + store and saves it instead.
        if (!isPermission(error)) throw error;
        await ctx.api("/api/portal-data", {
          method: "POST",
          body: JSON.stringify({ action: "updateMember", uid: member.id, patch }),
        });
      }
    }
    applyMember(member.id, patch);
    ctx.persist();
  },
  async giveStars(member, amount, note) {
    const s = ctx.state;
    const createdAt = Date.now();
    const record = {
      userId: member.id,
      userName: member.name || "Team member",
      amount,
      note,
      createdBy: s.user.id,
      createdByName: s.user.name || "Manager",
      source: "portal",
    };
    let id = uid();
    if (!ctx.preview) {
      const { fb, db } = fire();
      try {
        const batch = fb.writeBatch(db);
        const ref = fb.doc(
          fb.collection(db, "stores", s.user.storeId, "recognition"),
        );
        id = ref.id || id;
        batch.update(fb.doc(db, "users", member.id), {
          stars: fb.increment(amount),
          updatedAt: fb.serverTimestamp(),
          updatedBy: s.user.id,
        });
        batch.set(ref, { ...record, createdAt: fb.serverTimestamp() });
        await batch.commit();
      } catch (error) {
        if (!isPermission(error)) throw error;
        const result = await ctx.api("/api/portal-data", {
          method: "POST",
          body: JSON.stringify({
            action: "giveStars",
            uid: member.id,
            amount,
            note,
          }),
        });
        id = result?.recognitionId || id;
      }
    }
    const current = findMember(member.id);
    applyMember(member.id, { stars: (Number(current?.stars) || 0) + amount });
    s.extras.recognition = [
      { ...record, id, createdAt },
      ...(s.extras.recognition || []),
    ];
    ctx.persist();
  },
  async decideRole(targetUid, approve) {
    const s = ctx.state;
    const request = (s.extras.roleRequests || []).find(
      (r) => (r.uid || r.id) === targetUid,
    );
    if (!ctx.preview) {
      await ctx.api("/api/role-request", {
        method: "POST",
        body: JSON.stringify({ action: approve ? "approve" : "reject", uid: targetUid }),
      });
    }
    s.extras.roleRequests = (s.extras.roleRequests || []).filter(
      (r) => (r.uid || r.id) !== targetUid,
    );
    applyMember(targetUid, {
      ...(approve && request ? { role: request.requestedRole } : {}),
      roleRequestStatus: approve ? "approved" : "rejected",
      requestedRole: approve && request ? request.requestedRole : "",
    });
    ctx.persist();
  },
  async saveAvailability(availability) {
    const s = ctx.state;
    if (!ctx.preview) {
      const { fb, db } = fire();
      try {
        await fb.updateDoc(fb.doc(db, "users", s.user.id), {
          availability,
          availabilityUpdatedAt: fb.serverTimestamp(),
        });
      } catch (error) {
        if (!isPermission(error)) throw error;
        await ctx.api("/api/portal-data", {
          method: "POST",
          body: JSON.stringify({ action: "saveAvailability", availability }),
        });
      }
    }
    s.user.availability = availability;
    applyMember(s.user.id, { availability });
    ctx.persist();
  },
};

function applyMember(id, patch) {
  const s = ctx.state;
  s.team = (s.team || []).map((m) => (m.id === id ? { ...m, ...patch } : m));
  if (s.user.id === id) Object.assign(s.user, patch);
}
const findMember = (id) =>
  (ctx.state.team || []).find((m) => m.id === id) ||
  (ctx.state.user.id === id ? ctx.state.user : null);
const findShift = (id) => ctx.state.shifts.find((s) => s.id === id);

// --------------------------------------------------------------- binding --
let deepLinkDone = false;
let unloadGuard = null;
export function bindPage(page, c) {
  ctx = c;
  const root = $("content");
  if (!root) return;
  root.querySelectorAll("[data-week-step]").forEach(
    (b) =>
      (b.onclick = () =>
        setWeek((c.state.offset || 0) + Number(b.dataset.weekStep))),
  );
  root.querySelectorAll("[data-week-today]").forEach((b) => (b.onclick = () => setWeek(0)));
  root.querySelectorAll("[data-select-day]").forEach(
    (b) =>
      (b.onclick = () => {
        c.state.selected = b.dataset.selectDay;
        c.render();
      }),
  );
  root.querySelectorAll("[data-schedule-mode]").forEach(
    (b) =>
      (b.onclick = () => {
        c.state.ui.scheduleMode = b.dataset.scheduleMode;
        try {
          sessionStorage.setItem("mc_schedule_mode", b.dataset.scheduleMode);
        } catch {}
        c.render();
      }),
  );
  root.querySelectorAll("[data-print]").forEach((b) => (b.onclick = () => window.print()));
  if (c.isManager()) {
    root.querySelectorAll("[data-shift]").forEach(
      (b) =>
        (b.onclick = () => {
          const shift = findShift(b.dataset.shift);
          if (shift) openShiftEditor({ shift });
          else c.toast("That shift has just been changed. Take another look.");
        }),
    );
    root.querySelectorAll("[data-add-shift]").forEach(
      (b) =>
        (b.onclick = () =>
          openShiftEditor({ memberId: b.dataset.member, date: b.dataset.date })),
    );
    root.querySelectorAll("[data-copy-week]").forEach((b) => (b.onclick = openCopyWeek));
    root.querySelectorAll("[data-member]").forEach(
      (b) => (b.onclick = () => openMember(b.dataset.member)),
    );
    root.querySelectorAll("[data-give-stars]").forEach(
      (b) => (b.onclick = () => openMember(b.dataset.giveStars, { stars: true })),
    );
    root.querySelectorAll("[data-role-approve],[data-role-reject]").forEach(bindRoleDecision);
  }
  if (page === "team") bindTeamFilters(root);
  if (page === "availability") bindAvailability();
  if (page === "manage") consumeDeepLink();
  refreshShiftEditor();
}

// A live update that leaves the page markup unchanged keeps the DOM (and the
// bindings above). Open sheets and a pending planner deep link still follow
// the new data.
export function refreshPage(page, c) {
  ctx = c;
  if (page === "manage") consumeDeepLink();
  refreshShiftEditor();
}

function setWeek(offset) {
  const s = ctx.state;
  s.offset = clampOffset(offset);
  const dates = weekDates(s.offset);
  s.selected = dates.includes(isoDate()) ? isoDate() : dates[0];
  try {
    const next = new URL(location.href);
    if (s.offset) next.searchParams.set("week", String(s.offset));
    else next.searchParams.delete("week");
    history.replaceState(history.state, "", next);
  } catch {}
  ctx.render();
}

/** Planner deep links: ?member=<uid>&date=<YYYY-MM-DD> open the editor once. */
function consumeDeepLink() {
  if (deepLinkDone) return;
  const memberId = ctx.params.get("member");
  const date = ctx.params.get("date");
  if (!memberId && !date) {
    deepLinkDone = true;
    return;
  }
  if (memberId && !findMember(memberId)) {
    if (ctx.state.teamLoaded) deepLinkDone = true;
    return;
  }
  deepLinkDone = true;
  try {
    const next = new URL(location.href);
    next.searchParams.delete("member");
    next.searchParams.delete("date");
    history.replaceState(history.state, "", next);
  } catch {}
  setTimeout(() => openShiftEditor({ memberId: memberId || "", date: date || "" }), 0);
}

// --------------------------------------------------------- shift editor --
function suggestTimes(member, date) {
  const a = member ? availabilityFor(member.availability, date) : null;
  if (a?.status === "on") {
    const w = a.windows[0];
    const start = toMinutes(w.start);
    const len = grossMinutes(w.start, w.end) || 480;
    return { start: w.start, end: fromMinutes(start + Math.min(len, 480)) };
  }
  return { start: "09:00", end: "17:00" };
}
function defaultStation(member) {
  const verified = Array.isArray(member?.verifiedStations) ? member.verifiedStations : [];
  if (normaliseRole(member?.role) === "manager") return "Shift Lead";
  return verified[0] || (member ? "Training" : "Front Counter");
}

// The open shift editor, so a live team update can refresh its member list.
let openEditor = null;
function refreshShiftEditor() {
  if (openEditor?.form.isConnected && $("pgSheet")?.open) openEditor.refresh();
  else openEditor = null;
}

export function openShiftEditor({ shift = null, memberId = "", date = "" } = {}) {
  const s = ctx.state;
  if (!ctx.isManager()) return;
  // Deactivated people can't be given new shifts (an existing shift of theirs
  // can still be edited or removed).
  const pickable = () =>
    sortTeam(ctx.state.team).filter((m) => !isInactive(m) || m.id === shift?.userId);
  let team = pickable();
  // Signed in, the team arrives on its own live listener, which can land
  // after the planner opens. The list fills in (and unlocks) when it does.
  const loadingTeam = () => !team.length && !ctx.state.teamLoaded;
  const optionsHTML = () =>
    loadingTeam()
      ? '<option value="">Loading your team…</option>'
      : `<option value="">Choose a team member</option>${team
          .map((m) => `<option value="${esc(m.id)}">${esc(m.name || "Team member")} · ${esc(roleLabel(m.role))}</option>`)
          .join("")}`;
  const editing = Boolean(shift);
  const wanted = shift?.userId || memberId;
  const member = team.find((m) => m.id === wanted) || null;
  const today = isoDate();
  const viewed = weekDates(s.offset || 0);
  const day =
    shift?.date ||
    date ||
    (viewed.includes(today) ? today : viewed[0] > today ? viewed[0] : today);
  const times = editing ? { start: shift.start, end: shift.end } : suggestTimes(member, day);
  const station = shift?.station || defaultStation(member);
  const brk = editing ? Number(shift.breakMinutes) || 0 : 30;
  let optionsShown = optionsHTML();
  const stations = STATIONS.includes(station) ? STATIONS : [station, ...STATIONS];
  const body = `<form id="pgShiftForm" class="pg-shift-form" novalidate><div class="pg-form-grid"><label class="pg-field pg-span-2"><span>Team member</span><select name="member" required${loadingTeam() ? " disabled" : ""}>${optionsShown}</select></label><label class="pg-field"><span>Date</span><input type="date" name="date" required value="${esc(day)}"></label><label class="pg-field"><span>Station</span><select name="station">${stations.map((x) => `<option>${esc(x)}</option>`).join("")}</select></label><label class="pg-field"><span>Starts</span><input type="time" name="start" required step="300" value="${esc(times.start)}"></label><label class="pg-field"><span>Finishes</span><input type="time" name="end" required step="300" value="${esc(times.end)}"></label><label class="pg-field"><span>Unpaid break</span><select name="breakMinutes">${[0, 15, 20, 30, 45, 60]
    .map((n) => `<option value="${n}">${n ? n + " minutes" : "No break"}</option>`)
    .join("")}</select></label><div class="pg-field pg-quick"><span>Quick times</span><div class="pg-quick-times" role="group" aria-label="Quick times"><button type="button" class="pg-chip" data-times="avail">Match availability</button>${[
    ["06:00", "14:00"],
    ["09:00", "17:00"],
    ["11:00", "19:00"],
    ["16:00", "23:00"],
    ["17:00", "01:00"],
  ]
    .map(([a, b]) => `<button type="button" class="pg-chip" data-times="${a}-${b}">${a}–${b}</button>`)
    .join("")}</div></div></div><div class="pg-shift-context" id="pgShiftContext"></div><ul class="pg-checks" id="pgShiftChecks" aria-live="polite"></ul><div class="pg-sheet-actions" id="pgShiftActions">${editing ? `<button type="button" class="btn danger" id="pgShiftDelete">${ic("close")}Delete shift</button>` : ""}<span class="grow"></span><button type="button" class="btn light" data-sheet-close>Cancel</button><button type="submit" class="btn" id="pgShiftSubmit">${editing ? "Save changes" : "Publish shift"}</button></div>${editing ? `<div class="pg-sheet-actions pg-confirm" id="pgShiftConfirm" role="group" aria-labelledby="pgConfirmText" hidden><span class="pg-confirm-text" id="pgConfirmText">${ic("alert")}Delete ${esc(firstName(shift.userName))}’s ${esc(dateMed(shift.date))} shift from the rota?</span><button type="button" class="btn light" id="pgShiftKeep">Keep shift</button><button type="button" class="btn danger is-armed" id="pgShiftConfirmDelete">Yes, delete shift</button></div>` : ""}</form>`;
  const dlg = openSheet({
    title: editing ? "Edit shift" : "Add a shift",
    label: editing ? `${esc(shift.userName)} · ${esc(dateMed(shift.date))}` : "Checks availability, clashes and rest as you type.",
    body,
    variant: "modal",
  });
  const form = dlg.querySelector("#pgShiftForm");
  const el = form.elements;
  el.member.value = member?.id || "";
  el.station.value = station;
  el.breakMinutes.value = [0, 15, 20, 30, 45, 60].includes(brk) ? String(brk) : "30";
  if (![0, 15, 20, 30, 45, 60].includes(brk)) {
    el.breakMinutes.insertAdjacentHTML("beforeend", `<option value="${brk}">${brk} minutes</option>`);
    el.breakMinutes.value = String(brk);
  }
  const submit = form.querySelector("#pgShiftSubmit");
  let busy = false;
  const collect = () => {
    const person = team.find((m) => m.id === el.member.value);
    return {
      id: shift?.id,
      userId: person?.id || "",
      userName: person?.name || shift?.userName || "",
      role: person?.role || shift?.role || "crew",
      date: el.date.value,
      start: el.start.value,
      end: el.end.value,
      station: el.station.value,
      breakMinutes: Number(el.breakMinutes.value),
      person,
    };
  };
  const update = () => {
    const d = collect();
    const check = validateShift(d, { shifts: s.shifts, member: d.person, today });
    const warnings = editing
      ? check.warnings.filter((w) => !(w === "This date has already passed." && d.date === shift.date))
      : check.warnings;
    const list = loadingTeam()
      ? [`<li class="note">${ic("team")}<span>Loading your team. The list fills in as soon as it arrives.</span></li>`]
      : [
          ...check.errors.map((t) => `<li class="err">${ic("alert")}<span>${esc(t)}</span></li>`),
          ...warnings.map((t) => `<li class="warn">${ic("alert")}<span>${esc(t)}</span></li>`),
          ...check.notes.map((t) => `<li class="note">${ic("shield")}<span>${esc(t)}</span></li>`),
        ];
    if (!check.errors.length && !warnings.length && d.userId)
      list.unshift(`<li class="ok">${ic("check")}<span>No clashes, within availability and enough rest.</span></li>`);
    const rate = rateOf(d.person);
    const summary = d.userId && check.paidMinutes
      ? `<li class="sum"><span>${durationLabel(check.paidMinutes)} paid${rate ? ` · est. ${money((check.paidMinutes / 60) * rate)}` : ""} · ${esc(firstName(d.userName))}’s week: ${durationLabel(check.weekMinutes)}</span></li>`
      : "";
    // Only touch the DOM when something changed: WebKit drops a tap on the
    // submit button if nodes under it are replaced between touch start/end
    // (the time input's blur fires "change" at exactly that moment).
    setHTML($("pgShiftChecks"), list.join("") + summary);
    // Context: the person's availability that day and their other shifts.
    if (d.person && /^\d{4}-\d{2}-\d{2}$/.test(d.date)) {
      const a = availabilityFor(d.person.availability, d.date);
      const same = s.shifts
        .filter((x) => x.userId === d.userId && x.id !== shift?.id && Math.abs(new Date(`${x.date}T12:00`) - new Date(`${d.date}T12:00`)) <= 864e5)
        .sort((x, y) => (x.date + x.start).localeCompare(y.date + y.start));
      setHTML($("pgShiftContext"), `<div class="pg-ctx av-${a.status}"><small>${esc(dateMed(d.date))} availability</small><b>${a.status === "on" ? esc(a.windows.map((w) => `${w.start}–${w.end}`).join(", ")) : a.status === "off" ? "Unavailable" : "Not set"}</b></div><div class="pg-ctx"><small>Nearby shifts</small><b>${same.length ? same.map((x) => `${esc(dateMed(x.date))} ${esc(x.start)}–${esc(x.end)}`).join("<br>") : "None"}</b></div>`);
    } else setHTML($("pgShiftContext"), "");
    const blocked = busy || check.errors.length > 0 || loadingTeam();
    if (submit.disabled !== blocked) submit.disabled = blocked;
    setText(
      submit,
      editing
        ? warnings.length ? "Save anyway" : "Save changes"
        : warnings.length ? "Publish anyway" : "Publish shift",
    );
    return { d, check };
  };
  form.addEventListener("input", update);
  form.addEventListener("change", update);
  let chosen = false,
    timesEdited = false;
  el.member.addEventListener("change", () => (chosen = true));
  el.start.addEventListener("input", () => (timesEdited = true));
  el.end.addEventListener("input", () => (timesEdited = true));
  // Live team update while the editor is open (bindPage calls this).
  const refreshTeam = () => {
    team = pickable();
    const html = optionsHTML();
    if (html === optionsShown) return;
    optionsShown = html;
    const keep = el.member.value || (chosen ? "" : wanted);
    el.member.innerHTML = html;
    el.member.disabled = loadingTeam();
    const found = team.find((m) => m.id === keep) || null;
    el.member.value = found ? keep : "";
    // The person this editor was opened for has just arrived: suggest their
    // usual times and station, unless the manager already set them.
    if (!editing && found && keep === wanted && !member && !timesEdited) {
      const times = suggestTimes(found, el.date.value);
      el.start.value = times.start;
      el.end.value = times.end;
      const preferred = defaultStation(found);
      if ([...el.station.options].some((o) => o.value === preferred))
        el.station.value = preferred;
    }
    update();
  };
  openEditor = { form, refresh: refreshTeam };
  form.querySelectorAll("[data-times]").forEach(
    (b) =>
      (b.onclick = () => {
        let times = b.dataset.times.split("-");
        if (b.dataset.times === "avail") {
          const d = collect();
          const a = d.person ? availabilityFor(d.person.availability, d.date) : null;
          if (a?.status !== "on") {
            ctx.toast(d.person ? `${firstName(d.person.name)} has no availability window that day.` : "Choose a team member first.");
            return;
          }
          const suggestion = suggestTimes(d.person, d.date);
          times = [suggestion.start, suggestion.end];
        }
        el.start.value = times[0];
        el.end.value = times[1];
        timesEdited = true;
        update();
      }),
  );
  const del = form.querySelector("#pgShiftDelete");
  if (del) {
    // Deleting asks for an explicit second choice (no timers to race).
    const actions = form.querySelector("#pgShiftActions");
    const confirmBar = form.querySelector("#pgShiftConfirm");
    const yes = form.querySelector("#pgShiftConfirmDelete");
    const showConfirm = (on) => {
      actions.hidden = on;
      confirmBar.hidden = !on;
      if (finePointer())
        (on ? form.querySelector("#pgShiftKeep") : del).focus({ preventScroll: true });
    };
    del.onclick = () => !busy && showConfirm(true);
    form.querySelector("#pgShiftKeep").onclick = () => !busy && showConfirm(false);
    yes.onclick = async () => {
      if (busy) return;
      busy = true;
      yes.disabled = true;
      setText(yes, "Deleting…");
      try {
        await writes.deleteShift(shift.id);
        closeSheet();
        ctx.toast(`Removed ${firstName(shift.userName)}’s ${dateMed(shift.date)} shift.`);
        ctx.render();
      } catch (error) {
        busy = false;
        yes.disabled = false;
        setText(yes, "Yes, delete shift");
        showConfirm(false);
        $("pgShiftChecks").insertAdjacentHTML("afterbegin", `<li class="err">${ic("alert")}<span>${esc(friendlyError(error))}</span></li>`);
        update();
      }
    };
  }
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (busy) return;
    const { d, check } = update();
    if (check.errors.length) {
      $("pgShiftChecks").querySelector(".err")?.scrollIntoView?.({ block: "nearest" });
      return;
    }
    busy = true;
    submit.disabled = true;
    submit.textContent = "Saving…";
    try {
      if (editing) await writes.updateShift(shift.id, d);
      else await writes.createShift(d);
      closeSheet();
      ctx.toast(
        `${editing ? "Updated" : ctx.preview ? "Added" : "Published"} ${firstName(d.userName)} · ${dateMed(d.date)} · ${d.start}–${d.end}`,
      );
      if (!editing && d.date && !weekDates(ctx.state.offset || 0).includes(d.date))
        ctx.state.offset = clampOffset(weekOffsetOf(d.date));
      ctx.state.selected = d.date;
      ctx.render();
    } catch (error) {
      busy = false;
      $("pgShiftChecks").insertAdjacentHTML("afterbegin", `<li class="err">${ic("alert")}<span>${esc(friendlyError(error))}</span></li>`);
      submit.disabled = false;
      submit.textContent = editing ? "Save changes" : "Publish shift";
    }
  };
  update();
  // Don't pop the on-screen keyboard open on phones and iPads.
  if (finePointer()) (member ? el.start : el.member).focus({ preventScroll: true });
}

// ---------------------------------------------------------- copy a week --
export function openCopyWeek() {
  const s = ctx.state;
  const offset = s.offset || 0;
  const target = weekDates(offset),
    source = weekDates(offset - 1);
  // Deactivated people are left out: their shifts are skipped, not copied.
  const plan = planCopy({
    source: s.shifts.filter((x) => source.includes(x.date)),
    existing: s.shifts,
    team: (s.team || []).filter((m) => !isInactive(m)),
    days: 7,
  });
  const inactiveIds = new Set((s.team || []).filter(isInactive).map((m) => m.id));
  for (const x of plan.skipped)
    if (inactiveIds.has(x.shift?.userId)) x.reason = "account deactivated";
  const row = (x, reason = "") =>
    `<li><span class="pg-station-dot" style="${stationStyle(x.station)}" aria-hidden="true"></span><span class="grow"><b>${esc(x.userName)}</b><small>${esc(dateMed(x.date))} · ${esc(x.start)}–${esc(x.end)} · ${esc(x.station || "Station TBC")}</small></span>${reason ? `<em>${esc(reason)}</em>` : ""}</li>`;
  const body = `<p class="pg-muted">Copies every shift from <b>${esc(weekRangeLabel(source))}</b> into <b>${esc(weekRangeLabel(target))}</b>. Anything that would clash, fall outside availability or land in the past is skipped.</p><div class="pg-copy-sum"><div class="ok"><b>${plan.create.length}</b><small>to copy</small></div><div class="skip"><b>${plan.skipped.length}</b><small>skipped</small></div></div>${
    plan.create.length
      ? `<details class="pg-copy-details" open><summary>Shifts to copy (${plan.create.length})</summary><ul class="pg-copy-list">${plan.create.map((x) => row(x)).join("")}</ul></details>`
      : ""
  }${
    plan.skipped.length
      ? `<details class="pg-copy-details" ${plan.create.length ? "" : "open"}><summary>Skipped (${plan.skipped.length})</summary><ul class="pg-copy-list">${plan.skipped.map((x) => row(x.shift, x.reason)).join("")}</ul></details>`
      : ""
  }<div id="pgCopyResult" role="status"></div><div class="pg-sheet-actions"><span class="grow"></span><button type="button" class="btn light" data-sheet-close>Cancel</button><button type="button" class="btn" id="pgCopyConfirm" ${plan.create.length ? "" : "disabled"}>${plan.create.length ? `Copy ${plan.create.length} shift${plan.create.length === 1 ? "" : "s"}` : "Nothing to copy"}</button></div>`;
  const dlg = openSheet({ title: "Copy last week", body, variant: "modal" });
  const confirm = dlg.querySelector("#pgCopyConfirm");
  let busy = false;
  confirm.onclick = async () => {
    if (busy || !plan.create.length) return;
    busy = true;
    confirm.disabled = true;
    confirm.textContent = "Copying…";
    try {
      await writes.createShifts(plan.create);
      closeSheet();
      ctx.toast(
        `Copied ${plan.create.length} shift${plan.create.length === 1 ? "" : "s"}${plan.skipped.length ? ` · ${plan.skipped.length} skipped` : ""}.`,
      );
      ctx.render();
    } catch (error) {
      busy = false;
      confirm.disabled = false;
      confirm.textContent = `Copy ${plan.create.length} shifts`;
      $("pgCopyResult").innerHTML = `<div class="error">${esc(friendlyError(error))}</div>`;
    }
  };
}

// ------------------------------------------------------------ team drawer --
export function openMember(id, { stars = false } = {}) {
  const m = findMember(id);
  if (!m) {
    ctx.toast("That team member could not be found.");
    return;
  }
  const dlg = openSheet({
    title: esc(m.name || "Team member"),
    body: memberDrawer(ctx, m),
    variant: "drawer",
  });
  bindMemberForms(dlg, m.id);
  if (stars) {
    const note = dlg.querySelector('#pgStarsForm input[name="note"]');
    note?.scrollIntoView?.({ block: "center" });
    if (finePointer()) note?.focus({ preventScroll: true });
  }
}
function refreshDrawer(id, message) {
  const body = sheetBody();
  const m = findMember(id);
  if (!body || !m) return;
  body.innerHTML = memberDrawer(ctx, m);
  bindMemberForms($("pgSheet"), id);
  if (message) {
    const status = body.querySelector("#pgMemberStatus");
    if (status) status.textContent = message;
  }
}
function bindMemberForms(dlg, id) {
  const form = dlg.querySelector("#pgMemberForm");
  if (form) {
    const save = form.querySelector("#pgMemberSave");
    const status = form.querySelector("#pgMemberStatus");
    const snapshot = () =>
      JSON.stringify([form.elements.hourlyRate.value, form.elements.badge.value.trim(), form.elements.notes.value.trim()]);
    const initial = snapshot();
    let busy = false;
    form.oninput = () => {
      const dirty = snapshot() !== initial;
      save.disabled = busy || !dirty;
      status.className = "pg-form-status";
      status.textContent = dirty ? "Unsaved changes" : "";
    };
    form.onsubmit = async (event) => {
      event.preventDefault();
      if (busy || snapshot() === initial) return;
      const raw = form.elements.hourlyRate.value.trim();
      const rate = raw === "" ? null : Math.round(Number(raw) * 100) / 100;
      if (rate !== null && (!Number.isFinite(rate) || rate <= 0 || rate > 100)) {
        status.className = "pg-form-status is-error";
        status.textContent = "Enter an hourly rate between £0.01 and £100, or leave it blank.";
        form.elements.hourlyRate.focus();
        return;
      }
      busy = true;
      save.disabled = true;
      status.className = "pg-form-status";
      status.textContent = "Saving…";
      const member = findMember(id);
      try {
        await writes.updateMember(member, {
          hourlyRate: rate,
          badge: form.elements.badge.value.trim().slice(0, 60),
          notes: form.elements.notes.value.trim().slice(0, 1000),
        });
        ctx.toast(`Saved ${firstName(member.name)}’s details.`);
        refreshDrawer(id, "Saved");
        ctx.render();
      } catch (error) {
        busy = false;
        save.disabled = false;
        status.className = "pg-form-status is-error";
        status.textContent = friendlyError(error);
      }
    };
  }
  const starsForm = dlg.querySelector("#pgStarsForm");
  if (starsForm) {
    const status = starsForm.querySelector("#pgStarsStatus");
    const button = starsForm.querySelector("#pgStarsSave");
    let busy = false;
    starsForm.onsubmit = async (event) => {
      event.preventDefault();
      if (busy) return;
      const amount = Number(new FormData(starsForm).get("amount")) || 1;
      const note = starsForm.elements.note.value.trim();
      if (note.length < 3) {
        status.className = "pg-form-status is-error";
        status.textContent = "Add a short note so they know what they did well.";
        starsForm.elements.note.focus();
        return;
      }
      busy = true;
      button.disabled = true;
      status.className = "pg-form-status";
      status.textContent = "Sending…";
      const member = findMember(id);
      try {
        await writes.giveStars(member, amount, note.slice(0, 200));
        ctx.toast(`+${amount} McStar${amount === 1 ? "" : "s"} for ${firstName(member.name)}.`);
        refreshDrawer(id);
        const fresh = $("pgStarsStatus");
        if (fresh) fresh.textContent = `Sent +${amount} ★`;
        ctx.render();
        if (!ctx.preview) ctx.refreshExtras?.(true);
      } catch (error) {
        busy = false;
        button.disabled = false;
        status.className = "pg-form-status is-error";
        status.textContent = friendlyError(error);
      }
    };
  }
}

// ---------------------------------------------------------- role requests --
function bindRoleDecision(button) {
  button.onclick = async () => {
    const approve = button.hasAttribute("data-role-approve");
    const target = button.getAttribute(approve ? "data-role-approve" : "data-role-reject");
    const request = (ctx.state.extras.roleRequests || []).find((r) => (r.uid || r.id) === target);
    const row = button.closest("li") || button.parentElement;
    const buttons = [...row.querySelectorAll("button")];
    if (buttons.some((b) => b.disabled)) return;
    buttons.forEach((b) => (b.disabled = true));
    button.classList.add("is-busy");
    try {
      await writes.decideRole(target, approve);
      ctx.toast(
        approve
          ? `${firstName(request?.name)} is now a ${roleLabel(request?.requestedRole)}.`
          : `${firstName(request?.name)}’s request was declined.`,
      );
      ctx.render();
      if (!ctx.preview) ctx.refreshExtras?.(true);
    } catch (error) {
      buttons.forEach((b) => (b.disabled = false));
      button.classList.remove("is-busy");
      ctx.toast(friendlyError(error));
    }
  };
}

// ------------------------------------------------------------ team filter --
function bindTeamFilters(root) {
  const search = $("teamSearch"),
    role = $("teamRole");
  if (!search || !role) return;
  const items = [...root.querySelectorAll("#teamGrid > li")];
  const apply = () => {
    const q = search.value.trim().toLowerCase();
    ctx.state.ui.teamQuery = search.value;
    ctx.state.ui.teamRole = role.value;
    let shown = 0;
    for (const li of items) {
      const show = (!q || li.dataset.search.includes(q)) && (!role.value || li.dataset.role === role.value);
      li.hidden = !show;
      if (show) shown++;
    }
    $("teamCount").textContent = `${shown} of ${items.length}`;
    const empty = $("teamEmpty");
    if (empty) empty.hidden = shown > 0;
  };
  search.oninput = apply;
  role.onchange = apply;
  root.querySelectorAll("[data-team-reset]").forEach(
    (b) =>
      (b.onclick = () => {
        search.value = "";
        role.value = "";
        apply();
        search.focus();
      }),
  );
}

// ----------------------------------------------------------- availability --
const canonical = (av) =>
  DAY_KEYS.map((k) => (av?.[k]?.available ? `${av[k].start}-${av[k].end}` : "off")).join("|");
export function isPageBusy(page, state) {
  return page === "availability" && Boolean(state.ui?.availabilityDirty);
}
function bindAvailability() {
  const form = $("availabilityForm");
  if (!form) return;
  const s = ctx.state;
  let baseline = canonical(normaliseAvailability(s.user.availability));
  const bar = $("availSavebar");
  const read = () => {
    const out = {};
    for (const k of DAY_KEYS)
      out[k] = {
        available: form.elements[k].checked,
        start: form.elements[k + "Start"].value,
        end: form.elements[k + "End"].value,
      };
    return out;
  };
  const refresh = () => {
    const av = read();
    let days = 0,
      minutes = 0;
    for (const k of DAY_KEYS) {
      const row = form.querySelector(`[data-day="${k}"]`);
      const on = av[k].available;
      row.classList.toggle("is-off", !on);
      form.elements[k + "Start"].disabled = !on;
      form.elements[k + "End"].disabled = !on;
      const note = row.querySelector("[data-note]");
      let text = "",
        bad = false;
      if (on) {
        if (!validTime(av[k].start) || !validTime(av[k].end)) {
          text = "Choose both times";
          bad = true;
        } else if (av[k].start === av[k].end) {
          text = "Start and finish must differ";
          bad = true;
        } else {
          const g = grossMinutes(av[k].start, av[k].end);
          text = `${toMinutes(av[k].end) < toMinutes(av[k].start) ? "Overnight · " : ""}${durationLabel(g)}`;
          days++;
          minutes += g;
        }
      }
      note.textContent = text;
      note.classList.toggle("is-error", bad);
    }
    $("availSummary").innerHTML = days
      ? `${ic("calendar")}<span>Available <b>${days} day${days === 1 ? "" : "s"}</b> · up to <b>${durationLabel(minutes)}</b> a week</span>`
      : `${ic("alert")}<span>No availability selected. Your manager will see you as unavailable every day.</span>`;
    const dirty = canonical(av) !== baseline;
    s.ui.availabilityDirty = dirty;
    // Keep the McAssist launcher from covering the save bar while editing.
    if (dirty) document.body.dataset.hideAssistantLauncher = "true";
    else delete document.body.dataset.hideAssistantLauncher;
    bar.classList.toggle("is-dirty", dirty);
    if (dirty) bar.classList.remove("is-saved");
  };
  form.addEventListener("input", refresh);
  form.addEventListener("change", refresh);
  form.querySelectorAll("[data-preset]").forEach(
    (b) =>
      (b.onclick = () => {
        const preset = AVAILABILITY_PRESETS[b.dataset.preset];
        for (const k of DAY_KEYS) {
          const on = Boolean(preset?.days.includes(k));
          form.elements[k].checked = on;
          if (on) {
            form.elements[k + "Start"].value = preset.start;
            form.elements[k + "End"].value = preset.end;
          }
        }
        $("availabilityResult").innerHTML = "";
        refresh();
        ctx.toast(preset ? `${preset.label} applied. Save to share it.` : "Cleared. Save to share it.");
      }),
  );
  form.querySelector("[data-avail-discard]").onclick = () => {
    s.ui.availabilityDirty = false;
    delete document.body.dataset.hideAssistantLauncher;
    ctx.render();
  };
  let busy = false;
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (busy) return;
    const av = read();
    const bad = DAY_KEYS.find(
      (k) => av[k].available && (!validTime(av[k].start) || !validTime(av[k].end) || av[k].start === av[k].end),
    );
    if (bad) {
      $("availabilityResult").innerHTML = `<div class="error">Check ${esc(bad.toUpperCase())}: the start and finish times must be different.</div>`;
      form.elements[bad + "Start"].focus();
      return;
    }
    const clean = Object.fromEntries(
      DAY_KEYS.map((k) => [
        k,
        av[k].available
          ? { available: true, start: av[k].start, end: av[k].end }
          : { available: false, start: "", end: "" },
      ]),
    );
    busy = true;
    const button = $("availSave");
    button.disabled = true;
    button.textContent = "Saving…";
    try {
      await writes.saveAvailability(clean);
      baseline = canonical(clean);
      s.ui.availabilityDirty = false;
      delete document.body.dataset.hideAssistantLauncher;
      bar.classList.remove("is-dirty");
      bar.classList.add("is-saved");
      $("availabilityResult").innerHTML = "";
      ctx.toast(ctx.preview ? "Availability updated in this preview." : "Availability saved and shared with your manager.");
      setTimeout(() => bar.classList.remove("is-saved"), 3200);
    } catch (error) {
      $("availabilityResult").innerHTML = `<div class="error">${esc(friendlyError(error))}</div>`;
    } finally {
      busy = false;
      button.disabled = false;
      button.textContent = "Save availability";
    }
  };
  if (!unloadGuard) {
    unloadGuard = (event) => {
      if (!ctx?.state?.ui?.availabilityDirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", unloadGuard);
  }
  refresh();
}

// ---------------------------------------------------------- notifications --
function seenKey() {
  return `mc_seen_v1_${ctx.preview || "live"}_${ctx.state.user?.id || "anon"}`;
}
function loadSeen() {
  try {
    return new Set(JSON.parse(localStorage.getItem(seenKey()) || "[]"));
  } catch {
    return new Set(ctx.state.ui.seen || []);
  }
}
function saveSeen(keys) {
  const list = [...keys].slice(-300);
  ctx.state.ui.seen = list;
  try {
    localStorage.setItem(seenKey(), JSON.stringify(list));
  } catch {}
}
const verificationHref = (id) =>
  `/verification.html?id=${encodeURIComponent(id)}${ctx.preview ? "&preview=" + ctx.preview : ""}`;

export function notificationItems(c) {
  const s = c.state,
    u = s.user;
  if (!u) return [];
  const now = new Date();
  const role = normaliseRole(u.role);
  const items = [];
  const verifications = s.extras?.verifications || [];
  if (c.isManager()) {
    for (const r of s.extras?.roleRequests || [])
      items.push({
        key: `role:${r.uid || r.id}:${r.requestedRole}`,
        group: "attention",
        icon: "team",
        title: `${r.name || "A team member"} requested ${roleLabel(r.requestedRole)} access`,
        detail: "Approve or decline it on the team page.",
        href: c.url("team"),
        at: r.createdAt,
      });
    for (const v of verifications.filter((x) => x.status !== "verified"))
      items.push({
        key: `verify:${v.id}:${v.trainerSignature ? 1 : 0}${v.crewSignature ? 1 : 0}`,
        group: "attention",
        icon: "shield",
        title: `${v.crewName} · ${v.station} sign-off`,
        detail: v.trainerSignature
          ? `Waiting for ${firstName(v.crewName)} to sign.`
          : `Waiting for ${v.trainerName || "the Crew Trainer"} to sign.`,
        href: verificationHref(v.id),
        at: v.createdAt,
      });
  } else {
    for (const v of verifications.filter(
      (x) =>
        x.status !== "verified" &&
        ((x.crewId === u.id && !x.crewSignature) ||
          (role === "crewTrainer" && x.trainerId === u.id && !x.trainerSignature)),
    ))
      items.push({
        key: `verify:${v.id}:${v.trainerSignature ? 1 : 0}${v.crewSignature ? 1 : 0}`,
        group: "attention",
        icon: "shield",
        title: `Sign your ${v.station} verification`,
        detail:
          v.crewId === u.id
            ? `${v.trainerName || "Your Crew Trainer"} is waiting for your signature.`
            : `${v.crewName} needs your trainer signature.`,
        href: verificationHref(v.id),
        at: v.createdAt,
      });
  }
  for (const x of c
    .myShifts()
    .filter((x) => shiftEnd(x) > now && shiftStart(x) - now < 8 * 864e5)
    .slice(0, 4))
    items.push({
      key: `shift:${x.id}:${x.date}${x.start}${x.end}${x.station || ""}`,
      group: "shifts",
      icon: "calendar",
      title: `${dateMed(x.date)} · ${x.start}–${x.end}`,
      detail: `${x.station || "Station TBC"} · ${whenLabel(x, now).text}`,
      href: c.url("schedule"),
    });
  for (const r of (s.extras?.recognition || [])
    .filter((r) => r.userId === u.id && Number(r.createdAt) > Date.now() - 30 * 864e5)
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
    .slice(0, 3))
    items.push({
      key: `star:${r.id}`,
      group: "stars",
      icon: "star",
      title: `+${Number(r.amount) || 0} McStars${r.createdByName ? ` from ${r.createdByName}` : ""}`,
      detail: r.note || "Recognised for great work.",
      href: c.url("rewards"),
      at: r.createdAt,
    });
  return items;
}

let bellInstalled = false;
export function updateBell(c) {
  ctx = c;
  const button = $("notifications");
  if (!button || !c.state.user) return;
  if (!bellInstalled) {
    bellInstalled = true;
    // The only handler for the bell. Delegated, because the shell (and so the
    // button) is rebuilt when the role or name changes.
    document.addEventListener("click", (event) => {
      if (!event.target.closest?.("#notifications")) return;
      event.preventDefault();
      openNotifications();
    });
  }
  const items = notificationItems(c);
  const seen = loadSeen();
  const unread = items.filter((i) => !seen.has(i.key)).length;
  const label = unread ? `Notifications, ${unread} new` : "Notifications";
  if (button.getAttribute("aria-label") !== label) button.setAttribute("aria-label", label);
  button.setAttribute("aria-haspopup", "dialog");
  let dot = button.querySelector(".pg-bell-dot");
  if (unread && !dot) {
    dot = document.createElement("span");
    dot.className = "pg-bell-dot";
    dot.setAttribute("aria-hidden", "true");
    button.appendChild(dot);
  } else if (!unread && dot) dot.remove();
  const text = unread > 9 ? "9+" : String(unread);
  if (dot && dot.textContent !== text) dot.textContent = text;
}

export function openNotifications() {
  const c = ctx;
  if (!c?.state?.user) return;
  const items = notificationItems(c);
  const seen = loadSeen();
  const groups = [
    ["attention", c.isManager() ? "Waiting on you" : "Needs you"],
    ["shifts", "Coming up"],
    ["stars", "Recognition"],
  ];
  const body = items.length
    ? groups
        .map(([key, title]) => {
          const list = items.filter((i) => i.group === key);
          if (!list.length) return "";
          return `<section class="pg-notes-group"><h3>${title}</h3><ul>${list
            .map(
              (i) =>
                `<li><a class="pg-note ${seen.has(i.key) ? "" : "is-new"}" href="${esc(i.href)}"><span class="pg-note-icon">${ic(i.icon)}</span><span class="grow"><b>${esc(i.title)}</b><small>${esc(i.detail)}${i.at ? ` · ${esc(timeAgo(i.at))}` : ""}</small></span>${seen.has(i.key) ? "" : '<i class="pg-new">New</i>'}</a></li>`,
            )
            .join("")}</ul></section>`;
        })
        .join("")
    : `<div class="pg-allclear">${ic("check")}<div><b>You’re all caught up</b><p class="pg-muted">New shifts, sign-offs and recognition will appear here.</p></div></div>`;
  openSheet({
    title: "Notifications",
    label: items.length ? `${items.filter((i) => !seen.has(i.key)).length} new` : "",
    body: `<div class="pg-notes">${body}</div>`,
    variant: "panel",
  });
  saveSeen(new Set([...seen, ...items.map((i) => i.key)]));
  updateBell(c);
}
