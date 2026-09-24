// Reference lists McAssist needs on the server: learning modules (read from the
// shared browser file module-data.js so the list never drifts, with a built-in
// fallback) and the stations a Crew Trainer can verify.
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { normaliseName } from "./mcassist-people.js";

const FALLBACK_MODULES = [
  ["first-shift", "First Shift Basics", "Essentials", ["crew", "crewTrainer", "manager"]],
  ["food-safety", "Food Safety & Hygiene", "Safety", ["crew", "crewTrainer", "manager"]],
  ["allergens", "Allergens & Customer Questions", "Safety", ["crew", "crewTrainer", "manager"]],
  ["fries-station", "Fries Station", "Kitchen", ["crew", "crewTrainer", "manager"]],
  ["grill-station", "Grill & Beef Station", "Kitchen", ["crew", "crewTrainer", "manager"]],
  ["chicken-fryer", "Chicken & Fryer Station", "Kitchen", ["crew", "crewTrainer", "manager"]],
  ["kitchen-assembly", "Kitchen Assembly & Builds", "Kitchen", ["crew", "crewTrainer", "manager"]],
  ["breakfast", "Breakfast Station Basics", "Kitchen", ["crew", "crewTrainer", "manager"]],
  ["front-counter", "Front Counter Service", "Service", ["crew", "crewTrainer", "manager"]],
  ["drive-thru", "Drive-thru Order Taking", "Service", ["crew", "crewTrainer", "manager"]],
  ["drinks-mccafe", "Drinks & McCafé", "Service", ["crew", "crewTrainer", "manager"]],
  ["order-presenting", "Order Assembly & Present", "Service", ["crew", "crewTrainer", "manager"]],
  ["dining-cleaning", "Dining Area, Cleaning & Safety", "Cleanliness", ["crew", "crewTrainer", "manager"]],
  ["stock-waste", "Stock, Rotation & Waste", "Operations", ["crew", "crewTrainer", "manager"]],
  ["customer-recovery", "Customer Recovery", "Service", ["crew", "crewTrainer", "manager"]],
  ["delivery-orders", "Delivery Order Handover", "Service", ["crew", "crewTrainer", "manager"]],
  ["trainer-coaching", "Crew Trainer Coaching", "Crew Trainer", ["crewTrainer"]],
  ["trainer-verification", "Station Verification & Sign-off", "Crew Trainer", ["crewTrainer"]],
  ["manager-rush", "Manager Rush Planning", "Manager", ["manager"]],
  ["manager-shift-planning", "Manager Shift Planning", "Manager", ["manager"]],
].map(([id, title, category, roles]) => ({ id, title, category, roles }));

let cachedModules = null;

function loadModulesFromFile() {
  const code = readFileSync(new URL("../module-data.js", import.meta.url), "utf8");
  const sandbox = { window: {}, console: { log() {}, warn() {}, error() {} } };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(code.replace(/^\s*export\s+/gm, ""), sandbox, { timeout: 500 });
  const source = sandbox.window.McModules || sandbox.McModules;
  const list = Array.isArray(source?.modules) ? source.modules : Array.isArray(source) ? source : [];
  return list
    .filter((m) => m && typeof m.id === "string" && m.id)
    .map((m) => ({
      id: m.id,
      title: String(m.title || m.id),
      category: String(m.category || ""),
      roles: Array.isArray(m.roles) && m.roles.length ? m.roles : ["crew", "crewTrainer", "manager"],
    }));
}

export function moduleCatalog() {
  if (cachedModules) return cachedModules;
  try {
    const list = loadModulesFromFile();
    cachedModules = list.length ? list : FALLBACK_MODULES;
  } catch {
    cachedModules = FALLBACK_MODULES;
  }
  return cachedModules;
}

export function modulesForRole(role) {
  return moduleCatalog().filter((m) => m.roles.includes(role));
}

export function findModule(query) {
  const text = normaliseName(query).replace(/-/g, " ");
  if (!text) return null;
  const list = moduleCatalog();
  const byId = list.find((m) => m.id === String(query).trim() || m.id.replace(/-/g, " ") === text);
  if (byId) return byId;
  const byTitle = list.find((m) => normaliseName(m.title) === text);
  if (byTitle) return byTitle;
  const partial = list.filter(
    (m) => normaliseName(m.title).includes(text) || m.id.replace(/-/g, " ").includes(text),
  );
  return partial.length === 1 ? partial[0] : null;
}

// Stations a Crew Trainer can verify (matches api/verification.js).
export const VERIFY_STATIONS = [
  "Fries",
  "Grill",
  "Chicken & Fryer",
  "Front Counter",
  "Drive-thru",
  "Drinks & McCafé",
  "Kitchen Assembly",
  "Breakfast",
  "Dining Area",
];

const VERIFY_ALIASES = {
  fries: "Fries",
  fry: "Fries",
  grill: "Grill",
  beef: "Grill",
  chicken: "Chicken & Fryer",
  fryer: "Chicken & Fryer",
  "chicken fryer": "Chicken & Fryer",
  "chicken and fryer": "Chicken & Fryer",
  "chicken & fryer": "Chicken & Fryer",
  "front counter": "Front Counter",
  counter: "Front Counter",
  till: "Front Counter",
  front: "Front Counter",
  "drive thru": "Drive-thru",
  "drive-thru": "Drive-thru",
  "drive through": "Drive-thru",
  headset: "Drive-thru",
  drinks: "Drinks & McCafé",
  mccafe: "Drinks & McCafé",
  "mccafé": "Drinks & McCafé",
  "mc cafe": "Drinks & McCafé",
  "drinks & mccafé": "Drinks & McCafé",
  "drinks and mccafe": "Drinks & McCafé",
  assembly: "Kitchen Assembly",
  kitchen: "Kitchen Assembly",
  "kitchen assembly": "Kitchen Assembly",
  breakfast: "Breakfast",
  lobby: "Dining Area",
  "dining area": "Dining Area",
  dining: "Dining Area",
  cleaning: "Dining Area",
};

export function normaliseVerifyStation(value) {
  const key = String(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\s*station$/, "")
    .trim();
  return VERIFY_ALIASES[key] || VERIFY_STATIONS.find((s) => s.toLowerCase() === key) || null;
}
