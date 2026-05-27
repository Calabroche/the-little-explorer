/**
 * /api/equipment — bike maintenance tracker CRUD.
 *
 *   GET    — list current equipment (replaced_at IS NULL) for the
 *            authenticated user, with computed "km since install" +
 *            "wear %" derived from the user's total cycling distance.
 *   POST   — create a new equipment item.
 *   PATCH  — update an item (rename, change lifetime, mark replaced).
 *   DELETE — remove an item entirely (e.g. user added it by mistake).
 *
 * Wear computation is server-side so the iOS app + web get the same
 * numbers, and we don't have to ship the activities table to the
 * client. Total km is computed as SUM of distance_km across the user's
 * cycling activities — `installed_at_km` snapshots the value at
 * install so the wear delta is just a subtraction per request.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/db';
import { getAuthedUser } from '@/lib/api-auth';
import { enforceRateLimit, enforceBodySize, RATE_LIMITS } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type EquipmentKind =
  | 'chain' | 'brake_pads_front' | 'brake_pads_rear'
  | 'tire_front' | 'tire_rear' | 'cassette' | 'cables'
  | 'bar_tape' | 'bottom_bracket' | 'pedals' | 'other';

const ALLOWED_KINDS: ReadonlySet<EquipmentKind> = new Set<EquipmentKind>([
  'chain', 'brake_pads_front', 'brake_pads_rear', 'tire_front',
  'tire_rear', 'cassette', 'cables', 'bar_tape', 'bottom_bracket',
  'pedals', 'other',
]);

interface EquipmentRow {
  id:              string;
  name:            string;
  kind:            EquipmentKind;
  installed_at:    string;
  installed_at_km: number;
  lifetime_km:     number;
  replaced_at:     string | null;
  notes:           string | null;
  /** Computed: total cycling km on the user's account today. */
  totalKmToday:    number;
  /** Computed: km on this part = totalKmToday − installed_at_km. */
  kmSinceInstall:  number;
  /** Computed: kmSinceInstall / lifetime_km, capped at 1.5 for display. */
  wearRatio:       number;
}

async function totalCyclingKm(userId: string): Promise<number> {
  const { data, error } = await supabaseAdmin()
    .from('activities')
    .select('distance_km')
    .eq('user_id', userId)
    .eq('sport',  'cycling');
  if (error) {
    console.error('[equipment] total km query failed:', error.message);
    return 0;
  }
  return (data ?? []).reduce((s, r) => s + Number(r.distance_km ?? 0), 0);
}

// ── GET ────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const authed = await getAuthedUser(req);
  if (!authed?.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const limited = enforceRateLimit(req, RATE_LIMITS.authedRead, 'equipment-get', { userId: authed.id });
  if (limited) return limited;

  const { data, error } = await supabaseAdmin()
    .from('bike_equipment')
    .select('id, name, kind, installed_at, installed_at_km, lifetime_km, replaced_at, notes')
    .eq('user_id', authed.id)
    .is('replaced_at', null)
    .order('created_at', { ascending: false });
  if (error) {
    console.error('[equipment.get] failed:', error.message);
    return NextResponse.json({ error: 'db_error', detail: error.message }, { status: 500 });
  }

  const totalKm = await totalCyclingKm(authed.id);
  const rows: EquipmentRow[] = (data ?? []).map(r => {
    const installed = Number(r.installed_at_km ?? 0);
    const km = Math.max(0, totalKm - installed);
    const ratio = r.lifetime_km > 0 ? Math.min(1.5, km / r.lifetime_km) : 0;
    return {
      id:              r.id              as string,
      name:            r.name            as string,
      kind:            r.kind            as EquipmentKind,
      installed_at:    r.installed_at    as string,
      installed_at_km: installed,
      lifetime_km:     r.lifetime_km     as number,
      replaced_at:     r.replaced_at     as string | null,
      notes:           r.notes           as string | null,
      totalKmToday:    Math.round(totalKm * 10) / 10,
      kmSinceInstall:  Math.round(km * 10) / 10,
      wearRatio:       Math.round(ratio * 100) / 100,
    };
  });

  return NextResponse.json({ totalKm: Math.round(totalKm * 10) / 10, items: rows });
}

// ── POST ───────────────────────────────────────────────────────────

interface CreateBody {
  name:            string;
  kind:            EquipmentKind;
  installed_at?:   string;   // ISO date; defaults to now
  installed_at_km?: number;  // defaults to current totalKm
  lifetime_km:     number;
  notes?:          string | null;
}

