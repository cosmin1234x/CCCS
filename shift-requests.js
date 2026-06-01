import { auth, db } from "./firebase-init.js";
import { collection, addDoc, getDocs, doc, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const $ = (id) => document.getElementById(id);

function sessionUser() {
  try { return JSON.parse(localStorage.getItem("mc_session_user") || "null") || {}; }
  catch { return {}; }
}

function isManager(u = sessionUser()) {
  return /manager|shiftcreator|admin/.test(String(u.role || "").toLowerCase().replace(/\s+/g, ""));
}

function esc(v) { return String(v || "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;"); }
function storeId() { return sessionUser().storeId || "store001"; }

function addStyles() {
  if ($("shiftRequestStyles")) return;
  const s = document.createElement("style");
  s.id = "shiftRequestStyles";
  s.textContent = `
    .shift-req-actions{display:flex;gap:5px;flex-wrap:wrap;margin-top:5px}.shift-req-btn{border:0;border-radius:999px;padding:5px 7px;background:#fff7ed;border:1px solid #f59e0b;color:#991b1b;font-size:.68rem;font-weight:900;cursor:pointer}.shift-req-btn.dark{background:#111827;color:white;border-color:#111827}.shift-status-pill{display:inline-flex;border-radius:999px;padding:3px 7px;font-size:.67rem;font-weight:900;margin-left:4px}.shift-approved{background:#dcfce7;color:#166534}.shift-draft{background:#fef3c7;color:#92400e}.req-panel{margin-top:14px;padding:14px;border-radius:20px;background:#fff7ed;border:1px solid #f59e0b}.req-panel h3{margin:0 0 8px;color:#991b1b}.req-card{background:white;border:1px solid #fed7aa;border-radius:14px;padding:10px;margin-top:8px;font-size:.78rem}.req-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}.req-action{border:0;border-radius:999px;padding:7px 10px;font-weight:900;cursor:pointer;background:#dc0019;color:white}.req-action.deny{background:#111827}`;
  document.head.appendChild(s);
}

async function loadRequests() {
  const snap = await getDocs(collection(db, "stores", storeId(), "ShiftRequests"));
  const items = [];
  snap.forEach((d)=>items.push({ id:d.id, ...d.data() }));
  return items.sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
}

async function createRequest(shift, type) {
  const u = sessionUser();
  const reason = prompt(type === "cover" ? "Why do you need cover?" : type === "swap" ? "Who/what shift do you want to swap with?" : "Why can’t you work this shift?", "") || "";
  await addDoc(collection(db, "stores", storeId(), "ShiftRequests"), {
    type,
    status: "pending",
    shiftId: shift.id,
    date: shift.date,
    start: shift.start,
    end: shift.end,
    station: shift.station || "",
    userId: shift.userId || u.id || auth.currentUser?.uid || "",
    userName: shift.userName || u.name || u.email || "Crew",
    reason,
    storeId: storeId(),
    createdAt: Date.now()
  });
  alert("Request sent ✅");
}

function parseShiftFromLi(li) {
  const raw = li.dataset.shift ? JSON.parse(li.dataset.shift) : null;
  return raw;
}

function attachCrewButtons() {
  const u = sessionUser();
  if (isManager(u)) return;
  const card = $("scheduleCard");
  if (!card || card.dataset.reqButtonsReady === "1") return;
  card.dataset.reqButtonsReady = "1";

  const tryAttach = () => {
    card.querySelectorAll("li[data-shift]").forEach((li) => {
      if (li.querySelector(".shift-req-actions")) return;
      const shift = parseShiftFromLi(li);
      if (!shift || shift.userId !== (u.id || auth.currentUser?.uid)) return;
      const wrap = document.createElement("div");
      wrap.className = "shift-req-actions";
      wrap.innerHTML = `<button class="shift-req-btn" data-req="cover">Request cover</button><button class="shift-req-btn" data-req="swap">Swap shift</button><button class="shift-req-btn dark" data-req="cant">Can’t work this</button>`;
      li.appendChild(wrap);
      wrap.querySelectorAll("button").forEach((btn)=>btn.addEventListener("click",()=>createRequest(shift, btn.dataset.req)));
    });
  };

  tryAttach();
  new MutationObserver(tryAttach).observe(card, { childList:true, subtree:true });
}

async function updateRequest(id, status) {
  await updateDoc(doc(db, "stores", storeId(), "ShiftRequests", id), { status, decidedAt: Date.now(), decidedBy: sessionUser().id || auth.currentUser?.uid || "manager" });
  renderManagerRequests();
}

async function renderManagerRequests() {
  const u = sessionUser();
  if (!isManager(u)) return;
  addStyles();
  const host = $("bottomSection") || document.querySelector(".content-area");
  if (!host) return;
  let panel = $("shiftRequestsPanel");
  if (!panel) { panel = document.createElement("section"); panel.id = "shiftRequestsPanel"; panel.className = "req-panel"; host.parentNode.insertBefore(panel, host.nextSibling); }
  const requests = (await loadRequests()).filter((r)=>r.status === "pending").slice(0, 10);
  panel.innerHTML = `<h3>🧾 Pending shift requests</h3>${requests.length ? requests.map((r)=>`<div class="req-card"><strong>${esc(r.userName)}</strong> · ${esc(r.type)}<br>${esc(r.date)} ${esc(r.start)}–${esc(r.end)} · ${esc(r.station)}<br><small>${esc(r.reason || "No reason given")}</small><div class="req-actions"><button class="req-action" data-approve="${esc(r.id)}">Approve</button><button class="req-action deny" data-deny="${esc(r.id)}">Deny</button></div></div>`).join("") : `<div class="req-card">No pending requests ✅</div>`}`;
  panel.querySelectorAll("[data-approve]").forEach((b)=>b.addEventListener("click",()=>updateRequest(b.dataset.approve,"approved")));
  panel.querySelectorAll("[data-deny]").forEach((b)=>b.addEventListener("click",()=>updateRequest(b.dataset.deny,"denied")));
}

function start() {
  addStyles();
  if ($("scheduleCard")) attachCrewButtons();
  renderManagerRequests();
  setInterval(renderManagerRequests, 15000);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
