'use client';

import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis, ReferenceArea } from 'recharts';
import { tokens } from '../tokens';
import { Label } from '../ui';

interface Props {
  data:        { km: number; ele: number }[];
  totalAscent:  number;
  totalDescent: number;
  loading?:     boolean;
}

// Highlight x-bands where the local gradient exceeds STEEP_PCT — cheap
// way to give the user "where are the climbs" without computing a
// multi-coloured custom shape.
const STEEP_PCT = 5;

function steepBands(data: { km: number; ele: number }[]): { x1: number; x2: number }[] {
  if (data.length < 2) return [];
  const bands: { x1: number; x2: number }[] = [];
  let bandStart: number | null = null;
  for (let i = 1; i < data.length; i++) {
    const dx = (data[i].km - data[i - 1].km) * 1000;
    const dy =  data[i].ele - data[i - 1].ele;
    const grade = dx > 0 ? (dy / dx) * 100 : 0;
    const isSteep = grade >= STEEP_PCT;
    if (isSteep && bandStart == null) bandStart = data[i - 1].km;
    if ((!isSteep || i === data.length - 1) && bandStart != null) {
      const end = !isSteep ? data[i - 1].km : data[i].km;
      if (end > bandStart) bands.push({ x1: bandStart, x2: end });
      bandStart = null;
    }
  }
  return bands;
}

export function ElevationChart({ data, totalAscent, totalDescent, loading }: Props) {
  if (loading) {
    return (
      <div style={{ padding: '32px 24px', textAlign: 'center', fontFamily: "'Space Grotesk'", fontSize: 11, color: tokens.inkLight, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
        Calcul du profil d&apos;altitude…
      </div>
    );
  }
  if (!data || data.length < 2) return null;

  const bands  = steepBands(data);
  const minEle = Math.min(...data.map(d => d.ele));
  const maxEle = Math.max(...data.map(d => d.ele));
  const padded = Math.max(20, Math.round((maxEle - minEle) * 0.15));

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
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
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
            contentStyle={{
              background: tokens.surface, border: `1px solid ${tokens.creamBorder}`,
              borderRadius: 4, fontFamily: 'Space Grotesk', fontSize: 12,
            }}
            formatter={(v, name) => name === 'ele' ? [`${v} m`, 'Altitude'] : [v as string | number, name as string]}
            labelFormatter={(v) => `${v} km`}
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
