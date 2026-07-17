/**
 * /api/activities/<id>/media — photos/videos on an activity.
 *
 *   GET    → list media for an activity the viewer can see.
 *   POST   { image: dataUrl }  → add a photo (owner only). Uploaded to Storage.
 *   DELETE { mediaId }         → remove one media (owner only).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/db';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { viewerCanSeeActivity } from '@/lib/social';
import { uploadImageDataUrl, signMediaPaths, pathFromLegacyUrl, removeMediaPaths } from '@/lib/media';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function ownsActivity(userId: string, activityId: number): Promise<boolean> {
  const { data } = await supabaseAdmin()
    .from('activities').select('id').eq('id', activityId).eq('user_id', userId).maybeSingle();
  return !!data;
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const authed = await getAuthedUser(req);
  if (!authed?.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const activityId = Number(params.id);
  if (!Number.isFinite(activityId)) return NextResponse.json({ error: 'invalid_id' }, { status: 400 });

  const access = await viewerCanSeeActivity(authed.id, activityId);
  if (!access.ok) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const { data, error } = await supabaseAdmin()
    .from('activity_media')
    .select('id, url, path, kind, position')
    .eq('activity_id', activityId)
    .order('position', { ascending: true });
  if (error) return NextResponse.json({ error: 'db_error' }, { status: 500 });

  // The bucket is private: hand out short-lived signed URLs, only now that the
  // viewer has passed the activity's visibility check above.
  const rows = (data ?? []) as { id: string; url: string | null; path: string | null; kind: string; position: number }[];
  const paths = rows.map(r => r.path ?? pathFromLegacyUrl(r.url)).filter((p): p is string => !!p);
  const signed = await signMediaPaths(paths);
  const out = rows.map(r => {
    const p = r.path ?? pathFromLegacyUrl(r.url);
    return { id: r.id, kind: r.kind, position: r.position, url: (p && signed.get(p)) ?? null };
  }).filter(r => r.url);

  return NextResponse.json(out, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const authed = await getAuthedUser(req);
  if (!authed?.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const limited = enforceRateLimit(req, RATE_LIMITS.authedWrite, 'media-add', { userId: authed.id });
  if (limited) return limited;

  const activityId = Number(params.id);
  if (!Number.isFinite(activityId)) return NextResponse.json({ error: 'invalid_id' }, { status: 400 });
  if (!(await ownsActivity(authed.id, activityId))) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  let body: { image?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }
  if (typeof body.image !== 'string' || !body.image.startsWith('data:image/')) {
    return NextResponse.json({ error: 'invalid_image' }, { status: 400 });
  }
  if (body.image.length > 8_000_000) return NextResponse.json({ error: 'image_too_large' }, { status: 400 });

  // Cap the number of photos per activity.
  const { count } = await supabaseAdmin()
    .from('activity_media').select('id', { count: 'exact', head: true }).eq('activity_id', activityId);
  if ((count ?? 0) >= 12) return NextResponse.json({ error: 'too_many_media', message: '12 max' }, { status: 400 });

  // Upload returns the storage PATH — the bucket is private, there is no
  // public URL to store.
  let path: string;
  try { path = await uploadImageDataUrl(activityId, body.image); }
  catch (e) { console.error('[media] upload failed:', (e as Error).message); return NextResponse.json({ error: 'upload_failed' }, { status: 500 }); }

  const { data, error } = await supabaseAdmin()
    .from('activity_media')
    .insert({ activity_id: activityId, user_id: authed.id, path, kind: 'image', position: count ?? 0 })
    .select('id, kind, position')
    .single();
  if (error) return NextResponse.json({ error: 'db_error' }, { status: 500 });

  const signed = await signMediaPaths([path]);
  return NextResponse.json({ ...data, url: signed.get(path) ?? null });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const authed = await getAuthedUser(req);
  if (!authed?.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const activityId = Number(params.id);
  if (!Number.isFinite(activityId)) return NextResponse.json({ error: 'invalid_id' }, { status: 400 });

  let body: { mediaId?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }
  if (typeof body.mediaId !== 'string') return NextResponse.json({ error: 'invalid_media_id' }, { status: 400 });

  const { data, error } = await supabaseAdmin()
    .from('activity_media')
    .delete()
    .eq('id', body.mediaId)
    .eq('activity_id', activityId)
    .eq('user_id', authed.id)   // owner scope
    .select('id, url, path')
    .maybeSingle();
  if (error) return NextResponse.json({ error: 'db_error' }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // Drop the object too — a deleted photo shouldn't linger in the bucket.
  const p = (data as { path: string | null; url: string | null }).path ?? pathFromLegacyUrl((data as { url: string | null }).url);
  if (p) void removeMediaPaths([p]);
  return NextResponse.json({ ok: true });
}
