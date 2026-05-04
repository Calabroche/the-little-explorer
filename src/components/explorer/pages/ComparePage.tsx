'use client';

import { useState, useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { tokens, Activity } from '../tokens';
import { SectionTag, Label, useIsMobile } from '../ui';
import { useT, formatDateLocale } from '@/i18n';
import { formatPace } from '@/utils/format';

// ── Helpers ────────────────────────────────────────────────────────────────

// Constants for client-side power estimation (mirrors src/app/api/activities/route.ts)
const MASS = 74.18, G = 9.81, CRR = 0.004, CDA = 0.3, RHO = 1.225;
const Fr = MASS * G * CRR;

function powerAt(speedKmh: number, gradient: number): number {
  const v  = speedKmh / 3.6;
  const Fg = MASS * G * gradient;
  const Fa = 0.5 * RHO * CDA * v * v;
  return Math.max(0, Math.round((Fg + Fr + Fa) * v));
}

interface DistPoint {
  km:     number;
  hrA:    number | null; hrB:    number | null;
  speedA: number | null; speedB: number | null;
  altA:   number | null; altB:   number | null;
  pwrA:   number | null; pwrB:   number | null;
  paceA:  number | null; paceB:  number | null; // sec/km, instantaneous
}

// Sample a 1-Hz stream at fixed-distance buckets (every STEP_KM along the
// ride). Returns one value per bucket — null when the ride didn't reach that
// distance, or when the stream is missing entirely.
function sampleByDistance(
  stream: number[],
  dist: number[],
  N: number,
  stepKm: number,
): (number | null)[] {
  if (stream.length === 0 || dist.length === 0) return new Array(N).fill(null);
  const out: (number | null)[] = new Array(N).fill(null);
  let idx = 0;
  for (let i = 0; i < N; i++) {
    const targetM = i * stepKm * 1000;
    while (idx < dist.length - 1 && dist[idx] < targetM) idx++;
    out[i] = idx < stream.length ? stream[idx] : null;
  }
  return out;
}

function buildOverlay(a: Activity | null, b: Activity | null): DistPoint[] {
  if (!a || !b) return [];
  const maxKm = Math.max(a.distance, b.distance);
  // Cap to ~200 buckets so the chart stays performant on long rides.
  const stepKm = Math.max(0.1, +(maxKm / 200).toFixed(2));
  const N = Math.ceil(maxKm / stepKm) + 1;

  const sampleAct = (act: Activity) => {
    const dist = act.distance_m ?? [];
    return {
      hr:    sampleByDistance(act.heartrate ?? [], dist, N, stepKm),
      speed: sampleByDistance(act.speed_kmh ?? [], dist, N, stepKm),
      alt:   sampleByDistance(act.altitude  ?? [], dist, N, stepKm),
      // Compute gradient at each bucket so we can derive power for cycling
      // and a smoothed pace for running.
      grad:  computeGradient(act.altitude ?? [], dist, N, stepKm),
    };
  };
  const A = sampleAct(a);
  const B = sampleAct(b);

  const isRunningPair = a.type === 'running' || b.type === 'running';

  const out: DistPoint[] = [];
  for (let i = 0; i < N; i++) {
    const km = +(i * stepKm).toFixed(2);
    const stillA = km <= a.distance + 0.01;
    const stillB = km <= b.distance + 0.01;
    const hrA    = stillA ? (A.hr[i]    as number | null) : null;
    const hrB    = stillB ? (B.hr[i]    as number | null) : null;
    const spA    = stillA ? (A.speed[i] as number | null) : null;
    const spB    = stillB ? (B.speed[i] as number | null) : null;
    const altA   = stillA ? (A.alt[i]   as number | null) : null;
    const altB   = stillB ? (B.alt[i]   as number | null) : null;
    const pwrA = (!isRunningPair && stillA && spA != null) ? powerAt(spA, A.grad[i] / 100) : null;
    const pwrB = (!isRunningPair && stillB && spB != null) ? powerAt(spB, B.grad[i] / 100) : null;
    // Pace s/km from instantaneous speed (km/h). Skip zero/very low speeds.
    const paceA = (isRunningPair && stillA && spA != null && spA > 1) ? Math.round(3600 / spA) : null;
    const paceB = (isRunningPair && stillB && spB != null && spB > 1) ? Math.round(3600 / spB) : null;
    out.push({ km, hrA, hrB, speedA: spA, speedB: spB, altA, altB, pwrA, pwrB, paceA, paceB });
  }
  return out;
}

function computeGradient(altitude: number[], dist: number[], N: number, stepKm: number): number[] {
  const out = new Array(N).fill(0);
  if (altitude.length < 5 || dist.length < 5) return out;
  let idx = 0;
  for (let i = 0; i < N; i++) {
    const targetM = i * stepKm * 1000;
    while (idx < dist.length - 1 && dist[idx] < targetM) idx++;
    // 60-sample window (about 60s) to smooth out altitude noise.
    const lo = Math.max(0, idx - 30);
    const hi = Math.min(altitude.length - 1, idx + 30);
    const dAlt  = altitude[hi] - altitude[lo];
    const dDist = (dist[hi] ?? 0) - (dist[lo] ?? 0);
    out[i] = dDist > 5 ? Math.max(-25, Math.min(25, +((dAlt / dDist) * 100).toFixed(1))) : 0;
  }
  return out;
}

function StatRow({ label, va, vb, unit, color }: {
  label: string; va: string | number | null | undefined; vb: string | number | null | undefined; unit?: string; color?: string;
}) {
  if (va == null && vb == null) return null;
  const dispA = va != null ? `${va}${unit ? ' ' + unit : ''}` : '—';
  const dispB = vb != null ? `${vb}${unit ? ' ' + unit : ''}` : '—';
  let delta: string | null = null;
  if (typeof va === 'number' && typeof vb === 'number') {
    const d = vb - va;
    if (Math.abs(d) > 0.01) delta = (d > 0 ? '+' : '') + (Math.abs(d) >= 10 ? Math.round(d) : d.toFixed(1));
  }
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '1fr 60px 1fr 60px',
      alignItems: 'center', padding: '8px 0', borderBottom: `1px solid ${tokens.creamBorder}`,
      fontFamily: "'Space Grotesk'", fontSize: 12,
    }}>
      <span style={{ color: tokens.terra, fontFamily: "'Playfair Display'", fontSize: 17, fontWeight: 700 }}>{dispA}</span>
      <Label style={{ textAlign: 'center', color: color ?? tokens.inkLight }}>{label}</Label>
      <span style={{ color: tokens.green, fontFamily: "'Playfair Display'", fontSize: 17, fontWeight: 700, textAlign: 'right' }}>{dispB}</span>
      <span style={{ textAlign: 'right', fontSize: 10, color: tokens.inkLight }}>{delta ?? ''}</span>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CompareTooltip({ active, payload, label, unit, format }: any) {
  if (!active || !payload?.length) return null;
  const fmt = format ?? ((v: number) => Math.round(v));
  return (
    <div style={{
      background: tokens.surface, border: `1px solid ${tokens.creamBorder}`,
      borderRadius: 4, padding: '8px 10px',
      fontFamily: "'Space Grotesk'", fontSize: 11, color: tokens.ink,
    }}>
      <div style={{ fontWeight: 700 }}>km {label}</div>
      {payload.map((p: { name: string; value: number; color: string }, i: number) => (
        p.value == null ? null :
        <div key={i} style={{ color: p.color }}>
          {p.name} : <strong>{fmt(p.value)}{unit ?? ''}</strong>
        </div>
      ))}
    </div>
  );
}

