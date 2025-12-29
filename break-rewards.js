// ========================================
// break-rewards.js — McTraining Break Rewards
// - Daily reset: 4 points per day (auto)
// - Bonus: +1 claim once per day (hard work / achievement)
// - Menu + cart + checkout (deduct points)
// - Saves orders:
//    users/{uid}/breakOrders/{orderId}
//    stores/{storeId}/BreakOrders/{orderId}
// ========================================

import { auth, db } from "./firebase-init.js";
import { signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
  collection,
  addDoc,
  query,
  orderBy,
  limit,
  onSnapshot,
  runTransaction
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

/* =========================
   DOM
========================= */
const sidebarUserName = document.getElementById("sidebarUserName");
const sidebarUserRole = document.getElementById("sidebarUserRole");
const navShiftCreator = document.getElementById("navShiftCreator");

const logoutBtn = document.getElementById("logoutBtn");
const sidebar = document.querySelector(".sidebar");
const sidebarToggle = document.getElementById("sidebarToggle");

const avatarCircle = document.getElementById("avatarCircle");
const backBtn = document.getElementById("backBtn");

const pointsNowEl = document.getElementById("pointsNow");
const pointsMetaEl = document.getElementById("pointsMeta");
const claimBonusBtn = document.getElementById("claimBonusBtn");

const menuSearch = document.getElementById("menuSearch");
const menuSearchBtn = document.getElementById("menuSearchBtn");
const menuResetBtn = document.getElementById("menuResetBtn");
const menuGrid = document.getElementById("menuGrid");

const cartTotalEl = document.getElementById("cartTotal");
const cartList = document.getElementById("cartList");
const checkoutBtn = document.getElementById("checkoutBtn");
const clearCartBtn = document.getElementById("clearCartBtn");

const historyList = document.getElementById("historyList");
const toastEl = document.getElementById("toast");

/* =========================
   CONFIG
========================= */
const DAILY_BASE_POINTS = 4;
const DAILY_BONUS_POINTS = 1;

// Simple rewards menu (edit freely)
const MENU = [
  { id: "small_fries", title: "Small Fries", category: "Sides", points: 1, desc: "Quick break classic." },
  { id: "medium_fries", title: "Medium Fries", category: "Sides", points: 2, desc: "More fuel for your shift." },
  { id: "apple_pie", title: "Apple Pie", category: "Dessert", points: 2, desc: "Warm + sweet." },
  { id: "mcflurry_snack", title: "McFlurry Snack", category: "Dessert", points: 3, desc: "Small treat." },

  { id: "cheeseburger", title: "Cheeseburger", category: "Burgers", points: 3, desc: "Simple and solid." },
  { id: "hamburger", title: "Hamburger", category: "Burgers", points: 2, desc: "Light bite." },

  { id: "nuggets_4", title: "4 Chicken McNuggets", category: "Chicken", points: 3, desc: "Dip + go." },
  { id: "wrap_snack", title: "Snack Wrap", category: "Chicken", points: 3, desc: "Quick wrap option." },

  { id: "small_soft_drink", title: "Small Soft Drink", category: "Drinks", points: 1, desc: "Any fountain drink." },
  { id: "water", title: "Water", category: "Drinks", points: 0, desc: "Stay hydrated." },
  { id: "hot_drink", title: "Tea / Coffee", category: "Drinks", points: 1, desc: "Warm boost." }
];

/* =========================
   STATE
========================= */
let sessionUser = null;
let userDocCache = null;
let uid = null;

let cart = {}; // { menuId: qty }
let unsubUser = null;
let unsubHistory = null;

/* =========================
   HELPERS
========================= */
function toast(msg) {
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  setTimeout(() => toastEl.classList.remove("show"), 2200);
}

function escapeHTML(str) {
  return String(str || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalize(s) {
  return String(s || "").toLowerCase().trim();
}

function todayKeyLocal() {
  // Local “day key” (YYYY-MM-DD)
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function loadSessionUser() {
  try { return JSON.parse(localStorage.getItem("mc_session_user")); }
  catch { return null; }
}

function saveSessionUser(u) {
  localStorage.setItem("mc_session_user", JSON.stringify(u));
}

function cartTotalPoints() {
  let total = 0;
  for (const [id, qty] of Object.entries(cart)) {
    const item = MENU.find(m => m.id === id);
    if (!item) continue;
    total += (Number(item.points) || 0) * (Number(qty) || 0);
  }
  return total;
}

function setCheckoutEnabled() {
  const total = cartTotalPoints();
  if (cartTotalEl) cartTotalEl.textContent = String(total);

  const available = Number(userDocCache?.breakPoints ?? 0) || 0;
  const hasItems = total > 0;
  const canAfford = total <= available;

  if (checkoutBtn) checkoutBtn.disabled = !(hasItems && canAfford);
}

function renderPoints() {
  const pts = Number(userDocCache?.breakPoints ?? 0) || 0;
  const lastReset = userDocCache?.breakPointsLastReset || "—";
  const bonusKey = userDocCache?.breakBonusClaimedOn || "—";

  if (pointsNowEl) pointsNowEl.textContent = String(pts);
  if (pointsMetaEl) pointsMetaEl.textContent = `Daily reset: ${lastReset} • Bonus claimed: ${bonusKey}`;

  const canClaim = bonusKey !== todayKeyLocal();
  if (claimBonusBtn) claimBonusBtn.disabled = !canClaim;

  setCheckoutEnabled();
}

/* =========================
   FIRESTORE: ensure user doc fields
========================= */
async function ensureUserDoc(firebaseUser) {
  const userRef = doc(db, "users", firebaseUser.uid);
  const snap = await getDoc(userRef);

  // create minimal doc if missing
  if (!snap.exists()) {
    const cached = loadSessionUser() || {};
    const payload = {
      name: cached.name || firebaseUser.displayName || firebaseUser.email || "User",
      email: String(firebaseUser.email || "").toLowerCase(),
      role: cached.role || "crew",
      storeId: cached.storeId || "store001",
      createdAt: serverTimestamp(),

      // Break Rewards fields
      breakPoints: DAILY_BASE_POINTS,
      breakPointsLastReset: todayKeyLocal(),
      breakBonusClaimedOn: null
    };
    await setDoc(userRef, payload);
    return payload;
  }

  // patch missing fields without overwriting existing
  const d = snap.data() || {};
  const patch = {};
  if (typeof d.breakPoints !== "number") patch.breakPoints = DAILY_BASE_POINTS;
  if (typeof d.breakPointsLastReset !== "string") patch.breakPointsLastReset = todayKeyLocal();
  if (!("breakBonusClaimedOn" in d)) patch.breakBonusClaimedOn = null;

  if (Object.keys(patch).length) {
    await updateDoc(userRef, patch);
    return { ...d, ...patch };
  }

  return d;
}

/* =========================
   DAILY RESET (transaction)
========================= */
async function ensureDailyReset() {
  if (!uid) return;

  const userRef = doc(db, "users", uid);
  const today = todayKeyLocal();

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(userRef);
    if (!snap.exists()) return;

    const d = snap.data() || {};
    const last = d.breakPointsLastReset;

    if (last !== today) {
      // New day: reset points back to 4, clear bonus claim
      tx.update(userRef, {
        breakPoints: DAILY_BASE_POINTS,
        breakPointsLastReset: today,
        breakBonusClaimedOn: null
      });
    }
  });
}

/* =========================
   BONUS CLAIM (+1/day)
========================= */
async function claimBonus() {
  if (!uid) return;

  const userRef = doc(db, "users", uid);
  const today = todayKeyLocal();

  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(userRef);
      if (!snap.exists()) return;

      const d = snap.data() || {};
      const claimed = d.breakBonusClaimedOn;

      if (claimed === today) {
        throw new Error("already_claimed");
      }

      const current = Number(d.breakPoints ?? 0) || 0;

      tx.update(userRef, {
        breakPoints: current + DAILY_BONUS_POINTS,
        breakBonusClaimedOn: today
      });
    });

    toast("+1 bonus point ✅");
  } catch (e) {
    if (String(e?.message).includes("already_claimed")) {
      toast("Bonus already claimed today.");
      return;
    }
    console.error("claimBonus error:", e);
    toast("Could not claim bonus.");
  }
}

