/**
 * GET /api/connect/strava/callback?code=...&state=...
 *
 * Companion to /api/connect/strava/start — receives Strava's OAuth
 * code, exchanges it for tokens, and UPSERTS those tokens onto the
 * already-signed-in user's row in next_auth.accounts (provider =
 * 'strava'). No new user is ever created — the existing session
 * stays attached to the same NextAuth user record.
 *
 * Failures (state mismatch, token exchange error, missing session)
 * redirect back to / with ?error=<reason> so the home page banner
 * can surface a friendly message.
 *
 * Success redirects to /?strava=connected and fires a kickoff sync
 * by calling /api/strava/sync internally so the user sees activities
 * land within seconds of authorizing.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { buildAuthOptions } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/db';

interface StateCookie {
  s: string;          // CSRF state
  u: string;          // userId who initiated
  t: number;          // issued-at ms
}

interface StravaTokenResponse {
  access_token:  string;
  refresh_token: string;
  expires_at:    number;
  athlete?: {
    id: number;
  };
}

function redirectWithError(req: NextRequest, code: string): NextResponse {
  const url = new URL('/', req.url);
  url.searchParams.set('error', code);
  const r = NextResponse.redirect(url);
  // Clear the state cookie regardless of outcome.
  r.cookies.delete('tle_strava_link');
  return r;
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(buildAuthOptions());
  const sessionUserId = (session as unknown as { user?: { id?: string } })?.user?.id;
  if (!sessionUserId) {
    return redirectWithError(req, 'strava_no_session');
  }

  // ── 1. Validate state ─────────────────────────────────────────
  const url     = new URL(req.url);
  const code    = url.searchParams.get('code');
  const state   = url.searchParams.get('state');
  const errStr  = url.searchParams.get('error');
  if (errStr) {
    // User clicked "Deny" on Strava — friendly message, not a bug.
    return redirectWithError(req, 'strava_denied');
  }
  if (!code || !state) {
    return redirectWithError(req, 'strava_no_code');
  }

  const cookieRaw = req.cookies.get('tle_strava_link')?.value;
  if (!cookieRaw) {
    return redirectWithError(req, 'strava_no_state_cookie');
  }
  let cookieData: StateCookie | null = null;
  try {
    cookieData = JSON.parse(cookieRaw) as StateCookie;
  } catch {
    return redirectWithError(req, 'strava_bad_cookie');
  }
  if (!cookieData || cookieData.s !== state || cookieData.u !== sessionUserId) {
    return redirectWithError(req, 'strava_state_mismatch');
  }
  // Expire after 10 min (matches the cookie maxAge, defensive).
  if (Date.now() - cookieData.t > 10 * 60 * 1000) {
    return redirectWithError(req, 'strava_state_expired');
  }

  // ── 2. Exchange code for tokens ───────────────────────────────
  const clientId     = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error('[connect/strava] Strava env vars missing');
    return redirectWithError(req, 'strava_misconfigured');
  }

  const tokenRes = await fetch('https://www.strava.com/api/v3/oauth/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({
      client_id:     clientId,
      client_secret: clientSecret,
      code,
      grant_type:    'authorization_code',
    }),
  });

  if (!tokenRes.ok) {
    const errBody = await tokenRes.text();
    console.error('[connect/strava] token exchange failed:', tokenRes.status, errBody);
    return redirectWithError(req, 'strava_token_exchange');
  }

  const tokens = await tokenRes.json() as StravaTokenResponse;
  const athleteId = tokens.athlete?.id;
  if (!athleteId) {
    console.error('[connect/strava] token response missing athlete.id', tokens);
    return redirectWithError(req, 'strava_no_athlete');
  }

  // ── 3. Persist into next_auth.users + next_auth.accounts ──────
  const supabase = supabaseAdmin();

  // 3a. Update the user's row with athlete_id + scope so the sidebar
  // recognises them as a Strava-linked user (drives the "Connecter
  // Strava" button visibility).
  const { error: userErr } = await supabase
    .schema('next_auth')
    .from('users')
    .update({
      athlete_id:   athleteId,
      strava_scope: 'read,activity:read_all,activity:write',
    })
    .eq('id', sessionUserId);
  if (userErr) {
    console.error('[connect/strava] failed to update user row:', userErr.message);
    return redirectWithError(req, 'strava_persist_user');
  }

  // 3b. UPSERT into accounts so the refresh-token-based sync flow
  // (api/strava/sync, sync-one, upload-activity) finds the row by
  // (userId, provider) or by providerAccountId.
  const accountRow = {
    userId:            sessionUserId,
    type:              'oauth',
    provider:          'strava',
    providerAccountId: String(athleteId),
    refresh_token:     tokens.refresh_token,
    access_token:      tokens.access_token,
    expires_at:        tokens.expires_at,
    token_type:        'Bearer',
    scope:             'read,activity:read_all,activity:write',
  };
  // No native UPSERT path through PostgREST without a primary key
  // touch, so do delete-then-insert in a single roundtrip pair.
  // If the user re-connects (re-grants scope), this cleanly replaces
  // the old row instead of duplicating it.
  await supabase
    .schema('next_auth')
    .from('accounts')
    .delete()
    .eq('userId',   sessionUserId)
    .eq('provider', 'strava');

  const { error: accountErr } = await supabase
    .schema('next_auth')
    .from('accounts')
    .insert(accountRow);
  if (accountErr) {
    console.error('[connect/strava] failed to insert account row:', accountErr.message);
    return redirectWithError(req, 'strava_persist_account');
  }

  // ── 4. Kick off a background sync so activities show up fast ──
  // Fire-and-forget — the home page will refetch on focus anyway.
  const proto = req.headers.get('x-forwarded-proto') ?? 'https';
  const host  = req.headers.get('host') ?? req.nextUrl.host;
  void fetch(`${proto}://${host}/api/strava/sync?force=1`, {
    method:  'POST',
    headers: { cookie: req.headers.get('cookie') ?? '' },
  }).catch(err => console.warn('[connect/strava] kickoff sync failed:', err));

  // ── 5. Redirect home with a success banner. ───────────────────
  const successUrl = new URL('/', req.url);
  successUrl.searchParams.set('strava', 'connected');
  const r = NextResponse.redirect(successUrl);
  r.cookies.delete('tle_strava_link');
  return r;
}
