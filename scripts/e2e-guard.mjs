// Safety guard shared by every end-to-end script.
//
// The e2e harness only ever talks to the local Firebase emulators. Every script
// imports this module and calls assertLocalEmulators() before doing anything,
// so a mis-set environment can never seed, wipe or read the production project
// (mc-training-portal).
export const E2E_PROJECT_ID = "demo-cccs";
export const FIRESTORE_HOST = "127.0.0.1:8080";
export const AUTH_HOST = "127.0.0.1:9099";

const LOCAL_HOST = /^127\.0\.0\.1:\d{2,5}$/;

export function assertLocalEmulators(env = process.env, who = "e2e script") {
  const problems = [];
  if (!LOCAL_HOST.test(String(env.FIRESTORE_EMULATOR_HOST || "")))
    problems.push("FIRESTORE_EMULATOR_HOST must be 127.0.0.1:<port> (got " + JSON.stringify(env.FIRESTORE_EMULATOR_HOST || "") + ")");
  if (!LOCAL_HOST.test(String(env.FIREBASE_AUTH_EMULATOR_HOST || "")))
    problems.push("FIREBASE_AUTH_EMULATOR_HOST must be 127.0.0.1:<port> (got " + JSON.stringify(env.FIREBASE_AUTH_EMULATOR_HOST || "") + ")");
  const project = String(env.FIREBASE_PROJECT_ID || env.GCLOUD_PROJECT || "");
  if (!project.startsWith("demo-"))
    problems.push("FIREBASE_PROJECT_ID must be a demo-* project (got " + JSON.stringify(project) + ")");
  if (String(env.FIREBASE_SERVICE_ACCOUNT_JSON || "").trim())
    problems.push("FIREBASE_SERVICE_ACCOUNT_JSON must be empty for e2e runs");
  if (String(env.GOOGLE_APPLICATION_CREDENTIALS || "").trim())
    problems.push("GOOGLE_APPLICATION_CREDENTIALS must be unset for e2e runs");
  if (problems.length) {
    const message =
      "[" + who + "] Refusing to run outside the local Firebase emulators:\n  - " + problems.join("\n  - ");
    throw new Error(message);
  }
  return project;
}

// Environment every e2e process (emulators, dev server, tests) runs with.
export function e2eEnv(extra = {}) {
  return {
    FIRESTORE_EMULATOR_HOST: FIRESTORE_HOST,
    FIREBASE_AUTH_EMULATOR_HOST: AUTH_HOST,
    FIREBASE_PROJECT_ID: E2E_PROJECT_ID,
    GCLOUD_PROJECT: E2E_PROJECT_ID,
    FIREBASE_SERVICE_ACCOUNT_JSON: "",
    GOOGLE_APPLICATION_CREDENTIALS: "",
    ...extra,
  };
}
