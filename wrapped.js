// wrapped.js — FULL VERSION
// Reads: users/{uid}.trainingXP, trainingLevel, trainingProgress
// Builds “Spotify Wrapped style” story + shareable image

import { auth, db } from "./firebase-init.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { doc, getDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

/* =========================
   DOM
========================= */
const backBtn = document.getElementById("backBtn");
const shareBtn = document.getElementById("shareBtn");
const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");
const storyEl = document.getElementById("story");
const progressBars = document.getElementById("progressBars");
const storyShell = document.getElementById("storyShell");
const toastEl = document.getElementById("toast");

/* =========================
   MODULES (must match training.js module IDs/titles/tags)
   Keep this list in sync with your training page.
========================= */
const MODULES = [
  { id:"food_safety_basics", title:"Food Safety Basics", tag:"Food safety", xp:40 },
  { id:"grill_station", title:"Grill Station – Core", tag:"Kitchen", xp:55 },
  { id:"fryer_station", title:"Fry Station – Quality & Safety", tag:"Kitchen", xp:50 },
  { id:"uk_build_big_mac", title:"Build – Big Mac (UK training)", tag:"Product build", xp:70 },
  { id:"uk_build_cheeseburger", title:"Build – Cheeseburger (UK training)", tag:"Product build", xp:55 },
  { id:"uk_build_quarter_pounder", title:"Build – Quarter Pounder (UK training)", tag:"Product build", xp:70 },
  { id:"uk_fries_holding", title:"Fries – Holding, Rotation & Presentation (UK training)", tag:"Kitchen", xp:60 },
  { id:"front_counter_greeting", title:"Front Counter – Greeting & Order Accuracy", tag:"Front counter", xp:45 },
  { id:"drive_thru_speed", title:"Drive-thru – Speed & Clarity", tag:"Drive-thru", xp:60 },
  { id:"customer_recovery", title:"Customer Recovery – Fixing Mistakes", tag:"Customer experience", xp:55 }
];

/* =========================
   STATE
========================= */
let uid = null;
let userDoc = null;
let slides = [];
let idx = 0;
let unsub = null;

/* =========================
   UI helpers
========================= */
function toast(msg){
  if(!toastEl) return;
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  setTimeout(()=>toastEl.classList.remove("show"), 2200);
}

function n(x){ return Number(x) || 0; }

function getProgressMap(){
  const p = userDoc?.trainingProgress;
  return (p && typeof p === "object") ? p : {};
}

function completedModules(){
  const p = getProgressMap();
  const completed = [];
  for (const m of MODULES){
    if (p[m.id]?.completed) completed.push(m);
  }
  return completed;
}

function categoryBreakdown(completed){
  const map = {};
  completed.forEach(m=>{
    map[m.tag] = (map[m.tag] || 0) + 1;
  });
  const arr = Object.entries(map).map(([tag,count])=>({tag,count}))
    .sort((a,b)=>b.count-a.count);
  return arr;
}

function topModule(completed){
  if (!completed.length) return null;
  // pick highest XP, tie-break by title
  return [...completed].sort((a,b)=>{
    const dx = n(b.xp) - n(a.xp);
    if (dx !== 0) return dx;
    return a.title.localeCompare(b.title);
  })[0];
}

function trainingPersonality({xp, completedCount, topTag}){
  // simple fun titles
  if (completedCount === 0) return { title:"Just Getting Started", sub:"Your training story begins now." };
  if (xp >= 450) return { title:"Shift Legend", sub:"You’re stacking skills like a pro." };
  if (topTag === "Kitchen") return { title:"Kitchen Machine", sub:"Fast hands. Clean builds. Solid rhythm." };
  if (topTag === "Drive-thru") return { title:"Drive-thru Commander", sub:"Clarity + speed under pressure." };
  if (topTag === "Food safety") return { title:"Safety First Star", sub:"You keep standards tight and customers safe." };
  return { title:"All-Rounder", sub:"You’re building skills across the floor." };
}

