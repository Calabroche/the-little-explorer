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

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/db';
import { getAuthedUser } from '@/lib/api-auth';
import { isAdminEmail } from '@/lib/admin';
import { logAdminAction } from '@/lib/audit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// Vercel Hobby plan caps function duration at 60s; bump from the 10s
// default since we may need to wait on Strava's token + activities
// endpoints sequentially.
export const maxDuration = 60;

const STRAVA_TOKEN_URL      = 'https://www.strava.com/api/v3/oauth/token';
const STRAVA_ACTIVITIES_URL = 'https://www.strava.com/api/v3/athlete/activities';
const STRAVA_STREAM_KEYS    = 'time,distance,latlng,altitude,velocity_smooth,heartrate';
const UA = 'TheLittleExplorer/0.1 (+https://the-little-explorer-app.vercel.app)';
// Newest-N activities whose streams (maps/charts) we fetch INLINE during a
// sync, so a freshly-created account lands on complete data without a
// manual "RE-SYNCER STRAVA" click. Bounded so we stay under maxDuration
// (60s) and Strava's 200-req/15-min cap; the 15-min cron fills any overflow.
const INLINE_STREAM_BUDGET = 100;

// Sport mapping (same set as scripts/sync-strava.mjs + /api/activities).
const CYCLING = new Set(['Ride', 'VirtualRide', 'EBikeRide', 'MountainBikeRide', 'GravelRide', 'Velomobile', 'Handcycle']);
const RUNNING = new Set(['Run', 'TrailRun', 'VirtualRun']);
const SKI       = new Set(['AlpineSki', 'BackcountrySki', 'NordicSki', 'RollerSki']);
const WORKOUT   = new Set(['Workout', 'WeightTraining', 'Crossfit', 'HighIntensityIntervalTraining']);
const CARDIO    = new Set(['Elliptical', 'StairStepper', 'VirtualRow']);
const YOGA      = new Set(['Yoga', 'Pilates']);
const KAYAK     = new Set(['Kayaking', 'Canoeing']);
const SURF      = new Set(['Surfing', 'Windsurf', 'Kitesurf']);
const RACKET    = new Set(['Tennis', 'TableTennis', 'Badminton', 'Squash', 'Racquetball', 'Pickleball']);

// Strava's full activity-type catalogue. Sync skips anything not
// in this set — rare, since the catch-all (`other` bucket below)
// handles future novel types as long as they're listed here.
const SUPPORTED = new Set([
  // cycling
  'Ride', 'VirtualRide', 'EBikeRide', 'EMountainBikeRide', 'MountainBikeRide', 'GravelRide', 'Velomobile', 'Handcycle',
  // running
  'Run', 'TrailRun', 'VirtualRun',
  // skiing
  'AlpineSki', 'BackcountrySki', 'NordicSki', 'RollerSki',
  // walking / hiking / swim / snow
  'Hike', 'Walk', 'Swim', 'Snowshoe', 'Snowboard', 'IceSkate',
  // indoor / strength / body
  'Workout', 'WeightTraining', 'Crossfit', 'HighIntensityIntervalTraining', 'Elliptical', 'StairStepper', 'VirtualRow',
  'Yoga', 'Pilates',
  // water
  'Rowing', 'Kayaking', 'Canoeing', 'StandUpPaddling', 'Surfing', 'Windsurf', 'Kitesurf', 'Sail',
  // wheels (non-bike)
  'InlineSkate', 'Skateboard',
  // misc
  'RockClimbing', 'Tennis', 'TableTennis', 'Badminton', 'Squash', 'Racquetball', 'Pickleball',
  'Soccer', 'Golf', 'GolfingRiding', 'Wheelchair',
]);

function sportFromType(t: string): string {
  // Outdoor cardio.
  if (CYCLING.has(t)) return 'cycling';
  if (RUNNING.has(t)) return 'running';
  if (t === 'Hike')     return 'hiking';
  if (t === 'Walk')     return 'walking';
  if (t === 'Swim')     return 'swim';
  if (t === 'Snowshoe') return 'snowshoe';
  // Snow / ice.
  if (SKI.has(t))           return 'ski';
  if (t === 'Snowboard')    return 'snowboard';
  if (t === 'IceSkate')     return 'iceSkate';
  // Indoor / strength / body.
  if (YOGA.has(t))    return 'yoga';
  if (WORKOUT.has(t)) return 'workout';
  if (CARDIO.has(t))  return 'cardio';
  // Water.
  if (t === 'Rowing')          return 'rowing';
  if (KAYAK.has(t))            return 'kayak';
  if (t === 'StandUpPaddling') return 'paddle';
  if (SURF.has(t))             return 'surf';
  if (t === 'Sail')            return 'sail';
  // Wheels.
  if (t === 'InlineSkate') return 'inlineSkate';
  if (t === 'Skateboard')  return 'skateboard';
  // Misc.
  if (t === 'RockClimbing')                          return 'climbing';
  if (RACKET.has(t))                                 return 'racket';
  if (t === 'Soccer')                                return 'soccer';
  if (t === 'Golf' || t === 'GolfingRiding')         return 'golf';
  if (t === 'Wheelchair')                            return 'wheelchair';
  // Anything else lands in 'other' so the rider can still find it.
  return 'other';
}

