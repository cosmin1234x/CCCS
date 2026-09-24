# McTraining crew hub

A responsive restaurant portal with a golden-yellow theme, role-aware dashboards, Firebase accounts and a working McAssist connection.

## Run locally

Requires Node 22 or newer. Run `npm ci`, link the existing Vercel project with `npx vercel link --project cccs`, then run `npx vercel env pull .env.local`. Keep the environment file private. Run `npm run build` and `npm run dev:local`, then open http://127.0.0.1:3000.

`npm test` covers overnight shifts, break deductions, week boundaries, shift collisions, authentication, request validation and provider error handling. `npm run build` publishes only explicitly listed public assets.

## Accounts and data

- Existing Firebase accounts continue to sign in. Profiles are read from `users/{uid}` in `mc-training-portal`.
- New accounts are created as crew. Only a trusted administrator should assign manager roles in Firebase. Supported manager roles: `manager`, `shiftCreator`, `admin`.
- Profiles need `name`, `role` and `storeId`. Optional `storeName`, `hourlyRate`, `stars` and `badge` customise the dashboard.
- Shared shifts use the existing `stores/{storeId}/Shifts` collection and fields `userId`, `userName`, `date`, `start`, `end`, `station`, `role`. New shifts also record `breakMinutes`, `createdBy` and `createdAt`.
- Crew queries filter by exact authenticated user ID. The manager view queries the store's shifts and team profiles.
- Availability is saved in `users/{uid}.availability`. Learning completion is saved in `users/{uid}/portalTraining/{moduleId}`.
- Pay is an estimate from scheduled time minus recorded unpaid breaks and the profile's hourly rate. It is not payroll, attendance, or a promise of actual earnings. No hourly rate means no pay estimate.
- Existing fabricated local-storage shifts are deliberately not imported into the shared rota. Existing Firebase records are retained. Old browser-only learning progress is not treated as verified account progress.

## McAssist

`OPENAI_API_KEY` is server-only. `OPENAI_MODEL` defaults to `gpt-4o-mini`. Optional `FIREBASE_PROJECT_ID` defaults to `mc-training-portal`. Both `/api/ai-chat` and `/api/mcassist` use the same Firebase ID-token verification, conversation handling, timeouts and bounded input.

The assistant provides guidance and uses the signed-in page's shift/module context. It cannot write or delete shifts. Managers publish individual shifts through the planner after reviewing availability and clashes. The unsafe legacy bulk-generation endpoint now returns HTTP 410.

The assistant has a per-instance limit of 20 requests per user per minute. For stronger global limits across serverless instances, configure a shared rate-limit store or Vercel Firewall policy.

## Preview mode

Use `/main.html?preview=crew` or `/main.html?preview=manager` to explore without an account. Sample data is clearly labelled, isolated by role and retained only in session storage for the tab. It never writes to Firebase. Preview chat is a labelled example; sign in to use the real AI service.

## Deployment and access checks

Vercel project: `cccs`. Existing production domains include `www.amyai.space` and `amyai.space`. `npx vercel deploy` creates a preview; `npx vercel deploy --prod` publishes the verified build.

Firestore Security Rules remain a separately managed Firebase setting. Verify that they restrict crew to their own profile, availability, learning and assigned shifts; restrict managers to their store; and prevent self-assigned role, store, pay and star changes. The redesign does not silently replace existing database rules or migrate existing users.

The repository previously contained `mc-seeder/serviceAccountKey.json`. That file is removed from the current source and excluded from deployment. Treat its historical value as exposed and revoke it in Google Cloud IAM if it remains active. Removing a file does not erase Git history. Firebase public web configuration is intentionally public and is not a service-account secret.

The old committed `node_modules` files are removed from version control; dependencies are reproduced from the lockfile. Legacy source files remain in Git for reference but are not published by the public-asset build.


## V2 roles, verification and McAssist actions

The crew hub now has three approved roles:

- `crew`: own shifts, learning, availability, recognition and McAssist guidance/actions for their own account.
- `crewTrainer`: Crew access plus the station verification workflow. Crew Trainers can start verifications but cannot plan team shifts.
- `manager`: team/rota access, shift planning and McStars actions. Managers can view verification status but cannot sign a Crew Trainer verification.

Signup lets a user choose Crew Member, Crew Trainer or Manager. Crew access starts immediately. Crew Trainer and Manager choices are stored as pending role requests so a user cannot self-promote; a current Manager can approve them from the team page. The approved role in `users/{uid}.role` is always the source of truth.

Station verification lives under `stores/{storeId}/verifications`. A Crew Trainer starts a check, then the assigned Crew Trainer and Crew Member each sign their own side. Only the server endpoint can write verification records. When both signatures are present, the station is added to the Crew Member's `verifiedStations` list.

McAssist is shown only on the McAssist page. It reads role-scoped Firestore data and can perform actions that match the approved role. Examples include updating the signed-in user's availability, starting a verification as a Crew Trainer, and creating/updating/removing shifts or adding McStars as a Manager. McAssist never creates a signature for either person.

### Firebase Admin on Vercel

Server-side Firestore actions require Firebase Admin credentials. Add a Vercel environment variable named `FIREBASE_SERVICE_ACCOUNT_JSON` containing the JSON for a dedicated Firebase service account. Keep it only in Vercel environment settings; never commit the JSON file or paste the secret into client code. Keep `FIREBASE_PROJECT_ID=mc-training-portal` if the project ID is not already configured.

The repository includes `firestore.rules` as the intended security policy. Deploy those rules separately with the Firebase CLI or Firebase Console after review. Vercel deployment does not automatically publish Firestore rules.

### Learning content

The learning page shows one recommended next module, role-specific completion totals, category/search/progress filters and six modules at a time. Preview links stay in preview mode. Live data updates preserve learning filters and the McAssist conversation instead of replacing their DOM.

Run `npm test` for API/domain tests. For browser regressions, run `npx playwright install chromium webkit`, then `npm run test:browser`. The suite covers desktop Chromium and iPad portrait, iPad landscape and iPhone WebKit, using isolated Firebase/API fixtures without writing to the live restaurant database. These are emulated browsers, not physical-device tests.

The learning hub is searchable and grouped by Essentials, Safety, Kitchen, Service, Cleanliness, Operations, Crew Trainer and Manager. It includes key station topics such as Fries, Grill & Beef, Chicken & Fryer, Kitchen Assembly, Breakfast, Front Counter, Drive-thru, Drinks & McCafé and Dining Area. The modules intentionally avoid inventing proprietary cook cycles, exact temperatures or allergen guarantees; current official restaurant guidance and trainer/manager instructions take priority.


## McAssist Manager Control V3

Managers now get an audited, server-side control layer over the operational Firestore data for their own store. McAssist can read current team details and can execute explicit Manager requests for:

- hourly rates
- Crew Member / Crew Trainer / Manager roles
- profile name, badge, manager notes and store display name
- McStars adjustments
- team availability
- learning-module completion/reset
- pending role-request approval/rejection
- shift creation, editing and deletion
- member detail lookups across profile, learning, shifts and verification summaries
- revoking an existing station verification when retraining is required

Manager writes are validated on the server and logged under `stores/{storeId}/assistantAudit` with the acting Manager, target member, action and before/after values. McAssist can chain several explicit actions from one message, with a maximum of six database actions per request.

McAssist deliberately does not receive unrestricted raw Firestore write access. It cannot forge or grant station verification, write arbitrary documents/fields, move a user across store security boundaries, or silently demote the signed-in Manager account. Those boundaries prevent a model mistake from bypassing the role and verification system.
