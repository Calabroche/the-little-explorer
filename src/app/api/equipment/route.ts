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
  | 'frame' | 'fork'
  | 'chain' | 'cassette' | 'crankset' | 'bottom_bracket'
  | 'derailleur_front' | 'derailleur_rear' | 'battery_di2'
  | 'brake_lever_front' | 'brake_lever_rear'
  | 'brake_pads_front' | 'brake_pads_rear'
  | 'brake_rotor_front' | 'brake_rotor_rear' | 'brake_mount'
  | 'wheel_front' | 'wheel_rear'
  | 'tire_front' | 'tire_rear'
  | 'thru_axle_front' | 'thru_axle_rear'
  | 'cables' | 'bar_tape' | 'pedals' | 'other';

const ALLOWED_KINDS: ReadonlySet<EquipmentKind> = new Set<EquipmentKind>([
  'frame', 'fork',
  'chain', 'cassette', 'crankset', 'bottom_bracket',
  'derailleur_front', 'derailleur_rear', 'battery_di2',
  'brake_lever_front', 'brake_lever_rear',
  'brake_pads_front', 'brake_pads_rear',
  'brake_rotor_front', 'brake_rotor_rear', 'brake_mount',
  'wheel_front', 'wheel_rear',
  'tire_front', 'tire_rear',
  'thru_axle_front', 'thru_axle_rear',
  'cables', 'bar_tape', 'pedals', 'other',
]);

interface Bike {
  id:           string;
  name:         string;
  primary_bike: boolean;
  /** Computed: cumulative km on this specific bike. */
  totalKm:      number;
}

interface EquipmentRow {
  id:              string;
  name:            string;
  kind:            EquipmentKind;
  installed_at:    string;
  installed_at_km: number;
  lifetime_km:     number;
  replaced_at:     string | null;
  notes:           string | null;
  /** Strava gear id this piece is bound to. Null = "all bikes". */
  gear_id:         string | null;
  /** Convenience: the Strava nickname of the bound bike, when known. */
  gear_name:       string | null;
  /** Computed: total cycling km on the user's account today (or on the
   *  bound bike if gear_id is set). */
  totalKmToday:    number;
  /** Computed: km on this part = scoped total − installed_at_km. */
  kmSinceInstall:  number;
  /** Computed: kmSinceInstall / lifetime_km, capped at 1.5 for display. */
  wearRatio:       number;
}

/** Returns total cycling km on the user's account.
 *  When `gearId` is provided, scopes the sum to activities tagged with
 *  that bike (a chain on one bike doesn't wear when riding the other). */
async function totalCyclingKm(userId: string, gearId?: string | null): Promise<number> {
  let q = supabaseAdmin()
    .from('activities')
    .select('distance_km')
    .eq('user_id', userId)
    .eq('sport',  'cycling');
  if (gearId) q = q.eq('gear_id', gearId);
  const { data, error } = await q;
  if (error) {
    console.error('[equipment] total km query failed:', error.message);
    return 0;
  }
  return (data ?? []).reduce((s, r) => s + Number(r.distance_km ?? 0), 0);
}

/** All bikes the user has on Strava, each with its current cumulative
 *  km. Used both for the GET payload and to look up scoped totals. */
async function listBikesWithKm(userId: string): Promise<Bike[]> {
  const { data, error } = await supabaseAdmin()
    .from('bike_gears')
    .select('id, name, primary_bike')
    .eq('user_id', userId)
    .order('primary_bike', { ascending: false })
    .order('name',         { ascending: true });
  if (error) {
    console.error('[equipment] bikes query failed:', error.message);
    return [];
  }
  // Fan-out one km query per bike in parallel.
  const bikes = (data ?? []) as Array<{ id: string; name: string; primary_bike: boolean }>;
  const totals = await Promise.all(bikes.map(b => totalCyclingKm(userId, b.id)));
  return bikes.map((b, i) => ({
    id:           b.id,
    name:         b.name,
    primary_bike: b.primary_bike,
    totalKm:      Math.round(totals[i] * 10) / 10,
  }));
}

