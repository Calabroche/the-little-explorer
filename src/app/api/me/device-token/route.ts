/**
 * POST   /api/me/device-token  { token, platform? }  — register this device's
 *        APNs token for push notifications (upsert on token).
 * DELETE /api/me/device-token  { token }              — unregister (on logout).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/db';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const authed = await getAuthedUser(req);
  if (!authed?.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const limited = enforceRateLimit(req, RATE_LIMITS.authedWrite, 'device-token', { userId: authed.id });
  if (limited) return limited;

  let body: { token?: unknown; platform?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }
  const token = typeof body.token === 'string' ? body.token.trim() : '';
  if (!token) return NextResponse.json({ error: 'invalid_token' }, { status: 400 });
  const platform = typeof body.platform === 'string' ? body.platform : 'ios';

  // Upsert on the token: re-registering the same device moves it to this user
  // and refreshes last_seen. (Same physical device, new login → new owner.)
  const { error } = await supabaseAdmin()
    .schema('next_auth')
    .from('device_tokens')
    .upsert(
      { user_id: authed.id, token, platform, last_seen_at: new Date().toISOString() },
      { onConflict: 'token' },
    );
  if (error) {
    console.error('[device-token] upsert failed:', error.message);
    return NextResponse.json({ error: 'db_error' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const authed = await getAuthedUser(req);
  if (!authed?.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: { token?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }
  const token = typeof body.token === 'string' ? body.token.trim() : '';
  if (!token) return NextResponse.json({ error: 'invalid_token' }, { status: 400 });

  const { error } = await supabaseAdmin()
    .schema('next_auth').from('device_tokens').delete().eq('token', token).eq('user_id', authed.id);
  if (error) return NextResponse.json({ error: 'db_error' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
