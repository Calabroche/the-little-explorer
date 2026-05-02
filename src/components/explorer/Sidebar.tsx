'use client';

import { tokens, GlobalStats } from './tokens';
import { Label } from './ui';

export type PageId = 'feed' | 'planner' | 'map' | 'stats' | 'photos' | 'ftp';

const navItems: { id: PageId; icon: string; label: string }[] = [
  { id: 'feed',    icon: '◎', label: 'Activités' },
  { id: 'planner', icon: '✦', label: 'Planificateur' },
  { id: 'map',     icon: '◈', label: 'Carte' },
  { id: 'stats',   icon: '▬', label: 'Stats' },
  { id: 'ftp',     icon: '⚡', label: 'FTP' },
  { id: 'photos',  icon: '◻', label: 'Photos' },
];

interface Props {
  activePage: PageId;
  onNav: (id: PageId) => void;
  stats: GlobalStats | null;
  darkMode: boolean;
  onToggleDark: () => void;
  mobile?: boolean;
}

export function Sidebar({ activePage, onNav, stats, darkMode, onToggleDark, mobile }: Props) {
  if (mobile) {
    return (
      <div style={{
        height: 60, background: tokens.surface, borderTop: `1px solid ${tokens.creamBorder}`,
        display: 'flex', flexShrink: 0,
      }}>
        {navItems.map(item => {
          const active = activePage === item.id;
          return (
            <div key={item.id} onClick={() => onNav(item.id)} style={{
              flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
              justifyContent: 'center', gap: 3, cursor: 'pointer',
              color: active ? tokens.terra : tokens.inkMid,
            }}>
              <span style={{ fontSize: 18 }}>{item.icon}</span>
              <span style={{ fontFamily: "'Space Grotesk'", fontSize: 9, fontWeight: active ? 600 : 400, letterSpacing: '0.05em' }}>
                {item.label}
              </span>
            </div>
          );
        })}
        <div onClick={onToggleDark} style={{
          width: 52, display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', gap: 3, cursor: 'pointer', color: tokens.inkMid,
          borderLeft: `1px solid ${tokens.creamBorder}`,
        }}>
          <span style={{ fontSize: 18 }}>{darkMode ? '◑' : '◐'}</span>
          <span style={{ fontFamily: "'Space Grotesk'", fontSize: 9, letterSpacing: '0.05em' }}>Mode</span>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      width: 220, background: tokens.surface, borderRight: `1px solid ${tokens.creamBorder}`,
      display: 'flex', flexDirection: 'column', flexShrink: 0, padding: '0 0 24px',
    }}>
      <div style={{ padding: '28px 24px 24px', borderBottom: `1px solid ${tokens.creamBorder}` }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div style={{ fontFamily: "'Playfair Display'", fontSize: 18, fontWeight: 900, color: tokens.ink, lineHeight: 1 }}>
            The Little<br />
            <em style={{ color: tokens.terra }}>Explorer</em>
          </div>
          <button
            onClick={onToggleDark}
            title={darkMode ? 'Mode clair' : 'Mode sombre'}
            style={{
              background: tokens.creamDark, border: `1px solid ${tokens.creamBorder}`,
              borderRadius: 20, padding: '4px 10px', cursor: 'pointer',
              fontFamily: "'Space Grotesk'", fontSize: 13, color: tokens.inkMid,
              lineHeight: 1, flexShrink: 0,
            }}
          >
            {darkMode ? '◑' : '◐'}
          </button>
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

      {stats && (
        <div style={{ margin: '0 12px', padding: 16, background: tokens.creamDark, borderRadius: 4 }}>
          <Label style={{ display: 'block', marginBottom: 12 }}>En un coup d&apos;œil</Label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {[
              { v: stats.totalActivities,              u: 'sorties' },
              { v: stats.totalDistance + ' km',        u: 'distance' },
              { v: stats.totalElevation + ' m',        u: 'D+' },
              { v: stats.totalHours + 'h',             u: 'total' },
            ].map((s, i) => (
              <div key={i}>
                <div style={{ fontFamily: "'Playfair Display'", fontSize: 18, fontWeight: 700, color: tokens.ink }}>{s.v}</div>
                <Label>{s.u}</Label>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
