'use client';

import { useState, useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Cell,
} from 'recharts';
import { tokens, Activity } from './tokens';
import { SportId } from './Sidebar';
import { Label, useIsMobile } from './ui';
import { useT, formatDateLocale } from '@/i18n';

// ── Plan algorithm ─────────────────────────────────────────────────────────

type Phase = 'build' | 'deload' | 'taper' | 'race';
type DayType = 'rest' | 'recovery' | 'endurance' | 'tempo' | 'long' | 'openers' | 'goal' | 'outside';

// Distribution of weekly TSS across the four "training" sessions in a normal
// build week. Race week is built day-by-day instead.
const SESSION_RATIO: Record<'long' | 'tempo' | 'endurance' | 'recovery', number> = {
  long: 0.40, tempo: 0.25, endurance: 0.20, recovery: 0.15,
};

// Day-of-week templates: which DayType lands on which dow (0=Mon..6=Sun).
// Empty string = rest. Each template assigns sessions consistent with the
// SESSION_RATIO so the weekly TSS adds up.
const DOW_TEMPLATES: Record<Exclude<Phase, 'race'>, (DayType | 'rest')[]> = {
  build:  ['recovery', 'tempo',     'endurance', 'rest', 'rest', 'long', 'rest'],
  deload: ['recovery', 'endurance', 'rest',      'rest', 'rest', 'long', 'rest'],
  taper:  ['endurance','rest',      'tempo',     'rest', 'rest', 'long', 'rest'],
};

interface DayPlan {
  dow:   number;        // 0=Mon..6=Sun
  date:  Date;
  type:  DayType;
  km:    number;
  elev:  number;
  tss:   number;
}

interface WeekPlan {
  index:     number;       // 1-based for display
  weekStart: Date;
  weekEnd:   Date;
  ratio:     number;
  phase:     Phase;
  isPeak:    boolean;
  totalTss:  number;
  totalKm:   number;
  totalElev: number;
  days:      DayPlan[];    // always 7 entries, including 'outside' if needed
}

// Allocate a session of `share` of the weekly volume to a DayPlan.
function dayFromShare(dow: number, date: Date, type: DayType, share: number, totals: { tss: number; km: number; elev: number }): DayPlan {
  return {
    dow, date, type,
    tss:  Math.round(totals.tss  * share),
    km:   Math.round(totals.km   * share),
    elev: Math.round(totals.elev * share),
  };
}

function shareFor(type: DayType): number {
  if (type === 'long')      return SESSION_RATIO.long;
  if (type === 'tempo')     return SESSION_RATIO.tempo;
  if (type === 'endurance') return SESSION_RATIO.endurance;
  if (type === 'recovery')  return SESSION_RATIO.recovery;
  return 0;
}

// Build the day-by-day plan for a non-race week using the dow template.
function buildBuildishWeek(
  weekStart: Date, phase: Exclude<Phase, 'race'>,
  totals: { tss: number; km: number; elev: number },
  startDate: Date, goalDate: Date,
): DayPlan[] {
  const tpl = DOW_TEMPLATES[phase];
  return Array.from({ length: 7 }, (_, dow) => {
    const date = new Date(weekStart); date.setDate(date.getDate() + dow);
    if (date < startDate || date > goalDate) {
      return { dow, date, type: 'outside' as DayType, tss: 0, km: 0, elev: 0 };
    }
    const t = tpl[dow];
    if (t === 'rest') return { dow, date, type: 'rest', tss: 0, km: 0, elev: 0 };
    return dayFromShare(dow, date, t, shareFor(t as DayType), totals);
  });
}

// Race-week countdown: tailored sessions based on how many days separate the
// day from the goal day. Real-world taper rules:
//   D-0 : goal
//   D-1 : full rest (critical — never train hard the day before)
//   D-2 : openers (short tempo with 3×30s sprints)
//   D-3 : rest or very short shakeout
//   D-4 : recovery (15 min easy)
//   D-5 : short endurance
//   D-6+: rest
// Light volumes are absolute (not % of weekly), since the goal day dominates.
function raceWeekDay(daysToGoal: number): { type: DayType; km: number; elev: number; tss: number } {
  if (daysToGoal === 0) return { type: 'goal',     km: 0,  elev: 0,  tss: 0  }; // overridden below
  if (daysToGoal === 1) return { type: 'rest',     km: 0,  elev: 0,  tss: 0  };
  if (daysToGoal === 2) return { type: 'openers',  km: 8,  elev: 60, tss: 25 };
  if (daysToGoal === 3) return { type: 'recovery', km: 10, elev: 60, tss: 18 };
  if (daysToGoal === 4) return { type: 'rest',     km: 0,  elev: 0,  tss: 0  };
  if (daysToGoal === 5) return { type: 'endurance',km: 18, elev: 130,tss: 40 };
  return { type: 'rest', km: 0, elev: 0, tss: 0 };
}