interface OverlayChartProps {
  title:    string;
  data:     DistPoint[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  keyA:     keyof DistPoint;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  keyB:     keyof DistPoint;
  nameA:    string;
  nameB:    string;
  unit:     string;
  // For pace : higher = slower. We invert the Y axis so faster (smaller s/km)
  // appears at the top, matching how runners read it.
  reversed?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  format?:   (v: number) => string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  yTickFormatter?: (v: any) => string;
}

function OverlayChart({ title, data, keyA, keyB, nameA, nameB, unit, reversed, format, yTickFormatter }: OverlayChartProps) {
  const CARD: React.CSSProperties = {
    background: tokens.surface, border: `1px solid ${tokens.creamBorder}`,
    borderRadius: 4, padding: 24, marginBottom: 16,
  };
  // Skip the chart entirely when neither ride has any data for this metric.
  const hasData = data.some(d => d[keyA] != null || d[keyB] != null);
  return (
    <div style={CARD}>
      <Label style={{ display: 'block', marginBottom: 12 }}>{title}</Label>
      {!hasData ? (
        <div style={{ fontFamily: "'Space Grotesk'", fontSize: 11, color: tokens.inkLight, padding: 8 }}>
          Pas de données pour cette métrique.
        </div>
      ) : (
        <div style={{ width: '100%', height: 220 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={tokens.creamBorder} />
              <XAxis dataKey="km" type="number" domain={[0, 'dataMax']}
                tick={{ fontFamily: "'Space Grotesk'", fontSize: 10, fill: tokens.inkLight }}
                tickFormatter={v => `${v} km`}
                tickLine={false}
              />
              <YAxis width={48}
                tick={{ fontFamily: "'Space Grotesk'", fontSize: 10, fill: tokens.inkLight }}
                tickLine={false} axisLine={false}
                domain={['auto', 'auto']}
                reversed={reversed}
                tickFormatter={yTickFormatter ?? (v => `${v}`)}
              />
              <Tooltip content={<CompareTooltip unit={unit} format={format} />} />
              <Legend wrapperStyle={{ fontFamily: "'Space Grotesk'", fontSize: 10, color: tokens.inkLight }} />
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              <Line type="monotone" dataKey={keyA as any} name={nameA} stroke={tokens.terra} strokeWidth={2} dot={false} connectNulls={false} />
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              <Line type="monotone" dataKey={keyB as any} name={nameB} stroke={tokens.green} strokeWidth={2} dot={false} connectNulls={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

export function ComparePage({ activities }: { activities: Activity[] }) {
  const isMobile = useIsMobile();
  const { t, lang } = useT();
  const [idA, setIdA] = useState<number | null>(activities[0]?.id ?? null);
  const [idB, setIdB] = useState<number | null>(activities[1]?.id ?? null);

  const a = useMemo(() => activities.find(x => x.id === idA) ?? null, [activities, idA]);
  const b = useMemo(() => activities.find(x => x.id === idB) ?? null, [activities, idB]);
  const data = useMemo(() => buildOverlay(a, b), [a, b]);

  const CARD: React.CSSProperties = {
    background: tokens.surface, border: `1px solid ${tokens.creamBorder}`,
    borderRadius: 4, padding: 24, marginBottom: 24,
  };

  const SELECT: React.CSSProperties = {
    width: '100%', padding: '8px 10px',
    border: `1px solid ${tokens.creamBorder}`, borderRadius: 3,
    fontFamily: "'Space Grotesk'", fontSize: 13, color: tokens.ink,
    background: tokens.creamDark,
  };

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '20px 16px' : '32px 40px' }}>
      <SectionTag num={6} title={t('compare.sectionTag')} />
      <h1 style={{
        fontFamily: "'Playfair Display'", fontSize: isMobile ? 28 : 40, fontWeight: 900,
        color: tokens.ink, lineHeight: 1.1, marginBottom: isMobile ? 20 : 32,
      }}>
        {t('compare.headline')}<br />
        <em style={{ color: tokens.terra, fontStyle: 'italic', fontWeight: 700 }}>{t('compare.headlineEm')}</em>
      </h1>

      <div style={CARD}>
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 16 }}>
          <div>
            <Label style={{ display: 'block', marginBottom: 6, color: tokens.terra }}>{t('compare.pickFirst')}</Label>
            <select value={idA ?? ''} onChange={e => setIdA(Number(e.target.value) || null)} style={SELECT}>
              <option value="">{t('compare.pickPlaceholder')}</option>
              {activities.map(x => (
                <option key={x.id} value={x.id}>
                  {formatDateLocale(x.rawDate, lang, { day: '2-digit', month: 'short', year: '2-digit' })} · {x.distance} km · {x.title.slice(0, 40)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label style={{ display: 'block', marginBottom: 6, color: tokens.green }}>{t('compare.pickSecond')}</Label>
            <select value={idB ?? ''} onChange={e => setIdB(Number(e.target.value) || null)} style={SELECT}>
              <option value="">{t('compare.pickPlaceholder')}</option>
              {activities.map(x => (
                <option key={x.id} value={x.id}>
                  {formatDateLocale(x.rawDate, lang, { day: '2-digit', month: 'short', year: '2-digit' })} · {x.distance} km · {x.title.slice(0, 40)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {!a || !b ? (
        <div style={{ ...CARD, fontFamily: "'Space Grotesk'", fontSize: 12, color: tokens.inkLight }}>
          {t('compare.noPick')}
        </div>
      ) : (
        <>
          {/* Stats side-by-side */}
          <div style={CARD}>
            <Label style={{ display: 'block', marginBottom: 14 }}>{t('compare.stats')}</Label>
            <StatRow label={t('analysis.distance')} va={a.distance}    vb={b.distance}    unit="km" />
            <StatRow label={t('analysis.duration')} va={a.duration}    vb={b.duration} />
            <StatRow label={t('analysis.climb')}    va={a.elevation}   vb={b.elevation}   unit="m" />
            {(a.type === 'running' || b.type === 'running')
              ? <StatRow label={t('analysis.pace')} va={formatPace(a.pace_s_per_km)} vb={formatPace(b.pace_s_per_km)} unit="/km" />
              : <StatRow label={t('analysis.avgSpeed')} va={a.speed} vb={b.speed} unit="km/h" />}
            {(a.avg_hr || b.avg_hr) && <StatRow label={t('analysis.hrAvg')} va={a.avg_hr} vb={b.avg_hr} unit="bpm" />}
            {(a.max_hr || b.max_hr) && <StatRow label={t('analysis.hrMax')} va={a.max_hr} vb={b.max_hr} unit="bpm" />}
            {(a.tss != null || b.tss != null) && <StatRow label={t('last5.tss')} va={a.tss} vb={b.tss} />}
            {(a.np  != null || b.np  != null) && <StatRow label={t('metric.npLabel')}  va={a.np}        vb={b.np}        unit="W" />}
            {(a.avg_power != null || b.avg_power != null) && <StatRow label={t('metric.apLabel')} va={a.avg_power} vb={b.avg_power} unit="W" />}
            {(a.if_factor != null || b.if_factor != null) && <StatRow label={t('metric.ifLabel')}  va={a.if_factor} vb={b.if_factor} />}
            {(a.calories  != null || b.calories  != null) && <StatRow label={t('analysis.cal')}    va={a.calories}  vb={b.calories}  unit="kcal" />}
          </div>

          {(() => {
            const isRunning = a.type === 'running' || b.type === 'running';
            const titleA = a.title.slice(0, 30);
            const titleB = b.title.slice(0, 30);
            return (
              <>
                <OverlayChart
                  title="FRÉQUENCE CARDIAQUE (bpm)"
                  data={data} keyA="hrA" keyB="hrB" nameA={titleA} nameB={titleB} unit=" bpm"
                />
                {isRunning ? (
                  <OverlayChart
                    title="ALLURE (min:ss / km)"
                    data={data} keyA="paceA" keyB="paceB" nameA={titleA} nameB={titleB} unit="/km"
                    reversed
                    format={formatPace}
                    yTickFormatter={(v: number) => formatPace(v)}
                  />
                ) : (
                  <OverlayChart
                    title="VITESSE (km/h)"
                    data={data} keyA="speedA" keyB="speedB" nameA={titleA} nameB={titleB} unit=" km/h"
                    format={(v: number) => v.toFixed(1)}
                  />
                )}
                <OverlayChart
                  title="ALTITUDE (m)"
                  data={data} keyA="altA" keyB="altB" nameA={titleA} nameB={titleB} unit=" m"
                />
                {!isRunning && (
                  <OverlayChart
                    title="PUISSANCE ESTIMÉE (W)"
                    data={data} keyA="pwrA" keyB="pwrB" nameA={titleA} nameB={titleB} unit=" W"
                  />
                )}
              </>
            );
          })()}
        </>
      )}
    </div>
  );
}
