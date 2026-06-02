/**
 * POST /api/strava/backfill-streams
 *
 * Walks the current user's activity rows looking for ones that came
 * in via /api/strava/sync (the bulk fetch) — those rows have summary
 * metadata but NO streams (gps, altitude, hr, speed time-series),
 * which is why their cards show no map and their detail pages have
 * empty charts. For each pending row, this endpoint calls Strava's
 * `/activities/{id}/streams` and merges the result into the row's
 * payload.
 *
 * Self-paced: each call processes at most BATCH_SIZE activities
 * (~10). Returns `{ processed, remaining }` so the caller can loop
 * until `remaining` hits 0. Keeps us well below Strava's 200 req /
 * 15 min per-athlete cap.
 *
 * Same response shape as /api/strava/sync so the sidebar's failure
 * mapping (Strava status forwarded, token_revoked surfaced, etc.)
 * works without change.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/db';

const STRAVA_TOKEN_URL = 'https://www.strava.com/api/v3/oauth/token';
const UA = 'TheLittleExplorer/0.1 (+https://the-little-explorer-app.vercel.app)';
// Tuned for two priorities: keep the API call burst safely under
// Strava's 200 req / 15 min cap (10 activity calls + 1 token refresh
// = 11 reqs per backfill click), AND fit comfortably inside Vercel's
// 60 s function timeout (Strava /streams takes 300-800 ms typically,
// so 10 calls ~= 5-8 s).
const BATCH_SIZE = 10;

export async function POST(req: NextRequest) {
  const authed = await getAuthedUser(req);
  if (!authed?.id) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const userId = authed.id;

  // ── 1. Find activities for this user that are missing streams ──
  // We treat "missing streams" as `payload.gps` not being an array
  // of length >= 2. Manually-created Strava activities legitimately
  // have no GPS, so they'd loop forever — we cap retries via
  // BATCH_SIZE per click + the caller eventually stops.
  const { data: pendingRows, error: queryErr } = await supabaseAdmin()
    .from('activities')
    .select('id, payload')
    .eq('user_id', userId)
    .order('start_date', { ascending: false })
    .limit(200);
  if (queryErr) {
    console.error('[backfill-streams] query failed:', queryErr.message);
    return NextResponse.json({ error: 'db_error' }, { status: 500 });
  }

  // A row needs streams if ANY of the data series we plot are
  // missing — not just GPS. Earlier this only checked gps.length,
  // which meant a run that had a map but empty speed/altitude
  // arrays was silently skipped, leaving the detail page's charts
  // forever blank even after the user clicked the backfill button.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const needsStreams = (pendingRows ?? []).filter((r: any) => {
    const p = r.payload ?? {};
    const has = (arr: unknown): boolean => Array.isArray(arr) && (arr as unknown[]).length >= 2;
    // GPS still drives the map. Speed_kmh + altitude drive the
    // two side charts. Distance_m is needed to derive missing
    // speed (see merge step below). If ANY of those is empty,
    // this row is a candidate for re-fetch.
    return !has(p.gps) || !has(p.speed_kmh) || !has(p.altitude) || !has(p.distance_m);
  });
  if (needsStreams.length === 0) {
    return NextResponse.json({ processed: 0, remaining: 0, done: true });
  }

  const batch = needsStreams.slice(0, BATCH_SIZE);

  // ── 2. Refresh token ───────────────────────────────────────────
  // Same pattern as /api/strava/sync — read the user's refresh_token
  // from next_auth.accounts, rotate it, persist the new one.
  const { data: accountRows, error: accErr } = await supabaseAdmin()
    .schema('next_auth')
    .from('accounts')
    .select('refresh_token, providerAccountId')
    .eq('userId',  userId)
    .eq('provider', 'strava')
    .limit(1);
  if (accErr) {
    console.error('[backfill-streams] accounts query failed:', accErr.message);
    return NextResponse.json({ error: 'db_error' }, { status: 500 });
  }
  if (!accountRows || accountRows.length === 0) {
    return NextResponse.json({ error: 'strava_not_connected' }, { status: 400 });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stravaAccount = accountRows[0] as any;
  const refreshToken  = stravaAccount.refresh_token as string;

  const clientId     = process.env.STRAVA_CLIENT_ID!;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET!;
  const tokenRes = await fetch(STRAVA_TOKEN_URL, {
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
      refresh_token: refreshToken,
    }).toString(),
  });
  if (!tokenRes.ok) {
    const txt = await tokenRes.text();
    console.error('[backfill-streams] token refresh failed:', tokenRes.status, txt.slice(0, 200));
    const status = tokenRes.status;
    return NextResponse.json(
      {
        error:        status === 400 || status === 401 ? 'token_revoked_needs_reconnect' : 'token_refresh_failed',
        stravaStatus: status,
        stravaBody:   txt.slice(0, 200),
      },
      { status: 502 },
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tokenData = await tokenRes.json() as any;
  const accessToken = tokenData.access_token as string;

  if (tokenData.refresh_token && tokenData.refresh_token !== refreshToken) {
    await supabaseAdmin()
      .schema('next_auth')
      .from('accounts')
      .update({
        refresh_token: tokenData.refresh_token,
        access_token:  accessToken,
        expires_at:    tokenData.expires_at ?? null,
      })
      .eq('userId',  userId)
      .eq('provider', 'strava');
  }

  // ── 3. Fetch streams for each activity in the batch ─────────────
  const keys = 'time,distance,latlng,altitude,velocity_smooth,heartrate';
  let processed = 0;
  let failures = 0;
  let lastUpstreamStatus = 0;
  let lastUpstreamBody = '';
  for (const row of batch) {
    const r = await fetch(
      `https://www.strava.com/api/v3/activities/${row.id}/streams?keys=${keys}&key_by_type=true`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept:        'application/json',
          'User-Agent':  UA,
        },
      },
    );
    if (!r.ok) {
      lastUpstreamStatus = r.status;
      lastUpstreamBody = (await r.text()).slice(0, 200);
      // 404 = legitimately no streams (manually-created activity).
      // We don't retry but we DO mark it as processed so we don't
      // loop on it forever — write a sentinel `no_streams_404` so
      // the filter above skips it next time.
      if (r.status === 404) {
        await supabaseAdmin()
          .from('activities')
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .update({ payload: { ...(row.payload as any), _no_streams: '404' } })
          .eq('id', row.id);
        processed += 1;
        continue;
      }
      failures += 1;
      continue;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const streams = await r.json() as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const existing = (row.payload ?? {}) as Record<string, any>;
    const gps:        [number, number][] = streams?.latlng?.data    ?? [];
    const altitude:    number[]          = streams?.altitude?.data  ?? [];
    const time_s:      number[]          = streams?.time?.data      ?? [];
    const distance_m:  number[]          = streams?.distance?.data  ?? [];
    const heartrate:   number[]          = streams?.heartrate?.data ?? [];
    const velocity:    number[]          = streams?.velocity_smooth?.data ?? [];
    // Strava sometimes omits velocity_smooth for short / urban runs
    // and short walks even though distance + time are present. When
    // that happens, derive speed from Δdistance / Δtime so the
    // speed chart doesn't render as an empty box. Only do this when
    // Strava's own series is empty — their smoothed version is
    // better than our naive diff when it's available.
    let speed_kmh: number[];
    if (velocity.length >= 2) {
      speed_kmh = velocity.map(v => v * 3.6);
    } else if (distance_m.length >= 2 && time_s.length === distance_m.length) {
      speed_kmh = distance_m.map((d, i) => {
        if (i === 0) return 0;
        const dd = d - distance_m[i - 1];
        const dt = time_s[i] - time_s[i - 1];
        if (dt <= 0) return 0;
        return (dd / dt) * 3.6;  // m/s → km/h
      });
    } else {
      speed_kmh = [];
    }
    const newPayload = {
      ...existing,
      gps, altitude, time_s, distance_m, heartrate, speed_kmh,
    };
    const { error: updateErr } = await supabaseAdmin()
      .from('activities')
      .update({ payload: newPayload })
      .eq('id', row.id);
    if (updateErr) {
      console.error(`[backfill-streams] update ${row.id} failed:`, updateErr.message);
      failures += 1;
      continue;
    }
    processed += 1;
  }

  // ── 4. If every fetch in this batch failed, bubble that up so the
  //       UI can show the real Strava status instead of "processed: 0".
  if (processed === 0 && failures > 0) {
    return NextResponse.json(
      {
        error:        'streams_fetch_failed',
        stravaStatus: lastUpstreamStatus,
        stravaBody:   lastUpstreamBody,
      },
      { status: 502 },
    );
  }

  return NextResponse.json({
    processed,
    remaining: needsStreams.length - processed,
    done:      needsStreams.length - processed <= 0,
  });
}