function buildRaceWeek(
  weekStart: Date, goalDate: Date, goal: { km: number; elev: number; oneDayTss: number },
  startDate: Date,
): DayPlan[] {
  return Array.from({ length: 7 }, (_, dow) => {
    const date = new Date(weekStart); date.setDate(date.getDate() + dow);
    if (date < startDate || date > goalDate) {
      return { dow, date, type: 'outside' as DayType, tss: 0, km: 0, elev: 0 };
    }
    const daysToGoal = Math.round((goalDate.getTime() - date.getTime()) / 86400000);
    if (daysToGoal === 0) {
      return { dow, date, type: 'goal', tss: goal.oneDayTss, km: goal.km, elev: goal.elev };
    }
    const { type, km, elev, tss } = raceWeekDay(daysToGoal);
    return { dow, date, type, tss, km, elev };
  });
}

function startOfMonday(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  const dow = (out.getDay() + 6) % 7;
  out.setDate(out.getDate() - dow);
  return out;
}

// Build a load-multiplier per week, adapted to the available window:
//   2 weeks  → just taper + race (impossible to build)
//   3 weeks  → 1 build + taper + race
//   4 weeks  → 2 build + taper + race
//   5 weeks  → 3 build (no deload) + taper + race
//   6+ weeks → 3:1 cycles (3 progressive + 1 deload), then taper + race
//
// The progressive ramp tightens or relaxes itself so the peak week reaches
// `targetPeak`. We compute the required step from `targetPeak` and the
// number of progressive weeks. If the step exceeds 1.10 the caller gets a
// `tooSteep` flag back so the UI can warn.
function buildRatios(totalWeeks: number, targetPeak: number): {
  steps: { ratio: number; phase: Phase }[];
  tooSteep: boolean;
  peak: number;
} {
  // Special case: only the race week itself fits in the window.
  if (totalWeeks <= 1) {
    return { steps: [{ ratio: 0.40, phase: 'race' }], tooSteep: true, peak: 0.40 };
  }
  const taperWeeks = totalWeeks >= 3 ? 2 : Math.max(0, totalWeeks - 1);
  const racePresent = totalWeeks >= 2;
  const trainingWeeks = totalWeeks - taperWeeks - (racePresent ? 1 : 0);
  if (trainingWeeks <= 0) {
    // Just taper(s) + race week.
    const out: { ratio: number; phase: Phase }[] = [];
    if (taperWeeks >= 2) out.push({ ratio: 0.85, phase: 'taper' });
    if (taperWeeks >= 1) out.push({ ratio: 0.65, phase: 'taper' });
    if (racePresent)     out.push({ ratio: 0.50, phase: 'race'  });
    return { steps: out, tooSteep: true, peak: 0.85 };
  }

  // Decide whether we have room for a deload pattern. Deload only kicks in
  // at 6+ training weeks; otherwise we ramp straight.
  const useDeloadPattern = trainingWeeks >= 6;
  // How many progressive weeks count toward the peak (deload weeks don't).
  const progressiveCount = useDeloadPattern
    ? trainingWeeks - Math.floor(trainingWeeks / 4)
    : trainingWeeks;
  // Required per-step multiplier: targetPeak ^ (1 / (progressiveCount - 1)).
  const N = Math.max(1, progressiveCount - 1);
  const step = Math.pow(targetPeak, 1 / N);
  const tooSteep = step > 1.105;

  const out: { ratio: number; phase: Phase }[] = [];
  let cur = 1.0;
  let lastProgressive = 1.0;
  for (let i = 0; i < trainingWeeks; i++) {
    const isFourth = (i + 1) % 4 === 0;
    if (useDeloadPattern && isFourth && i < trainingWeeks - 1) {
      out.push({ ratio: +(lastProgressive * 0.6).toFixed(2), phase: 'deload' });
    } else {
      lastProgressive = cur;
      out.push({ ratio: +cur.toFixed(2), phase: 'build' });
      cur *= step;
    }
  }
  // Taper: scaled relative to the actual peak, not absolute.
  const peak = Math.max(...out.map(o => o.ratio));
  if (taperWeeks >= 2) {
    out.push({ ratio: +(peak * 0.65).toFixed(2), phase: 'taper' });
    out.push({ ratio: +(peak * 0.45).toFixed(2), phase: 'taper' });
  } else if (taperWeeks === 1) {
    out.push({ ratio: +(peak * 0.55).toFixed(2), phase: 'taper' });
  }
  if (racePresent) {
    out.push({ ratio: 0.40, phase: 'race' });
  }
  return { steps: out, tooSteep, peak };
}

