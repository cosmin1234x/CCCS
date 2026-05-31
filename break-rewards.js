// ========================================
// break-rewards.js — Upgraded Break Rewards
// - Daily 4 points reset
// - +1 bonus once per day (demo)
// - UK-style McDonald's menu items
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

// UK-style McDonald's menu used for the rewards demo.
// Exact Hayle availability changes by day/time/app, so keep this editable.
const MENU_ITEMS = [
  { id: "small_fries", name: "Small Fries", cost: 1, cat: "Fries & Sides", desc: "Classic small fries." },
  { id: "medium_fries", name: "Medium Fries", cost: 2, cat: "Fries & Sides", desc: "Medium portion of fries." },
  { id: "large_fries", name: "Large Fries", cost: 3, cat: "Fries & Sides", desc: "Large portion of fries." },
  { id: "hash_brown", name: "Hash Brown", cost: 1, cat: "Breakfast", desc: "Crispy breakfast side." },
  { id: "side_salad", name: "Side Salad", cost: 1, cat: "Fries & Sides", desc: "Light side option." },
  { id: "carrot_bag", name: "Carrot Bag", cost: 1, cat: "Fries & Sides", desc: "Simple lighter side." },

  { id: "hamburger", name: "Hamburger", cost: 2, cat: "Burgers", desc: "Classic hamburger." },
  { id: "cheeseburger", name: "Cheeseburger", cost: 2, cat: "Burgers", desc: "Classic cheeseburger." },
  { id: "double_cheeseburger", name: "Double Cheeseburger", cost: 4, cat: "Burgers", desc: "Two beef patties with cheese." },
  { id: "big_mac", name: "Big Mac", cost: 5, cat: "Burgers", desc: "Iconic Big Mac with sauce." },
  { id: "quarter_pounder", name: "Quarter Pounder with Cheese", cost: 5, cat: "Burgers", desc: "Beef burger with cheese." },
  { id: "filet_o_fish", name: "Filet-O-Fish", cost: 4, cat: "Burgers", desc: "Fish fillet burger." },
  { id: "mcplant", name: "McPlant", cost: 5, cat: "Vegan & Veggie", desc: "Plant-based burger option." },

  { id: "mayo_chicken", name: "Mayo Chicken", cost: 2, cat: "Chicken", desc: "Saver chicken burger." },
  { id: "mcchicken", name: "McChicken Sandwich", cost: 5, cat: "Chicken", desc: "Crispy chicken sandwich." },
  { id: "mccrispy", name: "McCrispy", cost: 5, cat: "Chicken", desc: "Crispy chicken breast burger." },
  { id: "spicy_mccrispy", name: "Spicy McCrispy", cost: 5, cat: "Chicken", desc: "Spicy crispy chicken burger." },
  { id: "4_nuggets", name: "4 Chicken McNuggets", cost: 2, cat: "Chicken", desc: "Small McNuggets portion." },
  { id: "6_nuggets", name: "6 Chicken McNuggets", cost: 3, cat: "Chicken", desc: "Six nuggets with optional dip." },
  { id: "9_nuggets", name: "9 Chicken McNuggets", cost: 5, cat: "Chicken", desc: "Nine nuggets with optional dip." },
  { id: "3_selects", name: "3 Chicken Selects", cost: 5, cat: "Chicken", desc: "Three crispy chicken selects." },
  { id: "veggie_dippers", name: "Veggie Dippers", cost: 4, cat: "Vegan & Veggie", desc: "Veggie dippers option." },

  { id: "sweet_chilli_wrap", name: "Sweet Chilli Chicken Wrap", cost: 5, cat: "Wraps", desc: "Crispy chicken wrap with sweet chilli sauce." },
  { id: "bbq_bacon_wrap", name: "BBQ & Bacon Chicken Wrap", cost: 5, cat: "Wraps", desc: "Crispy chicken wrap with BBQ and bacon." },
  { id: "garlic_mayo_wrap", name: "Garlic Mayo Chicken Wrap", cost: 5, cat: "Wraps", desc: "Crispy chicken wrap with garlic mayo." },
  { id: "spicy_veggie_wrap", name: "Spicy Veggie One", cost: 5, cat: "Vegan & Veggie", desc: "Veggie wrap option." },

  { id: "egg_cheese_mcmuffin", name: "Egg & Cheese McMuffin", cost: 3, cat: "Breakfast", desc: "Breakfast muffin without meat." },
  { id: "sausage_mcmuffin", name: "Sausage McMuffin", cost: 3, cat: "Breakfast", desc: "Sausage breakfast muffin." },
  { id: "sausage_egg_mcmuffin", name: "Sausage & Egg McMuffin", cost: 4, cat: "Breakfast", desc: "Sausage and egg muffin." },
  { id: "bacon_roll", name: "Bacon Roll", cost: 4, cat: "Breakfast", desc: "Breakfast bacon roll." },
  { id: "pancakes_syrup", name: "Pancakes & Syrup", cost: 4, cat: "Breakfast", desc: "Pancakes with syrup." },
  { id: "cheesy_bacon_flatbread", name: "Cheesy Bacon Flatbread", cost: 3, cat: "Breakfast", desc: "Cheesy bacon breakfast flatbread." },

  { id: "apple_pie", name: "Apple Pie", cost: 2, cat: "Desserts", desc: "Warm apple pie." },
  { id: "oreo_mini_mcflurry", name: "Oreo Mini McFlurry", cost: 2, cat: "Desserts", desc: "Mini Oreo McFlurry." },
  { id: "smarties_mini_mcflurry", name: "Smarties Mini McFlurry", cost: 2, cat: "Desserts", desc: "Mini Smarties McFlurry." },
  { id: "oreo_mcflurry", name: "Oreo McFlurry", cost: 3, cat: "Desserts", desc: "Regular Oreo McFlurry." },
  { id: "smarties_mcflurry", name: "Smarties McFlurry", cost: 3, cat: "Desserts", desc: "Regular Smarties McFlurry." },
  { id: "brownie", name: "Chocolate Brownie", cost: 3, cat: "Desserts", desc: "Chocolate brownie treat." },

  { id: "small_coke_zero", name: "Small Coca-Cola Zero Sugar", cost: 1, cat: "Drinks", desc: "Small fizzy drink." },
  { id: "small_diet_coke", name: "Small Diet Coke", cost: 1, cat: "Drinks", desc: "Small fizzy drink." },
  { id: "small_sprite_zero", name: "Small Sprite Zero", cost: 1, cat: "Drinks", desc: "Small fizzy drink." },
  { id: "small_fanta_zero", name: "Small Fanta Orange Zero", cost: 1, cat: "Drinks", desc: "Small fizzy drink." },
  { id: "oasis", name: "Oasis Summer Fruits", cost: 2, cat: "Drinks", desc: "Fruit drink." },
  { id: "bottle_water", name: "Bottled Water", cost: 1, cat: "Drinks", desc: "Still bottled water." },
  { id: "medium_milkshake", name: "Medium Milkshake", cost: 4, cat: "Drinks", desc: "Chocolate, strawberry, banana, or vanilla style." },

  { id: "americano", name: "Americano", cost: 1, cat: "McCafé", desc: "Black coffee." },
  { id: "white_coffee", name: "White Coffee", cost: 1, cat: "McCafé", desc: "White coffee." },
  { id: "regular_latte", name: "Regular Latte", cost: 2, cat: "McCafé", desc: "Regular latte." },
  { id: "cappuccino", name: "Cappuccino", cost: 2, cat: "McCafé", desc: "Regular cappuccino." },
  { id: "flat_white", name: "Flat White", cost: 2, cat: "McCafé", desc: "Flat white coffee." },
  { id: "hot_chocolate", name: "Hot Chocolate", cost: 2, cat: "McCafé", desc: "Hot chocolate drink." },
  { id: "caramel_frappe", name: "Caramel Frappe", cost: 4, cat: "McCafé", desc: "Cold frappe drink." },

  { id: "happy_hamburger", name: "Happy Meal Hamburger", cost: 3, cat: "Happy Meal", desc: "Happy Meal style hamburger option." },
  { id: "happy_cheeseburger", name: "Happy Meal Cheeseburger", cost: 3, cat: "Happy Meal", desc: "Happy Meal style cheeseburger option." },
  { id: "happy_nuggets", name: "Happy Meal 4 McNuggets", cost: 3, cat: "Happy Meal", desc: "Happy Meal style nuggets option." },
  { id: "happy_veggie_dippers", name: "Happy Meal Veggie Dippers", cost: 3, cat: "Happy Meal", desc: "Happy Meal style veggie option." },

  { id: "bbq_dip", name: "BBQ Dip", cost: 1, cat: "Sauces", desc: "Classic dip." },
  { id: "sweet_sour_dip", name: "Sweet & Sour Dip", cost: 1, cat: "Sauces", desc: "Classic dip." },
  { id: "sweet_curry_dip", name: "Sweet Curry Dip", cost: 1, cat: "Sauces", desc: "Classic dip." },
  { id: "ketchup", name: "Ketchup", cost: 1, cat: "Sauces", desc: "Ketchup dip." }
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
