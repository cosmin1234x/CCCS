import { db } from "./firebase-init.js";
import { collection, getDocs, doc, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const $ = (id) => document.getElementById(id);
const STATIONS = ["Grill", "Fries", "Front Counter", "Drive Thru", "Kitchen", "Lobby", "Drinks", "Runner", "Cleaning", "Stock"];

function esc(v) { return String(v || "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"); }
function user() { try { return JSON.parse(localStorage.getItem("mc_session_user") || "null") || {}; } catch { return {}; } }
function iso(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
function monday() { const d = new Date(); const day = d.getDay(); d.setDate(d.getDate()+((day===0?-6:1)-day)); d.setHours(0,0,0,0); return d; }

function parseDates(text) {
  const m = String(text || "").match(/Dates:\s*(20\d{2}-\d{2}-\d{2})(?:\s*to\s*(20\d{2}-\d{2}-\d{2}))?/i);
  if (m) { const start = new Date(`${m[1]}T12:00:00`); const end = new Date(`${m[2] || m[1]}T12:00:00`); const out = []; for (let d = new Date(start); d <= end; d.setDate(d.getDate()+1)) out.push(new Date(d)); return out; }
  const start = monday(); return Array.from({length:7},(_,i)=>{ const d = new Date(start); d.setDate(start.getDate()+i); return d; });
}

async function loadShifts(dates) {
  const storeId = user().storeId || "store001";
  const wanted = new Set(dates.map(iso));
  const snap = await getDocs(collection(db, "stores", storeId, "Shifts"));
  const shifts = [];
  snap.forEach((docSnap)=>{ const d = docSnap.data() || {}; if (wanted.has(d.date)) shifts.push({ id: docSnap.id, ...d }); });
  return shifts.sort((a,b)=>`${a.date}${a.start}${a.station}`.localeCompare(`${b.date}${b.start}${b.station}`));
}

function addStyles() {
  if ($("rotaReviewStyles")) return;
  const s = document.createElement("style");
  s.id = "rotaReviewStyles";
  s.textContent = `.rota-review-card{margin:14px 0;padding:16px;border:2px solid #ffc300;border-radius:22px;background:linear-gradient(135deg,#fffdf2,#fff4c7);box-shadow:0 14px 36px rgba(120,53,15,.14)}.rota-review-head{display:flex;justify-content:space-between;gap:10px;align-items:flex-start;flex-wrap:wrap;margin-bottom:10px}.rota-review-title{font-size:1rem;font-weight:900;color:#8b0000;margin:0}.rota-review-sub{font-size:.78rem;color:#7c2d12;margin-top:4px}.rota-review-actions{display:flex;gap:8px;flex-wrap:wrap}.rota-review-btn{border:0;border-radius:999px;padding:9px 12px;font-weight:850;cursor:pointer;background:#dc0019;color:white}.rota-review-btn.light{background:white;color:#991b1b;border:1px solid #f59e0b}.rota-review-btn.dark{background:#111827;color:white}.rota-review-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-top:12px}.rota-box{background:white;border:1px solid #facc15;border-radius:16px;padding:10px;min-height:80px}.rota-box h4{margin:0 0 6px;font-size:.82rem;color:#991b1b;font-weight:900}.rota-line{font-size:.74rem;border-top:1px dashed #fde68a;padding-top:5px;margin-top:5px;color:#111827}.rota-pill{display:inline-flex;margin:2px 4px 2px 0;border-radius:999px;padding:4px 7px;background:#fff7ed;border:1px solid #fed7aa;font-size:.72rem;font-weight:800;color:#9a3412}.rota-problem{font-size:.74rem;color:#991b1b;margin:4px 0}`;
  document.head.appendChild(s);
}

function stats(shifts, dates) {
  const byDay = Object.fromEntries(dates.map((d)=>[iso(d), []]));
  const stationCount = Object.fromEntries(STATIONS.map((s)=>[s,0]));
  const people = {}; const problems = [];
  shifts.forEach((s)=>{ if (!byDay[s.date]) byDay[s.date] = []; byDay[s.date].push(s); if (stationCount[s.station] !== undefined) stationCount[s.station]++; if (!people[s.userId]) people[s.userId] = { name:s.userName||"Crew", days:new Set(), shifts:0 }; people[s.userId].days.add(s.date); people[s.userId].shifts++; });
  Object.entries(byDay).forEach(([date,list])=>{ const used = new Set(); list.forEach((s)=>{ if (used.has(s.userId)) problems.push(`${s.userName||"Crew"} has more than 1 shift on ${date}`); used.add(s.userId); }); });
  const daysOff = Object.values(people).map((p)=>({ name:p.name, daysOff:7-p.days.size, shifts:p.shifts }));
  daysOff.forEach((p)=>{ if (p.daysOff < 2) problems.push(`${p.name} has only ${p.daysOff} day(s) off`); });
  return { byDay, stationCount, daysOff, problems };
}

async function approveRota(shifts) {
  const u = user();
  const storeId = u.storeId || "store001";
  const approvedBy = u.id || u.uid || u.email || "manager";
  for (const s of shifts) {
    await updateDoc(doc(db, "stores", storeId, "Shifts", s.id), { approved: true, approvedBy, approvedAt: Date.now(), status: "approved" });
  }
}

async function renderReview(sourceText) {
  addStyles();
  const dates = parseDates(sourceText);
  const shifts = await loadShifts(dates);
  const st = stats(shifts, dates);
  const host = $("bottomSection") || document.querySelector(".content-area");
  if (!host) return;
  let card = $("rotaReviewCard");
  if (!card) { card = document.createElement("section"); card.id = "rotaReviewCard"; card.className = "rota-review-card"; host.parentNode.insertBefore(card, host.nextSibling); }
  const allApproved = shifts.length > 0 && shifts.every((s)=>s.approved === true);
  const dayHtml = dates.map((d)=>{ const key = iso(d); const list = st.byDay[key] || []; return `<div class="rota-box"><h4>${d.toLocaleDateString(undefined,{weekday:"short",day:"numeric",month:"short"})}</h4>${list.length ? list.map((x)=>`<div class="rota-line"><strong>${esc(x.userName||"Crew")}</strong><br>${esc(x.start)}–${esc(x.end)} · ${esc(x.station||"Station")}${x.approved ? " · ✅ Approved" : " · ⚠️ Draft"}</div>`).join("") : `<div class="rota-line">No shifts</div>`}</div>`; }).join("");
  const stationHtml = Object.entries(st.stationCount).filter(([,n])=>n>0).map(([k,n])=>`<span class="rota-pill">${esc(k)}: ${n}</span>`).join("") || `<span class="rota-pill">No coverage yet</span>`;
  const offHtml = st.daysOff.map((p)=>`<span class="rota-pill">${esc(p.name)}: ${p.daysOff} off</span>`).join("") || `<span class="rota-pill">No crew shifts</span>`;
  const problemHtml = st.problems.length ? st.problems.slice(0,8).map((p)=>`<div class="rota-problem">⚠️ ${esc(p)}</div>`).join("") : `<div class="rota-problem">✅ No obvious rule problems found.</div>`;
  card.innerHTML = `<div class="rota-review-head"><div><h3 class="rota-review-title">${allApproved ? "✅ Approved rota" : "⚠️ Draft smart rota"}</h3><div class="rota-review-sub">Review: ${iso(dates[0])}${dates.length>1 ? ` to ${iso(dates.at(-1))}` : ""} · ${shifts.length} shift(s)</div></div><div class="rota-review-actions"><button id="approveRotaBtn" class="rota-review-btn">${allApproved ? "Approved ✅" : "Approve"}</button><button id="regenRotaBtn" class="rota-review-btn light">Regenerate</button><button id="editRotaBtn" class="rota-review-btn dark">Edit manually</button></div></div><div class="rota-review-grid">${dayHtml}</div><div class="rota-review-grid"><div class="rota-box"><h4>Station coverage</h4>${stationHtml}</div><div class="rota-box"><h4>Days off</h4>${offHtml}</div><div class="rota-box"><h4>Gaps / problems</h4>${problemHtml}</div></div>`;
  $("approveRotaBtn")?.addEventListener("click", async ()=>{ const btn = $("approveRotaBtn"); btn.disabled = true; btn.textContent = "Approving…"; await approveRota(shifts); btn.textContent = "Approved ✅"; setTimeout(()=>renderReview(sourceText), 400); });
  $("regenRotaBtn")?.addEventListener("click", ()=>{ const i = $("aiInput"), f = $("aiForm"); if (i && f) { i.value = sourceText.toLowerCase().includes("next week") ? "generate shifts next week 6am-11pm core stations" : "generate shifts this week 6am-11pm core stations"; f.requestSubmit(); } });
  $("editRotaBtn")?.addEventListener("click", ()=>{ window.location.href = "schedule.html"; });
}

function start() {
  const chat = $("aiChat");
  if (!chat || chat.dataset.rotaReviewWatch === "1") return;
  chat.dataset.rotaReviewWatch = "1";
  new MutationObserver(()=>{ const last = [...chat.querySelectorAll(".msg-bot .bubble")].at(-1); const text = last?.innerText || ""; if (text.includes("Smart shifts generated")) setTimeout(()=>renderReview(text), 600); }).observe(chat, { childList:true, subtree:true });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
