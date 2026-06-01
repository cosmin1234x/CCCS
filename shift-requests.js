import { auth, db } from "./firebase-init.js";
import { collection, addDoc, getDocs, doc, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const $ = (id) => document.getElementById(id);

function sessionUser() {
  try { return JSON.parse(localStorage.getItem("mc_session_user") || "null") || {}; }
  catch { return {}; }
}

function userId() { return sessionUser().id || auth.currentUser?.uid || ""; }
function storeId() { return sessionUser().storeId || "store001"; }
function isManager(u = sessionUser()) { return /manager|shiftcreator|admin/.test(String(u.role || "").toLowerCase().replace(/\s+/g, "")); }
function esc(v) { return String(v || "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;"); }

function addStyles() {
  if ($("shiftRequestStyles")) return;
  const s = document.createElement("style");
  s.id = "shiftRequestStyles";
  s.textContent = `
    #scheduleCard .list li.has-shift-extras{
      display:flex!important;
      flex-direction:column!important;
      align-items:stretch!important;
      justify-content:flex-start!important;
      gap:6px!important;
      overflow:hidden!important;
    }
    #scheduleCard .list li.has-shift-extras > span:first-child{
      display:block!important;
      width:100%!important;
      line-height:1.15!important;
      white-space:normal!important;
      word-break:break-word!important;
    }
    #scheduleCard .list li.has-shift-extras .badge-soft{
      align-self:flex-start!important;
      max-width:100%!important;
      white-space:normal!important;
      text-align:left!important;
      line-height:1.1!important;
    }
    .shift-req-actions{
      width:100%;
      display:grid;
      grid-template-columns:1fr;
      gap:5px;
      margin-top:4px;
    }
    .shift-req-btn{
      width:100%;
      border:0;
      border-radius:999px;
      padding:6px 7px;
      background:#fff7ed;
      border:1px solid #f59e0b;
      color:#991b1b;
      font-size:.68rem;
      font-weight:900;
      line-height:1.05;
      cursor:pointer;
      text-align:center;
      white-space:normal;
    }
    .shift-req-btn.dark{background:#111827;color:white;border-color:#111827}
    .shift-status-pill{
      width:fit-content;
      max-width:100%;
      display:inline-flex;
      border-radius:999px;
      padding:4px 7px;
      font-size:.66rem;
      font-weight:900;
      line-height:1.05;
      margin-top:2px;
      white-space:normal;
    }
    .shift-approved{background:#dcfce7;color:#166534}
    .shift-draft{background:#fef3c7;color:#92400e}
    .req-panel{margin-top:14px;padding:14px;border-radius:20px;background:#fff7ed;border:1px solid #f59e0b}
    .req-panel h3{margin:0 0 8px;color:#991b1b}
    .req-card{background:white;border:1px solid #fed7aa;border-radius:14px;padding:10px;margin-top:8px;font-size:.78rem}
    .req-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
    .req-action{border:0;border-radius:999px;padding:7px 10px;font-weight:900;cursor:pointer;background:#dc0019;color:white}
    .req-action.deny{background:#111827}
    .req-status{font-size:.72rem;font-weight:900;color:#92400e;margin-top:4px}
  `;
  document.head.appendChild(s);
}

async function loadWeekShifts() {
  const snap = await getDocs(collection(db, "stores", storeId(), "Shifts"));
  const shifts = [];
  snap.forEach((d)=>shifts.push({ id:d.id, ...d.data() }));
  return shifts;
}

async function loadRequests() {
  const snap = await getDocs(collection(db, "stores", storeId(), "ShiftRequests"));
  const items = [];
  snap.forEach((d)=>items.push({ id:d.id, ...d.data() }));
  return items.sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
}

function findShiftForLi(li, shifts) {
  const text = li.innerText || "";
  const time = text.match(/(\d{2}:\d{2})\s*[–-]\s*(\d{2}:\d{2})/);
  if (!time) return null;
  const start = time[1];
  const end = time[2];
  const myId = userId();
  const name = sessionUser().name || sessionUser().email || "";
  return shifts.find((s)=>s.start === start && s.end === end && (s.userId === myId || text.includes(s.userName || "") || text.includes(name))) || null;
}

async function createRequest(shift, type) {
  const u = sessionUser();
  const label = type === "cover" ? "cover" : type === "swap" ? "swap" : "can't work";
  const reason = prompt(`Reason for ${label} request?`, "") || "";
  await addDoc(collection(db, "stores", storeId(), "ShiftRequests"), {
    type,
    status: "pending",
    shiftId: shift.id,
    date: shift.date,
    start: shift.start,
    end: shift.end,
    station: shift.station || "",
    userId: shift.userId || userId(),
    userName: shift.userName || u.name || u.email || "Crew",
    reason,
    storeId: storeId(),
    createdAt: Date.now()
  });
  alert("Request sent ✅");
  injectScheduleExtras();
}

async function injectScheduleExtras() {
  addStyles();
  const card = $("scheduleCard");
  if (!card) return;
  const shifts = await loadWeekShifts();
  const requests = await loadRequests();
  const manager = isManager();

  card.querySelectorAll("li").forEach((li)=>{
    if (li.innerText.includes("No shifts")) return;
    const shift = findShiftForLi(li, shifts);
    if (!shift) return;

    li.classList.add("has-shift-extras");

    if (!li.querySelector(".shift-status-pill")) {
      const badge = document.createElement("span");
      badge.className = `shift-status-pill ${shift.approved ? "shift-approved" : "shift-draft"}`;
      badge.textContent = shift.approved ? "✅ Approved" : "⚠️ Draft rota";
      li.appendChild(badge);
    }

    const existingReq = requests.find((r)=>r.shiftId === shift.id && r.userId === userId() && r.status === "pending");
    if (!manager && shift.userId === userId() && !li.querySelector(".shift-req-actions")) {
      const wrap = document.createElement("div");
      wrap.className = "shift-req-actions";
      wrap.innerHTML = existingReq
        ? `<div class="req-status">Request pending: ${esc(existingReq.type)}</div>`
        : `<button class="shift-req-btn" data-req="cover">Request cover</button><button class="shift-req-btn" data-req="swap">Swap shift</button><button class="shift-req-btn dark" data-req="cant">Can’t work this</button>`;
      li.appendChild(wrap);
      wrap.querySelectorAll("button[data-req]").forEach((btn)=>btn.addEventListener("click",()=>createRequest(shift, btn.dataset.req)));
    }
  });
}

async function updateRequest(id, status) {
  await updateDoc(doc(db, "stores", storeId(), "ShiftRequests", id), { status, decidedAt: Date.now(), decidedBy: userId() || "manager" });
  renderManagerRequests();
}

async function renderManagerRequests() {
  const u = sessionUser();
  if (!isManager(u)) return;
  addStyles();
  const host = $("bottomSection") || document.querySelector(".content-area");
  if (!host) return;
  let panel = $("shiftRequestsPanel");
  if (!panel) {
    panel = document.createElement("section");
    panel.id = "shiftRequestsPanel";
    panel.className = "req-panel";
    host.parentNode.insertBefore(panel, host.nextSibling);
  }
  const requests = (await loadRequests()).filter((r)=>r.status === "pending").slice(0, 10);
  panel.innerHTML = `<h3>🧾 Pending shift requests</h3>${requests.length ? requests.map((r)=>`<div class="req-card"><strong>${esc(r.userName)}</strong> · ${esc(r.type)}<br>${esc(r.date)} ${esc(r.start)}–${esc(r.end)} · ${esc(r.station)}<br><small>${esc(r.reason || "No reason given")}</small><div class="req-actions"><button class="req-action" data-approve="${esc(r.id)}">Approve</button><button class="req-action deny" data-deny="${esc(r.id)}">Deny</button></div></div>`).join("") : `<div class="req-card">No pending requests ✅</div>`}`;
  panel.querySelectorAll("[data-approve]").forEach((b)=>b.addEventListener("click",()=>updateRequest(b.dataset.approve,"approved")));
  panel.querySelectorAll("[data-deny]").forEach((b)=>b.addEventListener("click",()=>updateRequest(b.dataset.deny,"denied")));
}

function start() {
  addStyles();
  injectScheduleExtras();
  renderManagerRequests();
  const card = $("scheduleCard");
  if (card && card.dataset.shiftRequestWatch !== "1") {
    card.dataset.shiftRequestWatch = "1";
    new MutationObserver(()=>setTimeout(injectScheduleExtras, 250)).observe(card, { childList:true, subtree:true });
  }
  setInterval(()=>{ injectScheduleExtras(); renderManagerRequests(); }, 12000);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
