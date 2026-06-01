/**
 * GET /api/debug/strava-probe
 *
 * One-shot diagnostic: refreshes the current user's Strava token,
 * then hits /athlete and dumps EVERY piece of state we can see —
 * status codes, headers, response bodies, token excerpts — so we
 * can root-cause the recurring 500-on-/athlete pattern.
 *
 * Returns plain JSON the caller can paste. Restricted to authed
 * users only. Remove this route once the Strava issue is resolved.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/db';

const UA = 'TheLittleExplorer/0.1 (+https://the-little-explorer-app.vercel.app)';

interface Probe {
  step: string;
  ok?: boolean;
  status?: number;
  bodyExcerpt?: string;
  responseHeaders?: Record<string, string>;
  tokenFingerprint?: string;
  tokenLength?: number;
  notes?: string;
}

function fingerprint(token: string | undefined | null): string {
  if (!token) return '(empty)';
  if (token.length < 14) return `(short: ${token.length} chars)`;
  return `${token.slice(0, 6)}…${token.slice(-6)} (${token.length} chars)`;
}

function captureHeaders(res: Response): Record<string, string> {
  const out: Record<string, string> = {};
  // Strava response headers often carry x-ratelimit-limit /
  // x-ratelimit-usage / etc. We grab them all for inspection.
  res.headers.forEach((v, k) => { out[k] = v; });
  return out;
}

export async function GET(req: NextRequest) {
  const authed = await getAuthedUser(req);
  if (!authed?.id) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const userId = authed.id;
  const steps: Probe[] = [];

  // 1. Read refresh token from DB.
  const { data: accountRows, error: accErr } = await supabaseAdmin()
    .schema('next_auth')
    .from('accounts')
    .select('refresh_token, access_token, providerAccountId, scope, expires_at')
    .eq('userId',  userId)
    .eq('provider', 'strava')
    .limit(1);

  if (accErr) {
    steps.push({ step: 'read_account', ok: false, notes: accErr.message });
    return NextResponse.json({ steps }, { status: 500 });
  }
  if (!accountRows || accountRows.length === 0) {
    steps.push({ step: 'read_account', ok: false, notes: 'no strava account row' });
    return NextResponse.json({ steps }, { status: 200 });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = accountRows[0] as any;
  steps.push({
    step: 'read_account',
    ok: true,
    notes: `providerAccountId=${row.providerAccountId} scope=${row.scope} expires_at=${row.expires_at}`,
    tokenFingerprint: fingerprint(row.refresh_token),
  });

  // 2. Refresh token.
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
      refresh_token: row.refresh_token,
    }).toString(),
  });
  const tokenBody = await tokenRes.text();
  steps.push({
    step:            'refresh_token',
    ok:              tokenRes.ok,
    status:          tokenRes.status,
    bodyExcerpt:     tokenBody.slice(0, 600),
    responseHeaders: captureHeaders(tokenRes),
  });
  if (!tokenRes.ok) {
    return NextResponse.json({ steps }, { status: 200 });
  }

  let parsedToken: { access_token?: string; refresh_token?: string; expires_at?: number; token_type?: string };
  try {
    parsedToken = JSON.parse(tokenBody);
  } catch {
    steps.push({ step: 'parse_token', ok: false, notes: 'token response was not JSON' });
    return NextResponse.json({ steps }, { status: 200 });
  }
  const accessToken = parsedToken.access_token ?? '';
  steps.push({
    step:             'parse_token',
    ok:               true,
    tokenFingerprint: fingerprint(accessToken),
    tokenLength:      accessToken.length,
    notes:            `token_type=${parsedToken.token_type} expires_at=${parsedToken.expires_at}`,
  });

  // 3. Probe /athlete.
  const athleteRes = await fetch('https://www.strava.com/api/v3/athlete', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept:        'application/json',
      'User-Agent':  UA,
    },
  });
  const athleteBody = await athleteRes.text();
  steps.push({
    step:            'GET_athlete',
    ok:              athleteRes.ok,
    status:          athleteRes.status,
    bodyExcerpt:     athleteBody.slice(0, 600),
    responseHeaders: captureHeaders(athleteRes),
  });

  // 4. Probe /athlete/activities (small).
  const actRes = await fetch('https://www.strava.com/api/v3/athlete/activities?per_page=1', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept:        'application/json',
      'User-Agent':  UA,
    },
  });
  const actBody = await actRes.text();
  steps.push({
    step:            'GET_activities',
    ok:              actRes.ok,
    status:          actRes.status,
    bodyExcerpt:     actBody.slice(0, 600),
    responseHeaders: captureHeaders(actRes),
  });

  // 5. Try alternative endpoints. If /athlete is endpoint-specific
  // broken on Strava's side but /athletes/{id} or /athletes/{id}/stats
  // works, we can rewrite the sync to use those instead.
  const athleteId = row.providerAccountId;
  const altRes = await fetch(`https://www.strava.com/api/v3/athletes/${athleteId}/stats`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept:        'application/json',
      'User-Agent':  UA,
    },
  });
  const altBody = await altRes.text();
  steps.push({
    step:            `GET_athlete_stats(${athleteId})`,
    ok:              altRes.ok,
    status:          altRes.status,
    bodyExcerpt:     altBody.slice(0, 600),
    responseHeaders: captureHeaders(altRes),
  });

  // 6. Also try /athletes/{id} (specific athlete profile).
  const altRes2 = await fetch(`https://www.strava.com/api/v3/athletes/${athleteId}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept:        'application/json',
      'User-Agent':  UA,
    },
  });
  const altBody2 = await altRes2.text();
  steps.push({
    step:            `GET_athletes_by_id(${athleteId})`,
    ok:              altRes2.ok,
    status:          altRes2.status,
    bodyExcerpt:     altBody2.slice(0, 600),
    responseHeaders: captureHeaders(altRes2),
  });

  return NextResponse.json({ steps }, { status: 200 });
}
