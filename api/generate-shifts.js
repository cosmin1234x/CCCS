// /api/generate-shifts.js
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

/**
 * ENV vars needed on Vercel:
 * FIREBASE_SERVICE_ACCOUNT_JSON  (stringified JSON)
 */

function getAdmin() {
  if (!getApps().length) {
    const svc = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    initializeApp({ credential: cert(svc) });
  }
  return getFirestore();
}

const DAY_KEYS = ["sun","mon","tue","wed","thu","fri","sat"];

function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,"0");
  const day = String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
}

function getMonday(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay(); // 0 Sun
  const diff = (day === 0 ? -6 : 1) - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0,0,0,0);
  return d;
}

function timeToMinutes(t) {
  const [hh,mm] = (t||"00:00").split(":").map(n=>parseInt(n,10)||0);
  return hh*60 + mm;
}

function minutesToTime(m) {
  m = ((m % (24*60)) + (24*60)) % (24*60);
  const hh = String(Math.floor(m/60)).padStart(2,"0");
  const mm = String(m%60).padStart(2,"0");
  return `${hh}:${mm}`;
}

function overlap(aStart,aEnd,bStart,bEnd) {
  return Math.max(aStart,bStart) < Math.min(aEnd,bEnd);
}

function hasSkill(user, skillKey) {
  return !!(user.skills && user.skills[skillKey]);
}

function stationPlanForRush(rush) {
  // tweak these numbers to match reality in your store
  if (rush === "high") {
    return [
      { station: "Grill",  skill: "grill",  count: 1 },
      { station: "Chicken",skill: "chicken",count: 1 },
      { station: "Line",   skill: "line",   count: 2 },
      { station: "Fries",  skill: "fries",  count: 1 },
      { station: "Front",  skill: "front",  count: 1 },
      { station: "Drive",  skill: "drive",  count: 1 },
    ];
  }
  if (rush === "medium") {
    return [
      { station: "Grill",  skill: "grill",  count: 1 },
      { station: "Line",   skill: "line",   count: 1 },
      { station: "Fries",  skill: "fries",  count: 1 },
      { station: "Front",  skill: "front",  count: 1 },
      { station: "Drive",  skill: "drive",  count: 1 },
    ];
  }
  // low
  return [
    { station: "Line",   skill: "line",   count: 1 },
    { station: "Front",  skill: "front",  count: 1 },
    { station: "Drive",  skill: "drive",  count: 1 },
  ];
}

