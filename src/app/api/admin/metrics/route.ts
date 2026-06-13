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
  // The 30 contiguous day labels (oldest → newest) for the per-user grid.
  dauDays: string[];
  // Per-user activity, day by day, over the 30-day window. The aggregate
  // `dau` count loses *who* was active each day — this keeps each rider's
  // daily presence so the data isn't lost as the days roll by.
  dauByUser: {
    userId: string;
    name:   string | null;
    total:  number;                   // events in the window
    days:   Record<string, number>;   // day → event count
  }[];
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

  // Events with no user_id but a Strava owner_id (webhooks) belong to a real
  // person too — resolve owner_id → Strava account → user_id so their activity
  // (e.g. an upload that came in through the Strava webhook) counts toward DAU
  // and the per-user breakdown instead of being dropped as "Anonyme".
  const { data: ownerRaw } = await db.schema('next_auth')
    .from('events')
    .select('occurred_at, properties')
    .is('user_id', null)
    .gte('occurred_at', now30d)
    .order('occurred_at', { ascending: true });
  const ownerIdFromProps = (props: unknown): string | null => {
    const o = (props as { owner_id?: number | string } | null)?.owner_id;
    return o != null ? String(o) : null;
  };
  const ownerIds30d = Array.from(new Set(
    (ownerRaw ?? []).map(r => ownerIdFromProps(r.properties)).filter((v): v is string => !!v),
  ));
  const uidByOwner30d = new Map<string, string>();
  if (ownerIds30d.length > 0) {
    const { data: acct } = await db.schema('next_auth')
      .from('accounts')
      .select('userId, providerAccountId')
      .eq('provider', 'strava')
      .in('providerAccountId', ownerIds30d);
    for (const a of (acct ?? [])) {
      uidByOwner30d.set(a.providerAccountId as string, a.userId as string);
    }
  }
  // Real-user rows + webhook rows we could attribute to a user.
  const dauRows: { user_id: string; occurred_at: string }[] = [
    ...((dauRaw ?? []) as { user_id: string; occurred_at: string }[]),
    ...(ownerRaw ?? []).flatMap(r => {
      const uid = uidByOwner30d.get(ownerIdFromProps(r.properties) ?? '');
      return uid ? [{ user_id: uid, occurred_at: r.occurred_at as string }] : [];
    }),
  ];

  const dauMap = new Map<string, Set<string>>(); // day → set<user_id>
  for (const row of dauRows) {
    const day = row.occurred_at.slice(0, 10);
    let set = dauMap.get(day);
    if (!set) { set = new Set(); dauMap.set(day, set); }
    set.add(row.user_id);
  }
  // Build a contiguous 30-day series so the chart doesn't skip days.
  const dauDays: string[] = [];
  for (let i = 29; i >= 0; i--) {
    dauDays.push(new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10));
  }
  const dau: { day: string; count: number }[] = dauDays.map(day => ({
    day, count: dauMap.get(day)?.size ?? 0,
  }));

  // Per-user-per-day activity over the same window. Keeps *who* was active
  // each day so daily engagement isn't lost as the chart's count collapses it.
  const perUser = new Map<string, Map<string, number>>(); // user_id → (day → count)
  for (const row of dauRows) {
    const uid = row.user_id;
    const day = row.occurred_at.slice(0, 10);
    let m = perUser.get(uid);
    if (!m) { m = new Map(); perUser.set(uid, m); }
    m.set(day, (m.get(day) ?? 0) + 1);
  }
  const perUserIds = Array.from(perUser.keys());
  const perUserName = new Map<string, string>();
  if (perUserIds.length > 0) {
    const { data: nm } = await db.schema('next_auth')
      .from('users').select('id, name, email').in('id', perUserIds);
    for (const u of (nm ?? [])) {
      const disp = (u.name as string | null)?.trim() || (u.email as string | null) || null;
      if (disp) perUserName.set(u.id as string, disp);
    }
  }
  const dauByUser = perUserIds.map(uid => {
    const m = perUser.get(uid)!;
    const days: Record<string, number> = {};
    let total = 0;
    m.forEach((c, d) => { days[d] = c; total += c; });
    return { userId: uid, name: perUserName.get(uid) ?? null, total, days };
  }).sort((a, b) => b.total - a.total);

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

  // Some events have no user_id — notably strava_webhook_received, which
  // Strava POSTs before we know which account it belongs to. They DO carry the
  // athlete id in properties.owner_id, so resolve owner_id → Strava account →
  // user_id and fold those events under the real person instead of "Anonyme".
  const ownerOf = (r: { properties: unknown }): string | null => {
    const owner = (r.properties as { owner_id?: number | string } | null)?.owner_id;
    return owner != null ? String(owner) : null;
  };
  const recentOwnerIds = Array.from(new Set(
    (recentRows ?? [])
      .filter(r => !r.user_id)
      .map(ownerOf)
      .filter((v): v is string => !!v),
  ));
  const userIdByOwner = new Map<string, string>();
  if (recentOwnerIds.length > 0) {
    const { data: acctRows } = await db.schema('next_auth')
      .from('accounts')
      .select('userId, providerAccountId')
      .eq('provider', 'strava')
      .in('providerAccountId', recentOwnerIds);
    for (const a of (acctRows ?? [])) {
      userIdByOwner.set(a.providerAccountId as string, a.userId as string);
    }
  }

  // Effective user for a row: its own user_id, else the one we resolved from
  // the Strava owner_id.
  const effectiveUid = (r: { user_id: string | null; properties: unknown }): string | null =>
    (r.user_id as string | null) ?? userIdByOwner.get(ownerOf(r) ?? '') ?? null;

  // Resolve user_id → display name so the tail shows people, not UUIDs.
  const recentUserIds = Array.from(new Set(
    (recentRows ?? [])
      .map(r => effectiveUid(r as { user_id: string | null; properties: unknown }))
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
    const uid = effectiveUid(r as { user_id: string | null; properties: unknown });
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
    dauDays,
    dauByUser,
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
