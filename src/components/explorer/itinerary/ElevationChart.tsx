'use client';

import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { tokens } from '../tokens';
import { Label } from '../ui';

interface RawPoint { km: number; ele: number }
interface Point extends RawPoint { gradPct: number; cumD: number }

interface Props {
  data:        RawPoint[];
  totalAscent:  number;
  totalDescent: number;
  loading?:     boolean;
  // When the cursor moves over the chart, fires with the hovered sample
  // index (or null on leave). Lets the parent show a synced marker on
  // the map at the matching geometry point.
  onHover?:    (sampleIdx: number | null) => void;
}

// Pre-compute, for each sample, the local grade (between this point and
// the previous one) and the cumulative D+ up to here. The tooltip reads
// these directly so it doesn't have to reach back into the array on
// every hover frame.
function enrich(data: RawPoint[]): Point[] {
  const out: Point[] = [];
  let cum = 0;
  for (let i = 0; i < data.length; i++) {
    if (i === 0) {
      out.push({ ...data[i], gradPct: 0, cumD: 0 });
      continue;
    }
    const dxM = (data[i].km - data[i - 1].km) * 1000;
    const dy  =  data[i].ele - data[i - 1].ele;
    const grade = dxM > 0 ? (dy / dxM) * 100 : 0;
    if (dy > 0) cum += dy;
    out.push({ ...data[i], gradPct: +grade.toFixed(1), cumD: Math.round(cum) });
  }
  return out;
}

// Colour a segment by its slope %: green ≤2, yellow 3-5, orange 6-10, red >10.
// Descents / flats fall in the green band.
const GRADE_GREEN = '#5B9A5E';
const GRADE_YELLOW = '#E3C13D';
const GRADE_ORANGE = '#E0883D';
const GRADE_RED = '#C0392B';
function gradeColor(g: number): string {
  if (g < 3) return GRADE_GREEN;
  if (g < 6) return GRADE_YELLOW;
  if (g <= 10) return GRADE_ORANGE;
  return GRADE_RED;
}
const GRADE_LEGEND: { color: string; label: string }[] = [
  { color: GRADE_GREEN,  label: '0–2 %' },
  { color: GRADE_YELLOW, label: '3–5 %' },
  { color: GRADE_ORANGE, label: '6–10 %' },
  { color: GRADE_RED,    label: '> 10 %' },
];

// Recharts hands the active payload to the tooltip — we just pull out
// our enriched fields and render them. Colour the slope value by sign
// (terra for climbs, green for descents, neutral for flats).
interface TooltipPayload { payload?: Point }
function HoverTooltip({ active, payload }: { active?: boolean; payload?: TooltipPayload[] }) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0]?.payload;
  if (!p) return null;
  const slopeColor = p.gradPct >=  1 ? tokens.terra
                  : p.gradPct <= -1 ? tokens.green
                  :                   tokens.inkMid;
  const slopeSign  = p.gradPct > 0 ? '+' : '';
  return (
    <div style={{
      background: tokens.surface, border: `1px solid ${tokens.creamBorder}`,
      borderRadius: 4, padding: '10px 12px', minWidth: 160,
      fontFamily: "'Space Grotesk'", fontSize: 12, color: tokens.ink,
      boxShadow: '0 6px 20px rgba(0,0,0,0.08)',
    }}>
      <div style={{ fontWeight: 700, fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: tokens.inkLight, marginBottom: 6 }}>
        {p.km.toFixed(1)} km
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, lineHeight: 1.7 }}>
        <span style={{ color: tokens.inkMid }}>Altitude</span>
        <strong>{p.ele} m</strong>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, lineHeight: 1.7 }}>
        <span style={{ color: tokens.inkMid }}>Pente</span>
        <strong style={{ color: slopeColor }}>{slopeSign}{p.gradPct.toFixed(1)} %</strong>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, lineHeight: 1.7 }}>
        <span style={{ color: tokens.inkMid }}>D+ cumulé</span>
        <strong style={{ color: tokens.terra }}>↗ {p.cumD.toLocaleString()} m</strong>
      </div>
    </div>
  );
}

