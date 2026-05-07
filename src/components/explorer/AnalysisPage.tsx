'use client';

import { useState, useMemo, useEffect } from 'react';
import dynamic from 'next/dynamic';
import {
  ComposedChart, AreaChart, Area, Bar, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { Activity, tokens } from './tokens';
import { Label, TypeBadge, StatChip, useIsMobile } from './ui';
import { useT, formatDateLocale } from '@/i18n';
import { formatPace } from '@/utils/format';

const ActivityRouteMap = dynamic(
  () => import('./ActivityRouteMap').then(m => m.ActivityRouteMap),
  { ssr: false }
);

// ── Weather translation helper ───────────────────────────────────────────────
const WEATHER_KEY_MAP: Record<string, string> = {
  'Ensoleillé': 'sunny', 'Nuageux': 'cloudy', 'Brouillard': 'fog',
  'Pluie': 'rain', 'Neige': 'snow', 'Averses': 'showers', 'Orage': 'storm',
};
function translateWeather(desc: string, t: (k: string) => string): string {
  const k = WEATHER_KEY_MAP[desc];
  return k ? t(`weather.${k}`) : desc;
}

// ── Constants ─────────────────────────────────────────────────────────────────

// Fallbacks if activity doesn't carry the per-user profile (legacy data).
const FALLBACK_MASS = 74.18; // Florian: 66 kg rider + 8.18 kg bike
const FALLBACK_RIDER_KG = 66;
const G = 9.81, CRR = 0.004, CDA = 0.3, RHO = 1.225;
const FTP_FALLBACK = 291;

// ── Data prep ────────────────────────────────────────────────────────────────

function buildChartData(activity: Activity) {
  const { heartrate = [], altitude = [], distance_m = [], speed_kmh = [] } = activity;
  const len = Math.min(heartrate.length, altitude.length, distance_m.length, speed_kmh.length);
  if (len < 10) return [];

  const mass = activity.total_mass ?? FALLBACK_MASS;
  const Fr   = +(mass * G * CRR).toFixed(1);

  const WINDOW = 40;
  const gradient: number[] = new Array(len).fill(0);
  for (let i = WINDOW; i < len - WINDOW; i++) {
    const dAlt  = altitude[i + WINDOW] - altitude[i - WINDOW];
    const dDist = distance_m[i + WINDOW] - distance_m[i - WINDOW];
    if (dDist >= 20) gradient[i] = Math.max(-25, Math.min(25, +((dAlt / dDist) * 100).toFixed(1)));
  }

  const power: number[]  = new Array(len).fill(0);
  const Fg_arr: number[] = new Array(len).fill(0);
  const Fa_arr: number[] = new Array(len).fill(0);
  for (let i = 0; i < len; i++) {
    const v  = (speed_kmh[i] || 0) / 3.6;
    const gr = gradient[i] / 100;
    const Fg = mass * G * gr;
    const Fa = 0.5 * RHO * CDA * v * v;
    Fg_arr[i] = +Fg.toFixed(1);
    Fa_arr[i] = +Fa.toFixed(1);
    power[i]  = Math.max(0, Math.round((Fg + Fr + Fa) * v));
  }

  const step = Math.max(1, Math.floor(len / 300));
  const data = [];
  for (let i = 0; i < len; i += step) {
    const g   = gradient[i];
    const v_ms = +((speed_kmh[i] || 0) / 3.6).toFixed(2);
    data.push({
      dist:     +(distance_m[i] / 1000).toFixed(2),
      hr:       heartrate[i] || null,
      gradient: g,
      gradUp:   g > 0 ? g : 0,
      gradDown: g < 0 ? g : 0,
      altitude: altitude[i] != null ? +altitude[i].toFixed(0) : null,
      speed:    speed_kmh[i] != null ? +speed_kmh[i].toFixed(1) : null,
      power:    power[i],
      Fg:       Fg_arr[i],
      Fr,
      mass,
      Fa:       Fa_arr[i],
      v_ms,
    });
  }
  return data;
}

// ── Sub-components ────────────────────────────────────────────────────────────

const CARD_STYLE: React.CSSProperties = {
  background: tokens.surface, border: `1px solid ${tokens.creamBorder}`, borderRadius: 4, padding: 20,
};

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={CARD_STYLE}>
      <Label style={{ display: 'block', marginBottom: 14 }}>{title}</Label>
      {children}
    </div>
  );
}

