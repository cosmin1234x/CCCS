// Core pages: Home (both roles), notifications, schedule, shift planner, team,
// availability, McStars and station verification. Preview mode runs on the
// built-in sample restaurant; "signed in" runs against an in-page Firestore
// mock that records every write so we can check exactly what would be saved.
import { test, expect } from "@playwright/test";

// A fixed Thursday afternoon in Hayle keeps every date and "on shift now"
// assertion deterministic on every device.
const NOW = new Date("2026-09-24T15:00:00+01:00");
test.use({ timezoneId: "Europe/London", locale: "en-GB" });

test.beforeEach(async ({ page }) => {
  // WebKit on a busy Windows machine can be slow; these are long user journeys.
  test.setTimeout(90000);
  await page.clock.setFixedTime(NOW);
  page.on("dialog", (dialog) => {
    throw new Error("Unexpected browser dialog: " + dialog.message());
  });
});

const noOverflow = async (page) =>
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
  ).toBeTruthy();
const sheet = (page) => page.locator("#pgSheet");
async function expectToast(page, text) {
  await expect(page.getByText(text, { exact: false }).filter({ visible: true }).first()).toBeVisible();
}
const visibleShift = (page, text) =>
  page.locator("#content button.pg-shift").filter({ visible: true }).filter({ hasText: text });

