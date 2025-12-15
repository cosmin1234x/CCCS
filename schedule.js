// ==========================================================
// schedule.js — AI SHIFT GENERATOR (CLIENT-SIDE PREVIEW MODE)
// ==========================================================

import { auth, db } from "./firebase-init.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  collection,
  getDocs,
  addDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

/* ===================== SESSION ===================== */

let sessionUser = null;
let storeId = "store001";

/* ===================== STATE ===================== */

let allShifts = [];        // from Firestore
let generatedShifts = []; // AI preview only
let previewMode = false;

let storeCrew = [];
let currentWeekOffset = 0;

/* ===================== HELPERS ===================== */

const dayKeys = ["sun","mon","tue","wed","thu","fri","sat"];

function toISO(d) {
  return d.toISOString().slice(0,10);
}

function getWeek(offset = 0) {
  const now = new Date();
  const monday = new Date(now.setDate(now.getDate() - ((now.getDay()+6)%7)));
  monday.setDate(monday.getDate() + offset * 7);
  const days = [];
  for (let i=0;i<7;i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate()+i);
    days.push(d);
  }
  return days;
}

function hours(start,end){
  const [sh,sm]=start.split(":").map(Number);
  const [eh,em]=end.split(":").map(Number);
  let s=sh+sm/60,e=eh+em/60;
  if(e<s)e+=24;
  return e-s;
}

/* ===================== LOAD DATA ===================== */

async function loadCrew() {
  storeCrew=[];
  const snap=await getDocs(collection(db,"users"));
  snap.forEach(d=>{
    const u=d.data();
    if(u.storeId!==storeId)return;
    storeCrew.push({
      id:d.id,
      name:u.name||"Crew",
      role:u.role||"crew",
      skills:u.skills||{},
      availability:u.availability||{},
      maxHours:u.maxHoursPerWeek||40
    });
  });
}

async function loadShifts() {
  allShifts=[];
  const snap=await getDocs(collection(db,"stores",storeId,"Shifts"));
  snap.forEach(d=>{
    allShifts.push({id:d.id,...d.data()});
  });
}

/* ===================== AI ENGINE ===================== */

function stationPlan(demand){
  if(demand==="high") return ["front","drive","line","line","grill","chicken","fries"];
  if(demand==="low") return ["front","line","grill"];
  return ["front","drive","line","grill","fries"];
}

function canWork(u,day,start,end){
  const win=u.availability?.[day]||[];
  return win.some(w=>w.start<=start && w.end>=end);
}

function hasSkill(u,station){
  return station==="floater"||u.skills?.[station];
}

/* ===================== GENERATE ===================== */

function generateAI({weekOffset,forecast,core,close}) {
  generatedShifts=[];
  previewMode=true;

  const days=getWeek(weekOffset);
  const plannedHours={};

  for(const d of days){
    const date=toISO(d);
    const dayKey=dayKeys[d.getDay()];
    const demand=forecast[dayKey]||"normal";

    for(const block of ["core","close"]){
      const [start,end]=block==="core"?core:close;
      const stations=stationPlan(demand);

      for(const station of stations){
        const candidates=storeCrew
          .filter(u=>u.role==="crew")
          .filter(u=>hasSkill(u,station))
          .filter(u=>canWork(u,dayKey,start,end))
          .sort((a,b)=>(plannedHours[a.id]||0)-(plannedHours[b.id]||0));

        const pick=candidates[0];
        if(!pick) continue;

        const h=hours(start,end);
        if((plannedHours[pick.id]||0)+h>pick.maxHours) continue;

        plannedHours[pick.id]=(plannedHours[pick.id]||0)+h;

        generatedShifts.push({
          date,start,end,
          userId:pick.id,
          userName:pick.name,
          station,
          generated:true
        });
      }
    }
  }
}

/* ===================== RENDER ===================== */

function renderSchedule() {
  const root=document.getElementById("scheduleCard");
  const active=previewMode?generatedShifts:allShifts;
  const days=getWeek(currentWeekOffset);

  let html=`<h3>${previewMode?"⚠ Preview Schedule":"This Week"}</h3>`;
  html+=previewMode?`<p style="color:#b45309">Not published yet</p>`:"";

  for(const d of days){
    const date=toISO(d);
    const shifts=active.filter(s=>s.date===date);
    html+=`
      <div class="card">
        <strong>${d.toDateString()}</strong>
        <ul>
          ${shifts.length?shifts.map(s=>`
            <li>${s.start}-${s.end} · ${s.userName} · ${s.station}${s.generated?" 🤖":""}</li>
          `).join(""):"<li>No shifts</li>"}
        </ul>
      </div>`;
  }

  if(previewMode){
    html+=`<button id="publishBtn" class="btn">Publish shifts</button>`;
  }

  root.innerHTML=html;

  if(previewMode){
    document.getElementById("publishBtn").onclick=publishShifts;
  }
}

/* ===================== PUBLISH ===================== */

async function publishShifts(){
  for(const s of generatedShifts){
    await addDoc(collection(db,"stores",storeId,"Shifts"),{
      ...s,
      createdBy:sessionUser.id,
      createdAt:Date.now()
    });
  }
  generatedShifts=[];
  previewMode=false;
  await loadShifts();
  renderSchedule();
}

/* ===================== AUTH ===================== */

onAuthStateChanged(auth,async(user)=>{
  if(!user) return location.href="index.html";

  sessionUser=JSON.parse(localStorage.getItem("mc_session_user"))||{
    id:user.uid,
    name:user.displayName||"User",
    role:"shiftCreator",
    storeId:"store001"
  };

  storeId=sessionUser.storeId;

  await loadCrew();
  await loadShifts();

  renderSchedule();
});

/* ===================== LOGOUT ===================== */

document.getElementById("logoutBtn")?.addEventListener("click",async()=>{
  await signOut(auth);
  localStorage.clear();
  location.href="index.html";
});
