import { NextRequest, NextResponse } from 'next/server';

// Strava push-subscription webhook.
//
// Two responsibilities:
//
//   GET  — One-time subscription verification.
//          When we POST to /push_subscriptions, Strava immediately calls
//          this endpoint with hub.mode=subscribe & hub.verify_token & hub.challenge.
//          We must reply { "hub.challenge": "<the value>" } if the verify token
//          matches what we configured. The subscription only succeeds if this
//          reply is correct.
//
//   POST — Live event delivery (activity create / update / delete, athlete
//          deauthorization). Fires within seconds of a Strava event. Strava
//          retries with backoff if we don't 200 within ~2 s, so we MUST
//          respond fast and offload the actual sync work to a separate
//          Vercel function (/api/strava/sync-one) via fire-and-forget fetch.
//
//          Previously this dispatched a GitHub Actions workflow_dispatch,
//          which added 30-90 s of queue + boot lag. The new direct path
//          gets the activity into Supabase within ~5 s of the Strava
//          upload event. The 15-min cron is still there as a backstop in
//          case the webhook delivery itself fails.
//
// Env required (set on Vercel):
//   STRAVA_VERIFY_TOKEN     — random string shared with Strava at subscribe time
//   STRAVA_WEBHOOK_SECRET   — shared secret with /api/strava/sync-one
//   VERCEL_URL              — set by Vercel automatically (no trailing slash)

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// ── GET: Strava subscription handshake ─────────────────────────────────────
export async function GET(req: NextRequest) {
  const params    = req.nextUrl.searchParams;
  const mode      = params.get('hub.mode');
  const token     = params.get('hub.verify_token');
  const challenge = params.get('hub.challenge');

  const expected = process.env.STRAVA_VERIFY_TOKEN;
  if (!expected) {
    return NextResponse.json({ error: 'missing_server_config' }, { status: 500 });
  }

  if (mode === 'subscribe' && token && challenge && constantTimeEq(token, expected)) {
    // The exact response Strava expects — DO NOT change the key name, it
    // includes a dot per their spec.
    return NextResponse.json({ 'hub.challenge': challenge });
  }
  return NextResponse.json({ error: 'verification_failed' }, { status: 403 });
}

// ── POST: live event ───────────────────────────────────────────────────────
// Strava event payload:
//   {
//     "aspect_type": "create" | "update" | "delete",
//     "event_time":  1516126040,
//     "object_id":   1360128428,         // activity id (or athlete id for deauth)
//     "object_type": "activity" | "athlete",
//     "owner_id":    134815,             // athlete id
//     "subscription_id": 120475,
//     "updates":     {}
//   }
//
// We acknowledge immediately and trigger workflow_dispatch in the
// background. The sync script already deduplicates by activity id, so
// firing on every create/update is idempotent.
export async function POST(req: NextRequest) {
  let event: { object_type?: string; aspect_type?: string; object_id?: number; owner_id?: number };
  try {
    event = await req.json();
  } catch {
    return NextResponse.json({ ok: true }); // ack to avoid retries on garbage
  }

  // Only react to activity-level events (not athlete deauth, which we'd
  // handle separately if it ever became relevant).
  const isActivityEvent = event.object_type === 'activity'
    && (event.aspect_type === 'create' || event.aspect_type === 'update');

  if (isActivityEvent) {
    // Fire-and-forget: Strava only allows ~2 s before retrying. The
    // sync-one fetch is intentionally NOT awaited so this response goes
    // out fast. The downstream function still runs to completion on
    // Vercel because it's a separate function invocation.
    void dispatchSyncOne(event.owner_id ?? 0, event.object_id ?? 0, req).catch(err => {
      console.error('[strava-webhook] dispatch failed:', err);
    });
  }

  return NextResponse.json({ ok: true });
}

// ── Helpers ────────────────────────────────────────────────────────────────

function constantTimeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function dispatchSyncOne(ownerId: number, activityId: number, req: NextRequest): Promise<void> {
  const secret = process.env.STRAVA_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[strava-webhook] STRAVA_WEBHOOK_SECRET not set');
    return;
  }

  // Build an absolute URL to our own /api/strava/sync-one. On Vercel we
  // have VERCEL_URL ("my-app-abc.vercel.app", no scheme). Locally we
  // fall back to the incoming request's origin. Either way the next
  // fetch is a separate function invocation that survives this handler
  // returning.
  const host = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : req.nextUrl.origin;
  const url = `${host}/api/strava/sync-one`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      athleteId:  ownerId,
      activityId,
      secret,
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    console.error(`[strava-webhook] sync-one ${res.status}: ${txt.slice(0, 200)}`);
  }
}
