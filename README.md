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