function VO2MaxCard({ activity }: { activity: Activity }) {
  const [hrRest, setHrRest] = useState(60);
  const hrMax = activity.max_hr ?? null;
  const vo2   = hrMax ? +(15 * (hrMax / hrRest)).toFixed(1) : null;

  const zone = vo2
    ? vo2 >= 55 ? { label: 'Excellent', color: tokens.green }
    : vo2 >= 45 ? { label: 'Bon',       color: tokens.blue  }
    : vo2 >= 35 ? { label: 'Moyen',     color: tokens.terra }
    :              { label: 'Faible',   color: tokens.inkLight }
    : null;

  return (
    <div style={{ ...CARD_STYLE, flex: 1 }}>
      <Label style={{ display: 'block', marginBottom: 14 }}>VO₂ MAX ESTIMÉ</Label>
      <div style={{ fontFamily: "'Playfair Display'", fontSize: 48, fontWeight: 900, color: tokens.ink, lineHeight: 1 }}>
        {vo2 ?? '—'}
      </div>
      <div style={{ fontFamily: "'Space Grotesk'", fontSize: 12, color: tokens.inkLight, marginBottom: 14 }}>ml/kg/min</div>
      {zone && (
        <div style={{ display: 'inline-block', background: zone.color, color: 'white', padding: '3px 10px', borderRadius: 2, fontFamily: "'Space Grotesk'", fontSize: 11, letterSpacing: '0.08em', marginBottom: 14 }}>
          {zone.label.toUpperCase()}
        </div>
      )}
      <div style={{ marginTop: 10 }}>
        <Label style={{ display: 'block', marginBottom: 6 }}>FC REPOS (bpm)</Label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="range" min={40} max={90} value={hrRest} onChange={e => setHrRest(+e.target.value)} style={{ flex: 1, accentColor: tokens.terra }} />
          <span style={{ fontFamily: "'Playfair Display'", fontSize: 18, fontWeight: 700, color: tokens.ink, minWidth: 32 }}>{hrRest}</span>
        </div>
      </div>
      <div style={{ marginTop: 12, fontFamily: "'Space Grotesk'", fontSize: 11, color: tokens.inkLight, lineHeight: 1.6 }}>
        Formule : 15 × (FC max / FC repos)<br />
        FC max mesurée : {hrMax ?? '—'} bpm
      </div>
    </div>
  );
}