// ------------------------------------------------------------ preview --
test.describe("preview mode", () => {
  test("crew home shows next shift, week, learning, McStars and quick actions", async ({ page }) => {
    let apiCalls = 0;
    page.on("request", (r) => {
      if (/\/api\//.test(r.url())) apiCalls++;
    });
    await page.goto("/main.html?preview=crew");
    await expect(page.getByRole("heading", { name: "Good afternoon, Cosmin." })).toBeVisible();
    const next = page.locator(".pg-next");
    await expect(next).toContainText("On shift now");
    await expect(next).toContainText("10:00–18:00");
    await expect(next).toContainText("Drive-thru");
    await expect(page.locator(".pg-kpi").first()).toContainText("31h");
    await expect(page.locator(".pg-kpis")).toContainText("£390.60");
    await expect(page.locator(".pg-kpis")).toContainText("McStars");
    await expect(page.locator(".pg-learn-card")).toContainText("modules complete");
    await expect(page.locator(".pg-alert")).toContainText("Grill sign-off");
    await expect(page.getByRole("link", { name: /My availability/ }).first()).toBeVisible();
    await noOverflow(page);
    expect(apiCalls).toBe(0);
  });

  test("manager home shows today at a glance, approvals and team learning", async ({ page }) => {
    await page.goto("/main.html?preview=manager");
    const glance = page.locator(".pg-glance");
    await expect(glance.locator(".pg-glance-col").first()).toContainText("Cosmin Blidaru");
    await expect(glance.locator(".pg-glance-col").first()).toContainText("Jordan Clarke");
    await expect(glance.locator(".pg-glance-col").nth(1)).toContainText("Ryan Davies");
    await expect(page.locator(".pg-kpi").nth(1)).toContainText("5");
    await expect(page.locator(".pg-timeline .pg-tl-row")).toHaveCount(5);
    await expect(page.getByText("Team average", { exact: false })).toBeVisible();
    const attention = page.locator(".pg-card", { hasText: "Needs your attention" });
    await attention.getByRole("button", { name: "Approve Tom Evans" }).click();
    await expectToast(page, "Tom is now a Crew Trainer.");
    await expect(attention.getByRole("button", { name: "Approve Tom Evans" })).toHaveCount(0);
    await expect(attention.getByRole("button", { name: "Approve Ellie Roberts" })).toBeVisible();
    await noOverflow(page);
  });

  test("notifications bell shows unread items and clears them", async ({ page }) => {
    await page.goto("/main.html?preview=crew");
    const bell = page.locator("#notifications");
    await expect(bell).toHaveAttribute("aria-label", /Notifications, \d+ new/);
    await expect(bell.locator(".pg-bell-dot")).toBeVisible();
    await bell.click();
    await expect(sheet(page)).toBeVisible();
    await expect(sheet(page).getByRole("heading", { name: "Notifications" })).toBeVisible();
    await expect(sheet(page)).toContainText("Sign your Grill verification");
    await expect(sheet(page)).toContainText("Coming up");
    await expect(sheet(page)).toContainText("McStars");
    await sheet(page).getByRole("button", { name: "Close" }).click();
    await expect(sheet(page)).toBeHidden();
    await expect(bell.locator(".pg-bell-dot")).toHaveCount(0);
    await expect(bell).toHaveAttribute("aria-label", "Notifications");
    await page.reload();
    await expect(page.locator("#notifications")).toHaveAttribute("aria-label", "Notifications");
    await page.locator("#notifications").click();
    await sheet(page).getByRole("link", { name: /Sign your Grill verification/ }).click();
    await expect(page).toHaveURL(/verification\.html\?id=pv-self-grill&preview=crew/);
  });

  test("schedule week navigation for crew and the team rota for managers", async ({ page, isMobile }) => {
    await page.goto("/schedule.html?preview=crew");
    const label = page.locator(".pg-weeknav-label");
    await expect(label).toContainText("21");
    await expect(label).toContainText("27");
    await expect(label).toContainText("This week");
    await expect(page.locator(".pg-agenda-shift")).toHaveCount(4);
    await expect(page.locator(".pg-kpis")).toContainText("31h");
    await page.getByRole("button", { name: "Next week" }).click();
    await expect(label).toContainText("Next week");
    await expect(label).toContainText("28");
    await expect(page).toHaveURL(/week=1/);
    await expect(page.locator(".pg-agenda-shift")).toHaveCount(2);
    await page.getByRole("button", { name: "Previous week" }).click();
    await page.getByRole("button", { name: "Previous week" }).click();
    await expect(label).toContainText("Last week");
    await expect(page.locator(".pg-agenda-shift")).toHaveCount(4);
    await page.getByRole("button", { name: "Today", exact: true }).click();
    await expect(label).toContainText("This week");
    await expect(page.getByRole("button", { name: "Print" })).toBeVisible();
    await noOverflow(page);

    await page.goto("/schedule.html?preview=manager");
    await expect(page.getByRole("heading", { name: "Team rota" })).toBeVisible();
    if (isMobile && (page.viewportSize()?.width || 0) <= 760) {
      await expect(page.locator(".pg-rota")).toBeHidden();
      await page.locator(".pg-daystrip button").filter({ hasText: "26" }).click();
    } else {
      await expect(page.locator(".pg-rota tbody tr")).toHaveCount(8);
      await page.locator(".pg-rota thead button").filter({ hasText: "26" }).click();
    }
    const detail = page.locator(".pg-day-detail");
    await expect(detail.getByRole("heading")).toContainText("Saturday 26");
    await expect(detail.locator(".pg-list-row")).toHaveCount(5);
    await page.getByRole("button", { name: "My shifts" }).click();
    await expect(page.getByRole("heading", { name: "Your shifts" })).toBeVisible();
    await page.getByRole("button", { name: "Team rota" }).click();
    await expect(page.getByRole("heading", { name: "Team rota" })).toBeVisible();
    await noOverflow(page);
  });

  test("planner adds, validates, edits and deletes a shift", async ({ page }) => {
    await page.goto("/shifts-admin.html?preview=manager");
    await page.getByRole("button", { name: "Next week" }).click();
    await expect(page.locator(".pg-weeknav-label")).toContainText("Next week");
    await page.locator(".pg-head-actions").getByRole("button", { name: "Add shift" }).click();
    const form = sheet(page);
    await expect(form.getByRole("heading", { name: "Add a shift" })).toBeVisible();
    await form.getByLabel("Team member").selectOption("preview-ryan");
    await form.getByLabel("Date").fill("2026-09-28");
    const checks = form.locator("#pgShiftChecks");
    const submit = form.locator("#pgShiftSubmit");
    await form.getByLabel("Starts").fill("17:00");
    await form.getByLabel("Finishes").fill("17:00");
    await expect(checks).toContainText("Start and finish times must be different.");
    await expect(submit).toBeDisabled();
    await form.getByLabel("Starts").fill("09:00");
    await form.getByLabel("Finishes").fill("23:30");
    await expect(checks).toContainText("12 hours at most");
    await form.getByLabel("Finishes").fill("17:00");
    await expect(checks).toContainText("Outside Ryan's availability");
    await expect(submit).toHaveText("Publish anyway");
    await form.getByRole("button", { name: "17:00–01:00" }).click();
    await expect(checks).toContainText("Outside Ryan's availability");
    await form.getByRole("button", { name: "Match availability" }).click();
    await expect(form.getByLabel("Starts")).toHaveValue("17:00");
    await form.getByLabel("Finishes").fill("23:00");
    await expect(checks).toContainText("No clashes");
    await expect(submit).toHaveText("Publish shift");
    await submit.click();
    await expect(form).toBeHidden();
    await expectToast(page, "Added Ryan");
    await expect(visibleShift(page, "17:00–23:00")).toHaveCount(1);

    await visibleShift(page, "17:00–23:00").click();
    await expect(form.getByRole("heading", { name: "Edit shift" })).toBeVisible();
    await form.getByLabel("Finishes").fill("22:00");
    await form.getByRole("button", { name: "Save changes" }).click();
    await expectToast(page, "Updated Ryan");
    await expect(form).toBeHidden();
    await expect(visibleShift(page, "17:00–22:00")).toHaveCount(1);

    await visibleShift(page, "17:00–22:00").click();
    await form.getByRole("button", { name: "Delete shift", exact: true }).click();
    await expect(form.getByText("from the rota?")).toBeVisible();
    await form.getByRole("button", { name: "Keep shift" }).click();
    await expect(form.getByRole("button", { name: "Save changes" })).toBeVisible();
    await form.getByRole("button", { name: "Delete shift", exact: true }).click();
    await form.getByRole("button", { name: "Yes, delete shift" }).click();
    await expectToast(page, "Removed Ryan");
    await expect(form).toBeHidden();
    await expect(visibleShift(page, "17:00–22:00")).toHaveCount(0);

    // Overlap, including an overnight shift that runs into the next day.
    await page.locator(".pg-head-actions").getByRole("button", { name: "Add shift" }).click();
    await form.getByLabel("Team member").selectOption("preview-self");
    await form.getByLabel("Date").fill("2026-09-29");
    await form.getByLabel("Starts").fill("00:30");
    await form.getByLabel("Finishes").fill("06:00");
    await expect(checks).toContainText("already works");
    await expect(form.locator("#pgShiftSubmit")).toBeDisabled();
    await form.getByLabel("Starts").fill("09:00");
    await form.getByLabel("Finishes").fill("15:00");
    await expect(checks).toContainText("rest");
    await page.keyboard.press("Escape");
    await expect(form).toBeHidden();
    await noOverflow(page);
  });

  test("planner copies last week, skipping clashes, with a summary", async ({ page }) => {
    await page.goto("/shifts-admin.html?preview=manager&week=1");
    await expect(page.locator(".pg-weeknav-label")).toContainText("Next week");
    const before = Number(
      (await page.locator(".pg-planner-stats span").first().innerText()).match(/\d+/)[0],
    );
    await page.getByRole("button", { name: "Copy last week" }).click();
    const dialog = sheet(page);
    await expect(dialog.getByRole("heading", { name: "Copy last week" })).toBeVisible();
    const toCopy = Number(await dialog.locator(".pg-copy-sum .ok b").innerText());
    const skipped = Number(await dialog.locator(".pg-copy-sum .skip b").innerText());
    expect(toCopy).toBeGreaterThan(5);
    expect(skipped).toBeGreaterThan(0);
    await expect(dialog.locator(".pg-copy-details").last()).toContainText("already has a shift then");
    await dialog.getByRole("button", { name: `Copy ${toCopy} shifts` }).click();
    await expect(dialog).toBeHidden();
    await expectToast(page, `Copied ${toCopy} shifts · ${skipped} skipped.`);
    await expect(page.locator(".pg-planner-stats span").first()).toContainText(String(before + toCopy));
    await page.getByRole("button", { name: "Copy last week" }).click();
    await expect(dialog.getByRole("button", { name: "Nothing to copy" })).toBeDisabled();
  });

  test("team search, filters and the member drawer edits", async ({ page }) => {
    await page.goto("/admin.html?preview=manager");
    const cards = page.locator("#teamGrid > li").filter({ visible: true });
    await expect(cards).toHaveCount(8);
    await page.getByRole("searchbox", { name: "Search team" }).fill("maya");
    await expect(cards).toHaveCount(1);
    await page.getByRole("searchbox", { name: "Search team" }).fill("");
    await page.getByRole("combobox", { name: "Filter by role" }).selectOption("crewTrainer");
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toContainText("Amelia Wilson");
    await page.getByRole("combobox", { name: "Filter by role" }).selectOption("");
    await page.getByRole("button", { name: "Open Maya Patel" }).click();
    const drawer = sheet(page);
    await expect(drawer.getByRole("heading", { name: "Maya Patel" })).toBeVisible();
    await expect(drawer).toContainText("Station sign-offs");
    const save = drawer.getByRole("button", { name: "Save changes" });
    await expect(save).toBeDisabled();
    await drawer.getByLabel("Hourly rate (£)").fill("500");
    await save.click();
    await expect(drawer.locator("#pgMemberStatus")).toContainText("between £0.01 and £100");
    await drawer.getByLabel("Hourly rate (£)").fill("13.10");
    await drawer.getByLabel("Badge").fill("Drinks star");
    await drawer.getByLabel("Manager notes").fill("Ready for McCafé sign-off.");
    await save.click();
    await expectToast(page, "Saved Maya’s details.");
    await expect(drawer.getByLabel("Badge")).toHaveValue("Drinks star");
    await drawer.getByRole("radio", { name: "+3 ★" }).check();
    await drawer.getByLabel("What did they do well?").fill("Brilliant lunch rush on drinks");
    await drawer.getByRole("button", { name: "Give McStars" }).click();
    await expectToast(page, "+3 McStars for Maya.");
    await expect(drawer.locator(".pg-drawer-stats")).toContainText("12");
    await expect(drawer).toContainText("Brilliant lunch rush on drinks");
    await drawer.getByRole("button", { name: "Close" }).click();
    await expect(drawer).toBeHidden();
    await expect(page.getByRole("button", { name: "Open Maya Patel" })).toContainText("★ 12");
    await page.getByRole("button", { name: "Reject Ellie Roberts" }).click();
    await expectToast(page, "Ellie’s request was declined.");
    await page.goto("/break-rewards.html?preview=manager");
    await expect(page.locator(".pg-board")).toContainText("Maya Patel");
    await expect(page.locator(".pg-board li", { hasText: "Maya Patel" })).toContainText("12");
    await noOverflow(page);
  });

  test("availability presets, validation, unsaved hint and save", async ({ page }) => {
    await page.goto("/main.html?view=availability&preview=crew");
    const bar = page.locator("#availSavebar");
    await expect(bar).not.toHaveClass(/is-dirty/);
    await page.getByRole("button", { name: "Weekdays 9–5" }).click();
    await expect(bar).toHaveClass(/is-dirty/);
    await expect(bar).toContainText("You have unsaved changes");
    await expect(page.getByLabel("Available on Saturday")).not.toBeChecked();
    await expect(page.getByLabel("Monday start time")).toHaveValue("09:00");
    await expect(page.locator("#availSummary")).toContainText("5 days");
    await page.getByLabel("Available on Saturday").check();
    await page.getByLabel("Saturday start time").fill("10:00");
    await page.getByLabel("Saturday finish time").fill("10:00");
    await expect(page.locator('[data-note="sat"]')).toContainText("must differ");
    await page.getByRole("button", { name: "Save availability" }).click();
    await expect(page.locator("#availabilityResult")).toContainText("must be different");
    await page.getByLabel("Saturday finish time").fill("02:00");
    await expect(page.locator('[data-note="sat"]')).toContainText("Overnight");
    await page.getByRole("button", { name: "Save availability" }).click();
    await expectToast(page, "Availability updated in this preview.");
    await expect(bar).not.toHaveClass(/is-dirty/);
    await page.reload();
    await expect(page.getByLabel("Monday start time")).toHaveValue("09:00");
    await expect(page.getByLabel("Available on Saturday")).toBeChecked();
    await expect(page.getByLabel("Saturday finish time")).toHaveValue("02:00");
    await page.getByRole("button", { name: "Clear all" }).click();
    await page.getByRole("button", { name: "Discard" }).click();
    await expect(page.getByLabel("Available on Monday")).toBeChecked();
    await noOverflow(page);
  });

  test("verification signature pad works with a finger or Apple Pencil", async ({ page }) => {
    await page.goto("/verification.html?id=pv-self-grill&preview=crew");
    const canvas = page.locator("#v2SignatureCanvas");
    await expect(canvas).toBeVisible();
    expect(await canvas.evaluate((c) => getComputedStyle(c).touchAction)).toBe("none");
    const submit = page.getByRole("button", { name: "Sign verification" });
    await expect(submit).toBeDisabled();
    // Draw with pen pointer events (Apple Pencil) including pressure.
    await canvas.evaluate((c) => {
      const r = c.getBoundingClientRect();
      const fire = (type, x, y) =>
        c.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            pointerId: 7,
            pointerType: "pen",
            pressure: 0.6,
            clientX: r.left + x,
            clientY: r.top + y,
            button: 0,
            buttons: 1,
          }),
        );
      fire("pointerdown", 30, 90);
      for (let i = 1; i <= 20; i++) fire("pointermove", 30 + i * 12, 90 + Math.sin(i / 2) * 30);
      fire("pointerup", 270, 90);
    });
    const inked = () =>
      canvas.evaluate((c) => {
        const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
        let n = 0;
        for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
        return n;
      });
    expect(await inked()).toBeGreaterThan(50);
    // Rotating the iPad resizes the pad; the signature must survive.
    const size = page.viewportSize();
    await page.setViewportSize({ width: size.height, height: size.width });
    await expect.poll(inked).toBeGreaterThan(50);
    await page.setViewportSize(size);
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(submit).toBeDisabled();
    // And with a finger/mouse.
    await canvas.scrollIntoViewIfNeeded();
    const box = await canvas.boundingBox();
    await page.mouse.move(box.x + 30, box.y + 60);
    await page.mouse.down();
    await page.mouse.move(box.x + 120, box.y + 110, { steps: 8 });
    await page.mouse.move(box.x + 220, box.y + 70, { steps: 8 });
    await page.mouse.up();
    await page.getByLabel("Type your full name").fill("Cosmin Blidaru");
    await expect(submit).toBeEnabled();
    await submit.click();
    await expectToast(page, "Cosmin Blidaru is now verified on Grill.");
    await expect(page.locator(".vf-hero")).toContainText("Verified");
    await expect(page.locator(".vf-steps li.done")).toHaveCount(3);
    await expect(page.locator(".vf-signature")).toHaveCount(1);
    await page.getByRole("link", { name: "All sign-offs" }).click();
    await expect(page.locator(".vf-stations .vf-station.done")).toHaveCount(4);
    await noOverflow(page);
  });

  test("my pages settle without a self-triggering render loop", async ({ page }) => {
    for (const url of [
      "/main.html?preview=manager",
      "/shifts-admin.html?preview=manager",
      "/admin.html?preview=manager",
    ]) {
      await page.goto(url);
      await expect(page.locator(".pg-page")).toBeVisible();
      await page.waitForTimeout(400);
      const mutations = await page.evaluate(
        () =>
          new Promise((resolve) => {
            let count = 0;
            const observer = new MutationObserver((records) => (count += records.length));
            observer.observe(document.getElementById("content"), { childList: true, subtree: true });
            setTimeout(() => {
              observer.disconnect();
              resolve(count);
            }, 400);
          }),
      );
      expect(mutations).toBe(0);
    }
  });
});

