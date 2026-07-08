/**
 * POST   /api/users/<id>/follow  — follow a user (auto-accepted)
 * DELETE /api/users/<id>/follow  — unfollow
 *
 * One-directional, auto-accepted (see lib/social.ts). Privacy is per-activity,
 * so following is always allowed. Idempotent via the (follower, following) PK.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/db';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { logEvent } from '@/lib/events';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const authed = await getAuthedUser(req);
  if (!authed?.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const limited = enforceRateLimit(req, RATE_LIMITS.authedWrite, 'follow', { userId: authed.id });
  if (limited) return limited;

  const targetId = params.id;
  if (!targetId) return NextResponse.json({ error: 'invalid_id' }, { status: 400 });
  if (targetId === authed.id) return NextResponse.json({ error: 'cannot_follow_self' }, { status: 400 });

  // Target must exist (FK would fail anyway, but a clean 404 is friendlier).
  const { data: target } = await supabaseAdmin()
    .schema('next_auth').from('users').select('id').eq('id', targetId).maybeSingle();
  if (!target) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const { error } = await supabaseAdmin()
    .from('follows')
    .upsert({ follower_id: authed.id, following_id: targetId }, { onConflict: 'follower_id,following_id' });
  if (error) {
    console.error('[follow] insert failed:', error.message);
    return NextResponse.json({ error: 'db_error' }, { status: 500 });
  }

  void logEvent({ type: 'user_followed', userId: authed.id, properties: { following_id: targetId } }, req);
  return NextResponse.json({ ok: true, following: true });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const authed = await getAuthedUser(req);
  if (!authed?.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const limited = enforceRateLimit(req, RATE_LIMITS.authedWrite, 'follow', { userId: authed.id });
  if (limited) return limited;

  const targetId = params.id;
  if (!targetId) return NextResponse.json({ error: 'invalid_id' }, { status: 400 });

  const { error } = await supabaseAdmin()
    .from('follows')
    .delete()
    .eq('follower_id', authed.id)
    .eq('following_id', targetId);
  if (error) {
    console.error('[follow] delete failed:', error.message);
    return NextResponse.json({ error: 'db_error' }, { status: 500 });
  }
  return NextResponse.json({ ok: true, following: false });
}
