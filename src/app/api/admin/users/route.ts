/**
 * GET /api/admin/users — list every TLE account with summary stats.
 *
 * Restricted to the email allowlist in src/lib/admin.ts. Anyone else
 * (including signed-in non-admin users) gets 403. Middleware already
 * keeps unauthenticated traffic out, so the session check + email
 * check here just plug the "regular user pokes the URL" hole.
 *
 * Per-user stats: name, email, image, athlete_id (Strava connected
 * status), created_at, activity count. We don't track last_seen in
 * the DB — NextAuth's database session would have stored that but
 * we switched to JWT sessions for edge compatibility. If we ever
 * want it back, add a `last_seen_at` column on next_auth.users and
 * touch it from a middleware or auth callback.
 */

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { buildAuthOptions } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/db';
import { isAdminEmail } from '@/lib/admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface UserRow {
  id:         string;
  email:      string | null;
  name:       string | null;
  image:      string | null;
  athlete_id: number | null;
  created_at: string;
}

export async function GET() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const session: any = await getServerSession(buildAuthOptions());
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!isAdminEmail(session.user.email)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // Pull every user row from the next_auth schema. With a 5-10 user
  // family-and-friends scope this is fine to fetch in one go; if it
  // ever needs paging we'd switch to range() here.
  const { data: users, error: usersErr } = await supabaseAdmin()
    .schema('next_auth')
    .from('users')
    .select('id, email, name, image, athlete_id, created_at')
    .order('created_at', { ascending: false });

  if (usersErr) {
    console.error('[admin/users] users query failed:', usersErr.message);
    return NextResponse.json({ error: 'db_error', detail: usersErr.message }, { status: 500 });
  }

  const userRows = (users ?? []) as UserRow[];

  // Count activities per user. One COUNT(*) GROUP BY would be cleaner,
  // but PostgREST exposes aggregations differently and the loop here
  // is N=tiny. Each request is HEAD + Prefer: count=exact, so we get
  // the count without payload.
  const counts: Record<string, number> = {};
  await Promise.all(userRows.map(async u => {
    const { count, error } = await supabaseAdmin()
      .from('activities')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', u.id);
    if (error) {
      console.warn(`[admin/users] activity count failed for ${u.id}:`, error.message);
      counts[u.id] = -1;
      return;
    }
    counts[u.id] = count ?? 0;
  }));

  // Also fetch the providers each user has linked, so the admin can
  // tell at a glance whether someone signed up via Google, Strava, or both.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: accounts } = await supabaseAdmin()
    .schema('next_auth')
    .from('accounts')
    .select('userId, provider');
  const providersByUser: Record<string, string[]> = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const a of (accounts ?? []) as any[]) {
    if (!providersByUser[a.userId]) providersByUser[a.userId] = [];
    providersByUser[a.userId].push(a.provider);
  }

  const enriched = userRows.map(u => ({
    id:          u.id,
    email:       u.email,
    name:        u.name,
    image:       u.image,
    athleteId:   u.athlete_id,
    createdAt:   u.created_at,
    activities:  counts[u.id] ?? 0,
    providers:   providersByUser[u.id] ?? [],
  }));

  return NextResponse.json({ users: enriched }, {
    headers: {
      'Cache-Control': 'no-store, must-revalidate',
    },
  });
}
