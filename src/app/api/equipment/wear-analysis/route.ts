/**
 * GET /api/equipment/wear-analysis?gearId=<bike_gears.id>
 *
 * Terrain-aware wear analysis for one bike. A manufacturer interval
 * ("plaquettes : 1000 km") assumes average terrain — but pads on a bike that
 * only descends cols wear several times faster than on a flat-commute bike.
 *
 * For every cycling activity ridden on this bike we recompute, from the raw
 * GPS streams stored in `activities.payload`:
 *   - smoothed gradient stats (min / max / average / distance-weighted |grade|)
 *   - climbing + descending meters and the km spent in steep descent (≤ −5 %)
 *   - braking events detected from the speed stream (sustained decelerations)
 *     and the kinetic energy they dissipated (≈ heat into pads + rims/rotors)
 *
 * From those we derive per-component wear MULTIPLIERS (1.0 = flat reference
 * ride; pads on a 20 m/km-descent mountain ride ≈ 3×), aggregate them over
 * the bike's history, and re-score the equipment actually installed on the
 * bike: effective km consumed, adjusted wear %, and a terrain-adjusted
 * replacement interval to compare with the manufacturer's.
 *
 * Heavy work (stream crunching) stays server-side; the response is a few KB
 * of per-ride numbers so iOS can reuse it as-is later.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/db';
import { getAuthedUser } from '@/lib/api-auth';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { calcInclines } from '@/lib/inclines';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

// ── Per-ride terrain metrics ──────────────────────────────────────────

interface RideMetrics {
  id:            number;
  title:         string;
  date:          string;        // ISO start_date
  km:            number;
  durationMin:   number;
  ascentM:       number;
  descentM:      number;
  minGradePct:   number | null; // steepest descent
  maxGradePct:   number | null; // steepest climb
  avgGradePct:   number | null; // distance-weighted mean of |grade|
  avgClimbPct:   number | null; // mean grade over climbing segments
  avgDescPct:    number | null; // mean grade over descending segments (negative)
  climbKm:       number;        // km at grade ≥ +2 %
  descKm:        number;        // km at grade ≤ −2 %
  steepDescKm:   number;        // km at grade ≤ −5 %
  brakeEvents:   number;        // sustained decelerations
  brakeKJ:       number;        // kinetic energy dissipated braking (kJ)
  hasStreams:    boolean;
  mult: Record<ComponentKey, number>;
}

type ComponentKey = 'brake_pads' | 'brake_rotors' | 'chain' | 'cassette' | 'tire_rear' | 'tire_front';

const COMPONENT_LABEL: Record<ComponentKey, string> = {
  brake_pads:   'Plaquettes de frein',
  brake_rotors: 'Disques de frein',
  chain:        'Chaîne',
  cassette:     'Cassette',
  tire_rear:    'Pneu arrière',
  tire_front:   'Pneu avant',
};

/** Total rider+bike mass for the braking-energy estimate (kg). */
const MASS_KG = 75;

function smooth(values: number[], w: number): number[] {
  if (values.length === 0) return values;
  const out = new Array<number>(values.length);
  for (let i = 0; i < values.length; i++) {
    let s = 0, n = 0;
    for (let j = Math.max(0, i - w); j <= Math.min(values.length - 1, i + w); j++) { s += values[j]; n++; }
    out[i] = s / n;
  }
  return out;
}

/** Rolling-median despike: kills single-sample altitude jumps (bridge,
 *  tunnel, barometric recalibration) that a moving average only spreads
 *  out — those spikes were fabricating impossible ±30 % grades. */