// ---------------------------------------------------- signed in (mock) --
const STORE = "qa-store";
const people = {
  "qa-manager": {
    name: "Morgan Reed",
    email: "morgan@example.invalid",
    role: "manager",
    storeId: STORE,
    storeName: "QA · Hayle",
    hourlyRate: 15,
    stars: 4,
    availability: { mon: { available: true, start: "08:00", end: "18:00" } },
  },
  "qa-crew": {
    name: "Sam Carter",
    email: "sam@example.invalid",
    role: "crew",
    storeId: STORE,
    hourlyRate: 12.21,
    stars: 3,
    verifiedStations: ["Fries"],
    availability: {
      mon: { available: true, start: "09:00", end: "22:00" },
      tue: { available: true, start: "09:00", end: "22:00" },
      wed: { available: false, start: "", end: "" },
    },
  },
  "qa-trainer": {
    name: "Taylor Brooks",
    email: "taylor@example.invalid",
    role: "crewTrainer",
    storeId: STORE,
    stars: 6,
    verifiedStations: ["Fries", "Grill"],
    availability: {},
  },
};
const seedShifts = {
  "sh-1": { userId: "qa-crew", userName: "Sam Carter", role: "crew", date: "2026-09-22", start: "09:00", end: "17:00", station: "Fries", breakMinutes: 30 },
  "sh-2": { userId: "qa-manager", userName: "Morgan Reed", role: "manager", date: "2026-09-24", start: "12:00", end: "20:00", station: "Shift Lead", breakMinutes: 30 },
  "sh-3": { userId: "qa-crew", userName: "Sam Carter", role: "crew", date: "2026-09-21", start: "16:00", end: "22:00", station: "Fries", breakMinutes: 20 },
};

