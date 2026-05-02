'use client';

import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { tokens, Activity, GlobalStats } from '../tokens';
import { SectionTag, Label, useIsMobile } from '../ui';
import { ActivityCard } from '../ActivityCard';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function TssChartTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div style={{
      background: tokens.surface, border: `1px solid ${tokens.creamBorder}`,
      borderRadius: 4, padding: '8px 10px',
      fontFamily: "'Space Grotesk'", fontSize: 11, color: tokens.ink,
      boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
    }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>{p.dateFull}</div>
      <div style={{ color: tokens.terra }}>TSS : <strong>{p.tss}</strong></div>
      {p.power != null && (
        <div style={{ color: tokens.green }}>Puissance : <strong>{p.power} W</strong></div>
      )}
      <div style={{ color: tokens.inkLight, marginTop: 2 }}>{p.distance} km · {p.elev} m D+</div>
    </div>
  );
}

// ── Training Program ──────────────────────────────────────────────────────────

function daysBetween(a: string, b: string) {
  return Math.round((new Date(a).getTime() - new Date(b).getTime()) / 86400000);
}

function formatPredictedDate(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}

function TrainingProgram({ activities }: { activities: Activity[] }) {
  const isMobile = useIsMobile();
  const sorted = [...activities].sort((a, b) => new Date(b.rawDate).getTime() - new Date(a.rawDate).getTime());
  const last5  = sorted.slice(0, 5);
  const last10 = sorted.slice(0, 10);
  if (last5.length < 2) return null;

  // Gap moyen + prochaine sortie : basés sur les 5 dernières (tendance récente).
  const gaps: number[] = [];
  for (let i = 0; i < last5.length - 1; i++)
    gaps.push(daysBetween(last5[i].rawDate, last5[i + 1].rawDate));
  const avgGap = Math.round(gaps.reduce((s, v) => s + v, 0) / gaps.length);

  const nextDate = new Date(last5[0].rawDate);
  nextDate.setDate(nextDate.getDate() + avgGap);
  const daysUntil = daysBetween(nextDate.toISOString(), new Date().toISOString());

  // TSS chart : 10 sorties.
  const tssValues10 = last10.map(a => a.tss).filter((t): t is number => t != null);
  const avgTSS10    = tssValues10.length ? Math.round(tssValues10.reduce((s, v) => s + v, 0) / tssValues10.length) : null;

  // Moyennes sur TOUTES les sorties (référence sur le graph).
  const tssValuesAll = activities.map(a => a.tss).filter((t): t is number => t != null);
  const avgTSSAll    = tssValuesAll.length ? Math.round(tssValuesAll.reduce((s, v) => s + v, 0) / tssValuesAll.length) : null;
  const powerValuesAll = activities.map(a => a.avg_power).filter((p): p is number => p != null);
  const avgPowerAll    = powerValuesAll.length ? Math.round(powerValuesAll.reduce((s, v) => s + v, 0) / powerValuesAll.length) : null;

  // Données du graphique : ordre chronologique (ancien → récent).
  const chartData = last10.slice().reverse().map(a => {
    const d = new Date(a.rawDate);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return {
      date:     `${dd}/${mm}`,
      dateFull: d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'long' }),
      tss:      a.tss ?? 0,
      power:    a.avg_power ?? null,
      distance: a.distance,
      elev:     a.elevation,
    };
  });

  // Conseils + TSS cible : basés sur les 5 dernières (tendance récente).
  const tssValues5 = last5.map(a => a.tss).filter((t): t is number => t != null);
  const avgTSS5    = tssValues5.length ? Math.round(tssValues5.reduce((s, v) => s + v, 0) / tssValues5.length) : null;
  const lastTSS    = tssValues5[0] ?? null;
  const targetTSS  = avgTSS5 ? Math.round(avgTSS5 * 1.1) : null;

  let advice = 'Maintiens ta régularité et augmente progressivement le volume.';
  if (lastTSS && avgTSS5) {
    if (lastTSS > avgTSS5 * 1.3)
      advice = 'Sortie intense récente — prévois une séance légère ou récupération active.';
    else if (lastTSS < avgTSS5 * 0.7)
      advice = 'Sortie légère récente — tu peux remettre le paquet sur la prochaine.';
    else if (avgTSS5 > 80)
      advice = 'Charge élevée maintenue. Surveille ta récupération, intègre une semaine allégée.';
  }

  const avgDist = Math.round(last5.reduce((s, a) => s + a.distance, 0) / last5.length);
  const avgElev = Math.round(last5.reduce((s, a) => s + a.elevation, 0) / last5.length);

  const CARD: React.CSSProperties = {
    background: tokens.surface, border: `1px solid ${tokens.creamBorder}`,
    borderRadius: 4, padding: 24, marginBottom: 32,
  };

  const NEXT_RIDE_STAT: React.CSSProperties = {
    display: 'flex', flexDirection: 'column', gap: 1,
  };

  return (
    <div style={CARD}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <Label style={{ color: tokens.terra }}>§ PROGRAMME</Label>
        <div style={{ width: 24, height: 1, background: tokens.creamBorder }} />
        <Label>ANALYSE & PROCHAINE SORTIE</Label>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1.4fr 1fr', gap: isMobile ? 20 : 28 }}>

        {/* Col 1 : TSS chart (10 sorties) + next ride compact dessous */}
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
            <Label>10 DERNIÈRES SORTIES — TSS &amp; PUISSANCE</Label>
            <div style={{ display: 'flex', gap: 12, fontFamily: "'Space Grotesk'", fontSize: 9, color: tokens.inkLight }}>
              <span><span style={{ display: 'inline-block', width: 8, height: 8, background: tokens.terra, marginRight: 4, verticalAlign: 'middle' }} />TSS</span>
              <span><span style={{ display: 'inline-block', width: 12, height: 2, background: tokens.green, marginRight: 4, verticalAlign: 'middle' }} />W moy.</span>
            </div>
          </div>
          <div style={{ width: '100%', height: 180 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 8, right: 4, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={tokens.creamBorder} vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fontFamily: "'Space Grotesk'", fontSize: 10, fill: tokens.inkLight }}
                  tickLine={false}
                  axisLine={{ stroke: tokens.creamBorder }}
                />
                <YAxis
                  yAxisId="tss"
                  orientation="left"
                  width={32}
                  tick={{ fontFamily: "'Space Grotesk'", fontSize: 10, fill: tokens.inkLight }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  yAxisId="pow"
                  orientation="right"
                  width={36}
                  tick={{ fontFamily: "'Space Grotesk'", fontSize: 10, fill: tokens.inkLight }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={v => `${v}W`}
                />
                <Tooltip content={<TssChartTooltip />} cursor={{ fill: tokens.creamBorder, opacity: 0.4 }} />
                {avgTSSAll != null && (
                  <ReferenceLine
                    yAxisId="tss"
                    y={avgTSSAll}
                    stroke={tokens.terra}
                    strokeDasharray="4 4"
                    strokeOpacity={0.6}
                    label={{ value: `moy. ${avgTSSAll}`, position: 'insideTopLeft', fill: tokens.terra, fontFamily: "'Space Grotesk'", fontSize: 9 }}
                  />
                )}
                {avgPowerAll != null && (
                  <ReferenceLine
                    yAxisId="pow"
                    y={avgPowerAll}
                    stroke={tokens.green}
                    strokeDasharray="4 4"
                    strokeOpacity={0.6}
                    label={{ value: `moy. ${avgPowerAll}W`, position: 'insideBottomRight', fill: tokens.green, fontFamily: "'Space Grotesk'", fontSize: 9 }}
                  />
                )}
                <Bar
                  yAxisId="tss"
                  dataKey="tss"
                  name="TSS"
                  fill={tokens.terra}
                  radius={[3, 3, 0, 0]}
                  maxBarSize={32}
                />
                <Line
                  yAxisId="pow"
                  type="monotone"
                  dataKey="power"
                  name="Puissance moy."
                  stroke={tokens.green}
                  strokeWidth={2}
                  dot={{ r: 3, fill: tokens.green, strokeWidth: 0 }}
                  connectNulls
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <div style={{ marginTop: 12, display: 'flex', gap: 24 }}>
            <div>
              <Label style={{ display: 'block', marginBottom: 3 }}>INTERVALLE MOY.</Label>
              <span style={{ fontFamily: "'Playfair Display'", fontSize: 20, fontWeight: 700, color: tokens.ink }}>
                {avgGap}j
              </span>
            </div>
            {avgTSS10 && (
              <div>
                <Label style={{ display: 'block', marginBottom: 3 }}>TSS MOY. (10)</Label>
                <span style={{ fontFamily: "'Playfair Display'", fontSize: 20, fontWeight: 700, color: tokens.ink }}>
                  {avgTSS10}
                </span>
              </div>
            )}
          </div>

          {/* Prochaine sortie — compact, sous le graphique */}
          <div style={{
            marginTop: 18, paddingTop: 14, borderTop: `1px solid ${tokens.creamBorder}`,
            display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
          }}>
            <div>
              <Label style={{ display: 'block', marginBottom: 2 }}>PROCHAINE SORTIE</Label>
              <div style={{ fontFamily: "'Playfair Display'", fontSize: 14, fontWeight: 700, color: tokens.terra, lineHeight: 1.2 }}>
                {formatPredictedDate(nextDate.toISOString())}
              </div>
              <div style={{ fontFamily: "'Space Grotesk'", fontSize: 10, color: tokens.inkLight, marginTop: 1 }}>
                {daysUntil > 0
                  ? `dans ${daysUntil} jour${daysUntil > 1 ? 's' : ''}`
                  : daysUntil === 0 ? "aujourd'hui"
                  : `dépassé de ${Math.abs(daysUntil)}j`}
              </div>
            </div>
            <div style={{ width: 1, alignSelf: 'stretch', background: tokens.creamBorder }} />
            <div style={NEXT_RIDE_STAT}>
              <Label>DIST.</Label>
              <span style={{ fontFamily: "'Playfair Display'", fontSize: 14, fontWeight: 700, color: tokens.ink }}>
                {avgDist}<span style={{ fontSize: 9, fontFamily: "'Space Grotesk'", color: tokens.inkLight, marginLeft: 2 }}>km</span>
              </span>
            </div>
            <div style={NEXT_RIDE_STAT}>
              <Label>D+</Label>
              <span style={{ fontFamily: "'Playfair Display'", fontSize: 14, fontWeight: 700, color: tokens.ink }}>
                {avgElev}<span style={{ fontSize: 9, fontFamily: "'Space Grotesk'", color: tokens.inkLight, marginLeft: 2 }}>m</span>
              </span>
            </div>
            {targetTSS && (
              <div style={NEXT_RIDE_STAT}>
                <Label>TSS CIBLE</Label>
                <span style={{ fontFamily: "'Playfair Display'", fontSize: 14, fontWeight: 700, color: tokens.terra }}>
                  {targetTSS}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Col 2 : Recommandation + Règle 10% + TSS explainer */}
        <div style={{
          borderLeft: isMobile ? 'none' : `1px solid ${tokens.creamBorder}`,
          paddingLeft: isMobile ? 0 : 24,
          borderTop: isMobile ? `1px solid ${tokens.creamBorder}` : 'none',
          paddingTop: isMobile ? 20 : 0,
        }}>
          <Label style={{ display: 'block', marginBottom: 12 }}>RECOMMANDATION</Label>
          <p style={{ fontFamily: "'Space Grotesk'", fontSize: 13, color: tokens.inkMid, lineHeight: 1.7, marginBottom: 14 }}>
            {advice}
          </p>
          <div style={{ padding: '10px 14px', background: tokens.creamDark, borderRadius: 4, fontFamily: "'Space Grotesk'", fontSize: 11, color: tokens.inkLight, lineHeight: 1.8, marginBottom: 12 }}>
            <strong style={{ color: tokens.ink }}>Règle des 10%</strong><br />
            N&apos;augmente pas le TSS hebdomadaire de plus de 10% par semaine.
          </div>
          <div style={{ padding: '10px 14px', background: tokens.creamDark, borderRadius: 4, fontFamily: "'Space Grotesk'", fontSize: 11, color: tokens.inkLight, lineHeight: 1.8 }}>
            <strong style={{ color: tokens.terra }}>Qu&apos;est-ce que le TSS ?</strong><br />
            <strong>T</strong>raining <strong>S</strong>tress <strong>S</strong>core mesure la charge d&apos;une sortie.<br />
            Formule : <code style={{ color: tokens.ink }}>(durée_s × NP × IF) / (FTP × 3600) × 100</code><br />
            <strong style={{ color: tokens.ink }}>FTP = 291W</strong> (66 kg × 2.205 × 2 — seuil fonctionnel estimé)<br />
            <span style={{ color: tokens.green }}>{'< 50'}</span> récupération · <span style={{ color: tokens.terra }}>50–75</span> modéré · <span style={{ color: '#e07030' }}>75–100</span> difficile · <span style={{ color: '#cc3333' }}>{'>100'}</span> très exigeant
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Last 5 averages ───────────────────────────────────────────────────────────

function avg(vals: (number | null | undefined)[]): number | null {
  const clean = vals.filter((v): v is number => v != null);
  return clean.length ? +(clean.reduce((s, v) => s + v, 0) / clean.length).toFixed(1) : null;
}

function avgInt(vals: (number | null | undefined)[]): number | null {
  const v = avg(vals);
  return v != null ? Math.round(v) : null;
}

function formatAvgDuration(activities: Activity[]): string | null {
  const mins = activities.map(a => a.duration_min).filter((v): v is number => v != null);
  if (!mins.length) return null;
  const m = Math.round(mins.reduce((s, v) => s + v, 0) / mins.length);
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function Stat({ label, value, unit, color }: { label: string; value: string | number | null; unit?: string; color?: string }) {
  if (value == null) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 80 }}>
      <span style={{ fontFamily: "'Space Grotesk'", fontSize: 10, letterSpacing: '0.08em', color: tokens.inkLight, textTransform: 'uppercase' }}>{label}</span>
      <span style={{ fontFamily: "'Playfair Display'", fontSize: 24, fontWeight: 700, color: color ?? tokens.ink, lineHeight: 1 }}>
        {value}
        {unit && <span style={{ fontFamily: "'Space Grotesk'", fontSize: 11, color: tokens.inkLight, marginLeft: 3 }}>{unit}</span>}
      </span>
    </div>
  );
}

function Last5Stats({ activities }: { activities: Activity[] }) {
  const sorted = [...activities].sort((a, b) => new Date(b.rawDate).getTime() - new Date(a.rawDate).getTime());
  const last5  = sorted.slice(0, 5);
  if (last5.length < 2) return null;

  const dur      = formatAvgDuration(last5);
  const dist     = avg(last5.map(a => a.distance));
  const elev     = avgInt(last5.map(a => a.elevation));
  const speed    = avg(last5.map(a => a.speed));
  const hr       = avgInt(last5.map(a => a.avg_hr));
  const np       = avgInt(last5.map(a => a.np));
  const avgPower = avgInt(last5.map(a => a.avg_power));
  const tss      = avgInt(last5.map(a => a.tss));
  const wkg      = avg(last5.map(a => a.wkg));
  const cal      = avgInt(last5.map(a => a.calories));

  const CARD: React.CSSProperties = {
    background: tokens.surface, border: `1px solid ${tokens.creamBorder}`,
    borderRadius: 4, padding: 24, marginBottom: 32,
  };

  return (
    <div style={CARD}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <Label style={{ color: tokens.blue }}>§ MOYENNE</Label>
        <div style={{ width: 24, height: 1, background: tokens.creamBorder }} />
        <Label>5 DERNIÈRES SORTIES</Label>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px 40px', paddingBottom: 20, borderBottom: `1px solid ${tokens.creamBorder}`, marginBottom: 20 }}>
        <Stat label="Durée"     value={dur}   />
        <Stat label="Distance"  value={dist}  unit="km" />
        <Stat label="D+"        value={elev}  unit="m" />
        <Stat label="Vitesse"   value={speed} unit="km/h" />
        {hr       && <Stat label="FC moy"   value={hr}       unit="bpm" color={tokens.terra} />}
        {avgPower && <Stat label="Puis. moy" value={avgPower} unit="W"   color={tokens.green} />}
        {np       && <Stat label="NP moy"    value={np}       unit="W"   color={tokens.green} />}
        {tss      && <Stat label="TSS"       value={tss}                 color={tokens.terra} />}
        {wkg && <Stat label="W/kg"     value={wkg}            color={tokens.blue}  />}
        {cal && <Stat label="Calories" value={cal}  unit="kcal" />}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {last5.map((a, i) => (
          <div key={a.id} style={{
            flex: 1, minWidth: 120, padding: '10px 14px',
            background: tokens.creamDark, borderRadius: 3,
            borderTop: `3px solid ${i === 0 ? tokens.terra : tokens.creamBorder}`,
          }}>
            <Label style={{ display: 'block', marginBottom: 4, fontSize: 9 }}>{a.date}</Label>
            <div style={{ fontFamily: "'Playfair Display'", fontSize: 15, fontWeight: 700, color: tokens.ink, marginBottom: 2 }}>{a.distance} km</div>
            <div style={{ fontFamily: "'Space Grotesk'", fontSize: 10, color: tokens.inkLight }}>{a.elevation} m · {a.duration}</div>
            {a.tss != null && <div style={{ fontFamily: "'Space Grotesk'", fontSize: 10, color: tokens.terra, marginTop: 2 }}>TSS {a.tss}</div>}
            {a.avg_power != null && <div style={{ fontFamily: "'Space Grotesk'", fontSize: 10, color: tokens.green, marginTop: 1 }}>{a.avg_power} W moy.</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── FeedPage ──────────────────────────────────────────────────────────────────

interface Props {
  activities: Activity[];
  stats: GlobalStats;
  onSelect: (a: Activity) => void;
}

export function FeedPage({ activities, stats, onSelect }: Props) {
  const isMobile = useIsMobile();
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '20px 16px' : '32px 40px' }}>
      <SectionTag num={1} title="ACTIVITÉS RÉCENTES" />
      <h1 style={{ fontFamily: "'Playfair Display'", fontSize: isMobile ? 28 : 40, fontWeight: 900, color: tokens.ink, lineHeight: 1.1, marginBottom: isMobile ? 20 : 32 }}>
        {stats.totalActivities} sorties.<br />
        <em style={{ color: tokens.terra, fontStyle: 'italic', fontWeight: 700 }}>Toujours plus loin.</em>
      </h1>

      <TrainingProgram activities={activities} />
      <Last5Stats activities={activities} />

      {activities.map(a => <ActivityCard key={a.id} activity={a} onClick={onSelect} />)}
    </div>
  );
}
