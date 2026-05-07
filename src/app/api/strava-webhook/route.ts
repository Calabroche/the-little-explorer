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
//          respond fast and offload the actual sync work to GitHub Actions
//          via workflow_dispatch (fire-and-forget).
//
// Env required (set on Vercel):
//   STRAVA_VERIFY_TOKEN   — random string we share with Strava at subscribe time
//   GITHUB_PAT_DISPATCH   — GitHub token with `actions:write` on this repo
//   GITHUB_REPO           — defaults to "Calabroche/the-little-explorer"

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const REPO = process.env.GITHUB_REPO || 'Calabroche/the-little-explorer';

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
    // Fire-and-forget: Strava only allows ~2 s before retrying. The await
    // chain is intentionally NOT awaited so the response goes out fast.
    // Errors are logged but never break the ack.
    void dispatchSyncWorkflow(event.owner_id ?? 0).catch(err => {
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

async function dispatchSyncWorkflow(ownerId: number): Promise<void> {
  const pat = process.env.GITHUB_PAT_DISPATCH;
  if (!pat) {
    console.error('[strava-webhook] GITHUB_PAT_DISPATCH not set');
    return;
  }
  const url = `https://api.github.com/repos/${REPO}/actions/workflows/strava-sync.yml/dispatches`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${pat}`,
      'Accept':        'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      ref: 'master',
      // Pass the triggering Strava athlete id as a workflow input so the
      // run can later be filtered by user. (Currently the workflow runs
      // the full matrix, but the input is harmless and useful for logs.)
      inputs: { strava_owner_id: String(ownerId) },
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    console.error(`[strava-webhook] github ${res.status}: ${txt.slice(0, 200)}`);
  }
}
