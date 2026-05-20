# Google OAuth verification runbook

## Where we are today

The OAuth consent screen is in **"Testing"** mode. That means:
- Up to **100 emails** can use the app (the "Test users" allowlist)
- Anyone NOT on the allowlist gets `Error 403: access_denied` from Google when they click "Continuer avec Google"
- No Google review needed

This is fine while you're inviting family + friends one-by-one. Once you want any Gmail user to be able to sign up, you need to **publish** the consent screen and (depending on the scopes) go through Google's verification process.

---

## When you'd want to publish

| Situation | Action |
|---|---|
| ≤100 trusted testers, manually onboarded | Stay in Testing — no work needed |
| You want random users to be able to sign up | Publish + verify |
| You're only using `userinfo.email`, `userinfo.profile`, `openid` scopes | Self-service publish (no Google review) |
| You use sensitive scopes (Gmail, Drive, Calendar, etc.) | Full Google verification (4-6 weeks) |

You're in the **non-sensitive scopes** bucket (just `email`, `profile`, `openid`), so publishing is **self-service**. No Google human review. Should be live within minutes.

---

## Publish steps

1. **Open the consent screen config:**

   https://console.cloud.google.com/apis/credentials/consent
   
   Select project `the-little-explorer`.

2. **Verify your branding info is complete.** Google requires all of these to publish:
   - App name: `The Little Explorer`
   - User support email: `florian.calabrese@gmail.com`
   - App logo (optional but nice — square PNG, 120×120 min)
   - Application home page: `https://the-little-explorer-app.vercel.app`
   - Application privacy policy URL: **MISSING** ← needs adding (see below)
   - Application terms of service URL: optional
   - Authorized domains: `vercel.app` should be listed
   - Developer contact info: `florian.calabrese@gmail.com`

3. **Privacy policy** — this is the only real blocker.
   
   Google requires a privacy policy URL before publishing. Two options:
   
   - **Quickest**: add a `/privacy` route to the Vercel app with a short policy. Copy-paste from a template generator (e.g., termsfeed.com, freeprivacypolicy.com) and host it at `https://the-little-explorer-app.vercel.app/privacy`.
   - **No-code**: host a Google Doc or Notion page with the policy, make it publicly visible, paste that URL.

   The policy should mention:
   - You collect: email, name, profile image (from Google), athlete ID + activity data (from Strava)
   - Used only to display the user's own data to themselves
   - Not shared with third parties
   - Hosted in Supabase EU region
   - User can request deletion via email

4. **Click "PUBLISH APP"** at the top of the OAuth consent screen page.
   - Confirmation modal → "CONFIRM"
   - The app status flips from **Testing** → **In production**

5. **Verify** — try signing in from a Gmail account that's NOT in Test Users. Should now work.

---

## What you'll lose by publishing

- The "Test users" allowlist is **bypassed** — anyone can sign up.
- Google shows a smaller "unverified app" warning (one-time per user) instead of blocking access entirely.
- For non-sensitive scopes (our case), the warning is barely noticeable. Users click "Continue" once.

If you want to remove the unverified warning entirely, you'd go through **Google verification** (which IS the multi-week human review). For a personal app, skip this — the warning is acceptable.

---

## Rolling back

Published apps can be **moved back to Testing** at any time from the same page. Existing signed-up users keep their accounts; only new signups are blocked.

---

## Estimated effort

| Step | Time |
|---|---|
| Add privacy policy page or URL | 30 min |
| Click "Publish App" | 2 min |
| Test with a clean Gmail | 2 min |
| **Total** | **~35 min** |

When you're ready, we can wire up `/privacy` as a Next.js route at the same time as the publish step.
