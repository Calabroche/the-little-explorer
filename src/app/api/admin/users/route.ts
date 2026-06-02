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

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/db';
import { isAdminEmail } from '@/lib/admin';
import { getAuthedUser } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface UserRow {
  id:          string;
  email:       string | null;
  name:        string | null;
  image:       string | null;
  athlete_id:  number | null;
  // created_at is added via ALTER TABLE in the latest schema.sql, but
  // existing prod rows have NULL since they were inserted before the
  // column existed. UI tolerates null gracefully.
  created_at:  string | null;
}

export async function GET(req: NextRequest) {
  const authed = await getAuthedUser(req);
  if (!authed?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!isAdminEmail(authed.email)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // Pull every user row from the next_auth schema. With a 5-10 user
  // family-and-friends scope this is fine to fetch in one go; if it
  // ever needs paging we'd switch to range() here.
  // NOTE: NextAuth's default users schema doesn't include created_at —
  // we add it via ALTER TABLE in supabase/schema.sql. If the column is
  // missing, fall back to a query without it so the admin page still
  // works on installs that haven't run the ALTER yet.
  let users: UserRow[] = [];
  let usersErr: { message: string } | null = null;
  {
    const r1 = await supabaseAdmin()
      .schema('next_auth')
      .from('users')
      .select('id, email, name, image, athlete_id, created_at')
      .order('created_at', { ascending: false });
    if (r1.error && /created_at/.test(r1.error.message)) {
      const r2 = await supabaseAdmin()
        .schema('next_auth')
        .from('users')
        .select('id, email, name, image, athlete_id');
      users = (r2.data ?? []) as UserRow[];
      usersErr = r2.error as { message: string } | null;
    } else {
      users = (r1.data ?? []) as UserRow[];
      usersErr = r1.error as { message: string } | null;
    }
  }

  if (usersErr) {
    console.error('[admin/users] users query failed:', usersErr.message);
    return NextResponse.json({ error: 'db_error', detail: usersErr.message }, { status: 500 });
  }

  const userRows = users;

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
    createdAt:   u.created_at ?? null,
    activities:  counts[u.id] ?? 0,
    providers:   providersByUser[u.id] ?? [],
  }));

  return NextResponse.json({ users: enriched }, {
    headers: {
      'Cache-Control': 'no-store, must-revalidate',
    },
  });
}

/**
 * DELETE /api/admin/users
 *
 * Body: { id: string }
 *
 * Hard-deletes a user from next_auth.users. Every other table that
 * references the user — sessions, accounts, api_tokens, activities,
 * bike_equipment, bike_gears, bike_service_events, itineraries — has
 * ON DELETE CASCADE on its user_id FK, so the row vanishes from the
 * whole app in one statement.
 *
 * Two guards:
 *   1. Admin-only (same email allowlist as GET).
 *   2. Cannot delete yourself — prevents the "admin nukes their own
 *      account, locks themselves out of /admin" foot-cannon.
 *
 * Strava-side: this does NOT revoke the user's Strava authorization
 * on Strava's end (we'd need to call /oauth/deauthorize for that, and
 * we don't have a fresh access_token here without doing a refresh
 * dance). The user can revoke from strava.com/settings/apps any time.
 */
export async function DELETE(req: NextRequest) {
  const authed = await getAuthedUser(req);
  if (!authed?.email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!isAdminEmail(authed.email)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  let body: { id?: string } = {};
  try {
    body = await req.json() as { id?: string };
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }
  const targetId = body.id;
  if (!targetId || typeof targetId !== 'string') {
    return NextResponse.json({ error: 'missing_id' }, { status: 400 });
  }
  if (targetId === authed.id) {
    return NextResponse.json({ error: 'cannot_delete_self' }, { status: 400 });
  }

  // Single DELETE — cascades take care of the rest.
  const { error } = await supabaseAdmin()
    .schema('next_auth')
    .from('users')
    .delete()
    .eq('id', targetId);
  if (error) {
    console.error('[admin/users.DELETE] failed for', targetId, ':', error.message);
    return NextResponse.json({ error: 'db_error', detail: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, deletedId: targetId });
}