/**
 * Fetch one activity's streams from Strava and merge them onto its summary
 * payload (same shape /api/strava/backfill-streams writes). Returns:
 *   - the merged payload on success,
 *   - 'rate_limited' on a 429 (caller should stop; the cron continues),
 *   - the base payload stamped with the _streams_fetched_at sentinel on a
 *     404 (indoor / manual activity with no GPS — so the cron skips it),
 *   - null on a transient error (caller skips it; the cron retries).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchStreamPayload(accessToken: string, activityId: number, basePayload: any): Promise<any | 'rate_limited' | null> {
  const r = await fetch(
    `https://www.strava.com/api/v3/activities/${activityId}/streams?keys=${STRAVA_STREAM_KEYS}&key_by_type=true`,
    { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json', 'User-Agent': UA } },
  );
  if (!r.ok) {
    if (r.status === 429) return 'rate_limited';
    if (r.status === 404) return { ...basePayload, _streams_fetched_at: new Date().toISOString() };
    return null;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = await r.json() as any;
  const gps:        [number, number][] = s?.latlng?.data    ?? [];
  const altitude:   number[]           = s?.altitude?.data  ?? [];
  const time_s:     number[]           = s?.time?.data      ?? [];
  const distance_m: number[]           = s?.distance?.data  ?? [];
  const heartrate:  number[]           = s?.heartrate?.data ?? [];
  const velocity:   number[]           = s?.velocity_smooth?.data ?? [];
  // Strava omits velocity_smooth for some short / urban efforts — derive
  // speed from Δdistance / Δtime so the speed chart isn't an empty box.
  let speed_kmh: number[];
  if (velocity.length >= 2) {
    speed_kmh = velocity.map(v => v * 3.6);
  } else if (distance_m.length >= 2 && time_s.length === distance_m.length) {
    speed_kmh = distance_m.map((d, i) => {
      if (i === 0) return 0;
      const dd = d - distance_m[i - 1];
      const dt = time_s[i] - time_s[i - 1];
      return dt > 0 ? (dd / dt) * 3.6 : 0;
    });
  } else {
    speed_kmh = [];
  }
  return { ...basePayload, gps, altitude, time_s, distance_m, heartrate, speed_kmh, _streams_fetched_at: new Date().toISOString() };
}

export async function POST(req: NextRequest) {
  const authed = await getAuthedUser(req);
  if (!authed?.id) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // Normally you sync yourself. An admin may pass { targetUserId } to sync
  // someone else — needed to backfill an athlete whose activities went stale
  // while the webhook was down (they'd otherwise have to log in and press the
  // button themselves). Non-admins asking for someone else are ignored, not
  // errored: they simply sync themselves.
  let userId = authed.id;
  const body = (await req.json().catch(() => null)) as { targetUserId?: string } | null;
  const target = typeof body?.targetUserId === 'string' ? body.targetUserId.trim() : '';
  if (target && target !== authed.id && isAdminEmail(authed.email)) {
    userId = target;
    void logAdminAction(
      { actorId: authed.id, action: 'force_sync', targetUserId: target },
      req,
    );
  }

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

  // Use form-encoded body + explicit User-Agent + Accept. Strava's
  // OAuth endpoint accepts JSON but some of its edge nodes return
  // a vague 500 ({"message":"error"}) when called without a
  // User-Agent — a known footgun for Vercel functions, whose
  // default `fetch` omits the header. Belt-and-suspenders here so
  // the refresh path is bulletproof.
  const tokenRes = await fetch(STRAVA_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept':       'application/json',
      'User-Agent':   'TheLittleExplorer/0.1 (+https://the-little-explorer-app.vercel.app)',
    },
    body: new URLSearchParams({
      client_id:     clientId,
      client_secret: clientSecret,
      grant_type:    'refresh_token',
      refresh_token: refreshToken,
    }).toString(),
  });
  if (!tokenRes.ok) {
    const txt = await tokenRes.text();
    console.error('[strava-sync] token refresh failed:', tokenRes.status, txt.slice(0, 200));
    // 400 / 401 mean the refresh_token is gone (revoked by the
    // rider via strava.com, or rotated past the one we cached).
    // Surface that as `needs_reconnect` so the sidebar shows a
    // "Reconnecter Strava" CTA instead of just an error.
    const status = tokenRes.status;
    return NextResponse.json(
      {
        error:           status === 400 || status === 401 ? 'token_revoked_needs_reconnect' : 'token_refresh_failed',
        stravaStatus:    status,
        stravaBody:      txt.slice(0, 200),
      },
      { status: 502 },
    );
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

  // ── 2.5 Token sanity check ─────────────────────────
  // Hit a cheap endpoint first (/athlete returns the rider's
  // profile) so we can distinguish "Strava rejecting the token"
  // (401/403) from "Strava broken on /activities specifically"
  // (500) from "this rider's account is broken" (500 everywhere).
  // The result is surfaced into the error payload below so the
  // sidebar can show a more specific message.
  let tokenSanityStatus = 0;
  let tokenSanityBody = '';
  try {
    const athleteRes = await fetch('https://www.strava.com/api/v3/athlete', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept:        'application/json',
        'User-Agent':  'TheLittleExplorer/0.1 (+https://the-little-explorer-app.vercel.app)',
      },
    });
    tokenSanityStatus = athleteRes.status;
    tokenSanityBody   = (await athleteRes.text()).slice(0, 500);
    // Log everything (status + truncated body + truncated token)
    // so we can root-cause the Strava-500-on-/athlete pattern that
    // multiple users are hitting. Token is logged at first/last 6
    // chars only — enough to verify on subsequent calls without
    // pasting a full credential into Vercel logs.
    const tokenFingerprint = `${accessToken.slice(0, 6)}…${accessToken.slice(-6)}`;
    if (!athleteRes.ok) {
      console.warn('[strava-sync] /athlete sanity FAILED status=' + athleteRes.status + ' tok=' + tokenFingerprint + ' body=' + tokenSanityBody);
    } else {
      console.log('[strava-sync] /athlete sanity OK tok=' + tokenFingerprint);
    }
  } catch (err) {
    console.warn('[strava-sync] /athlete sanity threw:', err);
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
    // Retry on 5xx with linear backoff. Strava's /athlete/activities
    // is flaky right after a fresh OAuth — they need ~30 s to "warm
    // up" the new athlete's view. Two retries (so up to 3 attempts
    // total, 1 s + 3 s of backoff) catches the common transient
    // window without making the UI feel slow.
    let r: Response | null = null;
    let attempt = 0;
    let lastStravaStatus = 0;
    let lastStravaBody = '';
    while (attempt < 3) {
      r = await fetch(`${STRAVA_ACTIVITIES_URL}?per_page=200&page=${page}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept:        'application/json',
          'User-Agent':  'TheLittleExplorer/0.1 (+https://the-little-explorer-app.vercel.app)',
        },
      });
      if (r.ok) break;
      lastStravaStatus = r.status;
      lastStravaBody = (await r.text()).slice(0, 200);
      console.error(`[strava-sync] page ${page} attempt ${attempt + 1} failed:`, r.status, lastStravaBody);
      // 401/403 = auth issue — retrying won't help.
      // 429 = rate limit — retrying immediately just makes it worse.
      // Only retry 5xx (Strava server-side glitch).
      if (r.status < 500) break;
      attempt += 1;
      if (attempt < 3) {
        await new Promise(res => setTimeout(res, attempt * 1000));
      }
    }
    if (!r || !r.ok) {
      // On the very first page we have nothing to return; on later pages
      // we keep what we already pulled and stop. Include the actual
      // Strava status code so the client (Sidebar's error banner) can
      // tell the user whether to retry, reconnect Strava, or write to us.
      if (page === 1) {
        return NextResponse.json(
          {
            error:             'activities_fetch_failed',
            stravaStatus:      lastStravaStatus,
            stravaBody:        lastStravaBody,
            // Sanity check on a different endpoint helps the user
            // tell "Strava is down for me on activities only" vs
            // "Strava rejects everything" (probably a token issue).
            athleteEndpointStatus: tokenSanityStatus,
            athleteEndpointBody:   tokenSanityBody,
          },
          { status: 502 },
        );
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
      // speed_kmh, distance_m, time_s) start empty here; step 8 below
      // fills them inline for the newest INLINE_STREAM_BUDGET rows in
      // this same request, and the 15-min cron backfills any overflow.
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
        // Strava's gear_id tags which bike (or shoe) the activity used.
        // Captured here so the maintenance tracker can scope wear to a
        // specific bike (a chain on the Canyon shouldn't count e-bike
        // km). May be null for manual / non-tagged activities.
        gear_id:       (a.gear_id ?? null) as string | null,
        payload,
      };
    });

  if (rows.length === 0) {
    return NextResponse.json({ ok: true, count: 0 });
  }

  // ── 5. INSERT-ONLY: never overwrite existing rows ──────────────────────
  //
  // The background GH Actions sync (scripts/sync-strava-supabase.mjs) is
  // the only path that can write FULL payloads with streams (gps, hr,
  // altitude, speed, distance, time). This endpoint only has activity
  // SUMMARIES — its payload stub has empty arrays for every stream.
  //
  // Previously we ran a vanilla `upsert(rows, { onConflict: 'id' })`
  // which clobbered any streamed payloads each time the user opened
  // the iOS app and triggered the auto-sync. Result: maps and charts
  // vanished on every Feed load.
  //
  // Fix: filter out IDs that are already in the table and only insert
  // the genuinely new ones. The cron will fill in streams for those
  // newcomers on its next pass. Existing rows are left untouched, so
  // their already-fetched streams survive.
  const ids = rows.map(r => r.id);
  const { data: existingRows, error: existErr } = await supabaseAdmin()
    .from('activities')
    .select('id, gear_id')
    .in('id', ids);
  if (existErr) {
    console.error('[strava-sync] existing-id query failed:', existErr.message);
    return NextResponse.json({ error: 'db_query_failed', detail: existErr.message }, { status: 500 });
  }
  const existingById = new Map(
    (existingRows ?? []).map(r => [Number(r.id), { gear_id: r.gear_id as string | null }]),
  );
  const newRows = rows.filter(r => !existingById.has(Number(r.id)));

  if (newRows.length > 0) {
    const { error: insertErr } = await supabaseAdmin()
      .from('activities')
      .insert(newRows);
    if (insertErr) {
      console.error('[strava-sync] insert failed:', insertErr.message);
      return NextResponse.json({ error: 'db_insert_failed', detail: insertErr.message }, { status: 500 });
    }
  }

  // ── 6. Backfill gear_id on existing rows ───────────────────────────────
  //
  // Activities synced before we started capturing gear_id have a NULL
  // value in that column. We re-fetched them from Strava in this same
  // request (their summary is in `rows`), so we can patch the gear_id
  // without touching the precious `payload` (which carries streams the
  // cron filled in over time).
  //
  // Only update rows where:
  //   (a) we have a fresh gear_id from Strava, AND
  //   (b) the stored value differs (NULL or moved to a different bike).
  const toBackfill = rows.filter(r => {
    const existing = existingById.get(Number(r.id));
    if (!existing) return false;                // already covered by insert
    if (r.gear_id == null) return false;        // nothing to backfill
    return existing.gear_id !== r.gear_id;
  });
  let backfilled = 0;
  if (toBackfill.length > 0) {
    // Batch parallel updates to keep round-trip count manageable.
    const BATCH = 20;
    for (let i = 0; i < toBackfill.length; i += BATCH) {
      const slice = toBackfill.slice(i, i + BATCH);
      const results = await Promise.all(
        slice.map(r =>
          supabaseAdmin()
            .from('activities')
            .update({ gear_id: r.gear_id })
            .eq('id',      r.id)
            .eq('user_id', userId),
        ),
      );
      backfilled += results.filter(x => !x.error).length;
      for (const x of results) {
        if (x.error) console.warn('[strava-sync] gear_id backfill row failed:', x.error.message);
      }
    }
  }

  // ── 7. Sync the user's bike list from /api/v3/gear/{id} ────────────────
  //
  // We deliberately AVOID `/api/v3/athlete` here even though it exposes
  // a `bikes[]` field — that field requires the `profile:read_all`
  // scope to be populated, which our current OAuth scope doesn't
  // include (and re-asking the user to re-authenticate to grant it is
  // a worse UX than this alternative).
  //
  // Instead: collect the unique gear_ids we just observed in this
  // user's activities, filter to bike-shaped ids (Strava prefixes bikes
  // with "b" and shoes with "g"), and fetch each gear directly via
  // /gear/{id} — that endpoint only needs `read` scope, which every
  // user already has.
  //
  // Best-effort: a failure here doesn't fail the activity sync. The
  // user can still see their km without per-bike scoping.
  const observedGearIds = Array.from(new Set(
    rows.map(r => r.gear_id).filter((id): id is string => id != null && id.startsWith('b')),
  ));
  const bikesUpserted = await syncBikes(userId, accessToken, observedGearIds).catch(err => {
    console.warn('[strava-sync] bike list sync failed:', (err as Error).message);
    return 0;
  });

  // ── 8. Inline streams for the newest new activities ────────────────────
  //
  // The user-visible win: a freshly-created account lands on a feed WITH
  // maps & charts — no manual "RE-SYNCER STRAVA" click. We already hold a
  // fresh accessToken, so fetching streams here runs in the SAME request:
  // no extra refresh_token rotation, hence none of the concurrent-rotation
  // race that kept us from auto-syncing in the OAuth callback.
  //
  // Bounded by INLINE_STREAM_BUDGET and a wall-clock deadline so we stay
  // under maxDuration=60s (token + activities + insert + bikes already
  // burned some of it). Stops on a Strava 429. Any overflow (older rides,
  // or accounts with more than the budget) is filled by the 15-min cron
  // automatically — still no user action required.
  let streamed = 0;
  if (newRows.length > 0) {
    const deadline = Date.now() + 40_000;   // leave margin under maxDuration=60s
    // newRows preserve Strava's newest-first order — fetch recent rides'
    // maps first, since that's what tops the feed the user sees.
    for (const row of newRows.slice(0, INLINE_STREAM_BUDGET)) {
      if (Date.now() > deadline) break;
      const merged = await fetchStreamPayload(accessToken, row.id, row.payload);
      if (merged === 'rate_limited') break;   // Strava 200/15min — let the cron continue
      if (!merged) continue;                  // transient — leave it for the cron
      const { error: upErr } = await supabaseAdmin()
        .from('activities')
        .update({ payload: merged })
        .eq('id', row.id)
        .eq('user_id', userId);
      if (upErr) console.warn('[strava-sync] inline stream update failed for', row.id, ':', upErr.message);
      else streamed += 1;
    }
  }

  return NextResponse.json({
    ok:           true,
    count:        newRows.length,
    streamed,
    backfilled,
    bikes:        bikesUpserted,
  });
}

interface StravaGear {
  id:           string;
  name?:        string;
  nickname?:    string;     // some accounts surface the nickname under this key
  primary?:     boolean;
  brand_name?:  string;
  model_name?:  string;
  frame_type?:  number;
}

async function syncBikes(
  userId: string,
  accessToken: string,
  gearIds: string[],
): Promise<number> {
  if (gearIds.length === 0) {
    console.log('[strava-sync.bikes] no bike gear_ids observed, skipping');
    return 0;
  }

  // Fan-out one /gear/{id} per unique bike. 2 bikes → 2 calls; well
  // under Strava's rate limit (100/15min).
  const responses = await Promise.all(gearIds.map(async id => {
    try {
      const r = await fetch(`https://www.strava.com/api/v3/gear/${id}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!r.ok) {
        const txt = await r.text();
        console.warn(`[strava-sync.bikes] /gear/${id} fetch ${r.status}:`, txt.slice(0, 200));
        return null;
      }
      return await r.json() as StravaGear;
    } catch (err) {
      console.warn(`[strava-sync.bikes] /gear/${id} threw:`, (err as Error).message);
      return null;
    }
  }));

  const bikes = responses.filter((g): g is StravaGear => g != null);
  if (bikes.length === 0) {
    console.warn('[strava-sync.bikes] all /gear fetches failed, nothing to upsert');
    return 0;
  }

  // Strava exposes a nickname (the user-facing name from the Strava UI,
  // e.g. "Rocket", "Elon musk") and a model name (e.g. "Endurace CF
  // SLX"). Prefer the nickname — that's what the user typed.
  const { error } = await supabaseAdmin()
    .from('bike_gears')
    .upsert(
      bikes.map(g => ({
        id:           g.id,
        user_id:      userId,
        name:         (g.nickname ?? g.name ?? g.brand_name ?? g.id).trim(),
        primary_bike: Boolean(g.primary),
      })),
      { onConflict: 'id' },
    );
  if (error) {
    console.warn('[strava-sync.bikes] upsert failed:', error.message);
    return 0;
  }
  return bikes.length;
}
