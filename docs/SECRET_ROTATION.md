# Secret rotation runbook

## Why this exists

Several OAuth client secrets were pasted in plain text during the
multi-user bring-up:

- `GOOGLE_CLIENT_SECRET` (Google Cloud Console)
- `STRAVA_CLIENT_SECRET` (strava.com/settings/api)
- `SUPABASE_SERVICE_ROLE_KEY` (Supabase dashboard)

The chat transcript is not crackable by a random attacker — these
secrets are safe at rest in Vercel + GitHub envs. But good hygiene
when you're running an actual multi-user product (even at family +
friends scale) is to **rotate any secret that has appeared outside
of a secrets manager**.

This file is the step-by-step. Each section is independent — rotate
in any order, or all together.

---

## Google OAuth Client Secret

1. **Generate the new secret in Google Cloud Console:**

   https://console.cloud.google.com/apis/credentials → click on your
   OAuth Client (`the-little-explorer-web`) → "**RESET SECRET**"

   The new secret appears in a modal. Copy it now — Google won't show
   it again.

2. **Update Vercel env (production + development):**

   ```bash
   cd /Users/Florian/code/the-little-explorer
   # Remove old values
   vercel env rm GOOGLE_CLIENT_SECRET production --yes
   vercel env rm GOOGLE_CLIENT_SECRET development --yes
   # Add new ones via stdin (no shell history exposure)
   printf '%s' '<paste new secret>' | vercel env add GOOGLE_CLIENT_SECRET production
   printf '%s' '<paste new secret>' | vercel env add GOOGLE_CLIENT_SECRET development
   ```

3. **Update local `.env.local`:**

   Open `/Users/Florian/code/the-little-explorer/.env.local`, replace
   the `GOOGLE_CLIENT_SECRET=` line with the new value. Save.
   Restart `npm run dev`.

4. **Redeploy prod:**

   ```bash
   vercel deploy --prod
   ```

5. **Verify:**

   - Sign out of the prod app
   - Sign back in via Google → should succeed
   - The old secret is now dead — anyone with the leaked one can't use it

---

## Strava OAuth Client Secret

1. **Generate the new secret on Strava:**

   https://www.strava.com/settings/api → "Mon application API" →
   "**Générer un nouveau secret de client**" → confirm.

   Copy the new secret immediately.

   **⚠️ Side effect:** rotating Strava's client secret invalidates
   **every refresh token** issued by the old secret. Every user who
   linked Strava will need to **re-authorize** the app (click
   "+ CONNECTER STRAVA" again). For a 5-10 user app this is OK
   but worth telling them in advance.

2. **Update Vercel env:**

   ```bash
   vercel env rm STRAVA_CLIENT_SECRET production --yes
   printf '%s' '<paste new secret>' | vercel env add STRAVA_CLIENT_SECRET production
   ```

3. **Update GitHub Secrets** (for the cron):

   ```bash
   printf '%s' '<paste new secret>' | gh secret set STRAVA_CLIENT_SECRET
   ```

4. **Update local `.env.local`:**

   Replace `STRAVA_CLIENT_SECRET=` line. Save. Restart `npm run dev`.

5. **Redeploy + tell users to reconnect:**

   ```bash
   vercel deploy --prod
   ```

   Then ping Helena + any friend who'd linked Strava and tell them
   to log in and click "+ CONNECTER STRAVA" again. The old refresh
   tokens in `next_auth.accounts` are now dead; the new OAuth flow
   will overwrite them.

   **Optional**: run this SQL to nuke the stale Strava accounts so
   users get a fresh "+ CONNECTER STRAVA" button:

   ```sql
   update next_auth.users set athlete_id = null, strava_scope = null;
   delete from next_auth.accounts where provider = 'strava';
   ```

---

## Supabase service_role key

⚠️ The hardest to rotate — it touches the most things.

1. **Generate a new service_role key:**

   Supabase dashboard → Project Settings → API → "**Reset
   service_role API key**" (under Legacy keys).

2. **Update everywhere it's used:**

   ```bash
   # Vercel (both envs)
   vercel env rm SUPABASE_SERVICE_ROLE_KEY production --yes
   vercel env rm SUPABASE_SERVICE_ROLE_KEY development --yes
   printf '%s' '<new key>' | vercel env add SUPABASE_SERVICE_ROLE_KEY production
   printf '%s' '<new key>' | vercel env add SUPABASE_SERVICE_ROLE_KEY development

   # GitHub (for the multi-user cron)
   printf '%s' '<new key>' | gh secret set SUPABASE_SERVICE_ROLE_KEY

   # Local .env.local — replace the line, save, restart dev server
   ```

3. **Redeploy:**

   ```bash
   vercel deploy --prod
   ```

4. **Verify:**

   - `/admin` still loads (uses service_role to query users)
   - `/api/activities` still returns your feed
   - `/api/strava/sync` still works (POST it from /admin or via
     the "↻ RE-SYNCER STRAVA" button)
   - Next cron run completes (check GitHub Actions tab)

5. **Rotate the anon key too** while you're there (Supabase same
   page → "Reset anon API key"). Update `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   in Vercel + local. The anon key is public-facing so it's lower
   risk than service_role, but rotating together keeps things tidy.

---

## Quick check that everything still works after rotation

After any rotation, do this 60-second smoke test:

1. **Login**: sign out of prod, sign back in with Google → success
2. **Activities feed**: see your activities → success
3. **Admin**: `/admin` shows the user list → success (service_role works)
4. **Strava sync**: click "↻ RE-SYNCER STRAVA" → "SYNCHRO…" → reload, feed updates → success
5. **Settings**: `/settings` loads + you can save a change → success

If all 5 pass, rotation was clean. If any fail, the new value was
likely typed/pasted wrong — re-check the env in Vercel dashboard.

---

## What NEVER to do

- ❌ Commit a secret to git (even gitignored .env.local — never `git add` it explicitly)
- ❌ Paste a secret in a Slack/Discord/issue tracker without immediate rotation after
- ❌ Pass a secret as a positional CLI arg (`vercel env add X --value <secret>`) — it ends up in shell history. Use stdin (`printf '%s' '<secret>' | …`) instead.
- ❌ Print a secret in a Vercel function log via `console.log(process.env.X)` — Vercel logs are stored and indexable.
