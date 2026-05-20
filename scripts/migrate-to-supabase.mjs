#!/usr/bin/env node
/**
 * One-shot migration: data/users/<user>/activities/*.json → Supabase activities table.
 *
 * Usage:
 *
 *   # 1. Make sure these are exported in your shell:
 *   #      SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   #
 *   # 2. The two seed users (Florian + Helena) must already exist in the
 *   #    `users` table. Easiest path: sign in to the deployed app once
 *   #    with each Google account, then run:
 *   #
 *   #      psql ... -c "UPDATE users SET athlete_id=… WHERE email='florian@…';"
 *   #
 *   #    (or do it through the Supabase Table editor)
 *   #
 *   # 3. Run:
 *   #
 *   #      node scripts/migrate-to-supabase.mjs --user=florian --email=florian.calabrese@gmail.com
 *   #      node scripts/migrate-to-supabase.mjs --user=helena   --email=<helena's email>
 *   #
 *   # 4. Pass --dry to preview without writing.
 *
 * Idempotent: uses upsert on the activity id, so re-running is safe.
 */

import fs   from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

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

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

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

// ── Resolve user_id from email ──────────────────────────────────────────────
const { data: userRow, error: userErr } = await supabase
  .from('users')
  .select('id, email')
  .eq('email', EMAIL)
  .maybeSingle();

if (userErr) { console.error('lookup failed:', userErr); process.exit(1); }
if (!userRow) {
  console.error(`No user with email "${EMAIL}" in the users table.`);
  console.error('Sign in to the deployed app first so NextAuth creates the row, then re-run.');
  process.exit(1);
}
const userId = userRow.id;
console.log(`✓ resolved ${EMAIL} → ${userId}`);

// ── Load JSON files ─────────────────────────────────────────────────────────
const dir = path.join(process.cwd(), 'data', 'users', USER, 'activities');
if (!fs.existsSync(dir)) {
  console.error(`No directory: ${dir}`);
  process.exit(1);
}
const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
console.log(`✓ ${files.length} activity files found in ${dir}`);

// ── Insert in batches ───────────────────────────────────────────────────────
const BATCH = 50;
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
    rows.push({
      id:            raw.id,
      user_id:       userId,
      sport:         sport(raw.type),
      original_type: raw.type ?? null,
      title:         raw.name ?? null,
      start_date:    raw.date,
      duration_min:  raw.duration_min ?? null,
      distance_km:   raw.distance_km ?? null,
      elevation_m:   raw.elevation_m ?? null,
      payload:       raw, // full raw blob — streams + everything
    });
  }

  if (DRY) {
    console.log(`  [dry] batch ${i / BATCH + 1}: would upsert ${rows.length} rows`);
    ok += rows.length;
    continue;
  }

  const { error } = await supabase.from('activities').upsert(rows, { onConflict: 'id' });
  if (error) {
    console.error(`  batch ${i / BATCH + 1} failed:`, error);
    process.exit(1);
  }
  ok += rows.length;
  console.log(`  ✓ batch ${i / BATCH + 1}: ${rows.length} rows`);
}

console.log(`\nDone. inserted=${ok}  skipped=${skipped}  user=${USER}  ${DRY ? '(dry run)' : ''}`);
