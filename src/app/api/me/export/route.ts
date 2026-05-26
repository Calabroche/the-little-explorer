/**
 * GET /api/me/export — RGPD art. 20 (portability).
 *
 * Returns a JSON file containing everything we store about the
 * authenticated user, served with Content-Disposition: attachment so
 * the browser triggers a download instead of rendering it.
 *
 * Shape:
 *   {
 *     exportedAt:  ISO8601,
 *     schema:      "tle-export-v1",
 *     profile:     { id, email, name, athleteId, settings, effective },
 *     activities:  [ full Supabase rows including payload streams ],
 *   }
 *
 * Out of scope here (intentional):
 *   - OAuth refresh tokens (security: never exported).
 *   - admin_audit entries about this user (those are operational
 *     metadata, not user content — and could leak the actor's
 *     identity if the user was action-targeted).
 *   - The legacy /data/users/<id>/ JSON files. Those are being
 *     phased out in favour of next_auth.users + public.activities.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/db';
import { getAuthedUser } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Same defaults as /api/me — kept in sync so the "effective" block
// matches what the rest of the app uses today.
const PROFILES_BY_EMAIL: Record<string, { riderKg: number; bikeKg: number }> = {
  'florian.calabrese@gmail.com': { riderKg: 66, bikeKg: 8.18 },
};
const DEFAULT_PROFILE = { riderKg: 70, bikeKg: 9 };

export async function GET(req: NextRequest) {
  const authed = await getAuthedUser(req);
  if (!authed?.id) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // 1. User row (settings + identity).
  const { data: user, error: userErr } = await supabaseAdmin()
    .schema('next_auth')
    .from('users')
    .select('id, email, name, image, athlete_id, rider_kg, bike_kg, custom_ftp, created_at')
    .eq('id', authed.id)
    .maybeSingle();
  if (userErr) {
    console.error('[me.export] user query failed:', userErr.message);
    return NextResponse.json({ error: 'db_error' }, { status: 500 });
  }
  if (!user) {
    return NextResponse.json({ error: 'user_not_found' }, { status: 404 });
  }

  // 2. Activities — every row owned by this user, full payload included
  //    so the export is genuinely portable (a sibling app can ingest
  //    the streams + metrics from this dump alone).
  const { data: activities, error: actErr } = await supabaseAdmin()
    .from('activities')
    .select('id, sport, original_type, title, start_date, duration_min, distance_km, elevation_m, payload, created_at')
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
    schema:     'tle-export-v1',
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
    activities: activities ?? [],
  };

  const filename = `the-little-explorer-export-${new Date().toISOString().slice(0, 10)}.json`;

  return new NextResponse(JSON.stringify(payload, null, 2), {
    status:  200,
    headers: {
      'Content-Type':        'application/json',
      'Content-Disposition': `attachment; filename="${filename}"`,
      // Don't cache — this contains personal data, every request
      // should hit fresh state.
      'Cache-Control':       'no-store, max-age=0',
    },
  });
}
