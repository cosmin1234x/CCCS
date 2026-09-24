// Starts the local Firebase Auth + Firestore emulators for the e2e harness,
// waits until both answer, seeds them, then opens a tiny readiness endpoint
// (http://127.0.0.1:4399/ready) that Playwright's webServer waits for.
//
//   node scripts/e2e-emulators.mjs
//
// Uses firebase-tools through npx (no project dependency) and the demo-cccs
// project, which the Firebase CLI keeps fully offline: nothing can reach the
// production project mc-training-portal.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import http from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { E2E_PROJECT_ID, assertLocalEmulators, e2eEnv } from "./e2e-guard.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
for (const [key, value] of Object.entries(e2eEnv()))
  if (process.env[key] === undefined) process.env[key] = value;
assertLocalEmulators(process.env, "e2e-emulators");

const READY_PORT = Number(process.env.E2E_READY_PORT) || 4399;
const FIREBASE_TOOLS = process.env.E2E_FIREBASE_TOOLS || "firebase-tools@15.31.0";
const fsUrl = `http://${process.env.FIRESTORE_EMULATOR_HOST}/`;
const authUrl = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/`;

async function up(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(1500) });
    return r.status < 500;
  } catch {
    return false;
  }
}

let child = null;
const alreadyRunning = (await up(fsUrl)) && (await up(authUrl));
if (alreadyRunning) {
  console.log("[e2e-emulators] Emulators already running; reusing them.");
} else {
  console.log(`[e2e-emulators] Starting ${FIREBASE_TOOLS} emulators (auth, firestore) for ${E2E_PROJECT_ID}…`);
  // Run from .out/e2e (git-ignored) so firebase-debug.log / firestore-debug.log
  // never land in the repository root. --config keeps using ./firebase.json
  // (and therefore the real ./firestore.rules).
  const workDir = resolve(root, ".out", "e2e");
  mkdirSync(workDir, { recursive: true });
  const args = [
    "-y",
    FIREBASE_TOOLS,
    "emulators:start",
    "--only",
    "auth,firestore",
    "--project",
    E2E_PROJECT_ID,
    "--config",
    JSON.stringify(resolve(root, "firebase.json")),
  ];
  child =
    process.platform === "win32"
      ? spawn("npx " + args.join(" "), { cwd: workDir, env: process.env, stdio: ["ignore", "pipe", "pipe"], shell: true })
      : spawn("npx", args.map((a) => a.replace(/^"|"$/g, "")), { cwd: workDir, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
  const relay = (stream, out) =>
    stream.on("data", (chunk) =>
      String(chunk)
        .split(/\r?\n/)
        .filter((line) => line.trim())
        .forEach((line) => out.write("[firebase] " + line + "\n")),
    );
  relay(child.stdout, process.stdout);
  relay(child.stderr, process.stderr);
  child.on("exit", (code) => {
    console.log("[e2e-emulators] Firebase emulators exited with code " + code);
    process.exit(code || 0);
  });
}

const started = Date.now();
while (!((await up(fsUrl)) && (await up(authUrl)))) {
  if (Date.now() - started > 180000) {
    console.error("[e2e-emulators] Emulators did not start within 3 minutes.");
    child?.kill();
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 500));
}

const { resetAndSeed, closeAdminApps, SEED } = await import("./e2e-seed.mjs");
await resetAndSeed();
await closeAdminApps();
console.log(`[e2e-emulators] Emulators ready and seeded (${Object.keys(SEED.users).length} accounts).`);

const ready = http
  .createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, project: E2E_PROJECT_ID }));
  })
  .listen(READY_PORT, "127.0.0.1", () =>
    console.log(`[e2e-emulators] Ready signal on http://127.0.0.1:${READY_PORT}/ready`),
  );

function shutdown() {
  ready.close();
  if (child && !child.killed) {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } else child.kill("SIGINT");
  }
  setTimeout(() => process.exit(0), 1500);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
