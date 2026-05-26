'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession, signIn, signOut } from 'next-auth/react';
import { isAdminEmail } from '@/lib/admin';
import { tokens, GlobalStats } from './tokens';
import { Label } from './ui';
import { useT } from '@/i18n';
import type { Lang } from '@/i18n';

export type PageId = 'feed' | 'planner' | 'map' | 'photos' | 'ftp' | 'compare' | 'wrapped' | 'itinerary';
export type SportId = 'cycling' | 'running' | 'hiking' | 'ski' | 'snowshoe' | 'walking' | 'swim';
export type UserId  = 'florian' | 'helena';

// Pages available for each sport. Only Planner / FTP are cycling-specific
// (they rely on power computations); everything else makes sense for any
// outdoor activity.
const ALL_SPORTS: SportId[] = ['cycling', 'running', 'hiking', 'ski', 'snowshoe', 'walking', 'swim'];
const ALL_NAV_ITEMS: { id: PageId; icon: string; label: string; sports: SportId[] }[] = [
  { id: 'feed',      icon: '◎', label: 'Activités',     sports: ALL_SPORTS },
  // 'itinerary' is no longer a top-level destination — it lives as a
  // tab inside Planner. Kept as a PageId for backward-compat URLs
  // (/itineraire still works and lands on the itinerary tab).
  { id: 'planner',   icon: '✦', label: 'Planificateur', sports: ['cycling'] },
  { id: 'compare', icon: '⇄', label: 'Comparer',      sports: ALL_SPORTS },
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
  // Desktop collapse — when true the sidebar is fully hidden and the
  // main area expands to use the freed width. `onToggleCollapse` is
  // wired to the chevron button in the sidebar header (to collapse)
  // and to a floating chevron in the main area (to re-open).
  onToggleCollapse?: () => void;
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
  // Compact (mobile) mode forces a single horizontal row that scrolls
  // instead of wrapping to two lines and stealing vertical space.
  return (
    <div style={{
      display: 'flex',
      flexWrap: compact ? 'nowrap' : 'wrap',
      overflowX: compact ? 'auto' : 'visible',
      WebkitOverflowScrolling: 'touch',
      gap: 4, padding: 3,
      background: tokens.creamDark, borderRadius: 4,
      border: `1px solid ${tokens.creamBorder}`,
      scrollbarWidth: 'none',
    }}>
      {available.map(id => {
        const meta = SPORT_META[id];
        const active = sport === id;
        return (
          <button key={id} onClick={() => onChange(id)} style={{
            flex: compact ? '0 0 auto' : '1 1 30%',
            minWidth: compact ? 0 : 60,
            padding: compact ? '4px 8px' : '6px 8px',
            border: 'none', cursor: 'pointer', borderRadius: 3,
            background: active ? tokens.terra : 'transparent',
            color: active ? '#fff' : tokens.inkMid,
            fontFamily: "'Space Grotesk'", fontSize: compact ? 10 : 11,
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

// Desktop-only collapsed sport picker. Shows only the active sport
// with a chevron; click to expand a panel listing the other available
// sports. Mobile keeps the horizontally-scrolling chip-bar (better for
// thumb access on a narrow screen).
function SportDropdown({ sport, onChange, available }: {
  sport: SportId;
  onChange: (s: SportId) => void;
  available: SportId[];
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Click outside / ESC closes.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (available.length === 0) return null;
  const currentMeta = SPORT_META[sport] ?? SPORT_META.cycling;
  // Filter out the currently-selected sport from the panel — the user
  // doesn't need to "re-pick" what's already active.
  const others = available.filter(s => s !== sport);

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        style={{
          width: '100%', padding: '8px 10px',
          display: 'flex', alignItems: 'center', gap: 8,
          background: tokens.creamDark,
          border: `1px solid ${tokens.creamBorder}`,
          borderRadius: 4,
          fontFamily: "'Space Grotesk'", fontSize: 12, color: tokens.ink, fontWeight: 600,
          cursor: 'pointer', textAlign: 'left',
          transition: 'background 0.12s',
        }}
        onMouseEnter={e => (e.currentTarget.style.background = tokens.cream)}
        onMouseLeave={e => (e.currentTarget.style.background = tokens.creamDark)}
      >
        <span style={{ fontSize: 14, color: tokens.terra }}>{currentMeta.icon}</span>
        <span style={{ flex: 1 }}>{t(currentMeta.labelKey)}</span>
        <span style={{ fontSize: 10, color: tokens.inkLight, transition: 'transform 0.15s', transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}>▾</span>
      </button>

      {open && others.length > 0 && (
        <div
          role="listbox"
          style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 50,
            background: tokens.surface, border: `1px solid ${tokens.creamBorder}`,
            borderRadius: 4, overflow: 'hidden',
            boxShadow: '0 6px 20px rgba(0,0,0,0.08)',
          }}
        >
          {others.map(s => {
            const meta = SPORT_META[s];
            return (
              <button
                key={s}
                type="button"
                role="option"
                onClick={() => { onChange(s); setOpen(false); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                  padding: '8px 10px', textAlign: 'left',
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  fontFamily: "'Space Grotesk'", fontSize: 12, color: tokens.inkMid, fontWeight: 500,
                  borderBottom: `1px solid ${tokens.creamBorder}`,
                }}
                onMouseEnter={e => (e.currentTarget.style.background = tokens.creamDark)}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <span style={{ fontSize: 14 }}>{meta.icon}</span>
                <span>{t(meta.labelKey)}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Public, reusable lang toggle (used by the desktop floating chip in
// ExplorerApp and by the mobile bottom bar below). Local LangToggle
// above remains for backward-compat with the mobile compact mode.
export function GlobalLangToggle({ lang, onChange }: { lang: Lang; onChange: (l: Lang) => void }) {
  const opts: { id: Lang; label: string }[] = [
    { id: 'fr', label: 'FR' },
    { id: 'en', label: 'EN' },
  ];
  return (
    <div style={{
      display: 'flex', gap: 3, padding: 3,
      background: tokens.surface,
      border: `1px solid ${tokens.creamBorder}`,
      borderRadius: 18,
      boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
    }}>
      {opts.map(o => {
        const active = lang === o.id;
        return (
          <button key={o.id} type="button" onClick={() => onChange(o.id)} style={{
            padding: '4px 10px',
            border: 'none', cursor: 'pointer', borderRadius: 14,
            background: active ? tokens.terra : 'transparent',
            color: active ? '#fff' : tokens.inkMid,
            fontFamily: "'Space Grotesk'", fontSize: 10,
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
  feed:      'nav.activities',
  planner:   'nav.planner',
  itinerary: 'nav.itinerary',
  compare:   'nav.compare',
  map:       'nav.map',
  wrapped:   'nav.wrapped',
  ftp:       'nav.ftp',
  photos:    'nav.photos',
};

export function Sidebar({ activePage, onNav, stats, darkMode, onToggleDark, mobile, sport, onSportChange, availableSports, user, onUserChange, onHome, onToggleCollapse }: Props) {
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
        {/* ── Top toggle strip ──────────────────────────────────────
            Profile avatar (links to /profil) + Sport + Lang + Dark.
            The avatar is the mobile equivalent of the desktop
            sidebar's ProfileSection — same destination data, just
            on a separate route since the bottom-bar layout has no
            room for the full profile card. */}
        <div style={{
          padding: '6px 8px',
          borderBottom: `1px solid ${tokens.creamBorder}`,
          display: 'flex', gap: 6, alignItems: 'center',
        }}>
          <MobileProfileAvatar />
          <div style={{ flex: '1 1 0%', minWidth: 0 }}><SportToggle sport={sport} onChange={onSportChange} available={availableSports} compact /></div>
          <div style={{ flex: '0 0 auto' }}><LangToggle lang={lang} onChange={setLang} compact /></div>
          <button
            onClick={onToggleDark}
            aria-label={darkMode ? 'Mode clair' : 'Mode sombre'}
            style={{
              flex: '0 0 auto', width: 32, height: 32, borderRadius: '50%',
              background: tokens.creamDark, border: `1px solid ${tokens.creamBorder}`,
              color: tokens.inkMid, fontSize: 16, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            {darkMode ? '◑' : '◐'}
          </button>
        </div>

        {/* ── Bottom nav: horizontally scrollable so each item gets
            its own breathing room (no more 7 items mashed across
            the width of an iPhone). Hide the scrollbar — users feel
            the swipe affordance from the bigger items, no need for
            a visible track. */}
        <div style={{
          height: 64,
          display: 'flex',
          overflowX: 'auto',
          WebkitOverflowScrolling: 'touch',
          scrollbarWidth: 'none',
        }}
          onWheel={(e) => {
            // Forward vertical wheel to horizontal scroll on desktop
            // (lets you preview the layout without touch).
            const t = e.currentTarget as HTMLDivElement;
            if (e.deltaY !== 0) t.scrollLeft += e.deltaY;
          }}
        >
          {navItems.map(item => {
            const active = activePage === item.id;
            return (
              <div key={item.id} onClick={() => onNav(item.id)} style={{
                flex: '0 0 auto', minWidth: 78,
                padding: '8px 14px',
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                justifyContent: 'center', gap: 4, cursor: 'pointer',
                color: active ? tokens.terra : tokens.inkMid,
                borderTop: active ? `2px solid ${tokens.terra}` : '2px solid transparent',
                background: active ? tokens.terraLight : 'transparent',
              }}>
                <span style={{ fontSize: 22, lineHeight: 1 }}>{item.icon}</span>
                <span style={{
                  fontFamily: "'Space Grotesk'", fontSize: 10,
                  fontWeight: active ? 700 : 500, letterSpacing: '0.04em',
                  whiteSpace: 'nowrap',
                }}>
                  {t(NAV_LABEL_KEY[item.id])}
                </span>
              </div>
            );
          })}
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
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 6 }}>
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
          {/* Dark-mode toggle was here but moved to the floating
              top-right chip in ExplorerApp so it stays reachable when
              the sidebar is collapsed. The collapse-button stays. */}
          {onToggleCollapse && (
            <button
              onClick={onToggleCollapse}
              title="Replier le menu (plus de place pour les graphes)"
              aria-label="Collapse sidebar"
              style={{
                background: tokens.creamDark, border: `1px solid ${tokens.creamBorder}`,
                borderRadius: 20, padding: '4px 10px', cursor: 'pointer',
                fontFamily: "'Space Grotesk'", fontSize: 13, color: tokens.inkMid,
                lineHeight: 1, fontWeight: 700, flexShrink: 0,
              }}
            >
              ‹
            </button>
          )}
        </div>
        {/* Username is now shown in the ProfileSection at the bottom of
            the sidebar (where the logout button lives). The old static
            "Florian / Helena" label + the PROFIL switch block are gone —
            multi-user means each session sees only their own data, so
            switching users from the sidebar no longer makes sense. */}
      </div>

      <div style={{ padding: '14px 12px 4px' }}>
        <Label style={{ display: 'block', marginBottom: 6 }}>{t('common.sport')}</Label>
        <SportDropdown sport={sport} onChange={onSportChange} available={availableSports} />
      </div>

      {/* Language toggle moved out of the sidebar to the top-right
          floating chip in ExplorerApp. Mobile keeps its own LangToggle
          in the bottom-bar header below (thumb-accessible there). */}

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

      <ProfileSection />
    </div>
  );
}

/**
 * Bottom-of-sidebar profile section. Shows the signed-in user's name +
 * avatar + (Connect Strava | Synced) + a "Se déconnecter" button.
 *
 * `signOut({ callbackUrl: '/login' })` ends the NextAuth session and
 * redirects to /login — middleware keeps the user there until they
 * sign in again.
 *
 * "Connecter Strava" only appears when the session has no athleteId —
 * i.e. the user signed up with Google and hasn't linked Strava yet.
 * Clicking it kicks off the Strava OAuth flow via signIn('strava'),
 * which the Supabase adapter auto-links to the existing user row by
 * matching the email — so they end up with both Google and Strava
 * accounts pointing at the same TLE user.
 */
function ProfileSection() {
  const { data: session, status } = useSession();
  const [resyncState, setResyncState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');

  // POST /api/strava/sync, then reload the page so /api/activities
  // re-fetches with the freshly inserted rows. We could do a softer
  // refetch via a parent callback, but a full reload is simpler and
  // matches what the auto-sync useEffect does after a first connection.
  const resync = useCallback(async () => {
    if (resyncState === 'busy') return;
    setResyncState('busy');
    try {
      const r = await fetch('/api/strava/sync', { method: 'POST' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setResyncState('done');
      // Reload so all the cached activities + stats pick up the new data.
      window.location.reload();
    } catch (err) {
      console.error('[resync] failed:', err);
      setResyncState('error');
    }
  }, [resyncState]);

  if (status !== 'authenticated' || !session?.user) return null;

  const u = session.user;
  const displayName = u.name || u.email || 'Account';
  const initials = (u.name || u.email || '?')
    .split(/\s+/).map(s => s[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
  const stravaLinked = Boolean(u.athleteId);

  return (
    <div style={{
      margin: '12px 12px 0', padding: 12,
      background: tokens.creamDark, borderRadius: 4,
      border: `1px solid ${tokens.creamBorder}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        {u.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={u.image} alt="" width={32} height={32} style={{ borderRadius: '50%', flexShrink: 0 }} />
        ) : (
          <div style={{
            width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
            background: tokens.terra, color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: "'Space Grotesk'", fontSize: 12, fontWeight: 700,
          }}>{initials}</div>
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{
            fontFamily: "'Space Grotesk'", fontSize: 12, fontWeight: 600,
            color: tokens.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{displayName}</div>
          {u.email && u.email !== displayName && (
            <div style={{
              fontFamily: "'Space Grotesk'", fontSize: 10, color: tokens.inkLight,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>{u.email}</div>
          )}
        </div>
      </div>

      {!stravaLinked && (
        <button
          onClick={() => signIn('strava', { callbackUrl: '/' })}
          style={{
            width: '100%',
            padding: '8px 10px',
            marginBottom: 8,
            background: '#FC4C02',
            border: '1px solid #FC4C02',
            borderRadius: 3,
            color: '#fff',
            fontFamily: "'Space Grotesk'", fontSize: 11, fontWeight: 700,
            letterSpacing: '0.04em',
            cursor: 'pointer',
          }}
        >
          + CONNECTER STRAVA
        </button>
      )}

      {stravaLinked && (
        <button
          onClick={resync}
          disabled={resyncState === 'busy'}
          title="Forcer une synchro Strava si une nouvelle sortie n'apparaît pas"
          style={{
            width: '100%',
            padding: '8px 10px',
            marginBottom: 8,
            background: resyncState === 'error' ? '#FEE' : tokens.creamDark,
            border: `1px solid ${resyncState === 'error' ? '#FCC' : tokens.creamBorder}`,
            borderRadius: 3,
            color: resyncState === 'error' ? '#A00' : tokens.inkMid,
            fontFamily: "'Space Grotesk'", fontSize: 11, fontWeight: 600,
            letterSpacing: '0.04em',
            cursor: resyncState === 'busy' ? 'wait' : 'pointer',
          }}
        >
          {resyncState === 'busy'
            ? 'SYNCHRO…'
            : resyncState === 'error'
              ? '✗ ÉCHEC — RÉESSAYER'
              : '↻ RE-SYNCER STRAVA'}
        </button>
      )}

      <a
        href="/settings"
        style={{
          display: 'block',
          textAlign: 'center',
          padding: '8px 10px',
          marginBottom: 8,
          background: tokens.creamDark,
          border: `1px solid ${tokens.creamBorder}`,
          borderRadius: 3,
          color: tokens.inkMid,
          fontFamily: "'Space Grotesk'", fontSize: 11, fontWeight: 600,
          letterSpacing: '0.04em',
          textDecoration: 'none',
        }}
      >
        ⚙ PARAMÈTRES
      </a>

      {isAdminEmail(u.email) && (
        <a
          href="/admin"
          style={{
            display: 'block',
            textAlign: 'center',
            padding: '8px 10px',
            marginBottom: 8,
            background: tokens.creamDark,
            border: `1px dashed ${tokens.creamBorder}`,
            borderRadius: 3,
            color: tokens.inkMid,
            fontFamily: "'Space Grotesk'", fontSize: 10, fontWeight: 600,
            letterSpacing: '0.06em',
            textDecoration: 'none',
            textTransform: 'uppercase',
          }}
        >
          ⚙ Admin
        </a>
      )}

      <button
        onClick={() => signOut({ callbackUrl: '/login' })}
        style={{
          width: '100%',
          padding: '8px 10px',
          background: tokens.surface,
          border: `1px solid ${tokens.creamBorder}`,
          borderRadius: 3,
          color: tokens.inkMid,
          fontFamily: "'Space Grotesk'", fontSize: 11, fontWeight: 600,
          letterSpacing: '0.04em',
          cursor: 'pointer',
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = tokens.terra; }}
        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = tokens.inkMid; }}
      >
        SE DÉCONNECTER
      </button>
    </div>
  );
}

/**
 * Mobile-only avatar button in the bottom-bar top strip. Tapping it
 * navigates to /profil where the user gets the full profile UI
 * (re-sync, settings, admin, sign out) — mirroring the iOS Profile
 * tab. On desktop the sidebar already shows the ProfileSection card
 * inline, so this component is only rendered from the mobile branch.
 */
function MobileProfileAvatar() {
  const { data: session } = useSession();
  if (!session?.user) {
    // Not signed in (shouldn't normally happen since the middleware
    // gates everything except /login + /privacy, but defensive).
    return null;
  }
  const u = session.user;
  const initials = (u.name || u.email || '?')
    .split(/\s+/).map(s => s[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
  return (
    <a
      href="/profil"
      aria-label="Profil"
      style={{
        flex: '0 0 auto',
        width: 32, height: 32, borderRadius: '50%',
        background: tokens.terra, color: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: "'Space Grotesk'", fontSize: 11, fontWeight: 700,
        textDecoration: 'none', flexShrink: 0,
        overflow: 'hidden',
      }}
    >
      {u.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={u.image} alt="" width={32} height={32} style={{ borderRadius: '50%' }} />
      ) : initials}
    </a>
  );
}