async function signedIn(page, uid, { deny = [] } = {}) {
  const docs = {};
  for (const [id, p] of Object.entries(people)) docs["users/" + id] = p;
  for (const [id, s] of Object.entries(seedShifts)) docs[`stores/${STORE}/Shifts/${id}`] = s;
  docs[`users/${uid}/portalTraining/first-shift`] = { completed: true };
  await page.addInitScript(
    ({ uid, docs, deny }) => {
      window.__qa = {
        uid,
        docs,
        deny,
        writes: [],
        listeners: [],
        seq: 0,
        notify() {
          setTimeout(() => this.listeners.slice().forEach((l) => l()), 10);
        },
      };
    },
    { uid, docs, deny },
  );
  await page.route("**/firebase-init.js", (r) =>
    r.fulfill({
      contentType: "text/javascript",
      body: `export const db={};export const auth={currentUser:{uid:${JSON.stringify(uid)},email:'qa@example.invalid',getIdToken:async()=>'test-token'}};`,
    }),
  );
  await page.route("https://www.gstatic.com/firebasejs/**/firebase-auth.js", (r) =>
    r.fulfill({
      contentType: "text/javascript",
      body: `export const onAuthStateChanged=(auth,cb)=>{queueMicrotask(()=>cb(auth.currentUser));return()=>{};};export const signOut=async()=>{};export const createUserWithEmailAndPassword=async()=>{};export const signInWithEmailAndPassword=async()=>{};export const updateProfile=async()=>{};export const sendPasswordResetEmail=async()=>{};export const getAuth=()=>({});`,
    }),
  );
  await page.route("https://www.gstatic.com/firebasejs/**/firebase-firestore.js", (r) =>
    r.fulfill({ contentType: "text/javascript", body: FIRESTORE_MOCK }),
  );
  const team = Object.entries(people).map(([id, p]) => ({
    id,
    ...p,
    roleLabel: { manager: "Manager", crew: "Crew Member", crewTrainer: "Crew Trainer" }[p.role],
    verifiedStations: p.verifiedStations || [],
  }));
  const me = team.find((p) => p.id === uid);
  const verification = {
    id: "ver-1",
    crewId: "qa-crew",
    crewName: "Sam Carter",
    trainerId: "qa-trainer",
    trainerName: "Taylor Brooks",
    station: "Grill",
    status: "pending_signatures",
    trainerSignature: { name: "Taylor Brooks", typedName: "Taylor Brooks", signatureData: null, signedAt: NOW.getTime() - 3600e3 },
    crewSignature: null,
    createdAt: NOW.getTime() - 7200e3,
  };
  const calls = [];
  await page.route("**/api/portal-data", async (r) => {
    if (r.request().method() === "POST") {
      calls.push(["portal-data", r.request().postDataJSON()]);
      return r.fulfill({ json: { ok: true, stars: 7, recognitionId: "rec-server" } });
    }
    return r.fulfill({
      json: {
        profile: me,
        permissions: {
          canPlanShifts: me.role === "manager",
          canVerify: me.role === "crewTrainer",
          canSeeTeam: me.role !== "crew",
        },
        shifts: [],
        team: me.role === "crew" ? [] : team,
        progress: { "first-shift": { completed: true } },
        teamProgress: me.role === "manager" ? { "qa-crew": ["first-shift", "food-safety"], "qa-trainer": ["first-shift"] } : {},
        verifications: me.role === "manager" || uid === "qa-crew" ? [verification] : [],
        roleRequests:
          me.role === "manager"
            ? [{ id: "qa-trainer", uid: "qa-trainer", name: "Taylor Brooks", requestedRole: "manager", status: "pending", storeId: STORE }]
            : [],
        recognition: [
          { id: "rec-1", userId: "qa-crew", userName: "Sam Carter", amount: 2, note: "Great close", createdByName: "Morgan Reed", createdAt: NOW.getTime() - 86400e3 },
        ].filter((x) => me.role === "manager" || x.userId === uid),
      },
    });
  });
  await page.route("**/api/role-request", (r) => {
    calls.push(["role-request", r.request().postDataJSON()]);
    return r.fulfill({ json: { ok: true, role: "manager" } });
  });
  await page.route("**/api/verification**", (r) => {
    if (r.request().method() === "GET") return r.fulfill({ json: { verification } });
    const body = r.request().postDataJSON();
    calls.push(["verification", body]);
    if (body.action === "create")
      return r.fulfill({
        status: 201,
        json: { verification: { ...verification, id: "ver-new", station: body.station, trainerSignature: null } },
      });
    return r.fulfill({
      json: {
        verification: { ...verification, status: "verified", crewSignature: { name: "Sam Carter", typedName: body.typedName, signatureData: body.signatureData, signedAt: NOW.getTime() } },
        reply: "Sam Carter is now verified on Grill.",
      },
    });
  });
  await page.route("**/api/ai-chat", (r) => r.fulfill({ json: { reply: "OK" } }));
  return calls;
}
const writes = (page) => page.evaluate(() => window.__qa.writes);