function PowerCard({ activity, data }: { activity: Activity; data: ReturnType<typeof buildChartData> }) {
  const { t } = useT();
  const avgPower  = data.length ? Math.round(data.reduce((s, d) => s + (d.power || 0), 0) / data.length) : 0;
  const maxPower  = data.length ? Math.max(...data.map(d => d.power || 0)) : 0;
  const totalWork = avgPower * (activity.duration_min ?? 0) * 60 / 1000;

  // Per-user physics constants (rider + bike). Falls back to Florian's profile.
  const rider = activity.rider_kg  ?? FALLBACK_RIDER_KG;
  const total = activity.total_mass ?? FALLBACK_MASS;
  const bike  = +(total - rider).toFixed(2);
  const Fr    = +(total * G * CRR).toFixed(1);

  return (
    <div style={{ ...CARD_STYLE, flex: 1 }}>
      <Label style={{ display: 'block', marginBottom: 14 }}>{t('charts.powerEstHeader')}</Label>
      <div style={{ fontFamily: "'Playfair Display'", fontSize: 48, fontWeight: 900, color: tokens.ink, lineHeight: 1 }}>
        {avgPower}
      </div>
      <div style={{ fontFamily: "'Space Grotesk'", fontSize: 12, color: tokens.inkLight, marginBottom: 18 }}>watts moyens</div>
      <div style={{ display: 'flex', gap: 0, borderTop: `1px solid ${tokens.creamBorder}`, paddingTop: 14 }}>
        <StatChip label={t('metric.maxLabel')} value={maxPower} unit="W" />
        <StatChip label={t('metric.totalWork')} value={Math.round(totalWork)} unit="kJ" />
      </div>
      <div style={{ marginTop: 14, fontFamily: "'Space Grotesk'", fontSize: 11, color: tokens.inkLight, lineHeight: 1.8 }}>
        <strong style={{ color: tokens.ink }}>Formule :</strong> P = (F_gravité + F_roulement + F_aéro) × v<br />
        <strong style={{ color: tokens.ink }}>Coureur :</strong> {rider} kg · Vélo : {bike} kg · <strong style={{ color: tokens.ink }}>Total : {total} kg</strong><br />
        <span style={{ color: tokens.terra }}>F_roulement</span> = {total} × 9.81 × 0.004 = <strong>{Fr} N</strong> (constant)<br />
        <span style={{ color: tokens.terra }}>F_gravité</span> = {total} × 9.81 × pente → varie<br />
        <span style={{ color: tokens.terra }}>F_aéro</span> = 0.5 × 1.225 × 0.3 × v² → varie
      </div>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: tokens.surface, border: `1px solid ${tokens.creamBorder}`, borderRadius: 4, padding: '8px 14px', fontFamily: "'Space Grotesk'", fontSize: 11 }}>
      <div style={{ color: tokens.inkLight, marginBottom: 4 }}>{label} km</div>
      {payload.map((p: { name: string; value: number; color: string }, i: number) => (
        <div key={i} style={{ color: p.color, marginBottom: 2 }}>{p.name} : <strong>{p.value}</strong></div>
      ))}
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function PowerTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  return (
    <div style={{ background: tokens.surface, border: `1px solid ${tokens.creamBorder}`, borderRadius: 4, padding: '10px 14px', fontFamily: "'Space Grotesk'", fontSize: 11, lineHeight: 1.8, minWidth: 220 }}>
      <div style={{ color: tokens.inkLight, marginBottom: 6, fontWeight: 600 }}>{label} km</div>
      <div><span style={{ color: tokens.terra }}>F_gravité</span> = {d.mass} × 9.81 × {(d.gradient/100).toFixed(3)} = <strong>{d.Fg} N</strong></div>
      <div><span style={{ color: tokens.terra }}>F_roulement</span> = {d.mass} × 9.81 × 0.004 = <strong>{d.Fr} N</strong></div>
      <div><span style={{ color: tokens.terra }}>F_aéro</span> = ½ × 1.225 × 0.3 × {d.v_ms}² = <strong>{d.Fa} N</strong></div>
      <div style={{ borderTop: `1px solid ${tokens.creamBorder}`, marginTop: 6, paddingTop: 6 }}>
        <strong>P = ({d.Fg} + {d.Fr} + {d.Fa}) × {d.v_ms} = </strong>
        <span style={{ color: tokens.green, fontWeight: 700 }}>{d.power} W</span>
      </div>
    </div>
  );
}

// ── Formula tooltip ───────────────────────────────────────────────────────────

function FormulaBox({ lines }: { lines: string[] }) {
  return (
    <div style={{
      marginTop: 6, padding: '8px 12px', background: tokens.creamDark,
      borderRadius: 3, borderLeft: `3px solid ${tokens.terra}`,
      fontFamily: "'Space Grotesk'", fontSize: 10.5, color: tokens.inkMid, lineHeight: 1.9,
    }}>
      {lines.map((l, i) => <div key={i} dangerouslySetInnerHTML={{ __html: l }} />)}
    </div>
  );
}

interface MetricRow { k: string; v: number | string | null | undefined; u: string; tip: string; formula: string[] }

