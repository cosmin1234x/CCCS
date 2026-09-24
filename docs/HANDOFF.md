# Handoff — what is left (updated 24 Sep 2026)

## Where things stand

- **Production** (https://www.amyai.space) runs `d438c65` ("Integration round"), merged to `main` via PR #7.
- An earlier fix round (a WIP commit on `showcase-v4`, plus `docs/HANDOFF.md` and `docs/qa-findings.json` with 137 QA
  findings) was **never pushed**: `showcase-v4` on GitHub equals `main`. That work and the QA findings file are lost
  unless someone still has the local copy. If you do, add `docs/qa-findings.json` to the repo.
- Branch `claude/eager-sagan-8fyk8e` redoes the two problems the owner reported (below). Not deployed yet.

## Fixed on `claude/eager-sagan-8fyk8e`

1. **Load flicker** (signed in, the page "glitched ~3 times before it stabilised"). Cause: `#content` was re-rendered
   for every data arrival (shifts / learning / profile / team snapshots, then `/api/portal-data`), each replaying the
   entrance animations, plus a late web-font swap.
   - `portal.js` holds the first paint: `#content` shows one skeleton until the first snapshots and the server extras
     are in (`holdFirstPaint` / `arrived`), capped at `FIRST_PAINT_MS` (1.5 s), then paints once.
   - Later data updates whose markup is unchanged leave the DOM alone (`refreshPage` in `pages-ui.js` still refreshes an
     open shift editor / planner deep link). Changed markup repaints in place with `#content[data-live]`, which switches
     off the entrance animations (`portal.css` motion section, top of `pages.css`). A data update that lands during the
     first paint's entrance waits until it has finished (`ENTRANCE_MS`). Repaints the person asks for (`ctx.render()`:
     week change, Discard, saves) always happen straight away.
   - The shell waits (max 800 ms) for the declared latin font weights (`fontsReady`), so text does not re-flow.
   - The manager timeline "Now" marker is computed to the minute, so Home's markup is stable between minutes.
   - `verification.html` shows a loading state instead of briefly rendering Home before the sign-off module takes over.
2. **Profile panel on iPad** (`#profileButton` → `#pgSheet` panel): the body was not clipped; lower links rendered below
   the action bar and outside the panel and could not be reached. Cause: the scroll height came from nested flexbox,
   which WebKit did not treat as definite. Now `.pg-sheet-inner` is the only scroller, capped by `--sheet-max` (set per
   variant; `vh` fallback, `dvh` under `@supports`); the top (handle + header, `.pg-sheet-top`) and `.pg-sheet-actions`
   are sticky. The panel also uses the height below the top bar (max 820 px), so on iPad portrait it no longer scrolls.
   This applies to every `#pgSheet` (member drawer, shift editor, notifications, copy week).

Regression tests: `pages.spec.mjs` "the page paints once while its data arrives, then updates in place" and "the
profile panel scrolls inside itself on a short screen".

## Test status (cloud container, 24 Sep)

- `npm test`: 150 pass, 4 cancelled (`mcassist-v4.test.mjs:823`–`866`, "Promise resolution is still pending"). Same on
  `main`, so not caused by this branch — worth a look.
- Playwright could only run in **Chromium** here (no WebKit in the container, and the egress policy blocks
  www.gstatic.com and cdn.jsdelivr.net, so the Firebase SDK and fonts were served locally from the npm packages). The
  iPad/iPhone projects were emulated in Chromium. **Re-run the real suite (WebKit) on a machine that has it**, and check
  the profile panel on a physical iPad.
- Full run, all four projects: 527 passed, 10 skipped, 7 failed. After the fixes that followed, the only failures
  left are ones that fail on `main` in the same environment too:
  - `waste.spec.mjs` "preview mode works offline…" (all projects; the sample history depends on the time of day).
  - `waste.spec.mjs` "press and hold keeps counting" (intermittent; the hold is released by `pointerout` when the
    entrance animation slides the button under a still mouse, see the `pointerout` handler in `waste-page.js`).
  - `portal.spec.mjs` "preview lesson links…" (intermittent; it reads `window.McModules` as soon as the URL changes,
    before the new page's scripts have run).

## What is left

- Deploy: merge the branch, let Vercel build, then check load on a signed-in iPad (manager and crew) and the profile panel.
- The QA findings from the lost round (14 high, 46 medium) need to be recovered or re-run.
- From the lost round's notes: the McAssist backend is meant to let a typed "yes" resolve only LOW-risk plans; check
  whether that rule exists on `main` before aligning tests/UI with it.
