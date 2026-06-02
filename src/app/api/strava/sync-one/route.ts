/**
 * POST /api/strava/sync-one — sync a SINGLE Strava activity for a single
 * athlete, with streams. Called fire-and-forget by /api/strava-webhook so
 * a new ride lands in Supabase within seconds of being uploaded to
 * Strava (instead of waiting up to 15 min for the GH Actions cron).
 *
 * Auth: shared-secret in the request body (env STRAVA_WEBHOOK_SECRET).
 * The route is otherwise unauthenticated because it's invoked
 * machine-to-machine — there's no session.
 *
 * Body:
 *   {
 *     athleteId:  number,   // Strava owner_id from the webhook event
 *     activityId: number,   // Strava object_id (the activity)
 *     secret:     string,   // must equal STRAVA_WEBHOOK_SECRET
 *   }
 *
 * Strategy: do the full work in-process (token refresh → activity GET →
 * streams GET → upsert). The endpoint is allowed up to 60 s by Vercel
 * Hobby, which is plenty even for the slowest Strava paths.
 *
 * Idempotency: upsert on activity id. Same activity arriving twice (e.g.
 * a "create" then "update" event) just refreshes the row.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

import { logEvent } from '@/lib/events';

const STRAVA_TOKEN_URL = 'https://www.strava.com/api/v3/oauth/token';

// Mirrors the sets in /api/strava/sync and scripts/sync-strava-supabase.mjs.
// Kept in lockstep with /api/strava/sync — extend together. The
// rationale for the bucket grouping (yoga, workout, racket, etc.)
// lives there with the full comment header.
const CYCLING   = new Set(['Ride', 'VirtualRide', 'EBikeRide', 'EMountainBikeRide', 'MountainBikeRide', 'GravelRide', 'Velomobile', 'Handcycle']);
const RUNNING   = new Set(['Run', 'TrailRun', 'VirtualRun']);
const SKI       = new Set(['AlpineSki', 'BackcountrySki', 'NordicSki', 'RollerSki']);
const WORKOUT   = new Set(['Workout', 'WeightTraining', 'Crossfit', 'HighIntensityIntervalTraining']);
const CARDIO    = new Set(['Elliptical', 'StairStepper', 'VirtualRow']);
const YOGA      = new Set(['Yoga', 'Pilates']);
const KAYAK     = new Set(['Kayaking', 'Canoeing']);
const SURF      = new Set(['Surfing', 'Windsurf', 'Kitesurf']);
const RACKET    = new Set(['Tennis', 'TableTennis', 'Badminton', 'Squash', 'Racquetball', 'Pickleball']);
const SUPPORTED = new Set([
  'Ride', 'VirtualRide', 'EBikeRide', 'EMountainBikeRide', 'MountainBikeRide', 'GravelRide', 'Velomobile', 'Handcycle',
  'Run', 'TrailRun', 'VirtualRun',
  'AlpineSki', 'BackcountrySki', 'NordicSki', 'RollerSki',
  'Hike', 'Walk', 'Swim', 'Snowshoe', 'Snowboard', 'IceSkate',
  'Workout', 'WeightTraining', 'Crossfit', 'HighIntensityIntervalTraining', 'Elliptical', 'StairStepper', 'VirtualRow',
  'Yoga', 'Pilates',
  'Rowing', 'Kayaking', 'Canoeing', 'StandUpPaddling', 'Surfing', 'Windsurf', 'Kitesurf', 'Sail',
  'InlineSkate', 'Skateboard',
  'RockClimbing', 'Tennis', 'TableTennis', 'Badminton', 'Squash', 'Racquetball', 'Pickleball',
  'Soccer', 'Golf', 'GolfingRiding', 'Wheelchair',
]);

function sportFromType(t: string): string {
  if (CYCLING.has(t)) return 'cycling';
  if (RUNNING.has(t)) return 'running';
  if (t === 'Hike')     return 'hiking';
  if (t === 'Walk')     return 'walking';
  if (t === 'Swim')     return 'swim';
  if (t === 'Snowshoe') return 'snowshoe';
  if (SKI.has(t))        return 'ski';
  if (t === 'Snowboard') return 'snowboard';
  if (t === 'IceSkate')  return 'iceSkate';
  if (YOGA.has(t))    return 'yoga';
  if (WORKOUT.has(t)) return 'workout';
  if (CARDIO.has(t))  return 'cardio';
  if (t === 'Rowing')          return 'rowing';
  if (KAYAK.has(t))            return 'kayak';
  if (t === 'StandUpPaddling') return 'paddle';
  if (SURF.has(t))             return 'surf';
  if (t === 'Sail')            return 'sail';
  if (t === 'InlineSkate') return 'inlineSkate';
  if (t === 'Skateboard')  return 'skateboard';
  if (t === 'RockClimbing')                  return 'climbing';
  if (RACKET.has(t))                         return 'racket';
  if (t === 'Soccer')                        return 'soccer';
  if (t === 'Golf' || t === 'GolfingRiding') return 'golf';
  if (t === 'Wheelchair')                    return 'wheelchair';
  return 'other';
}

interface Body {
  athleteId?:  number;
  activityId?: number;
  secret?:     string;
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = await req.json() as Body;
  } catch {
    return NextResponse.json({ error: 'bad_json' }, { status: 400 });
  }

  // Shared-secret guard. Constant-time compare to avoid timing leaks
  // (overkill for a short secret but it's free).
  const expected = process.env.STRAVA_WEBHOOK_SECRET;
  if (!expected) {
    console.error('[sync-one] STRAVA_WEBHOOK_SECRET not configured');
    return NextResponse.json({ error: 'server_not_configured' }, { status: 500 });
  }
  if (!body.secret || !constantTimeEq(body.secret, expected)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const athleteId  = Number(body.athleteId);
  const activityId = Number(body.activityId);
  if (!Number.isFinite(athleteId) || !Number.isFinite(activityId)) {
    return NextResponse.json({ error: 'bad_request', detail: 'athleteId + activityId required' }, { status: 400 });
  }

  // ── 1. Find the TLE user that owns this Strava athlete ──────────────
  const { data: accountRows, error: accErr } = await supabaseAdmin()
    .schema('next_auth')
    .from('accounts')
    .select('userId, refresh_token, providerAccountId')
    .eq('provider',          'strava')
    .eq('providerAccountId', String(athleteId))
    .limit(1);

  if (accErr) {
    console.error('[sync-one] accounts query failed:', accErr.message);
    return NextResponse.json({ error: 'db_error' }, { status: 500 });
  }
  if (!accountRows || accountRows.length === 0) {
    // No TLE user has this Strava athlete linked. Drop silently (could
    // be a webhook fired before the user finished onboarding).
    return NextResponse.json({ ok: true, skipped: 'no_user_for_athlete' });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const account = accountRows[0] as any;
  const userId      = account.userId as string;
  const refreshToken = account.refresh_token as string;

  // ── 2. Refresh the access token ─────────────────────────────────────
  const clientId     = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: 'strava_client_not_configured' }, { status: 500 });
  }
  const tokenRes = await fetch(STRAVA_TOKEN_URL, {
    method:  'POST',
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
    console.error('[sync-one] token refresh failed:', tokenRes.status, txt.slice(0, 200));
    return NextResponse.json({ error: 'token_refresh_failed' }, { status: 502 });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tokenData = await tokenRes.json() as any;
  const accessToken = tokenData.access_token as string;

  // Persist the rotated refresh_token (same as /api/strava/sync).
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

  // ── 3. Fetch the activity summary ───────────────────────────────────
  const actRes = await fetch(`https://www.strava.com/api/v3/activities/${activityId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (actRes.status === 404) {
    // Activity was deleted between event and our fetch. Drop silently.
    return NextResponse.json({ ok: true, skipped: 'activity_404' });
  }
  if (!actRes.ok) {
    const txt = await actRes.text();
    console.error('[sync-one] activity fetch failed:', actRes.status, txt.slice(0, 200));
    return NextResponse.json({ error: 'activity_fetch_failed' }, { status: 502 });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const a = await actRes.json() as any;

  if (!SUPPORTED.has(a.type)) {
    return NextResponse.json({ ok: true, skipped: `unsupported_type:${a.type}` });
  }

  // ── 4. Fetch the streams (gps, altitude, hr, speed, distance, time) ─
  const keys = 'time,distance,latlng,altitude,velocity_smooth,heartrate';
  const streamRes = await fetch(
    `https://www.strava.com/api/v3/activities/${activityId}/streams?keys=${keys}&key_by_type=true`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let streams: any = null;
  if (streamRes.ok) {
    streams = await streamRes.json();
  } else if (streamRes.status !== 404) {
    // 404 = manually-created activity with no streams. Anything else
    // is a real error but we still want to insert the row's metadata,
    // so we log and continue with null streams.
    console.warn(`[sync-one] streams fetch ${streamRes.status} — inserting summary only`);
  }

  // ── 5. Build the row + upsert ───────────────────────────────────────
  const payload = activityToPayload(a, streams);
  const row = {
    id:            a.id as number,
    user_id:       userId,
    sport:         sportFromType(a.type as string),
    original_type: a.type as string,
    title:         a.name as string,
    start_date:    a.start_date as string,
    duration_min:  Math.round((a.moving_time ?? 0) / 60),
    distance_km:   +((a.distance ?? 0) / 1000).toFixed(2),
    elevation_m:   Math.round(a.total_elevation_gain ?? 0),
    // Track which bike the ride was on — mirrors /api/strava/sync so
    // the maintenance tracker can scope wear per bike.
    gear_id:       (a.gear_id ?? null) as string | null,
    payload,
  };

  // Upsert is safe HERE (unlike /api/strava/sync) because this payload
  // has streams. The "do not clobber" rule only applies when streams
  // are absent. This path always has the full data, so newer = better.
  const { error: upsertErr } = await supabaseAdmin()
    .from('activities')
    .upsert(row, { onConflict: 'id' });
  if (upsertErr) {
    console.error('[sync-one] upsert failed:', upsertErr.message);
    return NextResponse.json({ error: 'db_upsert_failed', detail: upsertErr.message }, { status: 500 });
  }

  // Event log — fire-and-forget. The dashboard cross-references this
  // with `strava_webhook_received` to compute the sync success rate.
  // If this is the user's first activity ever, also log `first_sync`
  // for the onboarding funnel chart.
  void logEvent({
    type: 'strava_webhook_synced',
    userId,
    properties: { activity_id: activityId, has_streams: Boolean(streams), sport: row.sport },
  }, req);

  void (async () => {
    try {
      const { count } = await supabaseAdmin()
        .from('activities')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId);
      // count === 1 means the row we just inserted is the only one.
      if ((count ?? 0) === 1) {
        await logEvent({ type: 'first_sync', userId, properties: { activity_id: activityId } }, req);
      }
    } catch { /* best-effort */ }
  })();

  return NextResponse.json({
    ok: true,
    activityId,
    athleteId,
    hasStreams: Boolean(streams),
  });
}