// ── GET ────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const authed = await getAuthedUser(req);
  if (!authed?.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const limited = enforceRateLimit(req, RATE_LIMITS.authedRead, 'equipment-get', { userId: authed.id });
  if (limited) return limited;

  const { data, error } = await supabaseAdmin()
    .from('bike_equipment')
    .select('id, name, kind, installed_at, installed_at_km, lifetime_km, replaced_at, notes, gear_id')
    .eq('user_id', authed.id)
    .is('replaced_at', null)
    .order('created_at', { ascending: false });
  if (error) {
    console.error('[equipment.get] failed:', error.message);
    return NextResponse.json({ error: 'db_error', detail: error.message }, { status: 500 });
  }

  // Fetch the user's bikes (with per-bike km) once. We lookup totals
  // from this list when computing each piece's wear.
  const bikes      = await listBikesWithKm(authed.id);
  const bikesById  = new Map(bikes.map(b => [b.id, b]));
  const totalAllKm = await totalCyclingKm(authed.id);

  const rows: EquipmentRow[] = (data ?? []).map(r => {
    const installed = Number(r.installed_at_km ?? 0);
    const gearId    = (r.gear_id ?? null) as string | null;
    const bike      = gearId ? bikesById.get(gearId) : undefined;
    // Pieces bound to a bike use that bike's total; unbound pieces
    // fall back to total cycling km (legacy behavior).
    const scopedTotal = bike ? bike.totalKm : totalAllKm;
    const km          = Math.max(0, scopedTotal - installed);
    const ratio       = r.lifetime_km > 0 ? Math.min(1.5, km / r.lifetime_km) : 0;
    return {
      id:              r.id              as string,
      name:            r.name            as string,
      kind:            r.kind            as EquipmentKind,
      installed_at:    r.installed_at    as string,
      installed_at_km: installed,
      lifetime_km:     r.lifetime_km     as number,
      replaced_at:     r.replaced_at     as string | null,
      notes:           r.notes           as string | null,
      gear_id:         gearId,
      gear_name:       bike?.name ?? null,
      totalKmToday:    Math.round(scopedTotal * 10) / 10,
      kmSinceInstall:  Math.round(km * 10) / 10,
      wearRatio:       Math.round(ratio * 100) / 100,
    };
  });

  return NextResponse.json({
    // `totalKm` is the user's overall cycling total — kept for
    // backwards compat with the iOS header card.
    totalKm: Math.round(totalAllKm * 10) / 10,
    items:   rows,
    bikes,
  });
}

// ── POST ───────────────────────────────────────────────────────────

interface CreateBody {
  name:            string;
  kind:            EquipmentKind;
  installed_at?:   string;   // ISO date; defaults to now
  installed_at_km?: number;  // defaults to current totalKm (of the bound bike)
  lifetime_km:     number;
  notes?:          string | null;
  /** Strava gear_id. Optional — null means "applies to all bikes". */
  gear_id?:        string | null;
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

  // Validate gear_id (if set) belongs to this user — defence against
  // pasting another user's gear id by mistake.
  const gearId = body.gear_id ?? null;
  if (gearId) {
    const { data: gear } = await supabaseAdmin()
      .from('bike_gears')
      .select('id')
      .eq('id',      gearId)
      .eq('user_id', authed.id)
      .maybeSingle();
    if (!gear) {
      return NextResponse.json({ error: 'invalid_gear_id' }, { status: 400 });
    }
  }

  // Default installed_at_km = current cycling total on the bound bike
  // (so the wear meter starts at 0 for a brand-new install). When no
  // bike is bound, we fall back to the user's overall cycling total.
  const totalKm = body.installed_at_km != null
    ? body.installed_at_km
    : await totalCyclingKm(authed.id, gearId);

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
      gear_id:         gearId,
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
  /** Rebind the piece to a different bike (or unbind with null). */
  gear_id?:     string | null;
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
  // gear_id: explicit null clears the binding, a string sets it.
  // Undefined means "don't touch" — same convention as `notes`.
  if (body.gear_id !== undefined) {
    if (body.gear_id !== null) {
      const { data: gear } = await supabaseAdmin()
        .from('bike_gears')
        .select('id')
        .eq('id',      body.gear_id)
        .eq('user_id', authed.id)
        .maybeSingle();
      if (!gear) {
        return NextResponse.json({ error: 'invalid_gear_id' }, { status: 400 });
      }
    }
    update.gear_id = body.gear_id;
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
