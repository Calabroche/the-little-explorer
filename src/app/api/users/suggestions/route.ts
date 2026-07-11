/**
 * GET /api/users/suggestions
 *
 * People to follow for the discovery / empty-feed experience. Returns TLE
 * users the viewer does NOT already follow (and not themselves), ranked by
 * follower count so the most-followed explorers surface first. Same shape as
 * /api/users/search ({id, name, image, is_following}). Auth required.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/db';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { loadFollowing, safeAvatar } from '@/lib/social';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const SUGGEST_LIMIT = 12;

export async function GET(req: NextRequest) {
  const authed = await getAuthedUser(req);
  if (!authed?.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const limited = enforceRateLimit(req, RATE_LIMITS.authedRead, 'user-suggestions', { userId: authed.id });
  if (limited) return limited;

  const db = supabaseAdmin();

  // Candidate users (cap generously; we filter + rank in memory).
  const { data: users, error } = await db
    .schema('next_auth')
    .from('users')
    .select('id, name, image')
    .not('id', 'eq', authed.id)
    .limit(200);
  if (error) {
    console.error('[user-suggestions] query failed:', error.message);
    return NextResponse.json({ error: 'db_error' }, { status: 500 });
  }

  const following = await loadFollowing(authed.id);

  // Follower tallies for ranking (single scan of the follow graph).
  const { data: follows } = await db.from('follows').select('following_id');
  const followerCount = new Map<string, number>();
  for (const f of follows ?? []) {
    const id = f.following_id as string;
    followerCount.set(id, (followerCount.get(id) ?? 0) + 1);
  }

  const suggestions = (users ?? [])
    .filter(u => !following.has(u.id as string))
    .map(u => ({
      id:           u.id as string,
      name:         (u.name ?? null) as string | null,
      image:        safeAvatar(u.image),
      is_following: false,
      _rank:        followerCount.get(u.id as string) ?? 0,
    }))
    .sort((a, b) => b._rank - a._rank)
    .slice(0, SUGGEST_LIMIT)
    .map(({ _rank, ...rest }) => rest);

  return NextResponse.json(suggestions, { headers: { 'Cache-Control': 'no-store' } });
}
