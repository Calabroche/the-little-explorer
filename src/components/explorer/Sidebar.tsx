'use client';

import { tokens, GlobalStats } from './tokens';
import { Label } from './ui';

export type PageId = 'feed' | 'planner' | 'map' | 'stats' | 'photos' | 'ftp';
export type SportId = 'cycling' | 'running';

const ALL_NAV_ITEMS: { id: PageId; icon: string; label: string; sports: SportId[] }[] = [
  { id: 'feed',    icon: '◎', label: 'Activités',     sports: ['cycling', 'running'] },
  { id: 'planner', icon: '✦', label: 'Planificateur', sports: ['cycling'] },
  { id: 'stats',   icon: '▬', label: 'Stats',         sports: ['cycling', 'running'] },
  { id: 'ftp',     icon: '⚡', label: 'FTP',           sports: ['cycling'] },
];

interface Props {
  activePage: PageId;
  onNav: (id: PageId) => void;
  stats: GlobalStats | null;
  darkMode: boolean;
  onToggleDark: () => void;
  mobile?: boolean;
  sport: SportId;
  onSportChange: (s: SportId) => void;
}

function SportToggle({ sport, onChange, compact }: { sport: SportId; onChange: (s: SportId) => void; compact?: boolean }) {
  const opts: { id: SportId; label: string; icon: string }[] = [
    { id: 'cycling', label: 'Vélo',   icon: '◎' },
    { id: 'running', label: 'Course', icon: '⌒' },
  ];
  return (
    <div style={{
      display: 'flex', gap: 4, padding: 3,
      background: tokens.creamDark, borderRadius: 4,
      border: `1px solid ${tokens.creamBorder}`,
    }}>
      {opts.map(o => {
        const active = sport === o.id;
        return (
          <button key={o.id} onClick={() => onChange(o.id)} style={{
            flex: 1,
            padding: compact ? '4px 6px' : '6px 8px',
            border: 'none', cursor: 'pointer', borderRadius: 3,
            background: active ? tokens.terra : 'transparent',
            color: active ? '#fff' : tokens.inkMid,
            fontFamily: "'Space Grotesk'", fontSize: compact ? 10 : 11,
            fontWeight: active ? 700 : 500, letterSpacing: '0.05em',
            transition: 'all 0.12s',
          }}>
            <span style={{ marginRight: 5 }}>{o.icon}</span>{o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Sidebar({ activePage, onNav, stats, darkMode, onToggleDark, mobile, sport, onSportChange }: Props) {
  const navItems = ALL_NAV_ITEMS.filter(n => n.sports.includes(sport));
  if (mobile) {
    return (
      <div style={{
        background: tokens.surface,
        borderTop: `1px solid ${tokens.creamBorder}`,
        display: 'flex', flexDirection: 'column',
        flexShrink: 0,
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}>
      <div style={{ padding: '6px 8px', borderBottom: `1px solid ${tokens.creamBorder}` }}>
        <SportToggle sport={sport} onChange={onSportChange} compact />
      </div>
      <div style={{ height: 60, display: 'flex' }}>
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

      <div style={{ padding: '14px 12px 4px' }}>
        <Label style={{ display: 'block', marginBottom: 6 }}>SPORT</Label>
        <SportToggle sport={sport} onChange={onSportChange} />
      </div>

      <nav style={{ padding: '12px 12px', flex: 1 }}>
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