/* =========================
   MENU RENDER
========================= */
function renderMenu() {
  if (!menuGrid) return;

  const q = normalize(menuSearch?.value || "");
  const list = MENU.filter(m => {
    if (!q) return true;
    const hay = `${m.title} ${m.category} ${m.desc}`.toLowerCase();
    return hay.includes(q);
  });

  menuGrid.innerHTML = list.length ? list.map(m => {
    const qty = Number(cart[m.id] || 0);
    return `
      <div class="card" style="padding:12px 13px;">
        <div class="menu-item-title">${escapeHTML(m.title)}</div>
        <div class="menu-item-meta">
          <span class="tag">🏷️ ${escapeHTML(m.category)}</span>
          <span class="tag">⭐ ${m.points} pts</span>
          ${m.points === 0 ? `<span class="badge-soft-success">Free</span>` : ``}
        </div>
        <div class="subsection-sub" style="margin:0; color:#374151;">
          ${escapeHTML(m.desc || "")}
        </div>

        <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:10px; align-items:center;">
          <button class="btn qtyMinus" type="button" data-id="${escapeHTML(m.id)}">−</button>
          <span class="tag" title="In cart">${qty}</span>
          <button class="btn-primary qtyPlus" type="button" data-id="${escapeHTML(m.id)}">+</button>
        </div>
      </div>
    `;
  }).join("") : `<div class="subsection-sub">No menu items found.</div>`;

  // bind clicks
  menuGrid.querySelectorAll(".qtyPlus").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      cart[id] = (Number(cart[id] || 0) || 0) + 1;
      renderMenu();
      renderCart();
      toast("Added to cart");
    });
  });
  menuGrid.querySelectorAll(".qtyMinus").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      const next = (Number(cart[id] || 0) || 0) - 1;
      if (next <= 0) delete cart[id];
      else cart[id] = next;
      renderMenu();
      renderCart();
    });
  });
}

