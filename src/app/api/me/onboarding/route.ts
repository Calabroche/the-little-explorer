/**
 * /api/me/onboarding — onboarding-state mutations.
 *
 * Two operations:
 *
 *   POST /api/me/onboarding/event   (this file, dispatched on `step` body field)
 *     Logs one of the onboarding funnel events. Client calls this at each
 *     step transition so the /admin/metrics dashboard can compute drop-off.
 *     Returns 204.
 *
 *   POST /api/me/onboarding/complete
 *     Stamps next_auth.users.onboarded_at = now() and logs the final
 *     `onboarding_complete` event. Middleware stops redirecting the user
 *     to /onboarding after this. Returns 204.
 *
 * We handle both with the same handler dispatched on the `op` body field
 * because they share auth + audit logic and adding two folders for
 * 5-line endpoints is overkill.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/db';
import { getAuthedUser } from '@/lib/api-auth';
import { logEvent, EventType } from '@/lib/events';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface Body {
  op:     'event' | 'complete';
  /** Required when op === 'event'. */
  event?: EventType;
  /** Free-form props (e.g. selected sport). */
  props?: Record<string, unknown>;
}

export async function POST(req: NextRequest) {
  const authed = await getAuthedUser(req);
  if (!authed?.id) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  // Onboarding fires ~5 events per user, ever. Anything beyond
  // `authedWrite` is abuse / a misbehaving client.
  const limited = enforceRateLimit(req, RATE_LIMITS.authedWrite, 'me-onboarding', { userId: authed.id });
  if (limited) return limited;

  let body: Body;
  try {
    body = await req.json() as Body;
  } catch {
    return NextResponse.json({ error: 'bad_json' }, { status: 400 });
  }

  if (body.op === 'event') {
    if (!body.event || !body.event.startsWith('onboarding_')) {
      return NextResponse.json({ error: 'invalid_event' }, { status: 400 });
    }
    void logEvent({ type: body.event, userId: authed.id, properties: body.props ?? {} }, req);
    return new NextResponse(null, { status: 204 });
  }

  if (body.op === 'complete') {
    const { error: upErr } = await supabaseAdmin()
      .schema('next_auth')
      .from('users')
      .update({ onboarded_at: new Date().toISOString() })
      .eq('id', authed.id);
    if (upErr) {
      console.error('[me.onboarding] complete failed:', upErr.message);
      return NextResponse.json({ error: 'db_error', detail: upErr.message }, { status: 500 });
    }
    void logEvent({ type: 'onboarding_complete', userId: authed.id, properties: body.props ?? {} }, req);
    return new NextResponse(null, { status: 204 });
  }

  return NextResponse.json({ error: 'unknown_op' }, { status: 400 });
}
