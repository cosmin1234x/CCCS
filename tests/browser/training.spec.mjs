import { test, expect } from "@playwright/test";

// Learning hub, lesson player and team learning. Firebase and /api/* are
// mocked in the page, so nothing here touches a real database.

const day = (offset) => {
  const d = new Date(Date.now() + offset * 864e5);
  return (
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0")
  );
};
const now = Date.now();
const completed = (ids, gapDays = 1) =>
  Object.fromEntries(
    ids.map((id, i) => [
      id,
      { completed: true, completedAt: now - i * gapDays * 864e5, score: 100 },
    ]),
  );

const CREW = {
  id: "qa-crew",
  name: "Alex QA",
  role: "crew",
  storeId: "qa-store",
  storeName: "QA · Store",
  verifiedStations: [],
};
const MANAGER = { ...CREW, name: "Morgan Lead", role: "manager" };

const TEAM = {
  store: { id: "qa-store", name: "QA · Store" },
  generatedAt: now,
  members: [
    { id: "qa-crew", name: "Morgan Lead", role: "manager", roleLabel: "Manager", verifiedStations: [], progress: {}, you: true },
    { id: "crew-1", name: "Amelia Wilson", role: "crew", roleLabel: "Crew Member", verifiedStations: ["Fries"], progress: completed(["first-shift", "food-safety", "allergens", "fries-station"]) },
    { id: "crew-2", name: "Ryan Davies", role: "crew", roleLabel: "Crew Member", verifiedStations: [], progress: completed(["first-shift"]) },
    { id: "crew-3", name: "Maya Patel", role: "crewTrainer", roleLabel: "Crew Trainer", verifiedStations: [], progress: completed(["first-shift", "food-safety", "allergens", "trainer-coaching"]) },
    { id: "crew-4", name: "Tom Evans", role: "crew", roleLabel: "Crew Member", verifiedStations: [], progress: {}, progressAvailable: false },
  ],
};

async function fixture(
  page,
  { profile = CREW, progress = { "first-shift": { completed: true } }, shifts = [], team = TEAM } = {},
) {
  await page.addInitScript(
    ({ profile, progress, shifts }) => {
      window.__qa = {
        profile,
        progress,
        shifts,
        writes: [],
        callbacks: [],
        emit(kind) {
          this.callbacks.filter((c) => c.kind === kind).forEach((c) => c.run());
        },
      };
    },
    { profile, progress, shifts },
  );
  await page.route("**/firebase-init.js", (r) =>
    r.fulfill({
      contentType: "text/javascript",
      body: `export const db={};export const auth={currentUser:{uid:'qa-crew',email:'qa@example.invalid',getIdToken:async()=>'test-token'}};`,
    }),
  );
  await page.route("https://www.gstatic.com/firebasejs/**/firebase-auth.js", (r) =>
    r.fulfill({
      contentType: "text/javascript",
      body: `export const onAuthStateChanged=(auth,cb)=>{queueMicrotask(()=>cb(auth.currentUser));return ()=>{};};export const signOut=async()=>{};export const createUserWithEmailAndPassword=async()=>{};export const signInWithEmailAndPassword=async()=>{};export const updateProfile=async()=>{};export const sendPasswordResetEmail=async()=>{};`,
    }),
  );
  await page.route("https://www.gstatic.com/firebasejs/**/firebase-firestore.js", (r) =>
    r.fulfill({
      contentType: "text/javascript",
      body: `const qa=window.__qa;export const doc=(db,...path)=>({path:path.join('/')});export const collection=doc;export const where=()=>({});export const query=(ref)=>ref;export const orderBy=()=>({});export const limit=()=>({});export const increment=(n)=>n;export const writeBatch=()=>({set(){},update(){},delete(){},commit:async()=>{}});export const serverTimestamp=()=>0;export const setDoc=async(ref,data,options)=>{qa.writes.push({path:ref.path,data,options});};export const updateDoc=async()=>{};export const addDoc=async()=>({id:'test'});export const deleteDoc=async()=>{};export const getDoc=async()=>({exists:()=>true,data:()=>qa.profile});export const getDocs=async()=>({docs:[],forEach:()=>{}});export function onSnapshot(ref,callback){const kind=ref.path.includes('portalTraining')?'progress':ref.path==='users'?'team':'shifts';const run=()=>callback({docs:kind==='progress'?Object.entries(qa.progress).map(([id,value])=>({id,data:()=>value})):kind==='shifts'?qa.shifts.map((s)=>({id:s.id,data:()=>s})):[]});qa.callbacks.push({kind,run});setTimeout(run,100);return ()=>{};}`,
    }),
  );
  await page.route("**/api/portal-data", (r) =>
    r.fulfill({
      json: { profile, progress, shifts, team: [], verifications: [], roleRequests: [], permissions: {} },
    }),
  );
  await page.route("**/api/training-progress", (r) => r.fulfill({ json: team }));
  await page.route("**/api/ai-chat", (r) => r.fulfill({ json: { reply: "ok" } }));
}

