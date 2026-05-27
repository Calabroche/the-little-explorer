'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { Activity, GlobalStats, deriveStats, tokens } from './tokens';
import { Sidebar, GlobalLangToggle, PageId, SportId, UserId } from './Sidebar';
import { useT } from '@/i18n';
import { useIsMobile } from './ui';
import { FeedPage } from './pages/FeedPage';
import { MapPage } from './pages/MapPage';
import { PhotosPage } from './pages/PhotosPage';
import { PlannerPage } from './pages/PlannerPage';
import { FtpPage } from './pages/FtpPage';
import { TrainingLoadPage } from './pages/TrainingLoadPage';
import { EquipmentPage }    from './pages/EquipmentPage';
import { ComparePage } from './pages/ComparePage';
import { WrappedPage } from './pages/WrappedPage';
import { AnalysisPage } from './AnalysisPage';

// ── URL <-> state helpers ────────────────────────────────────────────────────

const PAGE_PATHS: Record<PageId, string> = {
  feed:      '/',
  planner:   '/planificateur',
  itinerary: '/itineraire',
  compare:   '/comparer',
  map:       '/carte',
  wrapped:   '/bilan',
  ftp:       '/ftp',
  'training-load': '/charge',
  equipment:       '/equipement',
  photos:    '/photos',
};

function pathToPage(pathname: string): PageId {
  if (pathname.startsWith('/planificateur')) return 'planner';
  if (pathname.startsWith('/itineraire'))    return 'itinerary';
  if (pathname.startsWith('/comparer'))      return 'compare';
  if (pathname.startsWith('/carte'))         return 'map';
  if (pathname.startsWith('/bilan'))         return 'wrapped';
  if (pathname.startsWith('/charge'))        return 'training-load';
  if (pathname.startsWith('/equipement'))    return 'equipment';
  if (pathname.startsWith('/ftp'))           return 'ftp';
  if (pathname.startsWith('/photos'))        return 'photos';
  // /stats route is gone — the standalone Stats page was removed.
  // Anyone hitting /stats falls through to the feed.
  return 'feed';
}

function slugify(s: string): string {
  const cleaned = (s || 'sortie')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return cleaned || 'sortie';
}

function activityPath(a: Activity): string {
  return `/activites/${slugify(a.title)}-${a.id}`;
}

function pathToActivityId(pathname: string): number | null {
  const m = pathname.match(/^\/activites\/.*-(\d+)$/);
  return m ? Number(m[1]) : null;
}

// ── Component ────────────────────────────────────────────────────────────────

