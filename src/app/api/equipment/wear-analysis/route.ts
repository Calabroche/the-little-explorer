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

// ── Wear model: ONE source of truth ───────────────────────────────────
// Each component has a wear RATE = flatBase + Σ(input × coefficient).
//
//   • Brake parts ('ratio'): on flat with no braking, pads barely wear, so
//     flatBase is small. The displayed × compares your wear rate to a
//     REFERENCE mixed terrain (what a manufacturer's "1000 km" assumes).
//     Result: flat ≈ 0.4× (pads last much longer than rated), mixed = 1×,
//     mountains > 1×.
//   • Distance parts ('additive', chain/cassette/tires): they wear with the
//     km ridden whatever the terrain, so flatBase = 1 and climbing/descent
//     only ADD on top. flat = 1×, never below.
//
// The same definition computes per-ride ×, aggregate × and the breakdown, so
// the number and its explanation can never diverge.
type WearInput = 'descPerKm' | 'climbPerKm' | 'steepShare' | 'brakePerKm';

interface WearVals { descPerKm: number; climbPerKm: number; steepShare: number; brakePerKm: number }

interface MultTerm {
  input: WearInput;
  coef:  number;
  label: string;
  fmt: (v: number) => string;
}

// What a generic manufacturer interval assumes: moderate rolling terrain.
const REF_TERRAIN: WearVals = { descPerKm: 7, climbPerKm: 7, steepShare: 0.02, brakePerKm: 0.05 };

const MULT_DEFS: Record<ComponentKey, { mode: 'ratio' | 'additive'; flatBase: number; floor: number; cap: number; why: string; terms: MultTerm[] }> = {
  brake_pads: {
    mode: 'ratio', flatBase: 0.35, floor: 0.3, cap: 5,
    why: "Les plaquettes ne s'usent quasiment qu'en freinant, donc surtout en descente. Sur du plat sans freiner, elles durent bien plus longtemps que l'intervalle constructeur (qui suppose un terrain mixte). Le × compare ton terrain à ce terrain mixte de référence.",
    terms: [
      { input: 'descPerKm',  coef: 0.07, label: 'Dénivelé descendu', fmt: v => `${v.toFixed(1)} m descendus / km` },
      { input: 'steepShare', coef: 1.0,  label: 'Descente raide',    fmt: v => `${(v * 100).toFixed(1)} % du parcours sous −5 %` },
      { input: 'brakePerKm', coef: 0.4,  label: 'Freinages appuyés', fmt: v => `${v.toFixed(2)} freinage / km` },
    ],
  },
  brake_rotors: {
    mode: 'ratio', flatBase: 0.5, floor: 0.5, cap: 3,
    why: "Les disques chauffent avec les plaquettes mais s'usent très lentement (métal). Comme elles, c'est la descente qui compte, comparée à un terrain mixte de référence.",
    terms: [
      { input: 'descPerKm', coef: 0.03, label: 'Dénivelé descendu', fmt: v => `${v.toFixed(1)} m descendus / km` },
      { input: 'steepShare', coef: 0.5,  label: 'Descente raide',    fmt: v => `${(v * 100).toFixed(1)} % du parcours sous −5 %` },
    ],
  },
  chain: {
    mode: 'additive', flatBase: 1, floor: 1, cap: 2.5,
    why: "La chaîne s'use à chaque coup de pédale, donc avec la distance quoi qu'il arrive (base 1). En montée, le fort couple l'étire en plus, d'où le supplément.",
    terms: [
      { input: 'climbPerKm', coef: 1 / 30, label: 'Dénivelé grimpé', fmt: v => `${v.toFixed(1)} m grimpés / km` },
    ],
  },
  cassette: {
    mode: 'additive', flatBase: 1, floor: 1, cap: 2.2,
    why: "Comme la chaîne : usure avec la distance (base 1), accélérée par le couple en montée.",
    terms: [
      { input: 'climbPerKm', coef: 1 / 35, label: 'Dénivelé grimpé', fmt: v => `${v.toFixed(1)} m grimpés / km` },
    ],
  },
  tire_rear: {
    mode: 'additive', flatBase: 1, floor: 1, cap: 2.5,
    why: "Le pneu arrière s'use avec la distance (base 1), un peu plus avec le couple en montée et les freinages.",
    terms: [
      { input: 'climbPerKm', coef: 1 / 50, label: 'Dénivelé grimpé', fmt: v => `${v.toFixed(1)} m grimpés / km` },
      { input: 'steepShare',  coef: 0.4,    label: 'Descente raide',  fmt: v => `${(v * 100).toFixed(1)} % du parcours sous −5 %` },
      { input: 'brakePerKm',  coef: 0.12,   label: 'Freinages',       fmt: v => `${v.toFixed(2)} freinage / km` },
    ],
  },
  tire_front: {
    mode: 'additive', flatBase: 1, floor: 1, cap: 2,
    why: "Le pneu avant s'use avec la distance (base 1), un peu plus dans les descentes appuyées (charge vers l'avant).",
    terms: [
      { input: 'descPerKm', coef: 1 / 60, label: 'Dénivelé descendu', fmt: v => `${v.toFixed(1)} m descendus / km` },
      { input: 'steepShare', coef: 0.3,    label: 'Descente raide',    fmt: v => `${(v * 100).toFixed(1)} % du parcours sous −5 %` },
    ],
  },
};