/* =========================
   CART RENDER
========================= */
function renderCart() {
  if (!cartList) return;

  const entries = Object.entries(cart)
    .map(([id, qty]) => {
      const item = MENU.find(m => m.id === id);
      if (!item) return null;
      return { item, qty: Number(qty || 0) };
    })
    .filter(Boolean);

  if (!entries.length) {
    cartList.innerHTML = `<div class="subsection-sub" style="margin-top:10px;">Cart is empty. Add something from the menu.</div>`;
    setCheckoutEnabled();
    return;
  }

  cartList.innerHTML = entries.map(({ item, qty }) => {
    const linePts = (Number(item.points) || 0) * qty;
    return `
      <div class="cart-line">
        <div class="cart-left">
          <strong>${escapeHTML(item.title)}</strong>
          <small>${escapeHTML(item.category)} • ${item.points} pts each • <strong>${linePts} pts</strong></small>
        </div>

        <div class="qty-row">
          <button class="btn lineMinus" type="button" data-id="${escapeHTML(item.id)}">−</button>
          <span class="qty">${qty}</span>
          <button class="btn-primary linePlus" type="button" data-id="${escapeHTML(item.id)}">+</button>
          <button class="btn lineRemove" type="button" data-id="${escapeHTML(item.id)}">✕</button>
        </div>
      </div>
    `;
  }).join("");

  cartList.querySelectorAll(".linePlus").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      cart[id] = (Number(cart[id] || 0) || 0) + 1;
      renderMenu();
      renderCart();
      toast("Updated cart");
    });
  });

  cartList.querySelectorAll(".lineMinus").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      const next = (Number(cart[id] || 0) || 0) - 1;
      if (next <= 0) delete cart[id];
      else cart[id] = next;
      renderMenu();
      renderCart();
    });
  });

  cartList.querySelectorAll(".lineRemove").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      delete cart[id];
      renderMenu();
      renderCart();
    });
  });

  setCheckoutEnabled();
}

