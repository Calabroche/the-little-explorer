/**
 * GET /api/admin/metrics — product analytics rollup for /admin/metrics.
 *
 * Restricted to the admin email allowlist (src/lib/admin.ts). Anyone
 * else gets 403.
 *
 * Returns the aggregated numbers the dashboard renders. We compute
 * everything server-side rather than shipping raw events to the
 * client because:
 *   1. Smaller payload — 3 KB JSON vs MB of raw events.
 *   2. Hides individual user identifiers from the client even on the
 *      admin side. The dashboard sees counts; if we ever want to drill
 *      into specific users we'll add a separate endpoint.
 *
 * Response shape:
 *   {
 *     totals: { users, activities, events_7d, signups_7d, exports_total, … }
 *     dau:    [ { day: 'YYYY-MM-DD', count: number } ]   // 30 days
 *     funnel: { signup, welcome_done, sport_done, profile_done, strava_connected, strava_skipped, complete }
 *     events: [ { type, count } ]                         // 7d breakdown
 *     sync:   { received_7d, synced_7d, success_rate }
 *     recent: [ { type, user_id, userName, occurred_at, properties } ]  // last 200, grouped by user client-side
 *   }
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/db';
import { isAdminEmail } from '@/lib/admin';
import { getAuthedUser } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface MetricsResponse {
  totals: {
    users:         number;
    activities:    number;
    events_7d:     number;
    signups_7d:    number;
    exports_total: number;
    dau_today:     number;
  };
  dau: { day: string; count: number }[];
  funnel: {
    signup:            number;
    welcome_done:      number;
    sport_done:        number;
    profile_done:      number;
    strava_connected:  number;
    strava_skipped:    number;
    complete:          number;
  };
  events: { type: string; count: number }[];
  sync: {
    received_7d:   number;
    synced_7d:     number;
    success_rate:  number; // 0..1
  };
  recent: {
    type:        string;
    user_id:     string | null;
    userName:    string | null;   // resolved display name (name || email)
    occurred_at: string;
    properties:  Record<string, unknown>;
  }[];
}

export async function GET(req: NextRequest) {
  const authed = await getAuthedUser(req);
  if (!authed?.email) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!isAdminEmail(authed.email)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const db = supabaseAdmin();
  const now7d = new Date(Date.now() - 7  * 86_400_000).toISOString();
  const now30d = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const todayStart = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z').toISOString();

  // Fire all the totals queries in parallel — each is a cheap COUNT.
  const [
    { count: usersTotal },
    { count: activitiesTotal },
    { count: events7d },
    { count: signups7d },
    { count: exportsTotal },
    // DAU today (distinct users) — supabase JS doesn't expose
    // distinct count nicely, so we fetch user_ids and dedupe locally.
    { data: dauTodayRows },
  ] = await Promise.all([
    db.schema('next_auth').from('users').select('*', { count: 'exact', head: true }),
    db.from('activities').select('*', { count: 'exact', head: true }),
    db.schema('next_auth').from('events').select('*', { count: 'exact', head: true }).gte('occurred_at', now7d),
    db.schema('next_auth').from('events').select('*', { count: 'exact', head: true }).eq('event_type', 'signup').gte('occurred_at', now7d),
    db.schema('next_auth').from('events').select('*', { count: 'exact', head: true }).eq('event_type', 'export'),
    db.schema('next_auth').from('events').select('user_id').gte('occurred_at', todayStart).not('user_id', 'is', null),
  ]);
  const dauToday = new Set((dauTodayRows ?? []).map(r => r.user_id as string)).size;

  // DAU per day for the last 30 days. We fetch all event rows in the
  // window with their user_id + occurred_at, then group client-side
  // (only ~1000 rows even on busy days, cheap enough).
  const { data: dauRaw } = await db.schema('next_auth')
    .from('events')
    .select('user_id, occurred_at')
    .gte('occurred_at', now30d)
    .not('user_id', 'is', null)
    .order('occurred_at', { ascending: true });

  const dauMap = new Map<string, Set<string>>(); // day → set<user_id>
  for (const row of dauRaw ?? []) {
    const day = (row.occurred_at as string).slice(0, 10);
    let set = dauMap.get(day);
    if (!set) { set = new Set(); dauMap.set(day, set); }
    set.add(row.user_id as string);
  }
  // Build a contiguous 30-day series so the chart doesn't skip days.
  const dau: { day: string; count: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const day = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    dau.push({ day, count: dauMap.get(day)?.size ?? 0 });
  }

  // Onboarding funnel — count events of each type all-time. Tiny set,
  // sequential fetches kept readable.
  async function eventCount(type: string): Promise<number> {
    const { count } = await db.schema('next_auth')
      .from('events')
      .select('*', { count: 'exact', head: true })
      .eq('event_type', type);
    return count ?? 0;
  }
  const [
    funnel_signup,
    funnel_welcome,
    funnel_sport,
    funnel_profile,
    funnel_strava_yes,
    funnel_strava_no,
    funnel_complete,
  ] = await Promise.all([
    eventCount('signup'),
    eventCount('onboarding_step_welcome_done'),
    eventCount('onboarding_step_sport_done'),
    eventCount('onboarding_step_profile_done'),
    eventCount('onboarding_step_strava_connected'),
    eventCount('onboarding_step_strava_skipped'),
    eventCount('onboarding_complete'),
  ]);

  // Event-type breakdown (last 7d). Fetch all rows, count locally.
  const { data: eventsRaw } = await db.schema('next_auth')
    .from('events')
    .select('event_type')
    .gte('occurred_at', now7d);
  const eventCounts = new Map<string, number>();
  for (const row of eventsRaw ?? []) {
    const t = row.event_type as string;
    eventCounts.set(t, (eventCounts.get(t) ?? 0) + 1);
  }
  const events = Array.from(eventCounts.entries())
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);

  // Sync success ratio (last 7d).
  const [
    { count: syncReceived7d },
    { count: syncSynced7d },
  ] = await Promise.all([
    db.schema('next_auth').from('events').select('*', { count: 'exact', head: true }).eq('event_type', 'strava_webhook_received').gte('occurred_at', now7d),
    db.schema('next_auth').from('events').select('*', { count: 'exact', head: true }).eq('event_type', 'strava_webhook_synced').gte('occurred_at', now7d),
  ]);
  const successRate = (syncReceived7d ?? 0) === 0 ? 1 : (syncSynced7d ?? 0) / (syncReceived7d ?? 1);

  // Recent events for the per-user activity tail. Pull a wider window
  // (200) than the old flat "25 derniers" so grouping by user is
  // meaningful — the client collapses these into one expandable row per
  // person instead of a 10k-line firehose.
  const { data: recentRows } = await db.schema('next_auth')
    .from('events')
    .select('event_type, user_id, occurred_at, properties')
    .order('occurred_at', { ascending: false })
    .limit(200);

  // Resolve user_id → display name so the tail shows people, not UUIDs.
  const recentUserIds = Array.from(new Set(
    (recentRows ?? [])
      .map(r => r.user_id as string | null)
      .filter((v): v is string => !!v),
  ));
  const nameById = new Map<string, string>();
  if (recentUserIds.length > 0) {
    const { data: nameRows } = await db.schema('next_auth')
      .from('users')
      .select('id, name, email')
      .in('id', recentUserIds);
    for (const u of (nameRows ?? [])) {
      const id      = u.id as string;
      const display = (u.name as string | null)?.trim() || (u.email as string | null) || null;
      if (display) nameById.set(id, display);
    }
  }

  const recent = (recentRows ?? []).map(r => {
    const uid = r.user_id as string | null;
    return {
      type:        r.event_type as string,
      user_id:     uid,
      userName:    uid ? (nameById.get(uid) ?? null) : null,
      occurred_at: r.occurred_at as string,
      properties:  (r.properties ?? {}) as Record<string, unknown>,
    };
  });

  const payload: MetricsResponse = {
    totals: {
      users:         usersTotal ?? 0,
      activities:    activitiesTotal ?? 0,
      events_7d:     events7d ?? 0,
      signups_7d:    signups7d ?? 0,
      exports_total: exportsTotal ?? 0,
      dau_today:     dauToday,
    },
    dau,
    funnel: {
      signup:           funnel_signup,
      welcome_done:     funnel_welcome,
      sport_done:       funnel_sport,
      profile_done:     funnel_profile,
      strava_connected: funnel_strava_yes,
      strava_skipped:   funnel_strava_no,
      complete:         funnel_complete,
    },
    events,
    sync: {
      received_7d:  syncReceived7d ?? 0,
      synced_7d:    syncSynced7d ?? 0,
      success_rate: successRate,
    },
    recent,
  };
  return NextResponse.json(payload);
}