function wearRate(comp: ComponentKey, v: WearVals): number {
  const def = MULT_DEFS[comp];
  return def.flatBase + def.terms.reduce((s, t) => s + v[t.input] * t.coef, 0);
}

function multiplierFor(comp: ComponentKey, v: WearVals): number {
  const def = MULT_DEFS[comp];
  const raw = def.mode === 'ratio' ? wearRate(comp, v) / wearRate(comp, REF_TERRAIN) : wearRate(comp, v);
  return Math.min(def.cap, Math.max(def.floor, raw));
}

/** Term-by-term breakdown of the multiplier — fed to the expandable card.
 *  For 'ratio' parts every contribution is divided by the reference rate, so
 *  the rows still sum to the displayed × and the base row shows < 1. */
function breakdownFor(comp: ComponentKey, v: WearVals) {
  const def = MULT_DEFS[comp];
  const norm = def.mode === 'ratio' ? wearRate(comp, REF_TERRAIN) : 1;
  const terms = [
    {
      label: 'Base',
      detail: def.mode === 'ratio'
        ? "à plat sans freiner, l'usure est faible (< 1)"
        : "la pièce s'use avec la distance",
      contrib: +(def.flatBase / norm).toFixed(2),
    },
    ...def.terms.map(t => ({
      label: t.label,
      detail: def.mode === 'ratio'
        ? `${t.fmt(v[t.input])} · réf. mixte ${t.fmt(REF_TERRAIN[t.input])}`
        : t.fmt(v[t.input]),
      contrib: +((v[t.input] * t.coef) / norm).toFixed(2),
    })),
  ];
  const total = multiplierFor(comp, v);
  const rawTotal = terms.reduce((s, t) => s + t.contrib, 0);
  return { terms, total: +total.toFixed(2), capped: rawTotal > def.cap + 0.01, why: def.why };
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
    // Everything derives from the SAME reference basis as the activity page:
    //   - pente min/max: shared calcInclines (calibrated to Strava ±0.2 %)
    //   - D+: Strava's official total (row.elevation_m), already in `base`
    //   - D−: D+ corrected by the net start→end drop (exact for loops)
    //   - the distribution below: same 5-sample / ≥8 m / ±30 % windowing as
    //     calcInclines (non-overlapping), on median-despiked altitude, so
    //     pente moy / parts montée-descente / descente raide live on the
    //     same scale as the displayed extremes.
    const alt = despike(altitudeRaw.slice(0, n), 3);

    const inc = calcInclines(altitudeRaw.slice(0, n), dist.slice(0, n));
    base.minGradePct = inc.min_incline;
    base.maxGradePct = inc.max_incline;
    base.descentM = Math.max(0, Math.round(base.ascentM + (alt[0] - alt[n - 1])));

    const WINDOW = 5, MIN_DIST = 8, CAP = 30;
    let climbM = 0, descM = 0, steepDescM = 0;
    let absSum = 0, absW = 0;
    let climbSum = 0, climbW = 0, descSum = 0, descW = 0;

    for (let i = 0; i < n - WINDOW; i += WINDOW) {
      const dD = dist[i + WINDOW] - dist[i];
      if (dD < MIN_DIST) continue;
      const g = ((alt[i + WINDOW] - alt[i]) / dD) * 100;
      if (g <= -CAP || g >= CAP) continue;
      absSum += Math.abs(g) * dD; absW += dD;
      if (g >= 2)  { climbM += dD; climbSum += g * dD; climbW += dD; }
      if (g <= -2) { descM  += dD; descSum  += g * dD; descW  += dD; }
      if (g <= -5) steepDescM += dD;
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

  // Per-ride multipliers from the shared model (same coefficients as the
  // aggregate + breakdown, so the per-ride column and the verdict agree).
  const vals = wearValsFrom(base);
  base.mult = {} as Record<ComponentKey, number>;
  (Object.keys(COMPONENT_LABEL) as ComponentKey[]).forEach(c => {
    base.mult[c] = +multiplierFor(c, vals).toFixed(2);
  });
  return base;
}

/** Terrain inputs (per-km / share) for one ride or an aggregate. */
function wearValsFrom(m: { km: number; descentM: number; ascentM: number; steepDescKm: number; brakeEvents: number }): WearVals {
  const km = m.km > 0 ? m.km : 1;
  return {
    descPerKm:  m.descentM / km,
    climbPerKm: m.ascentM  / km,
    steepShare: m.steepDescKm / km,
    brakePerKm: m.brakeEvents / km,
  };
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
  if (padMult >= 1.5) lines.push(`Conséquence : tes plaquettes s'usent environ ${padMult.toFixed(1)} fois plus vite qu'en terrain mixte (la référence des intervalles constructeur). Les 1000 km annoncés correspondent chez toi à ${(1000 / padMult).toFixed(0)} km réels.`);
  else if (padMult >= 1.1) lines.push(`Tes plaquettes s'usent environ ${padMult.toFixed(1)} fois plus vite qu'en terrain mixte de référence. Vérifie-les un peu avant l'intervalle constructeur.`);
  else if (padMult <= 0.85) lines.push(`Bonne nouvelle pour les plaquettes : ton terrain les sollicite peu (×${padMult.toFixed(1)} vs terrain mixte), elles tiendront plus longtemps que les 1000 km annoncés.`);
  else lines.push(`Tes plaquettes s'usent à un rythme proche de l'intervalle constructeur (×${padMult.toFixed(1)}).`);
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

  // Aggregate terrain over the bike's history → one set of inputs that drives
  // the displayed multiplier AND its breakdown (so they match exactly).
  const totKm = rides.reduce((s, r) => s + r.km, 0);
  const aggVals = wearValsFrom({
    km: totKm,
    descentM:    rides.reduce((s, r) => s + r.descentM, 0),
    ascentM:     rides.reduce((s, r) => s + r.ascentM, 0),
    steepDescKm: rides.reduce((s, r) => s + r.steepDescKm, 0),
    brakeEvents: rides.reduce((s, r) => s + r.brakeEvents, 0),
  });
  const agg = {} as Record<ComponentKey, number>;
  (Object.keys(COMPONENT_LABEL) as ComponentKey[]).forEach(c => {
    agg[c] = +multiplierFor(c, aggVals).toFixed(2);
  });

  // Concrete worked example for the brake pads (the component people ask
  // about most): a representative 45→20 km/h brake, the heat it dumps, and
  // how the bike's descent + braking add up to the multiplier.
  const totDescentM = Math.round(aggVals.descPerKm * totKm);
  const totBrakes   = Math.round(aggVals.brakePerKm * totKm);
  const oneBrakeKJ  = +(0.5 * MASS_KG * ((45 / 3.6) ** 2 - (20 / 3.6) ** 2) / 1000).toFixed(1);
  const padExample =
    `Un freinage type de 45 à 20 km/h dissipe ~${oneBrakeKJ.toLocaleString('fr-FR')} kJ de chaleur dans tes freins `
    + `(½ × ${MASS_KG} kg × (12,5² − 5,6²)). Sur ${rides.length} sorties tu as descendu ${totDescentM.toLocaleString('fr-FR')} m `
    + `de dénivelé et donné ${totBrakes} freinages appuyés, bien plus qu'un rouleur de terrain mixte. `
    + `Tes plaquettes encaissent donc ${agg.brake_pads.toFixed(1)}× la charge d'un parcours de référence : ${Math.round(totKm).toLocaleString('fr-FR')} km roulés `
    + `= ${Math.round(totKm * agg.brake_pads).toLocaleString('fr-FR')} km d'usure équivalente. Sur du plat pur, où tu ne freinerais presque pas, le même jeu durerait largement plus que les 1000 km annoncés.`;

  const components = (Object.keys(COMPONENT_LABEL) as ComponentKey[]).map(c => ({
    key: c,
    label: COMPONENT_LABEL[c],
    multiplier: agg[c],
    breakdown: breakdownFor(c, aggVals),
    example: c === 'brake_pads' ? padExample : null,
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
    // Effective km = raw km × the bike's terrain multiplier for this part.
    // Keeps the piece exactly consistent with the displayed × and breakdown:
    // adjustedWear = rawWear × multiplier, no hidden per-ride re-weighting.
    const effKm = rawKm * agg[comp];
    const lifetime = Number(e.lifetime_km ?? 0);
    return [{
      id: e.id, name: e.name, kind: e.kind, component: comp,
      multiplier: agg[comp],
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
