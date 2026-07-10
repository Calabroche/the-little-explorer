'use client';

/**
 * SocialFeedPage — the "Accueil" home feed. Activities from people you follow
 * (+ your own), Strava-style, with like / comment / share per card. A loupe
 * search and a "Suggestions à suivre" strip help grow your following so the
 * feed is never empty. On desktop a right-hand aside shows the connected
 * user's own stats (4 weeks / year / all-time). Opening a profile → /u/<id>.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { tokens, type Activity } from '../tokens';
import { SocialActivityCard, Avatar, FollowButton } from '../social/components';
import { SportDropdown } from '../Sidebar';
import type { SportId } from '../Sidebar';
import { fetchFeed, searchUsers, fetchSuggestions } from '../social/api';
import type { FeedItem, UserSearchResult } from '../social/types';

export function SocialFeedPage(
  { onOpenActivity, activities, sport, onSportChange, availableSports }: {
    onOpenActivity?: (id: number) => void;
    activities?: Activity[];
    sport?: SportId;
    onSportChange?: (s: SportId) => void;
    availableSports?: SportId[];
  } = {},
) {
  const router = useRouter();
  const [items, setItems] = useState<FeedItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [focused, setFocused] = useState(false);
  const [results, setResults] = useState<UserSearchResult[] | null>(null);
  const [suggestions, setSuggestions] = useState<UserSearchResult[] | null>(null);
  const [wide, setWide] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  // Two-column layout only when there's room for the stats aside.
  useEffect(() => {
    // Need room for the sidebar + a 620 feed + the 300 aside pinned right.
    const onResize = () => setWide(window.innerWidth >= 1280);
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Home = the following feed only (your own rides live on your profile).
  // Retry once on a transient empty/failed load (a hard reload can race the
  // session cookie / a cold serverless start → a spurious empty feed).
  useEffect(() => {
    let cancelled = false;
    const load = async (attempt = 0) => {
      try {
        const data = await fetchFeed('following');
        if (cancelled) return;
        if (data.length === 0 && attempt === 0) { setTimeout(() => load(1), 700); return; }
        setItems(data);
      } catch {
        if (cancelled) return;
        if (attempt === 0) { setTimeout(() => load(1), 700); return; }
        setError('load_failed');
      }
    };
    setItems(null); setError(null);
    load();
    return () => { cancelled = true; };
  }, []);

  // People to follow (for the strip + empty state).
  useEffect(() => {
    fetchSuggestions().then(setSuggestions).catch(() => setSuggestions([]));
  }, []);

  // Debounced user search.
  useEffect(() => {
    if (q.trim().length < 2) { setResults(null); return; }
    const h = setTimeout(() => { searchUsers(q).then(setResults).catch(() => setResults([])); }, 250);
    return () => clearTimeout(h);
  }, [q]);

  // Close the search dropdown when clicking outside.
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setFocused(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const openProfile = (uid: string) => router.push(`/u/${uid}`);
  const feedEmpty = items != null && items.length === 0;

  const searchBox = (
    <div ref={searchRef} style={{ marginBottom: 16, position: 'relative' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px',
        borderRadius: 999, border: `1px solid ${focused ? tokens.terra : tokens.creamBorder}`,
        background: tokens.surface, transition: 'border-color .15s',
      }}>
        <LoupeIcon color={focused ? tokens.terra : tokens.inkLight} />
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          onFocus={() => setFocused(true)}
          placeholder="Trouver des amis…"
          style={{
            flex: 1, border: 'none', outline: 'none', background: 'transparent',
            fontSize: 14, color: tokens.ink, fontFamily: "'Space Grotesk'",
          }}
        />
        {q && (
          <button onClick={() => { setQ(''); setResults(null); }} style={{
            border: 'none', background: 'none', cursor: 'pointer', color: tokens.inkLight, fontSize: 16, lineHeight: 1, padding: 0,
          }}>×</button>
        )}
      </div>
      {focused && (() => {
        // Typing (≥2 chars) → live search results. Empty field → surface the
        // follow suggestions right away so a click on the loupe is never blank.
        const typing = q.trim().length >= 2;
        const list = typing ? results : suggestions;
        if (!list) return null; // still loading
        return (
          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20, marginTop: 6, background: tokens.surface, border: `1px solid ${tokens.creamBorder}`, borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', overflow: 'hidden', maxHeight: 360, overflowY: 'auto' }}>
            {!typing && list.length > 0 && (
              <div style={{ padding: '10px 12px 6px', fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: tokens.inkLight }}>Suggestions</div>
            )}
            {list.length === 0 && (
              <div style={{ padding: 12, color: tokens.inkLight, fontSize: 13 }}>{typing ? 'Personne trouvé.' : 'Aucune suggestion pour le moment.'}</div>
            )}
            {list.map(u => (
              <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderBottom: `1px solid ${tokens.creamBorder}` }}>
                <button onClick={() => openProfile(u.id)} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'none', border: 'none', cursor: 'pointer', flex: 1, minWidth: 0, textAlign: 'left' }}>
                  <Avatar src={u.image} name={u.name} size={30} />
                  <span style={{ fontSize: 14, fontWeight: 600, color: tokens.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.name ?? 'Anonyme'}</span>
                </button>
                <FollowButton userId={u.id} initialFollowing={u.is_following} />
              </div>
            ))}
          </div>
        );
      })()}
    </div>
  );

  const feedColumn = (
    <div>
      {searchBox}

      {/* Suggestions strip — surfaced always when you have room to grow, and
          made the hero when the feed is empty. */}
      {suggestions && suggestions.length > 0 && (feedEmpty || (items && items.length < 6)) && (
        <SuggestionsStrip users={suggestions} onOpenProfile={openProfile} hero={!!feedEmpty} />
      )}

      {error && <div style={{ padding: 14, background: '#FEE', border: '1px solid #FCC', borderRadius: 6, color: '#A00' }}>Erreur de chargement du feed.</div>}
      {!items && !error && <div style={{ color: tokens.inkMid }}>Chargement…</div>}
      {feedEmpty && (!suggestions || suggestions.length === 0) && (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: tokens.inkMid }}>
          Ton fil est vide. Cherche des amis ci-dessus pour voir leurs sorties ici.
        </div>
      )}
      {items?.map(it => (
        <SocialActivityCard key={it.id} item={it} onOpenProfile={openProfile}
          onOpenActivity={a => onOpenActivity?.(a.id)} />
      ))}
    </div>
  );

  const aside = (
    <ProfileStatsAside
      activities={activities ?? []}
      sport={sport} onSportChange={onSportChange} availableSports={availableSports}
    />
  );

  return (
    // flex:1 + own scroll — <main> is overflow:hidden, so each page scrolls itself.
    <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
      {wide ? (
        // 3-column: flexible spacer · centered feed (600) · stats pinned to the
        // far-right edge. alignItems:stretch makes the right column as tall as
        // the feed so the sticky panel inside it has scroll range; that column
        // then aligns the panel to the top (flex-start) so it isn't stretched.
        <div style={{ display: 'flex', alignItems: 'stretch', width: '100%', padding: '20px 24px 80px', boxSizing: 'border-box' }}>
          <div style={{ flex: 1, minWidth: 24 }} />
          <div style={{ width: 600, flexShrink: 0 }}>{feedColumn}</div>
          <div style={{ flex: 1, minWidth: 320, display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end', paddingLeft: 28 }}>
            {aside}
          </div>
        </div>
      ) : (
        <div style={{ maxWidth: 620, margin: '0 auto', padding: '20px 16px 80px' }}>{feedColumn}</div>
      )}
    </div>
  );
}

// ── Suggestions ────────────────────────────────────────────────────────────

function SuggestionsStrip(
  { users, onOpenProfile, hero }: { users: UserSearchResult[]; onOpenProfile: (id: string) => void; hero: boolean },
) {
  const shown = hero ? users : users.slice(0, 5);
  return (
    <div style={{
      marginBottom: 20, padding: 16, borderRadius: 12,
      background: tokens.surface, border: `1px solid ${tokens.creamBorder}`,
    }}>
      <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: tokens.inkLight, marginBottom: 12 }}>
        Suggestions à suivre
      </div>
      {hero && (
        <div style={{ fontSize: 13, color: tokens.inkMid, marginBottom: 14, marginTop: -4 }}>
          Abonne-toi à quelques explorateurs pour remplir ton fil.
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {shown.map(u => (
          <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0' }}>
            <button onClick={() => onOpenProfile(u.id)} style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'none', border: 'none', cursor: 'pointer', flex: 1, minWidth: 0, textAlign: 'left' }}>
              <Avatar src={u.image} name={u.name} size={42} />
              <span style={{ fontSize: 15, fontWeight: 600, color: tokens.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.name ?? 'Anonyme'}</span>
            </button>
            <FollowButton userId={u.id} initialFollowing={u.is_following} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Stats aside (desktop only) ──────────────────────────────────────────────

const DAY = 86400000;

function ProfileStatsAside(
  { activities, sport, onSportChange, availableSports }: {
    activities: Activity[];
    sport?: SportId;
    onSportChange?: (s: SportId) => void;
    availableSports?: SportId[];
  },
) {
  const s = useMemo(() => computeStats(activities), [activities]);
  const canPickSport = sport && onSportChange && availableSports && availableSports.length > 1;
  return (
    <aside style={{
      // Pushed down so it clears the floating top-right chips (info / theme /
      // language) that sit fixed over the page.
      width: 300, flexShrink: 0, position: 'sticky', top: 72, marginTop: 48,
      background: tokens.surface, border: `1px solid ${tokens.creamBorder}`,
      borderRadius: 12, padding: 20, boxSizing: 'border-box',
    }}>
      <div style={{ fontFamily: "'Playfair Display'", fontSize: 18, fontWeight: 800, color: tokens.ink, marginBottom: 12 }}>
        Mes statistiques
      </div>
      {canPickSport
        ? <div style={{ marginBottom: 18 }}><SportDropdown sport={sport!} onChange={onSportChange!} available={availableSports!} /></div>
        : <div style={{ fontSize: 12, color: tokens.inkLight, marginBottom: 18 }}>Sport sélectionné</div>}

      {activities.length === 0 ? (
        <div style={{ fontSize: 13, color: tokens.inkMid }}>Aucune activité pour ce sport.</div>
      ) : (
        <>
          <StatBlock title="4 dernières semaines" rows={[
            ['Activités / sem.', s.wk.perWeek.toFixed(1)],
            ['Distance moy. / sem.', `${fmtKm(s.wk.dist / 4)} km`],
            ['Dénivelé / sem.', `${Math.round(s.wk.elev / 4)} m`],
            ['Durée moy. / sem.', fmtDur(s.wk.dur / 4)],
          ]} />
          <StatBlock title="Meilleurs efforts" rows={[
            ['Sortie la plus longue', `${fmtKm(s.best.dist)} km`],
            ['Plus gros dénivelé', `${Math.round(s.best.elev)} m`],
          ]} />
          <StatBlock title={`${s.year.label}`} rows={[
            ['Activités', `${s.year.count}`],
            ['Distance', `${fmtKm(s.year.dist)} km`],
            ['Dénivelé', `${Math.round(s.year.elev)} m`],
            ['Temps', fmtDur(s.year.dur)],
          ]} />
          <StatBlock title="De tout temps" rows={[
            ['Activités', `${s.all.count}`],
            ['Distance', `${fmtKm(s.all.dist)} km`],
            ['Dénivelé', `${Math.round(s.all.elev)} m`],
            ['Temps', fmtDur(s.all.dur)],
          ]} last />
        </>
      )}
    </aside>
  );
}

function StatBlock({ title, rows, last }: { title: string; rows: [string, string][]; last?: boolean }) {
  return (
    <div style={{ marginBottom: last ? 0 : 18, paddingBottom: last ? 0 : 18, borderBottom: last ? 'none' : `1px solid ${tokens.creamBorder}` }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: tokens.ink, marginBottom: 10 }}>{title}</div>
      {rows.map(([label, value]) => (
        <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '3px 0' }}>
          <span style={{ fontSize: 12.5, color: tokens.inkMid }}>{label}</span>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: tokens.ink, fontFamily: "'Space Grotesk'" }}>{value}</span>
        </div>
      ))}
    </div>
  );
}

