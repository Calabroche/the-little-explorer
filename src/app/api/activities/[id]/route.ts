/**
 * PATCH /api/activities/<id>  { visibility?, title?, sport? }
 *
 * Edit one of YOUR activities: visibility (public | followers | private),
 * display title, and sport/type. Owner only — scoped by user_id. Any subset of
 * the three fields may be sent; at least one is required.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/db';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { isVisibility } from '@/lib/social';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Sports the user can switch a ride to (mirrors the Activity type union).
const SPORTS = new Set([
  'cycling', 'running', 'hiking', 'walking', 'swim', 'snowshoe', 'ski',
  'snowboard', 'iceSkate', 'yoga', 'workout', 'cardio', 'rowing', 'kayak',
  'paddle', 'surf', 'sail', 'inlineSkate', 'skateboard', 'climbing', 'racket',
  'soccer', 'golf', 'wheelchair', 'other',
]);

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const authed = await getAuthedUser(req);
  if (!authed?.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const limited = enforceRateLimit(req, RATE_LIMITS.authedWrite, 'activity-patch', { userId: authed.id });
  if (limited) return limited;

  const id = Number(params.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'invalid_id' }, { status: 400 });

  let body: { visibility?: unknown; title?: unknown; sport?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }

  const update: Record<string, string> = {};
  if ('visibility' in body && body.visibility !== undefined) {
    if (!isVisibility(body.visibility)) return NextResponse.json({ error: 'invalid_visibility' }, { status: 400 });
    update.visibility = body.visibility;
  }
  if ('title' in body && body.title !== undefined) {
    if (typeof body.title !== 'string') return NextResponse.json({ error: 'invalid_title' }, { status: 400 });
    const t = body.title.trim();
    if (t.length === 0 || t.length > 200) return NextResponse.json({ error: 'invalid_title', message: '1–200 caractères' }, { status: 400 });
    update.title = t;
  }
  if ('sport' in body && body.sport !== undefined) {
    if (typeof body.sport !== 'string' || !SPORTS.has(body.sport)) return NextResponse.json({ error: 'invalid_sport' }, { status: 400 });
    update.sport = body.sport;
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'empty_update' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin()
    .from('activities')
    .update(update)
    .eq('id', id)
    .eq('user_id', authed.id)   // owner scope
    .select('id')
    .maybeSingle();
  if (error) {
    console.error('[activity-patch] update failed:', error.message);
    return NextResponse.json({ error: 'db_error' }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  return NextResponse.json({ ok: true, id, ...update });
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
