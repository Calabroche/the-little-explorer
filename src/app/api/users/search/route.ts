/**
 * GET /api/users/search?q=<name>
 *
 * Find users to follow, by display name (case-insensitive substring). Returns
 * {id, name, image, is_following} so the discovery UI can show a follow button
 * inline. Excludes the viewer themselves. Auth required.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/db';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { loadFollowing, safeAvatar } from '@/lib/social';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const SEARCH_LIMIT = 20;

export async function GET(req: NextRequest) {
  const authed = await getAuthedUser(req);
  if (!authed?.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const limited = enforceRateLimit(req, RATE_LIMITS.authedRead, 'user-search', { userId: authed.id });
  if (limited) return limited;

  const q = (new URL(req.url).searchParams.get('q') ?? '').trim();
  if (q.length < 2) return NextResponse.json([], { headers: { 'Cache-Control': 'no-store' } });

  // Escape PostgREST ilike wildcards so a user can't inject % / _ patterns.
  const safe = q.replace(/[%_,]/g, ' ');
  const { data, error } = await supabaseAdmin()
    .schema('next_auth')
    .from('users')
    .select('id, name, image')
    .ilike('name', `%${safe}%`)
    .not('id', 'eq', authed.id)
    .limit(SEARCH_LIMIT);
  if (error) {
    console.error('[user-search] query failed:', error.message);
    return NextResponse.json({ error: 'db_error' }, { status: 500 });
  }

  const following = await loadFollowing(authed.id);
  const users = (data ?? []).map(u => ({
    id:           u.id as string,
    name:         (u.name ?? null) as string | null,
    image:        safeAvatar(u.image),
    is_following: following.has(u.id as string),
  }));
  return NextResponse.json(users, { headers: { 'Cache-Control': 'no-store' } });
}
