#!/usr/bin/env node
/**
 * Multi-user Strava → Supabase sync.
 *
 * Replaces the per-user env-var approach (STRAVA_REFRESH_TOKEN_FLORIAN
 * etc.) with a Supabase-driven loop: read every athlete who has
 * connected Strava through the app and sync their activities + streams.
 *
 * Used by .github/workflows/strava-sync.yml on a 15-min cron. Designed
 * to be re-runnable: upserts on activity id, only fetches streams for
 * rows that don't have them yet.
 *
 * Env required:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   STRAVA_CLIENT_ID
 *   STRAVA_CLIENT_SECRET
 *
 * Rate-limit budget (Strava API):
 *   200 req / 15 min  ·  2000 req / day  (per app, not per user)
 *
 * Each user takes:
 *   1 req           — refresh token
 *   1-10 req        — paginate activities (per_page=200)
 *   N req           — streams, one per new activity
 *
 * STREAM_BUDGET caps the per-run stream calls so the cron + webhook +
 * /api/strava/sync don't collide and exhaust the budget. Activities
 * that don't get streams this run will be picked up next time.
 *
 * Usage:
 *   node scripts/sync-strava-supabase.mjs
 *   node scripts/sync-strava-supabase.mjs --athlete=12345     # just one user
 *   node scripts/sync-strava-supabase.mjs --max-streams=80    # tune budget
 */

import https from 'node:https';
import { URL } from 'node:url';

const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);

const ONLY_ATHLETE   = args.athlete ? Number(args.athlete) : null;
const STREAM_BUDGET  = args['max-streams'] != null ? Number(args['max-streams']) : 100;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CLIENT_ID    = process.env.STRAVA_CLIENT_ID;
const CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET;

if (!SUPABASE_URL || !SUPABASE_KEY || !CLIENT_ID || !CLIENT_SECRET) {
  console.error('Missing env. Need SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET.');
  process.exit(1);
}

// ── Tiny native PostgREST client (no SDK = no Node 20 requirement) ──────────
function pgrest(method, pathAndQuery, { body, schema, prefer } = {}) {
  const u = new URL(SUPABASE_URL.replace(/\/+$/, '') + '/rest/v1' + pathAndQuery);
  const headers = {
    'apikey':        SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type':  'application/json',
    'Accept':        'application/json',
  };
  if (schema) headers['Accept-Profile'] = schema;
  if (schema && (method === 'POST' || method === 'PATCH')) headers['Content-Profile'] = schema;
  if (prefer) headers['Prefer'] = prefer;

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: u.hostname,
      port:     u.port || 443,
      path:     u.pathname + u.search,
      method,
      headers,
    }, res => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end',  () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(buf ? JSON.parse(buf) : null);
        } else {
          reject(new Error(`PostgREST ${method} ${pathAndQuery} → ${res.statusCode}: ${buf.slice(0, 300)}`));
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ── Sport mapping (same set as /api/activities) ─────────────────────────────
const CYCLING = new Set(['Ride', 'VirtualRide', 'EBikeRide', 'MountainBikeRide', 'GravelRide', 'Velomobile', 'Handcycle']);
const RUNNING = new Set(['Run', 'TrailRun', 'VirtualRun']);
const SKI     = new Set(['AlpineSki', 'BackcountrySki', 'NordicSki', 'RollerSki']);
const SUPPORTED = new Set([
  'Ride', 'VirtualRide', 'EBikeRide', 'MountainBikeRide', 'GravelRide', 'Velomobile', 'Handcycle',
  'Run', 'TrailRun', 'VirtualRun',
  'AlpineSki', 'BackcountrySki', 'NordicSki', 'RollerSki',
  'Hike', 'Snowshoe', 'Walk', 'Swim',
]);

function sport(t) {
  if (CYCLING.has(t)) return 'cycling';
  if (RUNNING.has(t)) return 'running';
  if (SKI.has(t))     return 'ski';
  if (t === 'Hike')      return 'hiking';
  if (t === 'Snowshoe')  return 'snowshoe';
  if (t === 'Walk')      return 'walking';
  if (t === 'Swim')      return 'swim';
  return 'cycling';
}

// ── Strava client (native fetch via Node 18+ on GitHub Actions) ─────────────
async function refreshStravaToken(refreshToken) {
  const r = await fetch('https://www.strava.com/api/v3/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type:    'refresh_token',
      refresh_token: refreshToken,
    }),
  });
  if (!r.ok) throw new Error(`Strava token refresh failed: ${r.status} ${await r.text()}`);
  return r.json();
}

