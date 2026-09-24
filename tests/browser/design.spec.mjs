// Design system checks: responsive shell, navigation on every device, motion
// and reduced motion, dialogs and the sign-in experience.
// Runs on all Playwright projects (desktop, ipad, ipad-landscape, iphone).
import { test, expect as baseExpect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
// Several suites share this machine; give page boots generous headroom.
test.describe.configure({ timeout: 60000 });
const expect = baseExpect.configure({ timeout: 10000 });

// ---------------------------------------------------------------- stubs --
// Hermetic Firebase: every published browser module (build allowlist) is
// scanned for the names it imports from the gstatic SDK, and a stub module
// exporting exactly those names is served. No network, no real accounts.
function publishedScripts() {
  const build = readFileSync(root + "scripts/build.mjs", "utf8");
  return [...build.matchAll(/"([\w./-]+\.js)"/g)].map((m) => m[1]);
}
function sdkImports(kind) {
  const names = new Set();
  const pattern = new RegExp(
    `import\\s*\\{([^}]*)\\}\\s*from\\s*["']https://www\\.gstatic\\.com/firebasejs/[^"']*/firebase-${kind}\\.js["']`,
    "g",
  );
  for (const file of publishedScripts()) {
    let source = "";
    try {
      source = readFileSync(root + file, "utf8");
    } catch {
      continue;
    }
    for (const match of source.matchAll(pattern))
      match[1]
        .split(",")
        .map((part) => part.trim().split(/\s+as\s+/)[0])
        .filter(Boolean)
        .forEach((name) => names.add(name));
  }
  return names;
}
const AUTH_IMPL = {
  getAuth: "() => window.__auth",
  onAuthStateChanged:
    "(auth, callback) => { queueMicrotask(() => callback(window.__auth.currentUser)); return () => {}; }",
  signInWithEmailAndPassword:
    "async (auth, email, password) => window.__signIn(email, password)",
  createUserWithEmailAndPassword:
    "async () => ({ user: { uid: 'new-user', email: 'new@example.invalid' } })",
  sendPasswordResetEmail: "async () => {}",
  signOut: "async () => {}",
  updateProfile: "async () => {}",
};
const STORE_IMPL = {
  getFirestore: "() => ({})",
  doc: "(db, ...path) => ({ path: path.join('/') })",
  collection: "(db, ...path) => ({ path: path.join('/') })",
  query: "(ref) => ref",
  where: "() => ({})",
  orderBy: "() => ({})",
  limit: "() => ({})",
  serverTimestamp: "() => 0",
  getDoc:
    "async () => window.__profile ? ({ exists: () => true, data: () => window.__profile }) : ({ exists: () => false, data: () => ({}) })",
  getDocs: "async () => ({ docs: [], empty: true, size: 0, forEach() {} })",
  onSnapshot:
    "(ref, next) => { if (typeof next === 'function') setTimeout(() => next({ docs: [], empty: true, size: 0, forEach() {}, docChanges: () => [] }), 100); return () => {}; }",
  addDoc: "async () => ({ id: 'stub' })",
};
function stubModule(kind, impl) {
  const names = new Set([...sdkImports(kind), ...Object.keys(impl)]);
  return [...names]
    .map(
      (name) =>
        `export const ${name} = ${impl[name] || "(...args) => ({ args })"};`,
    )
    .join("\n");
}
const QA_PROFILE = {
  id: "qa-crew",
  name: "Alex QA",
  role: "crew",
  storeId: "qa-store",
  storeName: "QA · Store",
  verifiedStations: [],
};
async function hermetic(page, { signIn, signedIn } = {}) {
  if (signedIn) {
    await page.addInitScript((profile) => {
      window.__profile = profile;
      window.__signedIn = {
        uid: profile.id,
        email: "qa@example.invalid",
        getIdToken: async () => "test-token",
      };
    }, QA_PROFILE);
  }
  await page.addInitScript((mode) => {
    window.__auth = { currentUser: window.__signedIn || null };
    window.__signIn = async () => {
      await new Promise((r) => setTimeout(r, 250));
      if (mode === "fail") {
        const error = new Error("Firebase: Error (auth/invalid-credential).");
        error.code = "auth/invalid-credential";
        throw error;
      }
      return { user: { uid: "qa" } };
    };
  }, signIn || "fail");
  await page.route("**/firebase-init.js", (r) =>
    r.fulfill({
      contentType: "text/javascript",
      body: "export const app={};export const db={};export const auth=window.__auth;export const analytics=null;",
    }),
  );
  await page.route("https://www.gstatic.com/firebasejs/**/firebase-auth.js", (r) =>
    r.fulfill({ contentType: "text/javascript", body: stubModule("auth", AUTH_IMPL) }),
  );
  await page.route(
    "https://www.gstatic.com/firebasejs/**/firebase-firestore.js",
    (r) =>
      r.fulfill({
        contentType: "text/javascript",
        body: stubModule("firestore", STORE_IMPL),
      }),
  );
  await page.route("https://www.gstatic.com/firebasejs/**/firebase-app.js", (r) =>
    r.fulfill({ contentType: "text/javascript", body: "export const initializeApp=()=>({});" }),
  );
  // Preview mode must never call the API; fail loudly if it does.
  await page.route("**/api/**", (r) =>
    r.fulfill({ status: 500, json: { error: "No API in design tests" } }),
  );
  if (signedIn)
    await page.route("**/api/portal-data", (r) =>
      r.fulfill({
        json: {
          profile: QA_PROFILE,
          progress: {},
          shifts: [],
          team: [],
          verifications: [],
          roleRequests: [],
          recognition: [],
          permissions: {},
        },
      }),
    );
}

// Elements that stick out of the viewport horizontally (ignores anything
// inside a container that scrolls or clips horizontally on purpose).
async function overflowingElements(page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const clipped = (el) => {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const o = getComputedStyle(p).overflowX;
        if (o !== "visible") return true;
      }
      return false;
    };
    const bad = [];
    for (const el of document.querySelectorAll("#app *")) {
      const style = getComputedStyle(el);
      if (style.position === "fixed" && style.visibility === "hidden") continue;
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      if (rect.right <= vw + 1 && rect.left >= -1) continue;
      if (clipped(el)) continue;
      bad.push(
        `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} [${Math.round(rect.left)}→${Math.round(rect.right)} of ${vw}]`,
      );
      if (bad.length > 5) break;
    }
    return {
      bad,
      scroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
}

const PAGES = [
  ["home", "/main.html"],
  ["availability", "/main.html?view=availability"],
  ["assistant", "/main.html?view=assistant"],
  ["schedule", "/schedule.html"],
  ["planner", "/shifts-admin.html"],
  ["training", "/training.html"],
  ["lesson", "/module.html?id=food-safety"],
  ["mcstars", "/break-rewards.html"],
  ["team", "/admin.html"],
  ["verification", "/verification.html"],
  ["waste", "/waste.html"],
];
const withPreview = (url, role) =>
  url + (url.includes("?") ? "&" : "?") + "preview=" + role;

async function openShell(page, url) {
  await page.goto(url);
  await expect(page.locator(".app-shell")).toBeVisible({ timeout: 15000 });
  await expect(page.locator("#content > *").first()).toBeVisible({
    timeout: 15000,
  });
}

// ----------------------------------------------------- every page, fits --
for (const role of ["crew", "manager"]) {
  for (const [name, url] of PAGES) {
    test(`${role} ${name} fits the screen with reachable navigation`, async ({
      page,
      isMobile,
    }) => {
      await hermetic(page);
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await openShell(page, withPreview(url, role));
      await page.waitForTimeout(700);
      const { bad, scroll } = await overflowingElements(page);
      expect(bad, "elements outside the viewport").toEqual([]);
      expect(scroll).toBeLessThanOrEqual(0);
      const width = page.viewportSize().width;
      if (width <= 760) {
        const nav = page.getByRole("navigation", { name: "Mobile navigation" });
        await expect(nav).toBeVisible();
        await expect(nav.locator(":scope > a, :scope > button")).toHaveCount(5);
        await expect(page.locator(".sidebar")).toBeHidden();
        const box = await nav.boundingBox();
        expect(Math.round(box.y + box.height)).toBe(page.viewportSize().height);
      } else {
        const nav = page.getByRole("navigation", { name: "Main navigation" });
        await expect(nav).toBeVisible();
        const links = nav.getByRole("link");
        await expect(links).toHaveCount(role === "manager" ? 9 : 7);
        const sidebar = await page.locator(".sidebar").boundingBox();
        if (width < 1200) expect(sidebar.width).toBeLessThan(120);
        else expect(sidebar.width).toBeGreaterThan(200);
        const waste = nav.getByRole("link", { name: "Waste", exact: true });
        await waste.scrollIntoViewIfNeeded();
        await expect(waste).toBeInViewport();
        await expect(waste).toHaveAttribute("href", `/waste.html?preview=${role}`);
      }
      // The current destination is marked for assistive tech (crew opening a
      // manager-only address has no matching destination, by design).
      if (!(role === "crew" && ["planner", "team"].includes(name)))
        await expect(page.locator('[aria-current="page"]').first()).toBeAttached();
      expect(errors, "page errors").toEqual([]);
      void isMobile;
    });
  }
}

for (const [name, url] of [
  ["sign-in", "/"],
  ["sign-up", "/signup.html"],
]) {
  test(`${name} page fits the screen`, async ({ page }) => {
    await hermetic(page);
    await page.goto(url);
    await expect(page.locator("#authForm")).toBeVisible();
    await page.waitForTimeout(900);
    const { bad, scroll } = await overflowingElements(page);
    expect(bad).toEqual([]);
    expect(scroll).toBeLessThanOrEqual(0);
    // Touch devices must not zoom into inputs (iOS zooms below 16px).
    if (page.viewportSize().width <= 1100) {
      const size = await page
        .locator("#email")
        .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      expect(size).toBeGreaterThanOrEqual(16);
    }
  });
}

// -------------------------------------------------------- phone: More --
test("phone More sheet opens, lists every other destination and closes", async ({
  page,
}) => {
  test.skip(page.viewportSize().width > 760, "Phone layout only");
  await hermetic(page);
  await openShell(page, "/main.html?preview=manager");
  const more = page.getByRole("button", { name: "More", exact: true });
  await expect(more).toHaveAttribute("aria-expanded", "false");
  await more.tap();
  const sheet = page.getByRole("dialog", { name: "More" });
  await expect(sheet).toBeVisible();
  await expect(more).toHaveAttribute("aria-expanded", "true");
  const nav = sheet.getByRole("navigation", { name: "More destinations" });
  for (const label of [
    "My McStars",
    "My team",
    "Shift planner",
    "Verifications",
    "Waste",
    "My availability",
  ])
    await expect(nav.getByRole("link", { name: new RegExp(label) })).toBeVisible();
  await expect(sheet.getByRole("button", { name: "My profile" })).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Sign out" })).toBeVisible();
  // Sheet hugs the bottom edge and fits the screen.
  const box = await sheet.boundingBox();
  const viewport = page.viewportSize();
  expect(Math.abs(box.y + box.height - viewport.height)).toBeLessThan(2);
  expect(box.width).toBeLessThanOrEqual(viewport.width);
  // Close button.
  await sheet.getByRole("button", { name: "Close menu" }).tap();
  await expect(sheet).toBeHidden();
  await expect(more).toHaveAttribute("aria-expanded", "false");
  // Tap outside (backdrop) also closes.
  await more.tap();
  await expect(sheet).toBeVisible();
  await page.mouse.click(viewport.width / 2, 20);
  await expect(sheet).toBeHidden();
  // A destination in the sheet navigates, keeps preview mode and marks More.
  await more.tap();
  await nav.getByRole("link", { name: /Waste/ }).tap();
  await expect(page).toHaveURL(/\/waste\.html\?preview=manager/);
  await expect(page.locator("#moreButton")).toHaveClass(/active/);
});

test("crew More sheet shows crew destinations only", async ({ page }) => {
  test.skip(page.viewportSize().width > 760, "Phone layout only");
  await hermetic(page);
  await openShell(page, "/schedule.html?preview=crew");
  await page.getByRole("button", { name: "More", exact: true }).tap();
  const nav = page.getByRole("navigation", { name: "More destinations" });
  await expect(nav.getByRole("link")).toHaveCount(4);
  await expect(nav.getByRole("link", { name: /Waste/ })).toBeVisible();
  await expect(nav.getByRole("link", { name: /Shift planner/ })).toHaveCount(0);
});

test("profile panel opens from the shell on every screen", async ({ page }) => {
  await hermetic(page);
  await openShell(page, "/main.html?preview=crew");
  await expect(page.locator(".js-role-line").first()).toContainText("Crew Member");
  const viewport = page.viewportSize();
  if (viewport.width <= 760) {
    await page.getByRole("button", { name: "More", exact: true }).tap();
    await page
      .getByRole("dialog", { name: "More" })
      .getByRole("button", { name: "My profile" })
      .tap();
  } else {
    await page.locator("#profileButton").click();
  }
  const dialog = page.getByRole("dialog").filter({ visible: true }).last();
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("dialog", { name: "More" })).toBeHidden();
  await page.waitForTimeout(500);
  const box = await dialog.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  if (viewport.width <= 760)
    expect(Math.abs(box.y + box.height - viewport.height)).toBeLessThan(2);
  const close = dialog.getByRole("button", { name: /Close/ }).first();
  await expect(close).toBeInViewport();
  await close.click();
  await expect(dialog).toBeHidden();
});

