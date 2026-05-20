/**
 * POST /api/strava/sync — pull the signed-in user's Strava activities
 * into Supabase.
 *
 * Trigger model: client calls this once after the user finishes Strava
 * OAuth (or any time the feed is empty for a user that has a Strava
 * account linked). Idempotent: upserts on activity id, so re-running
 * just refreshes the metadata for already-imported rows.
 *
 * What we fetch:
 *   - GET /api/v3/athlete/activities?per_page=200   (summary list, 1 API call)
 *   - We do NOT pull streams here (HR, speed, altitude, GPS) — that
 *     would require 1 extra API call per activity (200 = Strava's
 *     rate-limit ceiling per 15 min). Streams come in via the
 *     background sync workflow (scripts/sync-strava.mjs + GitHub
 *     Actions) which is already wired up for the legacy users and
 *     will be extended to query users from Supabase later.
 *
 * Token handling:
 *   - We read the refresh_token NextAuth stored at first sign-in
 *     (next_auth.accounts.refresh_token, joined to next_auth.users via
 *     userId). Strava rotates the refresh token on every refresh, so
 *     we persist the new one back to the same row.
 *
 * Auth:
 *   - Session required. The signed-in user can only sync THEIR OWN
 *     activities — we always derive userId from the session, never
 *     from request body.
 */

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { buildAuthOptions } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// Vercel Hobby plan caps function duration at 60s; bump from the 10s
// default since we may need to wait on Strava's token + activities
// endpoints sequentially.
export const maxDuration = 60;

const STRAVA_TOKEN_URL      = 'https://www.strava.com/api/v3/oauth/token';
const STRAVA_ACTIVITIES_URL = 'https://www.strava.com/api/v3/athlete/activities';

// Sport mapping (same set as scripts/sync-strava.mjs + /api/activities).
const CYCLING = new Set(['Ride', 'VirtualRide', 'EBikeRide', 'MountainBikeRide', 'GravelRide', 'Velomobile', 'Handcycle']);
const RUNNING = new Set(['Run', 'TrailRun', 'VirtualRun']);
const SKI     = new Set(['AlpineSki', 'BackcountrySki', 'NordicSki', 'RollerSki']);
// Avoid `new Set([...Set, ...Set])` which needs --downlevelIteration on
// our es5 target. Just list the supported types explicitly.
const SUPPORTED = new Set([
  // cycling
  'Ride', 'VirtualRide', 'EBikeRide', 'MountainBikeRide', 'GravelRide', 'Velomobile', 'Handcycle',
  // running
  'Run', 'TrailRun', 'VirtualRun',
  // skiing
  'AlpineSki', 'BackcountrySki', 'NordicSki', 'RollerSki',
  // other
  'Hike', 'Snowshoe', 'Walk', 'Swim',
]);

function sportFromType(t: string): string {
  if (CYCLING.has(t)) return 'cycling';
  if (RUNNING.has(t)) return 'running';
  if (SKI.has(t))     return 'ski';
  if (t === 'Hike')     return 'hiking';
  if (t === 'Snowshoe') return 'snowshoe';
  if (t === 'Walk')     return 'walking';
  if (t === 'Swim')     return 'swim';
  return 'cycling';
}

