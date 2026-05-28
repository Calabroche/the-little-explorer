/**
 * /api/service-events — bike maintenance event log.
 *
 *   GET    — list recent events for the authed user (optionally
 *            filtered to one bike) and compute "next due" status per
 *            kind so the UI can nag about overdue maintenance.
 *   POST   — log a new event.
 *   DELETE — remove an event (typo undo).
 *
 * This is the *event* layer that pairs with /api/equipment's *piece
 * lifecycle* layer. Together they give a complete maintenance picture:
 *   bike_equipment        = "what's installed and how worn is it"
 *   bike_service_events   = "what did I do to the bike, when"
 *
 * Next-due math is server-side (same as equipment wear) so iOS + web
 * get identical numbers without re-implementing the rules client-side.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/db';
import { getAuthedUser } from '@/lib/api-auth';
import { enforceRateLimit, enforceBodySize, RATE_LIMITS } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type ServiceKind =
  | 'chain_lube' | 'chain_clean'
  | 'brake_bleed' | 'brake_pads_check'
  | 'wheel_true' | 'tire_pressure'
  | 'derailleur_tune' | 'bottom_bracket_check'
  | 'cable_check' | 'bike_wash' | 'general_service'
  | 'other';

const ALLOWED_KINDS: ReadonlySet<ServiceKind> = new Set<ServiceKind>([
  'chain_lube', 'chain_clean',
  'brake_bleed', 'brake_pads_check',
  'wheel_true', 'tire_pressure',
  'derailleur_tune', 'bottom_bracket_check',
  'cable_check', 'bike_wash', 'general_service',
  'other',
]);

/**
 * Recommended interval per maintenance kind. `km` is the typical
 * distance after which the action should be repeated; `days` is the
 * calendar-time equivalent for actions that age regardless of riding
 * (brake bleed, bike wash). When both apply, the UI picks whichever
 * triggers first.
 *
 * These are reasonable defaults for a road-bike-with-hydraulic-disc-
 * brakes setup, calibrated against Shimano service intervals + common
 * mechanic guidance. Could be made user-configurable later; for v1
 * they're hard-coded server-side so iOS + web agree.
 */
interface ServiceInterval { km?: number; days?: number }
const INTERVALS: Record<ServiceKind, ServiceInterval> = {
  chain_lube:           { km: 200,                },
  chain_clean:          { km: 500,                },
  brake_bleed:          { km: 5000,  days: 365   },
  brake_pads_check:     { km: 1000,                },
  wheel_true:           { km: 3000,                },
  tire_pressure:        {            days: 7      },
  derailleur_tune:      { km: 2000,                },
  bottom_bracket_check: { km: 5000,                },
  cable_check:          { km: 5000,                },
  bike_wash:            { km: 500,   days: 14     },
  general_service:      { km: 8000,  days: 365   },
  other:                {                          },
};

interface ServiceEventRow {
  id:           string;
  gear_id:      string | null;
  gear_name:    string | null;
  kind:         ServiceKind;
  date:         string;
  km_at_event:  number | null;
  notes:        string | null;
}

interface NextDue {
  kind:           ServiceKind;
  last_date:      string | null;        // ISO when last performed
  last_km:        number | null;        // bike km at last event
  km_since:       number | null;        // current bike total − last_km
  days_since:     number | null;        // calendar days since last_date
  km_interval:    number | null;        // recommended km interval
  day_interval:   number | null;        // recommended day interval
  /**
   * 'fresh'    = within interval (or no interval defined for this kind)
   * 'due'      = within 10 % of the interval — friendly nudge zone
   * 'overdue'  = past the interval — red zone
   * 'unknown'  = action never logged and no interval applies → no opinion
   */
  status:         'fresh' | 'due' | 'overdue' | 'unknown';
}

async function totalCyclingKm(userId: string, gearId: string): Promise<number> {
  const { data, error } = await supabaseAdmin()
    .from('activities')
    .select('distance_km')
    .eq('user_id', userId)
    .eq('sport',    'cycling')
    .eq('gear_id',  gearId);
  if (error) {
    console.error('[service-events] km query failed:', error.message);
    return 0;
  }
  return (data ?? []).reduce((s, r) => s + Number(r.distance_km ?? 0), 0);
}

// ── GET ──────────────────────────────────────────────────────────────
//
// Query: ?gear_id=<id> (optional). Without it, returns events across
// all bikes (rarely useful but supported for completeness).