test("design dialogs: centred on large screens, bottom sheet on phones, Escape closes", async ({
  page,
}) => {
  await hermetic(page);
  await openShell(page, "/main.html?preview=manager");
  await page.evaluate(() => {
    const modal = document.getElementById("modal");
    modal.innerHTML =
      '<h2>Test dialog</h2><p>Body copy</p><div class="dialog-actions"><button class="btn light" data-close-dialog type="button">Cancel</button><button class="btn" type="button">Confirm</button></div>';
    modal.showModal();
  });
  const dialog = page.locator("#modal");
  await expect(dialog).toBeVisible();
  await page.waitForTimeout(450);
  const box = await dialog.boundingBox();
  const viewport = page.viewportSize();
  if (viewport.width <= 760) {
    expect(Math.round(box.width)).toBe(viewport.width);
    expect(Math.abs(box.y + box.height - viewport.height)).toBeLessThan(2);
  } else {
    const centre = box.x + box.width / 2;
    expect(Math.abs(centre - viewport.width / 2)).toBeLessThan(2);
    expect(box.width).toBeLessThanOrEqual(560);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  // [data-close-dialog] closes with animation too.
  await page.evaluate(() => document.getElementById("modal").showModal());
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
});

test("toasts stack above the phone tab bar and disappear", async ({ page }) => {
  await hermetic(page);
  await openShell(page, "/main.html?preview=crew");
  await page.evaluate(() => {
    window.McMotion.toast("Shift published to the team rota.");
    window.McMotion.toast("Could not save. Try again.");
  });
  const toasts = page.locator("#toast .toast");
  await expect(toasts).toHaveCount(2);
  await expect(toasts.first()).toHaveClass(/toast-success/);
  await expect(toasts.nth(1)).toHaveClass(/toast-error/);
  const last = await toasts.nth(1).boundingBox();
  if (page.viewportSize().width <= 760) {
    const nav = await page
      .getByRole("navigation", { name: "Mobile navigation" })
      .boundingBox();
    expect(last.y + last.height).toBeLessThanOrEqual(nav.y);
  }
  await expect(toasts).toHaveCount(0, { timeout: 9000 });
});

// ------------------------------------------------------------- sign in --
// Records every data-state the button goes through (they can be brief, and
// the success state is followed by a navigation).
async function watchButtonStates(page, selector) {
  const states = [];
  await page.exposeFunction("__recordState", (state) => states.push(state));
  await page.evaluate((sel) => {
    const button = document.querySelector(sel);
    new MutationObserver(() => {
      const state = button.getAttribute("data-state");
      if (state) window.__recordState(state);
    }).observe(button, { attributes: true, attributeFilter: ["data-state"] });
  }, selector);
  return states;
}

test("sign-in page has its entrance motion, password toggle and friendly errors", async ({
  page,
}) => {
  await hermetic(page, { signIn: "fail" });
  await page.goto("/");
  await expect(page.locator(".auth-art")).toBeVisible();
  const width = page.viewportSize().width;
  if (width > 760) {
    await expect(page.locator(".auth-shift")).toBeVisible();
    expect(
      await page
        .locator(".auth-shift")
        .evaluate((el) => getComputedStyle(el).animationName),
    ).toContain("float-card");
  }
  await expect(page.locator(".auth-shapes span")).toHaveCount(3);
  // The staggered entrance plays once, then the layout is marked settled.
  const entrance = await page
    .locator(".auth-form h2")
    .evaluate((el) =>
      el.closest(".auth-layout").hasAttribute("data-settled")
        ? "settled"
        : getComputedStyle(el).animationName,
    );
  expect(["rise", "settled"]).toContain(entrance);
  await expect(page.locator(".auth-layout")).toHaveAttribute("data-settled", "");
  expect(
    await page
      .locator(".auth-shapes span")
      .first()
      .evaluate((el) => getComputedStyle(el).animationName),
  ).toBe("drift-a");
  await expect(page.getByRole("link", { name: "Take a look around" })).toHaveAttribute(
    "href",
    "/main.html?preview=crew",
  );
  // Show / hide password.
  const password = page.locator("#password");
  await password.fill("secret-pass");
  const toggle = page.getByRole("button", { name: "Show password" });
  await toggle.click();
  await expect(password).toHaveAttribute("type", "text");
  await expect(page.getByRole("button", { name: "Hide password" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: "Hide password" }).click();
  await expect(password).toHaveAttribute("type", "password");
  // Caps Lock hint.
  await password.evaluate((el) =>
    el.dispatchEvent(
      new KeyboardEvent("keyup", { key: "a", modifierCapsLock: true, bubbles: true }),
    ),
  );
  const capsSupported = await password.evaluate(
    () => new KeyboardEvent("keyup", { modifierCapsLock: true }).getModifierState("CapsLock"),
  );
  if (capsSupported) await expect(page.locator("#capsHint")).toBeVisible();
  // Wrong password: loading state, then a friendly message and a shake.
  await page.locator("#email").fill("crew@example.invalid");
  const submit = page.getByRole("button", { name: "Sign in" });
  const states = await watchButtonStates(page, "#authForm [type=submit]");
  await submit.click();
  await expect(page.locator("#authResult .error")).toContainText(
    "That email and password don’t match",
  );
  expect(states).toContain("loading");
  await expect(submit).not.toHaveAttribute("data-state", /.+/);
  await expect(submit).toBeEnabled();
});

test("successful sign-in shows the success check, then opens the hub", async ({
  page,
}) => {
  await hermetic(page, { signIn: "ok" });
  await page.goto("/");
  await page.locator("#email").fill("crew@example.invalid");
  await page.locator("#password").fill("correct-horse");
  const submit = page.getByRole("button", { name: "Sign in" });
  const opened = page.waitForRequest(/\/main\.html$/);
  const states = await watchButtonStates(page, "#authForm [type=submit]");
  await submit.click();
  await opened;
  expect(states).toEqual(["loading", "success"]);
});

test("sign-up role picker is a set of selectable cards", async ({ page }) => {
  await hermetic(page);
  await page.goto("/signup.html");
  const picker = page.getByRole("group", { name: "What is your role?" });
  await expect(picker).toBeVisible();
  const trainer = picker.getByRole("radio", { name: /Crew Trainer/ });
  await expect(picker.getByRole("radio", { name: /Crew Member/ })).toBeChecked();
  await picker.locator(".v2-role-option").nth(1).click();
  await expect(trainer).toBeChecked();
  await expect(picker.locator(".v2-role-note")).toContainText("approves");
  const card = picker.locator(".v2-role-option").nth(1).locator(".role-card");
  const border = await card.evaluate((el) => getComputedStyle(el).borderTopColor);
  expect(border).not.toBe("rgb(216, 218, 206)");
  for (const id of ["name", "email", "password", "storeId"])
    await expect(page.locator("#" + id)).toBeVisible();
});

// ------------------------------------------------------ reduced motion --
test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });
  test("sign-in and app skip decorative motion", async ({ page }) => {
    await hermetic(page);
    await page.goto("/");
    await expect(page.locator(".auth-art")).toBeVisible();
    for (const selector of [".auth-art", ".auth-shift", ".auth-form h2", ".auth-shapes span"])
      expect(
        await page
          .locator(selector)
          .first()
          .evaluate((el) => getComputedStyle(el).animationName),
        selector,
      ).toBe("none");
    await openShell(page, "/main.html?preview=crew");
    expect(
      await page.evaluate(() => document.documentElement.hasAttribute("data-entering")),
    ).toBe(false);
    expect(
      await page
        .locator("#content > *")
        .first()
        .evaluate((el) => getComputedStyle(el).animationName),
    ).toBe("none");
  });
});

