/**
 * /api/me — read + update the signed-in user's own settings.
 *
 * GET   → returns the current user row from next_auth.users, plus the
 *         effective profile (rider_kg, bike_kg, custom_ftp) after the
 *         null-fallback ladder (DB override → legacy PROFILES_BY_EMAIL
 *         → DEFAULT_PROFILE).
 * PATCH → updates rider_kg / bike_kg / custom_ftp on next_auth.users.
 *         Body: { rider_kg?: number|null, bike_kg?: number|null,
 *                 custom_ftp?: number|null }. Nulls clear the override
 *         (= revert to default). Other fields are silently ignored —
 *         user can't change their own email/name/athlete_id from here.
 *
 * All actions are scoped to session.user.id. There's no way to read or
 * write someone else's settings.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/db';
import { getAuthedUser } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Sane bounds — reject obvious garbage instead of letting the DB take
// nonsense. Anyone serious about cycling fits inside these.
const RANGES = {
  rider_kg:   { min: 30,  max: 200 },
  bike_kg:    { min: 3,   max: 30  },
  custom_ftp: { min: 50,  max: 600 },
};

// Legacy fallback profiles (mirror of /api/activities/route.ts). Once
// every TLE user has set their own settings we can drop this.
const PROFILES_BY_EMAIL: Record<string, { riderKg: number; bikeKg: number }> = {
  'florian.calabrese@gmail.com': { riderKg: 66, bikeKg: 8.18 },
};
const DEFAULT_PROFILE = { riderKg: 70, bikeKg: 9 };

interface UserSettings {
  rider_kg:    number | null;
  bike_kg:     number | null;
  custom_ftp:  number | null;
}

interface MeResponse {
  id:         string;
  email:      string | null;
  name:       string | null;
  athleteId:  number | null;
  // Stored overrides — null means "use defaults"
  settings:   UserSettings;
  // What the API actually uses today (override > legacy > default)
  effective: {
    riderKg:   number;
    bikeKg:    number;
    customFtp: number | null;
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadCurrentUser(req: NextRequest | null): Promise<{ row: any } | NextResponse> {
  const authed = await getAuthedUser(req);
  if (!authed?.id) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { data, error } = await supabaseAdmin()
    .schema('next_auth')
    .from('users')
    .select('id, email, name, athlete_id, rider_kg, bike_kg, custom_ftp')
    .eq('id', authed.id)
    .maybeSingle();
  if (error) {
    console.error('[me] user query failed:', error.message);
    return NextResponse.json({ error: 'db_error' }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: 'user_not_found' }, { status: 404 });
  }
  return { row: data };
}

function effective(email: string | null, row: { rider_kg: number | null; bike_kg: number | null; custom_ftp: number | null }) {
  const legacy = email ? PROFILES_BY_EMAIL[email] : undefined;
  return {
    riderKg:   row.rider_kg   ?? legacy?.riderKg ?? DEFAULT_PROFILE.riderKg,
    bikeKg:    row.bike_kg    ?? legacy?.bikeKg  ?? DEFAULT_PROFILE.bikeKg,
    customFtp: row.custom_ftp ?? null,
  };
}

export async function GET(req: NextRequest) {
  const res = await loadCurrentUser(req);
  if (res instanceof NextResponse) return res;
  const { row } = res;

  const payload: MeResponse = {
    id:        row.id,
    email:     row.email,
    name:      row.name,
    athleteId: row.athlete_id,
    settings: {
      rider_kg:   row.rider_kg,
      bike_kg:    row.bike_kg,
      custom_ftp: row.custom_ftp,
    },
    effective: effective(row.email, row),
  };
  return NextResponse.json(payload);
}

export async function PATCH(req: NextRequest) {
  const res = await loadCurrentUser(req);
  if (res instanceof NextResponse) return res;
  const { row } = res;

  let body: Partial<UserSettings>;
  try {
    body = await req.json() as Partial<UserSettings>;
  } catch {
    return NextResponse.json({ error: 'bad_json' }, { status: 400 });
  }

  // Validate + build the update patch. Only the three editable fields
  // are picked up; anything else in the body is silently dropped so
  // someone can't bump their athlete_id by submitting a crafted body.
  const update: Record<string, number | null> = {};
  for (const k of ['rider_kg', 'bike_kg', 'custom_ftp'] as const) {
    if (!(k in body)) continue;
    const v = body[k];
    if (v === null) {
      update[k] = null;
      continue;
    }
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      return NextResponse.json({ error: `invalid_${k}`, message: 'must be a number or null' }, { status: 400 });
    }
    const r = RANGES[k];
    if (v < r.min || v > r.max) {
      return NextResponse.json({ error: `out_of_range_${k}`, message: `${r.min} ≤ ${k} ≤ ${r.max}` }, { status: 400 });
    }
    update[k] = v;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'empty_update' }, { status: 400 });
  }

  const { error: upErr } = await supabaseAdmin()
    .schema('next_auth')
    .from('users')
    .update(update)
    .eq('id', row.id);
  if (upErr) {
    console.error('[me] update failed:', upErr.message);
    return NextResponse.json({ error: 'db_error', detail: upErr.message }, { status: 500 });
  }

  // Return the post-update view so the client doesn't need a second
  // round-trip to render the new effective profile.
  const merged = { ...row, ...update };
  const payload: MeResponse = {
    id:        merged.id,
    email:     merged.email,
    name:      merged.name,
    athleteId: merged.athlete_id,
    settings: {
      rider_kg:   merged.rider_kg,
      bike_kg:    merged.bike_kg,
      custom_ftp: merged.custom_ftp,
    },
    effective: effective(merged.email, merged),
  };
  return NextResponse.json(payload);
}
