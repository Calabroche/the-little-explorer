/**
 * PATCH /api/activities/<id>  { visibility }
 *
 * Set an activity's visibility (public | followers | private). Owner only —
 * scoped by user_id so a user can only change their own activities.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/db';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { isVisibility } from '@/lib/social';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const authed = await getAuthedUser(req);
  if (!authed?.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const limited = enforceRateLimit(req, RATE_LIMITS.authedWrite, 'activity-patch', { userId: authed.id });
  if (limited) return limited;

  const id = Number(params.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'invalid_id' }, { status: 400 });

  let body: { visibility?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }
  if (!isVisibility(body.visibility)) {
    return NextResponse.json({ error: 'invalid_visibility' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin()
    .from('activities')
    .update({ visibility: body.visibility })
    .eq('id', id)
    .eq('user_id', authed.id)   // owner scope
    .select('id')
    .maybeSingle();
  if (error) {
    console.error('[activity-patch] update failed:', error.message);
    return NextResponse.json({ error: 'db_error' }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  return NextResponse.json({ ok: true, id, visibility: body.visibility });
}

/**
 * DELETE /api/activities/<id> — permanently remove one of YOUR activities.
 * Owner-scoped. Cascades to likes/comments via the FK. Note: a Strava-synced
 * ride can be re-added by a later Strava sync (we don't tombstone yet).
 */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const authed = await getAuthedUser(req);
  if (!authed?.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const limited = enforceRateLimit(req, RATE_LIMITS.authedWrite, 'activity-delete', { userId: authed.id });
  if (limited) return limited;

  const id = Number(params.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'invalid_id' }, { status: 400 });

  const { data, error } = await supabaseAdmin()
    .from('activities')
    .delete()
    .eq('id', id)
    .eq('user_id', authed.id)   // owner scope
    .select('id')
    .maybeSingle();
  if (error) {
    console.error('[activity-delete] failed:', error.message);
    return NextResponse.json({ error: 'db_error' }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ ok: true, id });
}
