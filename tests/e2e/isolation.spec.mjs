import { test, expect, SEED, signIn, userDoc, pageApi } from "./fixtures.mjs";

// Runs Firestore client calls in the browser as a signed-in user, so the
// real security rules decide. A separate Firebase app instance ("probe") is
// used: the Firestore SDK applies writes to its local cache before the server
// answers, and the hub reloads itself when it sees its own role change, so
// forbidden writes must not go through the app's own instance.
async function clientTry(page, op, path, data) {
  return page.evaluate(
    async ({ op, path, data, user }) => {
      const sdk = "https://www.gstatic.com/firebasejs/10.12.0";
      const [appMod, authMod, fs] = await Promise.all([
        import(sdk + "/firebase-app.js"),
        import(sdk + "/firebase-auth.js"),
        import(sdk + "/firebase-firestore.js"),
      ]);
      if (!window.__e2eProbe) {
        const app = appMod.initializeApp(window.__e2eFirebase.app.options, "e2e-probe");
        const auth = authMod.getAuth(app);
        authMod.connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
        const db = fs.getFirestore(app);
        fs.connectFirestoreEmulator(db, "127.0.0.1", 8080);
        window.__e2eProbe = { auth, db, ready: authMod.signInWithEmailAndPassword(auth, user.email, user.password) };
      }
      const { db, ready } = window.__e2eProbe;
      await ready;
      const parts = path.split("/");
      try {
        if (op === "getDoc") {
          const snap = await fs.getDoc(fs.doc(db, ...parts));
          return { ok: true, exists: snap.exists() };
        }
        if (op === "getDocs") {
          const snap = await fs.getDocs(fs.collection(db, ...parts));
          return { ok: true, size: snap.size };
        }
        if (op === "updateDoc") {
          await fs.updateDoc(fs.doc(db, ...parts), data);
          return { ok: true };
        }
        if (op === "addDoc") {
          await fs.addDoc(fs.collection(db, ...parts), data);
          return { ok: true };
        }
        if (op === "deleteDoc") {
          await fs.deleteDoc(fs.doc(db, ...parts));
          return { ok: true };
        }
      } catch (error) {
        return { ok: false, code: error.code };
      }
      return { ok: false, code: "unknown-op" };
    },
    { op, path, data, user: page.__e2eUser },
  );
}

async function signInAs(page, who) {
  const user = await signIn(page, who);
  page.__e2eUser = { email: user.email, password: SEED.password };
  return user;
}

const apiCall = pageApi;

test.describe("store isolation", () => {
  // Each test starts on a fully loaded hub so page.evaluate is never
  // interrupted by the app's own redirects.
  test("each manager only sees their own store's team and rota", async ({ page, newSession }) => {
    await signIn(page, "maya");
    await page.goto("/admin.html");
    await expect(page.locator("#content")).toContainText(SEED.users.cosmin.name);
    await expect(page.locator("#content")).not.toContainText(SEED.users.olivia.name);
    const data = await apiCall(page, "/api/portal-data");
    expect(data.status).toBe(200);
    expect(data.body.team.map((m) => m.storeId)).toEqual(expect.arrayContaining([SEED.store.id]));
    expect(data.body.team.every((m) => m.storeId === SEED.store.id)).toBe(true);
    expect(data.body.shifts.some((s) => s.userId === SEED.users.olivia.uid)).toBe(false);

    const owen = await newSession();
    await signIn(owen, "owen");
    await owen.goto("/admin.html");
    await expect(owen.locator("#content")).toContainText(SEED.users.olivia.name);
    await expect(owen.locator("#content")).not.toContainText(SEED.users.cosmin.name);
  });

  test("security rules block reading or writing another store's data", async ({ page, admin }) => {
    await signInAs(page, "maya");
    expect(await clientTry(page, "getDocs", `stores/${SEED.otherStore.id}/Shifts`)).toMatchObject({ ok: false, code: "permission-denied" });
    expect(await clientTry(page, "getDoc", `users/${SEED.users.olivia.uid}`)).toMatchObject({ ok: false, code: "permission-denied" });
    expect(
      await clientTry(page, "addDoc", `stores/${SEED.otherStore.id}/Shifts`, {
        userId: SEED.users.olivia.uid,
        userName: SEED.users.olivia.name,
        date: "2030-01-01",
        start: "09:00",
        end: "17:00",
      }),
    ).toMatchObject({ ok: false, code: "permission-denied" });
    expect(await clientTry(page, "updateDoc", `users/${SEED.users.olivia.uid}`, { stars: 99 })).toMatchObject({ ok: false });
    expect((await userDoc(admin, SEED.users.olivia.uid)).stars).toBe(SEED.users.olivia.stars);
    // Her own store still works.
    expect(await clientTry(page, "getDocs", `stores/${SEED.store.id}/Shifts`)).toMatchObject({ ok: true });
  });

  test("crew members cannot read colleagues or promote themselves", async ({ page, admin }) => {
    await signInAs(page, "cosmin");
    expect(await clientTry(page, "getDoc", `users/${SEED.users.amelia.uid}`)).toMatchObject({ ok: false, code: "permission-denied" });
    expect(await clientTry(page, "updateDoc", `users/${SEED.users.cosmin.uid}`, { role: "manager" })).toMatchObject({ ok: false, code: "permission-denied" });
    expect(await clientTry(page, "updateDoc", `users/${SEED.users.cosmin.uid}`, { stars: 500 })).toMatchObject({ ok: false, code: "permission-denied" });
    expect(await clientTry(page, "deleteDoc", `stores/${SEED.store.id}/Shifts/e2e-shift-amelia-today`)).toMatchObject({ ok: false, code: "permission-denied" });
    const me = await userDoc(admin, SEED.users.cosmin.uid);
    expect(me.role).toBe("crew");
    expect(me.stars).toBe(SEED.users.cosmin.stars);
    expect((await admin.db.doc(`stores/${SEED.store.id}/Shifts/e2e-shift-amelia-today`).get()).exists).toBe(true);
  });

  test("a manager cannot approve a role request from another store", async ({ page, admin }) => {
    await admin.db.doc("roleRequests/" + SEED.users.olivia.uid).set({
      uid: SEED.users.olivia.uid,
      name: SEED.users.olivia.name,
      storeId: SEED.otherStore.id,
      requestedRole: "manager",
      status: "pending",
    });
    await signIn(page, "maya");
    const result = await apiCall(page, "/api/role-request", { action: "approve", uid: SEED.users.olivia.uid });
    expect(result.status).toBe(403);
    expect((await userDoc(admin, SEED.users.olivia.uid)).role).toBe("crew");
  });
});
