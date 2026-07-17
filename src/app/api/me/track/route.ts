/**
 * POST /api/me/track — client-side event beacon.
 *
 * Body: { event: EventType, props?: Record<string, unknown> }
 *
 * Used for the "engagement" event family — home_view, manual_resync,
 * activity_view, etc. — that the lifecycle hooks in lib/auth.ts and
 * the Strava routes don't catch.
 *
 * Debounced server-side to **once-per-user-per-hour** per event type
 * so a rider refreshing the home page 30 times in a row doesn't
 * spam the events table. The check is a SELECT on the most-recent
 * matching row; with the events_user_time_idx index it's a single
 * b-tree lookup, ~1 ms.
 *
 * Closed event-type allowlist — anything not in the allow set
 * returns 400. Keeps a misbehaving client from polluting our
 * funnel analytics with arbitrary tags.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/db';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { logEvent, EventType } from '@/lib/events';

const ALLOWED: Set<EventType> = new Set<EventType>(['home_view', 'manual_resync', 'activity_view']);

// Debounce window per (user, event_type). 1 h is a sweet spot: long
// enough that the events table doesn't bloat from page-refresh spam,
// short enough that genuine return-to-app sessions register.
const DEBOUNCE_MS = 60 * 60 * 1000;

export async function POST(req: NextRequest) {
  const authed = await getAuthedUser(req);
  if (!authed?.id) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  // A beacon fires often, so use the read budget rather than the write one —
  // but it still writes rows, so it must be bounded.
  const limited = enforceRateLimit(req, RATE_LIMITS.authedRead, 'me-track', { userId: authed.id });
  if (limited) return limited;

  let body: { event?: string; props?: Record<string, unknown> };
  try {
    body = await req.json() as { event?: string; props?: Record<string, unknown> };
  } catch {
    return NextResponse.json({ error: 'bad_json' }, { status: 400 });
  }
  const ev = body.event as EventType | undefined;
  if (!ev || !ALLOWED.has(ev)) {
    return NextResponse.json({ error: 'event_not_allowed' }, { status: 400 });
  }

  // Debounce on (user_id, event_type). One b-tree lookup via the
  // existing events_user_time_idx index.
  const since = new Date(Date.now() - DEBOUNCE_MS).toISOString();
  const { data: recent } = await supabaseAdmin()
    .schema('next_auth')
    .from('events')
    .select('id')
    .eq('user_id', authed.id)
    .eq('event_type', ev)
    .gte('occurred_at', since)
    .limit(1)
    .maybeSingle();
  if (recent) {
    // Already logged inside the debounce window — silently
    // succeed so the client doesn't think it broke.
    return NextResponse.json({ ok: true, debounced: true });
  }

  await logEvent({
    type:       ev,
    userId:     authed.id,
    properties: body.props ?? {},
  }, req);

  return NextResponse.json({ ok: true });
}
