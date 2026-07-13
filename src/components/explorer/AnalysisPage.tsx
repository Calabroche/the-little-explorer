'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import {
  ComposedChart, AreaChart, Area, Bar, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { Activity, tokens } from './tokens';
import { Label, TypeBadge, StatChip, useIsMobile } from './ui';
import { useT, formatDateLocale } from '@/i18n';
import { formatPace } from '@/utils/format';
import { detectClimbs, Climb } from '@/lib/climbs';
import { GradeAdjustedPace } from './GradeAdjustedPace';

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

  // Gradient smoothing window. Was ±40 samples (~280 m of road at
  // cycling speed) which averaged short ramps into oblivion. ±18 keeps
  // a single steep section visible without being noisy on GPS jitter.
  //
  // The chart's gradient is then *clamped* to the activity-level
  // max_incline / min_incline computed server-side. The server uses a
  // tighter window (5 samples) PLUS a 97th-percentile filter that
  // discards GPS noise — matching Strava's reported max grade within
  // ~0.1-0.2%. Without this clamp, the chart can show ~3-4% phantom
  // spikes from altimeter noise on top of real ramps, which is why
  // the hover-tooltip used to read 15.8% on a road that's really
  // capped at 11.9% (per Strava + per the EFFORT card).
  const WINDOW   = 18;
  const truthMax = activity.max_incline ??  25;
  const truthMin = activity.min_incline ?? -25;
  const gradient: number[] = new Array(len).fill(0);
  for (let i = WINDOW; i < len - WINDOW; i++) {
    const dAlt  = altitude[i + WINDOW] - altitude[i - WINDOW];
    const dDist = distance_m[i + WINDOW] - distance_m[i - WINDOW];
    if (dDist >= 10) {
      const raw = (dAlt / dDist) * 100;
      gradient[i] = +Math.max(truthMin, Math.min(truthMax, raw)).toFixed(1);
    }
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

  // Peak-preserving downsampling. Bucket size targets ~600 chart points
  // (was 300). For each bucket, pick the sample whose *absolute*
  // gradient is highest — this guarantees the steepest ramp / descent
  // in every road segment shows up on the chart instead of being
  // averaged out between two arbitrary samples. Falls back to the
  // bucket midpoint when the bucket has no meaningful gradient values
  // (e.g. the first / last WINDOW samples).
  const TARGET = 600;
  const step = Math.max(1, Math.floor(len / TARGET));
  const data = [];
  for (let bucketStart = 0; bucketStart < len; bucketStart += step) {
    const bucketEnd = Math.min(bucketStart + step, len);
    let pickIdx = bucketStart + Math.floor((bucketEnd - bucketStart) / 2);
    let pickMag = -1;
    for (let i = bucketStart; i < bucketEnd; i++) {
      const mag = Math.abs(gradient[i]);
      if (mag > pickMag) { pickMag = mag; pickIdx = i; }
    }
    const i = pickIdx;
    const g = gradient[i];
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

/**
 * "Montées détectées" — algorithmic climb-spotter card. Walks the
 * activity's altitude + distance streams and surfaces stretches that
 * meet the thresholds in `lib/climbs.ts` (≥ 500 m, ≥ 30 m gain, ≥ 3 %
 * avg grade). Same algorithm as the iOS app's ClimbDetector.swift so
 * a given ride shows the same climbs on web and mobile.
 *
 * Renders nothing if no climbs qualify — the card hides itself rather
 * than showing an empty state, because the typical flat ride wouldn't
 * trigger anything and we don't want to add visual noise.
 */
function ClimbsCard({
  climbs,
  hoveredIdx,
  onHover,
  compact = false,
  maxHeight,
}: {
  climbs: Climb[];
  hoveredIdx: number | null;
  /** Pass null on mouse leave. */
  onHover: (idx: number | null) => void;
  /** When true, switch to a denser row layout suitable for a 20%-width
   *  side column next to the map. Stats stack vertically and the
   *  footer note collapses to a tooltip-style hint. */
  compact?: boolean;
  /** Max-height for the rows list — used in side-by-side layout to
   *  match the map's height. Overflow scrolls inside the card. */
  maxHeight?: number;
}) {
  if (climbs.length === 0) return null;
  return (
    <div style={{ ...CARD_STYLE, marginBottom: 0, height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12, gap: 8, flexWrap: 'wrap' }}>
        <Label>MONTÉES DÉTECTÉES</Label>
        <span style={{ fontSize: 10, color: tokens.inkLight }}>
          {climbs.length} · ≥3% / 30m
        </span>
      </div>
      <div
        style={{
          // flex column with grow=1 so the rows stretch to fill the
          // map's height — eliminates the white space at the bottom
          // of the climbs card that user flagged.
          display:        'flex',
          flexDirection:  'column',
          gap:            compact ? 10 : 8,
          flex:           1,
          overflowY:      maxHeight ? 'auto' : 'visible',
          maxHeight:      maxHeight,
          paddingRight:   maxHeight ? 4 : 0,
        }}
      >
        {climbs.map((c, idx) => (
          <div key={idx} style={{ flex: '1 1 auto' }}>
            <ClimbRow
              climb={c}
              highlighted={hoveredIdx === idx}
              onEnter={() => onHover(idx)}
              onLeave={() => onHover(null)}
              compact={compact}
            />
          </div>
        ))}
      </div>
      {/* NB — always visible. Explains the strict thresholds so a
          missing "kicker" isn't read as a bug. Compact variant trims
          the wording for the 20 %-width side column. */}
      <p style={{
        marginTop:  compact ? 8  : 10,
        fontSize:   compact ? 10 : 11,
        color:      tokens.inkLight,
        lineHeight: 1.45,
        borderTop:  `1px solid ${tokens.creamBorder}`,
        paddingTop: compact ? 8  : 10,
      }}>
        <strong style={{ color: tokens.inkMid, fontWeight: 700 }}>NB —</strong>{' '}
        {compact ? (
          <>seuils volontairement stricts : <strong>≥ 500 m</strong>, <strong>≥ 30 m</strong> de gain, <strong>≥ 3 %</strong> moyens. Les petits raidards (kickers &lt; 500 m) sont volontairement ignorés pour ne lister que les vraies montées.</>
        ) : (
          <>seuils volontairement stricts pour ne lister que les <em>vraies</em> montées : <strong>≥ 500 m</strong> de longueur, <strong>≥ 30 m</strong> de gain, <strong>≥ 3 %</strong> de pente moyenne. Les petits raidards (kickers &lt; 500 m, même à 8-10 %) sont délibérément ignorés. Détection sur altitude lissée (moyenne mobile 30 pts) ; pente max sur fenêtre glissante 100 m.</>
        )}
      </p>
    </div>
  );
}

function ClimbRow({
  climb,
  highlighted,
  onEnter,
  onLeave,
  compact = false,
}: {
  climb: Climb;
  highlighted: boolean;
  onEnter: () => void;
  onLeave: () => void;
  /** Side-column variant — denser layout for ~200px-wide column. */
  compact?: boolean;
}) {
  const distKm = (climb.distanceM / 1000).toFixed(2);
  const elev   = Math.round(climb.elevationM);
  const avg    = climb.avgGradePct.toFixed(1);
  const max    = climb.maxGradePct.toFixed(1);
  const mins   = Math.floor(climb.durationSec / 60);
  const secs   = Math.round(climb.durationSec % 60);
  const dur    = climb.durationSec > 0 ? `${mins}:${secs.toString().padStart(2, '0')}` : '—';

  // Grade-driven color: gentle (green) → moderate (terra) → punchy (red).
  // Same buckets as the gradient overlay in the HR/slope chart so the
  // card and chart agree visually on what "steep" means.
  const color =
    climb.avgGradePct >= 8  ? '#A23838' :
    climb.avgGradePct >= 5  ? tokens.terra :
                              tokens.green;

  return (
    <div
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      style={{
        display:      'grid',
        gridTemplateColumns: '4px 1fr',
        borderRadius: 3,
        overflow:     'hidden',
        background:   highlighted ? tokens.surface : tokens.creamDark,
        boxShadow:    highlighted ? `0 0 0 2px ${tokens.terra}` : 'none',
        cursor:       'pointer',
        transition:   'box-shadow 140ms ease, background 140ms ease',
        height:       '100%', // stretch when parent has flex space to fill
      }}
    >
      <div style={{ background: color }} />
      <div style={{
        padding: compact ? '14px 14px' : '10px 14px',
        width: '100%',
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          marginBottom: compact ? 6 : 6,
          gap: 6,
        }}>
          <span style={{
            fontFamily: "'Playfair Display'",
            fontSize:   compact ? 14 : 16,
            fontWeight: 700,
            color:      tokens.ink,
            whiteSpace: 'nowrap',
            overflow:   'hidden',
            textOverflow: 'ellipsis',
          }}>{climb.name}</span>
          {!compact && (
            <span style={{
              fontSize:      10,
              fontWeight:    700,
              letterSpacing: '0.08em',
              color,
              whiteSpace:    'nowrap',
            }}>
              {avg}% MOY · {max}% MAX
            </span>
          )}
        </div>

        {compact ? (
          // Two horizontal lines, inline "label value · label value".
          // Impossible to clip a value visually — they sit next to
          // their label on the same baseline. Reads like a stat strip
          // a cyclist would scan quickly.
          <div style={{ fontSize: 11, lineHeight: 1.6, color: tokens.inkMid }}>
            <div>
              <CompactStat label="long." value={`${distKm} km`} />
              {' · '}
              <CompactStat label="D+" value={`${elev} m`} />
            </div>
            <div>
              <CompactStat label="moy" value={`${avg}%`} valueColor={color} />
              {' · '}
              <CompactStat label="max" value={`${max}%`} />
            </div>
            {climb.durationSec > 0 && (
              <div>
                <CompactStat label="durée" value={dur} />
              </div>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
            <ClimbStat label="DISTANCE" value={distKm} unit="km" />
            <ClimbStat label="DÉNIVELÉ" value={String(elev)} unit="m" />
            <ClimbStat label="DURÉE"    value={dur}       unit="" />
            <ClimbStat label="MAX"      value={max}       unit="%" />
          </div>
        )}
      </div>
    </div>
  );
}

/** Inline "label value" pair used in the compact climbs side column.
 *  Label rendered in inkLight, value in ink (or overriden for the grade
 *  color tint on the avg stat). Stays on a single baseline so the
 *  vertical rhythm of the climb row is predictable. */
function CompactStat({
  label, value, valueColor,
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <>
      <span style={{ color: tokens.inkLight, fontSize: 10 }}>{label}</span>
      <span style={{ color: valueColor ?? tokens.ink, fontWeight: 700, marginLeft: 3 }}>{value}</span>
    </>
  );
}

function ClimbStat({
  label, value, unit, compact = false, color,
}: {
  label: string;
  value: string;
  unit: string;
  /** Side-column variant — smaller fonts, lowercase label. */
  compact?: boolean;
  /** Override for the value color (used to grade-tint the avg %). */
  color?: string;
}) {
  return (
    <div>
      <div style={{
        fontSize:      compact ? 9  : 9,
        fontWeight:    700,
        letterSpacing: compact ? '0.04em' : '0.08em',
        color:         tokens.inkLight,
        textTransform: compact ? 'none' : 'uppercase',
      }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 2 }}>
        <span style={{
          fontFamily: "'Playfair Display'",
          fontSize:   compact ? 13 : 15,
          fontWeight: 700,
          color:      color ?? tokens.ink,
        }}>{value}</span>
        {unit && <span style={{ fontSize: 10, color: tokens.inkLight }}>{unit}</span>}
      </div>
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

export function AnalysisPage({ activity, onBack, onDelete, onEdit }: { activity: Activity; onBack: () => void; onDelete?: () => void; onEdit?: (patch: { title?: string; sport?: string }) => void }) {
  const { t, lang } = useT();
  const localizedDate = formatDateLocale(activity.rawDate, lang);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const isMobile = useIsMobile();

  // Inline edit (title + sport). Own activities only — gated by onEdit being set.
  const [editing, setEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState(activity.title);
  const [sportDraft, setSportDraft] = useState<string>(activity.type);
  const [savingEdit, setSavingEdit] = useState(false);
  const [override, setOverride] = useState<{ title?: string; sport?: string }>({});
  const shownTitle = override.title ?? activity.title;
  const shownType = (override.sport ?? activity.type) as Activity['type'];
  const openEdit = () => { setTitleDraft(shownTitle); setSportDraft(shownType); setEditing(true); };
  const saveEdit = async () => {
    setSavingEdit(true);
    try {
      const r = await fetch(`/api/activities/${activity.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: titleDraft.trim(), sport: sportDraft }),
      });
      if (r.ok) {
        const patch = { title: titleDraft.trim(), sport: sportDraft };
        setOverride(patch);
        onEdit?.(patch);
        setEditing(false);
      }
    } catch { /* keep modal open */ }
    finally { setSavingEdit(false); }
  };

  const data   = useMemo(() => buildChartData(activity), [activity]);
  const hasHR  = (activity.heartrate?.length ?? 0) > 10;
  const hasPow = data.some(d => d.power > 0);
  const hasGPS = (activity.gps?.length ?? 0) > 1;
  // Indoor activities (WeightTraining, Yoga, Workout via apps like
  // Ladder) legitimately have NO time-series — Strava records them
  // as 2-point stubs (start + end). Charts would render as empty
  // rectangles, which the rider then asks us to "fix" forever.
  // Detect the data-less case once and hide the whole charts +
  // map block downstream when nothing plotabble exists.
  const hasSpeedSeries = (activity.speed_kmh?.length ?? 0) > 10;
  const hasAltSeries   = (activity.altitude?.length ?? 0) > 10;
  const hasAnyPlottableSeries = data.length > 0 || hasGPS || hasSpeedSeries || hasAltSeries;

  // Climb detection — same algorithm as the iOS app (lib/climbs.ts).
  // Memoized on the activity reference so we don't re-walk the altitude
  // stream on every chart drag / hover.
  const climbs = useMemo(
    () => detectClimbs(activity.altitude, activity.distance_m, activity.time_s),
    [activity],
  );

  // Which climb is currently highlighted on the map (hover state). Lifted
  // to the parent so the Climbs card and the map can be siblings.
  const [hoveredClimbIdx, setHoveredClimbIdx] = useState<number | null>(null);
  const highlightSegment = hoveredClimbIdx !== null && climbs[hoveredClimbIdx]
    ? { startIdx: climbs[hoveredClimbIdx].startIndex, endIdx: climbs[hoveredClimbIdx].endIndex }
    : null;

  const chartHeight = isMobile ? 260 : 300;

  // HR Y-range, tight to the ride's actual data. Matches iOS commit
  // 253ae9b — Recharts' 'auto' tends to over-pad, which leaves dead
  // space at the top/bottom on recovery rides. We round to the nearest
  // 10 bpm so axis labels stay readable.
  const hrRange = useMemo(() => {
    const hrs = data.map(d => d.hr).filter((v): v is number => Number.isFinite(v as number) && (v as number) > 0);
    if (hrs.length === 0) return { min: 80 as number, max: 200 as number };
    const lo = Math.min(...hrs);
    const hi = Math.max(...hrs);
    if (hi <= lo) return { min: 80, max: 200 };
    const pad = Math.max(5, (hi - lo) * 0.08);
    return {
      min: Math.max(40,  Math.floor((lo - pad) / 10) * 10),
      max: Math.min(220, Math.ceil((hi + pad) / 10) * 10),
    };
  }, [data]);

  const hrGradChart = hasHR && mounted && (
    <ChartCard title={t("charts.hrSlope")}>
      <ResponsiveContainer width="100%" height={chartHeight}>
        <ComposedChart syncId="ride" data={data} margin={{ top: 4, right: 2, left: -10, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={tokens.creamBorder} />
          <XAxis dataKey="dist" tick={{ fontFamily: "'Space Grotesk'", fontSize: 10 }} tickFormatter={v => `${v}km`} />
          <YAxis yAxisId="hr"   orientation="left"  width={38} tick={{ fontFamily: "'Space Grotesk'", fontSize: 10 }} domain={[hrRange.min, hrRange.max]} allowDataOverflow />
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

  const speedChart = mounted && hasSpeedSeries && (
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

  const altChart = mounted && hasAltSeries && (
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
      {/* Header — both controls kept on the LEFT so they never sit under the
          floating top-right chips (info / theme / language). */}
      <div style={{ display: 'flex', justifyContent: 'flex-start', alignItems: 'center', gap: 16, marginBottom: 20 }}>
        <button onClick={onBack} style={{
          background: 'none', border: 'none', cursor: 'pointer',
          fontFamily: "'Space Grotesk'", fontSize: 11, letterSpacing: '0.1em',
          color: tokens.inkLight, textTransform: 'uppercase', padding: 0,
        }}>
          {t('common.back')}
        </button>
        {onEdit && (
          <button onClick={openEdit} style={{
            background: 'none', border: `1px solid ${tokens.creamBorder}`, borderRadius: 6,
            padding: '6px 12px', cursor: 'pointer', color: tokens.inkMid,
            fontFamily: "'Space Grotesk'", fontSize: 12, fontWeight: 600,
          }}>✏️ Modifier</button>
        )}
        {onDelete && (
          <button onClick={onDelete} style={{
            background: 'none', border: `1px solid ${tokens.creamBorder}`, borderRadius: 6,
            padding: '6px 12px', cursor: 'pointer', color: '#A0392B',
            fontFamily: "'Space Grotesk'", fontSize: 12, fontWeight: 600,
          }}>🗑 Supprimer</button>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        <TypeBadge type={shownType} />
        <Label>{localizedDate} · {activity.location}</Label>
      </div>
      <h1 style={{ fontFamily: "'Playfair Display'", fontSize: isMobile ? 24 : 36, fontWeight: 900, color: tokens.ink, marginBottom: 24, lineHeight: 1.1 }}>
        {shownTitle}
      </h1>

      {editing && (
        <EditActivityModal
          title={titleDraft} sport={sportDraft} saving={savingEdit}
          onTitle={setTitleDraft} onSport={setSportDraft}
          onSave={saveEdit} onClose={() => setEditing(false)}
        />
      )}

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

      <MediaSection activityId={activity.id} canEdit={!!onEdit} />

      {/* Grade-adjusted pace (running) */}
      <GradeAdjustedPace activity={activity} />

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

      {/* Chart grid — Row 1: FC | Vitesse. Skipped entirely when
          neither chart has plotabble data (typical for indoor
          WeightTraining / Yoga sessions). */}
      {(hrGradChart || speedChart) && (
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 20, marginBottom: 20 }}>
          {hrGradChart || <div />}
          {speedChart || <div />}
        </div>
      )}

      {/* Chart grid — Row 2: Puissance | Altitude. Same dead-row
          suppression as Row 1. */}
      {(powerChart || altChart) && (
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 20, marginBottom: 20 }}>
          {powerChart || <div />}
          {altChart || <div />}
        </div>
      )}

      {/* No-data explanatory card. Triggered when Strava recorded the
          activity as a 2-point stub — typical of indoor strength
          sessions (Ladder app, Workout, WeightTraining, Yoga) where
          there's no GPS, no speed series, no altitude series. Without
          this the rider just sees the summary metrics floating with
          no context for WHY there are no charts. */}
      {!hasAnyPlottableSeries && (
        <div style={{ ...CARD_STYLE, marginBottom: 20, padding: 28, textAlign: 'center' }}>
          <div style={{ fontFamily: "'Space Grotesk'", fontSize: 13, color: tokens.inkMid, lineHeight: 1.6 }}>
            <strong style={{ color: tokens.ink }}>Pas de tracé détaillé pour cette séance.</strong><br />
            Les activités indoor (muscu, yoga, app fitness) n&apos;enregistrent ni GPS, ni altitude, ni vitesse continue côté Strava — seul le récap (durée, FC moy, calories) est disponible.
          </div>
        </div>
      )}

      {/* HR Zones — sits under the Puissance + Altitude row so all four
          time-series charts (FC, Vitesse, Puissance, Altitude) stay
          stacked at the top of the page, then the time-in-zones
          breakdown is the first contextual block. */}
      {activity.hrZones && (() => {
        const zones = [
          { label: 'Z1 — Récupération', bpm: '< 136 bpm',    val: activity.hrZones.z1, color: tokens.blue   },
          { label: 'Z2 — Endurance',    bpm: '137–149 bpm',   val: activity.hrZones.z2, color: tokens.green  },
          { label: 'Z3 — Tempo',        bpm: '150–162 bpm',   val: activity.hrZones.z3, color: tokens.terra  },
          { label: 'Z4 — Seuil',        bpm: '163–175 bpm',   val: activity.hrZones.z4, color: '#e07030'     },
          { label: 'Z5 — VO₂max',       bpm: '> 176 bpm',     val: activity.hrZones.z5, color: '#cc3333'     },
        ];
        // Coalesce — older JSON files can have undefined z* fields,
        // which would propagate NaN through `pct` and collapse every
        // bar to 0% width.
        const total = zones.reduce((s, z) => s + (z.val ?? 0), 0);
        return (
          <div style={{ ...CARD_STYLE, marginBottom: 20 }}>
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

      {/* Route map + Climbs side-by-side (80% / 20% on desktop).
          Hover a climb row → matching segment lights up on the map
          beside it. Adjacent placement means the eye doesn't travel
          to find the highlight. On mobile, the climbs card stacks
          above the map (climbs first because it's the index; map is
          the visualization the climbs reference). */}
      {(hasGPS || climbs.length > 0) && (
        <div style={{
          display:        'flex',
          gap:            12,
          marginBottom:   20,
          flexDirection:  isMobile ? 'column' : 'row',
          alignItems:     'stretch',
        }}>
          {hasGPS && (
            <div style={{
              flex:     isMobile ? 'auto' : '0 0 calc(80% - 6px)',
              minWidth: 0, // allow the inner map to shrink in flex
            }}>
              <div style={{ ...CARD_STYLE, marginBottom: 0, height: '100%' }}>
                <Label style={{ display: 'block', marginBottom: 14 }}>CARTE DU TRAJET</Label>
                <ActivityRouteMap activity={activity} highlightSegment={highlightSegment} />
              </div>
            </div>
          )}
          {climbs.length > 0 && (
            <div style={{
              flex:     isMobile ? 'auto' : '0 0 calc(20% - 6px)',
              minWidth: 0,
            }}>
              <ClimbsCard
                climbs={climbs}
                hoveredIdx={hoveredClimbIdx}
                onHover={setHoveredClimbIdx}
                compact={!isMobile}
                // No explicit maxHeight: with `alignItems: stretch` on
                // the parent flex row, the climbs card already stretches
                // to match the map card's height (~670 px). Capping at
                // 460 forced an internal scrollbar and clipped Montée 1
                // off the top. Letting the column grow naturally + the
                // flex-grow on each row distributes the available height
                // across the 5 climbs so they all fit visibly.
              />
            </div>
          )}
        </div>
      )}


      {/* VO2 Max card removed from per-activity view — the estimate
          is a function of FC max / FC repos, both ATHLETE-level
          values, so it doesn't change ride-to-ride. Repeating it
          on every detail page just adds noise. Aggregate VO2 lives
          on /bilan (the Wrapped page) where it actually belongs.
          Power summary kept here — it IS per-activity. */}
      {hasPow && (
        <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: 20, marginBottom: 20 }}>
          <PowerCard activity={activity} data={data} />
        </div>
      )}

      {/* Advanced metrics — moved to the bottom of the page so the
          heatmap-style route is the first thing the eye lands on, and
          the dense effort/cardio/mech tables come after as deeper read.
          (Original placement was right above the chart grid.) */}
      {(activity.np || activity.tss || activity.trimp) && (
        <div style={{ ...CARD_STYLE, marginBottom: 20 }}>
          <Label style={{ display: 'block', marginBottom: 16 }}>{t('analysis.effort')}</Label>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: 20 }}>
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

        </div>
      )}
    </div>
  );
}

// ── Media (photos) on an activity ──────────────────────────────────────────

interface MediaItem { id: string; url: string; kind: string }

// Resize a picked image to a max dimension and return a JPEG data URL (keeps
// the payload reasonable — the API stores it in Supabase Storage).
function resizeImageDataUrl(file: File, maxDim: number): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) { reject(new Error('not_image')); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('no_ctx')); return; }
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('load_failed')); };
    img.src = url;
  });
}

function MediaSection({ activityId, canEdit }: { activityId: number; canEdit: boolean }) {
  const [media, setMedia] = useState<MediaItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch(`/api/activities/${activityId}/media`).then(r => (r.ok ? r.json() : [])).then(setMedia).catch(() => setMedia([]));
  }, [activityId]);

  const onPick = async (file: File) => {
    setBusy(true); setError(null);
    try {
      const dataUrl = await resizeImageDataUrl(file, 1280);
      const r = await fetch(`/api/activities/${activityId}/media`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: dataUrl }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.message ?? 'échec');
      const item = await r.json() as MediaItem;
      setMedia(prev => [...(prev ?? []), item]);
    } catch (e) { setError((e as Error).message ?? 'Échec de l’ajout'); }
    finally { setBusy(false); }
  };

  const remove = async (id: string) => {
    setMedia(prev => (prev ?? []).filter(m => m.id !== id));
    await fetch(`/api/activities/${activityId}/media`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mediaId: id }),
    }).catch(() => {});
  };

  if (media == null) return null;
  if (media.length === 0 && !canEdit) return null;

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <Label>Photos</Label>
        {canEdit && (
          <>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) onPick(f); e.target.value = ''; }} />
            <button onClick={() => fileRef.current?.click()} disabled={busy} style={{
              padding: '6px 12px', borderRadius: 6, border: `1px solid ${tokens.creamBorder}`, background: 'transparent',
              cursor: busy ? 'default' : 'pointer', color: tokens.inkMid, fontFamily: "'Space Grotesk'", fontSize: 12, fontWeight: 600, opacity: busy ? 0.6 : 1,
            }}>{busy ? 'Ajout…' : '＋ Ajouter une photo'}</button>
          </>
        )}
      </div>
      {error && <div style={{ color: '#A00', fontSize: 12, marginBottom: 8 }}>{error}</div>}
      {media.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
          {media.map(m => (
            <div key={m.id} style={{ position: 'relative', aspectRatio: '4 / 3', borderRadius: 8, overflow: 'hidden', border: `1px solid ${tokens.creamBorder}` }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={m.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
              {canEdit && (
                <button onClick={() => remove(m.id)} style={{
                  position: 'absolute', top: 6, right: 6, width: 24, height: 24, borderRadius: '50%', border: 'none',
                  background: 'rgba(0,0,0,0.55)', color: '#fff', cursor: 'pointer', fontSize: 13, lineHeight: 1,
                }}>✕</button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Sports a ride can be re-typed to (value → French label).
const SPORT_OPTIONS: [string, string][] = [
  ['cycling', 'Vélo'], ['running', 'Course à pied'], ['walking', 'Marche'],
  ['hiking', 'Randonnée'], ['swim', 'Natation'], ['rowing', 'Aviron'],
  ['ski', 'Ski'], ['snowboard', 'Snowboard'], ['yoga', 'Yoga'],
  ['workout', 'Renforcement'], ['cardio', 'Cardio'], ['climbing', 'Escalade'],
  ['kayak', 'Kayak'], ['paddle', 'Paddle'], ['surf', 'Surf'], ['other', 'Autre'],
];

function EditActivityModal(
  { title, sport, saving, onTitle, onSport, onSave, onClose }: {
    title: string; sport: string; saving: boolean;
    onTitle: (v: string) => void; onSport: (v: string) => void;
    onSave: () => void; onClose: () => void;
  },
) {
  const field: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 8,
    border: `1px solid ${tokens.creamBorder}`, background: tokens.surface,
    fontFamily: "'Space Grotesk', sans-serif", fontSize: 14, color: tokens.ink,
  };
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: tokens.cream, borderRadius: 14, padding: 22, width: '100%', maxWidth: 420, border: `1px solid ${tokens.creamBorder}` }}>
        <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 20, fontWeight: 800, color: tokens.ink, marginBottom: 16 }}>Modifier la sortie</div>
        <label style={{ display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: tokens.inkLight, marginBottom: 6 }}>Titre</label>
        <input value={title} maxLength={200} onChange={e => onTitle(e.target.value)} style={{ ...field, marginBottom: 16 }} />
        <label style={{ display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: tokens.inkLight, marginBottom: 6 }}>Sport</label>
        <select value={sport} onChange={e => onSport(e.target.value)} style={{ ...field, marginBottom: 22 }}>
          {SPORT_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '9px 18px', borderRadius: 6, cursor: 'pointer', background: 'transparent', color: tokens.inkMid, border: `1px solid ${tokens.creamBorder}`, fontFamily: "'Space Grotesk'", fontWeight: 600, fontSize: 13 }}>Annuler</button>
          <button onClick={onSave} disabled={saving || title.trim().length === 0} style={{ padding: '9px 18px', borderRadius: 6, border: 'none', cursor: 'pointer', background: tokens.terra, color: '#fff', fontFamily: "'Space Grotesk'", fontWeight: 700, fontSize: 13, opacity: saving || title.trim().length === 0 ? 0.6 : 1 }}>{saving ? 'Enregistrement…' : 'Enregistrer'}</button>
        </div>
      </div>
    </div>
  );
}
