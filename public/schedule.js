// schedule.js – shifts with Shift Creator role

import { auth, db } from "./firebase-init.js";
import {
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  collection,
  getDocs,
  doc,
  getDoc,
  addDoc,
  query,
  where,
  deleteDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

/* ========= DOM ========= */

const sidebarUserName = document.getElementById("sidebarUserName");
const sidebarUserRole = document.getElementById("sidebarUserRole");
const avatarCircle = document.getElementById("avatarCircle");
const roleBadge = document.getElementById("roleBadge");
const logoutBtn = document.getElementById("logoutBtn");

const scheduleTitle = document.getElementById("scheduleTitle");
const scheduleSubtitle = document.getElementById("scheduleSubtitle");
const scheduleCard = document.getElementById("scheduleCard");
const weekTabs = document.getElementById("weekTabs");
const shiftManageCard = document.getElementById("shiftManageCard");

const sidebar = document.querySelector(".sidebar");
const sidebarToggle = document.getElementById("sidebarToggle");

/* ========= SESSION ========= */

let sessionUser = null;
let currentStoreId = "store001";

function loadSessionUser() {
  try {
    return JSON.parse(localStorage.getItem("mc_session_user"));
  } catch {
    return null;
  }
}

/* ========= DATA ========= */

let allShifts = [];
let storeCrew = [];
let currentWeekOffset = 0;

/* ========= DATE HELPERS ========= */

function toISODateString(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getMonday(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getWeekRange(offsetWeeks = 0, baseDate = new Date()) {
  const monday = getMonday(baseDate);
  const start = new Date(monday);
  start.setDate(start.getDate() + offsetWeeks * 7);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { start, end };
}

function formatDayLabel(d) {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return `${days[d.getDay()]} ${d.getDate()}`;
}

function formatWeekLabel(start, end) {
  const months = [
    "Jan","Feb","Mar","Apr","May","Jun",
    "Jul","Aug","Sep","Oct","Nov","Dec"
  ];
  const s = `${start.getDate()} ${months[start.getMonth()]}`;
  const e = `${end.getDate()} ${months[end.getMonth()]}`;
  return `${s} – ${e}`;
}

/* ========= FIRESTORE LOAD ========= */

async function loadStoreName(storeId) {
  try {
    const ref = doc(db, "stores", storeId);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const d = snap.data();
      return d.storeName || d.name || "Your restaurant";
    }
  } catch (err) {
    console.error("[Schedule] loadStoreName error:", err);
  }
  return "Your restaurant";
}

async function loadShiftsFromFirestore(storeId) {
  allShifts = [];
  try {
    const col = collection(db, "stores", storeId, "Shifts"); // capital S
    const snap = await getDocs(col);
    snap.forEach((docSnap) => {
      const d = docSnap.data();
      if (!d.date || !d.start || !d.end || !d.userId) return;
      allShifts.push({
        id: docSnap.id,
        date: d.date,
        start: d.start,
        end: d.end,
        userId: d.userId,
        userName: d.userName || "Unknown",
        role: d.role || "crew",
        station: d.station || "",
        isShiftManager: !!d.isShiftManager
      });
    });
  } catch (err) {
    console.error("[Schedule] Error loading shifts:", err);
  }
}

async function loadCrewForStore(storeId) {
  storeCrew = [];
  try {
    const qCrew = query(
      collection(db, "users"),
      where("storeId", "==", storeId)
    );
    const snap = await getDocs(qCrew);
    snap.forEach((docSnap) => {
      const d = docSnap.data();
      storeCrew.push({
        id: docSnap.id,
        name: d.name || d.email || "Crew member",
        role: d.role || "crew"
      });
    });
  } catch (err) {
    console.error("[Schedule] Error loading crew list:", err);
  }
}

/* ========= AUTH ========= */

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

  currentStoreId = sessionUser.storeId || "store001";

  const role = sessionUser.role;
  const isManagerLike = role === "manager" || role === "shiftCreator";
  const canManageShifts = role === "shiftCreator";

  // Sidebar labels
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

  // Titles
  if (scheduleTitle) {
    scheduleTitle.textContent = isManagerLike ? "Store shifts" : "Your shifts";
  }
  if (scheduleSubtitle) {
    const storeName = await loadStoreName(currentStoreId);
    scheduleSubtitle.textContent = isManagerLike
      ? `See your shifts and, when you're shift manager, view who is working at ${storeName}.`
      : "See your shifts for this week and upcoming weeks.";
  }

  await loadShiftsFromFirestore(currentStoreId);
  if (canManageShifts) {
    await loadCrewForStore(currentStoreId);
  }

  renderSchedule(isManagerLike, canManageShifts);
  setupWeekTabs(isManagerLike, canManageShifts);
  renderShiftManageTools(canManageShifts, currentStoreId);
});

