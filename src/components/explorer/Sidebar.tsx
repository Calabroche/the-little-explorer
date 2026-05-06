'use client';

import { tokens, GlobalStats } from './tokens';
import { Label } from './ui';
import { useT } from '@/i18n';
import type { Lang } from '@/i18n';

export type PageId = 'feed' | 'planner' | 'map' | 'stats' | 'photos' | 'ftp' | 'compare' | 'wrapped';
export type SportId = 'cycling' | 'running' | 'hiking' | 'ski' | 'snowshoe' | 'walking' | 'swim';
export type UserId  = 'florian' | 'helena';

// Pages available for each sport. Only Planner / FTP are cycling-specific
// (they rely on power computations); everything else makes sense for any
// outdoor activity.
const ALL_SPORTS: SportId[] = ['cycling', 'running', 'hiking', 'ski', 'snowshoe', 'walking', 'swim'];
const ALL_NAV_ITEMS: { id: PageId; icon: string; label: string; sports: SportId[] }[] = [
  { id: 'feed',    icon: '◎', label: 'Activités',     sports: ALL_SPORTS },
  { id: 'planner', icon: '✦', label: 'Planificateur', sports: ['cycling'] },
  { id: 'compare', icon: '⇄', label: 'Comparer',      sports: ALL_SPORTS },
  { id: 'stats',   icon: '▬', label: 'Stats',         sports: ALL_SPORTS },
  { id: 'wrapped', icon: '✺', label: 'Bilan',         sports: ALL_SPORTS },
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
  availableSports: SportId[];
  user: UserId;
  onUserChange: (u: UserId) => void;
  onHome: () => void;
}