export async function POST() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const session: any = await getServerSession(buildAuthOptions());
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const userId = session.user.id as string;

  // ── 1. Fetch the user's Strava refresh_token from next_auth.accounts ──
  const { data: accountRows, error: accErr } = await supabaseAdmin()
    .schema('next_auth')
    .from('accounts')
    .select('refresh_token, providerAccountId')
    .eq('userId',  userId)
    .eq('provider', 'strava')
    .limit(1);

  if (accErr) {
    console.error('[strava-sync] accounts query failed:', accErr.message);
    return NextResponse.json({ error: 'db_error' }, { status: 500 });
  }
  if (!accountRows || accountRows.length === 0) {
    return NextResponse.json({ error: 'strava_not_connected' }, { status: 400 });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stravaAccount = accountRows[0] as any;
  const refreshToken  = stravaAccount.refresh_token as string;

  // ── 2. Refresh to get a fresh access_token ──
  const clientId     = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: 'strava_client_not_configured' }, { status: 500 });
  }

  const tokenRes = await fetch(STRAVA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id:     clientId,
      client_secret: clientSecret,
      grant_type:    'refresh_token',
      refresh_token: refreshToken,
    }),
  });
  if (!tokenRes.ok) {
    const txt = await tokenRes.text();
    console.error('[strava-sync] token refresh failed:', tokenRes.status, txt.slice(0, 200));
    return NextResponse.json({ error: 'token_refresh_failed' }, { status: 502 });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tokenData = await tokenRes.json() as any;
  const accessToken = tokenData.access_token as string;

  // Persist the rotated refresh_token. Strava issues a new one on every
  // /oauth/token call; if we don't store it, the next sync will use a
  // stale token and silently 401.
  if (tokenData.refresh_token && tokenData.refresh_token !== refreshToken) {
    await supabaseAdmin()
      .schema('next_auth')
      .from('accounts')
      .update({
        refresh_token: tokenData.refresh_token as string,
        access_token:  accessToken,
        expires_at:    tokenData.expires_at ?? null,
      })
      .eq('userId',  userId)
      .eq('provider', 'strava');
  }

  // ── 3. Fetch full list of activities (paginated) ──
  // Strava caps per_page at 200. Loop until we get a short page (= last
  // one) or hit the MAX_PAGES safety cap. 10 pages = 2000 activities,
  // ~5 years for a typical rider — beyond that the Strava 200-req/15min
  // rate limit becomes a concern and we'd want a background queue.
  const MAX_PAGES = 10;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const activities: any[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const r = await fetch(`${STRAVA_ACTIVITIES_URL}?per_page=200&page=${page}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!r.ok) {
      const txt = await r.text();
      console.error(`[strava-sync] page ${page} fetch failed:`, r.status, txt.slice(0, 200));
      // On the very first page we have nothing to return; on later pages
      // we keep what we already pulled and stop.
      if (page === 1) {
        return NextResponse.json({ error: 'activities_fetch_failed' }, { status: 502 });
      }
      break;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const batch = await r.json() as any[];
    activities.push(...batch);
    // Strava returns fewer than per_page when we hit the end. No need
    // to ask for the next page — it'd be empty.
    if (batch.length < 200) break;
  }

  // ── 4. Filter to supported activity types + build rows ──
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = activities
    .filter(a => SUPPORTED.has(a.type))
    .map(a => {
      const durationMin   = Math.round((a.moving_time ?? 0) / 60);
      const distanceKm    = +((a.distance ?? 0) / 1000).toFixed(2);
      const elevationM    = Math.round(a.total_elevation_gain ?? 0);
      const avgSpeedKmh   = +((a.average_speed ?? 0) * 3.6).toFixed(2);
      const maxSpeedKmh   = +((a.max_speed ?? 0)     * 3.6).toFixed(2);

      // Mirror the JSON shape used by the existing /api/activities
      // transform pipeline. Streams (gps, heartrate, altitude,
      // speed_kmh, distance_m, time_s) are absent at this stage —
      // they'll be back-filled by the GitHub Actions sync once we
      // extend it to read users from Supabase.
      const payload = {
        id:            a.id,
        name:          a.name,
        type:          a.type,
        date:          a.start_date,
        duration_min:  durationMin,
        distance_km:   distanceKm,
        elevation_m:   elevationM,
        avg_speed_kmh: avgSpeedKmh,
        max_speed_kmh: maxSpeedKmh,
        avg_hr:        a.average_heartrate ?? null,
        max_hr:        a.max_heartrate ?? null,
        calories:      a.calories ?? null,
        // Empty arrays so downstream code that destructures these
        // doesn't crash. Filled in by the background sync.
        gps:          [],
        speed_kmh:    [],
        altitude:     [],
        heartrate:    [],
        time_s:       [],
        distance_m:   [],
      };

      return {
        id:            a.id as number,
        user_id:       userId,
        sport:         sportFromType(a.type),
        original_type: a.type as string,
        title:         a.name as string,
        start_date:    a.start_date as string,
        duration_min:  durationMin,
        distance_km:   distanceKm,
        elevation_m:   elevationM,
        payload,
      };
    });

  if (rows.length === 0) {
    return NextResponse.json({ ok: true, count: 0 });
  }

  // ── 5. Upsert into public.activities ──
  const { error: upsertErr } = await supabaseAdmin()
    .from('activities')
    .upsert(rows, { onConflict: 'id' });
  if (upsertErr) {
    console.error('[strava-sync] upsert failed:', upsertErr.message);
    return NextResponse.json({ error: 'db_upsert_failed', detail: upsertErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, count: rows.length });
}