type Agg = { count: number; dist: number; elev: number; dur: number };
const emptyAgg = (): Agg => ({ count: 0, dist: 0, elev: 0, dur: 0 });
function add(a: Agg, act: Activity) {
  a.count += 1;
  a.dist += act.distance || 0;
  a.elev += act.elevation || 0;
  a.dur += act.duration_min ?? 0;
}

function computeStats(activities: Activity[]) {
  const now = Date.now();
  const year = new Date().getFullYear();
  const wk = emptyAgg();
  const yr = emptyAgg();
  const all = emptyAgg();
  let bestDist = 0, bestElev = 0;
  for (const a of activities) {
    add(all, a);
    bestDist = Math.max(bestDist, a.distance || 0);
    bestElev = Math.max(bestElev, a.elevation || 0);
    const t = new Date(a.rawDate).getTime();
    if (!Number.isNaN(t)) {
      if (now - t <= 28 * DAY) add(wk, a);
      if (new Date(a.rawDate).getFullYear() === year) add(yr, a);
    }
  }
  return {
    wk: { ...wk, perWeek: wk.count / 4 },
    best: { dist: bestDist, elev: bestElev },
    year: { label: `${year}`, ...yr },
    all,
  };
}

function fmtKm(km: number): string {
  return km >= 100 ? Math.round(km).toString() : (Math.round(km * 10) / 10).toString().replace('.', ',');
}
function fmtDur(min: number): string {
  const m = Math.round(min);
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h > 0 ? `${h}h ${r.toString().padStart(2, '0')}min` : `${r}min`;
}

function LoupeIcon({ color }: { color: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}