export async function GET(req: NextRequest) {
  const authed = await getAuthedUser(req);
  if (!authed?.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const limited = enforceRateLimit(req, RATE_LIMITS.authedRead, 'service-events-get', { userId: authed.id });
  if (limited) return limited;

  const url    = new URL(req.url);
  const gearId = url.searchParams.get('gear_id');

  let q = supabaseAdmin()
    .from('bike_service_events')
    .select('id, gear_id, kind, date, km_at_event, notes')
    .eq('user_id', authed.id)
    .order('date', { ascending: false })
    .limit(200);
  if (gearId) q = q.eq('gear_id', gearId);
  const { data, error } = await q;
  if (error) {
    console.error('[service-events.get] failed:', error.message);
    return NextResponse.json({ error: 'db_error', detail: error.message }, { status: 500 });
  }

  // Denormalize gear_name so the UI doesn't have to do a join.
  const { data: bikes } = await supabaseAdmin()
    .from('bike_gears')
    .select('id, name')
    .eq('user_id', authed.id);
  const bikeName = new Map((bikes ?? []).map(b => [b.id as string, b.name as string]));

  const events: ServiceEventRow[] = (data ?? []).map(r => ({
    id:          r.id          as string,
    gear_id:     (r.gear_id ?? null) as string | null,
    gear_name:   r.gear_id ? (bikeName.get(r.gear_id as string) ?? null) : null,
    kind:        r.kind        as ServiceKind,
    date:        r.date        as string,
    km_at_event: r.km_at_event != null ? Number(r.km_at_event) : null,
    notes:       (r.notes ?? null) as string | null,
  }));

  // Compute "next due" per kind for the requested bike. Only meaningful
  // when scoped to a specific gear (without gear_id we'd be mixing
  // bikes' counters together).
  let dueByKind: NextDue[] = [];
  if (gearId) {
    const totalKm = await totalCyclingKm(authed.id, gearId);
    const eventsForBike = events.filter(e => e.gear_id === gearId);
    const now = Date.now();

    dueByKind = (Object.keys(INTERVALS) as ServiceKind[]).map(kind => {
      const interval = INTERVALS[kind];
      const latest   = eventsForBike.find(e => e.kind === kind);
      const lastDate = latest?.date ?? null;
      const lastKm   = latest?.km_at_event ?? null;

      const kmSince   = lastKm   != null ? Math.max(0, totalKm - lastKm) : null;
      const daysSince = lastDate != null
        ? Math.floor((now - new Date(lastDate).getTime()) / (24 * 3600 * 1000))
        : null;

      let status: NextDue['status'] = 'fresh';
      if (interval.km == null && interval.days == null) {
        // No interval defined ('other') — we have no opinion.
        status = 'unknown';
      } else if (lastDate == null) {
        // Never logged + interval defined → encourage doing it once.
        status = 'due';
      } else {
        const ratios: number[] = [];
        if (interval.km != null && kmSince   != null) ratios.push(kmSince   / interval.km);
        if (interval.days != null && daysSince != null) ratios.push(daysSince / interval.days);
        const peak = Math.max(...ratios, 0);
        status = peak >= 1 ? 'overdue' : peak >= 0.9 ? 'due' : 'fresh';
      }

      return {
        kind,
        last_date:    lastDate,
        last_km:      lastKm,
        km_since:     kmSince   != null ? Math.round(kmSince * 10) / 10 : null,
        days_since:   daysSince,
        km_interval:  interval.km   ?? null,
        day_interval: interval.days ?? null,
        status,
      };
    });
  }

  return NextResponse.json({ events, dueByKind });
}

// ── POST ─────────────────────────────────────────────────────────────

interface CreateBody {
  gear_id?:    string | null;
  kind:        ServiceKind;
  date?:       string;      // ISO; defaults to now
  km_at_event?: number;     // defaults to current totalKm of the bike
  notes?:      string | null;
}

export async function POST(req: NextRequest) {
  const authed = await getAuthedUser(req);
  if (!authed?.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const limited = enforceRateLimit(req, RATE_LIMITS.authedWrite, 'service-events-post', { userId: authed.id });
  if (limited) return limited;
  const tooBig = enforceBodySize(req, 5_000);
  if (tooBig) return tooBig;

  let body: CreateBody;
  try { body = await req.json() as CreateBody; }
  catch { return NextResponse.json({ error: 'bad_json' }, { status: 400 }); }

  if (!ALLOWED_KINDS.has(body.kind)) {
    return NextResponse.json({ error: 'invalid_kind' }, { status: 400 });
  }

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

  // Default km_at_event = current cycling total on the bound bike (so
  // "next-due" math has a meaningful baseline even when the user
  // doesn't type a km). Falls back to null when no bike bound.
  const kmAtEvent = body.km_at_event != null
    ? body.km_at_event
    : (gearId ? await totalCyclingKm(authed.id, gearId) : null);

  const { data, error } = await supabaseAdmin()
    .from('bike_service_events')
    .insert({
      user_id:      authed.id,
      gear_id:      gearId,
      kind:         body.kind,
      date:         body.date ?? new Date().toISOString(),
      km_at_event:  kmAtEvent,
      notes:        body.notes?.toString().slice(0, 300) ?? null,
    })
    .select()
    .single();
  if (error) {
    console.error('[service-events.post] failed:', error.message);
    return NextResponse.json({ error: 'db_error', detail: error.message }, { status: 500 });
  }
  return NextResponse.json(data, { status: 201 });
}

// ── DELETE ───────────────────────────────────────────────────────────

export async function DELETE(req: NextRequest) {
  const authed = await getAuthedUser(req);
  if (!authed?.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const limited = enforceRateLimit(req, RATE_LIMITS.authedWrite, 'service-events-delete', { userId: authed.id });
  if (limited) return limited;

  let body: { id?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'bad_json' }, { status: 400 }); }
  if (!body.id) return NextResponse.json({ error: 'invalid_id' }, { status: 400 });

  const { error } = await supabaseAdmin()
    .from('bike_service_events')
    .delete()
    .eq('id',      body.id)
    .eq('user_id', authed.id);
  if (error) {
    console.error('[service-events.delete] failed:', error.message);
    return NextResponse.json({ error: 'db_error', detail: error.message }, { status: 500 });
  }
  return new NextResponse(null, { status: 204 });
}