function pickCrewForRole(crew, usedIds, weekHours, maxHours, skillKey) {
  // choose someone with the skill, not already used for this shift block, and not over hours
  const candidates = crew
    .filter(c => !usedIds.has(c.id))
    .filter(c => hasSkill(c, skillKey))
    .filter(c => (weekHours[c.id] || 0) < (c.maxHoursPerWeek || maxHours || 40))
    .sort((a,b) => (weekHours[a.id]||0) - (weekHours[b.id]||0)); // fairness: lowest hours first

  return candidates[0] || null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const db = getAdmin();

    const { storeId, weekOffset = 0, overwrite = false } = req.body || {};
    if (!storeId) return res.status(400).json({ error: "Missing storeId" });

    // compute week range
    const monday = getMonday(new Date());
    monday.setDate(monday.getDate() + (Number(weekOffset)||0) * 7);

    const weekDates = Array.from({ length: 7 }, (_,i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      return d;
    });

    const weekId = toISODate(monday);

    // load forecast
    const forecastSnap = await db.doc(`stores/${storeId}/forecast/${weekId}`).get();
    const forecast = forecastSnap.exists ? forecastSnap.data() : null;

    // load crew (users with storeId)
    const crewSnap = await db.collection("users").where("storeId","==",storeId).get();
    const crew = crewSnap.docs.map(d => ({ id: d.id, ...d.data() }))
      .filter(u => u.role === "crew" || u.role === "manager" || u.role === "shiftCreator");

    // load existing shifts for week (so we don’t clash)
    const shiftsSnap = await db.collection(`stores/${storeId}/Shifts`).get();
    const existing = shiftsSnap.docs.map(d => ({ id: d.id, ...d.data() }))
      .filter(s => s.date && s.start && s.end);

    const existingWeek = existing.filter(s => {
      const iso = s.date;
      return iso >= toISODate(weekDates[0]) && iso <= toISODate(weekDates[6]);
    });

    // optionally delete existing week shifts
    if (overwrite) {
      const batch = db.batch();
      existingWeek.forEach(s => batch.delete(db.doc(`stores/${storeId}/Shifts/${s.id}`)));
      await batch.commit();
    }

    // keep track of weekly hours for fairness
    const weekHours = {};
    // seed from existing shifts (if not overwriting)
    if (!overwrite) {
      existingWeek.forEach(s => {
        const dur = (timeToMinutes(s.end) - timeToMinutes(s.start) + 24*60) % (24*60);
        const hours = dur / 60;
        weekHours[s.userId] = (weekHours[s.userId]||0) + hours;
      });
    }

    const created = [];
    const batch = db.batch();

    for (let dayIndex=0; dayIndex<7; dayIndex++) {
      const dateObj = weekDates[dayIndex];
      const dayKey = DAY_KEYS[dateObj.getDay()];
      const dateISO = toISODate(dateObj);

      // decide rush/open/close
      const dayForecast = forecast?.days?.[dayKey] || { rush: "medium", open: "06:00", close: "23:00" };
      const rush = dayForecast.rush || "medium";
      const openM = timeToMinutes(dayForecast.open || "06:00");
      let closeM = timeToMinutes(dayForecast.close || "23:00");
      if (closeM <= openM) closeM += 24*60; // crossing midnight

      // pick ONE main block for now (simple). You can extend to 2 blocks (lunch/dinner).
      const blockStart = Math.max(openM, timeToMinutes("16:00"));
      const blockEnd = Math.min(closeM, timeToMinutes("23:00") + (closeM > 24*60 ? 24*60 : 0));

      // if store closes early, skip
      if (blockEnd - blockStart < 120) continue;

      const plan = stationPlanForRush(rush);

      // filter crew by availability for this day
      const availableCrew = crew.filter(u => {
        const av = u.availability?.[dayKey];
        if (!Array.isArray(av) || !av.length) return false;
        return av.some(slot => {
          const aS = timeToMinutes(slot.start);
          let aE = timeToMinutes(slot.end);
          if (aE <= aS) aE += 24*60;
          return overlap(blockStart, blockEnd, aS, aE);
        });
      });

      const usedThisDay = new Set();
      // avoid clashes with existing shifts
      const clashes = (userId) => {
        return existingWeek.some(s => {
          if (s.userId !== userId) return false;
          if (s.date !== dateISO) return false;
          const sS = timeToMinutes(s.start);
          let sE = timeToMinutes(s.end);
          if (sE <= sS) sE += 24*60;
          return overlap(blockStart, blockEnd, sS, sE);
        });
      };

      for (const roleNeed of plan) {
        for (let k=0;k<roleNeed.count;k++) {
          let pick = pickCrewForRole(availableCrew, usedThisDay, weekHours, 40, roleNeed.skill);

          // fallback: anyone available (even without exact skill) if none found
          if (!pick) {
            pick = availableCrew
              .filter(c => !usedThisDay.has(c.id))
              .sort((a,b)=> (weekHours[a.id]||0)-(weekHours[b.id]||0))[0] || null;
          }

          if (!pick) continue;
          if (clashes(pick.id)) continue;

          usedThisDay.add(pick.id);

          const shiftDoc = {
            date: dateISO,
            start: minutesToTime(blockStart),
            end: minutesToTime(blockEnd),
            userId: pick.id,
            userName: pick.name || "Crew member",
            role: pick.role || "crew",
            station: roleNeed.station,
            isShiftManager: false,
            generatedBy: "ai",
            generatedAt: Date.now(),
            rushLevel: rush
          };

          const ref = db.collection(`stores/${storeId}/Shifts`).doc();
          batch.set(ref, shiftDoc);
          created.push(shiftDoc);

          // add hours
          const hours = (blockEnd - blockStart) / 60;
          weekHours[pick.id] = (weekHours[pick.id]||0) + hours;
        }
      }
    }

    await batch.commit();
    return res.status(200).json({ ok: true, createdCount: created.length, weekId });
  } catch (err) {
    console.error("[generate-shifts] error", err);
    return res.status(500).json({ error: "Server error", details: String(err?.message || err) });
  }
}