const noOverflow = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

const answersFor = (page, id, correct) =>
  page.evaluate(
    ({ id, correct }) =>
      window.McModules.modules
        .find((m) => m.id === id)
        .quiz.map((q) => q.a[correct ? q.correct : (q.correct + 1) % q.a.length]),
    { id, correct },
  );

// Phones have a fixed tab bar along the bottom. Centre controls before
// tapping them so the bar never sits on top of the target.
async function centre(locator) {
  await locator.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
}
async function press(locator) {
  await centre(locator);
  await locator.click();
}
async function tick(locator) {
  await centre(locator);
  await locator.check();
}

// Jumps straight to the confidence check with the step bar, ticks every
// statement and opens the quiz.
async function walkToQuiz(page) {
  await press(page.getByRole("button", { name: /^Step \d+: Confidence check/ }));
  const boxes = page.locator("#trStage").getByRole("checkbox");
  for (let i = 0; i < (await boxes.count()); i++) await tick(boxes.nth(i));
  await press(page.getByRole("button", { name: /^Start the quiz/ }));
}

async function answerAll(page, answers) {
  for (const [i, answer] of answers.entries()) {
    await tick(page.getByRole("radio", { name: answer, exact: true }));
    await press(page.getByRole("button", { name: "Check answer" }));
    await press(
      page.getByRole("button", { name: i + 1 < answers.length ? /^Next question/ : /^See my result/ }),
    );
  }
}

test("hub filters, chips and badges survive live progress updates", async ({ page }) => {
  test.slow(); // Long flows on emulated WebKit devices.
  await fixture(page);
  await page.goto("/training.html");
  await expect(page.getByRole("heading", { name: "Your learning", exact: true })).toBeVisible();
  await expect(page.locator(".tr-module")).toHaveCount(6);
  await page.getByRole("searchbox", { name: "Search modules" }).fill("fries");
  await expect(page.locator(".tr-module")).toHaveCount(1);
  await page.evaluate(() => {
    window.__qa.progress["fries-station"] = { completed: true, score: 100, completedAt: Date.now() };
    window.__qa.emit("progress");
    window.__qa.emit("shifts");
  });
  await expect(page.getByRole("searchbox", { name: "Search modules" })).toHaveValue("fries");
  await expect(page.locator(".tr-module")).toContainText("Completed");
  await expect(page.locator("#trCompletedCount")).toHaveText("2 of 21 modules");
  await expect(page.locator(".tr-recent")).toContainText("Fries Station");
  // Completions without a quiz score (older records) never show "0%".
  await page.getByRole("searchbox", { name: "Search modules" }).fill("first shift");
  await expect(page.locator(".tr-module")).toContainText("Completed");
  await expect(page.locator(".tr-module")).not.toContainText("%");

  // Category chips and the Category select stay in sync.
  await page.getByRole("searchbox", { name: "Search modules" }).fill("");
  await page.getByRole("button", { name: /^Safety, 0 of 3 complete/ }).click();
  await expect(page.getByRole("combobox", { name: "Category" })).toHaveValue("Safety");
  await expect(page.locator(".tr-module")).toHaveCount(3);
  await page.getByRole("combobox", { name: "Category" }).selectOption("Kitchen");
  await expect(page.getByRole("button", { name: /^Kitchen, 1 of 5 complete/ })).toHaveAttribute("aria-pressed", "true");

  // A badge on the shelf opens its category.
  await page.getByRole("button", { name: /^Service Star badge/ }).click();
  await expect(page.getByRole("combobox", { name: "Category" })).toHaveValue("Service");
  expect(await noOverflow(page)).toBeTruthy();
});

