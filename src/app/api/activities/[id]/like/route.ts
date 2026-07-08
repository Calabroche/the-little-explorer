/**
 * POST   /api/activities/<id>/like   — like (kudos) an activity
 * DELETE /api/activities/<id>/like   — remove your like
 *
 * You can only like an activity you're allowed to see (own / public /
 * followers-with-a-follow). Idempotent: the (activity_id, user_id) PK makes a
 * double-like a no-op upsert.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/db';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { viewerCanSeeActivity } from '@/lib/social';
import { logEvent } from '@/lib/events';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const authed = await getAuthedUser(req);
  if (!authed?.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const limited = enforceRateLimit(req, RATE_LIMITS.authedWrite, 'like', { userId: authed.id });
  if (limited) return limited;

  const id = Number(params.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'invalid_id' }, { status: 400 });

  const access = await viewerCanSeeActivity(authed.id, id);
  if (!access.ok) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const { error } = await supabaseAdmin()
    .from('activity_likes')
    .upsert({ activity_id: id, user_id: authed.id }, { onConflict: 'activity_id,user_id' });
  if (error) {
    console.error('[like] insert failed:', error.message);
    return NextResponse.json({ error: 'db_error' }, { status: 500 });
  }

  void logEvent({ type: 'activity_liked', userId: authed.id, properties: { activity_id: id, author_id: access.authorId } }, req);
  return NextResponse.json({ ok: true, liked: true });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const authed = await getAuthedUser(req);
  if (!authed?.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const limited = enforceRateLimit(req, RATE_LIMITS.authedWrite, 'like', { userId: authed.id });
  if (limited) return limited;

  const id = Number(params.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'invalid_id' }, { status: 400 });

  const { error } = await supabaseAdmin()
    .from('activity_likes')
    .delete()
    .eq('activity_id', id)
    .eq('user_id', authed.id);
  if (error) {
    console.error('[like] delete failed:', error.message);
    return NextResponse.json({ error: 'db_error' }, { status: 500 });
  }
  return NextResponse.json({ ok: true, liked: false });
}