/* =========================
   CHECKOUT
========================= */
async function checkout() {
  if (!uid || !sessionUser) return;

  const total = cartTotalPoints();
  if (total <= 0) {
    toast("Cart is empty.");
    return;
  }

  const userRef = doc(db, "users", uid);
  const today = todayKeyLocal();

  // build order payload
  const items = Object.entries(cart).map(([id, qty]) => {
    const item = MENU.find(m => m.id === id);
    return item ? ({
      id: item.id,
      title: item.title,
      category: item.category,
      pointsEach: item.points,
      qty: Number(qty || 0),
      linePoints: (Number(item.points) || 0) * (Number(qty || 0))
    }) : null;
  }).filter(Boolean);

  const order = {
    createdAt: serverTimestamp(),
    createdOn: today,
    userId: uid,
    userName: sessionUser.name || "Crew",
    role: sessionUser.role || "crew",
    storeId: sessionUser.storeId || "store001",
    totalPoints: total,
    items
  };

  try {
    // Deduct points safely
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(userRef);
      if (!snap.exists()) throw new Error("no_user");

      const d = snap.data() || {};
      const last = d.breakPointsLastReset;

      // If day changed mid-session, force reset then re-check
      if (last !== today) {
        tx.update(userRef, {
          breakPoints: DAILY_BASE_POINTS,
          breakPointsLastReset: today,
          breakBonusClaimedOn: null
        });
        if (total > DAILY_BASE_POINTS) throw new Error("not_enough_points");
        tx.update(userRef, { breakPoints: DAILY_BASE_POINTS - total });
        return;
      }

      const current = Number(d.breakPoints ?? 0) || 0;
      if (total > current) throw new Error("not_enough_points");

      tx.update(userRef, { breakPoints: current - total });
    });

    // Save order records
    const userOrdersRef = collection(db, "users", uid, "breakOrders");
    const storeOrdersRef = collection(db, "stores", sessionUser.storeId || "store001", "BreakOrders");

    await Promise.all([
      addDoc(userOrdersRef, order),
      addDoc(storeOrdersRef, order)
    ]);

    cart = {};
    renderMenu();
    renderCart();
    toast("Order saved ✅");
  } catch (e) {
    console.error("checkout error:", e);
    if (String(e?.message).includes("not_enough_points")) {
      toast("Not enough points for that cart.");
      return;
    }
    toast("Checkout failed.");
  }
}

/* =========================
   ORDER HISTORY (realtime)
========================= */
function startHistory(uid) {
  try { unsubHistory?.(); } catch {}
  unsubHistory = null;

  const qy = query(
    collection(db, "users", uid, "breakOrders"),
    orderBy("createdAt", "desc"),
    limit(10)
  );

  unsubHistory = onSnapshot(qy, (qs) => {
    const rows = [];
    qs.forEach(docSnap => {
      rows.push({ id: docSnap.id, ...(docSnap.data() || {}) });
    });

    if (!historyList) return;

    if (!rows.length) {
      historyList.innerHTML = `<div class="subsection-sub">No orders yet.</div>`;
      return;
    }

    historyList.innerHTML = rows.map(o => {
      const title = (o.items || [])
        .slice(0, 2)
        .map(x => `${x.qty}× ${x.title}`)
        .join(", ") + ((o.items || []).length > 2 ? "…" : "");

      const when = o.createdOn || "—";
      const pts = Number(o.totalPoints || 0);

      return `
        <div class="history-line">
          <div>
            <strong>${escapeHTML(title || "Order")}</strong>
            <div class="subsection-sub" style="margin:2px 0 0; color:#374151;">
              ${escapeHTML((o.items || []).map(x => `${x.qty}× ${x.title}`).join(" • "))}
            </div>
          </div>
          <div class="right">${when}<br/>${pts} pts</div>
        </div>
      `;
    }).join("");
  });
}

