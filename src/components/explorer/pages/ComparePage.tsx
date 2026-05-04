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

function decimate<T>(arr: T[], maxPoints: number): T[] {
  if (arr.length <= maxPoints) return arr;
  const step = arr.length / maxPoints;
  const out: T[] = [];
  for (let i = 0; i < maxPoints; i++) out.push(arr[Math.floor(i * step)]);
  return out;
}

interface ChartPoint {
  pct:  number;       // 0..100, % of ride distance
  hrA:  number | null;
  hrB:  number | null;
  pwrA: number | null;
  pwrB: number | null;
}

function buildOverlay(a: Activity | null, b: Activity | null): ChartPoint[] {
  if (!a || !b) return [];
  const N = 180;
  const sample = (act: Activity, key: 'heartrate' | 'speed_kmh') => {
    const arr = act[key] ?? [];
    if (arr.length === 0) return new Array<number | null>(N).fill(null);
    return decimate(arr, N);
  };
  // Power proxy : on n'a pas de stream de puissance dans l'API public → on
  // utilise speed_kmh comme proxy (pour la course, ça donne une "intensité").
  // Pour la vélo, le NP/AP servent mieux mais ils sont scalaires.
  const hrA  = sample(a, 'heartrate');
  const hrB  = sample(b, 'heartrate');
  const spA  = sample(a, 'speed_kmh');
  const spB  = sample(b, 'speed_kmh');
  const out: ChartPoint[] = [];
  for (let i = 0; i < N; i++) {
    out.push({
      pct: +((i / (N - 1)) * 100).toFixed(1),
      hrA:  (hrA[i] as number | null) ?? null,
      hrB:  (hrB[i] as number | null) ?? null,
      pwrA: (spA[i] as number | null) ?? null,
      pwrB: (spB[i] as number | null) ?? null,
    });
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
function CompareTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: tokens.surface, border: `1px solid ${tokens.creamBorder}`,
      borderRadius: 4, padding: '8px 10px',
      fontFamily: "'Space Grotesk'", fontSize: 11, color: tokens.ink,
    }}>
      <div style={{ fontWeight: 700 }}>{label}% of ride</div>
      {payload.map((p: { name: string; value: number; color: string }, i: number) => (
        <div key={i} style={{ color: p.color }}>{p.name} : <strong>{Math.round(p.value)}</strong></div>
      ))}
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

          {/* HR overlay */}
          <div style={CARD}>
            <Label style={{ display: 'block', marginBottom: 14 }}>{t('compare.hrChart')}</Label>
            <div style={{ width: '100%', height: 240 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={tokens.creamBorder} />
                  <XAxis dataKey="pct" type="number" domain={[0, 100]}
                    tick={{ fontFamily: "'Space Grotesk'", fontSize: 10, fill: tokens.inkLight }}
                    tickFormatter={v => `${v}%`}
                    tickLine={false}
                  />
                  <YAxis width={40}
                    tick={{ fontFamily: "'Space Grotesk'", fontSize: 10, fill: tokens.inkLight }}
                    tickLine={false} axisLine={false}
                    domain={['auto', 'auto']}
                    tickFormatter={v => `${v}`}
                  />
                  <Tooltip content={<CompareTooltip />} />
                  <Legend wrapperStyle={{ fontFamily: "'Space Grotesk'", fontSize: 10, color: tokens.inkLight }} />
                  <Line type="monotone" dataKey="hrA" name={a.title.slice(0, 30)} stroke={tokens.terra} strokeWidth={2} dot={false} connectNulls />
                  <Line type="monotone" dataKey="hrB" name={b.title.slice(0, 30)} stroke={tokens.green} strokeWidth={2} dot={false} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Speed overlay (proxy for power since the API doesn't ship the power stream) */}
          <div style={CARD}>
            <Label style={{ display: 'block', marginBottom: 14 }}>{t('compare.pwrChart')}</Label>
            <div style={{ width: '100%', height: 240 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={tokens.creamBorder} />
                  <XAxis dataKey="pct" type="number" domain={[0, 100]}
                    tick={{ fontFamily: "'Space Grotesk'", fontSize: 10, fill: tokens.inkLight }}
                    tickFormatter={v => `${v}%`}
                    tickLine={false}
                  />
                  <YAxis width={40}
                    tick={{ fontFamily: "'Space Grotesk'", fontSize: 10, fill: tokens.inkLight }}
                    tickLine={false} axisLine={false}
                    domain={['auto', 'auto']}
                    tickFormatter={v => `${v}`}
                  />
                  <Tooltip content={<CompareTooltip />} />
                  <Legend wrapperStyle={{ fontFamily: "'Space Grotesk'", fontSize: 10, color: tokens.inkLight }} />
                  <Line type="monotone" dataKey="pwrA" name={a.title.slice(0, 30)} stroke={tokens.terra} strokeWidth={2} dot={false} connectNulls />
                  <Line type="monotone" dataKey="pwrB" name={b.title.slice(0, 30)} stroke={tokens.green} strokeWidth={2} dot={false} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