function UserToggle({ user, onChange, compact }: { user: UserId; onChange: (u: UserId) => void; compact?: boolean }) {
  const opts: { id: UserId; label: string }[] = [
    { id: 'florian', label: 'Florian' },
    { id: 'helena',  label: 'Helena'  },
  ];
  return (
    <div style={{
      display: 'flex', gap: 4, padding: 3,
      background: tokens.creamDark, borderRadius: 4,
      border: `1px solid ${tokens.creamBorder}`,
    }}>
      {opts.map(o => {
        const active = user === o.id;
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
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// All known sports + their UI metadata. The sidebar only renders the ones
// that are actually present in the active user's data (passed via
// `availableSports`), so each profile sees exactly what it has and nothing
// else.
const SPORT_META: Record<SportId, { icon: string; labelKey: string }> = {
  cycling:  { icon: '◎', labelKey: 'common.cycling'  },
  running:  { icon: '⌒', labelKey: 'common.running'  },
  hiking:   { icon: '▲', labelKey: 'common.hiking'   },
  ski:      { icon: '⛷', labelKey: 'common.ski'      },
  snowshoe: { icon: '❄', labelKey: 'common.snowshoe' },
  walking:  { icon: '⋯', labelKey: 'common.walking'  },
  swim:     { icon: '≈', labelKey: 'common.swim'     },
};

function SportToggle({ sport, onChange, available, compact }: {
  sport: SportId;
  onChange: (s: SportId) => void;
  available: SportId[];
  compact?: boolean;
}) {
  const { t } = useT();
  if (available.length === 0) return null;
  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', gap: 4, padding: 3,
      background: tokens.creamDark, borderRadius: 4,
      border: `1px solid ${tokens.creamBorder}`,
    }}>
      {available.map(id => {
        const meta = SPORT_META[id];
        const active = sport === id;
        return (
          <button key={id} onClick={() => onChange(id)} style={{
            flex: compact ? '1 1 auto' : '1 1 30%',
            minWidth: compact ? 0 : 60,
            padding: compact ? '4px 6px' : '6px 8px',
            border: 'none', cursor: 'pointer', borderRadius: 3,
            background: active ? tokens.terra : 'transparent',
            color: active ? '#fff' : tokens.inkMid,
            fontFamily: "'Space Grotesk'", fontSize: compact ? 9 : 11,
            fontWeight: active ? 700 : 500, letterSpacing: '0.04em',
            transition: 'all 0.12s', whiteSpace: 'nowrap',
          }}>
            <span style={{ marginRight: 4 }}>{meta.icon}</span>{t(meta.labelKey)}
          </button>
        );
      })}
    </div>
  );
}

function LangToggle({ lang, onChange, compact }: { lang: Lang; onChange: (l: Lang) => void; compact?: boolean }) {
  const opts: { id: Lang; label: string }[] = [
    { id: 'fr', label: 'FR' },
    { id: 'en', label: 'EN' },
  ];
  return (
    <div style={{
      display: 'flex', gap: 4, padding: 3,
      background: tokens.creamDark, borderRadius: 4,
      border: `1px solid ${tokens.creamBorder}`,
    }}>
      {opts.map(o => {
        const active = lang === o.id;
        return (
          <button key={o.id} onClick={() => onChange(o.id)} style={{
            flex: 1,
            padding: compact ? '4px 6px' : '6px 8px',
            border: 'none', cursor: 'pointer', borderRadius: 3,
            background: active ? tokens.terra : 'transparent',
            color: active ? '#fff' : tokens.inkMid,
            fontFamily: "'Space Grotesk'", fontSize: compact ? 10 : 11,
            fontWeight: active ? 700 : 500, letterSpacing: '0.1em',
            transition: 'all 0.12s',
          }}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

const NAV_LABEL_KEY: Record<PageId, string> = {
  feed:    'nav.activities',
  planner: 'nav.planner',
  compare: 'nav.compare',
  map:     'nav.map',
  stats:   'nav.stats',
  wrapped: 'nav.wrapped',
  ftp:     'nav.ftp',
  photos:  'nav.photos',
};

export function Sidebar({ activePage, onNav, stats, darkMode, onToggleDark, mobile, sport, onSportChange, availableSports, user, onUserChange, onHome }: Props) {
  const { t, lang, setLang } = useT();
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
      <div style={{ padding: '6px 8px', borderBottom: `1px solid ${tokens.creamBorder}`, display: 'flex', gap: 6 }}>
        <div style={{ flex: 2 }}><UserToggle  user={user}   onChange={onUserChange}  compact /></div>
        <div style={{ flex: 2 }}><SportToggle sport={sport} onChange={onSportChange} available={availableSports} compact /></div>
        <div style={{ flex: 1 }}><LangToggle  lang={lang}   onChange={setLang}       compact /></div>
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
                {t(NAV_LABEL_KEY[item.id])}
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
          <span style={{ fontFamily: "'Space Grotesk'", fontSize: 9, letterSpacing: '0.05em' }}>{t('common.darkMode')}</span>
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
          <button
            onClick={onHome}
            title="Retour à l'accueil"
            style={{
              fontFamily: "'Playfair Display'", fontSize: 18, fontWeight: 900,
              color: tokens.ink, lineHeight: 1, textAlign: 'left',
              background: 'none', border: 'none', padding: 0, cursor: 'pointer',
            }}
          >
            The Little<br />
            <em style={{ color: tokens.terra }}>Explorer</em>
          </button>
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
        <Label style={{ marginTop: 6, display: 'block' }}>{user === 'helena' ? 'Helena' : 'Florian Calabrese'}</Label>
      </div>

      <div style={{ padding: '14px 12px 4px' }}>
        <Label style={{ display: 'block', marginBottom: 6 }}>PROFIL</Label>
        <UserToggle user={user} onChange={onUserChange} />
      </div>

      <div style={{ padding: '10px 12px 4px' }}>
        <Label style={{ display: 'block', marginBottom: 6 }}>{t('common.sport')}</Label>
        <SportToggle sport={sport} onChange={onSportChange} available={availableSports} />
      </div>

      <div style={{ padding: '10px 12px 4px' }}>
        <Label style={{ display: 'block', marginBottom: 6 }}>{t('common.language')}</Label>
        <LangToggle lang={lang} onChange={setLang} />
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
                {t(NAV_LABEL_KEY[item.id])}
              </span>
            </div>
          );
        })}
      </nav>

      {stats && (
        <div style={{ margin: '0 12px', padding: 16, background: tokens.creamDark, borderRadius: 4 }}>
          <Label style={{ display: 'block', marginBottom: 12 }}>{t('common.atGlance')}</Label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {[
              { v: stats.totalActivities,              u: t('common.activities') },
              { v: stats.totalDistance + ' km',        u: t('common.distance') },
              { v: stats.totalElevation + ' m',        u: t('common.elev') },
              { v: stats.totalHours + 'h',             u: t('common.total') },
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