test("up next puts priority modules first, then the next shift's station", async ({ page }) => {
  await fixture(page, {
    progress: completed(["first-shift", "food-safety", "allergens"]),
    shifts: [
      { id: "s1", userId: "qa-crew", userName: "Alex QA", date: day(1), start: "16:00", end: "23:00", station: "Drive-thru", breakMinutes: 30 },
    ],
  });
  await page.goto("/training.html");
  await expect(page.getByRole("heading", { name: "Ready for your next shift" })).toBeVisible();
  const start = page.getByRole("link", { name: /Start learning/ });
  await expect(start).toHaveAttribute("href", "/module.html?id=drive-thru");
  await expect(page.locator("#learningNext")).toContainText("Drive-thru");
  // Level and XP come from completed modules (80 + 120 + 130 XP).
  await expect(page.locator("#trXp")).toHaveText("330 XP");
});

// Runs with reduced motion: covers that path (no confetti, no transitions)
// and keeps this long flow quick on emulated WebKit.
test.describe("with reduced motion", () => {
  test.use({ reducedMotion: "reduce" });
  test("module quiz gives instant feedback, fails, retries and saves a pass", async ({ page }) => {
    test.setTimeout(150000); // About 40 steps on emulated WebKit devices.
    await fixture(page);
    await page.goto("/module.html?id=food-safety");
    await expect(page.getByRole("heading", { name: "Food Safety & Hygiene", exact: true })).toBeVisible();
    await expect(page.locator("#trStepLabel")).toHaveText("Lesson 1 of 6");
    await expect(page.locator(".tr-takeaway")).toContainText("Key takeaway");

    // The quiz stays locked until every confidence statement is ticked.
    const confidence = page.getByRole("button", { name: /^Confidence check/ });
    for (let i = 0; i < 8 && !(await confidence.isVisible()); i++)
      await press(page.getByRole("button", { name: /^Next lesson/ }));
    await press(confidence);
    await press(page.getByRole("button", { name: /^Start the quiz/ }));
    await expect(page.locator("#trCheckWarning")).toBeVisible();
    const boxes = page.locator("#trStage").getByRole("checkbox");
    for (let i = 0; i < (await boxes.count()); i++) await tick(boxes.nth(i));
    await press(page.getByRole("button", { name: /^Start the quiz/ }));

    // Instant, explained feedback for a wrong answer.
    const wrong = await answersFor(page, "food-safety", false);
    await tick(page.getByRole("radio", { name: wrong[0], exact: true }));
    await press(page.getByRole("button", { name: "Check answer" }));
    await expect(page.locator(".tr-feedback")).toContainText("Not quite.");
    await expect(page.locator(".tr-feedback")).toContainText("Pausing to ask");
    await expect(page.getByRole("radio", { name: wrong[0], exact: true })).toBeDisabled();
    await press(page.getByRole("button", { name: /^Next question/ }));
    await answerAll(page, wrong.slice(1));
    await expect(page.getByRole("heading", { name: "Almost there" })).toBeVisible();
    expect(await page.evaluate(() => window.__qa.writes.length)).toBe(0);

    // Retry and pass.
    await press(page.getByRole("button", { name: /^Try again/ }));
    await answerAll(page, await answersFor(page, "food-safety", true));
    await expect(page.getByRole("heading", { name: "Module complete!" })).toBeVisible();
    await expect(page.locator("#trSaveStatus")).toContainText("Saved to your learning record.");
    const writes = await page.evaluate(() => window.__qa.writes);
    expect(writes).toHaveLength(1);
    expect(writes[0].path).toBe("users/qa-crew/portalTraining/food-safety");
    expect(writes[0].data).toMatchObject({ completed: true, xp: 120, score: 100, attempts: 2 });
    expect(typeof writes[0].data.completedAt).toBe("number");
    await expect(page.locator(".tr-rewards")).toContainText("+120 XP");
    await expect(page.locator("#trLessonStatus")).toContainText("Completed");
    await expect(page.getByRole("link", { name: "Next module", exact: true })).toHaveAttribute("href", /module\.html\?id=allergens/);
    expect(await noOverflow(page)).toBeTruthy();
    // Reduced motion: no confetti layer is ever added.
    await expect(page.locator(".tr-confetti")).toHaveCount(0);
  });
});

