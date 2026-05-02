'use client';

import { tokens, Activity, GlobalStats } from '../tokens';
import { SectionTag, Label, useIsMobile } from '../ui';
import { ActivityCard } from '../ActivityCard';

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
  if (last5.length < 2) return null;

  const gaps: number[] = [];
  for (let i = 0; i < last5.length - 1; i++)
    gaps.push(daysBetween(last5[i].rawDate, last5[i + 1].rawDate));
  const avgGap = Math.round(gaps.reduce((s, v) => s + v, 0) / gaps.length);

  const nextDate = new Date(last5[0].rawDate);
  nextDate.setDate(nextDate.getDate() + avgGap);
  const daysUntil = daysBetween(nextDate.toISOString(), new Date().toISOString());

  const tssValues = last5.map(a => a.tss).filter((t): t is number => t != null);
  const avgTSS    = tssValues.length ? Math.round(tssValues.reduce((s, v) => s + v, 0) / tssValues.length) : null;
  const lastTSS   = tssValues[0] ?? null;
  const targetTSS = avgTSS ? Math.round(avgTSS * 1.1) : null;
  const tssMax    = tssValues.length ? Math.max(...tssValues) : 1;

  let advice = 'Maintiens ta régularité et augmente progressivement le volume.';
  if (lastTSS && avgTSS) {
    if (lastTSS > avgTSS * 1.3)
      advice = 'Sortie intense récente — prévois une séance légère ou récupération active.';
    else if (lastTSS < avgTSS * 0.7)
      advice = 'Sortie légère récente — tu peux remettre le paquet sur la prochaine.';
    else if (avgTSS > 80)
      advice = 'Charge élevée maintenue. Surveille ta récupération, intègre une semaine allégée.';
  }

  const avgDist = Math.round(last5.reduce((s, a) => s + a.distance, 0) / last5.length);
  const avgElev = Math.round(last5.reduce((s, a) => s + a.elevation, 0) / last5.length);

  const CARD: React.CSSProperties = {
    background: tokens.surface, border: `1px solid ${tokens.creamBorder}`,
    borderRadius: 4, padding: 24, marginBottom: 32,
  };

  return (
    <div style={CARD}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <Label style={{ color: tokens.terra }}>§ PROGRAMME</Label>
        <div style={{ width: 24, height: 1, background: tokens.creamBorder }} />
        <Label>ANALYSE & PROCHAINE SORTIE</Label>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr 1fr', gap: isMobile ? 20 : 24 }}>

        {/* TSS + Power trend bars */}
        <div>
          <Label style={{ display: 'block', marginBottom: 12 }}>5 DERNIÈRES SORTIES — TSS</Label>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 60 }}>
            {last5.slice().reverse().map((a, i) => {
              const tss = a.tss ?? 0;
              const h   = tssMax ? Math.max(4, (tss / tssMax) * 100) : 4;
              return (
                <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <div style={{ width: '100%', height: `${h}%`, background: tokens.terra, borderRadius: 2, opacity: 0.55 + i * 0.09 }} />
                  <Label style={{ fontSize: 8 }}>{tss || '—'}</Label>
                </div>
              );
            })}
          </div>
          {/* Avg power per ride */}
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            {last5.slice().reverse().map((a, i) => (
              <div key={i} style={{ flex: 1, textAlign: 'center' }}>
                {a.avg_power != null
                  ? <Label style={{ fontSize: 8, color: tokens.green }}>{a.avg_power}W</Label>
                  : <Label style={{ fontSize: 8 }}>—</Label>}
              </div>
            ))}
          </div>
          <Label style={{ fontSize: 9, color: tokens.green, marginTop: 2, display: 'block' }}>puissance moy. par sortie</Label>
          <div style={{ marginTop: 10, display: 'flex', gap: 20 }}>
            <div>
              <Label style={{ display: 'block', marginBottom: 3 }}>INTERVALLE MOY.</Label>
              <span style={{ fontFamily: "'Playfair Display'", fontSize: 20, fontWeight: 700, color: tokens.ink }}>
                {avgGap}j
              </span>
            </div>
            {avgTSS && (
              <div>
                <Label style={{ display: 'block', marginBottom: 3 }}>TSS MOY.</Label>
                <span style={{ fontFamily: "'Playfair Display'", fontSize: 20, fontWeight: 700, color: tokens.ink }}>
                  {avgTSS}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Next ride prediction */}
        <div style={{ borderLeft: isMobile ? 'none' : `1px solid ${tokens.creamBorder}`, paddingLeft: isMobile ? 0 : 24, borderTop: isMobile ? `1px solid ${tokens.creamBorder}` : 'none', paddingTop: isMobile ? 20 : 0 }}>
          <Label style={{ display: 'block', marginBottom: 12 }}>PROCHAINE SORTIE PRÉVUE</Label>
          <div style={{ fontFamily: "'Playfair Display'", fontSize: 18, fontWeight: 700, color: tokens.terra, lineHeight: 1.3, marginBottom: 6 }}>
            {formatPredictedDate(nextDate.toISOString())}
          </div>
          <div style={{ fontFamily: "'Space Grotesk'", fontSize: 12, color: tokens.inkLight, marginBottom: 16 }}>
            {daysUntil > 0
              ? `Dans ${daysUntil} jour${daysUntil > 1 ? 's' : ''}`
              : daysUntil === 0 ? "Aujourd'hui !"
              : `Dépassé de ${Math.abs(daysUntil)}j`}
          </div>
          <div style={{ display: 'flex', gap: 20 }}>
            <div>
              <Label style={{ display: 'block', marginBottom: 3 }}>DISTANCE</Label>
              <span style={{ fontFamily: "'Playfair Display'", fontSize: 20, fontWeight: 700, color: tokens.ink }}>
                {avgDist}<span style={{ fontSize: 11, fontFamily: "'Space Grotesk'", color: tokens.inkLight, marginLeft: 3 }}>km</span>
              </span>
            </div>
            <div>
              <Label style={{ display: 'block', marginBottom: 3 }}>D+</Label>
              <span style={{ fontFamily: "'Playfair Display'", fontSize: 20, fontWeight: 700, color: tokens.ink }}>
                {avgElev}<span style={{ fontSize: 11, fontFamily: "'Space Grotesk'", color: tokens.inkLight, marginLeft: 3 }}>m</span>
              </span>
            </div>
            {targetTSS && (
              <div>
                <Label style={{ display: 'block', marginBottom: 3 }}>TSS CIBLE</Label>
                <span style={{ fontFamily: "'Playfair Display'", fontSize: 20, fontWeight: 700, color: tokens.terra }}>
                  {targetTSS}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Advice + TSS explainer */}
        <div style={{ borderLeft: isMobile ? 'none' : `1px solid ${tokens.creamBorder}`, paddingLeft: isMobile ? 0 : 24, borderTop: isMobile ? `1px solid ${tokens.creamBorder}` : 'none', paddingTop: isMobile ? 20 : 0 }}>
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