const FIRESTORE_MOCK = `
const qa = window.__qa;
const join = (base, parts) => (base && base.path ? [base.path, ...parts] : parts).join("/");
export const collection = (base, ...parts) => ({ path: join(base, parts), __col: true });
export const doc = (base, ...parts) => {
  if (base && base.__col && !parts.length) { const id = "auto-" + (++qa.seq); return { path: base.path + "/" + id, id }; }
  const path = join(base, parts);
  return { path, id: path.split("/").pop() };
};
export const where = (field, op, value) => ({ field, op, value });
export const query = (ref, ...filters) => ({ ...ref, filters });
export const serverTimestamp = () => ({ __ts: true });
export const increment = (n) => ({ __inc: n });
function list(ref) {
  const prefix = ref.path + "/";
  return Object.entries(qa.docs)
    .filter(([p]) => p.startsWith(prefix) && !p.slice(prefix.length).includes("/"))
    .filter(([, d]) => (ref.filters || []).every((f) => f.op === "==" ? d[f.field] === f.value : f.op === ">=" ? String(d[f.field]) >= String(f.value) : true))
    .map(([p, d]) => ({ id: p.split("/").pop(), data: () => ({ ...d }) }));
}
function apply(path, data, merge) {
  const next = merge ? { ...(qa.docs[path] || {}) } : {};
  for (const [k, v] of Object.entries(data)) {
    if (v && v.__inc !== undefined) next[k] = (Number(next[k]) || 0) + v.__inc;
    else if (v && v.__ts) next[k] = Date.now();
    else next[k] = v;
  }
  qa.docs[path] = next;
}
function guard(kind) {
  if (qa.deny.includes(kind)) { const e = new Error("Missing or insufficient permissions."); e.code = "permission-denied"; throw e; }
}
export const getDoc = async (ref) => { const d = qa.docs[ref.path]; return { id: ref.id, exists: () => Boolean(d), data: () => d && { ...d } }; };
export const getDocs = async (ref) => { const docs = list(ref); return { docs, forEach: (fn) => docs.forEach(fn) }; };
export const setDoc = async (ref, data, opts) => { guard("set"); qa.writes.push(["set", ref.path, data]); apply(ref.path, data, opts && opts.merge); qa.notify(); };
export const updateDoc = async (ref, data) => { guard("update"); qa.writes.push(["update", ref.path, data]); apply(ref.path, data, true); qa.notify(); };
export const addDoc = async (col, data) => { guard("add"); const ref = doc(col); qa.writes.push(["add", ref.path, data]); apply(ref.path, data, false); qa.notify(); return ref; };
export const deleteDoc = async (ref) => { guard("delete"); qa.writes.push(["delete", ref.path]); delete qa.docs[ref.path]; qa.notify(); };
export const writeBatch = () => {
  const ops = [];
  return {
    set(ref, data) { ops.push(["set", ref, data]); },
    update(ref, data) { ops.push(["update", ref, data]); },
    delete(ref) { ops.push(["delete", ref]); },
    async commit() {
      guard("batch");
      qa.writes.push(["batch", ops.map(([t, r, d]) => [t, r.path, d])]);
      for (const [t, r, d] of ops) { if (t === "delete") delete qa.docs[r.path]; else apply(r.path, d, t === "update"); }
      qa.notify();
    },
  };
};
export function onSnapshot(ref, next) {
  const run = () => {
    if (ref.__col || ref.filters) next({ docs: list(ref) });
    else { const d = qa.docs[ref.path]; next({ id: ref.id, exists: () => Boolean(d), data: () => d && { ...d } }); }
  };
  qa.listeners.push(run);
  setTimeout(run, 20);
  return () => { qa.listeners = qa.listeners.filter((x) => x !== run); };
}
export const getFirestore = () => ({});
`;

