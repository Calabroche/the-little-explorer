'use client';

import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis, ReferenceArea } from 'recharts';
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

// Highlight x-bands where the local gradient exceeds STEEP_PCT — cheap
// way to give the user "where are the climbs" without computing a
// multi-coloured custom shape.
const STEEP_PCT = 5;

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

function steepBands(data: Point[]): { x1: number; x2: number }[] {
  if (data.length < 2) return [];
  const bands: { x1: number; x2: number }[] = [];
  let bandStart: number | null = null;
  for (let i = 1; i < data.length; i++) {
    const isSteep = data[i].gradPct >= STEEP_PCT;
    if (isSteep && bandStart == null) bandStart = data[i - 1].km;
    if ((!isSteep || i === data.length - 1) && bandStart != null) {
      const end = !isSteep ? data[i - 1].km : data[i].km;
      if (end > bandStart) bands.push({ x1: bandStart, x2: end });
      bandStart = null;
    }
  }
  return bands;
}

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
  const bands    = steepBands(enriched);
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
            <linearGradient id="eleGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor={tokens.green}     stopOpacity={0.8} />
              <stop offset="100%" stopColor={tokens.greenLight} stopOpacity={0.2} />
            </linearGradient>
          </defs>
          {bands.map((b, i) => (
            <ReferenceArea
              key={i}
              x1={b.x1} x2={b.x2}
              y1={minEle - padded} y2={maxEle + padded}
              fill={tokens.terra} fillOpacity={0.12} stroke="none"
            />
          ))}
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
            stroke={tokens.green} strokeWidth={2}
            fill="url(#eleGradient)"
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>

      <div style={{ marginTop: 8, fontFamily: "'Space Grotesk'", fontSize: 10, color: tokens.inkLight, letterSpacing: '0.05em' }}>
        <span style={{ display: 'inline-block', width: 12, height: 8, background: tokens.terra, opacity: 0.25, borderRadius: 2, verticalAlign: 'middle', marginRight: 6 }} />
        Sections à plus de {STEEP_PCT}% de pente
      </div>
    </div>
  );
}
