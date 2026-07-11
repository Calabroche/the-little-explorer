/**
 * /api/me — read + update + DELETE the signed-in user's own account.
 *
 * GET    → returns the current user row from next_auth.users, plus the
 *          effective profile (rider_kg, bike_kg, custom_ftp) after the
 *          null-fallback ladder (DB override → legacy PROFILES_BY_EMAIL
 *          → DEFAULT_PROFILE).
 * PATCH  → updates rider_kg / bike_kg / custom_ftp / name on
 *          next_auth.users. Body fields are optional:
 *             rider_kg?:   number|null   (null clears the override)
 *             bike_kg?:    number|null   (null clears the override)
 *             custom_ftp?: number|null   (null clears the override)
 *             name?:       string|null   (null clears, falls back to
 *                                         the OAuth-provided name)
 *          Other fields (email / athlete_id) stay locked — those come
 *          from the OAuth provider and can't be edited from here.
 * DELETE → wipes the user's account: revokes the Strava token (best
 *          effort), deletes the user row from next_auth.users. Every
 *          child table (accounts, sessions, api_tokens, activities)
 *          has an ON DELETE CASCADE FK, so a single row delete is
 *          enough to fully purge. RGPD art. 17 + Strava API Agreement
 *          requirement.
 *
 * All actions are scoped to session.user.id. There's no way to read,
 * write, or delete someone else's account.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/db';
import { getAuthedUser } from '@/lib/api-auth';
import { logEvent } from '@/lib/events';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { uploadAvatarDataUrl } from '@/lib/avatar';

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
  image:      string | null;
  bio:        string | null;
  default_visibility: 'public' | 'followers' | 'private';
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
    .select('id, email, name, image, bio, default_activity_visibility, athlete_id, rider_kg, bike_kg, custom_ftp')
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
  const limited = enforceRateLimit(req, RATE_LIMITS.authedRead, 'me-get', { userId: row.id });
  if (limited) return limited;

  const payload: MeResponse = {
    id:        row.id,
    email:     row.email,
    name:      row.name,
    image:     row.image ?? null,
    bio:       row.bio ?? null,
    default_visibility: row.default_activity_visibility ?? 'followers',
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
  const limited = enforceRateLimit(req, RATE_LIMITS.authedWrite, 'me-patch', { userId: row.id });
  if (limited) return limited;

  let body: Partial<UserSettings>;
  try {
    body = await req.json() as Partial<UserSettings>;
  } catch {
    return NextResponse.json({ error: 'bad_json' }, { status: 400 });
  }

  // Validate + build the update patch. Only the explicit editable
  // fields are picked up; anything else in the body is silently
  // dropped so someone can't bump their athlete_id by submitting a
  // crafted body.
  const update: Record<string, number | string | null> = {};
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

  // Display name override. Empty string or null clears the override
  // → name falls back to whatever the OAuth provider populated.
  // Length capped at 64 to keep the UI readable and avoid abuse.
  if ('name' in body) {
    const raw = (body as { name?: string | null }).name;
    if (raw === null) {
      update.name = null;
    } else if (typeof raw === 'string') {
      const trimmed = raw.trim();
      if (trimmed.length === 0) {
        update.name = null;
      } else if (trimmed.length > 64) {
        return NextResponse.json({ error: 'name_too_long', message: '64 caractères max' }, { status: 400 });
      } else {
        update.name = trimmed;
      }
    } else {
      return NextResponse.json({ error: 'invalid_name', message: 'must be a string or null' }, { status: 400 });
    }
  }

  // Social profile: bio (≤ 280 chars, null/empty clears) + default activity
  // visibility. Kept alongside the physical-profile fields so the settings
  // page can save everything in one PATCH.
  if ('bio' in body) {
    const raw = (body as { bio?: string | null }).bio;
    if (raw === null) update.bio = null;
    else if (typeof raw === 'string') {
      const trimmed = raw.trim();
      if (trimmed.length === 0) update.bio = null;
      else if (trimmed.length > 280) return NextResponse.json({ error: 'bio_too_long', message: '280 caractères max' }, { status: 400 });
      else update.bio = trimmed;
    } else return NextResponse.json({ error: 'invalid_bio' }, { status: 400 });
  }
  if ('default_visibility' in body) {
    const v = (body as { default_visibility?: unknown }).default_visibility;
    if (v !== 'public' && v !== 'followers' && v !== 'private') {
      return NextResponse.json({ error: 'invalid_default_visibility' }, { status: 400 });
    }
    update.default_activity_visibility = v;
  }

  // Custom profile photo. The client sends a resized base64 data URL; we UPLOAD
  // it to Supabase Storage and store only the short public URL — never the data
  // URL itself (that bloated responses + the session cookie → 494). null clears
  // back to the initials avatar. Already-a-URL passes through.
  if ('image' in body) {
    const raw = (body as { image?: string | null }).image;
    if (raw === null) {
      update.image = null;
    } else if (typeof raw === 'string' && raw.startsWith('http')) {
      update.image = raw.slice(0, 512);
    } else if (typeof raw === 'string' && raw.startsWith('data:')) {
      if (raw.length > 1_500_000) {
        return NextResponse.json({ error: 'image_too_large', message: 'image trop lourde (max ~1 Mo)' }, { status: 400 });
      }
      try {
        update.image = await uploadAvatarDataUrl(row.id, raw);
      } catch (e) {
        console.error('[me] avatar upload failed:', (e as Error).message);
        return NextResponse.json({ error: 'avatar_upload_failed' }, { status: 500 });
      }
    } else {
      return NextResponse.json({ error: 'invalid_image', message: 'must be a base64 image data URL' }, { status: 400 });
    }
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
    image:     merged.image ?? null,
    bio:       merged.bio ?? null,
    default_visibility: merged.default_activity_visibility ?? 'followers',
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

// ── DELETE: wipe the signed-in user's account ─────────────────────────
// Body: none. Returns 204 on success.
//
// Steps:
//   1. Best-effort revoke the Strava OAuth token via `POST
//      https://www.strava.com/oauth/deauthorize`. This tells Strava to
//      drop us from the athlete's authorized-apps list — required by
//      Strava's API Agreement when a user requests deletion. Failures
//      here are logged but do NOT block the local delete; if Strava is
//      down we still wipe the user's data immediately.
//   2. Delete the row from next_auth.users. Every child table FKs
//      back with ON DELETE CASCADE (next_auth.accounts, sessions,
//      api_tokens, public.activities), so the single delete purges the
//      whole footprint in one statement.
export async function DELETE(req: NextRequest) {
  const res = await loadCurrentUser(req);
  if (res instanceof NextResponse) return res;
  const { row } = res;
  const limited = enforceRateLimit(req, RATE_LIMITS.authedWrite, 'me-delete', { userId: row.id });
  if (limited) return limited;

  // 1. Revoke Strava OAuth (best effort). We need a live access_token
  //    to call /oauth/deauthorize; the refresh flow lives in
  //    /api/strava/sync but we'd rather not pull it in here. Instead
  //    we grab the most recent access_token from next_auth.accounts —
  //    even if it's expired Strava typically still accepts it for
  //    deauthorize calls, and we don't care about the result anyway.
  if (row.athlete_id) {
    try {
      const { data: account } = await supabaseAdmin()
        .schema('next_auth')
        .from('accounts')
        .select('access_token')
        .eq('userId', row.id)
        .eq('provider', 'strava')
        .maybeSingle();
      if (account?.access_token) {
        await fetch('https://www.strava.com/oauth/deauthorize', {
          method:  'POST',
          headers: {
            'Content-Type':  'application/x-www-form-urlencoded',
            Authorization:   `Bearer ${account.access_token}`,
          },
        }).catch(err => {
          console.error('[me.delete] strava deauthorize failed (non-fatal):', err);
        });
      }
    } catch (e) {
      // Non-fatal — proceed to local wipe regardless.
      console.error('[me.delete] strava deauthorize lookup failed:', e);
    }
  }

  // 2. Cascade delete the user — every child table has ON DELETE CASCADE.
  const { error: delErr } = await supabaseAdmin()
    .schema('next_auth')
    .from('users')
    .delete()
    .eq('id', row.id);
  if (delErr) {
    console.error('[me.delete] user delete failed:', delErr.message);
    return NextResponse.json({ error: 'db_error', detail: delErr.message }, { status: 500 });
  }

  console.log(`[me.delete] purged user ${row.id} (email=${row.email ?? '?'}, athlete_id=${row.athlete_id ?? '-'})`);
  // Event log — fire-and-forget. user_id will be null in the row
  // because the user was just deleted; we record the deletion via
  // an anonymous event with the email in properties for forensics.
  void logEvent(
    { type: 'delete_account', userId: null, properties: { former_email: row.email ?? null, former_athlete_id: row.athlete_id ?? null } },
    req,
  );
  // 204 No Content — the client should immediately call NextAuth's
  // signOut() to clear its own cookie.
  return new NextResponse(null, { status: 204 });
}
