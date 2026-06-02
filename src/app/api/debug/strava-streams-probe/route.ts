/**
 * GET /api/debug/strava-streams-probe?activity_id=<id>
 *
 * Dumps Strava's /activities/{id}/streams response for a specific
 * activity, plus what we currently have in our DB row's payload.
 * Lets us see EXACTLY which series Strava is missing for an
 * activity whose detail page renders empty chart boxes.
 *
 * Authed-only. Remove once the Strava-streams audit is done.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/api-auth';
import { isAdminEmail } from '@/lib/admin';
import { supabaseAdmin } from '@/lib/db';

const UA = 'TheLittleExplorer/0.1 (+https://the-little-explorer-app.vercel.app)';

export async function GET(req: NextRequest) {
  const authed = await getAuthedUser(req);
  if (!authed?.id) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const callerId    = authed.id;
  const isAdmin     = isAdminEmail(authed.email ?? null);

  const url = new URL(req.url);
  const activityIdRaw = url.searchParams.get('activity_id');
  if (!activityIdRaw) {
    return NextResponse.json({ error: 'missing activity_id param' }, { status: 400 });
  }
  const activityId = Number(activityIdRaw);
  if (!Number.isFinite(activityId)) {
    return NextResponse.json({ error: 'invalid activity_id' }, { status: 400 });
  }

  // ── 1. Read what's currently in DB for this activity ──
  const { data: rowData, error: rowErr } = await supabaseAdmin()
    .from('activities')
    .select('id, user_id, title, sport, original_type, start_date, payload')
    .eq('id', activityId)
    .maybeSingle();
  if (rowErr) {
    return NextResponse.json({ error: 'db_error', detail: rowErr.message }, { status: 500 });
  }
  if (!rowData) {
    return NextResponse.json({ error: 'activity_not_found_in_db' }, { status: 404 });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = rowData as any;
  // The activity belongs to `row.user_id`. Two access paths:
  //   - Caller IS the owner → standard self-debug.
  //   - Caller is in the admin allowlist → bypass the
  //     ownership check so an admin can audit another rider's
  //     stream state without logging in as them.
  // We then fetch Strava with the activity-owner's refresh
  // token in BOTH cases — never the admin's — because the
  // streams endpoint is scoped to the athlete who recorded
  // the activity.
  if (row.user_id !== callerId && !isAdmin) {
    return NextResponse.json({ error: 'not_your_activity' }, { status: 403 });
  }
  const userId = row.user_id;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payload = (row.payload ?? {}) as Record<string, any>;
  const dbSummary = {
    sport:         row.sport,
    original_type: row.original_type,
    title:         row.title,
    gps_count:        Array.isArray(payload.gps)        ? payload.gps.length        : null,
    altitude_count:   Array.isArray(payload.altitude)   ? payload.altitude.length   : null,
    distance_count:   Array.isArray(payload.distance_m) ? payload.distance_m.length : null,
    time_count:       Array.isArray(payload.time_s)     ? payload.time_s.length     : null,
    heartrate_count:  Array.isArray(payload.heartrate)  ? payload.heartrate.length  : null,
    speed_count:      Array.isArray(payload.speed_kmh)  ? payload.speed_kmh.length  : null,
  };

  // ── 2. Refresh token + fetch streams from Strava ──
  const { data: accountRows, error: accErr } = await supabaseAdmin()
    .schema('next_auth')
    .from('accounts')
    .select('refresh_token, providerAccountId')
    .eq('userId',  userId)
    .eq('provider', 'strava')
    .limit(1);
  if (accErr || !accountRows || accountRows.length === 0) {
    return NextResponse.json({ error: 'strava_not_connected', detail: accErr?.message }, { status: 400 });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const strava = accountRows[0] as any;

  const clientId     = process.env.STRAVA_CLIENT_ID!;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET!;
  const tokenRes = await fetch('https://www.strava.com/api/v3/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept':       'application/json',
      'User-Agent':   UA,
    },
    body: new URLSearchParams({
      client_id:     clientId,
      client_secret: clientSecret,
      grant_type:    'refresh_token',
      refresh_token: strava.refresh_token,
    }).toString(),
  });
  if (!tokenRes.ok) {
    const body = (await tokenRes.text()).slice(0, 400);
    return NextResponse.json({
      step:        'token_refresh',
      stravaStatus: tokenRes.status,
      stravaBody:  body,
      dbSummary,
    }, { status: 502 });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tokenData = await tokenRes.json() as any;
  const accessToken = tokenData.access_token as string;

  const keys = 'time,distance,latlng,altitude,velocity_smooth,heartrate';
  const streamRes = await fetch(
    `https://www.strava.com/api/v3/activities/${activityId}/streams?keys=${keys}&key_by_type=true`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept:        'application/json',
        'User-Agent':  UA,
      },
    },
  );
  const streamBody = await streamRes.text();
  let streamJson: unknown = null;
  try { streamJson = JSON.parse(streamBody); } catch { /* keep null */ }

  // Summarise what Strava sent — counts + first/last value per key.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stravaSummary: Record<string, any> = {};
  if (streamJson && typeof streamJson === 'object' && !Array.isArray(streamJson)) {
    for (const [k, v] of Object.entries(streamJson)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const series = (v as any)?.data;
      stravaSummary[k] = {
        present: Array.isArray(series),
        count:   Array.isArray(series) ? series.length : 0,
        first:   Array.isArray(series) && series.length > 0 ? series[0] : null,
        last:    Array.isArray(series) && series.length > 0 ? series[series.length - 1] : null,
      };
    }
  }

  return NextResponse.json({
    activityId,
    dbSummary,
    strava: {
      status: streamRes.status,
      summary: stravaSummary,
      // truncated raw body so we can still inspect malformed responses
      rawBodyExcerpt: streamBody.slice(0, 800),
    },
  });
}
