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
  // The selected card eases to the gold border (a 240ms transition), so wait
  // for it to settle instead of sampling mid-transition: a read in the first
  // frame after the click still returns the default --line-strong colour.
  const cards = picker.locator(".v2-role-option .role-card");
  await expect(cards.nth(1)).toHaveCSS("border-top-color", "rgb(231, 166, 0)");
  await expect(cards.nth(1).locator(".role-check")).toHaveCSS(
    "background-color",
    "rgb(37, 40, 37)",
  );
  // The others go back to the default border (hover aside).
  await page.mouse.move(0, 0);
  await expect(cards.nth(0)).toHaveCSS("border-top-color", "rgb(216, 218, 206)");
  await expect(cards.nth(2)).toHaveCSS("border-top-color", "rgb(216, 218, 206)");
  for (const id of ["name", "email", "password", "storeId"])
    await expect(page.locator("#" + id)).toBeVisible();
});

test("sign-up store ID pattern is valid with the v flag and checks the ID", async ({
  page,
}) => {
  await hermetic(page);
  await page.goto("/signup.html");
  const storeId = page.locator("#storeId");
  await expect(storeId).toBeVisible();
  // Browsers compile pattern="" with the v flag, where an unescaped "-" at
  // the end of a class is a syntax error that silently disables validation.
  const pattern = await storeId.getAttribute("pattern");
  expect(() => new RegExp(`^(?:${pattern})$`, "v")).not.toThrow();
  for (const [value, valid] of [
    ["1170", true],
    ["hayle_1170-b", true],
    ["11 70", false],
    ["1170/Hayle", false],
  ]) {
    await storeId.fill(value);
    expect(await storeId.evaluate((el) => el.checkValidity()), value).toBe(valid);
  }
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

// ------------------------------------------------------- shell details --
test("the shell has no legacy McAssist card; tips only sit beside Home", async ({
  page,
}) => {
  await hermetic(page);
  await openShell(page, "/main.html?preview=crew");
  for (const selector of [
    "#assistant",
    ".assistant-card",
    "#chatForm",
    "[data-prompt]",
    "[data-ask]",
  ])
    await expect(page.locator(selector), selector).toHaveCount(0);
  // The rail (tips) is only rendered on Home and only shown when it fits.
  const rail = page.locator(".rail");
  await expect(rail).toHaveCount(1);
  const wide = page.viewportSize().width >= 1360;
  if (wide) await expect(rail).toBeVisible();
  else await expect(rail).toBeHidden();
  await openShell(page, "/schedule.html?preview=crew");
  await expect(page.locator(".rail")).toHaveCount(0);
  // McAssist's own page owns the chat IDs: exactly one of each.
  await openShell(page, "/main.html?view=assistant&preview=crew");
  await expect(page.getByRole("textbox", { name: "Message McAssist" })).toBeVisible();
  await expect(page.locator("#chat")).toHaveCount(1);
  await expect(page.locator("#chatInput")).toHaveCount(1);
});

test("the bell opens only the notifications panel", async ({ page }) => {
  await hermetic(page);
  await openShell(page, "/main.html?preview=crew");
  await page.locator("#notifications").click();
  const panel = page.locator("#pgSheet");
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("heading", { name: "Notifications" })).toBeVisible();
  await expect(page.locator("#modal")).not.toHaveAttribute("open", "");
  await expect(page.locator("dialog[open]")).toHaveCount(1);
});

test("top bar and phone tab bar are opaque", async ({ page }) => {
  await hermetic(page);
  await openShell(page, "/schedule.html?preview=manager");
  const alphaOf = (locator) =>
    locator.evaluate((el) => {
      const style = getComputedStyle(el);
      const match = style.backgroundColor.match(/rgba?\(([^)]+)\)/);
      const parts = match ? match[1].split(",").map(Number) : [];
      return {
        alpha: parts.length === 4 ? parts[3] : 1,
        backdrop: style.backdropFilter || style.webkitBackdropFilter || "none",
      };
    });
  const topbar = await alphaOf(page.locator(".topbar"));
  expect(topbar.alpha).toBe(1);
  expect(topbar.backdrop).toBe("none");
  if (page.viewportSize().width <= 760) {
    const bar = await alphaOf(page.getByRole("navigation", { name: "Mobile navigation" }));
    expect(bar.alpha).toBe(1);
    expect(bar.backdrop).toBe("none");
  }
});

// Decorative loops drain iPad batteries: app pages may only loop loading
// spinners and skeletons. Feature modules (McAssist, learning, waste) are
// checked in their own suites.
const LOADING_ANIMATIONS = /spin|shimmer|boot|skel/i;
for (const [role, url] of [
  ["crew", "/main.html"],
  ["manager", "/main.html"],
  ["manager", "/schedule.html"],
  ["manager", "/shifts-admin.html"],
  ["manager", "/admin.html"],
  ["manager", "/break-rewards.html"],
  ["crew", "/verification.html"],
]) {
  test(`no endless decorative animation on ${role} ${url}`, async ({ page }) => {
    await hermetic(page);
    await openShell(page, withPreview(url, role));
    await page.waitForTimeout(400);
    const endless = await page.evaluate((loading) => {
      const pattern = new RegExp(loading, "i");
      const feature = '[class*="mca-"], [class*="tr-"], [class*="waste"], #mcaLauncher';
      return document
        .getAnimations()
        .filter((a) => a.effect?.getTiming().iterations === Infinity)
        .filter((a) => {
          const target = a.effect?.target;
          return target && document.getElementById("app")?.contains(target) && !target.closest(feature);
        })
        .map((a) => `${a.animationName || "?"} on ${a.effect.target.className}`)
        .filter((text) => !pattern.test(text));
    }, LOADING_ANIMATIONS.source);
    expect(endless).toEqual([]);
  });
}

test("sign-in ambient motion pauses while the tab is hidden", async ({ page }) => {
  await hermetic(page);
  await page.goto("/");
  const width = page.viewportSize().width;
  await expect(page.locator(".auth-layout")).toHaveAttribute("data-settled", "");
  const states = () =>
    page.evaluate(() =>
      document
        .getAnimations()
        .filter((a) => /drift|float/.test(a.animationName || ""))
        .map((a) => a.playState),
    );
  const running = await states();
  expect(running.length).toBeGreaterThanOrEqual(width > 760 ? 5 : 3);
  expect(new Set(running)).toEqual(new Set(["running"]));
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(async () => [...new Set(await states())]).toEqual(["paused"]);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(async () => [...new Set(await states())]).toEqual(["running"]);
});

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
