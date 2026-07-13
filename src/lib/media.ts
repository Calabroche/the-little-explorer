/**
 * Activity media storage — photos (later videos) uploaded to the public
 * Supabase Storage bucket `media`. Photos are resized client-side and sent as
 * a base64 data URL (reliable, same proven path as avatars); we decode + store
 * and return the public URL. Videos will use signed direct uploads (fast
 * follow) since they exceed the API body limit.
 */
import { supabaseAdmin } from '@/lib/db';

const BUCKET = 'media';

let bucketEnsured = false;
async function ensureBucket() {
  if (bucketEnsured) return;
  await supabaseAdmin().storage.createBucket(BUCKET, { public: true }).catch(() => {});
  bucketEnsured = true;
}

/** Decode a base64 image data URL and upload it under the activity's folder.
 *  Returns the public URL. Throws on malformed input or upload failure. */
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

  const { data } = supabaseAdmin().storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}
