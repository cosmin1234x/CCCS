import { test, expect, SEED, signIn, drawSignature, userDoc, pageApi } from "./fixtures.mjs";

async function sign(page, name) {
  const canvas = page.locator("canvas").first();
  await expect(canvas).toBeVisible();
  await drawSignature(page, canvas);
  await page.getByLabel(/type your full name/i).fill(name);
  await page.getByRole("button", { name: /sign verification/i }).click();
}

test.describe("station verification", () => {
  test("a Crew Trainer starts a verification, both people sign, and the station is verified", async ({
    page,
    newSession,
    admin,
  }) => {
    // Tara (Crew Trainer) opens a Grill check for Cosmin.
    await signIn(page, "tara");
    await page.goto("/verification.html");
    await page.locator('select[name="crewId"]').selectOption({ label: SEED.users.cosmin.name });
    await page.locator('select[name="station"]').selectOption("Grill");
    await page.getByRole("button", { name: /open verification/i }).click();
    await page.waitForURL(/verification\.html\?id=/);
    const url = new URL(page.url());
    const id = url.searchParams.get("id");
    expect(id).toBeTruthy();
    await expect(page.locator("#content")).toContainText("Grill");
    await expect(page.locator("#content")).toContainText(SEED.users.cosmin.name);

    // Trainer signs her side.
    await sign(page, SEED.users.tara.name);
    await expect(page.locator("#content")).toContainText(/other signature is still required|signed/i);
    let doc = (await admin.db.doc(`stores/${SEED.store.id}/verifications/${id}`).get()).data();
    expect(doc.trainerSignature).toMatchObject({ uid: SEED.users.tara.uid });
    expect(doc.status).not.toBe("verified");

    // Cosmin signs his side on his own device.
    const crew = await newSession();
    await signIn(crew, "cosmin");
    await crew.goto(`/verification.html?id=${encodeURIComponent(id)}`);
    await sign(crew, SEED.users.cosmin.name);
    await expect(crew.locator("#content")).toContainText(/now verified on grill|verified/i);

    await expect
      .poll(async () => (await admin.db.doc(`stores/${SEED.store.id}/verifications/${id}`).get()).data().status)
      .toBe("verified");
    doc = (await admin.db.doc(`stores/${SEED.store.id}/verifications/${id}`).get()).data();
    expect(doc.crewSignature).toMatchObject({ uid: SEED.users.cosmin.uid });
    expect((await userDoc(admin, SEED.users.cosmin.uid)).verifiedStations).toContain("Grill");

    // The trainer's list now shows it as verified.
    await page.goto("/verification.html");
    await expect(page.locator("#content")).toContainText(/verified/i);
  });

  test("a crew member cannot sign the trainer's side or start verifications", async ({ page, admin }) => {
    await signIn(page, "cosmin");
    await page.goto("/verification.html");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator('select[name="crewId"]')).toHaveCount(0);
    // The API refuses a crew member starting a check.
    const { status } = await pageApi(page, "/api/verification", {
      action: "create",
      crewId: SEED.users.amelia.uid,
      station: "Grill",
    });
    expect(status).toBe(403);
    const all = await admin.db.collection(`stores/${SEED.store.id}/verifications`).get();
    expect(all.size).toBe(1);

    // Nor can he sign a check that belongs to Amelia and Tara.
    const ref = admin.db.doc(`stores/${SEED.store.id}/verifications/e2e-verify-open`);
    await ref.set({
      storeId: SEED.store.id,
      crewId: SEED.users.amelia.uid,
      crewName: SEED.users.amelia.name,
      trainerId: SEED.users.tara.uid,
      trainerName: SEED.users.tara.name,
      station: "Grill",
      status: "pending_signatures",
      crewSignature: null,
      trainerSignature: null,
    });
    const sign = await pageApi(page, "/api/verification", {
      action: "sign",
      id: "e2e-verify-open",
      typedName: SEED.users.cosmin.name,
    });
    expect(sign.status).toBe(403);
    const after = (await ref.get()).data();
    expect(after.crewSignature).toBeNull();
    expect(after.trainerSignature).toBeNull();
  });
});
