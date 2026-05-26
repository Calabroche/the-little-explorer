/**
 * POST /api/me/disconnect-strava — user-initiated Strava unlink.
 *
 * Same effect as Strava's athlete_deauthorization webhook, but the
 * trigger is the user clicking "Déconnecter Strava" in their own
 * settings (web or iOS) instead of revoking from strava.com/settings.
 *
 * Steps:
 *   1. Best-effort revoke the Strava OAuth token via /oauth/deauthorize
 *      so Strava drops us from their authorized-apps list too. Non-fatal
 *      on failure — we still wipe locally either way.
 *   2. Delete the next_auth.accounts row for provider='strava'. This
 *      removes the refresh_token and tells NextAuth the link no longer
 *      exists.
 *   3. Null out athlete_id + strava_scope on the user row. The cron
 *      backstop in /api/strava/sync skips users with athlete_id = null,
 *      so future runs won't try to refresh a dead token.
 *
 * Activities already synced are preserved — the user keeps their
 * history. If they want a clean wipe, they use DELETE /api/me.
 *
 * Returns the updated profile so the client can re-render without a
 * second roundtrip. The client should refresh useSession() (or pop
 * back to /api/me) since session.user.athleteId will now be null.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/db';
import { getAuthedUser } from '@/lib/api-auth';
import { logEvent } from '@/lib/events';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const authed = await getAuthedUser(req);
  if (!authed?.id) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // 1. Pull the current access_token (if any) for the deauthorize call.
  const { data: account } = await supabaseAdmin()
    .schema('next_auth')
    .from('accounts')
    .select('access_token')
    .eq('userId', authed.id)
    .eq('provider', 'strava')
    .maybeSingle();

  if (account?.access_token) {
    try {
      await fetch('https://www.strava.com/oauth/deauthorize', {
        method:  'POST',
        headers: {
          'Content-Type':  'application/x-www-form-urlencoded',
          Authorization:   `Bearer ${account.access_token}`,
        },
      });
    } catch (err) {
      console.error('[me.disconnect-strava] strava deauthorize failed (non-fatal):', err);
    }
  }

  // 2. Drop the strava account row.
  const { error: accErr } = await supabaseAdmin()
    .schema('next_auth')
    .from('accounts')
    .delete()
    .eq('userId', authed.id)
    .eq('provider', 'strava');
  if (accErr) {
    console.error('[me.disconnect-strava] account delete failed:', accErr.message);
    return NextResponse.json({ error: 'db_error', detail: accErr.message }, { status: 500 });
  }

  // 3. Null the user's athlete link.
  const { error: usrErr } = await supabaseAdmin()
    .schema('next_auth')
    .from('users')
    .update({ athlete_id: null, strava_scope: null })
    .eq('id', authed.id);
  if (usrErr) {
    console.error('[me.disconnect-strava] user update failed:', usrErr.message);
    return NextResponse.json({ error: 'db_error', detail: usrErr.message }, { status: 500 });
  }

  console.log(`[me.disconnect-strava] disconnected Strava for user ${authed.id}`);
  void logEvent({ type: 'disconnect_strava', userId: authed.id }, req);
  return NextResponse.json({ ok: true });
}