export function ExplorerApp() {
  const [page, setPage] = useState<PageId>('feed');
  const [selectedActivityForMap] = useState<Activity | null>(null);
  const [analysisActivity, setAnalysisActivity] = useState<Activity | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [stats, setStats] = useState<GlobalStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [darkMode, setDarkMode] = useState(false);
  const [sport, setSport] = useState<SportId>('cycling');
  const [user, setUser]   = useState<UserId>('florian');
  // Desktop-only: when true the left sidebar is hidden and the main
  // area (charts, map) gets +220px of horizontal space — useful for
  // reading dense ride-detail charts.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const isMobile = useIsMobile();
  const { t, lang, setLang } = useT();

  // Dark mode + sport + user + sidebar persistence (localStorage — pas lié à l'URL)
  useEffect(() => {
    const dark = localStorage.getItem('tle_dark') === '1';
    setDarkMode(dark);
    if (dark) document.documentElement.setAttribute('data-dark', '');
    const savedSport = localStorage.getItem('tle_sport') as SportId | null;
    const validSports: SportId[] = ['cycling', 'running', 'hiking', 'ski', 'snowshoe', 'walking', 'swim'];
    if (savedSport && validSports.includes(savedSport)) setSport(savedSport);
    const savedUser = localStorage.getItem('tle_user') as UserId | null;
    if (savedUser === 'florian' || savedUser === 'helena') setUser(savedUser);
    if (localStorage.getItem('tle_sidebar_collapsed') === '1') setSidebarCollapsed(true);
  }, []);

  const toggleSidebar = () => {
    setSidebarCollapsed(prev => {
      const next = !prev;
      localStorage.setItem('tle_sidebar_collapsed', next ? '1' : '0');
      return next;
    });
  };

  const handleSportChange = (s: SportId) => {
    setSport(s);
    localStorage.setItem('tle_sport', s);
    setAnalysisActivity(null);
    // Sur les pages spécifiques au vélo, retomber sur le feed quand on passe en course.
    if (s !== 'cycling' && (page === 'planner' || page === 'ftp' || page === 'training-load' || page === 'equipment' || page === 'itinerary')) {
      setPage('feed');
      window.history.pushState(null, '', '/');
    }
  };

  const handleUserChange = (u: UserId) => {
    setUser(u);
    localStorage.setItem('tle_user', u);
    setAnalysisActivity(null);
    setLoading(true);
    setActivities([]);
  };

  // Click on the logo (top-left) → reset to default landing: Florian + cycling
  // + Activités feed at /. Refetches Florian's data if the user toggle was on
  // Helena.
  const handleHome = () => {
    if (user !== 'florian') {
      setUser('florian');
      localStorage.setItem('tle_user', 'florian');
    }
    if (sport !== 'cycling') {
      setSport('cycling');
      localStorage.setItem('tle_sport', 'cycling');
    }
    setAnalysisActivity(null);
    setPage('feed');
    if (typeof window !== 'undefined') window.history.pushState(null, '', '/');
  };

  const toggleDark = () => {
    const next = !darkMode;
    setDarkMode(next);
    if (next) document.documentElement.setAttribute('data-dark', '');
    else document.documentElement.removeAttribute('data-dark');
    localStorage.setItem('tle_dark', next ? '1' : '0');
  };

  // Track whether we've already attempted a Strava auto-sync this mount.
  // Without this guard, a failed sync (404, 502, etc.) would loop: empty
  // feed → trigger sync → still empty → trigger sync → …
  const autoSyncAttempted = useRef(false);
  const { data: session } = useSession();
  const [syncing, setSyncing] = useState(false);

  // Pull stable primitives out of the session object so the useEffect
  // below doesn't fire just because SessionProvider re-rendered. The
  // session OBJECT reference changes on every refetch, but these two
  // strings are stable for the life of a sign-in.
  const sessionUserId  = session?.user?.id;
  const sessionAthleteId = (session?.user as { athleteId?: number | null } | undefined)?.athleteId ?? null;

  // Load activities. With multi-user the API ignores ?user= and derives
  // the user from the NextAuth session cookie — but we keep the query
  // param so cache busts when toggling (legacy state).
  //
  // Auto-sync trigger: if the user has Strava linked (athleteId set)
  // but the feed is empty, kick off /api/strava/sync once and refetch
  // on success. Covers the "new user just signed up with Strava" path.
  useEffect(() => {
    // Wait until SessionProvider has actually loaded a session — without
    // this guard we'd hit /api/activities with no cookie and get a 401
    // on the very first render.
    if (!sessionUserId) return;

    let cancelled = false;
    setLoading(true);
    fetch(`/api/activities?user=${user}`)
      .then(r => r.json())
      .then(async (data: Activity[]) => {
        if (cancelled) return;
        setActivities(data);
        setStats(deriveStats(data));

        if (
          !autoSyncAttempted.current
          && Array.isArray(data) && data.length === 0
          && sessionAthleteId
        ) {
          autoSyncAttempted.current = true;
          setSyncing(true);
          try {
            const res = await fetch('/api/strava/sync', { method: 'POST' });
            if (res.ok && !cancelled) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const j = await res.json() as { ok?: boolean; count?: number };
              if (j.ok && (j.count ?? 0) > 0) {
                const r2 = await fetch(`/api/activities?user=${user}`);
                if (!cancelled && r2.ok) {
                  const fresh = await r2.json() as Activity[];
                  setActivities(fresh);
                  setStats(deriveStats(fresh));
                }
              }
            }
          } catch (err) {
            console.error('[explorer] auto-sync failed:', err);
          } finally {
            if (!cancelled) setSyncing(false);
          }
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [user, sessionUserId, sessionAthleteId]);

  // If the current sport isn't in the active user's data (e.g. just switched
  // from Florian-cycling to Helena who has no cycling), bounce to the first
  // available one. Has to live ABOVE the loading early-return so React's
  // hook order stays stable between renders.
  useEffect(() => {
    if (activities.length === 0) return;
    const present = new Set(activities.map(a => a.type as SportId));
    if (present.size > 0 && !present.has(sport)) {
      const SPORT_ORDER: SportId[] = ['cycling', 'running', 'hiking', 'ski', 'snowshoe', 'walking', 'swim'];
      const first = SPORT_ORDER.find(s => present.has(s));
      if (first) {
        setSport(first);
        localStorage.setItem('tle_sport', first);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, activities.length]);

  // Synchronise state ← URL (au mount, à la navigation back/forward, et dès
  // que les activités sont chargées pour résoudre les deep links /activites/:id).
  const syncFromUrl = useCallback((acts: Activity[]) => {
    if (typeof window === 'undefined') return;
    const p = window.location.pathname;
    const id = pathToActivityId(p);
    if (id != null) {
      const act = acts.find(a => a.id === id);
      if (act) {
        setAnalysisActivity(act);
        setPage('feed');
        return;
      }
      // id inconnu → fallback feed
      setAnalysisActivity(null);
      setPage('feed');
      return;
    }
    setAnalysisActivity(null);
    setPage(pathToPage(p));
  }, []);

  useEffect(() => {
    const handler = () => syncFromUrl(activities);
    window.addEventListener('popstate', handler);
    syncFromUrl(activities);
    return () => window.removeEventListener('popstate', handler);
  }, [activities, syncFromUrl]);

  // Helpers de navigation : pushState (pas de remount, l'app reste mounted).
  const navTo = (path: string) => {
    if (typeof window === 'undefined') return;
    if (window.location.pathname !== path) {
      window.history.pushState(null, '', path);
    }
  };

  const handleNav = (id: PageId) => {
    setAnalysisActivity(null);
    setPage(id);
    navTo(PAGE_PATHS[id]);
  };

  const openActivity = (a: Activity) => {
    setAnalysisActivity(a);
    navTo(activityPath(a));
  };

  const closeActivity = () => {
    setAnalysisActivity(null);
    navTo(PAGE_PATHS[page]);
  };

  // Hooks MUST be called ABOVE the early `if (loading) return ...`
  // below — otherwise React sees a different hook count between the
  // loading and post-loading renders and throws "Rendered more hooks
  // than during the previous render". Memoise the sport-filtered
  // dataset + derived stats + present-sports list so a sidebar
  // collapse / language toggle doesn't re-filter the 53-activity /
  // 17-MB dataset.
  const filteredActivities = useMemo(
    () => activities.filter(a => a.type === sport),
    [activities, sport],
  );
  const filteredStats = useMemo(() => deriveStats(filteredActivities), [filteredActivities]);

  const availableSports = useMemo<SportId[]>(() => {
    const SPORT_ORDER: SportId[] = ['cycling', 'running', 'hiking', 'ski', 'snowshoe', 'walking', 'swim'];
    const presentSports = new Set(activities.map(a => a.type as SportId));
    return SPORT_ORDER.filter(s => presentSports.has(s));
  }, [activities]);

  if (loading || syncing) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, height: '100dvh', alignItems: 'center', justifyContent: 'center', background: tokens.cream }}>
        <p style={{ fontFamily: "'Space Grotesk'", color: tokens.inkLight, letterSpacing: 2 }}>
          {syncing ? 'Récupération de tes activités Strava…' : t('common.loading')}
        </p>
        {syncing && (
          <p style={{ fontFamily: "'Space Grotesk'", fontSize: 11, color: tokens.inkLight, maxWidth: 360, textAlign: 'center', lineHeight: 1.5 }}>
            On synchronise tes sorties depuis Strava. Première connexion = ça peut prendre 5-10 secondes.
          </p>
        )}
      </div>
    );
  }

  // Lazily render ONLY the active page. The previous implementation
  // instantiated JSX for all 8 pages on every render, which made
  // sidebar toggles and language switches mount every page's tree
  // (and re-fire their useEffect chains). Now only the current
  // `page` is constructed.
  const renderPage = () => {
    switch (page) {
      case 'feed':      return <FeedPage      activities={filteredActivities} stats={filteredStats!} sport={sport} onSelect={openActivity} />;
      // Planner is now a tabbed hub for: itinerary, training plan,
      // auto-route, route proposals. The standalone /itineraire URL
      // still resolves but routes into PlannerPage with the itinerary
      // tab pre-selected — same destination, sidebar declutters down
      // to one nav item.
      case 'planner':   return <PlannerPage activities={filteredActivities} user={user} initialTab="itineraire" />;
      case 'itinerary': return <PlannerPage activities={filteredActivities} user={user} initialTab="itineraire" />;
      case 'compare':   return <ComparePage activities={filteredActivities} />;
      case 'map':       return <MapPage     activities={activities} selectedActivity={selectedActivityForMap} />;
      case 'wrapped':   return <WrappedPage activities={filteredActivities} sport={sport} />;
      case 'ftp':       return <FtpPage     activities={filteredActivities} />;
      case 'training-load': return <TrainingLoadPage activities={filteredActivities} />;
      case 'equipment': return <EquipmentPage />;
      case 'photos':    return <PhotosPage  activities={filteredActivities} />;
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', height: '100dvh', overflow: 'hidden' }}>
      {!isMobile && !sidebarCollapsed && (
        <Sidebar activePage={page} onNav={handleNav} stats={filteredStats} darkMode={darkMode} onToggleDark={toggleDark}
                 sport={sport} onSportChange={handleSportChange} user={user} onUserChange={handleUserChange} onHome={handleHome} availableSports={availableSports}
                 onToggleCollapse={toggleSidebar} />
      )}
      <main style={{ flex: 1, display: 'flex', overflow: 'hidden', background: tokens.cream, minHeight: 0, position: 'relative' }}>
        {/* Floating re-open button (desktop only, sidebar collapsed) */}
        {!isMobile && sidebarCollapsed && (
          <button
            onClick={toggleSidebar}
            title="Rouvrir le menu"
            aria-label="Expand sidebar"
            style={{
              position: 'absolute', top: 16, left: 16, zIndex: 1000,
              width: 32, height: 32, borderRadius: 16,
              background: tokens.surface, border: `1px solid ${tokens.creamBorder}`,
              color: tokens.inkMid, fontFamily: "'Space Grotesk'", fontSize: 14, fontWeight: 700,
              cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >›</button>
        )}
        {/* Floating language + dark-mode toggles — desktop only,
            top-right of the content area. Always visible (works even
            when the sidebar is collapsed, which used to hide the
            dark-mode button). Mobile path has its own pair in the
            bottom-nav top row. */}
        {!isMobile && (
          <div style={{ position: 'absolute', top: 16, right: 16, zIndex: 1000, display: 'flex', gap: 6, alignItems: 'center' }}>
            <button
              onClick={toggleDark}
              title={darkMode ? 'Mode clair' : 'Mode sombre'}
              aria-label="Toggle dark mode"
              style={{
                width: 32, height: 32, borderRadius: 16,
                background: tokens.surface, border: `1px solid ${tokens.creamBorder}`,
                color: tokens.inkMid, fontSize: 16, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
              }}
            >
              {darkMode ? '◑' : '◐'}
            </button>
            <GlobalLangToggle lang={lang} onChange={setLang} />
          </div>
        )}
        {analysisActivity
          ? <AnalysisPage activity={analysisActivity} onBack={closeActivity} />
          : renderPage()
        }
      </main>
      {isMobile && (
        <Sidebar activePage={page} onNav={handleNav} stats={filteredStats} darkMode={darkMode} onToggleDark={toggleDark} mobile
                 sport={sport} onSportChange={handleSportChange} user={user} onUserChange={handleUserChange} onHome={handleHome} availableSports={availableSports} />
      )}
    </div>
  );
}
