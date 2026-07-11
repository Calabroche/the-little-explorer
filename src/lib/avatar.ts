/**
 * Avatar storage — custom profile photos live in the public Supabase Storage
 * bucket `avatars`, NOT as base64 data URLs in next_auth.users.image.
 *
 * Storing them as data URLs bloated every feed/profile response (LCP blew up to
 * ~24s) and, worse, pushed the NextAuth JWT session cookie past Vercel's header
 * limit → site-wide 494. A Storage URL is ~80 bytes, so all of that goes away.
 */
import { supabaseAdmin } from '@/lib/db';

const BUCKET = 'avatars';

let bucketEnsured = false;
async function ensureBucket() {
  if (bucketEnsured) return;
  // Idempotent: ignore "already exists". Public so <img src> / AsyncImage work.
  await supabaseAdmin().storage.createBucket(BUCKET, { public: true }).catch(() => {});
  bucketEnsured = true;
}

/** Decode a base64 image data URL, upload it to the avatars bucket at a stable
 *  per-user path (upsert), and return the public URL (cache-busted). Throws on
 *  a malformed data URL or upload failure. */
export async function uploadAvatarDataUrl(userId: string, dataUrl: string): Promise<string> {
  const m = /^data:image\/(png|jpe?g|webp);base64,(.+)$/i.exec(dataUrl);
  if (!m) throw new Error('invalid_image_data_url');
  const ext = m[1].toLowerCase() === 'png' ? 'png' : m[1].toLowerCase() === 'webp' ? 'webp' : 'jpg';
  const contentType = `image/${ext === 'jpg' ? 'jpeg' : ext}`;
  const buffer = Buffer.from(m[2], 'base64');

  await ensureBucket();
  const path = `${userId}.${ext}`;
  const { error } = await supabaseAdmin().storage.from(BUCKET).upload(path, buffer, {
    contentType, upsert: true, cacheControl: '3600',
  });
  if (error) throw new Error(`avatar_upload_failed: ${error.message}`);

  const { data } = supabaseAdmin().storage.from(BUCKET).getPublicUrl(path);
  // ?v= busts the CDN/browser cache so a re-upload shows immediately.
  return `${data.publicUrl}?v=${Date.now()}`;
}