// ── Helpers ────────────────────────────────────────────────────────────────

function constantTimeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function activityToPayload(a: any, streams: any) {
  const gps:        [number, number][] = streams?.latlng?.data    ?? [];
  const altitude:    number[]          = streams?.altitude?.data  ?? [];
  const time_s:      number[]          = streams?.time?.data      ?? [];
  const distance_m:  number[]          = streams?.distance?.data  ?? [];
  const heartrate:   number[]          = streams?.heartrate?.data ?? [];
  const velocity:    number[]          = streams?.velocity_smooth?.data ?? [];
  const speed_kmh                       = velocity.map(v => v * 3.6);

  return {
    id:            a.id,
    name:          a.name,
    type:          a.type,
    date:          a.start_date,
    duration_min:  Math.round((a.moving_time ?? 0) / 60),
    distance_km:   +((a.distance ?? 0) / 1000).toFixed(2),
    elevation_m:   Math.round(a.total_elevation_gain ?? 0),
    avg_speed_kmh: +((a.average_speed ?? 0) * 3.6).toFixed(2),
    max_speed_kmh: +((a.max_speed ?? 0)     * 3.6).toFixed(2),
    avg_hr:        a.average_heartrate ?? null,
    max_hr:        a.max_heartrate ?? null,
    calories:      a.calories ?? null,
    gps, altitude, time_s, distance_m, heartrate, speed_kmh,
  };
}
