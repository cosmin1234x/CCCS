// Fuzzy, store-scoped person matching for McAssist. Managers type things like
// "cosmins acc", "cos", "Cosmn" or "alex j"; this turns them into exactly one
// team member, a short list of candidates to ask about, or "not found".
import { normalizeRole, roleLabel } from "./portal-admin.js";

const FILLER = new Set([
  "acc",
  "account",
  "accounts",
  "profile",
  "the",
  "for",
  "of",
  "user",
  "crew",
  "member",
  "shifts",
  "shift",
  "rota",
  "pls",
  "please",
]);

export function normaliseName(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/[^a-z0-9' -]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(value) {
  return normaliseName(value)
    .replace(/'s\b/g, "")
    .replace(/'/g, "")
    .split(/[\s-]+/)
    .filter(Boolean);
}

export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

function queryVariants(query) {
  const base = tokens(query).filter((t) => !FILLER.has(t));
  if (!base.length) return [];
  const variants = [base];
  // "cosmins" (possessive typed without an apostrophe) → "cosmin".
  const depossessed = base.map((t) => (t.length > 3 && t.endsWith("s") ? t.slice(0, -1) : t));
  if (depossessed.join(" ") !== base.join(" ")) variants.push(depossessed);
  return variants;
}

function scoreTokens(queryTokens, nameTokens, fullName) {
  const joined = queryTokens.join(" ");
  if (joined === fullName) return 90;
  if (queryTokens.every((q) => nameTokens.includes(q))) return 80;
  if (queryTokens.every((q) => q.length >= 2 && nameTokens.some((n) => n.startsWith(q)))) return 70;
  let fuzzy = 0;
  const allFuzzy = queryTokens.every((q) => {
    if (q.length < 4) return nameTokens.some((n) => n.startsWith(q));
    const allowed = q.length >= 7 ? 2 : 1;
    const best = Math.min(
      ...nameTokens.map((n) =>
        Math.min(levenshtein(q, n), n.length > q.length ? levenshtein(q, n.slice(0, q.length)) + 1 : 99),
      ),
    );
    fuzzy += best;
    return best <= allowed;
  });
  if (allFuzzy) return 60 - fuzzy;
  if (joined.length >= 3 && fullName.includes(joined)) return 50;
  return 0;
}

export function memberLabel(member) {
  const inactive = String(member?.status || "").toLowerCase() === "inactive";
  return (member?.name || "Crew member") + " (" + roleLabel(member?.role) + (inactive ? ", deactivated" : "") + ")";
}

// roster: [{ id, name, email, role, ... }]
// Returns { status: "found", member } | { status: "ambiguous", candidates }
//       | { status: "not_found", suggestions }
export function resolveMember(roster, query, { selfId } = {}) {
  const raw = String(query ?? "").trim();
  const list = Array.isArray(roster) ? roster : [];
  if (!raw) return { status: "not_found", suggestions: [] };
  const lowered = normaliseName(raw);
  if (["me", "myself", "my", "i", "mine", "my account", "my acc", "my own"].includes(lowered) && selfId) {
    const self = list.find((m) => m.id === selfId);
    if (self) return { status: "found", member: self };
  }
  const byId = list.find((m) => m.id === raw);
  if (byId) return { status: "found", member: byId };
  const byEmail = list.find((m) => m.email && String(m.email).toLowerCase() === raw.toLowerCase());
  if (byEmail) return { status: "found", member: byEmail };

  const variants = queryVariants(raw);
  if (!variants.length) return { status: "not_found", suggestions: [] };
  const scored = list
    .map((member) => {
      const nameTokens = tokens(member.name);
      const fullName = nameTokens.join(" ");
      const score = Math.max(0, ...variants.map((v) => scoreTokens(v, nameTokens, fullName)));
      return { member, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) {
    const first = variants[0][0];
    const suggestions = list
      .map((member) => ({
        member,
        distance: Math.min(...tokens(member.name).map((t) => levenshtein(first, t))),
      }))
      .filter((x) => x.distance <= 3)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 3)
      .map((x) => x.member);
    return { status: "not_found", suggestions };
  }

  const best = scored[0].score;
  const top = scored.filter((x) => x.score === best).map((x) => x.member);
  if (top.length === 1) return { status: "found", member: top[0] };
  // Prefer the only active person when a deactivated account shares the name.
  const active = top.filter((m) => String(m.status || "").toLowerCase() !== "inactive");
  if (active.length === 1 && best >= 80) return { status: "found", member: active[0] };
  return { status: "ambiguous", candidates: top.slice(0, 6) };
}

export function rosterEntry(doc) {
  return { ...doc, role: normalizeRole(doc.role) };
}