test("app pages play the entrance motion when motion is allowed", async ({ page }) => {
  await hermetic(page);
  await page.goto("/main.html?preview=crew", { waitUntil: "commit" });
  await expect(page.locator("html[data-entering]")).toBeAttached();
  await expect(page.locator("html[data-entering]")).toHaveCount(0, { timeout: 4000 });
});

// ------------------------------------------ settles without DOM churn --
for (const [label, url, signedIn] of [
  ["preview training", "/training.html?preview=crew", false],
  ["signed-in training", "/training.html", true],
  ["signed-in home", "/main.html", true],
]) {
  test(`design motion never churns the DOM after a page settles (${label})`, async ({
    page,
  }) => {
    await hermetic(page, { signedIn });
    await page.goto(url);
    await expect(page.locator(".app-shell")).toBeVisible({ timeout: 15000 });
    if (url.includes("training"))
      await expect(
        page.locator('#content[data-enhanced-page="training"]'),
      ).toBeAttached({ timeout: 15000 });
    else await expect(page.locator("#content > *").first()).toBeVisible();
    await page.waitForTimeout(350);
    const mutations = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const records = [];
          const observer = new MutationObserver((list) => records.push(...list));
          observer.observe(document.getElementById("app"), {
            childList: true,
            subtree: true,
          });
          setTimeout(() => {
            observer.disconnect();
            resolve(
              records.map(
                (r) => `${r.target.nodeName}.${r.target.className || ""}`,
              ),
            );
          }, 350);
        }),
    );
    expect(mutations).toEqual([]);
  });
}

test("sidebar indicator follows the current page (tablet and desktop)", async ({
  page,
}) => {
  test.skip(page.viewportSize().width <= 760, "Sidebar layouts only");
  await hermetic(page);
  await openShell(page, "/schedule.html?preview=crew");
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await expect(nav).toHaveAttribute("data-ind", "ready");
  const active = nav.locator("a.active");
  await expect(active).toHaveAttribute("data-nav", "schedule");
  const [indicator, link] = await Promise.all([
    nav.evaluate((el) => ({
      y: parseFloat(el.style.getPropertyValue("--ind-y")),
      h: parseFloat(el.style.getPropertyValue("--ind-h")),
    })),
    active.evaluate((el) => {
      const a = el.getBoundingClientRect();
      const n = el.parentElement.getBoundingClientRect();
      return { y: a.top - n.top, h: a.height };
    }),
  ]);
  expect(Math.abs(indicator.y - link.y)).toBeLessThan(2);
  expect(Math.abs(indicator.h - link.h)).toBeLessThan(2);
});