export async function POST(req: NextRequest) {
  const authed = await getAuthedUser(req);
  if (!authed?.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const limited = enforceRateLimit(req, RATE_LIMITS.authedWrite, 'equipment-post', { userId: authed.id });
  if (limited) return limited;
  const tooBig = enforceBodySize(req, 5_000);
  if (tooBig) return tooBig;

  let body: CreateBody;
  try { body = await req.json() as CreateBody; }
  catch { return NextResponse.json({ error: 'bad_json' }, { status: 400 }); }

  // Validate.
  if (!body.name || typeof body.name !== 'string' || body.name.trim().length === 0) {
    return NextResponse.json({ error: 'invalid_name' }, { status: 400 });
  }
  if (!ALLOWED_KINDS.has(body.kind)) {
    return NextResponse.json({ error: 'invalid_kind' }, { status: 400 });
  }
  if (typeof body.lifetime_km !== 'number' || body.lifetime_km < 100 || body.lifetime_km > 50000) {
    return NextResponse.json({ error: 'invalid_lifetime', message: '100 ≤ lifetime_km ≤ 50000' }, { status: 400 });
  }

  // Default installed_at_km = user's current cycling total (so the
  // wear meter starts at 0 for a brand-new install).
  const totalKm = body.installed_at_km != null ? body.installed_at_km : await totalCyclingKm(authed.id);

  const { data, error } = await supabaseAdmin()
    .from('bike_equipment')
    .insert({
      user_id:         authed.id,
      name:            body.name.trim().slice(0, 80),
      kind:            body.kind,
      installed_at:    body.installed_at ?? new Date().toISOString(),
      installed_at_km: totalKm,
      lifetime_km:     body.lifetime_km,
      notes:           body.notes?.toString().slice(0, 200) ?? null,
    })
    .select()
    .single();
  if (error) {
    console.error('[equipment.post] failed:', error.message);
    return NextResponse.json({ error: 'db_error', detail: error.message }, { status: 500 });
  }
  return NextResponse.json(data, { status: 201 });
}

// ── PATCH ──────────────────────────────────────────────────────────
// Body: { id, name?, lifetime_km?, replaced?: boolean, notes? }
// Setting `replaced: true` stamps replaced_at = now() and snapshots
// the part's km — effectively "retiring" it. The UI then prompts to
// add a fresh one of the same kind.

interface UpdateBody {
  id:           string;
  name?:        string;
  lifetime_km?: number;
  replaced?:    boolean;
  notes?:       string | null;
}

export async function PATCH(req: NextRequest) {
  const authed = await getAuthedUser(req);
  if (!authed?.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const limited = enforceRateLimit(req, RATE_LIMITS.authedWrite, 'equipment-patch', { userId: authed.id });
  if (limited) return limited;
  const tooBig = enforceBodySize(req, 5_000);
  if (tooBig) return tooBig;

  let body: UpdateBody;
  try { body = await req.json() as UpdateBody; }
  catch { return NextResponse.json({ error: 'bad_json' }, { status: 400 }); }

  if (!body.id || typeof body.id !== 'string') {
    return NextResponse.json({ error: 'invalid_id' }, { status: 400 });
  }

  const update: Record<string, string | number | null> = {};
  if (body.name != null) update.name = String(body.name).trim().slice(0, 80);
  if (body.lifetime_km != null) {
    if (typeof body.lifetime_km !== 'number' || body.lifetime_km < 100 || body.lifetime_km > 50000) {
      return NextResponse.json({ error: 'invalid_lifetime' }, { status: 400 });
    }
    update.lifetime_km = body.lifetime_km;
  }
  if (body.notes !== undefined) update.notes = body.notes?.toString().slice(0, 200) ?? null;
  if (body.replaced === true) {
    update.replaced_at = new Date().toISOString();
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'empty_update' }, { status: 400 });
  }

  const { error } = await supabaseAdmin()
    .from('bike_equipment')
    .update(update)
    .eq('id',      body.id)
    .eq('user_id', authed.id); // RLS-like guard: can't edit someone else's row
  if (error) {
    console.error('[equipment.patch] failed:', error.message);
    return NextResponse.json({ error: 'db_error', detail: error.message }, { status: 500 });
  }
  return new NextResponse(null, { status: 204 });
}

// ── DELETE ─────────────────────────────────────────────────────────
// Body: { id }

export async function DELETE(req: NextRequest) {
  const authed = await getAuthedUser(req);
  if (!authed?.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const limited = enforceRateLimit(req, RATE_LIMITS.authedWrite, 'equipment-delete', { userId: authed.id });
  if (limited) return limited;

  let body: { id?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'bad_json' }, { status: 400 }); }
  if (!body.id) return NextResponse.json({ error: 'invalid_id' }, { status: 400 });

  const { error } = await supabaseAdmin()
    .from('bike_equipment')
    .delete()
    .eq('id',      body.id)
    .eq('user_id', authed.id);
  if (error) {
    console.error('[equipment.delete] failed:', error.message);
    return NextResponse.json({ error: 'db_error', detail: error.message }, { status: 500 });
  }
  return new NextResponse(null, { status: 204 });
}
