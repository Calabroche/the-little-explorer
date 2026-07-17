/**
 * Activity media storage — photos uploaded to the PRIVATE Supabase Storage
 * bucket `media`.
 *
 * The bucket is deliberately private: a public bucket made every photo of a
 * `followers`/`private` ride readable by anyone holding (or guessing) the URL,
 * forever — the visibility model was silently bypassed for media. We now store
 * only the object PATH and hand out short-lived SIGNED URLs, minted per request
 * after the caller has passed the same visibility check as the activity itself.
 */
import { supabaseAdmin } from '@/lib/db';

const BUCKET = 'media';
/** Signed URLs live long enough to load a feed / detail page, not forever. */
export const SIGNED_URL_TTL_S = 60 * 60;

let bucketEnsured = false;
async function ensureBucket() {
  if (bucketEnsured) return;
  // private: never served without a signature.
  await supabaseAdmin().storage.createBucket(BUCKET, { public: false }).catch(() => {});
  bucketEnsured = true;
}

/** Decode a base64 image data URL and upload it under the activity's folder.
 *  Returns the storage PATH (not a URL — the bucket is private). */
export async function uploadImageDataUrl(activityId: number, dataUrl: string): Promise<string> {
  const m = /^data:image\/(png|jpe?g|webp);base64,(.+)$/i.exec(dataUrl);
  if (!m) throw new Error('invalid_image_data_url');
  const ext = m[1].toLowerCase() === 'png' ? 'png' : m[1].toLowerCase() === 'webp' ? 'webp' : 'jpg';
  const contentType = `image/${ext === 'jpg' ? 'jpeg' : ext}`;
  const buffer = Buffer.from(m[2], 'base64');

  await ensureBucket();
  const path = `${activityId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabaseAdmin().storage.from(BUCKET).upload(path, buffer, {
    contentType, upsert: false, cacheControl: '86400',
  });
  if (error) throw new Error(`media_upload_failed: ${error.message}`);
  return path;
}

/** Legacy rows stored a full public URL; derive the object path from it. */
export function pathFromLegacyUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const i = url.indexOf('/object/public/media/');
  if (i >= 0) return url.slice(i + '/object/public/media/'.length).split('?')[0];
  return null;
}

/** Mint short-lived signed URLs for a batch of paths. Returns path → signedUrl.
 *  Callers MUST have already authorized the viewer for the parent activity. */
export async function signMediaPaths(paths: string[], expiresIn = SIGNED_URL_TTL_S): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = Array.from(new Set(paths.filter(Boolean)));
  if (unique.length === 0) return out;
  const { data, error } = await supabaseAdmin().storage.from(BUCKET).createSignedUrls(unique, expiresIn);
  if (error || !data) {
    console.error('[media] createSignedUrls failed:', error?.message);
    return out;
  }
  for (const d of data) {
    if (d.signedUrl && d.path) out.set(d.path, d.signedUrl);
  }
  return out;
}

/** Delete objects from storage (best-effort, e.g. when media rows are removed). */
export async function removeMediaPaths(paths: string[]): Promise<void> {
  const unique = Array.from(new Set(paths.filter(Boolean)));
  if (unique.length === 0) return;
  await supabaseAdmin().storage.from(BUCKET).remove(unique).catch(() => {});
}
