/**
 * POST /api/activities/ingest
 *
 * Strava-independent activity ingestion. The iOS app reads a finished
 * workout from Apple HealthKit (Apple Watch, or any brand — Garmin, Whoop,
 * Wahoo… — that writes to Apple Health) and POSTs it here. We store it in
 * public.activities in the SAME shape the Strava sync produces, so the rest
 * of the app (feed, detail page, wear tracker) treats it identically.
 *
 * Why this exists: Strava caps API apps at a handful of connected athletes,
 * which blocks a public App Store launch. HealthKit has no such cap, so this
 * endpoint is the foundation for getting off the Strava dependency.
 *
 * Auth: session cookie OR Bearer token (getAuthedUser), same as the rest.
 * Idempotency: the row id is a stable hash of the workout UUID, so
 * re-uploading the same workout upserts instead of duplicating.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/db';
import { logEvent } from '@/lib/events';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

interface IngestBody {
  uuid?:             string;
  type?:             string;   // Strava-style: Ride, Run, Hike, Walk, Swim…
  name?:             string;
  start_date?:       string;   // ISO8601
  duration_s?:       number;
  distance_m?:       number;
  elevation_gain_m?: number;
  calories?:         number | null;
  avg_hr?:           number | null;
  max_hr?:           number | null;
  gps?:              [number, number][];
  altitude?:         number[];
  time_s?:           number[];
  distance_stream?:  number[];   // cumulative distance per sample (metres)
  heartrate?:        number[];
  speed_kmh?:        number[];
}

// Stable positive integer id derived from the HealthKit workout UUID. Two
// independent 32-bit hashes combined into a value placed ABOVE Strava's
// activity ids (~1e10) so the two sources can't collide, and kept well under
// 2^53 so it survives the JSON/JS number round trip into a Postgres bigint
// without precision loss. (No BigInt: the tsconfig target predates ES2020.)
function stableId(uuid: string): number {
  let h1 = 2166136261;          // FNV-1a 32-bit
  let h2 = 5381;                // djb2 32-bit
  for (let i = 0; i < uuid.length; i++) {
    const c = uuid.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = (Math.imul(h2, 33) + c) | 0;
  }
  const a = (h1 >>> 0) % 3_000_000;
  const b = (h2 >>> 0) % 1_000_000;
  // Range: [5e15, 8e15), effective space 3e12 — collision-safe per user.
  return 5_000_000_000_000_000 + a * 1_000_000 + b;
}

// Minimal type → sport bucket for the `sport` column. The read path
// (/api/activities) re-derives the bucket from payload.type via sportFromRaw,
// so this is just for server-side filtering consistency.
function sportFromType(t: string): string {
  const s = t.toLowerCase();
  if (['ride', 'virtualride', 'ebikeride', 'mountainbikeride', 'gravelride', 'handcycle'].includes(s)) return 'cycling';
  if (['run', 'virtualrun', 'trailrun'].includes(s)) return 'running';
  if (s === 'hike') return 'hiking';
  if (s === 'walk') return 'walking';
  if (s === 'swim') return 'swim';
  if (s === 'snowshoe') return 'snowshoe';
  if (['alpineski', 'backcountryski', 'nordicski', 'ski'].includes(s)) return 'ski';
  if (s === 'snowboard') return 'snowboard';
  if (['yoga'].includes(s)) return 'yoga';
  if (['weighttraining', 'workout', 'crossfit'].includes(s)) return 'workout';
  return 'other';
}

export async function POST(req: NextRequest) {
  const authed = await getAuthedUser(req);
  if (!authed?.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const userId = authed.id;

  let body: IngestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const uuid = (body.uuid ?? '').trim();
  const type = (body.type ?? 'Workout').trim();
  const start = (body.start_date ?? '').trim();
  if (!uuid || !start || Number.isNaN(Date.parse(start))) {
    return NextResponse.json({ error: 'missing_uuid_or_start_date' }, { status: 400 });
  }

  const id          = stableId(uuid);
  const durationS   = Math.max(0, Math.round(body.duration_s ?? 0));
  const distanceM   = Math.max(0, body.distance_m ?? 0);
  const elevM       = Math.max(0, Math.round(body.elevation_gain_m ?? 0));
  const gps         = Array.isArray(body.gps)         ? body.gps         : [];
  const altitude    = Array.isArray(body.altitude)    ? body.altitude    : [];
  const time_s      = Array.isArray(body.time_s)      ? body.time_s      : [];
  const distanceArr = Array.isArray(body.distance_stream) ? body.distance_stream : [];
  const heartrate   = Array.isArray(body.heartrate)   ? body.heartrate   : [];
  const speed_kmh   = Array.isArray(body.speed_kmh)   ? body.speed_kmh   : [];

  const avgSpeed = speed_kmh.length
    ? +(speed_kmh.reduce((a, b) => a + b, 0) / speed_kmh.length).toFixed(2)
    : (durationS > 0 ? +((distanceM / durationS) * 3.6).toFixed(2) : 0);
  const maxSpeed = speed_kmh.length ? +Math.max(...speed_kmh).toFixed(2) : avgSpeed;

  // Same `payload` shape the Strava sync writes so the read path is identical.
  const payload = {
    id,
    name:          body.name || defaultName(type),
    type,
    date:          start,
    duration_min:  Math.round(durationS / 60),
    distance_km:   +(distanceM / 1000).toFixed(2),
    elevation_m:   elevM,
    avg_speed_kmh: avgSpeed,
    max_speed_kmh: maxSpeed,
    avg_hr:        body.avg_hr ?? null,
    max_hr:        body.max_hr ?? null,
    calories:      body.calories ?? null,
    source:        'healthkit',
    gps, altitude, time_s, distance_m: distanceArr, heartrate, speed_kmh,
  };

  const row = {
    id,
    user_id:       userId,
    sport:         sportFromType(type),
    original_type: type,
    title:         payload.name,
    start_date:    start,
    duration_min:  payload.duration_min,
    distance_km:   payload.distance_km,
    elevation_m:   elevM,
    gear_id:       null as string | null,
    payload,
  };

  const { error } = await supabaseAdmin()
    .from('activities')
    .upsert(row, { onConflict: 'id' });
  if (error) {
    console.error('[ingest] upsert failed:', error.message);
    return NextResponse.json({ error: 'db_upsert_failed', detail: error.message }, { status: 500 });
  }

  void logEvent({
    type: 'healthkit_activity_ingested',
    userId,
    properties: { activity_id: id, sport: row.sport, has_gps: gps.length > 1 },
  }, req);

  return NextResponse.json({ ok: true, id, sport: row.sport });
}

function defaultName(type: string): string {
  const s = type.toLowerCase();
  if (s.includes('ride')) return 'Sortie vélo';
  if (s.includes('run'))  return 'Course';
  if (s === 'hike')       return 'Randonnée';
  if (s === 'walk')       return 'Marche';
  if (s === 'swim')       return 'Natation';
  return 'Séance';
}