function calcLevelFromXP(xp){
  xp = n(xp);
  if (xp < 200) return 1;
  if (xp < 450) return 2;
  if (xp < 800) return 3;
  if (xp < 1250) return 4;
  return 5;
}

/* =========================
   Slide builder
========================= */
function buildSlides(){
  const xp = n(userDoc?.trainingXP);
  const level = n(userDoc?.trainingLevel) || calcLevelFromXP(xp);

  const completed = completedModules();
  const completedCount = completed.length;
  const top = topModule(completed);

  const breakdown = categoryBreakdown(completed);
  const topTag = breakdown[0]?.tag || "—";

  const personality = trainingPersonality({ xp, completedCount, topTag });

  const totalPossible = MODULES.length;
  const completionPct = totalPossible ? Math.round((completedCount/totalPossible)*100) : 0;

  slides = [
    {
      kicker: "McTraining Wrapped",
      title: `Hey ${userDoc?.name ? String(userDoc.name).split(" ")[0] : "crew"} 👋`,
      sub: "Here’s your training recap — tap Next to start.",
      cards: [
        { label:"Your level", value:`Level ${level}`, mini:`Based on ${xp} XP` },
        { label:"XP earned", value:`${xp} XP`, mini:"Keep going to level up" },
        { label:"Modules done", value:`${completedCount}/${totalPossible}`, mini:`${completionPct}% complete` }
      ],
      tags: ["UK training style", "Fast recap", "Built from your progress"]
    },

    {
      kicker: "Your progress",
      title: `${completedCount} modules completed`,
      sub: completedCount
        ? "That’s real momentum. Keep your streak going next shift."
        : "No modules marked complete yet — pick one and smash it today.",
      cards: [
        { label:"Completion", value:`${completionPct}%`, mini:"Across your library" },
        { label:"Top category", value: topTag, mini: breakdown[0] ? `${breakdown[0].count} module(s)` : "—" },
        { label:"Next target", value: completedCount ? "Level up" : "Complete 1 module", mini:"Small wins stack up" }
      ],
      tags: breakdown.slice(0,3).map(x=>`${x.tag}: ${x.count}`),
    },

    {
      kicker: "Top module",
      title: top ? top.title : "No top module yet",
      sub: top
        ? `Your biggest XP win so far: +${top.xp} XP.`
        : "Complete a module to unlock your top pick.",
      cards: [
        { label:"Category", value: top ? top.tag : "—", mini:"" },
        { label:"XP value", value: top ? `${top.xp} XP` : "—", mini:"" },
        { label:"Tip", value:"Do it twice", mini:"Repeat = speed + consistency" }
      ],
      tags: top ? ["Try a quiz next", "Keep builds clean"] : ["Open Grill Station", "Open Food Safety Basics"]
    },

    {
      kicker: "Your training style",
      title: personality.title,
      sub: personality.sub,
      cards: [
        { label:"Strength", value: topTag, mini:"Where you focused most" },
        { label:"Consistency", value: completedCount ? "Building" : "Starting", mini:"Complete → quiz → repeat" },
        { label:"Next upgrade", value:"Quiz mode", mini:"Lock the steps into muscle memory" }
      ],
      tags: ["Accuracy", "Clean station", "Good comms"]
    },

    {
      kicker: "Breakdown",
      title: "Where you trained most",
      sub: breakdown.length ? "Here’s your module mix." : "Complete a module to generate a breakdown.",
      customHTML: breakdown.length
        ? `<div class="grid" style="grid-template-columns:1fr;">
            ${breakdown.map(b=>`
              <div class="stat">
                <div class="label">${b.tag}</div>
                <div class="value">${b.count} module(s)</div>
                <div class="mini">${Math.round((b.count/totalPossible)*100)}% of library</div>
              </div>
            `).join("")}
          </div>`
        : `<div class="stat"><div class="label">No data yet</div><div class="value">Start with Grill or Food Safety</div><div class="mini">Then try a quiz.</div></div>`,
      tags: ["Tap Share to save a card", "Send to your manager 😄"]
    },

    {
      kicker: "Share card",
      title: "Save your Wrapped",
      sub: "Tap “Save share card” to download a shareable image.",
      cards: [
        { label:"Level", value:`${level}`, mini:"" },
        { label:"XP", value:`${xp}`, mini:"" },
        { label:"Done", value:`${completedCount}/${totalPossible}`, mini:"" }
      ],
      tags: ["McTraining Wrapped", "Your progress", "Keep levelling up"]
    }
  ];

  // rebuild progress bars
  if (progressBars){
    progressBars.innerHTML = slides.map(()=>`<div class="bar"><div></div></div>`).join("");
  }
}