function MetricList({ rows, accentColor }: { rows: MetricRow[]; accentColor: string }) {
  const [hovered, setHovered] = useState<string | null>(null);
  return (
    <div>
      {rows.map(({ k, v, u, tip, formula }) => v != null && (
        <div key={k}
          onMouseEnter={() => setHovered(k)}
          onMouseLeave={() => setHovered(null)}
          style={{ padding: '6px 0', borderBottom: `1px solid ${tokens.creamBorder}`, cursor: 'default' }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <span style={{ fontFamily: "'Space Grotesk'", fontSize: 11, fontWeight: 600, color: tokens.inkMid }}>{k}</span>
              <span style={{ fontFamily: "'Space Grotesk'", fontSize: 10, color: tokens.inkLight, marginLeft: 6 }}>{tip}</span>
            </div>
            <span style={{ fontFamily: "'Playfair Display'", fontSize: 28, fontWeight: 700, color: tokens.ink }}>
              {v}<span style={{ fontSize: 12, fontFamily: "'Space Grotesk'", color: tokens.inkLight, marginLeft: 3 }}>{u}</span>
            </span>
          </div>
          {hovered === k && formula.length > 0 && (
            <FormulaBox lines={formula} />
          )}
        </div>
      ))}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function AnalysisPage({ activity, onBack }: { activity: Activity; onBack: () => void }) {
  const { t, lang } = useT();
  const localizedDate = formatDateLocale(activity.rawDate, lang);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const isMobile = useIsMobile();

  const data   = useMemo(() => buildChartData(activity), [activity]);
  const hasHR  = (activity.heartrate?.length ?? 0) > 10;
  const hasPow = data.some(d => d.power > 0);
  const hasGPS = (activity.gps?.length ?? 0) > 1;

  const chartHeight = isMobile ? 260 : 300;

  const hrGradChart = hasHR && mounted && (
    <ChartCard title={t("charts.hrSlope")}>
      <ResponsiveContainer width="100%" height={chartHeight}>
        <ComposedChart syncId="ride" data={data} margin={{ top: 4, right: 2, left: -10, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={tokens.creamBorder} />
          <XAxis dataKey="dist" tick={{ fontFamily: "'Space Grotesk'", fontSize: 10 }} tickFormatter={v => `${v}km`} />
          <YAxis yAxisId="hr"   orientation="left"  width={38} tick={{ fontFamily: "'Space Grotesk'", fontSize: 10 }} domain={['auto', 'auto']} />
          <YAxis yAxisId="grad" orientation="right" width={32} tick={{ fontFamily: "'Space Grotesk'", fontSize: 10 }} tickFormatter={v => `${v}%`} domain={[-25, 25]} />
          <Tooltip content={<ChartTooltip />} />
          <Bar yAxisId="grad" dataKey="gradUp"   name="Montée (%)"  fill={tokens.terra} opacity={0.7} maxBarSize={6} />
          <Bar yAxisId="grad" dataKey="gradDown" name="Descente (%)" fill={tokens.blue}  opacity={0.7} maxBarSize={6} />
          <Line yAxisId="hr" dataKey="hr" name="FC (bpm)" stroke={tokens.terra} dot={false} strokeWidth={2} type="monotone" />
        </ComposedChart>
      </ResponsiveContainer>
      <div style={{ display: 'flex', gap: 20, marginTop: 10, fontFamily: "'Space Grotesk'", fontSize: 11, color: tokens.inkLight }}>
        <span><span style={{ display: 'inline-block', width: 12, height: 3, background: tokens.terra, marginRight: 6, verticalAlign: 'middle' }} />FC (bpm)</span>
        <span><span style={{ display: 'inline-block', width: 12, height: 8, background: tokens.terra, marginRight: 6, verticalAlign: 'middle', opacity: 0.7 }} />Montée</span>
        <span><span style={{ display: 'inline-block', width: 12, height: 8, background: tokens.blue, marginRight: 6, verticalAlign: 'middle', opacity: 0.7 }} />Descente</span>
      </div>
    </ChartCard>
  );

  const speedChart = mounted && (
    <ChartCard title={t("charts.speed")}>
      <ResponsiveContainer width="100%" height={chartHeight}>
        <AreaChart syncId="ride" data={data} margin={{ top: 4, right: 2, left: -10, bottom: 0 }}>
          <defs>
            <linearGradient id="spdGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor={tokens.blue} stopOpacity={0.35} />
              <stop offset="100%" stopColor={tokens.blue} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={tokens.creamBorder} />
          <XAxis dataKey="dist" tick={{ fontFamily: "'Space Grotesk'", fontSize: 10 }} tickFormatter={v => `${v}km`} />
          <YAxis width={44} tick={{ fontFamily: "'Space Grotesk'", fontSize: 10 }} unit=" km/h" />
          <Tooltip content={<ChartTooltip />} />
          <Area dataKey="speed" name="Vitesse (km/h)" stroke={tokens.blue} fill="url(#spdGrad)" strokeWidth={2} dot={false} type="monotone" />
        </AreaChart>
      </ResponsiveContainer>
    </ChartCard>
  );

  const powerChart = hasPow && mounted && (
    <ChartCard title={t("charts.power")}>
      <ResponsiveContainer width="100%" height={chartHeight}>
        <AreaChart syncId="ride" data={data} margin={{ top: 4, right: 2, left: -10, bottom: 0 }}>
          <defs>
            <linearGradient id="powGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor={tokens.green} stopOpacity={0.4} />
              <stop offset="100%" stopColor={tokens.green} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={tokens.creamBorder} />
          <XAxis dataKey="dist" tick={{ fontFamily: "'Space Grotesk'", fontSize: 10 }} tickFormatter={v => `${v}km`} />
          <YAxis width={38} tick={{ fontFamily: "'Space Grotesk'", fontSize: 10 }} tickFormatter={v => `${v}W`} />
          <Tooltip content={<PowerTooltip />} />
          <Area dataKey="power" name="Puissance (W)" stroke={tokens.green} fill="url(#powGrad)" strokeWidth={2} dot={false} type="monotone" />
        </AreaChart>
      </ResponsiveContainer>
      <div style={{ marginTop: 12, fontFamily: "'Space Grotesk'", fontSize: 11, color: tokens.inkLight }}>
        Survole → détail des forces (gravité, roulement, aéro) à chaque km.
      </div>
    </ChartCard>
  );

  const altChart = mounted && (
    <ChartCard title={t("charts.elevProfile")}>
      <ResponsiveContainer width="100%" height={chartHeight}>
        <AreaChart syncId="ride" data={data} margin={{ top: 4, right: 2, left: -10, bottom: 0 }}>
          <defs>
            <linearGradient id="altGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor={tokens.terra} stopOpacity={0.3} />
              <stop offset="100%" stopColor={tokens.terra} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={tokens.creamBorder} />
          <XAxis dataKey="dist" tick={{ fontFamily: "'Space Grotesk'", fontSize: 10 }} tickFormatter={v => `${v}km`} />
          <YAxis width={38} tick={{ fontFamily: "'Space Grotesk'", fontSize: 10 }} tickFormatter={v => `${v}m`} />
          <Tooltip content={<ChartTooltip />} />
          <Area dataKey="altitude" name="Altitude (m)" stroke={tokens.terra} fill="url(#altGrad)" strokeWidth={2} dot={false} type="monotone" />
        </AreaChart>
      </ResponsiveContainer>
    </ChartCard>
  );

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '16px 16px' : '32px 40px', background: tokens.cream }}>
      {/* Header */}
      <button onClick={onBack} style={{
        background: 'none', border: 'none', cursor: 'pointer',
        fontFamily: "'Space Grotesk'", fontSize: 11, letterSpacing: '0.1em',
        color: tokens.inkLight, textTransform: 'uppercase', marginBottom: 20, padding: 0,
      }}>
        {t('common.back')}
      </button>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        <TypeBadge type={activity.type} />
        <Label>{localizedDate} · {activity.location}</Label>
      </div>
      <h1 style={{ fontFamily: "'Playfair Display'", fontSize: isMobile ? 24 : 36, fontWeight: 900, color: tokens.ink, marginBottom: 24, lineHeight: 1.1 }}>
        {activity.title}
      </h1>

      {/* Key stats */}
      <div style={{ ...CARD_STYLE, display: 'flex', flexWrap: 'wrap', marginBottom: 20 }}>
        <StatChip label={t('analysis.duration')} value={activity.duration}  unit="" />
        <StatChip label={t('analysis.distance')} value={activity.distance}  unit="km" />
        {activity.type === 'running' && activity.pace_s_per_km != null
          ? <StatChip label={t('analysis.pace')} value={formatPace(activity.pace_s_per_km)} unit="/km" />
          : activity.speed != null && <StatChip label={t('analysis.avgSpeed')} value={activity.speed}      unit="km/h" />}
        {activity.type !== 'running' && activity.max_speed != null && <StatChip label={t('analysis.maxSpeed')} value={activity.max_speed}  unit="km/h" />}
        <StatChip label={t('analysis.climb')}    value={activity.elevation} unit="m" />
        {activity.avg_hr    != null && <StatChip label={t('analysis.hrAvg')} value={activity.avg_hr}     unit="bpm" />}
        {activity.max_hr    != null && <StatChip label={t('analysis.hrMax')} value={activity.max_hr}     unit="bpm" />}
        {activity.calories  != null && <StatChip label={t('analysis.cal')}  value={activity.calories}   unit="kcal" />}
      </div>

      {/* FTP banner */}
      {activity.np && (
        <div style={{ ...CARD_STYLE, marginBottom: 20, borderLeft: `4px solid ${tokens.terra}`, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <Label style={{ display: 'block', marginBottom: 4 }}>FTP ESTIMÉ</Label>
            <div style={{ fontFamily: "'Playfair Display'", fontSize: 32, fontWeight: 900, color: tokens.ink, lineHeight: 1 }}>
              {activity.ftp ?? FTP_FALLBACK} <span style={{ fontSize: 14, fontFamily: "'Space Grotesk'", color: tokens.inkLight, fontWeight: 400 }}>W</span>
            </div>
          </div>
          <div style={{ fontFamily: "'Space Grotesk'", fontSize: 11, color: tokens.inkLight, lineHeight: 1.9 }}>
            <div><strong style={{ color: tokens.ink }}>Formule :</strong> best 20 min × 0.95 (Coggan)</div>
            <div>FTP = <strong style={{ color: tokens.terra }}>{activity.ftp ?? FTP_FALLBACK} W</strong> · {activity.rider_kg ?? FALLBACK_RIDER_KG} kg → {((activity.ftp ?? FTP_FALLBACK) / (activity.rider_kg ?? FALLBACK_RIDER_KG)).toFixed(2)} W/kg</div>
            <div style={{ marginTop: 2, color: tokens.inkLight }}>
              Calculée depuis tes meilleures sorties non assistées · pour mesurer (vs estimer), un capteur de puissance est nécessaire
            </div>
          </div>
        </div>
      )}

      {/* Chart grid — Row 1: FC | Vitesse */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 20, marginBottom: 20 }}>
        {hrGradChart || <div />}
        {speedChart}
      </div>

      {/* Chart grid — Row 2: Puissance | Altitude */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 20, marginBottom: 20 }}>
        {powerChart || <div />}
        {altChart}
      </div>

      {/* VO2 Max + Power summary */}
      <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: 20, marginBottom: 20 }}>
        {activity.max_hr && <VO2MaxCard activity={activity} />}
        {hasPow && <PowerCard activity={activity} data={data} />}
      </div>

      {/* Route map */}
      {hasGPS && (
        <div style={{ ...CARD_STYLE, marginBottom: 20 }}>
          <Label style={{ display: 'block', marginBottom: 14 }}>CARTE DU TRAJET</Label>
          <ActivityRouteMap activity={activity} />
        </div>
      )}

      {/* Advanced metrics — moved to the bottom of the page so the
          heatmap-style route is the first thing the eye lands on, and
          the dense effort/cardio/mech tables come after as deeper read.
          (Original placement was right above the chart grid.) */}
      {(activity.np || activity.tss || activity.trimp) && (
        <div style={{ ...CARD_STYLE, marginBottom: 20 }}>
          <Label style={{ display: 'block', marginBottom: 16 }}>{t('analysis.effort')}</Label>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: 20, marginBottom: activity.hrZones ? 24 : 0 }}>
            {/* Effort */}
            <div>
              <Label style={{ display: 'block', marginBottom: 12, color: tokens.terra }}>{t('analysis.power')}</Label>
              <MetricList accentColor={tokens.terra} rows={[
                { k: 'NP', v: activity.np, u: 'W', tip: t('metric.npTip'),
                  formula: [
                    '<strong>NP</strong> = (moyenne(P_lissée_30s <sup>4</sup>)) <sup>1/4</sup>',
                    '1. Fenêtre glissante 30s sur le flux de puissance',
                    '2. Élever chaque valeur à la puissance 4',
                    '3. Faire la moyenne, puis prendre la racine 4ème',
                    `→ Représente la puissance physiologiquement ressentie = <strong>${activity.np}W</strong>`,
                  ]},
                { k: 'AP', v: activity.avg_power, u: 'W', tip: t('metric.apTip'),
                  formula: [
                    '<strong>AP</strong> = Σ(P_i) / n',
                    'Simple moyenne arithmétique de toutes les valeurs de puissance',
                    `→ <strong>${activity.avg_power}W</strong> en moyenne sur la sortie`,
                  ]},
                { k: 'TSS', v: activity.tss, u: '', tip: t('metric.tssTip'),
                  formula: [
                    '<strong>TSS</strong> = (durée_s × NP × IF) / (FTP × 3600) × 100',
                    `= (${(activity.duration_min ?? 0) * 60}s × ${activity.np}W × ${activity.if_factor}) / (${activity.ftp ?? FTP_FALLBACK} × 3600) × 100`,
                    `= <strong>${activity.tss}</strong>`,
                    `FTP = ${activity.ftp ?? FTP_FALLBACK}W (best 20 min × 0.95) · <50 = récupération · 50–75 = modéré · 75–100 = difficile · >100 = très exigeant`,
                  ]},
                { k: 'IF', v: activity.if_factor, u: '', tip: t('metric.ifTip'),
                  formula: [
                    '<strong>IF</strong> = NP / FTP',
                    `= ${activity.np} / ${activity.ftp ?? FTP_FALLBACK}`,
                    `= <strong>${activity.if_factor}</strong>`,
                    '0.75 = endurance · 0.85 = tempo · >0.95 = seuil/VO₂max',
                  ]},
                { k: 'VI', v: activity.vi, u: '', tip: t('metric.viTip'),
                  formula: [
                    '<strong>VI</strong> = NP / AP',
                    `= ${activity.np} / ${activity.avg_power}`,
                    `= <strong>${activity.vi}</strong>`,
                    'Proche de 1.0 = effort régulier · >1.05 = effort en accordéon',
                  ]},
                { k: 'W/kg', v: activity.wkg, u: 'W/kg', tip: t('metric.wkgTip'),
                  formula: [
                    '<strong>W/kg</strong> = NP / poids_coureur',
                    `= ${activity.np} / 66 kg`,
                    `= <strong>${activity.wkg} W/kg</strong>`,
                    '<3 = loisir · 3-4 = amateur · >4 = compétitif',
                  ]},
              ]} />
            </div>

            {/* Cardio */}
            <div>
              <Label style={{ display: 'block', marginBottom: 12, color: tokens.blue }}>{t('analysis.cardio')}</Label>
              <MetricList accentColor={tokens.blue} rows={[
                { k: 'TRIMP', v: activity.trimp, u: '', tip: t('metric.trimpTip'),
                  formula: [
                    '<strong>TRIMP</strong> = Σ(Δt_min × r × 0.64 × e^(1.92×r))',
                    'r = (FC - FC_repos) / (FC_max - FC_repos)',
                    `FC_repos = 60 bpm · FC_max = ${activity.max_hr ?? '—'} bpm`,
                    'Pondère chaque minute selon l\'intensité cardiaque',
                    `→ <strong>${activity.trimp}</strong> — plus sensible que la durée seule`,
                  ]},
                { k: 'EF', v: activity.ef, u: 'W/bpm', tip: t('metric.efTip'),
                  formula: [
                    '<strong>EF</strong> = NP / FC_moyenne',
                    `= ${activity.np} / ${activity.avg_hr}`,
                    `= <strong>${activity.ef} W/bpm</strong>`,
                    'Plus EF est élevé, plus tu produis de puissance pour un même effort cardiaque',
                  ]},
                { k: 'AeD', v: activity.aed != null ? `${activity.aed}%` : null, u: '', tip: t('metric.aedTip'),
                  formula: [
                    '<strong>AeD</strong> = (EF₁ − EF₂) / EF₁ × 100',
                    'EF₁ = EF sur la 1ère moitié · EF₂ = EF sur la 2ème',
                    `= <strong>${activity.aed}%</strong>`,
                    '< 5% = bonne forme aérobie · > 10% = fatigue ou sous-entraînement',
                  ]},
                { k: t('metric.hrAvgLabel'), v: activity.avg_hr, u: 'bpm', tip: t('metric.hrAvgTip'), formula: [] },
                { k: t('metric.hrMaxLabel'), v: activity.max_hr, u: 'bpm', tip: t('metric.hrMaxTip'), formula: [] },
              ]} />
            </div>

            {/* Mechanical / weather */}
            <div>
              <Label style={{ display: 'block', marginBottom: 12, color: tokens.green }}>{t('analysis.mech')}</Label>
              <MetricList accentColor={tokens.green} rows={[
                { k: 'VAM', v: activity.vam, u: 'm/h', tip: t('metric.vamTip'),
                  formula: [
                    '<strong>VAM</strong> = D+_montées(m) / t_montées(s) × 3600',
                    'Calculé uniquement sur les segments >2% de pente',
                    `→ <strong>${activity.vam} m/h</strong>`,
                    '<800 = randonneur · 800–1200 = cycliste amateur · >1500 = élite',
                  ]},
                { k: t('metric.slopeMaxLabel'), v: activity.max_incline != null ? `+${activity.max_incline}` : null, u: '%', tip: t('metric.slopeMaxTip'),
                  formula: [
                    'gradient = ΔAltitude / ΔDistance × 100',
                    'Calculé par fenêtre de 40 points GPS pour lisser le bruit',
                    `→ pic à <strong>+${activity.max_incline}%</strong>`,
                  ]},
                { k: t('metric.slopeMinLabel'), v: activity.min_incline, u: '%', tip: t('metric.slopeMinTip'),
                  formula: [
                    'Même méthode que pente max, côté négatif',
                    `→ descente max <strong>${activity.min_incline}%</strong>`,
                  ]},
              ]} />
              {activity.weather && (
                <div style={{ marginTop: 12, padding: 12, background: tokens.creamDark, borderRadius: 4 }}>
                  <Label style={{ display: 'block', marginBottom: 8 }}>{t('analysis.weather')}</Label>
                  <div style={{ fontFamily: "'Space Grotesk'", fontSize: 12, color: tokens.inkMid, lineHeight: 2 }}>
                    <div>{translateWeather(activity.weather.description, t)} · {activity.weather.temp}°C</div>
                    <div>{t('charts.windHumid', { wind: activity.weather.windspeed, hum: activity.weather.humidity })}</div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* HR Zones */}
          {activity.hrZones && (() => {
            const zones = [
              { label: 'Z1 — Récupération', bpm: '< 136 bpm',    val: activity.hrZones.z1, color: tokens.blue   },
              { label: 'Z2 — Endurance',    bpm: '137–149 bpm',   val: activity.hrZones.z2, color: tokens.green  },
              { label: 'Z3 — Tempo',        bpm: '150–162 bpm',   val: activity.hrZones.z3, color: tokens.terra  },
              { label: 'Z4 — Seuil',        bpm: '163–175 bpm',   val: activity.hrZones.z4, color: '#e07030'     },
              { label: 'Z5 — VO₂max',       bpm: '> 176 bpm',     val: activity.hrZones.z5, color: '#cc3333'     },
            ];
            const total = zones.reduce((s, z) => s + z.val, 0);
            return (
              <div style={{ borderTop: `1px solid ${tokens.creamBorder}`, paddingTop: 16 }}>
                <Label style={{ display: 'block', marginBottom: 14 }}>ZONES FC — TEMPS PASSÉ</Label>
                {zones.map(({ label, bpm, val, color }) => {
                  const pct = total ? (val / total) * 100 : 0;
                  return (
                    <div key={label} style={{ marginBottom: 10 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontFamily: "'Space Grotesk'", fontSize: 11, color: tokens.inkMid, fontWeight: 600 }}>{label}</span>
                          <span style={{ fontFamily: "'Space Grotesk'", fontSize: 10, color: tokens.inkLight }}>{bpm}</span>
                        </div>
                        <span style={{ fontFamily: "'Space Grotesk'", fontSize: 11, color: tokens.inkLight }}>
                          {val.toFixed(0)} min · <strong style={{ color: tokens.ink }}>{pct.toFixed(0)}%</strong>
                        </span>
                      </div>
                      <div style={{ height: 7, background: tokens.creamBorder, borderRadius: 3 }}>
                        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 3, transition: 'width 1s ease' }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