function buildPlan(
  baselineTss: number,
  peakWeeklyTss: number,    // absolute TSS we want at peak (drives target ratio)
  peakWeeklyKm: number,
  peakWeeklyElev: number,
  startDate: Date,
  targetDate: Date,
  goal: { km: number; elev: number; oneDayTss: number },
): { weeks: WeekPlan[]; tooSteep: boolean; peak: number; totalWeeks: number } {
  const start = startOfMonday(startDate);
  const targetMonday = startOfMonday(targetDate);
  // Span in calendar weeks (inclusive). Even a single calendar day → 1 week.
  const rawSpan = Math.ceil((targetMonday.getTime() - start.getTime()) / (7 * 86400000)) + 1;
  const totalWeeks = Math.min(24, Math.max(1, rawSpan));
  const targetPeak = Math.max(1.05, peakWeeklyTss / Math.max(baselineTss, 1));
  const { steps, tooSteep, peak } = buildRatios(totalWeeks, targetPeak);

  const weeks = steps.map(({ ratio, phase }, i) => {
    const weekStart = new Date(start);
    weekStart.setDate(start.getDate() + i * 7);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    let days: DayPlan[];
    if (phase === 'race') {
      // Race week is built day-by-day off the goal, never as a fraction of
      // the peak weekly volume — that would put a long ride on the day
      // before the goal, which is wrong taper-wise.
      days = buildRaceWeek(weekStart, targetDate, goal, startDate);
    } else {
      const totals = {
        tss:  Math.round(baselineTss   * ratio),
        km:   Math.round(peakWeeklyKm   * (ratio / peak)),
        elev: Math.round(peakWeeklyElev * (ratio / peak)),
      };
      days = buildBuildishWeek(weekStart, phase, totals, startDate, targetDate);
    }
    // Recompute weekly totals from the actual day plan so partial first/last
    // weeks (out-of-window days) correctly contribute 0.
    const totalTss  = days.reduce((s, d) => s + d.tss,  0);
    const totalKm   = days.reduce((s, d) => s + d.km,   0);
    const totalElev = days.reduce((s, d) => s + d.elev, 0);
    return {
      index: i + 1,
      weekStart, weekEnd,
      ratio, phase,
      isPeak: ratio === peak,
      totalTss, totalKm, totalElev,
      days,
    };
  });
  return { weeks, tooSteep, peak, totalWeeks };
}

// Per-activity training load. Cycling activities carry a power-derived TSS;
// running ones usually don't, so we fall back to a duration-based estimate
// (rTSS proxy) — ~65 load/hour running, ~55 cycling — so a runner's plan
// isn't stuck on the default baseline.
function loadOf(a: Activity, sport: SportId): number {
  if (a.tss != null && a.tss > 0) return a.tss;
  if (a.duration_min && a.duration_min > 0) return (a.duration_min / 60) * (sport === 'running' ? 65 : 55);
  return 0;
}

// Compute baseline weekly TSS from last 4 weeks of activities.
function baselineWeeklyTss(activities: Activity[], sport: SportId): { tss: number; hasData: boolean } {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 28);
  const recent = activities.filter(a => new Date(a.rawDate) >= cutoff);
  const total = recent.reduce((s, a) => s + loadOf(a, sport), 0);
  if (recent.length < 2 || total <= 0) return { tss: 250, hasData: false };
  return { tss: Math.max(150, Math.round(total / 4)), hasData: true };
}

// ── Component ──────────────────────────────────────────────────────────────

const PHASE_COLOR: Record<Phase, string> = {
  build:   tokens.terra,
  deload:  tokens.blue,
  taper:   '#9b6fb5',
  race:    tokens.green,
};

