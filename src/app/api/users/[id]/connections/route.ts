/**
 * GET /api/users/<id>/connections?type=followers|following
 *
 * The user's followers (people who follow them) or following (people they
 * follow), as a list of {id, name, image, is_following} where is_following is
 * relative to the VIEWER — so the UI can show a follow/unfollow button inline.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/db';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { loadAuthors, loadFollowing } from '@/lib/social';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const authed = await getAuthedUser(req);
  const viewerId = authed?.id ?? null;
  const limited = enforceRateLimit(req, RATE_LIMITS.authedRead, 'connections', { userId: viewerId ?? undefined });
  if (limited) return limited;

  const targetId = params.id;
  if (!targetId) return NextResponse.json({ error: 'invalid_id' }, { status: 400 });
  const type = new URL(req.url).searchParams.get('type') === 'following' ? 'following' : 'followers';

  // followers: rows where following_id = target → collect follower_id
  // following: rows where follower_id  = target → collect following_id
  const col     = type === 'followers' ? 'following_id' : 'follower_id';
  const pickCol = type === 'followers' ? 'follower_id'  : 'following_id';

  const { data, error } = await supabaseAdmin()
    .from('follows')
    .select(`${pickCol}`)
    .eq(col, targetId)
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) {
    console.error('[connections] query failed:', error.message);
    return NextResponse.json({ error: 'db_error' }, { status: 500 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ids = (data ?? []).map((r: any) => r[pickCol] as string);
  const [authors, viewerFollows] = await Promise.all([
    loadAuthors(ids),
    loadFollowing(viewerId),
  ]);

  const users = ids.map(uid => {
    const a = authors.get(uid) ?? { id: uid, name: null, image: null };
    return { ...a, is_following: viewerFollows.has(uid), is_me: uid === viewerId };
  });
  return NextResponse.json(users, { headers: { 'Cache-Control': 'no-store' } });
}
