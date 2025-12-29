// ========================================
// break-rewards.js — Upgraded Break Rewards
// - Daily 4 points reset
// - +1 bonus once per day (demo)
// - Menu + category filter + search
// - Cart + checkout
// - Firestore user fields + order history
// ========================================

import { auth, db } from "./firebase-init.js";
import { signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
  onSnapshot,
  collection,
  addDoc,
  query,
  orderBy,
  limit
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

/* =========================
   DOM
========================= */

// sidebar
const sidebarUserName = document.getElementById("sidebarUserName");
const sidebarUserRole = document.getElementById("sidebarUserRole");
const logoutBtn = document.getElementById("logoutBtn");
const sidebar = document.querySelector(".sidebar");
const sidebarToggle = document.getElementById("sidebarToggle");

// header
const pointsNow = document.getElementById("pointsNow");
const pointsMeta = document.getElementById("pointsMeta");
const claimBonusBtn = document.getElementById("claimBonusBtn");
const backBtn = document.getElementById("backBtn");

// menu
const menuSearch = document.getElementById("menuSearch");
const menuSearchBtn = document.getElementById("menuSearchBtn");
const menuResetBtn = document.getElementById("menuResetBtn");
const categoryRow = document.getElementById("categoryRow");
const menuGrid = document.getElementById("menuGrid");

// cart
const cartTotalEl = document.getElementById("cartTotal");
const cartList = document.getElementById("cartList");
const cartHint = document.getElementById("cartHint");
const clearCartBtn = document.getElementById("clearCartBtn");
const checkoutBtn = document.getElementById("checkoutBtn");

// history
const historyList = document.getElementById("historyList");

// toast
const toastEl = document.getElementById("toast");

/* =========================
   DATA
========================= */

// You can change this menu anytime (cost = points)
const MENU_ITEMS = [
  { id: "small_fries", name: "Small Fries", cost: 1, cat: "Sides", desc: "Classic small fries." },
  { id: "med_fries", name: "Medium Fries", cost: 2, cat: "Sides", desc: "A bit more for your break." },
  { id: "apple_pie", name: "Apple Pie", cost: 2, cat: "Dessert", desc: "Warm & sweet." },
  { id: "mcflurry_snack", name: "Snack McFlurry", cost: 3, cat: "Dessert", desc: "Snack-size treat." },
  { id: "cheeseburger", name: "Cheeseburger", cost: 3, cat: "Burgers", desc: "Simple & quick." },
  { id: "hamburger", name: "Hamburger", cost: 3, cat: "Burgers", desc: "Classic burger." },
  { id: "6_nuggets", name: "6 Chicken McNuggets", cost: 3, cat: "Chicken", desc: "6 nuggets (dip optional)." },
  { id: "wrap_snack", name: "Snack Wrap", cost: 3, cat: "Chicken", desc: "Light wrap option." },
  { id: "small_drink", name: "Small Soft Drink", cost: 1, cat: "Drinks", desc: "Small cup." },
  { id: "bottle_water", name: "Bottled Water", cost: 1, cat: "Drinks", desc: "Stay hydrated." }
];

const CATS = ["All", ...Array.from(new Set(MENU_ITEMS.map(x => x.cat))).sort()];

let sessionUser = null;
let userDocCache = null;
let unsubUser = null;
let unsubHistory = null;

let activeCat = "All";
let cart = {}; // { itemId: qty }

/* =========================
   HELPERS
========================= */

function showToast(msg) {
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  setTimeout(() => toastEl.classList.remove("show"), 2200);
}

function normalize(s) {
  return String(s || "").toLowerCase().trim();
}

function escapeHTML(str) {
  return String(str || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function isoToday() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getPoints() {
  return Number(userDocCache?.breakPoints) || 0;
}

function cartTotalPoints() {
  let total = 0;
  for (const [id, qty] of Object.entries(cart)) {
    const item = MENU_ITEMS.find(x => x.id === id);
    if (!item) continue;
    total += (Number(qty) || 0) * (Number(item.cost) || 0);
  }
  return total;
}

function cartItemsDetailed() {
  return Object.entries(cart)
    .map(([id, qty]) => {
      const item = MENU_ITEMS.find(x => x.id === id);
      if (!item) return null;
      return { ...item, qty: Number(qty) || 0, lineTotal: (Number(qty) || 0) * item.cost };
    })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/* =========================
   FIRESTORE: ensure user doc fields
========================= */

async function ensureUserDoc(firebaseUser) {
  const ref = doc(db, "users", firebaseUser.uid);
  const snap = await getDoc(ref);

  // If users doc doesn't exist, create minimal (your app already does this elsewhere too)
  if (!snap.exists()) {
    const payload = {
      name: firebaseUser.displayName || firebaseUser.email || "User",
      email: String(firebaseUser.email || "").toLowerCase(),
      role: "crew",
      storeId: "store001",
      createdAt: serverTimestamp(),

      // break rewards defaults
      breakPoints: 4,
      breakPointsDate: isoToday(),
      breakBonusClaimed: false
    };
    await setDoc(ref, payload);
    return payload;
  }

  const d = snap.data() || {};
  return d;
}

async function ensureDailyReset(uid) {
  const today = isoToday();
  const last = String(userDocCache?.breakPointsDate || "");

  if (last !== today) {
    // Reset daily points to 4, reset bonus flag
    await updateDoc(doc(db, "users", uid), {
      breakPoints: 4,
      breakPointsDate: today,
      breakBonusClaimed: false
    });
  }

  // If missing fields, patch them once
  const patch = {};
  if (typeof userDocCache?.breakPoints !== "number") patch.breakPoints = 4;
  if (!userDocCache?.breakPointsDate) patch.breakPointsDate = today;
  if (typeof userDocCache?.breakBonusClaimed !== "boolean") patch.breakBonusClaimed = false;

  if (Object.keys(patch).length) {
    await updateDoc(doc(db, "users", uid), patch);
  }
}

function startRealtime(uid) {
  stopRealtime();

  unsubUser = onSnapshot(doc(db, "users", uid), async (snap) => {
    if (!snap.exists()) return;
    userDocCache = snap.data() || {};

    // ensure reset when date changes
    try { await ensureDailyReset(uid); } catch {}

    renderHeader();
    renderCart();
    renderMenu();
  });

  // history (last 6)
  unsubHistory = onSnapshot(
    query(collection(db, "users", uid, "breakOrders"), orderBy("createdAt", "desc"), limit(6)),
    (qs) => {
      const rows = [];
      qs.forEach(s => rows.push({ id: s.id, ...s.data() }));
      renderHistory(rows);
    }
  );
}

function stopRealtime() {
  try { unsubUser?.(); } catch {}
  try { unsubHistory?.(); } catch {}
  unsubUser = null;
  unsubHistory = null;
}

/* =========================
   RENDER
========================= */

function renderHeader() {
  const pts = getPoints();
  const today = String(userDocCache?.breakPointsDate || "—");
  const bonus = !!userDocCache?.breakBonusClaimed;

  if (pointsNow) pointsNow.textContent = String(pts);
  if (pointsMeta) pointsMeta.textContent = `Daily reset: ${today} • Bonus claimed: ${bonus ? "Yes" : "No"}`;

  if (claimBonusBtn) {
    claimBonusBtn.disabled = bonus;
    claimBonusBtn.textContent = bonus ? "Bonus claimed ✅" : "+1 Bonus";
  }

  if (sidebarUserName) sidebarUserName.textContent = userDocCache?.name || sessionUser?.name || "User";
  if (sidebarUserRole) {
    const role = String(userDocCache?.role || sessionUser?.role || "crew");
    sidebarUserRole.textContent = role === "crew" ? "Crew Member" : role === "shiftCreator" ? "Shift Creator" : "Manager";
  }
}

function renderCategories() {
  if (!categoryRow) return;

  categoryRow.innerHTML = CATS.map(c => {
    const active = c === activeCat ? "active" : "";
    return `<button class="pill-filter ${active}" type="button" data-cat="${escapeHTML(c)}">${escapeHTML(c)}</button>`;
  }).join("");

  if (!categoryRow.dataset.bound) {
    categoryRow.addEventListener("click", (e) => {
      const btn = e.target.closest(".pill-filter");
      if (!btn) return;
      activeCat = btn.dataset.cat || "All";
      renderMenu();
    });
    categoryRow.dataset.bound = "1";
  }
}

function renderMenu() {
  if (!menuGrid) return;

  renderCategories();

  const q = normalize(menuSearch?.value || "");
  const filtered = MENU_ITEMS.filter(item => {
    if (activeCat !== "All" && item.cat !== activeCat) return false;
    if (!q) return true;
    const hay = `${item.name} ${item.cat} ${item.desc}`.toLowerCase();
    return hay.includes(q);
  });

  menuGrid.innerHTML = filtered.length ? filtered.map(item => {
    return `
      <div class="menu-card">
        <div class="menu-top">
          <div style="min-width:0;">
            <h3 class="menu-title">${escapeHTML(item.name)}</h3>
            <div class="menu-desc">${escapeHTML(item.desc || "")}</div>
          </div>
          <div class="tag tag-cost" title="Point cost">⭐ ${item.cost} pts</div>
        </div>

        <div class="menu-tags">
          <div class="tag">${escapeHTML(item.cat)}</div>
        </div>

        <div class="menu-actions">
          <button class="btn addBtn" type="button" data-id="${escapeHTML(item.id)}">+ Add</button>
        </div>
      </div>
    `;
  }).join("") : `<div class="subsection-sub" style="margin-top:10px;">No items found.</div>`;

  if (!menuGrid.dataset.bound) {
    menuGrid.addEventListener("click", (e) => {
      const btn = e.target.closest(".addBtn");
      if (!btn) return;
      addToCart(btn.dataset.id);
    });
    menuGrid.dataset.bound = "1";
  }
}

function renderCart() {
  const pts = getPoints();
  const total = cartTotalPoints();
  const items = cartItemsDetailed();

  if (cartTotalEl) cartTotalEl.textContent = String(total);

  if (!items.length) {
    if (cartList) cartList.innerHTML = `<div class="subsection-sub">Your cart is empty.</div>`;
    if (cartHint) cartHint.textContent = "Add items from the menu.";
    if (checkoutBtn) checkoutBtn.disabled = true;
    return;
  }

  if (cartHint) {
    cartHint.textContent = total > pts
      ? `Too many points used. Remove ${total - pts} pts to checkout.`
      : `You have ${pts} pts. You're good to checkout.`;
  }

  if (checkoutBtn) checkoutBtn.disabled = !(total > 0 && total <= pts);

  if (cartList) {
    cartList.innerHTML = items.map(it => `
      <div class="cart-line">
        <div class="cart-left">
          <strong>${escapeHTML(it.name)}</strong>
          <small>${escapeHTML(it.cat)} • ⭐ ${it.cost} pts each</small>
        </div>
        <div style="display:flex; flex-direction:column; align-items:flex-end; gap:6px;">
          <div class="tag tag-cost">⭐ ${it.lineTotal}</div>
          <div class="qty-row">
            <button class="btn qtyMinus" type="button" data-id="${escapeHTML(it.id)}">−</button>
            <div class="qty">${it.qty}</div>
            <button class="btn qtyPlus" type="button" data-id="${escapeHTML(it.id)}">+</button>
          </div>
        </div>
      </div>
    `).join("");
  }

  if (!cartList.dataset.bound) {
    cartList.addEventListener("click", (e) => {
      const plus = e.target.closest(".qtyPlus");
      const minus = e.target.closest(".qtyMinus");
      if (plus) addToCart(plus.dataset.id);
      if (minus) removeFromCart(minus.dataset.id);
    });
    cartList.dataset.bound = "1";
  }
}

function renderHistory(rows) {
  if (!historyList) return;

  if (!rows.length) {
    historyList.innerHTML = `<div class="subsection-sub">No orders yet.</div>`;
    return;
  }

  historyList.innerHTML = rows.map(r => {
    const items = Array.isArray(r.items) ? r.items : [];
    const title = items.length ? items.map(x => `${x.qty}× ${x.name}`).join(", ") : "Order";
    const cost = Number(r.totalPoints) || 0;
    const when = r.createdAt?.toDate ? r.createdAt.toDate() : null;
    const stamp = when ? when.toLocaleString() : "—";

    return `
      <div class="history-line">
        <div style="min-width:0;">
          <strong style="font-size:.88rem;">${escapeHTML(title)}</strong>
          <div class="subsection-sub" style="margin:4px 0 0;">${escapeHTML(stamp)}</div>
        </div>
        <div class="right">⭐ ${cost} pts</div>
      </div>
    `;
  }).join("");
}

/* =========================
   CART ACTIONS
========================= */

function addToCart(itemId) {
  const item = MENU_ITEMS.find(x => x.id === itemId);
  if (!item) return;

  cart[itemId] = (Number(cart[itemId]) || 0) + 1;
  renderCart();
}

function removeFromCart(itemId) {
  const n = Number(cart[itemId]) || 0;
  if (n <= 1) delete cart[itemId];
  else cart[itemId] = n - 1;
  renderCart();
}

function clearCart() {
  cart = {};
  renderCart();
}

/* =========================
   POINTS / BONUS / CHECKOUT
========================= */

async function claimBonus() {
  if (!sessionUser?.id) return;
  if (!!userDocCache?.breakBonusClaimed) {
    showToast("Bonus already claimed today ✅");
    return;
  }

  try {
    const pts = getPoints();
    await updateDoc(doc(db, "users", sessionUser.id), {
      breakPoints: pts + 1,
      breakBonusClaimed: true
    });
    showToast("+1 bonus added ⭐");
  } catch (e) {
    console.error("claimBonus error:", e);
    showToast("Could not claim bonus.");
  }
}

async function checkout() {
  if (!sessionUser?.id) return;

  const pts = getPoints();
  const total = cartTotalPoints();
  const items = cartItemsDetailed();

  if (!items.length) return;
  if (total > pts) {
    showToast("Not enough points for that cart.");
    return;
  }

  try {
    // deduct points
    await updateDoc(doc(db, "users", sessionUser.id), {
      breakPoints: Math.max(0, pts - total)
    });

    // store order
    await addDoc(collection(db, "users", sessionUser.id, "breakOrders"), {
      items: items.map(i => ({ id: i.id, name: i.name, qty: i.qty, cost: i.cost })),
      totalPoints: total,
      createdAt: serverTimestamp()
    });

    clearCart();
    showToast("Order placed ✅");
  } catch (e) {
    console.error("checkout error:", e);
    showToast("Could not checkout.");
  }
}

/* =========================
   EVENTS
========================= */

sidebarToggle?.addEventListener("click", () => sidebar?.classList.toggle("sidebar-open"));

logoutBtn?.addEventListener("click", async () => {
  stopRealtime();
  await signOut(auth);
  localStorage.removeItem("mc_session_user");
  window.location.href = "index.html";
});

backBtn?.addEventListener("click", () => (window.location.href = "main.html"));

claimBonusBtn?.addEventListener("click", claimBonus);

menuSearchBtn?.addEventListener("click", renderMenu);
menuSearch?.addEventListener("input", renderMenu);

menuResetBtn?.addEventListener("click", () => {
  if (menuSearch) menuSearch.value = "";
  activeCat = "All";
  renderMenu();
  showToast("Filters reset ✅");
});

clearCartBtn?.addEventListener("click", clearCart);
checkoutBtn?.addEventListener("click", checkout);

/* =========================
   INIT
========================= */

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    stopRealtime();
    localStorage.removeItem("mc_session_user");
    window.location.href = "index.html";
    return;
  }

  sessionUser = {
    id: user.uid,
    name: user.displayName || user.email || "User"
  };

  userDocCache = await ensureUserDoc(user);

  // initial UI
  renderHeader();
  renderMenu();
  renderCart();
  renderHistory([]);

  startRealtime(user.uid);
});
