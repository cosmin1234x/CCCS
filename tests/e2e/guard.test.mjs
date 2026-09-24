// node --test tests/e2e/guard.test.mjs
// The e2e scripts must never run against anything but the local emulators.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { assertLocalEmulators, e2eEnv } from "../../scripts/e2e-guard.mjs";

const local = e2eEnv();

test("accepts the local emulator environment", () => {
  assert.equal(assertLocalEmulators(local), "demo-cccs");
});

test("refuses missing or non-local emulator hosts", () => {
  assert.throws(() => assertLocalEmulators({ ...local, FIRESTORE_EMULATOR_HOST: "" }), /FIRESTORE_EMULATOR_HOST/);
  assert.throws(() => assertLocalEmulators({ ...local, FIRESTORE_EMULATOR_HOST: "10.0.0.5:8080" }), /FIRESTORE_EMULATOR_HOST/);
  assert.throws(() => assertLocalEmulators({ ...local, FIREBASE_AUTH_EMULATOR_HOST: "localhost:9099" }), /FIREBASE_AUTH_EMULATOR_HOST/);
});

test("refuses the production project and real credentials", () => {
  assert.throws(() => assertLocalEmulators({ ...local, FIREBASE_PROJECT_ID: "mc-training-portal", GCLOUD_PROJECT: "" }), /demo-/);
  assert.throws(() => assertLocalEmulators({ ...local, FIREBASE_SERVICE_ACCOUNT_JSON: '{"type":"service_account"}' }), /SERVICE_ACCOUNT/);
  assert.throws(() => assertLocalEmulators({ ...local, GOOGLE_APPLICATION_CREDENTIALS: "C:/keys/prod.json" }), /GOOGLE_APPLICATION_CREDENTIALS/);
});

test("the seed script exits with an error instead of touching production", () => {
  const result = spawnSync(process.execPath, ["scripts/e2e-seed.mjs"], {
    env: { ...process.env, ...local, FIREBASE_PROJECT_ID: "mc-training-portal", GCLOUD_PROJECT: "mc-training-portal" },
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Refusing to run/);
});

test("the dev server refuses a real OpenAI or waste endpoint", () => {
  for (const extra of [
    { OPENAI_BASE_URL: "https://api.openai.com/v1" },
    { WASTE_STORE_URL: "https://haylewaster.vercel.app/api/store" },
  ]) {
    const result = spawnSync(process.execPath, ["scripts/e2e-dev.mjs"], {
      env: { ...process.env, ...local, PORT: "3299", ...extra },
      encoding: "utf8",
      timeout: 20000,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /must point at the local/);
  }
});
