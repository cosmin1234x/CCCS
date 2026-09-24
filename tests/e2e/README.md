# End-to-end harness (local Firebase emulators)

These specs drive the **real crew hub UI** in real browsers against the **real
API handlers** (`api/*.js`) and the **real Firestore security rules**, using
local Firebase emulators seeded with a small restaurant. Nothing ever touches
the production Firebase project (`mc-training-portal`), the real OpenAI API or
the live Hayle waste store.

```
npm run test:e2e                         # every spec on desktop, iPad, iPad landscape, iPhone
npm run test:e2e -- --project=desktop    # quick run on desktop Chromium only
npm run test:e2e -- tests/e2e/mcassist.spec.mjs --project=iphone
```

Requirements: Node 22+, Java 21 (for the Firestore emulator), the Playwright
browsers (`npx playwright install chromium webkit`) and internet access for the
first run (npx downloads `firebase-tools@15.31.0` and the emulator jar once; the
browser loads the Firebase web SDK from gstatic). No extra npm dependencies.

## What Playwright starts

`playwright.e2e.config.mjs` starts and stops everything:

| Process | Port | What it is |
|---|---|---|
| `scripts/e2e-emulators.mjs` | 9099, 8080 (ready signal 4399) | Firebase Auth + Firestore emulators for project `demo-cccs` (from `firebase.json`, UI disabled, `firestore.rules` loaded and hot-reloaded). Logs go to `.out/e2e/`. |
| `scripts/fake-openai.mjs` | 4010 | Scripted OpenAI-compatible `/v1/chat/completions`. McAssist's real loop and Firestore tools run; only the model is scripted. |
| `scripts/fake-waste-store.mjs` | 4011 | In-memory copy of the Hayle Waste Counter `/api/store` (GET, POST state, manager PIN actions). |
| `scripts/e2e-dev.mjs` | 3200 | `node scripts/build.mjs` into `.out/e2e-build-3200`, then `scripts/dev.mjs` serving that allowlisted build and every `api/*.js`. |

The dev server runs with `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`,
`FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099`, `FIREBASE_PROJECT_ID=demo-cccs`,
`OPENAI_API_KEY=test`, `OPENAI_BASE_URL=http://127.0.0.1:4010/v1`,
`WASTE_STORE_URL=http://127.0.0.1:4011/api/store` and an empty
`FIREBASE_SERVICE_ACCOUNT_JSON`.

In the browser, `tests/e2e/fixtures.mjs` routes `/firebase-init.js` to a copy of
the real file with `projectId: "demo-cccs"`, `connectAuthEmulator` and
`connectFirestoreEmulator`, so no production code changes are needed. Every
request to a production host (firestore/identitytoolkit/securetoken
googleapis, haylewaster.vercel.app, api.openai.com) is blocked and fails the
test.

## Safety guards

`scripts/e2e-guard.mjs` is imported by every script and by the Playwright
config. They refuse to run unless `FIRESTORE_EMULATOR_HOST` and
`FIREBASE_AUTH_EMULATOR_HOST` are `127.0.0.1:<port>`, the project ID starts
with `demo-`, and no service-account credentials are set. `e2e-dev.mjs` also
refuses unless the OpenAI base URL and the waste store URL are local.

## Seed data (`scripts/e2e-seed.mjs`)

Every test wipes both emulators and reseeds (about a second), so specs are
independent. All passwords are `hayle-e2e-2026` (emulator only).

| Person | Email | Role | Store |
|---|---|---|---|
| Maya Manager | maya.manager@e2e.test | manager | 1170 · Hayle |
| Tara Trainer | tara.trainer@e2e.test | crewTrainer | 1170 |
| Cosmin Blidaru | cosmin@e2e.test | crew · Mon/Tue/Thu/Fri/Sat 09:00–23:00, Wed and Sun off | 1170 |
| Amelia Wilson | amelia@e2e.test | crew · verified on Fries | 1170 |
| Ryan Davies | ryan@e2e.test | crew | 1170 |
| Priya Shah | priya@e2e.test | crew · pending Crew Trainer request | 1170 |
| Owen Truro | owen.manager@e2e.test | manager | 2280 · Truro |
| Olivia Truro | olivia@e2e.test | crew | 2280 |

