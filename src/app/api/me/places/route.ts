/**
 * /api/me/places — the user's favorite places (itinerary start points).
 *
 *   GET    → list the user's saved places (newest first).
 *   POST   { name, lat, lng, label?, code?, postal?, city?, kind? } → save one.
 *   DELETE { id } → remove one (owner-scoped).
 *
 * Synced across web + iOS so "je pars toujours du même endroit" is one tap.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/db';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const COLS = 'id, name, label, code, postal, city, kind, lat, lng';

export async function GET(req: NextRequest) {
  const authed = await getAuthedUser(req);
  if (!authed?.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { data, error } = await supabaseAdmin()
    .from('favorite_places')
    .select(COLS)
    .eq('user_id', authed.id)
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: 'db_error' }, { status: 500 });
  return NextResponse.json(data ?? [], { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: NextRequest) {
  const authed = await getAuthedUser(req);
  if (!authed?.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const limited = enforceRateLimit(req, RATE_LIMITS.authedWrite, 'place-add', { userId: authed.id });
  if (limited) return limited;

  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }
  const lat = Number(b.lat), lng = Number(b.lng);
  const name = typeof b.name === 'string' ? b.name.trim() : '';
  if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: 'invalid_place' }, { status: 400 });
  }
  const str = (v: unknown) => (typeof v === 'string' && v.length ? v.slice(0, 200) : null);

  // Cap favourites per user.
  const { count } = await supabaseAdmin()
    .from('favorite_places').select('id', { count: 'exact', head: true }).eq('user_id', authed.id);
  if ((count ?? 0) >= 30) return NextResponse.json({ error: 'too_many', message: '30 max' }, { status: 400 });

  const { data, error } = await supabaseAdmin()
    .from('favorite_places')
    .insert({
      user_id: authed.id, name: name.slice(0, 200), label: str(b.label), code: str(b.code),
      postal: str(b.postal), city: str(b.city), kind: str(b.kind), lat, lng,
    })
    .select(COLS)
    .single();
  if (error) return NextResponse.json({ error: 'db_error' }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest) {
  const authed = await getAuthedUser(req);
  if (!authed?.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  let b: { id?: unknown };
  try { b = await req.json(); } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }
  if (typeof b.id !== 'string') return NextResponse.json({ error: 'invalid_id' }, { status: 400 });

  const { data, error } = await supabaseAdmin()
    .from('favorite_places').delete().eq('id', b.id).eq('user_id', authed.id).select('id').maybeSingle();
  if (error) return NextResponse.json({ error: 'db_error' }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
