/**
 * /api/itineraries — CRUD for saved tour plans.
 *
 *   GET             — list the user's itineraries (summaries only,
 *                     ordered most-recent first). Skips the heavy
 *                     `geometry` / `elevations` arrays so the list
 *                     view loads fast.
 *   GET ?id=<id>    — fetch one itinerary with its full payload.
 *   POST            — create a new itinerary (full payload).
 *   DELETE          — remove an itinerary by id.
 *
 * Auth: standard bearer token / NextAuth session, like the rest of
 * the user-scoped endpoints. Rate-limited; body size capped at 500 KB
 * (an itinerary geometry can be a few hundred coords — comfortably
 * under that ceiling but not infinite).
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/db';
import { getAuthedUser } from '@/lib/api-auth';
import { enforceRateLimit, enforceBodySize, RATE_LIMITS } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Lightweight summary used by the list endpoint — no geometry. */
interface ItinerarySummary {
  id:          string;
  name:        string;
  distance_km: number | null;
  created_at:  string;
  waypoint_count: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function summaryFrom(row: { id: string; name: string; distance_km: any; created_at: string; payload: any }): ItinerarySummary {
  return {
    id:             row.id,
    name:           row.name,
    distance_km:    row.distance_km != null ? Number(row.distance_km) : null,
    created_at:     row.created_at,
    waypoint_count: Array.isArray(row.payload?.waypoints) ? row.payload.waypoints.length : 0,
  };
}

// ── GET ──────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const authed = await getAuthedUser(req);
  if (!authed?.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const limited = enforceRateLimit(req, RATE_LIMITS.authedRead, 'itineraries-get', { userId: authed.id });
  if (limited) return limited;

  const url = new URL(req.url);
  const id  = url.searchParams.get('id');

  if (id) {
    // Single fetch — return the full payload (including geometry +
    // elevations). The iOS Watch picker downloads this once when the
    // user taps an itinerary.
    const { data, error } = await supabaseAdmin()
      .from('itineraries')
      .select('id, name, distance_km, created_at, payload')
      .eq('id',      id)
      .eq('user_id', authed.id)
      .maybeSingle();
    if (error) {
      console.error('[itineraries.get:one] failed:', error.message);
      return NextResponse.json({ error: 'db_error' }, { status: 500 });
    }
    if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    return NextResponse.json({
      id:          data.id,
      name:        data.name,
      distance_km: data.distance_km != null ? Number(data.distance_km) : null,
      created_at:  data.created_at,
      payload:     data.payload,
    });
  }

  // List view — summaries only, fast.
  const { data, error } = await supabaseAdmin()
    .from('itineraries')
    .select('id, name, distance_km, created_at, payload')
    .eq('user_id', authed.id)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) {
    console.error('[itineraries.get:list] failed:', error.message);
    return NextResponse.json({ error: 'db_error' }, { status: 500 });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items = (data ?? []).map(r => summaryFrom(r as any));
  return NextResponse.json({ items });
}

// ── POST ─────────────────────────────────────────────────────────────

interface CreateBody {
  id?:         string;       // optional client-generated id; we generate one if absent
  name:        string;
  distance_km?: number | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload:     Record<string, any>;
}

export async function POST(req: NextRequest) {
  const authed = await getAuthedUser(req);
  if (!authed?.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const limited = enforceRateLimit(req, RATE_LIMITS.authedWrite, 'itineraries-post', { userId: authed.id });
  if (limited) return limited;
  const tooBig = enforceBodySize(req, 500_000);
  if (tooBig) return tooBig;

  let body: CreateBody;
  try { body = await req.json() as CreateBody; }
  catch { return NextResponse.json({ error: 'bad_json' }, { status: 400 }); }

  if (!body.name || typeof body.name !== 'string' || body.name.trim().length === 0) {
    return NextResponse.json({ error: 'invalid_name' }, { status: 400 });
  }
  if (!body.payload || typeof body.payload !== 'object') {
    return NextResponse.json({ error: 'invalid_payload' }, { status: 400 });
  }

  // Generate a server-side id if the client didn't supply one. We
  // accept client ids so the iOS app can keep its local-first id
  // when saving a freshly-built itinerary without round-tripping.
  const id = body.id?.trim() || `itin_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

  const { data, error } = await supabaseAdmin()
    .from('itineraries')
    .upsert({
      id,
      user_id:     authed.id,
      name:        body.name.trim().slice(0, 120),
      payload:     body.payload,
      distance_km: body.distance_km ?? null,
    }, { onConflict: 'id' })
    .select()
    .single();
  if (error) {
    console.error('[itineraries.post] failed:', error.message);
    return NextResponse.json({ error: 'db_error', detail: error.message }, { status: 500 });
  }
  return NextResponse.json({ id: data.id, name: data.name }, { status: 201 });
}

// ── DELETE ───────────────────────────────────────────────────────────

export async function DELETE(req: NextRequest) {
  const authed = await getAuthedUser(req);
  if (!authed?.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const limited = enforceRateLimit(req, RATE_LIMITS.authedWrite, 'itineraries-delete', { userId: authed.id });
  if (limited) return limited;

  let body: { id?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'bad_json' }, { status: 400 }); }
  if (!body.id) return NextResponse.json({ error: 'invalid_id' }, { status: 400 });

  const { error } = await supabaseAdmin()
    .from('itineraries')
    .delete()
    .eq('id',      body.id)
    .eq('user_id', authed.id);
  if (error) {
    console.error('[itineraries.delete] failed:', error.message);
    return NextResponse.json({ error: 'db_error', detail: error.message }, { status: 500 });
  }
  return new NextResponse(null, { status: 204 });
}
