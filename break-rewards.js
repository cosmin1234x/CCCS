// break-rewards.js — McTraining Break Rewards
// - Daily reset to 4 points
// - Redeem menu items with points
// - Earn +1 point for achievements (demo)
// Uses: users/{uid} doc fields:
//   breakPoints: number
//   breakPointsDate: "YYYY-MM-DD" (local date string)
// Also writes orders to: users/{uid}/breakOrders/{orderId}

import { auth, db } from "./firebase-init.js";
import { signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  doc, getDoc, setDoc, updateDoc, onSnapshot,
  collection, addDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

/* =========================
   DOM
========================= */
const sidebar = document.querySelector(".sidebar");
const sidebarToggle = document.getElementById("sidebarToggle");
const logoutBtn = document.getElementById("logoutBtn");

const sidebarUserName = document.getElementById("sidebarUserName");
const sidebarUserRole = document.getElementById("sidebarUserRole");

const goTrainingBtn = document.getElementById("goTrainingBtn");

const pointsBalance = document.getElementById("pointsBalance");
const resetLabel = document.getElementById("resetLabel");

const menuGrid = document.getElementById("menuGrid");

const cartList = document.getElementById("cartList");
const cartTotalPill = document.getElementById("cartTotalPill");
const clearCartBtn = document.getElementById("clearCartBtn");
const redeemBtn = document.getElementById("redeemBtn");

const cartError = document.getElementById("cartError");
const cartSuccess = document.getElementById("cartSuccess");

const toastEl = document.getElementById("toast");

/* =========================
   MENU (edit freely)
   Costs are in points
========================= */
const MENU = [
  { id: "fries_small", name: "Small Fries", desc: "Classic fries (small).", cost: 2 },
  { id: "fries_medium", name: "Medium Fries", desc: "Classic fries (medium).", cost: 3 },
  { id: "mcflurry_snack", name: "Snack McFlurry", desc: "Snack-size treat.", cost: 4 },
  { id: "cheeseburger", name: "Cheeseburger", desc: "Standard build.", cost: 4 },
  { id: "hash_brown", name: "Hash Brown", desc: "Breakfast item (if available).", cost: 2 },
  { id: "small_drink", name: "Small Soft Drink", desc: "Any small cup drink.", cost: 2 },
];

/* =========================
   STATE
========================= */
let sessionUser = null;
let userDocCache = null;
let unsubUser = null;

let cart = {}; // { itemId: qty }

/* =========================
   Helpers
========================= */
function toast(msg) {
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  setTimeout(() => toastEl.classList.remove("show"), 2200);
}

function showError(msg) {
  if (!cartError) return;
  cartError.style.display = "block";
  cartError.textContent = msg;
  if (cartSuccess) cartSuccess.style.display = "none";
}

function showSuccess(msg) {
  if (!cartSuccess) return;
  cartSuccess.style.display = "block";
  cartSuccess.textContent = msg;
  if (cartError) cartError.style.display = "none";
}

function hideMessages() {
  if (cartError) cartError.style.display = "none";
  if (cartSuccess) cartSuccess.style.display = "none";
}

function todayKeyLocal() {
  // local device date -> YYYY-MM-DD
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function n(x) { return Number(x) || 0; }

function userRef() {
  return doc(db, "users", sessionUser.id);
}

function getPoints() {
  return n(userDocCache?.breakPoints);
}

function cartItems() {
  return Object.entries(cart)
    .map(([id, qty]) => ({ item: MENU.find(m => m.id === id), qty: n(qty) }))
    .filter(x => x.item && x.qty > 0);
}

function cartTotalPoints() {
  return cartItems().reduce((sum, x) => sum + (n(x.item.cost) * x.qty), 0);
}

/* =========================
   Ensure user doc exists (safe fallback)
========================= */
async function ensureUserDoc(firebaseUser) {
  const ref = doc(db, "users", firebaseUser.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) return snap.data();

  const payload = {
    name: firebaseUser.displayName || firebaseUser.email || "User",
    email: String(firebaseUser.email || "").toLowerCase(),
    role: "crew",
    storeId: "store001",
    createdAt: serverTimestamp(),

    // training fields might exist already, but safe defaults:
    trainingXP: 0,
    trainingLevel: 1,
    trainingProgress: {},

    // break points:
    breakPoints: 4,
    breakPointsDate: todayKeyLocal(),
  };

  await setDoc(ref, payload);
  return payload;
}

/* =========================
   Daily reset to 4 points
========================= */
async function ensureDailyPointsReset() {
  const key = todayKeyLocal();
  const last = String(userDocCache?.breakPointsDate || "");

  // first-time or new day: reset to 4
  if (!last || last !== key) {
    try {
      await updateDoc(userRef(), {
        breakPoints: 4,
        breakPointsDate: key
      });
      toast("Daily points reset to 4 ✅");
    } catch (e) {
      console.error("Daily reset failed:", e);
    }
  }

  if (resetLabel) resetLabel.textContent = key;
}

/* =========================
   Render
========================= */
function renderMenu() {
  if (!menuGrid) return;

  menuGrid.innerHTML = MENU.map(m => {
    const qty = n(cart[m.id]);
    return `
      <div class="card menu-card" style="padding:12px 13px;">
        <div class="card-header" style="margin-bottom:6px;">
          <div class="card-title">${m.cost} pts</div>
          <div class="card-icon">🍔</div>
        </div>

        <h3>${m.name}</h3>
        <p>${m.desc}</p>

        <div class="price-row">
          <span><strong>${m.cost}</strong> points</span>
          <span style="color:#6b7280; font-size:.78rem;">ID: ${m.id}</span>
        </div>

        <div class="qty-row">
          <span class="qty-pill">Qty: <strong>${qty}</strong></span>
          <button class="qty-btn" type="button" data-act="dec" data-id="${m.id}" ${qty <= 0 ? "disabled" : ""}>−</button>
          <button class="qty-btn" type="button" data-act="inc" data-id="${m.id}">+</button>
        </div>
      </div>
    `;
  }).join("");

  if (!menuGrid.dataset.bound) {
    menuGrid.addEventListener("click", (e) => {
      const btn = e.target.closest(".qty-btn");
      if (!btn) return;
      const id = btn.dataset.id;
      const act = btn.dataset.act;
      if (!id || !act) return;

      hideMessages();

      const cur = n(cart[id]);
      if (act === "inc") cart[id] = cur + 1;
      if (act === "dec") cart[id] = Math.max(0, cur - 1);

      renderAll();
    });
    menuGrid.dataset.bound = "1";
  }
}

function renderCart() {
  if (!cartList || !cartTotalPill || !redeemBtn) return;

  const items = cartItems();
  const total = cartTotalPoints();
  const balance = getPoints();
  const remaining = balance - total;

  cartTotalPill.textContent = `Total: ${total} pts`;

  if (!items.length) {
    cartList.innerHTML = `<div style="color:#6b7280; font-size:.85rem;">Your cart is empty. Add an item from the menu.</div>`;
  } else {
    cartList.innerHTML = items.map(x => `
      <div class="cart-item">
        <div>
          <div class="name">${x.item.name} × ${x.qty}</div>
          <div class="sub">${x.item.cost} pts each • ${x.item.tag ? x.item.tag : "Break item"}</div>
        </div>
        <div style="font-weight:900; white-space:nowrap;">${x.item.cost * x.qty} pts</div>
      </div>
    `).join("");
  }

  // redeem logic
  redeemBtn.disabled = !items.length || total <= 0 || total > balance;

  if (items.length && total > balance) {
    showError(`Not enough points. You need ${total} pts but you have ${balance} pts.`);
  } else {
    if (cartError) cartError.style.display = "none";
  }

  // nice hint
  if (items.length) {
    if (remaining >= 0) {
      showSuccess(`After redeem: ${remaining} points left.`);
    } else {
      if (cartSuccess) cartSuccess.style.display = "none";
    }
  } else {
    if (cartSuccess) cartSuccess.style.display = "none";
  }
}

function renderHeader() {
  if (pointsBalance) pointsBalance.textContent = String(getPoints());
  if (resetLabel) resetLabel.textContent = String(userDocCache?.breakPointsDate || todayKeyLocal());
}

function renderAll() {
  renderHeader();
  renderMenu();
  renderCart();
}

/* =========================
   Redeem (creates an order + subtracts points)
========================= */
async function redeemCart() {
  hideMessages();

  const items = cartItems();
  const total = cartTotalPoints();
  const balance = getPoints();

  if (!items.length || total <= 0) {
    showError("Your cart is empty.");
    return;
  }
  if (total > balance) {
    showError(`Not enough points. You need ${total} pts but you have ${balance} pts.`);
    return;
  }

  redeemBtn.disabled = true;

  try {
    // Write an order record (for manager/approval)
    const orderPayload = {
      createdAt: serverTimestamp(),
      status: "requested", // requested -> approved -> completed (your choice)
      totalPoints: total,
      items: items.map(x => ({
        id: x.item.id,
        name: x.item.name,
        cost: x.item.cost,
        qty: x.qty
      })),
      user: {
        uid: sessionUser.id,
        name: userDocCache?.name || sessionUser.name || "User",
        role: userDocCache?.role || sessionUser.role || "crew",
        storeId: userDocCache?.storeId || sessionUser.storeId || "store001"
      }
    };

    await addDoc(collection(db, "users", sessionUser.id, "breakOrders"), orderPayload);

    // Subtract points
    await updateDoc(userRef(), {
      breakPoints: balance - total
    });

    cart = {};
    renderAll();
    showSuccess("Redeem request sent ✅ Show this to your shift manager if needed.");
    toast("Order requested ✅");
  } catch (e) {
    console.error("redeemCart error:", e);
    showError("Could not redeem right now. Try again.");
  } finally {
    redeemBtn.disabled = false;
  }
}

/* =========================
   Earn +1 point (Achievement buttons)
   NOTE: For production you should restrict who can call this.
========================= */
async function awardAchievementPoint(achKey) {
  hideMessages();

  // Simple anti-spam (client-side only): one claim per key per day
  const key = todayKeyLocal();
  const claimId = `${achKey}_${key}`;
  const claimed = userDocCache?.breakAchievementsClaimed || {};
  if (claimed && claimed[claimId]) {
    showError("Already claimed today.");
    return;
  }

  try {
    const current = getPoints();
    await updateDoc(userRef(), {
      breakPoints: current + 1,
      [`breakAchievementsClaimed.${claimId}`]: true
    });
    toast("+1 point ✅");
  } catch (e) {
    console.error("awardAchievementPoint error:", e);
    showError("Could not add point.");
  }
}

/* =========================
   Realtime
========================= */
function stopRealtime() {
  try { unsubUser?.(); } catch {}
  unsubUser = null;
}

function startRealtime(uid) {
  stopRealtime();
  unsubUser = onSnapshot(doc(db, "users", uid), async (snap) => {
    if (!snap.exists()) return;
    userDocCache = snap.data() || {};

    // ensure daily reset after doc is present
    await ensureDailyPointsReset();

    renderAll();
  });
}

/* =========================
   Events
========================= */
sidebarToggle?.addEventListener("click", () => sidebar?.classList.toggle("sidebar-open"));

goTrainingBtn?.addEventListener("click", () => window.location.href = "training.html");

logoutBtn?.addEventListener("click", async () => {
  stopRealtime();
  await signOut(auth);
  localStorage.removeItem("mc_session_user");
  window.location.href = "index.html";
});

clearCartBtn?.addEventListener("click", () => {
  cart = {};
  hideMessages();
  renderAll();
  toast("Cart cleared");
});

redeemBtn?.addEventListener("click", redeemCart);

document.querySelectorAll(".ach-btn").forEach(btn => {
  btn.addEventListener("click", () => awardAchievementPoint(btn.dataset.ach || "achievement"));
});

/* =========================
   Init
========================= */
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }

  sessionUser = {
    id: user.uid,
    name: user.displayName || user.email || "User",
    role: "crew",
    storeId: "store001"
  };

  // Ensure doc exists + get initial data
  await ensureUserDoc(user);

  // Start realtime
  startRealtime(user.uid);

  // Sidebar user labels (best effort from doc cache later)
  if (sidebarUserName) sidebarUserName.textContent = sessionUser.name;
  if (sidebarUserRole) sidebarUserRole.textContent = "Crew Member";
});