test("lesson position is remembered and shown as Continue learning", async ({ page }) => {
  test.slow(); // Long flows on emulated WebKit devices.
  await fixture(page);
  await page.goto("/module.html?id=allergens");
  await press(page.getByRole("button", { name: /^Next lesson/ }));
  await press(page.getByRole("button", { name: /^Next lesson/ }));
  await expect(page.locator("#trStepLabel")).toHaveText("Lesson 3 of 6");
  await page.reload();
  await expect(page.locator("#trStepLabel")).toHaveText("Lesson 3 of 6");
  await expect(page.locator(".tr-resume")).toContainText("Welcome back");
  await page.goto("/training.html");
  const resume = page.getByRole("link", { name: /Continue learning/ });
  await expect(resume).toHaveAttribute("href", "/module.html?id=allergens");
  await expect(page.locator("#learningNext")).toContainText("Pick up at step 3");
});

test("preview completion persists in this tab and never writes to Firebase", async ({ page }) => {
  // Full motion on purpose (celebration path); emulated WebKit renders it slowly.
  test.setTimeout(180000);
  await fixture(page);
  let apiCalls = 0;
  page.on("request", (r) => {
    if (r.url().includes("/api/")) apiCalls++;
  });
  await page.goto("/module.html?id=grill-station&preview=crew");
  await expect(page.getByRole("heading", { name: "Grill & Beef Station", exact: true })).toBeVisible();
  await walkToQuiz(page);
  await answerAll(page, await answersFor(page, "grill-station", true));
  await expect(page.locator("#trSaveStatus")).toContainText("Saved in this preview tab.");
  await press(page.getByRole("link", { name: "Back to my learning" }));
  await expect(page).toHaveURL(/training\.html\?preview=crew/);
  await page.getByRole("searchbox", { name: "Search modules" }).fill("grill");
  await expect(page.locator(".tr-module")).toContainText("Completed");
  await page.reload();
  await page.getByRole("button", { name: "Completed", exact: true }).click();
  await expect(page.locator("#trGrid")).toContainText("Grill & Beef Station");
  expect(await page.evaluate(() => window.__qa.writes.length)).toBe(0);
  expect(apiCalls).toBe(0);
});