test.describe("signed in", () => {
  test("manager planner writes exactly the right Firestore documents", async ({ page }) => {
    await signedIn(page, "qa-manager");
    await page.goto("/shifts-admin.html?week=1");
    await expect(page.getByRole("heading", { name: "Shift planner" })).toBeVisible();
    await page.locator(".pg-head-actions").getByRole("button", { name: "Add shift" }).click();
    const form = sheet(page);
    await form.getByLabel("Team member").selectOption("qa-crew");
    await form.getByLabel("Date").fill("2026-09-29");
    await form.getByLabel("Starts").fill("16:30");
    await form.getByLabel("Finishes").fill("01:00");
    await form.getByLabel("Station").selectOption("Chicken & Fryer");
    await expect(form.locator("#pgShiftChecks")).toContainText("Outside Sam's availability");
    await expect(form.locator("#pgShiftChecks")).toContainText("not verified on Chicken & Fryer");
    await form.getByLabel("Finishes").fill("22:00");
    await form.locator("#pgShiftSubmit").click();
    await expectToast(page, "Published Sam");
    await expect(form).toBeHidden();
    let log = await writes(page);
    const add = log.find((w) => w[0] === "add");
    expect(add[1]).toMatch(/^stores\/qa-store\/Shifts\/auto-\d+$/);
    expect(add[2]).toMatchObject({
      userId: "qa-crew",
      userName: "Sam Carter",
      role: "crew",
      date: "2026-09-29",
      start: "16:30",
      end: "22:00",
      station: "Chicken & Fryer",
      breakMinutes: 30,
      createdBy: "qa-manager",
      createdAt: { __ts: true },
    });
    // The live snapshot shows it, then edit and delete it.
    await visibleShift(page, "16:30–22:00").click();
    await form.getByLabel("Unpaid break").selectOption("20");
    await form.getByRole("button", { name: "Save changes" }).click();
    await expectToast(page, "Updated Sam");
    await expect(form).toBeHidden();
    log = await writes(page);
    const update = log.find((w) => w[0] === "update");
    expect(update[1]).toBe(add[1]);
    expect(update[2]).toMatchObject({ breakMinutes: 20, updatedBy: "qa-manager" });
    await visibleShift(page, "16:30–22:00").click();
    await form.getByRole("button", { name: "Delete shift", exact: true }).click();
    await form.getByRole("button", { name: "Yes, delete shift" }).click();
    await expectToast(page, "Removed Sam");
    await expect(form).toBeHidden();
    log = await writes(page);
    expect(log.find((w) => w[0] === "delete")[1]).toBe(add[1]);
    await expect(visibleShift(page, "16:30–22:00")).toHaveCount(0);

    // Copy last week uses one batch and skips nothing that is valid.
    await page.getByRole("button", { name: "Copy last week" }).click();
    await expect(sheet(page).locator(".pg-copy-sum .ok b")).toHaveText("3");
    await sheet(page).getByRole("button", { name: "Copy 3 shifts" }).click();
    await expectToast(page, "Copied 3 shifts");
    log = await writes(page);
    const batch = log.find((w) => w[0] === "batch");
    expect(batch[1]).toHaveLength(3);
    expect(batch[1].map((op) => op[0])).toEqual(["set", "set", "set"]);
    expect(batch[1][2][2]).toMatchObject({ userId: "qa-manager", date: "2026-10-01", start: "12:00", end: "20:00", createdBy: "qa-manager" });
    expect(batch[1][0][2]).toMatchObject({ userId: "qa-crew", date: "2026-09-28", start: "16:00", end: "22:00", breakMinutes: 20 });
  });

  test("manager team drawer saves pay, badge, notes and McStars (with server fallback)", async ({ page }) => {
    const calls = await signedIn(page, "qa-manager", { deny: ["batch"] });
    await page.goto("/admin.html");
    await page.getByRole("button", { name: "Open Sam Carter" }).click();
    const drawer = sheet(page);
    await expect(drawer.getByRole("heading", { name: "Sam Carter" })).toBeVisible();
    await expect(drawer.locator(".pg-drawer-stats")).toContainText(/\d+%/);
    await drawer.getByLabel("Hourly rate (£)").fill("12.60");
    await drawer.getByLabel("Badge").fill("Closing hero");
    await drawer.getByRole("button", { name: "Save changes" }).click();
    await expectToast(page, "Saved Sam’s details.");
    const update = (await writes(page)).find((w) => w[0] === "update" && w[1] === "users/qa-crew");
    expect(update[2]).toMatchObject({ hourlyRate: 12.6, badge: "Closing hero", notes: "", updatedBy: "qa-manager" });
    await drawer.getByRole("radio", { name: "+2 ★" }).check();
    await drawer.getByLabel("What did they do well?").fill("Covered the late shift");
    await drawer.getByRole("button", { name: "Give McStars" }).click();
    await expectToast(page, "+2 McStars for Sam.");
    expect(calls).toContainEqual([
      "portal-data",
      { action: "giveStars", uid: "qa-crew", amount: 2, note: "Covered the late shift" },
    ]);
    // Role requests go to the server and never use alert().
    await drawer.getByRole("button", { name: "Close" }).click();
    await expect(drawer).toBeHidden();
    await page.getByRole("button", { name: "Approve Taylor Brooks" }).click();
    await expectToast(page, "Taylor is now a Manager.");
    expect(calls).toContainEqual(["role-request", { action: "approve", uid: "qa-trainer" }]);
  });

  test("McStars batch writes the star total and recognition together", async ({ page }) => {
    await signedIn(page, "qa-manager");
    await page.goto("/admin.html");
    await page.getByRole("button", { name: "Open Sam Carter" }).click();
    const drawer = sheet(page);
    await drawer.getByLabel("What did they do well?").fill("Spotless lobby");
    await drawer.getByRole("button", { name: "Give McStars" }).click();
    await expectToast(page, "+1 McStar for Sam.");
    const batch = (await writes(page)).find((w) => w[0] === "batch");
    expect(batch[1][0]).toEqual(["update", "users/qa-crew", { stars: { __inc: 1 }, updatedAt: { __ts: true }, updatedBy: "qa-manager" }]);
    expect(batch[1][1][1]).toMatch(/^stores\/qa-store\/recognition\/auto-\d+$/);
    expect(batch[1][1][2]).toMatchObject({ userId: "qa-crew", amount: 1, note: "Spotless lobby", createdBy: "qa-manager", createdByName: "Morgan Reed", source: "portal" });
  });

  test("crew availability saves to the profile and survives live updates", async ({ page }) => {
    await signedIn(page, "qa-crew");
    await page.goto("/main.html?view=availability");
    await expect(page.getByLabel("Monday start time")).toHaveValue("09:00");
    await expect(page.getByLabel("Available on Wednesday")).not.toBeChecked();
    await page.getByRole("button", { name: "Evenings 5–11" }).click();
    await page.evaluate(() => window.__qa.notify());
    await page.waitForTimeout(200);
    await expect(page.getByLabel("Monday start time")).toHaveValue("17:00");
    await expect(page.locator("#availSavebar")).toHaveClass(/is-dirty/);
    await page.getByRole("button", { name: "Save availability" }).click();
    await expectToast(page, "Availability saved");
    const update = (await writes(page)).find((w) => w[0] === "update");
    expect(update[1]).toBe("users/qa-crew");
    expect(update[2].availability.mon).toEqual({ available: true, start: "17:00", end: "23:00" });
    expect(update[2].availability.sun).toEqual({ available: true, start: "17:00", end: "23:00" });
    expect(Object.keys(update[2]).sort()).toEqual(["availability", "availabilityUpdatedAt"]);
  });

  test("availability falls back to the server when older rules refuse the write", async ({ page }) => {
    const calls = await signedIn(page, "qa-crew", { deny: ["update"] });
    await page.goto("/main.html?view=availability");
    await page.getByRole("button", { name: "Weekends" }).click();
    await page.getByRole("button", { name: "Save availability" }).click();
    await expectToast(page, "Availability saved");
    const post = calls.find((c) => c[0] === "portal-data")[1];
    expect(post.action).toBe("saveAvailability");
    expect(post.availability.sat).toEqual({ available: true, start: "09:00", end: "23:00" });
    expect(post.availability.mon).toEqual({ available: false, start: "", end: "" });
    await expect(page.locator("#availSavebar")).not.toHaveClass(/is-dirty/);
  });

  test("crew home, notifications and signing a verification", async ({ page }) => {
    const calls = await signedIn(page, "qa-crew");
    await page.goto("/main.html");
    await expect(page.getByRole("heading", { name: "Good afternoon, Sam." })).toBeVisible();
    await expect(page.locator(".pg-alert")).toContainText("Grill sign-off");
    await expect(page.locator("#notifications")).toHaveAttribute("aria-label", /new/);
    await page.locator("#notifications").click();
    await expect(sheet(page)).toContainText("Sign your Grill verification");
    await expect(sheet(page)).toContainText("+2 McStars from Morgan Reed");
    await sheet(page).getByRole("link", { name: /Sign your Grill verification/ }).click();
    await expect(page).toHaveURL(/verification\.html\?id=ver-1/);
    const canvas = page.locator("#v2SignatureCanvas");
    await expect(canvas).toBeVisible();
    await canvas.scrollIntoViewIfNeeded();
    const box = await canvas.boundingBox();
    await page.mouse.move(box.x + 40, box.y + 80);
    await page.mouse.down();
    await page.mouse.move(box.x + 200, box.y + 120, { steps: 10 });
    await page.mouse.up();
    await page.getByLabel("Type your full name").fill("Sam Carter");
    await page.getByRole("button", { name: "Sign verification" }).click();
    await expectToast(page, "Sam Carter is now verified on Grill.");
    const sign = calls.find((c) => c[0] === "verification")[1];
    expect(sign).toMatchObject({ action: "sign", id: "ver-1", typedName: "Sam Carter" });
    expect(sign.signatureData).toMatch(/^data:image\/png;base64,/);
    expect(sign.signatureData.length).toBeLessThan(140000);
    await expect(page.locator(".vf-hero")).toContainText("Verified");
  });

  test("crew trainer home and starting a station verification", async ({ page }) => {
    const calls = await signedIn(page, "qa-trainer");
    await page.goto("/main.html");
    await expect(page.getByRole("heading", { name: "Good afternoon, Taylor." })).toBeVisible();
    await expect(page.locator(".pg-role-badge")).toHaveText("Crew Trainer");
    await page.locator("#content").getByRole("link", { name: /Verify crew/ }).click();
    await expect(page.getByRole("heading", { name: "Train. Check. Sign off." })).toBeVisible();
    await page.getByLabel("Crew Member").selectOption("qa-crew");
    await page.getByLabel("Station").selectOption("Chicken & Fryer");
    await expect(page.locator("#v2VerifyHint")).toContainText("Sam Carter has 1 verified station");
    await page.getByRole("button", { name: "Open verification" }).click();
    await expect(page).toHaveURL(/verification\.html\?id=ver-new/);
    expect(calls).toContainEqual(["verification", { action: "create", crewId: "qa-crew", station: "Chicken & Fryer" }]);
    await noOverflow(page);
  });

  test("manager home reads live shifts and server extras", async ({ page }) => {
    await signedIn(page, "qa-manager");
    await page.goto("/main.html");
    await expect(page.locator(".pg-glance-col").first()).toContainText("Morgan Reed");
    await expect(page.getByText("You’re on shift now until 20:00", { exact: false })).toBeVisible();
    await expect(page.locator(".pg-card", { hasText: "Needs your attention" })).toContainText("Taylor Brooks");
    await expect(page.locator(".pg-card", { hasText: "Needs your attention" })).toContainText("Sam Carter · Grill");
    await page.evaluate(() => {
      window.__qa.docs["stores/qa-store/Shifts/live-1"] = { userId: "qa-crew", userName: "Sam Carter", date: "2026-09-24", start: "14:00", end: "22:00", station: "Fries", breakMinutes: 30 };
      window.__qa.notify();
    });
    await expect(page.locator(".pg-glance-col").first()).toContainText("Sam Carter");
    await noOverflow(page);
  });
});
