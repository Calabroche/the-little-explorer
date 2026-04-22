'use client';

import { tokens, globalStats } from './tokens';
import { Label } from './ui';

export type PageId = 'feed' | 'map' | 'stats' | 'photos';

const navItems: { id: PageId; icon: string; label: string }[] = [
  { id: 'feed',   icon: '◎', label: 'Activités' },
  { id: 'map',    icon: '◈', label: 'Carte' },
  { id: 'stats',  icon: '▬', label: 'Stats' },
  { id: 'photos', icon: '◻', label: 'Photos' },
];

export function Sidebar({ activePage, onNav }: { activePage: PageId; onNav: (id: PageId) => void }) {
  return (
    <div style={{
      width: 220, background: 'white', borderRight: `1px solid ${tokens.creamBorder}`,
      display: 'flex', flexDirection: 'column', flexShrink: 0, padding: '0 0 24px',
    }}>
      <div style={{ padding: '28px 24px 24px', borderBottom: `1px solid ${tokens.creamBorder}` }}>
        <div style={{ fontFamily: "'Playfair Display'", fontSize: 18, fontWeight: 900, color: tokens.ink, lineHeight: 1 }}>
          The Little<br />
          <em style={{ color: tokens.terra }}>Explorer</em>
        </div>
        <Label style={{ marginTop: 6, display: 'block' }}>Florian Calabrese</Label>
      </div>

      <nav style={{ padding: '16px 12px', flex: 1 }}>
        {navItems.map(item => {
          const active = activePage === item.id;
          return (
            <div key={item.id} onClick={() => onNav(item.id)} style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px',
              borderRadius: 3, cursor: 'pointer', marginBottom: 2,
              background: active ? tokens.terraLight : 'transparent',
              color: active ? tokens.terra : tokens.inkMid,
              transition: 'background 0.12s, color 0.12s',
            }}
              onMouseEnter={e => { if (!active) (e.currentTarget as HTMLDivElement).style.background = tokens.creamDark; }}
              onMouseLeave={e => { if (!active) (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
            >
              <span style={{ fontSize: 13, width: 16, textAlign: 'center' }}>{item.icon}</span>
              <span style={{ fontFamily: "'Space Grotesk'", fontSize: 13, fontWeight: active ? 600 : 400, letterSpacing: '0.02em' }}>
                {item.label}
              </span>
            </div>
          );
        })}
      </nav>

      <div style={{ margin: '0 12px', padding: 16, background: tokens.creamDark, borderRadius: 4 }}>
        <Label style={{ display: 'block', marginBottom: 12 }}>En un coup d&apos;œil</Label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {[
            { v: globalStats.totalActivities, u: 'sorties' },
            { v: globalStats.totalDistance + 'k', u: 'km' },
            { v: globalStats.totalElevation + 'k', u: 'm D+' },
            { v: globalStats.totalHours + 'h', u: 'total' },
          ].map((s, i) => (
            <div key={i}>
              <div style={{ fontFamily: "'Playfair Display'", fontSize: 18, fontWeight: 700, color: tokens.ink }}>{s.v}</div>
              <Label>{s.u}</Label>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
