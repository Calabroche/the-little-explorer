/**
 * GET /api/me/export — RGPD art. 20 (portability).
 *
 * Returns a JSON file containing everything we store about the
 * authenticated user, served with Content-Disposition: attachment so
 * the browser triggers a download instead of rendering it.
 *
 * What's in the export:
 *   * Profile (id, email, name, athlete_id, settings, effective values).
 *   * Every activity row owned by the user — metadata only (id, sport,
 *     title, date, distance, elevation, duration). Strava activity ids
 *     are preserved so the user can re-pull raw streams from Strava
 *     directly using the standard API + their own credentials.
 *
 * What's NOT in the export:
 *   * Activity payload streams (GPS / HR / altitude / power arrays). For
 *     a typical user these add up to multi-MB per activity, breaking
 *     Vercel's response-body limits. We strip them and document the
 *     re-acquisition path in the response. RGPD compliance is preserved
 *     because (a) the user has the activity ids needed to re-pull from
 *     Strava, (b) for locally-recorded rides (id < 0), the iOS app holds
 *     the original streams in LocalRideStore.
 *   * OAuth refresh tokens — security: never exported.
 *   * admin_audit entries about this user — operational metadata, not
 *     user content (and could leak actor identity).
 *
 * The on-the-wire shape:
 *   {
 *     exportedAt:  ISO8601,
 *     schema:      "tle-export-v2",
 *     notice:      <plain-English note about streams omission>,
 *     profile:     { id, email, name, athleteId, settings, effective, createdAt },
 *     activities:  [ { id, sport, title, start_date, distance_km, … } ],
 *     activityCount: <int>,
 *   }
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/db';
import { getAuthedUser } from '@/lib/api-auth';
import { logEvent } from '@/lib/events';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const PROFILES_BY_EMAIL: Record<string, { riderKg: number; bikeKg: number }> = {
  'florian.calabrese@gmail.com': { riderKg: 66, bikeKg: 8.18 },
};
const DEFAULT_PROFILE = { riderKg: 70, bikeKg: 9 };

export async function GET(req: NextRequest) {
  const authed = await getAuthedUser(req);
  if (!authed?.id) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  // Heavy endpoint — pulls every activity row + payload. Cap at
  // 5/min per user so a curl loop can't drain Supabase egress.
  const limited = enforceRateLimit(req, RATE_LIMITS.heavyRead, 'me-export', { userId: authed.id });
  if (limited) return limited;

  // 1. User row.
  const { data: user, error: userErr } = await supabaseAdmin()
    .schema('next_auth')
    .from('users')
    .select('id, email, name, image, athlete_id, rider_kg, bike_kg, custom_ftp, created_at')
    .eq('id', authed.id)
    .maybeSingle();
  if (userErr) {
    console.error('[me.export] user query failed:', userErr.message);
    return NextResponse.json({ error: 'db_error', detail: userErr.message }, { status: 500 });
  }
  if (!user) {
    return NextResponse.json({ error: 'user_not_found' }, { status: 404 });
  }

  // 2. Activities — metadata only (payload column EXCLUDED). The
  //    payload field on Hobby easily exceeds the response-body cap;
  //    streaming worked around the cap but turned out to be unreliable
  //    with custom Transfer-Encoding headers on Vercel. The simpler,
  //    more robust path: skip the streams entirely. Users who want
  //    streams re-pull from Strava using the preserved activity ids.
  const { data: activities, error: actErr } = await supabaseAdmin()
    .from('activities')
    .select('id, sport, original_type, title, start_date, duration_min, distance_km, elevation_m, created_at')
    .eq('user_id', authed.id)
    .order('start_date', { ascending: false });
  if (actErr) {
    console.error('[me.export] activities query failed:', actErr.message);
    return NextResponse.json({ error: 'db_error', detail: actErr.message }, { status: 500 });
  }

  const legacy = user.email ? PROFILES_BY_EMAIL[user.email] : undefined;
  const effective = {
    riderKg:   user.rider_kg ?? legacy?.riderKg ?? DEFAULT_PROFILE.riderKg,
    bikeKg:    user.bike_kg  ?? legacy?.bikeKg  ?? DEFAULT_PROFILE.bikeKg,
    customFtp: user.custom_ftp ?? null,
  };

  const payload = {
    exportedAt: new Date().toISOString(),
    schema:     'tle-export-v2',
    notice:     'Streams GPS/FC/altitude omis pour rester sous les limites de l\'API. Récupère-les depuis Strava avec ton athlete_id et les activity ids ci-dessous, ou utilise l\'app iOS pour les rides locaux (id < 0).',
    profile: {
      id:         user.id,
      email:      user.email,
      name:       user.name,
      image:      user.image,
      athleteId:  user.athlete_id,
      createdAt:  user.created_at,
      settings: {
        rider_kg:   user.rider_kg,
        bike_kg:    user.bike_kg,
        custom_ftp: user.custom_ftp,
      },
      effective,
    },
    activities:     activities ?? [],
    activityCount:  (activities ?? []).length,
  };

  const filename = `the-little-explorer-export-${new Date().toISOString().slice(0, 10)}.json`;

  // Event log — fire-and-forget. The activity count is useful context
  // for the dashboard (export size distribution, etc.).
  void logEvent(
    { type: 'export', userId: authed.id, properties: { activity_count: (activities ?? []).length } },
    req,
  );

  return new NextResponse(JSON.stringify(payload, null, 2), {
    status:  200,
    headers: {
      'Content-Type':        'application/json',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control':       'no-store, max-age=0',
    },
  });
}