export function TrainingPlan({ activities, initialSport = 'cycling' }: { activities: Activity[]; initialSport?: SportId }) {
  const { t, lang } = useT();
  const isMobile = useIsMobile();

  // Defaults: prep starts today, target 8 weeks from now.
  const todayIso = new Date().toISOString().slice(0, 10);
  const defaultTarget = (() => {
    const d = new Date(); d.setDate(d.getDate() + 56);
    return d.toISOString().slice(0, 10);
  })();

  // Sport picker — drives whether the form shows the cycling inputs
  // (km + D+) or the running inputs (km + target pace). Same plan
  // engine downstream, only the per-sport TSS estimate diverges.
  const [sport,      setSport]      = useState<'cycling' | 'running'>(initialSport === 'running' ? 'running' : 'cycling');
  const [targetKm,   setTargetKm]   = useState(100);
  const [targetElev, setTargetElev] = useState(1500);
  // Running-only target pace expressed in seconds per km. Slider works
  // in seconds so the conversion lives in one place; UI formats back
  // to "5:30 /km".
  const [targetPaceSecPerKm, setTargetPaceSecPerKm] = useState(5 * 60); // 5:00 /km default
  const [startDate,  setStartDate]  = useState(todayIso);
  const [targetDate, setTargetDate] = useState(defaultTarget);
  const [generated,  setGenerated]  = useState(false);
  const [showInfo,   setShowInfo]   = useState(false);

  // Adapt slider extrema + defaults when the user flips sport.
  // Running thresholds are tighter than cycling (a marathon is 42 km,
  // not 200), and elevation isn't surfaced for runners.
  const sportCfg = sport === 'cycling'
    ? { kmMin: 20, kmMax: 200, kmStep: 5,  defaultKm: 100 }
    : { kmMin: 5,  kmMax: 50,  kmStep: 1,  defaultKm: 21 };
  // When the user toggles sport, clamp targetKm into the new range so the
  // slider doesn't visibly snap to a bound mid-render.
  const clampedKm = Math.min(Math.max(targetKm, sportCfg.kmMin), sportCfg.kmMax);
  if (clampedKm !== targetKm) {
    // Will trigger a re-render on the next tick — fine, only happens on toggle.
    queueMicrotask(() => setTargetKm(clampedKm));
  }

  const { tss: baselineTss, hasData } = useMemo(() => baselineWeeklyTss(activities, sport), [activities, sport]);

  const dateError = useMemo(() => {
    if (!generated) return null;
    const start  = new Date(startDate);
    const target = new Date(targetDate);
    if (isNaN(start.getTime()) || isNaN(target.getTime())) return t('plan.invalidDate');
    const diffDays = (target.getTime() - start.getTime()) / 86400000;
    // We allow as little as 2 days (the user has explicitly asked for it).
    // The 'tooSteep' red banner already warns when no real build is possible.
    if (diffDays < 2) return t('plan.invalidDate');
    return null;
  }, [generated, startDate, targetDate, t]);

  const planResult = useMemo(() => {
    if (!generated || dateError) return null;

    // Per-sport "race day" effort estimate (the single-day TSS we ramp
    // the peak week towards).
    let oneDayTss: number;
    let peakWeeklyKm: number;
    let peakWeeklyElev: number;
    let goalElev: number;

    if (sport === 'running') {
      // Running TSS model. Pace 5:00 /km is the reference (~7 TSS/km).
      // Faster pace → higher TSS/km (squared so the curve climbs
      // steeply for sub-4:00 efforts). No elevation target — runners
      // think in pace, not D+.
      const intensity = 300 / Math.max(targetPaceSecPerKm, 180);
      oneDayTss      = Math.round(targetKm * 7 * intensity * intensity);
      peakWeeklyKm   = Math.round(targetKm * 1.4);
      peakWeeklyElev = 0;
      goalElev       = 0;
    } else {
      // Cycling model — the original. 100 km / 1500 m ≈ 250 TSS. We
      // size the peak week to ~2.4× the single-day load.
      oneDayTss      = Math.round(targetKm * 2.5 + targetElev * 0.05);
      peakWeeklyKm   = Math.round(targetKm   * 1.6);
      peakWeeklyElev = Math.round(targetElev * 1.5);
      goalElev       = targetElev;
    }

    const peakWeeklyTss = Math.round(oneDayTss * 2.4);
    return buildPlan(
      baselineTss, peakWeeklyTss, peakWeeklyKm, peakWeeklyElev,
      new Date(startDate), new Date(targetDate),
      { km: targetKm, elev: goalElev, oneDayTss },
    );
  }, [generated, dateError, baselineTss, sport, targetKm, targetElev, targetPaceSecPerKm, startDate, targetDate]);

  const plan = planResult?.weeks ?? [];

  // Chart data : weekly TSS bars.
  const chartData = useMemo(() => plan.map(w => ({
    week:  `S${w.index}`,
    tss:   w.totalTss,
    phase: w.phase,
    color: PHASE_COLOR[w.phase],
  })), [plan]);

  const CARD: React.CSSProperties = {
    background: tokens.surface, border: `1px solid ${tokens.creamBorder}`,
    borderRadius: 4, padding: 24, marginBottom: 32,
  };
  const SLIDER: React.CSSProperties = { width: '100%', accentColor: tokens.terra, cursor: 'pointer' };
  const INPUT: React.CSSProperties = {
    width: '100%', padding: '8px 10px',
    border: `1px solid ${tokens.creamBorder}`, borderRadius: 3,
    fontFamily: "'Space Grotesk'", fontSize: 14, color: tokens.ink,
    background: tokens.creamDark, colorScheme: 'dark',
  };

  return (
    <div style={CARD}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
        <Label style={{ color: tokens.terra }}>{t('plan.tag')}</Label>
        <div style={{ width: 24, height: 1, background: tokens.creamBorder }} />
        <Label>{t('plan.label')}</Label>
        <button
          onClick={() => setShowInfo(s => !s)}
          aria-label={t('plan.howTitle')}
          style={{
            width: 20, height: 20, marginLeft: 6,
            background: showInfo ? tokens.terra : 'transparent',
            color: showInfo ? '#fff' : tokens.inkLight,
            border: `1px solid ${showInfo ? tokens.terra : tokens.creamBorder}`,
            borderRadius: '50%',
            cursor: 'pointer',
            fontFamily: "'Playfair Display'", fontSize: 11, fontWeight: 700, fontStyle: 'italic',
            lineHeight: 1, padding: 0,
          }}
        >i</button>
      </div>

      {showInfo && (
        <div style={{
          marginTop: 12, marginBottom: 16, padding: 16,
          background: tokens.creamDark, borderRadius: 4, borderLeft: `3px solid ${tokens.terra}`,
          fontFamily: "'Space Grotesk'", fontSize: 12, color: tokens.inkMid, lineHeight: 1.7,
        }}>
          <Label style={{ display: 'block', marginBottom: 12, color: tokens.terra }}>{t('plan.howTitle')}</Label>
          {([1, 2, 3, 4, 5, 6, 7] as const).map(n => (
            <div key={n} style={{ marginBottom: 8 }}>
              <strong style={{ color: tokens.ink }}>{t(`plan.how${n}Title`)}</strong> — {t(`plan.how${n}Body`)}
            </div>
          ))}
        </div>
      )}
      <div style={{ fontFamily: "'Playfair Display'", fontSize: isMobile ? 22 : 28, fontWeight: 800, color: tokens.ink, marginTop: 8, lineHeight: 1.1 }}>
        {t('plan.headline')}{' '}
        <em style={{ color: tokens.terra, fontStyle: 'italic', fontWeight: 700 }}>{t('plan.headlineEm')}</em>
      </div>
      <div style={{ fontFamily: "'Space Grotesk'", fontSize: 11, color: tokens.inkLight, marginTop: 8, marginBottom: 16, lineHeight: 1.6 }}>
        {t('plan.intro')}
        <br />
        {hasData ? t('plan.baseline', { tss: baselineTss }) : t('plan.baselineFb')}
      </div>

      {/* Sport selector — flips the form between cycling (km + D+) and
          running (km + pace). The plan engine + week structure stay
          identical; only the single-day TSS estimate changes. */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
        {([
          { v: 'cycling' as const, icon: '🚴', label: 'Vélo' },
          { v: 'running' as const, icon: '🏃', label: 'Course' },
        ]).map(opt => {
          const active = sport === opt.v;
          return (
            <button
              key={opt.v}
              onClick={() => {
                setSport(opt.v);
                // Reset to the per-sport default if we crossed a range
                // boundary, so the slider doesn't start at an awkward
                // value (e.g. 100 km when switching to running).
                if (opt.v === 'running' && targetKm > 50) setTargetKm(21);
                if (opt.v === 'cycling' && targetKm < 20) setTargetKm(100);
                setGenerated(false); // force re-generate after sport switch
              }}
              style={{
                padding: '6px 14px',
                background:   active ? tokens.terra : tokens.creamDark,
                color:        active ? '#fff' : tokens.inkMid,
                border:       `1px solid ${active ? tokens.terra : tokens.creamBorder}`,
                borderRadius: 3,
                cursor:       'pointer',
                fontFamily:   "'Space Grotesk'", fontSize: 11, fontWeight: 700,
                letterSpacing: '0.04em',
                display:      'inline-flex', alignItems: 'center', gap: 6,
              }}
            >
              <span>{opt.icon}</span>
              {opt.label}
            </button>
          );
        })}
      </div>

      {/* Form */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr 1fr' : '1fr 1fr 1fr 1fr',
        gap: 18, marginBottom: 18,
      }}>
        <div style={{ gridColumn: isMobile ? 'span 2' : undefined }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <Label>{t('plan.targetDist')}</Label>
            <span style={{ fontFamily: "'Playfair Display'", fontSize: 22, fontWeight: 700, color: tokens.ink }}>
              {targetKm}<span style={{ fontFamily: "'Space Grotesk'", fontSize: 11, color: tokens.inkLight, marginLeft: 3 }}>km</span>
            </span>
          </div>
          <input type="range" min={sportCfg.kmMin} max={sportCfg.kmMax} step={sportCfg.kmStep} value={targetKm}
            onChange={e => setTargetKm(+e.target.value)} style={SLIDER} />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: "'Space Grotesk'", fontSize: 9, color: tokens.inkLight }}>
            <span>{sportCfg.kmMin} km</span><span>{sportCfg.kmMax} km</span>
          </div>
        </div>

        {/* Second slider: elevation for cycling, pace for running. The
            wrapper div positioning stays identical across modes so the
            grid doesn't shift when the user toggles sport. */}
        {sport === 'cycling' ? (
          <div style={{ gridColumn: isMobile ? 'span 2' : undefined }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <Label>{t('plan.targetElev')}</Label>
              <span style={{ fontFamily: "'Playfair Display'", fontSize: 22, fontWeight: 700, color: tokens.ink }}>
                {targetElev}<span style={{ fontFamily: "'Space Grotesk'", fontSize: 11, color: tokens.inkLight, marginLeft: 3 }}>m</span>
              </span>
            </div>
            <input type="range" min={100} max={4000} step={50} value={targetElev}
              onChange={e => setTargetElev(+e.target.value)} style={SLIDER} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: "'Space Grotesk'", fontSize: 9, color: tokens.inkLight }}>
              <span>100 m</span><span>4000 m</span>
            </div>
          </div>
        ) : (
          <div style={{ gridColumn: isMobile ? 'span 2' : undefined }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <Label>ALLURE CIBLE</Label>
              <span style={{ fontFamily: "'Playfair Display'", fontSize: 22, fontWeight: 700, color: tokens.ink }}>
                {Math.floor(targetPaceSecPerKm / 60)}:{(targetPaceSecPerKm % 60).toString().padStart(2, '0')}
                <span style={{ fontFamily: "'Space Grotesk'", fontSize: 11, color: tokens.inkLight, marginLeft: 3 }}>/km</span>
              </span>
            </div>
            <input type="range" min={210} max={480} step={5} value={targetPaceSecPerKm}
              onChange={e => setTargetPaceSecPerKm(+e.target.value)} style={SLIDER} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: "'Space Grotesk'", fontSize: 9, color: tokens.inkLight }}>
              <span>3:30 /km</span><span>8:00 /km</span>
            </div>
          </div>
        )}
        <div>
          <Label style={{ display: 'block', marginBottom: 6 }}>{t('plan.startDate')}</Label>
          <input type="date" value={startDate}
            max={targetDate}
            onChange={e => setStartDate(e.target.value)} style={INPUT} />
        </div>
        <div>
          <Label style={{ display: 'block', marginBottom: 6 }}>{t('plan.targetDate')}</Label>
          <input type="date" value={targetDate}
            min={new Date(new Date(startDate).getTime() + 2 * 86400e3).toISOString().slice(0, 10)}
            onChange={e => setTargetDate(e.target.value)} style={INPUT} />
        </div>
      </div>

      <button onClick={() => setGenerated(true)} style={{
        width: '100%', padding: '14px 20px', background: tokens.terra,
        color: 'white', border: 'none', borderRadius: 3, cursor: 'pointer',
        fontFamily: "'Space Grotesk'", fontSize: 12, fontWeight: 700, letterSpacing: '0.15em',
      }}>{t('plan.generate')}</button>

      {/* Error */}
      {dateError && (
        <div style={{ marginTop: 12, padding: '10px 14px', background: tokens.creamDark, borderRadius: 3, borderLeft: `3px solid ${tokens.terra}`, fontFamily: "'Space Grotesk'", fontSize: 12, color: tokens.inkMid }}>
          {dateError}
        </div>
      )}

      {/* Plan output */}
      {generated && !dateError && plan.length > 0 && planResult && (
        <div style={{ marginTop: 24 }}>
          {/* Safe-zone / overload banner */}
          <div style={{
            padding: '10px 14px', marginBottom: 14, borderRadius: 3,
            borderLeft: `3px solid ${planResult.tooSteep ? '#cc3333' : tokens.green}`,
            background: tokens.creamDark,
            fontFamily: "'Space Grotesk'", fontSize: 11, color: tokens.inkMid, lineHeight: 1.6,
          }}>
            {planResult.tooSteep
              ? t('plan.tooSteep', { weeks: planResult.totalWeeks })
              : t('plan.okWindow', { weeks: planResult.totalWeeks, peak: planResult.peak.toFixed(2) })}
          </div>

          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
            <Label style={{ color: tokens.green }}>§ {plan.length} {t('plan.results')}</Label>
            <div style={{ flex: 1, height: 1, background: tokens.creamBorder }} />
            <span style={{ fontFamily: "'Space Grotesk'", fontSize: 10, color: tokens.inkLight }}>
              {t('plan.target')} : {t('plan.targetSummary', { km: targetKm, elev: targetElev, date: formatDateLocale(targetDate, lang, { day: 'numeric', month: 'long', year: 'numeric' }) })}
            </span>
          </div>

          {/* TSS progression chart */}
          <div style={{ width: '100%', height: 160, marginBottom: 18 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 8, right: 4, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={tokens.creamBorder} vertical={false} />
                <XAxis dataKey="week" tick={{ fontFamily: "'Space Grotesk'", fontSize: 10, fill: tokens.inkLight }} tickLine={false} axisLine={{ stroke: tokens.creamBorder }} />
                <YAxis width={36} tick={{ fontFamily: "'Space Grotesk'", fontSize: 10, fill: tokens.inkLight }} tickLine={false} axisLine={false} />
                <Tooltip
                  cursor={{ fill: tokens.creamBorder, opacity: 0.4 }}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  content={({ active, payload, label }: any) => {
                    if (!active || !payload?.length) return null;
                    const p = payload[0].payload;
                    return (
                      <div style={{ background: tokens.surface, border: `1px solid ${tokens.creamBorder}`, padding: '8px 10px', borderRadius: 3, fontFamily: "'Space Grotesk'", fontSize: 11 }}>
                        <div style={{ fontWeight: 700, color: tokens.ink }}>{label}</div>
                        <div style={{ color: p.color }}>{t(`plan.${p.phase}`)}</div>
                        <div>TSS: <strong>{p.tss}</strong></div>
                      </div>
                    );
                  }}
                />
                <ReferenceLine y={baselineTss} stroke={tokens.inkLight} strokeDasharray="4 4" strokeOpacity={0.5} />
                <Bar dataKey="tss" radius={[3, 3, 0, 0]}>
                  {chartData.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Weeks list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {plan.map(w => (
              <div key={w.index} style={{
                display: 'flex', flexDirection: isMobile ? 'column' : 'row',
                alignItems: isMobile ? 'stretch' : 'center', gap: 12,
                padding: '12px 14px', background: tokens.creamDark, borderRadius: 3,
                borderLeft: `4px solid ${PHASE_COLOR[w.phase]}`,
              }}>
                <div style={{ minWidth: isMobile ? undefined : 130 }}>
                  <div style={{ fontFamily: "'Playfair Display'", fontSize: 16, fontWeight: 700, color: tokens.ink, lineHeight: 1.1 }}>
                    {t('plan.week', { n: w.index })}
                    {w.isPeak && <span style={{ marginLeft: 6, padding: '1px 6px', background: tokens.terra, color: '#fff', fontFamily: "'Space Grotesk'", fontSize: 8, fontWeight: 700, letterSpacing: '0.1em', borderRadius: 2 }}>{t('plan.peak').toUpperCase()}</span>}
                  </div>
                  <div style={{ fontFamily: "'Space Grotesk'", fontSize: 9, color: tokens.inkLight, marginTop: 2 }}>
                    {formatDateLocale(w.weekStart.toISOString(), lang, { day: 'numeric', month: 'short' })}
                    {' → '}
                    {formatDateLocale(w.weekEnd.toISOString(),   lang, { day: 'numeric', month: 'short' })}
                  </div>
                  <div style={{ marginTop: 4, fontFamily: "'Space Grotesk'", fontSize: 9, color: PHASE_COLOR[w.phase], fontWeight: 700, letterSpacing: '0.05em' }}>
                    {t(`plan.${w.phase}`).toUpperCase()}
                  </div>
                </div>

                {/* Volume summary */}
                <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                  <Stat label={t('plan.tssWeekly')}  value={w.totalTss}  unit="" color={PHASE_COLOR[w.phase]} />
                  <Stat label={t('plan.kmWeekly')}   value={w.totalKm}   unit="km" />
                  <Stat label={t('plan.elevWeekly')} value={w.totalElev} unit="m" />
                </div>

                {/* 7-day grid */}
                <div style={{
                  flex: 1, display: 'grid',
                  gridTemplateColumns: 'repeat(7, 1fr)', gap: 4,
                  minWidth: isMobile ? 0 : 380,
                }}>
                  {w.days.map(d => (
                    <DayCell key={d.dow} day={d} phase={w.phase} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, unit, color }: { label: string; value: number; unit: string; color?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Label>{label}</Label>
      <span style={{ fontFamily: "'Playfair Display'", fontSize: 16, fontWeight: 700, color: color ?? tokens.ink }}>
        {value}<span style={{ fontFamily: "'Space Grotesk'", fontSize: 9, color: tokens.inkLight, marginLeft: 2 }}>{unit}</span>
      </span>
    </div>
  );
}

const DAY_TYPE_COLOR: Record<DayType, string> = {
  goal:      tokens.green,
  long:      tokens.terra,
  tempo:     '#c4602a',
  endurance: tokens.blue,
  recovery:  '#9b6fb5',
  openers:   '#e07030',
  rest:      tokens.inkLight,
  outside:   tokens.creamBorder,
};

const DAY_TYPE_LABEL: Record<DayType, string> = {
  goal:      'plan.goalDay',
  long:      'plan.long',
  tempo:     'plan.tempo',
  endurance: 'plan.endurance',
  recovery:  'plan.recovery',
  openers:   'plan.openers',
  rest:      'plan.restDay',
  outside:   'plan.outside',
};

const DAY_LETTERS: Record<'fr' | 'en', string[]> = {
  fr: ['L', 'M', 'M', 'J', 'V', 'S', 'D'],
  en: ['M', 'T', 'W', 'T', 'F', 'S', 'S'],
};

function DayCell({ day, phase }: { day: DayPlan; phase: Phase }) {
  const { t, lang } = useT();
  const dowLetter = DAY_LETTERS[lang][day.dow];
  const isOutside = day.type === 'outside';
  const isRest    = day.type === 'rest';
  const color     = DAY_TYPE_COLOR[day.type];
  return (
    <div title={day.date.toLocaleDateString(lang === 'en' ? 'en-US' : 'fr-FR', { weekday: 'long', day: 'numeric', month: 'short' })}
      style={{
        padding: '6px 4px',
        background: isOutside ? 'transparent' : tokens.surface,
        border: `1px solid ${isOutside ? 'transparent' : tokens.creamBorder}`,
        borderTop: isOutside ? `1px solid transparent` : `2px solid ${color}`,
        borderRadius: 2,
        fontFamily: "'Space Grotesk'", fontSize: 9,
        textAlign: 'center', minHeight: 56,
        opacity: isOutside ? 0.25 : 1,
      }}>
      <div style={{ color: isOutside ? tokens.inkLight : tokens.inkLight, fontWeight: 700, marginBottom: 2 }}>{dowLetter}</div>
      <div style={{ color: isOutside ? tokens.inkLight : color, fontWeight: 700, marginBottom: 2 }}>
        {isOutside ? '—' : t(DAY_TYPE_LABEL[day.type])}
      </div>
      {!isOutside && !isRest && (
        <>
          <div style={{ color: tokens.ink, fontFamily: "'Playfair Display'", fontSize: 11, fontWeight: 700, lineHeight: 1 }}>
            {day.km > 0 ? `${day.km}km` : ''}
          </div>
          <div style={{ color: tokens.inkLight, marginTop: 1 }}>{day.tss} TSS</div>
        </>
      )}
      {/* Force the phase color as a faint hint when phase color differs from session color */}
      {!isOutside && phase === 'race' && day.type === 'goal' && (
        <div style={{ marginTop: 2, fontSize: 8, color: tokens.green, fontWeight: 700 }}>★</div>
      )}
    </div>
  );
}