/* =========================
   Render slide
========================= */
function render(){
  if (!storyEl || !slides.length) return;

  const s = slides[idx];

  // progress bars
  const bars = progressBars?.querySelectorAll(".bar > div") || [];
  bars.forEach((b,i)=>{
    b.style.width = i < idx ? "100%" : (i === idx ? "50%" : "0%");
  });

  const cardsHTML = s.cards
    ? `<div class="grid">
        ${s.cards.map(c=>`
          <div class="stat">
            <div class="label">${c.label}</div>
            <div class="value">${c.value}</div>
            <div class="mini">${c.mini || ""}</div>
          </div>
        `).join("")}
      </div>`
    : "";

  const tags = (s.tags || []).filter(Boolean);
  const tagsHTML = tags.length
    ? `<div class="tagrow">${tags.map(t=>`<span class="pill">${t}</span>`).join("")}</div>`
    : "";

  storyEl.innerHTML = `
    <div class="story-kicker">${s.kicker || ""}</div>
    <div class="story-title">${s.title || ""}</div>
    <div class="story-sub">${s.sub || ""}</div>

    ${s.customHTML || cardsHTML}
    ${tagsHTML}

    <div class="navhint">
      <span>${idx+1}/${slides.length}</span>
      <span>Tap right = next • Tap left = prev</span>
    </div>
  `;

  prevBtn && (prevBtn.disabled = idx === 0);
  nextBtn && (nextBtn.disabled = idx === slides.length - 1);
}

/* =========================
   Navigation
========================= */
function next(){
  if (idx < slides.length - 1){
    idx++;
    render();
  }
}
function prev(){
  if (idx > 0){
    idx--;
    render();
  }
}

function onTapNavigate(e){
  // Click/tap inside story shell -> left half prev, right half next
  const rect = storyShell.getBoundingClientRect();
  const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
  if (x < rect.width * 0.45) prev();
  else next();
}

