/**
 * POST /api/admin/migrate-avatars — one-shot migration of legacy base64
 * `data:` avatars (stored inline in next_auth.users.image) to Supabase Storage,
 * replacing users.image with the short public URL. Admin-only. Idempotent:
 * re-running only touches rows that still hold a data URL.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/db';
import { isAdminEmail } from '@/lib/admin';
import { getAuthedUser } from '@/lib/api-auth';
import { uploadAvatarDataUrl } from '@/lib/avatar';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET is aliased to POST so an admin can trigger the one-shot migration by
// simply visiting the URL in a browser.
export async function GET(req: NextRequest) { return POST(req); }

export async function POST(req: NextRequest) {
  const authed = await getAuthedUser(req);
  if (!authed) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!isAdminEmail(authed.email)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const { data, error } = await supabaseAdmin()
    .schema('next_auth')
    .from('users')
    .select('id, image')
    .like('image', 'data:%');
  if (error) return NextResponse.json({ error: 'db_error', detail: error.message }, { status: 500 });

  const results: { id: string; ok: boolean; error?: string }[] = [];
  for (const u of data ?? []) {
    try {
      const url = await uploadAvatarDataUrl(u.id as string, u.image as string);
      const { error: upErr } = await supabaseAdmin()
        .schema('next_auth').from('users').update({ image: url }).eq('id', u.id);
      if (upErr) throw new Error(upErr.message);
      results.push({ id: u.id as string, ok: true });
    } catch (e) {
      results.push({ id: u.id as string, ok: false, error: (e as Error).message });
    }
  }

  return NextResponse.json({ migrated: results.filter(r => r.ok).length, total: results.length, results });
}