/* =========================
   REALTIME USER DOC
========================= */
function stopRealtime() {
  try { unsubUser?.(); } catch {}
  unsubUser = null;
}

function startRealtime(uid) {
  stopRealtime();
  unsubUser = onSnapshot(doc(db, "users", uid), (snap) => {
    if (!snap.exists()) return;
    userDocCache = snap.data() || {};
    renderPoints();
  });
}

/* =========================
   EVENTS
========================= */
sidebarToggle?.addEventListener("click", () => sidebar?.classList.toggle("sidebar-open"));

logoutBtn?.addEventListener("click", async () => {
  try { unsubHistory?.(); } catch {}
  stopRealtime();
  await signOut(auth);
  localStorage.removeItem("mc_session_user");
  window.location.href = "index.html";
});

backBtn?.addEventListener("click", () => window.location.href = "main.html");

claimBonusBtn?.addEventListener("click", claimBonus);

menuSearchBtn?.addEventListener("click", renderMenu);
menuSearch?.addEventListener("input", renderMenu);
menuResetBtn?.addEventListener("click", () => {
  if (menuSearch) menuSearch.value = "";
  renderMenu();
  toast("Menu reset");
});

clearCartBtn?.addEventListener("click", () => {
  cart = {};
  renderMenu();
  renderCart();
  toast("Cart cleared");
});

checkoutBtn?.addEventListener("click", checkout);

/* =========================
   INIT
========================= */
function renderLoading() {
  if (pointsNowEl) pointsNowEl.textContent = "—";
  if (pointsMetaEl) pointsMetaEl.textContent = "Checking daily reset…";
  if (menuGrid) menuGrid.innerHTML = `<div class="subsection-sub">Loading menu…</div>`;
  if (cartList) cartList.innerHTML = `<div class="subsection-sub">Loading…</div>`;
  if (historyList) historyList.innerHTML = `<div class="subsection-sub">Loading…</div>`;
}

renderLoading();

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    localStorage.removeItem("mc_session_user");
    window.location.href = "index.html";
    return;
  }

  uid = user.uid;

  sessionUser = loadSessionUser() || {
    id: user.uid,
    role: "crew",
    name: user.displayName || user.email || "User",
    storeId: "store001"
  };

  // Ensure user doc exists and has rewards fields
  const d = await ensureUserDoc(user);

  // keep session in sync
  sessionUser.id = user.uid;
  sessionUser.name = d.name || sessionUser.name;
  sessionUser.role = d.role || sessionUser.role;
  sessionUser.storeId = d.storeId || sessionUser.storeId;
  saveSessionUser(sessionUser);

  // Sidebar labels
  if (sidebarUserName) sidebarUserName.textContent = sessionUser.name || "User Name";
  if (sidebarUserRole) sidebarUserRole.textContent = sessionUser.role === "crew" ? "Crew Member" : "Staff";
  if (avatarCircle) avatarCircle.textContent = String(sessionUser.name || "U").charAt(0).toUpperCase();

  if (navShiftCreator) navShiftCreator.style.display = sessionUser.role === "shiftCreator" ? "" : "none";

  // Daily reset check
  await ensureDailyReset();

  // Realtime
  startRealtime(uid);
  startHistory(uid);

  // UI
  userDocCache = d;
  renderPoints();
  renderMenu();
  renderCart();
});