/* =========================
   Share image (canvas)
========================= */
async function saveShareCard(){
  if (!userDoc) return;

  const xp = n(userDoc.trainingXP);
  const level = n(userDoc.trainingLevel) || calcLevelFromXP(xp);
  const completed = completedModules();
  const top = topModule(completed);
  const completedCount = completed.length;

  const W = 1080, H = 1350;
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");

  // background
  const g = ctx.createLinearGradient(0,0,0,H);
  g.addColorStop(0, "#0b1220");
  g.addColorStop(1, "#111827");
  ctx.fillStyle = g;
  ctx.fillRect(0,0,W,H);

  // glow blobs
  function blob(x,y,r, col){
    const rg = ctx.createRadialGradient(x,y,0,x,y,r);
    rg.addColorStop(0, col);
    rg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.arc(x,y,r,0,Math.PI*2);
    ctx.fill();
  }
  blob(220,220,360,"rgba(250,204,21,0.22)");
  blob(900,300,420,"rgba(34,197,94,0.18)");

  // card
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  roundRect(ctx, 70, 110, W-140, H-220, 36);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.lineWidth = 2;
  ctx.stroke();

  // title
  ctx.fillStyle = "#f9fafb";
  ctx.font = "900 64px system-ui, -apple-system, Segoe UI, Roboto, Arial";
  ctx.fillText("McTraining Wrapped", 120, 220);

  ctx.fillStyle = "rgba(249,250,251,0.75)";
  ctx.font = "700 30px system-ui, -apple-system, Segoe UI, Roboto, Arial";
  const name = userDoc?.name ? String(userDoc.name).split(" ")[0] : "Crew";
  ctx.fillText(`${name} • UK Training`, 120, 270);

  // stats
  ctx.fillStyle = "#f9fafb";
  ctx.font = "900 54px system-ui, -apple-system, Segoe UI, Roboto, Arial";
  ctx.fillText(`Level ${level}`, 120, 400);
  ctx.fillText(`${xp} XP`, 120, 470);
  ctx.fillText(`${completedCount} Modules`, 120, 540);

  // top module
  ctx.fillStyle = "rgba(249,250,251,0.75)";
  ctx.font = "800 30px system-ui, -apple-system, Segoe UI, Roboto, Arial";
  ctx.fillText("Top module:", 120, 640);

  ctx.fillStyle = "#facc15";
  ctx.font = "900 36px system-ui, -apple-system, Segoe UI, Roboto, Arial";
  wrapText(ctx, top ? top.title : "—", 120, 690, W-240, 44);

  // footer
  ctx.fillStyle = "rgba(249,250,251,0.65)";
  ctx.font = "800 26px system-ui, -apple-system, Segoe UI, Roboto, Arial";
  ctx.fillText("Made with McAssist", 120, H-170);

  const url = canvas.toDataURL("image/png");
  const a = document.createElement("a");
  a.href = url;
  a.download = "mctraining-wrapped.png";
  a.click();
  toast("Saved ✅");
}

// helpers for canvas
function roundRect(ctx, x, y, w, h, r){
  const rr = Math.min(r, w/2, h/2);
  ctx.beginPath();
  ctx.moveTo(x+rr, y);
  ctx.arcTo(x+w, y, x+w, y+h, rr);
  ctx.arcTo(x+w, y+h, x, y+h, rr);
  ctx.arcTo(x, y+h, x, y, rr);
  ctx.arcTo(x, y, x+w, y, rr);
  ctx.closePath();
}
function wrapText(ctx, text, x, y, maxWidth, lineHeight){
  const words = String(text).split(" ");
  let line = "";
  for (let n=0; n<words.length; n++){
    const testLine = line + words[n] + " ";
    const w = ctx.measureText(testLine).width;
    if (w > maxWidth && n > 0){
      ctx.fillText(line, x, y);
      line = words[n] + " ";
      y += lineHeight;
    } else {
      line = testLine;
    }
  }
  ctx.fillText(line, x, y);
}

/* =========================
   Firestore
========================= */
function stop(){
  try { unsub?.(); } catch {}
  unsub = null;
}

function start(uid){
  stop();
  unsub = onSnapshot(doc(db,"users",uid), (snap)=>{
    if(!snap.exists()) return;
    userDoc = snap.data() || {};
    buildSlides();
    idx = Math.min(idx, slides.length-1);
    render();
  });
}

/* =========================
   Events
========================= */
backBtn?.addEventListener("click", ()=> window.location.href = "training.html");
nextBtn?.addEventListener("click", next);
prevBtn?.addEventListener("click", prev);

storyShell?.addEventListener("click", onTapNavigate);
storyShell?.addEventListener("touchend", onTapNavigate, { passive:true });

shareBtn?.addEventListener("click", saveShareCard);

document.addEventListener("keydown", (e)=>{
  if (e.key === "ArrowRight") next();
  if (e.key === "ArrowLeft") prev();
});

/* =========================
   Auth init
========================= */
onAuthStateChanged(auth, async (user)=>{
  if(!user){
    window.location.href = "index.html";
    return;
  }
  uid = user.uid;

  // quick first load (so UI isn't blank before snapshot)
  const snap = await getDoc(doc(db,"users",uid));
  userDoc = snap.exists() ? (snap.data() || {}) : {};
  buildSlides();
  render();

  start(uid);
});
