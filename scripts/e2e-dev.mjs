// Dev server for the e2e harness: the normal scripts/dev.mjs (static files +
// every api/*.js handler) wired to the local emulators and fake upstreams.
//
//   node scripts/e2e-dev.mjs            build into .out/3200 and serve it
//   E2E_SERVE=source node scripts/e2e-dev.mjs   serve the source files
//
// Refuses to start unless Firestore/Auth point at the local emulators, the
// OpenAI base URL points at the local fake model and the waste store points at
// the local fake store, so an e2e run can never write to production.
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertLocalEmulators, e2eEnv } from "./e2e-guard.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaults = e2eEnv({
  PORT: "3200",
  OPENAI_API_KEY: "test",
  OPENAI_BASE_URL: "http://127.0.0.1:4010/v1",
  WASTE_STORE_URL: "http://127.0.0.1:4011/api/store",
});
for (const [key, value] of Object.entries(defaults))
  if (process.env[key] === undefined) process.env[key] = value;

assertLocalEmulators(process.env, "e2e-dev");
const local = (value) => /^http:\/\/127\.0\.0\.1:\d+\//.test(String(value || ""));
if (!local(process.env.OPENAI_BASE_URL))
  throw new Error("[e2e-dev] OPENAI_BASE_URL must point at the local fake model (http://127.0.0.1:<port>/v1).");
if (!local(process.env.WASTE_STORE_URL))
  throw new Error("[e2e-dev] WASTE_STORE_URL must point at the local fake waste store.");
if (process.cwd() !== root) process.chdir(root);

const port = process.env.PORT;
if (process.env.E2E_SERVE === "source") {
  process.env.DEV_ROOT = ".";
} else {
  // Serve the real allowlisted build so a browser file missing from
  // scripts/build.mjs fails here exactly as it would on Vercel.
  // Separate from .out/<port>/shots so screenshots survive a rebuild.
  const out = `.out/e2e-build-${port}`;
  execFileSync(process.execPath, ["scripts/build.mjs"], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, BUILD_OUT: out },
  });
  process.env.DEV_ROOT = out;
}
console.log(
  `[e2e-dev] emulators ${process.env.FIRESTORE_EMULATOR_HOST}/${process.env.FIREBASE_AUTH_EMULATOR_HOST}, ` +
    `model ${process.env.OPENAI_BASE_URL}, waste ${process.env.WASTE_STORE_URL}, serving ${process.env.DEV_ROOT}`,
);
await import(pathToFileURL(resolve(root, "scripts/dev.mjs")).href);
