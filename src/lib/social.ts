/**
 * Social-layer helpers shared by the feed, profile, and share endpoints.
 *
 * Model (see supabase/schema.sql):
 *   * Follows are one-directional and auto-accepted — a single row in
 *     `public.follows` IS the relationship.
 *   * Privacy is PER ACTIVITY via `activities.visibility`:
 *       public    — anyone (incl. logged-out via the share link)
 *       followers — the author's followers + the author
 *       private   — the author only
 *   * The author always sees their own activities regardless of visibility.
 */

import { supabaseAdmin } from './db';

export type Visibility = 'public' | 'followers' | 'private';

export function isVisibility(v: unknown): v is Visibility {
  return v === 'public' || v === 'followers' || v === 'private';
}

/**
 * Can `viewerId` (null = logged out) see an activity authored by `authorId`
 * with the given visibility? `followingAuthors` is the set of author ids the
 * viewer follows (empty/irrelevant when logged out).
 */
export function canView(
  viewerId: string | null,
  authorId: string,
  visibility: Visibility,
  followingAuthors: Set<string>,
): boolean {
  if (viewerId && viewerId === authorId) return true; // own activity
  if (visibility === 'public') return true;
  if (visibility === 'private') return false;
  return !!viewerId && followingAuthors.has(authorId); // followers-only
}

/** The set of user ids `viewerId` follows. Empty set when logged out. */
export async function loadFollowing(viewerId: string | null): Promise<Set<string>> {
  if (!viewerId) return new Set();
  const { data, error } = await supabaseAdmin()
    .from('follows')
    .select('following_id')
    .eq('follower_id', viewerId);
  if (error) {
    console.warn('[social] loadFollowing failed:', error.message);
    return new Set();
  }
  return new Set((data ?? []).map(r => r.following_id as string));
}

export interface SocialCounts {
  like_count:    number;
  comment_count: number;
  liked_by_me:   boolean;
}

/**
 * Like + comment counts for a set of activity ids, plus whether `viewerId`
 * liked each. One query per table (JS aggregation) — fine at our scale, and
 * avoids N round-trips. Missing ids resolve to zeroed counts at the call site.
 */
export async function loadSocialCounts(
  activityIds: number[],
  viewerId: string | null,
): Promise<Map<number, SocialCounts>> {
  const out = new Map<number, SocialCounts>();
  if (activityIds.length === 0) return out;
  for (const id of activityIds) out.set(id, { like_count: 0, comment_count: 0, liked_by_me: false });

  const [likes, comments] = await Promise.all([
    supabaseAdmin().from('activity_likes').select('activity_id, user_id').in('activity_id', activityIds),
    supabaseAdmin().from('activity_comments').select('activity_id').in('activity_id', activityIds),
  ]);

  if (likes.error)    console.warn('[social] likes count failed:', likes.error.message);
  if (comments.error) console.warn('[social] comments count failed:', comments.error.message);

  for (const row of likes.data ?? []) {
    const id = Number(row.activity_id);
    const c = out.get(id); if (!c) continue;
    c.like_count += 1;
    if (viewerId && row.user_id === viewerId) c.liked_by_me = true;
  }
  for (const row of comments.data ?? []) {
    const id = Number(row.activity_id);
    const c = out.get(id); if (!c) continue;
    c.comment_count += 1;
  }
  return out;
}

/** Follower + following counts for a user (one head-count query each). */
export async function loadFollowCounts(userId: string): Promise<{ followers: number; following: number }> {
  const [followers, following] = await Promise.all([
    supabaseAdmin().from('follows').select('*', { count: 'exact', head: true }).eq('following_id', userId),
    supabaseAdmin().from('follows').select('*', { count: 'exact', head: true }).eq('follower_id', userId),
  ]);
  return { followers: followers.count ?? 0, following: following.count ?? 0 };
}

/**
 * Whether `viewerId` may see (and therefore like / comment on) a given
 * activity. Fetches the activity's author + visibility, then applies the
 * privacy rules. Returns the author id so callers can attribute / notify.
 * `{ ok: false }` for missing activities or insufficient access.
 */
export async function viewerCanSeeActivity(
  viewerId: string,
  activityId: number,
): Promise<{ ok: boolean; authorId?: string; visibility?: Visibility }> {
  const { data, error } = await supabaseAdmin()
    .from('activities')
    .select('user_id, visibility')
    .eq('id', activityId)
    .maybeSingle();
  if (error || !data) return { ok: false };
  const authorId = data.user_id as string;
  const visibility = (data.visibility as Visibility) ?? 'followers';
  if (authorId === viewerId) return { ok: true, authorId, visibility };
  if (visibility === 'public') return { ok: true, authorId, visibility };
  if (visibility === 'private') return { ok: false, authorId, visibility };
  // followers-only: does the viewer follow the author?
  const { data: rel } = await supabaseAdmin()
    .from('follows')
    .select('follower_id')
    .eq('follower_id', viewerId)
    .eq('following_id', authorId)
    .maybeSingle();
  return { ok: !!rel, authorId, visibility };
}

/** Minimal public author identity for feed cards / comment rows. */
export interface Author {
  id:    string;
  name:  string | null;
  image: string | null;
}

/**
 * Collapse Strava/HealthKit duplicates: the SAME ride can land from both
 * sources (an Apple Watch ride syncs to Strava AND to Apple Health). Two rows
 * from the same author are the same ride when they start within ~3 min and
 * their distance matches within ~1 km / 6 %. Keep the LOWER id — Strava ids are
 * ~1e10, HealthKit ids are minted > 4e15, so the lower id is the Strava row
 * (richer: power, gear). Mirrors the dedup in /api/activities.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function dedupActivities<T extends { id: any; user_id: string; start_date: string; distance_km: any }>(rows: T[]): T[] {
  const kept: T[] = [];
  for (const r of rows) {
    const rStart = Date.parse(r.start_date);
    const rKm = Number(r.distance_km) || 0;
    const twin = kept.findIndex(k =>
      k.user_id === r.user_id &&
      Math.abs(Date.parse(k.start_date) - rStart) <= 3 * 60 * 1000 &&
      Math.abs((Number(k.distance_km) || 0) - rKm) <= Math.max(1, rKm * 0.06),
    );
    if (twin === -1) { kept.push(r); continue; }
    if (Number(r.id) < Number(kept[twin].id)) kept[twin] = r; // prefer Strava (lower id)
  }
  return kept;
}

/** Resolve author identity for a set of user ids in one query. */
export async function loadAuthors(userIds: string[]): Promise<Map<string, Author>> {
  const out = new Map<string, Author>();
  const unique = Array.from(new Set(userIds));
  if (unique.length === 0) return out;
  const { data, error } = await supabaseAdmin()
    .schema('next_auth')
    .from('users')
    .select('id, name, image')
    .in('id', unique);
  if (error) {
    console.warn('[social] loadAuthors failed:', error.message);
    return out;
  }
  for (const u of data ?? []) {
    out.set(u.id as string, { id: u.id as string, name: (u.name ?? null) as string | null, image: (u.image ?? null) as string | null });
  }
  return out;
}