async function fetchAthleteActivities(accessToken, maxPages = 10) {
  const out = [];
  for (let page = 1; page <= maxPages; page++) {
    const r = await fetch(`https://www.strava.com/api/v3/athlete/activities?per_page=200&page=${page}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!r.ok) {
      if (page === 1) throw new Error(`Strava activities fetch failed: ${r.status}`);
      console.warn(`  page ${page} failed; using what we have`);
      break;
    }
    const batch = await r.json();
    out.push(...batch);
    if (batch.length < 200) break;
  }
  return out;
}

async function fetchActivityStreams(accessToken, activityId) {
  const keys = 'time,distance,latlng,altitude,velocity_smooth,heartrate';
  const r = await fetch(
    `https://www.strava.com/api/v3/activities/${activityId}/streams?keys=${keys}&key_by_type=true`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!r.ok) {
    if (r.status === 404) return null;     // activity has no streams (e.g., manually created)
    if (r.status === 429) return 'rate_limited';
    throw new Error(`streams fetch failed: ${r.status}`);
  }
  return r.json();
}

// ── Build payload identical to the legacy JSON shape ────────────────────────
function activityToPayload(a, streams) {
  const gps      = streams?.latlng?.data ?? [];
  const altitude = streams?.altitude?.data ?? [];
  const time_s   = streams?.time?.data ?? [];
  const distance_m = streams?.distance?.data ?? [];
  const heartrate  = streams?.heartrate?.data ?? [];
  const velocity   = streams?.velocity_smooth?.data ?? [];
  const speed_kmh  = velocity.map(v => v * 3.6);

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

function activityRow(a, payload, userId) {
  return {
    id:            a.id,
    user_id:       userId,
    sport:         sport(a.type),
    original_type: a.type ?? null,
    title:         a.name ?? null,
    start_date:    a.start_date,
    duration_min:  Math.round((a.moving_time ?? 0) / 60),
    distance_km:   +((a.distance ?? 0) / 1000).toFixed(2),
    elevation_m:   Math.round(a.total_elevation_gain ?? 0),
    // Bike/shoe id from Strava — lets the maintenance tracker scope
    // wear per bike. Null for manual / non-tagged activities.
    gear_id:       a.gear_id ?? null,
    payload,
  };
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  // 1. List every user with a Strava account linked.
  console.log('▶ Listing Strava-linked users in next_auth.accounts...');
  let accounts = await pgrest(
    'GET',
    '/accounts?provider=eq.strava&select=userId,refresh_token,providerAccountId',
    { schema: 'next_auth' },
  );
  if (ONLY_ATHLETE) {
    accounts = accounts.filter(a => Number(a.providerAccountId) === ONLY_ATHLETE);
  }
  console.log(`  ${accounts.length} athlete(s) to sync`);

  let streamsRemaining = STREAM_BUDGET;
  let totalNewRows = 0;

  for (const acc of accounts) {
    const userId      = acc.userId;
    const athleteId   = acc.providerAccountId;
    const refreshTok  = acc.refresh_token;
    console.log(`\n▶ user_id=${userId} athlete=${athleteId} budget=${streamsRemaining}`);

    if (!refreshTok) {
      console.warn('  no refresh_token, skipping');
      continue;
    }

    // 2. Refresh access token
    let tokenData;
    try {
      tokenData = await refreshStravaToken(refreshTok);
    } catch (e) {
      console.error('  token refresh failed:', e.message);
      continue;
    }
    const accessToken = tokenData.access_token;

    // 3. Persist rotated refresh_token if Strava issued a new one
    if (tokenData.refresh_token && tokenData.refresh_token !== refreshTok) {
      await pgrest('PATCH',
        `/accounts?provider=eq.strava&providerAccountId=eq.${athleteId}`,
        {
          schema: 'next_auth',
          body: {
            refresh_token: tokenData.refresh_token,
            access_token:  accessToken,
            expires_at:    tokenData.expires_at ?? null,
          },
        });
    }

    // 4. List the activity ids we already have for this user (so we
    //    only fetch streams for the NEW ones).
    const existingRows = await pgrest('GET',
      `/activities?user_id=eq.${userId}&select=id,payload->gps`);
    // eslint-disable-next-line no-unused-vars
    const existing = new Map();
    for (const r of existingRows) {
      // A row "has streams" if the gps array isn't empty.
      const hasStreams = Array.isArray(r['gps']) && r['gps'].length > 0;
      existing.set(Number(r.id), hasStreams);
    }
    console.log(`  ${existing.size} existing rows (${[...existing.values()].filter(Boolean).length} with streams)`);

    // 5. Fetch all activities from Strava (paginated, max 10 pages)
    let activities;
    try {
      activities = await fetchAthleteActivities(accessToken);
    } catch (e) {
      console.error('  activities fetch failed:', e.message);
      continue;
    }
    const supported = activities.filter(a => SUPPORTED.has(a.type));
    console.log(`  ${activities.length} fetched, ${supported.length} supported types`);

    // 6. For each activity:
    //      - if not in DB → fetch streams (if budget) → upsert
    //      - if in DB without streams and budget → fetch streams → upsert (back-fill)
    //      - if in DB with streams → skip
    const toUpsert = [];
    for (const a of supported) {
      const wasInDb   = existing.has(a.id);
      const hasStreams = existing.get(a.id) === true;

      // Skip if already complete
      if (wasInDb && hasStreams) continue;

      // Try to fetch streams if we have budget. If not, insert summary only
      // (next run can back-fill streams).
      let streams = null;
      if (streamsRemaining > 0) {
        try {
          const s = await fetchActivityStreams(accessToken, a.id);
          if (s === 'rate_limited') {
            console.warn('  hit Strava rate limit — stopping stream fetches for this user');
            streamsRemaining = 0;
          } else {
            streams = s;
            streamsRemaining--;
          }
        } catch (e) {
          console.warn(`  streams for ${a.id} failed:`, e.message);
        }
      }

      const payload = activityToPayload(a, streams);
      toUpsert.push(activityRow(a, payload, userId));
    }

    // 7. Batch upsert
    if (toUpsert.length === 0) {
      console.log('  ✓ nothing new');
      continue;
    }
    const BATCH = 25;
    for (let i = 0; i < toUpsert.length; i += BATCH) {
      const slice = toUpsert.slice(i, i + BATCH);
      try {
        await pgrest('POST', '/activities', {
          body:   slice,
          prefer: 'resolution=merge-duplicates,return=minimal',
        });
        totalNewRows += slice.length;
        console.log(`  ✓ batch of ${slice.length}`);
      } catch (e) {
        console.error('  upsert failed:', e.message);
      }
    }
  }

  console.log(`\nDone. rows upserted=${totalNewRows}  stream budget remaining=${streamsRemaining}`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
