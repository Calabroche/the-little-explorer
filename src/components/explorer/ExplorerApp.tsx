'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { Activity, GlobalStats, deriveStats, tokens } from './tokens';
import { Sidebar, GlobalLangToggle, PageId, SportId, UserId } from './Sidebar';
import { FeatureAnnouncement } from './FeatureAnnouncement';
import { WhatsNewPanel } from './WhatsNewPanel';
import { useT } from '@/i18n';
import { useIsMobile } from './ui';
import { SocialFeedPage } from './pages/SocialFeedPage';
import { ProfilePage } from './pages/ProfilePage';
import { PhotosPage } from './pages/PhotosPage';
import { PlannerPage } from './pages/PlannerPage';
import { PerformancePage } from './pages/PerformancePage';
import { EquipmentPage }   from './pages/EquipmentPage';
import { ComparePage } from './pages/ComparePage';
import { WrappedPage } from './pages/WrappedPage';
import { AnalysisPage } from './AnalysisPage';

// ── URL <-> state helpers ────────────────────────────────────────────────────

const PAGE_PATHS: Record<PageId, string> = {
  feed:      '/',
  profile:   '/mon-profil',
  planner:   '/planificateur',
  itinerary: '/itineraire',
  compare:   '/comparer',
  wrapped:   '/bilan',
  ftp:       '/ftp',
  'training-load': '/charge',
  equipment:       '/equipement',
  photos:    '/photos',
};

function pathToPage(pathname: string): PageId {
  if (pathname.startsWith('/mon-profil'))    return 'profile';
  if (pathname.startsWith('/planificateur')) return 'planner';
  if (pathname.startsWith('/itineraire'))    return 'itinerary';
  if (pathname.startsWith('/comparer'))      return 'compare';
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
  const [showWhatsNew, setShowWhatsNew] = useState(false);
  const isMobile = useIsMobile();
  const { t, lang, setLang } = useT();

  // Dark mode + sport + user + sidebar persistence (localStorage — pas lié à l'URL)
  useEffect(() => {
    const dark = localStorage.getItem('tle_dark') === '1';
    setDarkMode(dark);
    if (dark) document.documentElement.setAttribute('data-dark', '');
    const savedSport = localStorage.getItem('tle_sport') as SportId | null;
    // Must cover every sport offered as an onboarding "prédilection",
    // otherwise a non-cycling favourite gets rejected and silently
    // falls back to cycling.
    const validSports: SportId[] = [
      'cycling', 'running', 'swim', 'hiking', 'walking', 'ski', 'snowshoe',
      'snowboard', 'rowing', 'kayak', 'climbing', 'yoga', 'workout', 'cardio',
    ];
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
    // Cycling-only pages: fall back to the feed when leaving cycling. The
    // planner now supports running (route planner + training plan), so it's
    // no longer in this list.
    const cyclingOnly = page === 'ftp' || page === 'training-load' || page === 'equipment';
    const plannerButRunningOk = (page === 'planner' || page === 'itinerary') && s !== 'running';
    if (s !== 'cycling' && (cyclingOnly || plannerButRunningOk)) {
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
    // Reset to the rider's favourite sport (chosen at onboarding), not
    // always cycling.
    const fav = (localStorage.getItem('tle_favorite_sport') as SportId | null) ?? 'cycling';
    if (sport !== fav) {
      setSport(fav);
      localStorage.setItem('tle_sport', fav);
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
      // Not one of the viewer's own rides → could be a followed user's.
      // Fetch it fully-computed (owner's profile) so deep-links / back-forward
      // to /activites/:id work for anyone's activity.
      setPage('feed');
      fetch(`/api/activities?activityId=${id}`, { cache: 'no-store' })
        .then(r => (r.ok ? r.json() : null))
        .then((a: Activity | null) => setAnalysisActivity(a))
        .catch(() => setAnalysisActivity(null));
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

  // Open the full analysis for ANY activity id — one of the viewer's own (found
  // locally) or a followed user's ride (fetched fully-computed with the owner's
  // profile via ?activityId). Powers "open a sortie" from the social feed.
  const openActivityById = async (id: number) => {
    const local = activities.find(a => a.id === id);
    if (local) { openActivity(local); return; }
    try {
      const r = await fetch(`/api/activities?activityId=${id}`, { cache: 'no-store' });
      if (!r.ok) return;
      const act = await r.json() as Activity;
      setAnalysisActivity(act);
      setPage('feed');
      navTo(activityPath(act));
    } catch { /* ignore */ }
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
    // Order = priority shown in the picker. Outdoor cardio first
    // (most users), strength / indoor in the middle (more niche),
    // catch-all "other" last.
    // Order = priority shown in the picker. Outdoor cardio first
    // (most riders), then snow/ice, then indoor/strength, then water,
    // then niche, then "other" residual last.
    const SPORT_ORDER: SportId[] = [
      'cycling', 'running', 'hiking', 'walking', 'swim', 'snowshoe',
      'ski', 'snowboard', 'iceSkate',
      'yoga', 'workout', 'cardio',
      'rowing', 'kayak', 'paddle', 'surf', 'sail',
      'inlineSkate', 'skateboard',
      'climbing', 'racket', 'soccer', 'golf', 'wheelchair',
      'other',
    ];
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
      case 'feed':      return <SocialFeedPage onOpenActivity={openActivityById} />;
      case 'profile':   return <ProfilePage   activities={filteredActivities} stats={filteredStats!} sport={sport} onSelect={openActivity} />;
      // Planner is now a tabbed hub for: itinerary, training plan,
      // auto-route, route proposals. The standalone /itineraire URL
      // still resolves but routes into PlannerPage with the itinerary
      // tab pre-selected — same destination, sidebar declutters down
      // to one nav item.
      case 'planner':   return <PlannerPage activities={filteredActivities} user={user} initialTab="itineraire" sport={sport} />;
      case 'itinerary': return <PlannerPage activities={filteredActivities} user={user} initialTab="itineraire" sport={sport} />;
      case 'compare':   return <ComparePage activities={filteredActivities} />;
      case 'wrapped':   return <WrappedPage activities={filteredActivities} sport={sport} />;
      // 'ftp' + 'training-load' both land on PerformancePage now —
      // the latter just preselects the Charge tab so legacy bookmarks
      // still work.
      case 'ftp':           return <PerformancePage activities={filteredActivities} initialTab="ftp" />;
      case 'training-load': return <PerformancePage activities={filteredActivities} initialTab="charge" />;
      case 'equipment': return <EquipmentPage />;
      case 'photos':    return <PhotosPage  activities={filteredActivities} />;
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', height: '100dvh', overflow: 'hidden' }}>
      {/* "What's new" popup — shows the latest undismissed feature note. */}
      <FeatureAnnouncement />
      {/* The full changelog, opened from the "i" button. */}
      {showWhatsNew && <WhatsNewPanel onClose={() => setShowWhatsNew(false)} initialSport={sport === 'running' ? 'running' : 'cycling'} />}
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
              onClick={() => setShowWhatsNew(true)}
              title={lang === 'en' ? "What's new" : 'Nouveautés'}
              aria-label="What's new"
              style={{
                width: 32, height: 32, borderRadius: 16,
                background: tokens.surface, border: `1px solid ${tokens.creamBorder}`,
                color: tokens.terra, fontSize: 15, fontWeight: 800, fontStyle: 'italic', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: "'Playfair Display'", boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
              }}
            >
              i
            </button>
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
