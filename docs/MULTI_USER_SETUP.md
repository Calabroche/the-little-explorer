# Multi-user setup runbook

End-to-end checklist for taking the multi-user system from "scaffolded" to
"live for family & friends". Phases marked **(USER)** require manual steps in
external dashboards; everything else is code.

---

## Phase 1 — External credentials (USER)

### 1.1 — Supabase

1. Go to <https://app.supabase.com> → **New project**
   - **Name**: `the-little-explorer`
   - **Region**: `eu-west-3` (Paris) — closest to Vercel's Paris edge
   - **Plan**: Free tier (unlimited rows, 500MB DB — plenty for our 5-10 users)
2. Once provisioned: **Project Settings → API**, copy:
   - `Project URL` → goes into `SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` key → goes into `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` key → goes into `SUPABASE_SERVICE_ROLE_KEY` (NEVER commit)
3. **SQL Editor → New query**, paste the contents of [`supabase/schema.sql`](../supabase/schema.sql), run.

### 1.2 — Google OAuth

1. <https://console.cloud.google.com> → **APIs & Services → Credentials**
2. **+ Create Credentials → OAuth client ID**
   - **Application type**: Web application
   - **Authorized redirect URIs**:
     - `http://localhost:3000/api/auth/callback/google`
     - `https://the-little-explorer-app.vercel.app/api/auth/callback/google`
3. Copy **Client ID** and **Client Secret** into env.
4. **OAuth consent screen → Test users**: add the emails of the people who'll be using the app (Google blocks unverified apps from non-test-user accounts until you go through verification).

### 1.3 — Strava (existing app)

1. <https://www.strava.com/settings/api>
2. Update **Authorization Callback Domain** from `localhost` to `the-little-explorer-app.vercel.app` (this is the domain the OAuth redirect lands on; Strava lets you list ONE).
3. Keep the existing `STRAVA_CLIENT_ID=229267` and client secret.

### 1.4 — Env wiring

Local: copy `.env.example` → `.env.local`, fill in everything above, plus:

```
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=$(openssl rand -base64 32)
```

Vercel: **Project Settings → Environment Variables** → add the same keys.
Set `NEXTAUTH_URL=https://the-little-explorer-app.vercel.app` for the Production env.

---

## Phase 2 — Code (DONE in this PR)

- ✅ `supabase/schema.sql` — DB schema with NextAuth tables + `activities`
- ✅ `src/lib/db.ts` — Supabase admin + public clients (lazy)
- ✅ `src/lib/auth.ts` — NextAuth config (Google + Strava providers, Supabase adapter)
- ✅ `src/app/api/auth/[...nextauth]/route.ts` — auth route handler
- ✅ `src/app/login/page.tsx` — login UI
- ✅ `src/types/next-auth.d.ts` — session.user type augmentation
- ✅ `scripts/migrate-to-supabase.mjs` — one-shot data migration

Until `SUPABASE_URL` + `NEXTAUTH_SECRET` exist in the env, `/api/auth/*`
returns `503 auth_not_configured` and the rest of the app keeps using the
existing JSON-file storage — i.e. shipping this PR doesn't break prod.

---

## Phase 3 — Wire activities API to session (TODO, next PR)

- `/api/activities`: read `user_id` from the NextAuth session, query
  `activities` table. Fallback to existing JSON path while migration is
  in flight (toggle via `isSupabaseConfigured()`).
- `/api/strava/connect`: dedicated route for the "Connect Strava" button
  when the user signed in with Google first. Mirrors the NextAuth Strava
  flow but doesn't create a new session — just attaches the athlete.
- `/api/strava-webhook` POST: look up `user_id` by `athlete_id` (via the
  `user_by_athlete` RPC), trigger sync for THAT user only.

---

## Phase 4 — Migrate Florian + Helena (USER + script)

1. Deploy Phase 2 (this PR).
2. Sign in to the deployed app once with each Google account so NextAuth
   creates the `users` row. Note the emails used.
3. Run locally (against the prod Supabase):

   ```bash
   export SUPABASE_URL=...
   export SUPABASE_SERVICE_ROLE_KEY=...

   # Dry run first
   node scripts/migrate-to-supabase.mjs --user=florian --email=florian.calabrese@gmail.com --dry
   node scripts/migrate-to-supabase.mjs --user=florian --email=florian.calabrese@gmail.com

   node scripts/migrate-to-supabase.mjs --user=helena   --email=<helena's email> --dry
   node scripts/migrate-to-supabase.mjs --user=helena   --email=<helena's email>
   ```

4. Each athlete also needs Strava connected — log in again with the
   "Continuer avec Strava" button to attach `athlete_id`. (Until then the
   webhook can't route new rides to the right user.)

---

## Phase 5 — Test + cleanup

- E2E checklist:
  - [ ] Florian logs in (Google) → sees historic activities
  - [ ] Florian connects Strava → next ride syncs into HIS account only
  - [ ] Helena same
  - [ ] New friend signs up (Google) → empty feed
  - [ ] New friend connects Strava → next ride appears in their feed only
  - [ ] Webhook: trigger a Strava event, confirm GitHub Actions sync
        only updates the right user's rows
- Delete `data/users/` from the repo once migration is verified (kept in
  git history; nothing in code paths reads it after Phase 3 ships).
- Remove the per-user single-token `STRAVA_REFRESH_TOKEN` env on Vercel
  + GitHub Secrets; sync script reads each user's token from the DB.
