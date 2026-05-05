'use client';

import { useState, useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Cell,
} from 'recharts';
import { tokens, Activity } from './tokens';
import { Label, useIsMobile } from './ui';
import { useT, formatDateLocale } from '@/i18n';

// ── Plan algorithm ─────────────────────────────────────────────────────────

type Phase = 'build' | 'deload' | 'taper' | 'race';
type SessionType = 'long' | 'tempo' | 'endurance' | 'recovery';

const SESSION_RATIO: Record<SessionType, number> = {
  long: 0.40, tempo: 0.25, endurance: 0.20, recovery: 0.15,
};

interface SessionPlan { type: SessionType; tss: number; km: number; elev: number; }
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
  sessions:  SessionPlan[];
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
    // Race week is sized directly off the goal: it's the goal day + a
    // short shakeout, NOT a fraction of the peak weekly volume. This
    // makes ultra-short windows (1-2 weeks) sensible — otherwise a
    // 100 km goal would suggest a 64 km race week.
    const isRace = phase === 'race';
    const totalTss  = isRace ? Math.round(goal.oneDayTss * 1.05) : Math.round(baselineTss   * ratio);
    const totalKm   = isRace ? Math.round(goal.km        * 1.05) : Math.round(peakWeeklyKm   * (ratio / peak));
    const totalElev = isRace ? Math.round(goal.elev      * 1.05) : Math.round(peakWeeklyElev * (ratio / peak));
    const sessions: SessionPlan[] = (Object.keys(SESSION_RATIO) as SessionType[]).map(type => ({
      type,
      tss:  Math.round(totalTss  * SESSION_RATIO[type]),
      km:   Math.round(totalKm   * SESSION_RATIO[type]),
      elev: Math.round(totalElev * SESSION_RATIO[type]),
    }));
    return {
      index: i + 1,
      weekStart, weekEnd,
      ratio, phase,
      isPeak: ratio === peak,
      totalTss, totalKm, totalElev,
      sessions,
    };
  });
  return { weeks, tooSteep, peak, totalWeeks };
}

// Compute baseline weekly TSS from last 4 weeks of activities.
function baselineWeeklyTss(activities: Activity[]): { tss: number; hasData: boolean } {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 28);
  const recent = activities.filter(a => new Date(a.rawDate) >= cutoff);
  const total = recent.reduce((s, a) => s + (a.tss ?? 0), 0);
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

export function TrainingPlan({ activities }: { activities: Activity[] }) {
  const { t, lang } = useT();
  const isMobile = useIsMobile();

  // Defaults: prep starts today, target 8 weeks from now.
  const todayIso = new Date().toISOString().slice(0, 10);
  const defaultTarget = (() => {
    const d = new Date(); d.setDate(d.getDate() + 56);
    return d.toISOString().slice(0, 10);
  })();

  const [targetKm,   setTargetKm]   = useState(100);
  const [targetElev, setTargetElev] = useState(1500);
  const [startDate,  setStartDate]  = useState(todayIso);
  const [targetDate, setTargetDate] = useState(defaultTarget);
  const [generated,  setGenerated]  = useState(false);
  const [showInfo,   setShowInfo]   = useState(false);

  const { tss: baselineTss, hasData } = useMemo(() => baselineWeeklyTss(activities), [activities]);

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
    // The "race day" effort itself: a 100 km / 1500 m ride at moderate pace
    // ≈ 250 TSS. We size the peak week to ~2.4× that single-day load so the
    // body is comfortably fatigue-resistant by race week.
    const oneDayTss   = Math.round(targetKm * 2.5 + targetElev * 0.05);
    const peakWeeklyTss  = Math.round(oneDayTss * 2.4);
    const peakWeeklyKm   = Math.round(targetKm   * 1.6);
    const peakWeeklyElev = Math.round(targetElev * 1.5);
    return buildPlan(
      baselineTss, peakWeeklyTss, peakWeeklyKm, peakWeeklyElev,
      new Date(startDate), new Date(targetDate),
      { km: targetKm, elev: targetElev, oneDayTss },
    );
  }, [generated, dateError, baselineTss, targetKm, targetElev, startDate, targetDate]);

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
      <div style={{ fontFamily: "'Space Grotesk'", fontSize: 11, color: tokens.inkLight, marginTop: 8, marginBottom: 20, lineHeight: 1.6 }}>
        {t('plan.intro')}
        <br />
        {hasData ? t('plan.baseline', { tss: baselineTss }) : t('plan.baselineFb')}
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
          <input type="range" min={20} max={200} step={5} value={targetKm}
            onChange={e => setTargetKm(+e.target.value)} style={SLIDER} />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: "'Space Grotesk'", fontSize: 9, color: tokens.inkLight }}>
            <span>20 km</span><span>200 km</span>
          </div>
        </div>
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

                {/* Sessions */}
                <div style={{ flex: 1, display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: isMobile ? 'flex-start' : 'flex-end' }}>
                  {w.sessions.map(s => (
                    <div key={s.type} style={{
                      padding: '4px 8px', background: tokens.surface, borderRadius: 2,
                      border: `1px solid ${tokens.creamBorder}`,
                      fontFamily: "'Space Grotesk'", fontSize: 10, color: tokens.inkMid,
                    }}>
                      <strong style={{ color: PHASE_COLOR[w.phase] }}>{t(`plan.${s.type}`)}</strong>
                      {' '}— {s.km} km · {s.tss} TSS
                    </div>
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