test("managers see team progress, filter it and nudge through McAssist", async ({ page }) => {
  test.slow(); // Long flows on emulated WebKit devices.
  await fixture(page, {
    profile: MANAGER,
    shifts: [
      { id: "s2", userId: "crew-1", userName: "Amelia Wilson", date: day(1), start: "10:00", end: "18:00", station: "Drive-thru", breakMinutes: 30 },
    ],
  });
  await page.goto("/training.html");
  await page.getByRole("tab", { name: /Team progress/ }).click();
  await expect(page).toHaveURL(/#team$/);
  const panel = page.getByRole("tabpanel", { name: /Team progress/ });
  await expect(panel.getByRole("heading", { name: "Team progress" })).toBeVisible();
  await expect(panel.locator(".tr-kpis")).toContainText("Priority modules done");
  await expect(panel.locator(".tr-priority-block")).toContainText("Still to do");

  const ryan = panel.locator(".tr-person", { hasText: "Ryan Davies" });
  await expect(ryan).toContainText("Food Safety to do");
  await expect(ryan).toContainText("Allergens to do");
  // Amelia has done her priority modules but not Drive-thru before tomorrow.
  const amelia = panel.locator(".tr-person", { hasText: "Amelia Wilson" });
  await expect(amelia).toContainText("Drive-thru Order Taking before tomorrow’s shift");

  // Someone whose progress couldn't be read is shown honestly, not as 0%.
  const tom = panel.locator(".tr-person", { hasText: "Tom Evans" });
  await expect(tom).toContainText("Progress couldn’t load");
  await expect(tom.getByRole("button")).toHaveCount(0);

  await panel.getByRole("button", { name: /Needs attention/ }).click();
  await expect(panel.locator(".tr-person", { hasText: "Maya Patel" })).toHaveCount(0);
  await expect(panel.locator(".tr-person", { hasText: "Tom Evans" })).toHaveCount(0);
  await panel.getByRole("searchbox", { name: "Search team" }).fill("ryan");
  await expect(panel.locator(".tr-person")).toHaveCount(1);

  await panel.getByRole("button", { name: "Nudge Ryan Davies" }).click();
  const dialog = page.getByRole("dialog", { name: "Nudge Ryan" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "Message" })).toHaveValue(/Hi Ryan, Morgan here\..*Food Safety & Hygiene/);
  const ask = dialog.getByRole("link", { name: /Ask McAssist/ });
  await expect(ask).toHaveAttribute("href", /^\/main\.html\?view=assistant&prompt=Draft/);
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden();

  await panel.getByRole("searchbox", { name: "Search team" }).fill("");
  await panel.getByRole("button", { name: /Needs attention/ }).click();
  await panel.getByRole("button", { name: "Matrix" }).click();
  await expect(panel.getByRole("table")).toBeVisible();
  await expect(panel.getByRole("rowheader", { name: /Ryan Davies/ })).toBeVisible();
  expect(await noOverflow(page)).toBeTruthy();

  // Crew members never see the team view.
  await page.goto("/training.html?preview=crew");
  await expect(page.getByRole("heading", { name: "Your learning", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Team progress/ })).toHaveCount(0);
});

test("team progress recovers from a failed request", async ({ page }) => {
  await fixture(page, { profile: MANAGER });
  let fail = true;
  await page.route("**/api/training-progress", (r) =>
    fail ? r.fulfill({ status: 503, json: { error: "Team data is busy. Try again." } }) : r.fulfill({ json: TEAM }),
  );
  await page.goto("/training.html#team");
  await expect(page.getByRole("alert")).toContainText("Team data is busy");
  fail = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.locator(".tr-person", { hasText: "Ryan Davies" })).toBeVisible();
});

test("preview manager has a sample team without calling the API", async ({ page }) => {
  await fixture(page);
  let calls = 0;
  page.on("request", (r) => {
    if (r.url().includes("/api/training-progress")) calls++;
  });
  await page.goto("/training.html?preview=manager#team");
  const panel = page.getByRole("tabpanel", { name: /Team progress/ });
  await expect(panel.getByText("Sample team")).toBeVisible();
  expect(await panel.locator(".tr-person").count()).toBeGreaterThan(3);
  expect(calls).toBe(0);
});

test("modules outside the learner's role are explained, not shown", async ({ page }) => {
  await fixture(page);
  await page.goto("/module.html?id=manager-rush");
  await expect(page.getByRole("heading", { name: "This module isn’t part of your role." })).toBeVisible();
  await page.goto("/module.html?id=does-not-exist");
  await expect(page.getByRole("heading", { name: "Module not found." })).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to my learning" })).toHaveAttribute("href", "/training.html");
});

test("hub, lesson and team fit the screen without sideways scrolling", async ({ page }) => {
  test.slow(); // Long flows on emulated WebKit devices.
  await fixture(page, { profile: MANAGER });
  for (const url of ["/training.html", "/training.html#team", "/module.html?id=allergens", "/training.html?preview=manager#team"]) {
    await page.goto(url);
    await expect(page.locator(".tr-hub, .tr-lesson").first()).toBeVisible();
    await page.waitForTimeout(300);
    expect(await noOverflow(page), url).toBeTruthy();
  }
  await page.goto("/training.html#team");
  await page.getByRole("button", { name: "Matrix" }).click();
  await expect(page.getByRole("table")).toBeVisible();
  expect(await noOverflow(page)).toBeTruthy();
});
