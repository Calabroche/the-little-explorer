#!/usr/bin/env node
// scripts/sync-strava.mjs
// Sync new bike rides from Strava into data/activities/.
//
// Used by .github/workflows/strava-sync.yml (cron every 15 min) and locally
// via `npm run sync`. Refreshes the access token, lists athlete activities,
// imports the ones we don't already have, and writes the same JSON shape the
// app expects.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');
const DATA_DIR  = path.join(ROOT, 'data', 'activities');

const CLIENT_ID     = process.env.STRAVA_CLIENT_ID;
const CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.STRAVA_REFRESH_TOKEN;

if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
  console.error('Missing env: STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET / STRAVA_REFRESH_TOKEN');
  process.exit(1);
}

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const BIKE_TYPES = new Set(['Ride', 'VirtualRide', 'EBikeRide', 'MountainBikeRide', 'GravelRide', 'Velomobile']);
const RUN_TYPES  = new Set(['Run', 'TrailRun', 'VirtualRun']);
const SUPPORTED  = new Set([...BIKE_TYPES, ...RUN_TYPES]);

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
  const newOnes = [];
  let page = 1;
  outer: while (page <= 5) {
    const list = await getJson(`https://www.strava.com/api/v3/athlete/activities?per_page=50&page=${page}`, token);
    if (!list.length) break;
    for (const a of list) {
      if (have.has(a.id)) {
        // Once we hit the wall of already-synced rides, we can stop walking.
        // (Strava returns newest first.)
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
