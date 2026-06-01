/**
 * GET /api/connect/strava/start
 *
 * Manual Strava OAuth initiator that bypasses NextAuth's signIn flow.
 *
 * Why we have this: when a user is already signed in (e.g. via Google)
 * and clicks "+ Connecter Strava", NextAuth's signIn('strava') tries
 * to either CREATE a brand-new user (because the synthetic Strava
 * email `strava-{id}@strava.local` doesn't match the Google email) or
 * fails the OAuth callback entirely. Neither produces what we want
 * — we want the Strava credentials *added* to the currently-signed-in
 * user's row, not a second account or a hard error.
 *
 * This endpoint:
 *   1. Requires an existing NextAuth session — kicks anonymous
 *      visitors back to /login.
 *   2. Generates a state token, stores it in a short-lived HttpOnly
 *      cookie alongside the user id we're linking, and redirects
 *      to Strava's authorize URL.
 *   3. After the user approves on Strava, Strava redirects to
 *      /api/connect/strava/callback (sibling file) which exchanges
 *      the code for tokens and writes them into next_auth.accounts
 *      under the EXISTING user id from the cookie.
 *
 * No new user is ever created.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/api-auth';
import crypto from 'crypto';

export async function GET(req: NextRequest) {
  // Use the shared getAuthedUser helper instead of getServerSession
  // directly — it knows about both the NextAuth cookie path and the
  // Bearer-token path used by the iOS client, and routes through
  // 'next-auth/next' which is the App-Router-compatible entrypoint.
  // An earlier version of this file imported from 'next-auth' which
  // returned null sessions in App-Router route handlers (despite a
  // valid cookie), trapping users in a redirect loop on the
  // welcome page.
  const authed = await getAuthedUser(req);
  if (!authed?.id) {
    const url = new URL('/login', req.url);
    url.searchParams.set('callbackUrl', '/');
    return NextResponse.redirect(url);
  }
  const userId = authed.id;

  const clientId = process.env.STRAVA_CLIENT_ID;
  if (!clientId) {
    console.error('[connect/strava] STRAVA_CLIENT_ID env var missing');
    return NextResponse.redirect(new URL('/?error=strava_misconfigured', req.url));
  }

  // Random state token for CSRF protection. We bind it to the user
  // id so even if the cookie leaks, the callback only writes to the
  // user who initiated the flow.
  const state = crypto.randomBytes(16).toString('hex');
  // 10-minute TTL is plenty — Strava authorize page is fast and we
  // don't want a forgotten tab opening a window for replay.
  const stateCookieValue = JSON.stringify({ s: state, u: userId, t: Date.now() });

  // Compute redirect_uri from the current request's host so we work
  // on both production AND Vercel preview deployments. Strava only
  // checks the *domain* (Authorization Callback Domain on the dev
  // console), not the full path — so any subdomain that resolves to
  // our Next.js app will accept this callback once the dev console
  // is set to the right base domain.
  const proto = req.headers.get('x-forwarded-proto') ?? 'https';
  const host  = req.headers.get('host') ?? req.nextUrl.host;
  const redirectUri = `${proto}://${host}/api/connect/strava/callback`;

  const authUrl = new URL('https://www.strava.com/oauth/authorize');
  authUrl.searchParams.set('client_id',       clientId);
  authUrl.searchParams.set('redirect_uri',    redirectUri);
  authUrl.searchParams.set('response_type',   'code');
  authUrl.searchParams.set('scope',           'read,activity:read_all,activity:write');
  // 'force' makes Strava always show the consent screen — without
  // it, returning users silently re-issue a token that may not
  // include the writes scope we added later.
  authUrl.searchParams.set('approval_prompt', 'force');
  authUrl.searchParams.set('state',           state);

  const response = NextResponse.redirect(authUrl);
  response.cookies.set({
    name:     'tle_strava_link',
    value:    stateCookieValue,
    httpOnly: true,
    secure:   true,
    sameSite: 'lax',
    path:     '/',
    maxAge:   60 * 10,  // 10 minutes
  });
  return response;
}