function despike(values: number[], w: number): number[] {
  if (values.length === 0) return values;
  const out = new Array<number>(values.length);
  for (let i = 0; i < values.length; i++) {
    const lo = Math.max(0, i - w), hi = Math.min(values.length - 1, i + w);
    const win = values.slice(lo, hi + 1).sort((a, b) => a - b);
    out[i] = win[Math.floor(win.length / 2)];
  }
  return out;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function computeRideMetrics(row: any): RideMetrics {
  const p = row.payload ?? {};
  const altitudeRaw: number[] = Array.isArray(p.altitude)   ? p.altitude   : [];
  const dist: number[]        = Array.isArray(p.distance_m) ? p.distance_m : [];
  const speed: number[]       = Array.isArray(p.speed_kmh)  ? p.speed_kmh  : [];
  const time: number[]        = Array.isArray(p.time_s)     ? p.time_s     : [];
  const km = Number(row.distance_km ?? 0);

  const base: RideMetrics = {
    id: row.id, title: row.title ?? 'Sortie', date: row.start_date,
    km, durationMin: Number(row.duration_min ?? 0),
    ascentM: Number(row.elevation_m ?? 0), descentM: Number(row.elevation_m ?? 0),
    minGradePct: null, maxGradePct: null, avgGradePct: null,
    avgClimbPct: null, avgDescPct: null,
    climbKm: 0, descKm: 0, steepDescKm: 0,
    brakeEvents: 0, brakeKJ: 0,
    hasStreams: false,
    mult: { brake_pads: 1, brake_rotors: 1, chain: 1, cassette: 1, tire_rear: 1, tire_front: 1 },
  };

  const n = Math.min(altitudeRaw.length, dist.length);
  if (n >= 60 && km > 1) {
    base.hasStreams = true;
    // Despike (median) THEN smooth — used for the internal terrain buckets
    // below. The DISPLAYED numbers come from the app's references instead:
    //   - pente min/max: shared calcInclines (same as the activity page,
    //     calibrated to Strava ±0.2 %)
    //   - D+: Strava's official total (row.elevation_m), already in `base`
    //   - D−: D+ corrected by the net start→end drop (exact for loops)
    const alt = smooth(despike(altitudeRaw.slice(0, n), 3), 4);

    const inc = calcInclines(altitudeRaw.slice(0, n), dist.slice(0, n));
    base.minGradePct = inc.min_incline;
    base.maxGradePct = inc.max_incline;
    base.descentM = Math.max(0, Math.round(base.ascentM + (alt[0] - alt[n - 1])));

    // Grades over ≥100 m windows for the wear model's terrain distribution
    // (steep-descent share, climb share, weighted averages). Robust to noise;
    // not shown on the activity page so no consistency constraint.
    const WINDOW_M = 100;
    let climbM = 0, descM = 0, steepDescM = 0;
    let absSum = 0, absW = 0;
    let climbSum = 0, climbW = 0, descSum = 0, descW = 0;

    let i = 0;
    while (i < n - 1) {
      let j = i + 1;
      while (j < n - 1 && dist[j] - dist[i] < WINDOW_M) j++;
      const dD = dist[j] - dist[i];
      if (dD >= 60) {
        const g = ((alt[j] - alt[i]) / dD) * 100;
        if (g > -25 && g < 25) {
          absSum += Math.abs(g) * dD; absW += dD;
          if (g >= 2)  { climbM += dD; climbSum += g * dD; climbW += dD; }
          if (g <= -2) { descM  += dD; descSum  += g * dD; descW  += dD; }
          if (g <= -5) steepDescM += dD;
        }
      }
      i = j;
    }
    base.avgGradePct = absW  > 0 ? +(absSum  / absW ).toFixed(1) : null;
    base.avgClimbPct = climbW > 0 ? +(climbSum / climbW).toFixed(1) : null;
    base.avgDescPct  = descW  > 0 ? +(descSum  / descW ).toFixed(1) : null;
    base.climbKm     = +(climbM / 1000).toFixed(1);
    base.descKm      = +(descM  / 1000).toFixed(1);
    base.steepDescKm = +(steepDescM / 1000).toFixed(1);

    // Braking: sustained decelerations in the speed stream. Each event
    // dissipates ½·m·(v0²−v1²) into the brakes — that heat IS pad wear.
    const ns = Math.min(speed.length, time.length);
    if (ns >= 60) {
      let events = 0, kj = 0;
      let evStartV: number | null = null;
      for (let k = 1; k < ns; k++) {
        const dt = Math.max(1, time[k] - time[k - 1]);
        if (dt > 10) { evStartV = null; continue; }       // GPS gap / pause
        const decel = ((speed[k - 1] - speed[k]) / 3.6) / dt;   // m/s²
        if (decel >= 1.2 && speed[k - 1] >= 15) {
          if (evStartV == null) evStartV = speed[k - 1] / 3.6;
        } else if (evStartV != null) {
          const v1 = speed[k - 1] / 3.6;
          if (evStartV - v1 >= 2) {                        // ≥ ~7 km/h shed
            events++;
            kj += 0.5 * MASS_KG * (evStartV ** 2 - v1 ** 2) / 1000;
          }
          evStartV = null;
        }
      }
      base.brakeEvents = events;
      base.brakeKJ = Math.round(kj);
    }
  }

  // ── Wear multipliers (1.0 = flat reference) ────────────────────────
  // d / h = descent / ascent meters per km; steep = share of the ride in
  // steep descent; bpk = brake events per km. Coefficients calibrated so a
  // flat ride ≈ 1×, rolling terrain ≈ 1.3-1.6×, a true col day ≈ 2.5-4×.
  const d     = km > 0 ? base.descentM / km : 0;
  const h     = km > 0 ? base.ascentM  / km : 0;
  const steep = km > 0 ? base.steepDescKm / km : 0;
  const bpk   = km > 0 ? base.brakeEvents / km : 0;
  const cap = (x: number, hi: number) => +Math.min(hi, Math.max(1, x)).toFixed(2);

  base.mult = {
    brake_pads:   cap(1 + d / 12 + steep * 1.2 + bpk * 0.25, 5),
    brake_rotors: cap(1 + d / 25 + steep * 0.6,              3.5),
    chain:        cap(1 + h / 30,                            2.5),
    cassette:     cap(1 + h / 35,                            2.2),
    tire_rear:    cap(1 + h / 50 + steep * 0.4 + bpk * 0.12, 2.5),
    tire_front:   cap(1 + d / 50 + steep * 0.3,              2),
  };
  return base;
}

// ── Narrative (French, plain sentences) ───────────────────────────────

function buildNarrative(bikeName: string, rides: RideMetrics[], agg: Record<ComponentKey, number>): string {
  const totKm = rides.reduce((s, r) => s + r.km, 0);
  const hPerKm = totKm > 0 ? rides.reduce((s, r) => s + r.ascentM, 0) / totKm : 0;
  const profile = hPerKm < 6 ? 'plutôt plat' : hPerKm < 12 ? 'vallonné' : hPerKm < 18 ? 'montagneux' : 'très montagneux (profil cols)';
  const brakes = rides.reduce((s, r) => s + r.brakeEvents, 0);
  const steepKm = rides.reduce((s, r) => s + r.steepDescKm, 0);

  const lines: string[] = [];
  lines.push(`Sur ${rides.length} sorties avec ${bikeName} (${Math.round(totKm)} km), ton terrain est ${profile} : ${hPerKm.toFixed(0)} m de D+ par km en moyenne.`);
  if (steepKm > 1) lines.push(`Tu as passé ${steepKm.toFixed(0)} km en descente raide (pente sous −5 %), avec ${brakes} freinages appuyés détectés. C'est là que les plaquettes chauffent vraiment.`);
  const padMult = agg.brake_pads;
  if (padMult >= 1.8) lines.push(`Conséquence : tes plaquettes s'usent environ ${padMult.toFixed(1)} fois plus vite que sur du plat. Un intervalle constructeur de 1000 km correspond chez toi à ${(1000 / padMult).toFixed(0)} km réels.`);
  else if (padMult >= 1.25) lines.push(`Tes plaquettes s'usent environ ${padMult.toFixed(1)} fois plus vite que la référence sur plat. Pense à vérifier un peu avant l'intervalle constructeur.`);
  else lines.push(`Ton profil de sorties use les plaquettes normalement. L'intervalle constructeur reste une bonne référence.`);
  if (agg.chain >= 1.3) lines.push(`Le D+ sollicite aussi la transmission : compte une usure de chaîne ${agg.chain.toFixed(1)} fois plus rapide (le couple en montée étire la chaîne).`);
  return lines.join(' ');
}

// ── Route ─────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const authed = await getAuthedUser(req);
  if (!authed?.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const limited = enforceRateLimit(req, RATE_LIMITS.authedRead, 'wear-analysis', { userId: authed.id });
  if (limited) return limited;

  const gearId = new URL(req.url).searchParams.get('gearId');
  if (!gearId) return NextResponse.json({ error: 'gearId_required' }, { status: 400 });

  const db = supabaseAdmin();
  const [{ data: gear }, { data: acts, error: actErr }, { data: equip }] = await Promise.all([
    db.from('bike_gears').select('id, name').eq('id', gearId).eq('user_id', authed.id).maybeSingle(),
    db.from('activities')
      .select('id, title, start_date, duration_min, distance_km, elevation_m, payload')
      .eq('user_id', authed.id).eq('sport', 'cycling').eq('gear_id', gearId)
      .order('start_date', { ascending: false })
      .limit(120),
    db.from('bike_equipment')
      .select('id, name, kind, installed_at, installed_at_km, lifetime_km')
      .eq('user_id', authed.id).eq('gear_id', gearId).is('replaced_at', null),
  ]);

  if (actErr) return NextResponse.json({ error: 'db_error' }, { status: 500 });
  if (!gear)  return NextResponse.json({ error: 'bike_not_found' }, { status: 404 });

  const rides = (acts ?? []).map(computeRideMetrics).filter(r => r.km > 0.5);
  if (rides.length === 0) {
    return NextResponse.json({ gear, rides: [], components: [], pieces: [], narrative: `Aucune sortie trouvée avec ${gear.name}.` });
  }

  // Aggregate multiplier per component, weighted by ride distance.
  const totKm = rides.reduce((s, r) => s + r.km, 0);
  const agg = {} as Record<ComponentKey, number>;
  (Object.keys(COMPONENT_LABEL) as ComponentKey[]).forEach(c => {
    agg[c] = +(rides.reduce((s, r) => s + r.mult[c] * r.km, 0) / totKm).toFixed(2);
  });

  const components = (Object.keys(COMPONENT_LABEL) as ComponentKey[]).map(c => ({
    key: c,
    label: COMPONENT_LABEL[c],
    multiplier: agg[c],
  }));

  // Re-score the pieces actually installed on this bike: effective km =
  // Σ km × multiplier over the rides since the piece was installed.
  const kindToComponent = (kind: string): ComponentKey | null => {
    if (kind.startsWith('brake_pads'))  return 'brake_pads';
    if (kind.startsWith('brake_rotor')) return 'brake_rotors';
    if (kind === 'chain')               return 'chain';
    if (kind === 'cassette')            return 'cassette';
    if (kind === 'tire_rear')           return 'tire_rear';
    if (kind === 'tire_front')          return 'tire_front';
    return null;
  };
  const pieces = (equip ?? []).flatMap(e => {
    const comp = kindToComponent(e.kind as string);
    if (!comp) return [];
    // Rides since install, selected by ODOMETER (km target = bike total −
    // installed_at_km), walking back from the newest ride. More faithful than
    // the install DATE: the wear meter itself is odometer-based, and a piece
    // declared today with "445 km already on it" must still count those rides.
    const kmTarget = Math.max(0, totKm - Number(e.installed_at_km ?? 0));
    const since: RideMetrics[] = [];
    let cum = 0;
    for (const r of rides) {           // rides are newest → oldest
      if (cum >= kmTarget - 0.5) break;
      since.push(r);
      cum += r.km;
    }
    const rawKm = since.reduce((s, r) => s + r.km, 0);
    const effKm = since.reduce((s, r) => s + r.km * r.mult[comp], 0);
    const lifetime = Number(e.lifetime_km ?? 0);
    return [{
      id: e.id, name: e.name, kind: e.kind, component: comp,
      lifetimeKm: lifetime,
      rawKmSinceInstall: +rawKm.toFixed(0),
      effectiveKmSinceInstall: +effKm.toFixed(0),
      adjustedWearPct: lifetime > 0 ? +((effKm / lifetime) * 100).toFixed(0) : null,
      rawWearPct:      lifetime > 0 ? +((rawKm / lifetime) * 100).toFixed(0) : null,
      adjustedIntervalKm: lifetime > 0 ? Math.round(lifetime / agg[comp]) : null,
    }];
  });

  return NextResponse.json({
    gear,
    terrain: {
      rideCount: rides.length,
      totalKm: +totKm.toFixed(0),
      ascentPerKm: +(rides.reduce((s, r) => s + r.ascentM, 0) / totKm).toFixed(1),
      descentPerKm: +(rides.reduce((s, r) => s + r.descentM, 0) / totKm).toFixed(1),
      steepDescKm: +rides.reduce((s, r) => s + r.steepDescKm, 0).toFixed(1),
      brakeEvents: rides.reduce((s, r) => s + r.brakeEvents, 0),
      brakeKJ: rides.reduce((s, r) => s + r.brakeKJ, 0),
    },
    components,
    pieces,
    rides,
    narrative: buildNarrative(gear.name as string, rides, agg),
  // no-store: a 5-min browser cache here made fixes look only half-applied
  // (stale table next to a fresh activity page). The analysis is recomputed
  // per request — acceptable, it only runs when the tab is opened.
  }, { headers: { 'Cache-Control': 'no-store' } });
}
