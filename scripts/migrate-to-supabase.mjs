#!/usr/bin/env node
/**
 * One-shot migration: data/users/<user>/activities/*.json → Supabase activities table.
 *
 * Why no @supabase/supabase-js: the v2.106+ client requires Node 20+
 * (uses global fetch / Headers / WebSocket). This project runs on Node
 * 16.15.1, so we hit PostgREST directly via the native `https` module.
 *
 * Usage:
 *
 *   export SUPABASE_URL=https://<project>.supabase.co
 *   export SUPABASE_SERVICE_ROLE_KEY=<service_role JWT>
 *
 *   node scripts/migrate-to-supabase.mjs --user=florian --email=florian.calabrese@gmail.com --dry
 *   node scripts/migrate-to-supabase.mjs --user=florian --email=florian.calabrese@gmail.com
 *
 * Idempotent: upserts on activity id. Re-run is safe.
 */

import fs    from 'node:fs';
import path  from 'node:path';
import https from 'node:https';
import { URL } from 'node:url';

// ── Arg parsing ──────────────────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);

const USER  = args.user;
const EMAIL = args.email;
const DRY   = Boolean(args.dry);

if (!USER || !EMAIL) {
  console.error('Usage: node scripts/migrate-to-supabase.mjs --user=<slug> --email=<email> [--dry]');
  process.exit(1);
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set.');
  process.exit(1);
}

// ── PostgREST helper (native https, no SDK) ─────────────────────────────────
function pgrest(method, pathAndQuery, { body, schema, prefer } = {}) {
  const u = new URL(SUPABASE_URL.replace(/\/+$/, '') + '/rest/v1' + pathAndQuery);
  const headers = {
    'apikey':         SUPABASE_KEY,
    'Authorization':  `Bearer ${SUPABASE_KEY}`,
    'Content-Type':   'application/json',
    'Accept':         'application/json',
  };
  if (schema) headers['Accept-Profile'] = schema;
  if (schema && (method === 'POST' || method === 'PATCH')) headers['Content-Profile'] = schema;
  if (prefer) headers['Prefer']     = prefer;

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: u.hostname,
      port:     u.port || 443,
      path:     u.pathname + u.search,
      method,
      headers,
    }, res => {
      let buf = '';
      res.on('data', chunk => buf += chunk);
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

// ── Sport mapping (mirrors src/app/api/activities/route.ts) ─────────────────
const CYCLING = new Set(['Ride', 'VirtualRide', 'EBikeRide', 'MountainBikeRide', 'GravelRide', 'Velomobile', 'Handcycle']);
const RUNNING = new Set(['Run', 'TrailRun', 'VirtualRun']);
const SKI     = new Set(['AlpineSki', 'BackcountrySki', 'NordicSki', 'RollerSki']);

function sport(rawType) {
  if (CYCLING.has(rawType)) return 'cycling';
  if (RUNNING.has(rawType)) return 'running';
  if (SKI.has(rawType))     return 'ski';
  if (rawType === 'Hike')      return 'hiking';
  if (rawType === 'Snowshoe')  return 'snowshoe';
  if (rawType === 'Walk')      return 'walking';
  if (rawType === 'Swim')      return 'swim';
  return 'cycling';
}

// ── Resolve user_id from email (in next_auth schema) ────────────────────────
const users = await pgrest(
  'GET',
  `/users?email=eq.${encodeURIComponent(EMAIL)}&select=id,email`,
  { schema: 'next_auth' },
);
if (!users.length) {
  console.error(`No user with email "${EMAIL}" in next_auth.users.`);
  console.error('Sign in to the deployed app first so NextAuth creates the row, then re-run.');
  process.exit(1);
}
const userId = users[0].id;
console.log(`✓ resolved ${EMAIL} → ${userId}`);

// ── Load JSON files ─────────────────────────────────────────────────────────
const dir = path.join(process.cwd(), 'data', 'users', USER, 'activities');
if (!fs.existsSync(dir)) {
  console.error(`No directory: ${dir}`);
  process.exit(1);
}
const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
console.log(`✓ ${files.length} activity files found in ${dir}`);

// ── Build rows + upsert in batches ──────────────────────────────────────────
const BATCH = 25;
let ok = 0, skipped = 0;

for (let i = 0; i < files.length; i += BATCH) {
  const slice = files.slice(i, i + BATCH);
  const rows  = [];
  for (const f of slice) {
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    } catch (err) {
      console.warn(`  skip malformed ${f}: ${err.message}`);
      skipped++;
      continue;
    }
    // duration_min and elevation_m can be floats in the JSON (e.g. 12.3 m),
    // but the activities table types them as integers. Round to nearest
    // for the indexed columns — full-precision values are preserved in
    // payload for any UI that wants them.
    rows.push({
      id:            raw.id,
      user_id:       userId,
      sport:         sport(raw.type),
      original_type: raw.type ?? null,
      title:         raw.name ?? null,
      start_date:    raw.date,
      duration_min:  raw.duration_min != null ? Math.round(raw.duration_min) : null,
      distance_km:   raw.distance_km ?? null,
      elevation_m:   raw.elevation_m != null ? Math.round(raw.elevation_m) : null,
      payload:       raw,
    });
  }

  if (DRY) {
    console.log(`  [dry] batch ${Math.floor(i / BATCH) + 1}: would upsert ${rows.length} rows`);
    ok += rows.length;
    continue;
  }

  try {
    // PostgREST upsert: POST with Prefer: resolution=merge-duplicates
    await pgrest('POST', '/activities', {
      body:   rows,
      prefer: 'resolution=merge-duplicates,return=minimal',
    });
    ok += rows.length;
    console.log(`  ✓ batch ${Math.floor(i / BATCH) + 1}: ${rows.length} rows`);
  } catch (err) {
    console.error(`  batch ${Math.floor(i / BATCH) + 1} failed:`, err.message);
    process.exit(1);
  }
}

console.log(`\nDone. inserted=${ok}  skipped=${skipped}  user=${USER}  ${DRY ? '(dry run)' : ''}`);