/* Logout */

if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    await signOut(auth);
    localStorage.removeItem("mc_session_user");
    window.location.href = "index.html";
  });
}

/* ========= RENDER SCHEDULE ========= */

function renderSchedule(isManagerLike, canManageShifts) {
  if (!scheduleCard || !sessionUser) return;

  const { start, end } = getWeekRange(currentWeekOffset, new Date());
  const weekStartStr = toISODateString(start);
  const weekEndStr = toISODateString(end);

  const shiftsInWeek = allShifts.filter(
    (s) => s.date >= weekStartStr && s.date <= weekEndStr
  );

  const myShiftsInWeek = shiftsInWeek.filter(
    (s) => s.userId === sessionUser.id
  );

  let scheduleMsg = "";
  if (shiftsInWeek.length === 0) {
    scheduleMsg = "Schedule not posted yet for this week.";
  } else if (!isManagerLike && myShiftsInWeek.length === 0) {
    scheduleMsg = "You have no shifts this week.";
  }

  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    days.push(d);
  }

  let html = `
    <div class="subsection-title">
      ${currentWeekOffset === 0 ? "This week" : "Next week"}
    </div>
    <div class="subsection-sub">
      ${formatWeekLabel(start, end)}
    </div>
  `;

  if (scheduleMsg) {
    html += `
      <p style="margin-top:6px;font-size:0.8rem;color:#b91c1c;">
        ${scheduleMsg}
      </p>
    `;
  }

  html += `<div style="margin-top:8px; display:flex; flex-wrap:wrap; gap:10px;">`;

  days.forEach((d) => {
    const dayISO = toISODateString(d);
    const label = formatDayLabel(d);

    const dayShifts = shiftsInWeek.filter((s) => s.date === dayISO);
    const myShifts = dayShifts.filter((s) => s.userId === sessionUser.id);

    let isShiftManagerToday = false;
    if (isManagerLike) {
      isShiftManagerToday = dayShifts.some(
        (s) => s.userId === sessionUser.id && s.isShiftManager
      );
    }

    let dayContent = "";

    if (!dayShifts.length) {
      dayContent = `<li><span>No shifts posted.</span></li>`;
    } else if (!isManagerLike) {
      // Crew: only own shifts
      if (!myShifts.length) {
        dayContent = `<li><span>No shift for you.</span></li>`;
      } else {
        dayContent = myShifts
          .map(
            (s) => `
            <li style="display:flex;align-items:center;justify-content:space-between;gap:6px;">
              <span>${s.start}–${s.end}</span>
              <span class="badge-soft">${s.station || "Shift"}</span>
            </li>
          `
          )
          .join("");
      }
    } else {
      // Manager-like: show own shift, and if shift manager, show crew
      const myMain = myShifts
        .map(
          (s) => `
          <li style="display:flex;align-items:center;justify-content:space-between;gap:6px;" data-shift-id="${s.id}">
            <div>
              <span>${s.start}–${s.end}</span>
              <span class="badge-soft-warn" style="margin-left:6px;">
                ${s.isShiftManager ? "Shift manager" : "Manager"}
              </span>
            </div>
            ${
              canManageShifts
                ? `<button class="shift-delete-btn" data-id="${s.id}" title="Delete shift"
                    style="border:none;background:transparent;font-size:0.8rem;cursor:pointer;color:#9ca3af;">
                    ✕
                   </button>`
                : ""
            }
          </li>
        `
        )
        .join("");

      let othersBlock = "";

      if (isShiftManagerToday) {
        const others = dayShifts.filter((s) => s.userId !== sessionUser.id);

        if (others.length) {
          const crewMap = {};
          others.forEach((s) => {
            if (!crewMap[s.userId]) {
              crewMap[s.userId] = s;
            }
          });

          const crewLines = Object.values(crewMap)
            .map(
              (s) => `
              <li style="display:flex;align-items:center;justify-content:space-between;gap:6px;" data-shift-id="${s.id}">
                <div style="display:flex;flex-direction:column;">
                  <span style="font-weight:600;">${s.userName}</span>
                  <span style="font-size:0.75rem;color:#4b5563;">
                    ${s.start}–${s.end}${s.station ? " · " + s.station : ""}
                  </span>
                </div>
                ${
                  canManageShifts
                    ? `<button class="shift-delete-btn" data-id="${s.id}" title="Delete shift"
                        style="border:none;background:transparent;font-size:0.8rem;cursor:pointer;color:#9ca3af;">
                        ✕
                       </button>`
                    : ""
                }
              </li>
            `
            )
            .join("");

          othersBlock = `
            <li style="margin-top:4px;border-top:1px dashed #e5e7eb;padding-top:4px;">
              <span style="font-size:0.75rem;color:#6b7280;">Crew on this shift:</span>
            </li>
            ${crewLines}
          `;
        }
      }

      if (!myMain && !othersBlock) {
        dayContent = `<li><span>No shift for you.</span></li>`;
      } else {
        dayContent = myMain + othersBlock;
      }
    }

    html += `
      <div class="card" style="flex:1 1 180px; min-width:180px;">
        <div class="card-header">
          <div class="card-title">${label}</div>
          <div class="card-icon">📅</div>
        </div>
        <ul class="list">
          ${dayContent}
        </ul>
      </div>
    `;
  });

  html += `</div>`;
  scheduleCard.innerHTML = html;

  attachDeleteHandlers(canManageShifts);
}