export function ElevationChart({ data, totalAscent, totalDescent, loading, onHover }: Props) {
  if (loading) {
    return (
      <div style={{ padding: '32px 24px', textAlign: 'center', fontFamily: "'Space Grotesk'", fontSize: 11, color: tokens.inkLight, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
        Calcul du profil d&apos;altitude…
      </div>
    );
  }
  if (!data || data.length < 2) return null;

  const enriched = enrich(data);
  // Build a horizontal gradient coloured by each segment's slope. Two stops
  // per segment (start + end offset, same colour) give hard band edges.
  const km0  = enriched[0].km;
  const span = Math.max(0.0001, enriched[enriched.length - 1].km - km0);
  const gradeStops: { offset: number; color: string }[] = [];
  for (let i = 1; i < enriched.length; i++) {
    const color = gradeColor(enriched[i].gradPct);
    gradeStops.push({ offset: (enriched[i - 1].km - km0) / span, color });
    gradeStops.push({ offset: (enriched[i].km - km0) / span, color });
  }
  const minEle   = Math.min(...enriched.map(d => d.ele));
  const maxEle   = Math.max(...enriched.map(d => d.ele));
  const padded   = Math.max(20, Math.round((maxEle - minEle) * 0.15));

  return (
    <div style={{ background: tokens.surface, border: `1px solid ${tokens.creamBorder}`, borderRadius: 4, padding: 20, marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginBottom: 12 }}>
        <Label>PROFIL D&apos;ALTITUDE</Label>
        <div style={{ display: 'flex', gap: 16, marginLeft: 'auto' }}>
          <div>
            <span style={{ fontFamily: "'Playfair Display'", fontSize: 18, fontWeight: 800, color: tokens.terra }}>
              ↗ {totalAscent.toLocaleString()} m
            </span>
            <span style={{ fontFamily: "'Space Grotesk'", fontSize: 10, color: tokens.inkLight, marginLeft: 6, letterSpacing: '0.05em', textTransform: 'uppercase' }}>D+</span>
          </div>
          <div>
            <span style={{ fontFamily: "'Playfair Display'", fontSize: 18, fontWeight: 800, color: tokens.green }}>
              ↘ {totalDescent.toLocaleString()} m
            </span>
            <span style={{ fontFamily: "'Space Grotesk'", fontSize: 10, color: tokens.inkLight, marginLeft: 6, letterSpacing: '0.05em', textTransform: 'uppercase' }}>D−</span>
          </div>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={140}>
        <AreaChart
          data={enriched}
          margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
          onMouseMove={(s) => {
            // Recharts v3 ships `activeTooltipIndex` as `number | string |
            // null` (the type is widened to accommodate Treemap-style
            // charts). Accept both numeric and stringified-number forms.
            const raw = (s as { activeTooltipIndex?: number | string | null })?.activeTooltipIndex;
            const idx = typeof raw === 'number' ? raw
                      : typeof raw === 'string' ? Number(raw)
                      :                           NaN;
            if (onHover && Number.isFinite(idx)) onHover(idx);
          }}
          onMouseLeave={() => onHover?.(null)}
        >
          <defs>
            <linearGradient id="gradeGradient" x1="0" y1="0" x2="1" y2="0">
              {gradeStops.map((s, i) => (
                <stop key={i} offset={`${Math.min(100, Math.max(0, s.offset * 100)).toFixed(3)}%`} stopColor={s.color} />
              ))}
            </linearGradient>
          </defs>
          <XAxis
            dataKey="km" type="number" domain={['dataMin', 'dataMax']}
            tickFormatter={(v) => `${v} km`}
            tick={{ fontSize: 10, fill: tokens.inkLight, fontFamily: 'Space Grotesk' }}
            axisLine={{ stroke: tokens.creamBorder }}
            tickLine={false}
          />
          <YAxis
            domain={[minEle - padded, maxEle + padded]}
            tickFormatter={(v) => `${Math.round(v)} m`}
            tick={{ fontSize: 10, fill: tokens.inkLight, fontFamily: 'Space Grotesk' }}
            axisLine={false}
            tickLine={false}
            width={50}
          />
          <Tooltip
            content={<HoverTooltip />}
            cursor={{ stroke: tokens.terra, strokeWidth: 1, strokeDasharray: '3 3' }}
          />
          <Area
            type="monotone" dataKey="ele"
            stroke="url(#gradeGradient)" strokeWidth={2.5}
            fill="url(#gradeGradient)" fillOpacity={0.5}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>

      <div style={{ marginTop: 8, display: 'flex', gap: 14, flexWrap: 'wrap', fontFamily: "'Space Grotesk'", fontSize: 10, color: tokens.inkLight, letterSpacing: '0.05em' }}>
        {GRADE_LEGEND.map(g => (
          <span key={g.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ display: 'inline-block', width: 12, height: 8, background: g.color, borderRadius: 2 }} />
            {g.label}
          </span>
        ))}
      </div>
    </div>
  );
}
