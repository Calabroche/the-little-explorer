'use client';

import { globalStats, tokens } from '../tokens';
import { SectionTag, StatBar, Label } from '../ui';

const months = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const monthValues = [3, 5, 8, 12, 0, 0, 0, 0, 0, 0, 0, 0];

export function StatsPage() {
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '32px 40px' }}>
      <SectionTag num={3} title="STATISTIQUES" />
      <h1 style={{ fontFamily: "'Playfair Display'", fontSize: 40, fontWeight: 900, color: tokens.ink, marginBottom: 40, lineHeight: 1.1 }}>
        {globalStats.totalDistance.toLocaleString()} km<br />
        <em style={{ color: tokens.terra, fontStyle: 'italic' }}>parcourus.</em>
      </h1>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        <div style={{ background: 'white', border: `1px solid ${tokens.creamBorder}`, borderRadius: 4, padding: 24 }}>
          <Label style={{ display: 'block', marginBottom: 20 }}>DISTANCE · PAR ACTIVITÉ</Label>
          <StatBar label="Vélo · total" value={1840} max={3000} unit="km" color={tokens.terra} />
          <StatBar label="Randonnée · total" value={1007} max={3000} unit="km" color={tokens.green} />
          <StatBar label="Sortie la plus longue" value={87} max={100} unit="km" color={tokens.blue} />
          <StatBar label="Moyenne / sortie" value={32} max={100} unit="km" color={tokens.inkLight} />
        </div>

        <div style={{ background: 'white', border: `1px solid ${tokens.creamBorder}`, borderRadius: 4, padding: 24 }}>
          <Label style={{ display: 'block', marginBottom: 20 }}>DÉNIVELÉ · CUMULÉ</Label>
          <StatBar label="Total D+" value={48200} max={50000} unit="m" color={tokens.terra} />
          <StatBar label="Vélo · D+" value={28400} max={50000} unit="m" color={tokens.terra} />
          <StatBar label="Rando · D+" value={19800} max={50000} unit="m" color={tokens.green} />
          <StatBar label="Record sortie" value={1640} max={2000} unit="m" color={tokens.blue} />
        </div>

        <div style={{ background: 'white', border: `1px solid ${tokens.creamBorder}`, borderRadius: 4, padding: 24, gridColumn: '1/-1' }}>
          <Label style={{ display: 'block', marginBottom: 20 }}>ACTIVITÉ · PAR MOIS 2026</Label>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 100 }}>
            {months.map((m, i) => {
              const val = monthValues[i];
              const h = val ? (val / 12) * 100 : 0;
              return (
                <div key={m} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <div style={{
                    width: '100%', height: h + '%', minHeight: val ? 4 : 0,
                    background: i === 3 ? tokens.terra : (val ? tokens.inkLight : tokens.creamBorder),
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
