#!/usr/bin/env node
// scripts/sync-strava.mjs
// Sync new activities from Strava into data/users/<USER>/activities/.
//
// Used by .github/workflows/strava-sync.yml (cron every 15 min) and locally
// via `npm run sync -- --user=florian`. Refreshes the access token, lists
// athlete activities, imports the ones we don't already have, and writes the
// same JSON shape the app expects.
//
// Per-user env vars (works for both shells and GitHub Action):
//   STRAVA_CLIENT_ID
//   STRAVA_CLIENT_SECRET           (Florian's app — shared, both users
//                                  authorise against the same Strava app)
//   STRAVA_REFRESH_TOKEN_FLORIAN
//   STRAVA_REFRESH_TOKEN_HELENA
//
// Usage:
//   USER=florian node scripts/sync-strava.mjs
//   node scripts/sync-strava.mjs --user=helena

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');

const argUser   = (process.argv.find(a => a.startsWith('--user=')) || '').replace('--user=', '');
const USER      = (argUser || process.env.USER_ID || process.env.USER || 'florian').toLowerCase();
const VALID     = ['florian', 'helena'];
if (!VALID.includes(USER)) {
  console.error(`Unknown user "${USER}". Valid: ${VALID.join(', ')}`);
  process.exit(1);
}
const DATA_DIR  = path.join(ROOT, 'data', 'users', USER, 'activities');

// Per-user app credentials with fallback to shared ones. This lets Florian
// and Helena use either the same Strava app (one set of CLIENT_ID/SECRET +
// per-user refresh tokens) or two distinct apps (full per-user creds).
const U = USER.toUpperCase();
const CLIENT_ID     = process.env[`STRAVA_CLIENT_ID_${U}`]     || process.env.STRAVA_CLIENT_ID;
const CLIENT_SECRET = process.env[`STRAVA_CLIENT_SECRET_${U}`] || process.env.STRAVA_CLIENT_SECRET;
const REFRESH_TOKEN = process.env[`STRAVA_REFRESH_TOKEN_${U}`] || process.env.STRAVA_REFRESH_TOKEN;

if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
  console.error(`Missing env for user ${USER}. Need STRAVA_CLIENT_ID(_${U}) / STRAVA_CLIENT_SECRET(_${U}) / STRAVA_REFRESH_TOKEN_${U}`);
  process.exit(1);
}

console.log(`▶ Syncing for user "${USER}" → ${DATA_DIR}`);

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// Strava activity types we care about, grouped by internal sport. Anything
// not listed (Workout, WeightTraining, Yoga, Crossfit…) gets ignored.
const SUPPORTED  = new Set([
  // cycling
  'Ride', 'VirtualRide', 'EBikeRide', 'MountainBikeRide', 'GravelRide', 'Velomobile', 'Handcycle',
  // running
  'Run', 'TrailRun', 'VirtualRun',
  // hiking
  'Hike',
  // skiing
  'AlpineSki', 'BackcountrySki', 'NordicSki', 'RollerSki',
  // snowshoeing
  'Snowshoe',
  // walking
  'Walk',
  // swimming
  'Swim',
]);

async function refreshToken() {
  const res = await fetch('https://www.strava.com/api/v3/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: REFRESH_TOKEN,
    }),
  });
  if (!res.ok) throw new Error(`Strava token refresh failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  // DEBUG: surface the scope so we can tell if the access token is
  // actually allowed to read activities. (Temporary diag for sync-debug.)
  console.log(`[diag] refresh scope=${data.scope || '(none)'} athlete_id=${data.athlete?.id || '?'}`);
  return data.access_token;
}

async function getJson(url, token) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status} ${await res.text()}`);
  return res.json();
}

function existingIds() {
  return new Set(
    fs.readdirSync(DATA_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => Number(f.replace('.json', '')))
  );
}

function buildJson(activity, streams) {
  const out = {
    id:            activity.id,
    name:          activity.name,
    date:          activity.start_date_local,
    type:          activity.type,
    distance_km:   +(activity.distance / 1000).toFixed(2),
    duration_min:  Math.round(activity.moving_time / 60),
    elevation_m:   activity.total_elevation_gain,
    avg_speed_kmh: +(activity.average_speed * 3.6).toFixed(1),
    max_speed_kmh: +(activity.max_speed * 3.6).toFixed(1),
    avg_hr:        activity.average_heartrate || null,
    max_hr:        activity.max_heartrate || null,
    calories:      activity.calories || null,
    kudos:         activity.kudos_count,
    gps:           streams.latlng?.data           || [],
    speed_kmh:     (streams.velocity_smooth?.data || []).map(v => +(v * 3.6).toFixed(1)),
    altitude:      streams.altitude?.data         || [],
    heartrate:     streams.heartrate?.data        || [],
    time_s:        streams.time?.data             || [],
    distance_m:    streams.distance?.data         || [],
  };
  return out;
}

async function main() {
  const token = await refreshToken();
  console.log('✓ token refreshed');

  // Walk recent pages until we find activities we already have.
  const have = existingIds();
  const fullSync = process.env.FULL_SYNC === '1';
  const newOnes = [];
  // Cron mode walks 5 pages and stops at the first already-synced ride;
  // FULL_SYNC mode walks the whole athlete history (up to 20 pages = 1000
  // activities) skipping existing IDs along the way. Use FULL_SYNC=1 once
  // to backfill new activity types after expanding SUPPORTED.
  const maxPages = fullSync ? 20 : 5;
  let page = 1;
  outer: while (page <= maxPages) {
    const list = await getJson(`https://www.strava.com/api/v3/athlete/activities?per_page=50&page=${page}`, token);
    // DEBUG: show what Strava actually returned for this page so we can
    // tell if the API hit a stale cache, returned an empty list, or if
    // we're hitting an unexpected first-known short-circuit.
    console.log(`[diag] page=${page} returned ${list.length} items`);
    if (Array.isArray(list) && list.length > 0) {
      console.log(`[diag]   first 3: ${list.slice(0, 3).map(a => `${a.id}/${a.type}/${a.start_date_local?.slice(0, 10)}`).join(' | ')}`);
      console.log(`[diag]   have-size=${have.size}, first-id-known=${have.has(list[0].id)}`);
    }
    if (!list.length) break;
    for (const a of list) {
      if (have.has(a.id)) {
        if (fullSync) continue; // keep walking past already-synced rides
        break outer;
      }
      if (SUPPORTED.has(a.type)) newOnes.push(a);
    }
    page++;
  }

  if (newOnes.length === 0) {
    console.log('Nothing new to import.');
    return;
  }

  console.log(`${newOnes.length} new activities to import:`);
  for (const a of newOnes) {
    try {
      const [full, streams] = await Promise.all([
        getJson(`https://www.strava.com/api/v3/activities/${a.id}`, token),
        getJson(`https://www.strava.com/api/v3/activities/${a.id}/streams?keys=latlng,velocity_smooth,altitude,heartrate,time,distance&key_by_type=true`, token),
      ]);
      const out = buildJson(full, streams);
      fs.writeFileSync(path.join(DATA_DIR, `${a.id}.json`), JSON.stringify(out, null, 2));
      console.log(`  ✓ ${a.id} ${a.type} ${out.distance_km}km — ${a.name}`);
    } catch (err) {
      console.error(`  ✗ ${a.id} : ${err.message}`);
    }
  }
}

main().catch(err => { console.error(err); process.exit(1); });
