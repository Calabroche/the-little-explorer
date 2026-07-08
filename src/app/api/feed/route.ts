/**
 * GET /api/feed?source=following|mine
 *
 * The social feed. Unlike /api/activities (which runs the heavy per-user
 * power/FTP/TSS math keyed to the REQUESTER's body profile, and is scoped to
 * the requester's own rides), this returns lightweight feed cards for MANY
 * authors: author identity + core stats + a downsampled trace + like/comment
 * counts + the viewer's like state. No cross-user power math (that would
 * compute someone else's TSS with your mass).
 *
 *   source=following (default) — activities from people you follow + your own,
 *                                filtered by per-activity visibility.
 *   source=mine                — only your own activities (all visibilities).
 *
 * Auth required (session cookie or Bearer). Privacy model: see lib/social.ts.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/db';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { loadFollowing, loadSocialCounts, loadAuthors, type Visibility } from '@/lib/social';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const FEED_LIMIT = 200;      // rows pulled before visibility filtering
const TRACE_POINTS = 80;     // downsample the mini-map trace to keep cards light

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function downsample<T>(arr: T[], max: number): T[] {
  if (!Array.isArray(arr) || arr.length <= max) return Array.isArray(arr) ? arr : [];
  const step = Math.ceil(arr.length / max);
  return arr.filter((_, i) => i % step === 0);
}

export async function GET(req: NextRequest) {
  const authed = await getAuthedUser(req);
  if (!authed?.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const viewerId = authed.id;

  const limited = enforceRateLimit(req, RATE_LIMITS.authedRead, 'feed', { userId: viewerId });
  if (limited) return limited;

  const source = new URL(req.url).searchParams.get('source') === 'mine' ? 'mine' : 'following';

  // Author set: self always; "following" adds the people you follow.
  const following = source === 'following' ? await loadFollowing(viewerId) : new Set<string>();
  const authorIds = Array.from(new Set<string>([viewerId, ...Array.from(following)]));

  const { data, error } = await supabaseAdmin()
    .from('activities')
    .select('id, user_id, sport, title, start_date, duration_min, distance_km, elevation_m, visibility, payload')
    .in('user_id', authorIds)
    .order('start_date', { ascending: false })
    .limit(FEED_LIMIT);
  if (error) {
    console.error('[feed] supabase error:', error.message);
    return NextResponse.json({ error: 'db_error' }, { status: 500 });
  }

  // Visibility filter: own rides always; others hidden only when 'private'
  // (we already restricted to people the viewer follows, so 'followers' and
  // 'public' are both visible here).
  const rows = (data ?? []).filter(r =>
    r.user_id === viewerId || (r.visibility as Visibility) !== 'private',
  );

  const ids = rows.map(r => Number(r.id));
  const [counts, authors] = await Promise.all([
    loadSocialCounts(ids, viewerId),
    loadAuthors(rows.map(r => r.user_id as string)),
  ]);

  const items = rows.map(r => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p: any = r.payload ?? {};
    const c = counts.get(Number(r.id)) ?? { like_count: 0, comment_count: 0, liked_by_me: false };
    return {
      id:            Number(r.id),
      author:        authors.get(r.user_id as string) ?? { id: r.user_id, name: null, image: null },
      is_mine:       r.user_id === viewerId,
      sport:         r.sport,
      title:         r.title,
      date:          r.start_date,
      distance_km:   r.distance_km != null ? Number(r.distance_km) : (p.distance_km ?? null),
      elevation_m:   r.elevation_m ?? p.elevation_m ?? null,
      duration_min:  r.duration_min ?? p.duration_min ?? null,
      avg_speed_kmh: p.avg_speed_kmh ?? null,
      max_speed_kmh: p.max_speed_kmh ?? null,
      gps:           downsample(p.gps as [number, number][], TRACE_POINTS),
      visibility:    (r.visibility as Visibility) ?? 'followers',
      like_count:    c.like_count,
      comment_count: c.comment_count,
      liked_by_me:   c.liked_by_me,
    };
  });

  return NextResponse.json(items, {
    headers: {
      'Cache-Control':            'no-store, must-revalidate',
      'CDN-Cache-Control':        'no-store',
      'Vercel-CDN-Cache-Control': 'no-store',
    },
  });
}