/* ========= DELETE ========= */

function attachDeleteHandlers(canManageShifts) {
  if (!canManageShifts) return;
  if (!currentStoreId) return;

  const buttons = scheduleCard.querySelectorAll(".shift-delete-btn");
  buttons.forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      if (!id) return;
      if (!confirm("Delete this shift?")) return;

      try {
        await deleteDoc(doc(db, "stores", currentStoreId, "Shifts", id));
        await loadShiftsFromFirestore(currentStoreId);
        renderSchedule(true, true);
        renderShiftManageTools(true, currentStoreId);
      } catch (err) {
        console.error("[Schedule] delete shift error:", err);
        alert("Failed to delete shift.");
      }
    });
  });
}

/* ========= MANAGER TOOLS (only Shift Creator) ========= */

function renderShiftManageTools(canManageShifts, storeId) {
  if (!shiftManageCard) return;

  if (!canManageShifts) {
    shiftManageCard.style.display = "none";
    shiftManageCard.innerHTML = "";
    return;
  }

  shiftManageCard.style.display = "block";

  shiftManageCard.innerHTML = `
    <div class="subsection-title">Manage shifts</div>
    <div class="subsection-sub">
      Create a one-off shift or auto-generate a full week for selected crew.
    </div>

    <div style="display:flex; flex-wrap:wrap; gap:12px; margin-top:8px;">
      <!-- Manual creation -->
      <div style="flex:1 1 260px; min-width:260px;">
        <h4 style="font-size:0.8rem; font-weight:700; margin-bottom:4px;">Create shift</h4>
        <div style="display:flex; flex-direction:column; gap:6px; font-size:0.8rem;">
          <label>
            Date
            <input type="date" id="shiftDateInput" style="width:100%; padding:6px 8px; border-radius:10px; border:1px solid #e5e7eb;" />
          </label>
          <label>
            Crew / manager
            <select id="shiftUserSelect" style="width:100%; padding:6px 8px; border-radius:10px; border:1px solid #e5e7eb;"></select>
          </label>
          <div style="display:flex; gap:6px;">
            <label style="flex:1;">
              Start
              <input type="time" id="shiftStartInput" style="width:100%; padding:6px 8px; border-radius:10px; border:1px solid #e5e7eb;" />
            </label>
            <label style="flex:1;">
              End
              <input type="time" id="shiftEndInput" style="width:100%; padding:6px 8px; border-radius:10px; border:1px solid #e5e7eb;" />
            </label>
          </div>
          <label>
            Station (optional)
            <input type="text" id="shiftStationInput" placeholder="Front counter, Drive-thru…" style="width:100%; padding:6px 8px; border-radius:10px; border:1px solid #e5e7eb;" />
          </label>
          <label style="display:flex; align-items:center; gap:6px; margin-top:2px;">
            <input type="checkbox" id="shiftIsManagerCheckbox" />
            <span>Shift manager for this day</span>
          </label>
          <button id="createShiftBtn" class="btn" type="button" style="margin-top:4px; width:100%; justify-content:center;">
            ➕ Create shift
          </button>
          <div id="shiftManageMessage" style="font-size:0.75rem; margin-top:4px;"></div>
        </div>
      </div>

      <!-- Auto-generate -->
      <div style="flex:1 1 260px; min-width:260px;">
        <h4 style="font-size:0.8rem; font-weight:700; margin-bottom:4px;">Auto-generate week</h4>
        <div style="display:flex; flex-direction:column; gap:6px; font-size:0.8rem;">
          <label>
            Week
            <select id="autoWeekSelect" style="width:100%; padding:6px 8px; border-radius:10px; border:1px solid #e5e7eb;">
              <option value="0">This week</option>
              <option value="1">Next week</option>
            </select>
          </label>
          <div style="display:flex; gap:6px;">
            <label style="flex:1;">
              Start
              <input type="time" id="autoStartInput" value="16:00" style="width:100%; padding:6px 8px; border-radius:10px; border:1px solid #e5e7eb;" />
            </label>
            <label style="flex:1;">
              End
              <input type="time" id="autoEndInput" value="23:00" style="width:100%; padding:6px 8px; border-radius:10px; border:1px solid #e5e7eb;" />
            </label>
          </div>
          <label>
            Station label
            <input type="text" id="autoStationInput" value="Front counter" style="width:100%; padding:6px 8px; border-radius:10px; border:1px solid #e5e7eb;" />
          </label>
          <div>
            <div style="font-size:0.75rem; color:#6b7280; margin-bottom:2px;">Crew for this pattern</div>
            <div id="autoCrewList" style="max-height:120px; overflow:auto; border-radius:10px; border:1px solid #e5e7eb; padding:4px 6px; background:#f9fafb;"></div>
          </div>
          <button id="autoGenerateBtn" class="btn" type="button" style="margin-top:4px; width:100%; justify-content:center;">
            ⚙️ Generate Mon–Sun shifts
          </button>
          <div id="autoManageMessage" style="font-size:0.75rem; margin-top:4px;"></div>
        </div>
      </div>
    </div>
  `;

  // populate crew
  const userSelect = document.getElementById("shiftUserSelect");
  const autoCrewList = document.getElementById("autoCrewList");

  if (userSelect) {
    userSelect.innerHTML = "";
    storeCrew.forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = `${c.name} (${c.role})`;
      userSelect.appendChild(opt);
    });
  }

  if (autoCrewList) {
    autoCrewList.innerHTML = "";
    storeCrew
      .filter((c) => c.role === "crew")
      .forEach((c) => {
        const wrapper = document.createElement("label");
        wrapper.style.display = "flex";
        wrapper.style.alignItems = "center";
        wrapper.style.gap = "6px";
        wrapper.style.fontSize = "0.75rem";
        wrapper.style.marginBottom = "2px";
        wrapper.innerHTML = `
          <input type="checkbox" data-user-id="${c.id}" />
          <span>${c.name}</span>
        `;
        autoCrewList.appendChild(wrapper);
      });
  }

  // form controls
  const createShiftBtn = document.getElementById("createShiftBtn");
  const shiftDateInput = document.getElementById("shiftDateInput");
  const shiftStartInput = document.getElementById("shiftStartInput");
  const shiftEndInput = document.getElementById("shiftEndInput");
  const shiftStationInput = document.getElementById("shiftStationInput");
  const shiftIsManagerCheckbox = document.getElementById("shiftIsManagerCheckbox");
  const shiftManageMessage = document.getElementById("shiftManageMessage");

  const autoWeekSelect = document.getElementById("autoWeekSelect");
  const autoStartInput = document.getElementById("autoStartInput");
  const autoEndInput = document.getElementById("autoEndInput");
  const autoStationInput = document.getElementById("autoStationInput");
  const autoGenerateBtn = document.getElementById("autoGenerateBtn");
  const autoManageMessage = document.getElementById("autoManageMessage");

  if (createShiftBtn) {
    createShiftBtn.addEventListener("click", async () => {
      const date = shiftDateInput.value;
      const start = shiftStartInput.value;
      const end = shiftEndInput.value;
      const userId = userSelect.value;
      const station = (shiftStationInput.value || "").trim();
      const isShiftManager = shiftIsManagerCheckbox.checked;

      const crewObj = storeCrew.find((c) => c.id === userId);

      if (!date || !start || !end || !crewObj) {
        shiftManageMessage.style.color = "#b91c1c";
        shiftManageMessage.textContent = "Fill date, times and crew.";
        return;
      }

      // prevent double-booking that day
      const clash = allShifts.some(
        (s) => s.userId === userId && s.date === date
      );
      if (clash) {
        shiftManageMessage.style.color = "#b91c1c";
        shiftManageMessage.textContent = "This person already has a shift that day.";
        return;
      }

      try {
        await addDoc(collection(db, "stores", storeId, "Shifts"), {
          date,
          start,
          end,
          userId,
          userName: crewObj.name,
          role: crewObj.role,
          station,
          isShiftManager
        });

        shiftManageMessage.style.color = "#15803d";
        shiftManageMessage.textContent = "Shift created.";

        await loadShiftsFromFirestore(storeId);
        renderSchedule(true, true);
      } catch (err) {
        console.error("[Schedule] create shift error:", err);
        shiftManageMessage.style.color = "#b91c1c";
        shiftManageMessage.textContent = "Failed to create shift.";
      }
    });
  }

  if (autoGenerateBtn) {
    autoGenerateBtn.addEventListener("click", async () => {
      const weekOffset = parseInt(autoWeekSelect.value, 10) || 0;
      const startTime = autoStartInput.value;
      const endTime = autoEndInput.value;
      const station = (autoStationInput.value || "Shift").trim();

      const { start, end } = getWeekRange(weekOffset, new Date());

      const selectedCrewIds = [];
      autoCrewList.querySelectorAll("input[type='checkbox']").forEach((cb) => {
        if (cb.checked && cb.dataset.userId) {
          selectedCrewIds.push(cb.dataset.userId);
        }
      });

      if (!startTime || !endTime || selectedCrewIds.length === 0) {
        autoManageMessage.style.color = "#b91c1c";
        autoManageMessage.textContent =
          "Pick at least one crew and set times.";
        return;
      }

      try {
        const days = [];
        for (let i = 0; i < 7; i++) {
          const d = new Date(start);
          d.setDate(start.getDate() + i);
          days.push(d);
        }

        let created = 0;
        let skipped = 0;

        for (const crewId of selectedCrewIds) {
          const crewObj = storeCrew.find((c) => c.id === crewId);
          if (!crewObj) continue;

          for (const d of days) {
            const date = toISODateString(d);
            const clash = allShifts.some(
              (s) => s.userId === crewObj.id && s.date === date
            );
            if (clash) {
              skipped++;
              continue;
            }

            await addDoc(collection(db, "stores", storeId, "Shifts"), {
              date,
              start: startTime,
              end: endTime,
              userId: crewObj.id,
              userName: crewObj.name,
              role: crewObj.role,
              station,
              isShiftManager: false
            });
            created++;
          }
        }

        autoManageMessage.style.color = "#15803d";
        autoManageMessage.textContent =
          `Generated ${created} shifts, skipped ${skipped} existing.`;

        await loadShiftsFromFirestore(storeId);
        renderSchedule(true, true);
      } catch (err) {
        console.error("[Schedule] auto-generate error:", err);
        autoManageMessage.style.color = "#b91c1c";
        autoManageMessage.textContent = "Failed to generate shifts.";
      }
    });
  }
}

/* ========= WEEK TABS ========= */

function setupWeekTabs(isManagerLike, canManageShifts) {
  if (!weekTabs) return;

  weekTabs.addEventListener("click", (e) => {
    const btn = e.target.closest(".pill-filter");
    if (!btn) return;

    const offset = parseInt(btn.dataset.weekOffset, 10);
    if (isNaN(offset)) return;

    currentWeekOffset = offset;

    weekTabs.querySelectorAll(".pill-filter").forEach((b) => {
      b.classList.toggle("active", b === btn);
    });

    renderSchedule(isManagerLike, canManageShifts);
  });
}

/* ========= SIDEBAR MOBILE ========= */

if (sidebar && sidebarToggle) {
  sidebarToggle.addEventListener("click", () => {
    sidebar.classList.toggle("sidebar-open");
  });
}
