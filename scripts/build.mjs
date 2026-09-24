import { mkdir, copyFile, cp, rm } from "node:fs/promises";
import { resolve, dirname, relative, isAbsolute, sep } from "node:path";
import { fileURLToPath } from "node:url";
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// BUILD_OUT lets parallel local builds use separate folders (e.g. .out/3101).
// Vercel always uses the default "public" output directory.
const outDir = resolve(projectRoot, process.env.BUILD_OUT || "public");
const rel = relative(projectRoot, outDir);
if (
  process.cwd() !== projectRoot ||
  !rel ||
  rel.startsWith("..") ||
  isAbsolute(rel) ||
  !(rel === "public" || rel.startsWith(".out" + sep) || rel.startsWith(".out/"))
)
  throw new Error("Build must run from the project root into public/ or .out/<name>.");
await rm(outDir, { recursive: true, force: true });
// Only publish explicitly approved browser assets. Never serve repository credentials.
// When you add a new browser file, add it to this list.
await mkdir(outDir, { recursive: true });
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
  "verification.html",
  "waste.html",
  "portal.css",
  "portal-v2.css",
  "pages.css",
  "training.css",
  "mcassist.css",
  "waste.css",
  "portal-enhancements.js",
  "portal.js",
  "portal-core.js",
  "portal-pages.js",
  "training-ui.js",
  "mcassist-ui.js",
  "waste-page.js",
  "firebase-init.js",
  "module-data.js",
  "favicon.svg",
]) {
  await copyFile(file, resolve(outDir, file));
}
await cp("food", resolve(outDir, "food"), { recursive: true });
console.log(`Built crew hub into ${rel} with an explicit public asset allowlist.`);
