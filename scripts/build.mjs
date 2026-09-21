import { mkdir, copyFile, cp, rm } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = resolve(projectRoot, "public");
if (process.cwd() !== projectRoot || dirname(publicDir) !== projectRoot)
  throw new Error("Build must run from the project root.");
await rm(publicDir, { recursive: true, force: true });
// Only publish explicitly approved browser assets. Never serve repository credentials.
await mkdir("public", { recursive: true });
for (const file of [
  "index.html",
  "main.html",
  "signup.html",
  "schedule.html",
  "shifts-admin.html",
  "training.html",
  "module.html",
  "break-rewards.html",
  "wrapped.html",
  "admin.html",
  "portal.css",
  "portal.js",
  "portal-core.js",
  "firebase-init.js",
  "module-data.js",
  "favicon.svg",
]) {
  await copyFile(file, `public/${file}`);
}
await cp("food", "public/food", { recursive: true });
await copyFile("portal-pages.js", "public/portal-pages.js");
console.log("Built crew hub with an explicit public asset allowlist.");