Plus shifts relative to today (Cosmin already works next Friday 17:00–23:00),
learning progress, a verified Fries sign-off and a McStars record.

## Specs

| Spec | Covers |
|---|---|
| `auth.spec.mjs` | Sign up as Crew Trainer → hub as crew with a pending request; sign in/out; wrong password; forgot password. |
| `shifts.spec.mjs` | Manager publishes in the planner → crew sees it live on My shifts; day-off warning and clash blocking; crew cannot plan. |
| `team.spec.mjs` | Crew saves availability (persists); manager approves a role request (the new trainer gets trainer tools); team list and member details. |
| `verification.spec.mjs` | Trainer starts a check, both sign on their own devices → station verified; crew cannot start one. |
| `learning.spec.mjs` | Lessons → confidence check → quiz → completion persists in Firestore and the hub; failing does not complete. |
| `mcassist.spec.mjs` | "Create 3 shifts for Cosmin next week" → checks availability, asks for times with quick replies → pending plan → Confirm → 3 shifts (not on his day off or existing shift) + audit; "Delete Amelia's account" → high-risk plan → Confirm → Auth user and profile gone; Cancel changes nothing; crew asking to delete someone is refused (the fake model even calls the manager tool — the server refuses); a manager cannot reach another store. |
| `isolation.spec.mjs` | Team/rota scoped per store (UI and `/api/portal-data`); security rules deny cross-store reads/writes and crew self-promotion; cross-store role approval refused. |
| `waste.spec.mjs` | Waste page loads through `/api/waste`, counts, saves a sheet to the shared store, another device sees it; signed-out API calls get 401. |
| `layout.spec.mjs` | Every page per role renders without error banners or sideways scrolling; full-page screenshots in `.out/3200/shots/` (McAssist conversation shots too). |
| `preview.spec.mjs` | Crew and manager preview (no account) render, McAssist demo answers, and nothing reads/writes Firebase data or calls `/api/ai-chat`. |
| `guard.test.mjs` | `npm run test:e2e:guard` (node:test): the safety guards refuse production-like environments. |

## The scripted model

`scripts/fake-openai.mjs` picks its reply from the latest user message and
the tool results already in the turn, and builds every tool call from the
tool schemas the server actually offered (it prefers McAssist V4's
`suggest_shift_slots`, `ask_user`, `create_shifts`, `manager_delete_member`).
`GET http://127.0.0.1:4010/__e2e/log` shows the recent requests, tools offered
and calls made, which is handy when a McAssist spec fails.

## Working on the harness

- Faster iteration: `E2E_SERVE=source` serves the source files instead of the
  build; `E2E_REUSE=1` reuses already running fake servers and dev server.
  The emulators are always reused if they are already up.
- Start the emulators on their own: `npm run e2e:emulators` (Ctrl+C stops
  them). Reseed any time with `npm run e2e:seed`.
- Reports: `.out/e2e-report/` (HTML), failure traces and screenshots in
  `.out/e2e-results/`.
- Tests run one at a time (`workers: 1`) because they share one emulator.
  A full run (120 tests, four devices) takes about 13 minutes once the SDK
  and fonts are cached; `--project=desktop` takes about 3.
- Each failing test is retried once (`E2E_RETRIES=0` turns that off). A
  test that passes only on retry is listed as **flaky** in the summary.

## WebKit and the emulator's connection limit

The emulator speaks HTTP/1.1, so a browser context opens at most six
connections to it, and Playwright's WebKit on Windows keeps the Firestore
long-poll connections of pages it has already left. After about six quick
page changes in one context every slot is taken, the Firestore SDK decides it
is offline, and the app's start-up shows "Let’s get your account ready.
Failed to get document because the client is offline." The layout spec
therefore opens every page in a fresh browser context that reuses the
signed-in session (`storageState({ indexedDB: true })`); the other specs stay
well under six page loads per context. Production (HTTP/2 to Google) does not
have this limit, but the screen the app lands on is a real robustness gap: a
temporary connection error at start-up should retry, not look like an
account problem.
