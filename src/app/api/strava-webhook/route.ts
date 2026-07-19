import { NextRequest, NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { supabaseAdmin } from '@/lib/db';
import { logEvent } from '@/lib/events';

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
// The 200 to Strava is returned immediately; the sync runs in waitUntil, so we
// need headroom for the sync-one round-trip (token refresh + activity + streams).
export const maxDuration = 60;

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
  let event: {
    object_type?: string;
    aspect_type?: string;
    object_id?:   number;
    owner_id?:    number;
    updates?:     Record<string, string | number | boolean>;
  };
  try {
    event = await req.json();
  } catch {
    return NextResponse.json({ ok: true }); // ack to avoid retries on garbage
  }

  // Dispatch by event type. All branches fire-and-forget — Strava
  // retries if we don't 200 within ~2s, so the handler must return
  // fast and offload the actual work.
  const isActivityCreateOrUpdate = event.object_type === 'activity'
    && (event.aspect_type === 'create' || event.aspect_type === 'update');

  const isActivityDelete = event.object_type === 'activity'
    && event.aspect_type === 'delete';

  // Strava sends athlete_deauthorization as:
  //   { object_type: 'athlete', aspect_type: 'update',
  //     updates: { authorized: 'false' }, owner_id: <athlete_id>, … }
  const isAthleteDeauth = event.object_type === 'athlete'
    && event.aspect_type === 'update'
    && String(event.updates?.authorized) === 'false';

  // Event log — every webhook delivery, regardless of outcome. The
  // dashboard cross-references this with `strava_webhook_synced` to
  // compute the sync success rate.
  void logEvent({
    type: 'strava_webhook_received',
    userId: null, // we'd need to resolve owner_id → user_id to fill this
    properties: {
      object_type: event.object_type ?? null,
      aspect_type: event.aspect_type ?? null,
      owner_id:    event.owner_id    ?? null,
    },
  }, req);

  // waitUntil keeps the Vercel function alive until the background work settles,
  // even after we return the 200 below. Without it the fire-and-forget fetch was
  // killed on freeze — the webhook received events but NOTHING ever synced
  // (strava_webhook_synced was 0). This is why a followed rider's new activity
  // never appeared until they manually re-synced.
  if (isActivityCreateOrUpdate) {
    waitUntil(dispatchSyncOne(event.owner_id ?? 0, event.object_id ?? 0, req).catch(err => {
      console.error('[strava-webhook] dispatch failed:', err);
    }));
  } else if (isActivityDelete) {
    // User deleted an activity on Strava → remove it from our store too.
    // Required by the Strava API Agreement (ToS section 2.B.iv:
    // "promptly remove" deleted activities).
    waitUntil(purgeActivity(event.object_id ?? 0).catch(err => {
      console.error('[strava-webhook] purge activity failed:', err);
    }));
  } else if (isAthleteDeauth) {
    // User revoked our app from Strava → drop their refresh_token so
    // we stop trying to sync. Local data is preserved — they can come
    // back. The full account wipe is handled separately via
    // DELETE /api/me when the user asks for that.
    waitUntil(deauthorizeAthlete(event.owner_id ?? 0).catch(err => {
      console.error('[strava-webhook] deauth failed:', err);
    }));
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

/**
 * Strava told us the user deleted an activity → remove it from
 * public.activities so the feed stops showing it. Idempotent: a row
 * that doesn't exist (already deleted, or never synced) is a no-op.
 */
async function purgeActivity(activityId: number): Promise<void> {
  if (!activityId) return;
  const { error } = await supabaseAdmin()
    .from('activities')
    .delete()
    .eq('id', activityId);
  if (error) {
    console.error(`[strava-webhook] purge activity ${activityId} failed:`, error.message);
  } else {
    console.log(`[strava-webhook] purged activity ${activityId}`);
  }
}

/**
 * Strava told us the user revoked our app from their Strava settings
 * → null out their athlete linkage so the cron + future webhooks stop
 * trying to refresh a dead token. We keep the user row and their
 * already-synced activities — they may want to come back, and we
 * don't want to silently nuke their history from under them.
 *
 * Full account wipe is handled separately by DELETE /api/me when the
 * user explicitly asks for it.
 */
async function deauthorizeAthlete(athleteId: number): Promise<void> {
  if (!athleteId) return;
  // 1. Drop the Strava account row from next_auth.accounts so we no
  //    longer have a refresh_token to try.
  const { data: user } = await supabaseAdmin()
    .schema('next_auth')
    .from('users')
    .select('id')
    .eq('athlete_id', athleteId)
    .maybeSingle();

  if (!user?.id) {
    console.log(`[strava-webhook] deauth for unknown athlete ${athleteId} — nothing to do`);
    return;
  }

  const { error: accErr } = await supabaseAdmin()
    .schema('next_auth')
    .from('accounts')
    .delete()
    .eq('userId', user.id)
    .eq('provider', 'strava');
  if (accErr) {
    console.error(`[strava-webhook] deauth: drop accounts row failed for user ${user.id}:`, accErr.message);
  }

  // 2. Null out the athlete_id + scope on the user row so the cron
  //    skips them on its next pass.
  const { error: usrErr } = await supabaseAdmin()
    .schema('next_auth')
    .from('users')
    .update({ athlete_id: null, strava_scope: null })
    .eq('id', user.id);
  if (usrErr) {
    console.error(`[strava-webhook] deauth: clear athlete_id failed for user ${user.id}:`, usrErr.message);
  } else {
    console.log(`[strava-webhook] deauthorized user ${user.id} (athlete ${athleteId})`);
  }
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
