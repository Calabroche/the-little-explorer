/**
 * GET /api/users/<id> — public profile.
 *
 * Returns identity (name, image, bio), follower/following counts, whether the
 * viewer follows this user, and the user's activities the viewer is allowed to
 * see. Works logged-out (only 'public' activities are then visible), so it can
 * back a public profile page. Under /api, so excluded from the auth middleware.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/db';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { loadFollowCounts, loadSocialCounts, canView, dedupActivities, type Visibility } from '@/lib/social';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const PROFILE_ACTIVITY_LIMIT = 60;
const TRACE_POINTS = 80;

function downsample<T>(arr: T[], max: number): T[] {
  if (!Array.isArray(arr) || arr.length <= max) return Array.isArray(arr) ? arr : [];
  const step = Math.ceil(arr.length / max);
  return arr.filter((_, i) => i % step === 0);
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const authed = await getAuthedUser(req);
  const viewerId = authed?.id ?? null;

  const limited = enforceRateLimit(req, RATE_LIMITS.authedRead, 'profile', { userId: viewerId ?? undefined });
  if (limited) return limited;

  const targetId = params.id;
  if (!targetId) return NextResponse.json({ error: 'invalid_id' }, { status: 400 });

  const { data: user, error: uErr } = await supabaseAdmin()
    .schema('next_auth')
    .from('users')
    .select('id, name, image, bio')
    .eq('id', targetId)
    .maybeSingle();
  if (uErr) { console.error('[profile] user lookup failed:', uErr.message); return NextResponse.json({ error: 'db_error' }, { status: 500 }); }
  if (!user) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // Does the viewer follow this user? (drives followers-only visibility)
  let isFollowing = false;
  if (viewerId && viewerId !== targetId) {
    const { data: rel } = await supabaseAdmin()
      .from('follows').select('follower_id')
      .eq('follower_id', viewerId).eq('following_id', targetId).maybeSingle();
    isFollowing = !!rel;
  }
  const following = new Set<string>(isFollowing ? [targetId] : []);

  const counts = await loadFollowCounts(targetId);

  // Light select — jsonb sub-fields only, never the full streams-heavy payload
  // (see /api/feed for why: it timed the request out).
  const { data: acts, error: aErr } = await supabaseAdmin()
    .from('activities')
    .select('id, user_id, sport, title, start_date, duration_min, distance_km, elevation_m, visibility, gps:payload->gps, avgspeed:payload->avg_speed_kmh, maxspeed:payload->max_speed_kmh')
    .eq('user_id', targetId)
    .order('start_date', { ascending: false })
    .limit(PROFILE_ACTIVITY_LIMIT);
  if (aErr) { console.error('[profile] activities failed:', aErr.message); return NextResponse.json({ error: 'db_error' }, { status: 500 }); }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const visible = dedupActivities(((acts ?? []) as any[]).filter(a =>
    canView(viewerId, targetId, (a.visibility as Visibility) ?? 'followers', following),
  ));

  const social = await loadSocialCounts(visible.map(a => Number(a.id)), viewerId);
  const activities = visible.map(a => {
    const c = social.get(Number(a.id)) ?? { like_count: 0, comment_count: 0, liked_by_me: false };
    return {
      id:            Number(a.id),
      author:        { id: user.id, name: user.name ?? null, image: user.image ?? null },
      is_mine:       viewerId === targetId,
      sport:         a.sport,
      title:         a.title,
      date:          a.start_date,
      distance_km:   a.distance_km != null ? Number(a.distance_km) : null,
      elevation_m:   a.elevation_m ?? null,
      duration_min:  a.duration_min ?? null,
      avg_speed_kmh: a.avgspeed != null ? Number(a.avgspeed) : null,
      max_speed_kmh: a.maxspeed != null ? Number(a.maxspeed) : null,
      gps:           downsample((a.gps as [number, number][]) ?? [], TRACE_POINTS),
      visibility:    (a.visibility as Visibility) ?? 'followers',
      like_count:    c.like_count,
      comment_count: c.comment_count,
      liked_by_me:   c.liked_by_me,
    };
  });

  return NextResponse.json({
    id:            user.id,
    name:          user.name ?? null,
    image:         user.image ?? null,
    bio:           user.bio ?? null,
    is_me:         viewerId === targetId,
    is_following:  isFollowing,
    followers:     counts.followers,
    following:     counts.following,
    activities,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
