/**
 * POST /api/me/logout-all — log the current user out of every device.
 *
 * Two layers to invalidate:
 *
 *   1. Web cookies (NextAuth JWT). JWTs are self-contained, so we can't
 *      "delete" a session row. Instead we bump
 *      `next_auth.users.session_invalidated_at = now()`; the JWT
 *      callback in `lib/auth.ts` compares each token's `iat` against
 *      this column and rejects sessions issued before the cutoff.
 *
 *   2. iOS / watchOS bearer tokens. These DO have a row per token in
 *      `next_auth.api_tokens`, so we just stamp them all with
 *      `revoked_at = now()`. `getAuthedUser` already filters revoked
 *      tokens out of the bearer lookup, so the next request from any
 *      device returns 401.
 *
 * Returns 204 on success. The client should immediately call
 * NextAuth's `signOut()` to clear its own cookie locally (otherwise
 * the user sees a stale UI until the next request 401s).
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/db';
import { getAuthedUser } from '@/lib/api-auth';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { logEvent } from '@/lib/events';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const authed = await getAuthedUser(req);
  if (!authed?.id) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const limited = enforceRateLimit(req, RATE_LIMITS.authedWrite, 'logout-all', { userId: authed.id });
  if (limited) return limited;

  const now = new Date().toISOString();

  // 1. Bump session_invalidated_at on the user row.
  const { error: usrErr } = await supabaseAdmin()
    .schema('next_auth')
    .from('users')
    .update({ session_invalidated_at: now })
    .eq('id', authed.id);
  if (usrErr) {
    console.error('[me.logout-all] user update failed:', usrErr.message);
    return NextResponse.json({ error: 'db_error', detail: usrErr.message }, { status: 500 });
  }

  // 2. Revoke every active bearer token.
  const { error: tokErr } = await supabaseAdmin()
    .schema('next_auth')
    .from('api_tokens')
    .update({ revoked_at: now })
    .eq('user_id', authed.id)
    .is('revoked_at', null);
  if (tokErr) {
    // Don't fail the request — step 1 is the primary effect and it
    // already succeeded. Log and continue.
    console.error('[me.logout-all] token revoke failed (non-fatal):', tokErr.message);
  }

  console.log(`[me.logout-all] invalidated all sessions for user ${authed.id}`);
  void logEvent({ type: 'logout_all', userId: authed.id }, req);
  return new NextResponse(null, { status: 204 });
}
