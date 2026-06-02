/**
 * GET /api/debug/list-user-activities?user_id=<uuid>&limit=20
 *
 * Lists a user's last N activities (id + title + date + sport +
 * stream-counts per series). Admin-only — used to grab the right
 * activity_id before hitting /api/debug/strava-streams-probe,
 * without having to log in as the user being audited.
 *
 * If no user_id is provided, lists the caller's own activities.
 *
 * Remove with the rest of the /api/debug/* surface once the
 * Strava-streams audit is done.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/api-auth';
import { isAdminEmail } from '@/lib/admin';
import { supabaseAdmin } from '@/lib/db';

export async function GET(req: NextRequest) {
  const authed = await getAuthedUser(req);
  if (!authed?.id) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const callerId = authed.id;
  const isAdmin  = isAdminEmail(authed.email ?? null);

  const url = new URL(req.url);
  const targetUserIdRaw = url.searchParams.get('user_id');
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit') ?? '20')));

  // Default = self. Admin can pass user_id to inspect anyone.
  let userId = callerId;
  if (targetUserIdRaw) {
    if (!isAdmin && targetUserIdRaw !== callerId) {
      return NextResponse.json({ error: 'forbidden_other_user' }, { status: 403 });
    }
    userId = targetUserIdRaw;
  }

  const { data, error } = await supabaseAdmin()
    .from('activities')
    .select('id, title, sport, original_type, start_date, payload')
    .eq('user_id', userId)
    .order('start_date', { ascending: false })
    .limit(limit);
  if (error) {
    return NextResponse.json({ error: 'db_error', detail: error.message }, { status: 500 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (data ?? []).map((r: any) => {
    const p = (r.payload ?? {}) as Record<string, unknown>;
    const sz = (k: string): number | null => Array.isArray(p[k]) ? (p[k] as unknown[]).length : null;
    return {
      id:            r.id,
      title:         r.title,
      sport:         r.sport,
      original_type: r.original_type,
      start_date:    r.start_date,
      streams: {
        gps:       sz('gps'),
        altitude:  sz('altitude'),
        distance:  sz('distance_m'),
        time:      sz('time_s'),
        heartrate: sz('heartrate'),
        speed:     sz('speed_kmh'),
      },
    };
  });

  return NextResponse.json({ userId, count: rows.length, rows });
}
