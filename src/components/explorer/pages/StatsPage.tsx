'use client';

import { tokens, Activity, GlobalStats } from '../tokens';
import { SectionTag, StatBar, Label, useIsMobile } from '../ui';

interface Props {
  activities: Activity[];
  stats: GlobalStats;
}

const MONTH_LABELS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

export function StatsPage({ activities, stats }: Props) {
  const cycling = activities.filter(a => a.type === 'cycling');
  const hiking  = activities.filter(a => a.type === 'hiking');

  const cyclingDist   = +cycling.reduce((s, a) => s + a.distance, 0).toFixed(0);
  const hikingDist    = +hiking.reduce((s, a) => s + a.distance, 0).toFixed(0);
  const longestRide   = +Math.max(...cycling.map(a => a.distance), 0).toFixed(0);
  const avgDist       = activities.length ? +(stats.totalDistance / activities.length).toFixed(0) : 0;
  const cyclingElev   = +cycling.reduce((s, a) => s + a.elevation, 0).toFixed(0);
  const hikingElev    = +hiking.reduce((s, a) => s + a.elevation, 0).toFixed(0);
  const recordElev    = +Math.max(...activities.map(a => a.elevation), 0).toFixed(0);
  const distMax       = Math.max(cyclingDist, hikingDist, 1);

  // Monthly activity count for current year
  const currentYear = new Date().getFullYear();
  const monthValues = Array(12).fill(0);
  activities.forEach(a => {
    const d = new Date(a.rawDate);
    if (d.getFullYear() === currentYear) monthValues[d.getMonth()]++;
  });
  const maxMonth = Math.max(...monthValues, 1);
  const currentMonth = new Date().getMonth();

  const isMobile = useIsMobile();
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '20px 16px' : '32px 40px' }}>
      <SectionTag num={3} title="STATISTIQUES" />
      <h1 style={{ fontFamily: "'Playfair Display'", fontSize: isMobile ? 28 : 40, fontWeight: 900, color: tokens.ink, marginBottom: isMobile ? 20 : 40, lineHeight: 1.1 }}>
        {stats.totalDistance.toLocaleString()} km<br />
        <em style={{ color: tokens.terra, fontStyle: 'italic' }}>parcourus.</em>
      </h1>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: isMobile ? 16 : 24 }}>
        <div style={{ background: tokens.surface, border: `1px solid ${tokens.creamBorder}`, borderRadius: 4, padding: 24 }}>
          <Label style={{ display: 'block', marginBottom: 20 }}>DISTANCE · PAR ACTIVITÉ</Label>
          <StatBar label="Vélo · total"        value={cyclingDist} max={distMax * 1.2 || 1} unit="km" color={tokens.terra} />
          <StatBar label="Randonnée · total"   value={hikingDist}  max={distMax * 1.2 || 1} unit="km" color={tokens.green} />
          <StatBar label="Sortie la plus longue" value={longestRide} max={longestRide * 1.5 || 1} unit="km" color={tokens.blue} />
          <StatBar label="Moyenne / sortie"    value={avgDist}     max={longestRide || 1}     unit="km" color={tokens.inkLight} />
        </div>

        <div style={{ background: tokens.surface, border: `1px solid ${tokens.creamBorder}`, borderRadius: 4, padding: 24 }}>
          <Label style={{ display: 'block', marginBottom: 20 }}>DÉNIVELÉ · CUMULÉ</Label>
          <StatBar label="Total D+"      value={stats.totalElevation} max={stats.totalElevation * 1.1 || 1} unit="m" color={tokens.terra} />
          <StatBar label="Vélo · D+"    value={cyclingElev}           max={stats.totalElevation || 1}        unit="m" color={tokens.terra} />
          <StatBar label="Rando · D+"   value={hikingElev}            max={stats.totalElevation || 1}        unit="m" color={tokens.green} />
          <StatBar label="Record sortie" value={recordElev}           max={stats.totalElevation || 1}        unit="m" color={tokens.blue} />
        </div>

        <div style={{ background: tokens.surface, border: `1px solid ${tokens.creamBorder}`, borderRadius: 4, padding: 24, gridColumn: '1/-1' }}>
          <Label style={{ display: 'block', marginBottom: 20 }}>ACTIVITÉ · PAR MOIS {currentYear}</Label>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 100 }}>
            {MONTH_LABELS.map((m, i) => {
              const val = monthValues[i];
              const h = val ? (val / maxMonth) * 100 : 0;
              return (
                <div key={m} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <div style={{
                    width: '100%', height: h + '%', minHeight: val ? 4 : 0,
                    background: i === currentMonth ? tokens.terra : (val ? tokens.inkLight : tokens.creamBorder),
                    borderRadius: '2px 2px 0 0', transition: 'height 1s cubic-bezier(0.16,1,0.3,1)',
                  }} />
                  <Label style={{ fontSize: 9 }}>{m}</Label>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
