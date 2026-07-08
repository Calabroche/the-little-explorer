/**
 * GET    /api/activities/<id>/comments        — list comments (author-visible)
 * POST   /api/activities/<id>/comments {body}  — add a comment
 * DELETE /api/activities/<id>/comments {commentId} — remove a comment
 *
 * You can only read / write comments on an activity you're allowed to see.
 * A comment can be deleted by its author OR by the activity's owner (light
 * moderation). Flat thread, newest last — mirrors Strava.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/db';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { viewerCanSeeActivity, loadAuthors } from '@/lib/social';
import { sendPushToUser } from '@/lib/push';
import { logEvent } from '@/lib/events';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_COMMENT_LEN = 1000;

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const authed = await getAuthedUser(req);
  if (!authed?.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const id = Number(params.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'invalid_id' }, { status: 400 });

  const access = await viewerCanSeeActivity(authed.id, id);
  if (!access.ok) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const { data, error } = await supabaseAdmin()
    .from('activity_comments')
    .select('id, user_id, body, created_at')
    .eq('activity_id', id)
    .order('created_at', { ascending: true });
  if (error) {
    console.error('[comments] list failed:', error.message);
    return NextResponse.json({ error: 'db_error' }, { status: 500 });
  }

  const authors = await loadAuthors((data ?? []).map(c => c.user_id as string));
  const comments = (data ?? []).map(c => ({
    id:         c.id as string,
    body:       c.body as string,
    created_at: c.created_at as string,
    is_mine:    c.user_id === authed.id,
    author:     authors.get(c.user_id as string) ?? { id: c.user_id, name: null, image: null },
  }));
  return NextResponse.json(comments, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const authed = await getAuthedUser(req);
  if (!authed?.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const limited = enforceRateLimit(req, RATE_LIMITS.authedWrite, 'comment', { userId: authed.id });
  if (limited) return limited;

  const id = Number(params.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'invalid_id' }, { status: 400 });

  let payload: { body?: unknown };
  try { payload = await req.json(); } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }
  const body = typeof payload.body === 'string' ? payload.body.trim() : '';
  if (!body) return NextResponse.json({ error: 'empty_comment' }, { status: 400 });
  if (body.length > MAX_COMMENT_LEN) return NextResponse.json({ error: 'comment_too_long' }, { status: 400 });

  const access = await viewerCanSeeActivity(authed.id, id);
  if (!access.ok) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const { data, error } = await supabaseAdmin()
    .from('activity_comments')
    .insert({ activity_id: id, user_id: authed.id, body })
    .select('id, created_at')
    .single();
  if (error) {
    console.error('[comments] insert failed:', error.message);
    return NextResponse.json({ error: 'db_error' }, { status: 500 });
  }

  void logEvent({ type: 'activity_commented', userId: authed.id, properties: { activity_id: id, author_id: access.authorId } }, req);

  if (access.authorId && access.authorId !== authed.id) {
    const authorId = access.authorId;
    const preview = body.length > 60 ? body.slice(0, 57) + '…' : body;
    void (async () => {
      const name = (await loadAuthors([authed.id])).get(authed.id)?.name ?? 'Quelqu’un';
      await sendPushToUser(authorId, { title: `${name} a commenté 💬`, body: preview, data: { activity_id: id } });
    })();
  }
  return NextResponse.json({
    ok: true,
    comment: {
      id:         data.id as string,
      body,
      created_at: data.created_at as string,
      is_mine:    true,
      author:     { id: authed.id, name: null, image: null },
    },
  });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const authed = await getAuthedUser(req);
  if (!authed?.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const id = Number(params.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'invalid_id' }, { status: 400 });

  let payload: { commentId?: unknown };
  try { payload = await req.json(); } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }
  const commentId = typeof payload.commentId === 'string' ? payload.commentId : '';
  if (!commentId) return NextResponse.json({ error: 'invalid_comment_id' }, { status: 400 });

  // Fetch the comment to check permissions: author of the comment, or owner
  // of the activity, may delete it.
  const { data: comment } = await supabaseAdmin()
    .from('activity_comments')
    .select('user_id, activity_id')
    .eq('id', commentId)
    .eq('activity_id', id)
    .maybeSingle();
  if (!comment) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  let allowed = comment.user_id === authed.id;
  if (!allowed) {
    const { data: act } = await supabaseAdmin()
      .from('activities')
      .select('user_id')
      .eq('id', id)
      .maybeSingle();
    allowed = act?.user_id === authed.id;
  }
  if (!allowed) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const { error } = await supabaseAdmin().from('activity_comments').delete().eq('id', commentId);
  if (error) {
    console.error('[comments] delete failed:', error.message);
    return NextResponse.json({ error: 'db_error' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
