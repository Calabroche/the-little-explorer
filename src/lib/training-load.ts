/**
 * CTL / ATL / TSB computation — the "performance management" curves
 * cycling coaches use to decide when to push and when to back off.
 *
 *   CTL ("fitness", Chronic Training Load)   — 42-day weighted TSS
 *   ATL ("fatigue", Acute Training Load)     — 7-day weighted TSS
 *   TSB ("form",    Training Stress Balance) — CTL − ATL
 *
 * Math: exponentially-weighted moving averages.
 *   CTL(today) = CTL(yesterday) + (TSS(today) − CTL(yesterday)) / 42
 *   ATL(today) = ATL(yesterday) + (TSS(today) − ATL(yesterday)) / 7
 *   TSB(today) = CTL(today) − ATL(today)
 *
 * Initial seed: 0 (cold start). After ~3× the time-constant the curve
 * stabilises (so 126 days for CTL to fully warm up); we recommend
 * having at least 6-8 weeks of history for the numbers to mean
 * something.
 *
 * Returns daily series ready to plot. Missing days (no activities)
 * still get a row — the TSS for that day is 0, which is correct: a
 * rest day pulls CTL down very slowly and ATL down faster.
 */

import { Activity } from '@/components/explorer/tokens';

export interface TrainingLoadPoint {
  date:  string;  // YYYY-MM-DD
  tss:   number;  // TSS earned on this day (sum if multiple activities)
  ctl:   number;  // fitness
  atl:   number;  // fatigue
  tsb:   number;  // form (ctl - atl)
}

/**
 * Bucket activities into daily TSS sums, then walk forward day-by-day
 * computing CTL/ATL/TSB. `from` and `to` are ISO date strings
 * (YYYY-MM-DD); if omitted, the window spans from the user's first
 * activity to today.
 */
export function computeTrainingLoad(
  activities: Activity[],
  opts: { from?: string; to?: string } = {},
): TrainingLoadPoint[] {
  if (activities.length === 0) return [];

  // Sort activities by date ascending and bucket by day.
  const sorted = [...activities].sort((a, b) => a.rawDate.localeCompare(b.rawDate));
  const dailyTss = new Map<string, number>();
  for (const a of sorted) {
    if (!a.tss) continue;
    const day = a.rawDate.slice(0, 10);
    dailyTss.set(day, (dailyTss.get(day) ?? 0) + a.tss);
  }

  // Window: from = first activity's day OR user-supplied;
  //         to   = today OR user-supplied.
  const firstDay = sorted[0].rawDate.slice(0, 10);
  const today    = new Date().toISOString().slice(0, 10);
  const from     = opts.from ?? firstDay;
  const to       = opts.to   ?? today;

  // Walk day-by-day. Daily EWMA update: x(n) = x(n-1) + (TSS - x(n-1)) / k.
  // Array-based iteration (not generator) so we compile cleanly on the
  // ES5 target — Next 13 doesn't enable downlevelIteration by default.
  const series: TrainingLoadPoint[] = [];
  let ctl = 0;
  let atl = 0;
  const days = daysBetweenArray(from, to);
  for (let i = 0; i < days.length; i++) {
    const day = days[i];
    const tss = dailyTss.get(day) ?? 0;
    ctl += (tss - ctl) / 42;
    atl += (tss - atl) / 7;
    series.push({
      date: day,
      tss,
      ctl: round1(ctl),
      atl: round1(atl),
      tsb: round1(ctl - atl),
    });
  }
  return series;
}

/**
 * Interpret a TSB value into the coach-recommended action. Buckets
 * follow the standard Coggan zones loosely:
 *   tsb > +25   "too fresh"        — losing fitness, push harder
 *   +5..+25     "fresh, race ready"
 *   -10..+5     "optimal training"
 *   -30..-10    "fatigued, plan recovery"
 *   < -30       "deep fatigue, recovery now"
 */
export interface TsbZone {
  label:        string;
  short:        'fresh' | 'racing' | 'optimal' | 'fatigued' | 'overreach';
  color:        string; // hex
  description:  string;
}

export function tsbZoneFor(tsb: number): TsbZone {
  if (tsb > 25)  return { label: 'Trop frais',          short: 'fresh',     color: '#3B7EA1', description: 'CTL en chute libre — tu peux et tu devrais pousser plus.' };
  if (tsb > 5)   return { label: 'Frais — race-ready',  short: 'racing',    color: '#4CAF50', description: 'Bonne forme, prêt pour un objectif ou une sortie de qualité.' };
  if (tsb > -10) return { label: 'Zone optimale',       short: 'optimal',   color: '#9CCC65', description: 'Entraîné et reposé — sweet spot pour la progression.' };
  if (tsb > -30) return { label: 'Fatigue accumulée',   short: 'fatigued',  color: '#C4602A', description: 'Charge importante — planifie une journée de récup cette semaine.' };
  return                  { label: 'Surcharge — récup', short: 'overreach', color: '#A23838', description: 'TSB < -30, risque de blessure / burnout. Repos complet 2-3 jours.' };
}

// ── Helpers ─────────────────────────────────────────────────────────

function daysBetweenArray(from: string, to: string): string[] {
  const out: string[] = [];
  const start = new Date(`${from}T00:00:00Z`);
  const end   = new Date(`${to}T00:00:00Z`);
  for (const d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
