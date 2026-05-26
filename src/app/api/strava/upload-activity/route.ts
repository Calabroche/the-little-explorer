/**
 * POST /api/strava/upload-activity — push a GPX-encoded ride from the
 * iOS app onto the signed-in user's Strava account.
 *
 * The flow:
 *   1. Authenticate the caller (NextAuth cookie OR Bearer token from
 *      the native app's /auth/native-done handoff).
 *   2. Look up that user's Strava refresh_token from next_auth.accounts.
 *   3. Refresh to an access_token (Strava rotates refresh_tokens — we
 *      persist the rotated one).
 *   4. Multipart-POST the GPX to https://www.strava.com/api/v3/uploads.
 *   5. Strava returns an upload id + initial status. We don't poll —
 *      Strava processes the GPX asynchronously and our existing
 *      strava-webhook (Calabroche/the-little-explorer commit 0406a0d)
 *      handles the activity-created event when it's done.
 *
 * Request JSON:
 *   {
 *     gpx:          string,   // the full GPX 1.1 document
 *     name:         string,   // activity title shown on Strava
 *     activityType: string,   // "Ride" | "Run" | "Hike" | ...
 *     externalId?:  string,   // optional dedupe key, e.g. "tle-ride-<id>"
 *     description?: string,
 *     trainer?:     boolean,
 *     commute?:     boolean,
 *   }
 *
 * Response:
 *   { ok: true, uploadId: number, status: string }
 *   { error: "strava_not_connected" | "token_refresh_failed" | "upload_failed", detail?: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/db';
import { getAuthedUser } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const STRAVA_TOKEN_URL  = 'https://www.strava.com/api/v3/oauth/token';
const STRAVA_UPLOAD_URL = 'https://www.strava.com/api/v3/uploads';

interface Body {
  gpx?:          string;
  name?:         string;
  activityType?: string;
  externalId?:   string;
  description?:  string;
  trainer?:      boolean;
  commute?:      boolean;
}

export async function POST(req: NextRequest) {
  const authed = await getAuthedUser(req);
  if (!authed?.id) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const userId = authed.id;

  let body: Body;
  try {
    body = await req.json() as Body;
  } catch {
    return NextResponse.json({ error: 'bad_json' }, { status: 400 });
  }
  if (!body.gpx || body.gpx.length < 100) {
    return NextResponse.json({ error: 'missing_gpx' }, { status: 400 });
  }
  const activityType = body.activityType || 'Ride';
  const name         = (body.name || `Sortie ${new Date().toLocaleDateString('fr-FR')}`).slice(0, 200);

  // ── Look up Strava credentials ─────────────────────────────────────
  const { data: accountRows, error: accErr } = await supabaseAdmin()
    .schema('next_auth')
    .from('accounts')
    .select('refresh_token')
    .eq('userId',  userId)
    .eq('provider', 'strava')
    .limit(1);

  if (accErr) {
    console.error('[strava-upload] accounts query failed:', accErr.message);
    return NextResponse.json({ error: 'db_error' }, { status: 500 });
  }
  if (!accountRows || accountRows.length === 0) {
    return NextResponse.json({ error: 'strava_not_connected' }, { status: 400 });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const refreshToken = (accountRows[0] as any).refresh_token as string;

  // ── Refresh to access_token ────────────────────────────────────────
  const clientId     = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: 'strava_client_not_configured' }, { status: 500 });
  }

  const tokenRes = await fetch(STRAVA_TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id:     clientId,
      client_secret: clientSecret,
      grant_type:    'refresh_token',
      refresh_token: refreshToken,
    }),
  });
  if (!tokenRes.ok) {
    const txt = await tokenRes.text();
    console.error('[strava-upload] token refresh failed:', tokenRes.status, txt.slice(0, 200));
    return NextResponse.json({ error: 'token_refresh_failed' }, { status: 502 });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tokenData = await tokenRes.json() as any;
  const accessToken = tokenData.access_token as string;

  // Persist the rotated refresh_token so the next call doesn't reuse a
  // stale one (Strava rotates on every /oauth/token).
  if (tokenData.refresh_token && tokenData.refresh_token !== refreshToken) {
    await supabaseAdmin()
      .schema('next_auth')
      .from('accounts')
      .update({
        refresh_token: tokenData.refresh_token as string,
        access_token:  accessToken,
        expires_at:    tokenData.expires_at ?? null,
      })
      .eq('userId',  userId)
      .eq('provider', 'strava');
  }

  // ── Push the GPX to Strava ─────────────────────────────────────────
  // multipart/form-data with file=<gpx-blob> + the activity metadata.
  // Strava replies fast (upload accepted) and processes the file
  // asynchronously — the strava-webhook will fire the activity-create
  // event once it's parsed and the activity is on the athlete's page.
  const form = new FormData();
  form.append('data_type', 'gpx');
  form.append('activity_type', mapActivityType(activityType));
  form.append('name', name);
  if (body.description) form.append('description', body.description.slice(0, 1024));
  if (body.externalId)  form.append('external_id',  body.externalId.slice(0, 80));
  if (body.trainer)     form.append('trainer',      '1');
  if (body.commute)     form.append('commute',      '1');

  const gpxBlob = new Blob([body.gpx], { type: 'application/gpx+xml' });
  form.append('file', gpxBlob, 'ride.gpx');

  const uploadRes = await fetch(STRAVA_UPLOAD_URL, {
    method:  'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body:    form,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let uploadData: any;
  try {
    uploadData = await uploadRes.json();
  } catch {
    uploadData = {};
  }

  if (!uploadRes.ok) {
    console.error('[strava-upload] Strava rejected upload:', uploadRes.status, uploadData);
    return NextResponse.json(
      { error: 'upload_failed', status: uploadRes.status, detail: uploadData?.message ?? null },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok:       true,
    uploadId: uploadData?.id ?? null,
    status:   uploadData?.status ?? 'pending',
  });
}

// ── Mapping ────────────────────────────────────────────────────────────
// Strava upload accepts a richer set of types than the legacy
// `activity_type` field; we use the type names the iOS app already
// stores on RideRecord.originalType (e.g. "MountainBike", "Pilates").
function mapActivityType(t: string): string {
  const normalized = t.toLowerCase();
  if (normalized.includes('mountainbike'))      return 'mountainbikeride';
  if (normalized.includes('gravel'))             return 'gravelride';
  if (normalized.includes('ebike'))              return 'ebikeride';
  if (normalized.includes('indoorcycling'))      return 'virtualride';
  if (normalized.includes('roadcycling'))        return 'ride';
  if (normalized.includes('cycling') || normalized === 'ride') return 'ride';
  if (normalized.includes('trail'))              return 'trailrun';
  if (normalized.includes('running') || normalized === 'run') return 'run';
  if (normalized.includes('hike'))               return 'hike';
  if (normalized.includes('walk'))               return 'walk';
  if (normalized.includes('alpineski'))          return 'alpineski';
  if (normalized.includes('nordicski'))          return 'nordicski';
  if (normalized.includes('snowshoe'))           return 'snowshoe';
  if (normalized.includes('swim'))               return 'swim';
  if (normalized.includes('strength'))           return 'weighttraining';
  if (normalized.includes('hiit'))               return 'workout';
  if (normalized.includes('yoga'))               return 'yoga';
  if (normalized.includes('pilates'))            return 'pilates';
  if (normalized.includes('rowing'))             return 'rowing';
  return 'workout';
}
