'use client';

import { useState, useEffect, useCallback } from 'react';
import { Activity, GlobalStats, deriveStats, tokens } from './tokens';
import { Sidebar, PageId, SportId, UserId } from './Sidebar';
import { useT } from '@/i18n';
import { useIsMobile } from './ui';
import { FeedPage } from './pages/FeedPage';
import { MapPage } from './pages/MapPage';
import { StatsPage } from './pages/StatsPage';
import { PhotosPage } from './pages/PhotosPage';
import { PlannerPage } from './pages/PlannerPage';
import { FtpPage } from './pages/FtpPage';
import { ComparePage } from './pages/ComparePage';
import { WrappedPage } from './pages/WrappedPage';
import { ItineraryPage } from './pages/ItineraryPage';
import { AnalysisPage } from './AnalysisPage';

// ── URL <-> state helpers ────────────────────────────────────────────────────

const PAGE_PATHS: Record<PageId, string> = {
  feed:      '/',
  planner:   '/planificateur',
  itinerary: '/itineraire',
  compare:   '/comparer',
  map:       '/carte',
  stats:     '/stats',
  wrapped:   '/bilan',
  ftp:       '/ftp',
  photos:    '/photos',
};

function pathToPage(pathname: string): PageId {
  if (pathname.startsWith('/planificateur')) return 'planner';
  if (pathname.startsWith('/itineraire'))    return 'itinerary';
  if (pathname.startsWith('/comparer'))      return 'compare';
  if (pathname.startsWith('/carte'))         return 'map';
  if (pathname.startsWith('/stats'))         return 'stats';
  if (pathname.startsWith('/bilan'))         return 'wrapped';
  if (pathname.startsWith('/ftp'))           return 'ftp';
  if (pathname.startsWith('/photos'))        return 'photos';
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
  const isMobile = useIsMobile();
  const { t } = useT();

  // Dark mode + sport + user persistence (localStorage — pas lié à l'URL)
  useEffect(() => {
    const dark = localStorage.getItem('tle_dark') === '1';
    setDarkMode(dark);
    if (dark) document.documentElement.setAttribute('data-dark', '');
    const savedSport = localStorage.getItem('tle_sport') as SportId | null;
    const validSports: SportId[] = ['cycling', 'running', 'hiking', 'ski', 'snowshoe', 'walking', 'swim'];
    if (savedSport && validSports.includes(savedSport)) setSport(savedSport);
    const savedUser = localStorage.getItem('tle_user') as UserId | null;
    if (savedUser === 'florian' || savedUser === 'helena') setUser(savedUser);
  }, []);

  const handleSportChange = (s: SportId) => {
    setSport(s);
    localStorage.setItem('tle_sport', s);
    setAnalysisActivity(null);
    // Sur les pages spécifiques au vélo, retomber sur le feed quand on passe en course.
    if (s !== 'cycling' && (page === 'planner' || page === 'ftp' || page === 'itinerary')) {
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

  // Recharge les activités quand l'utilisateur change.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/activities?user=${user}`)
      .then(r => r.json())
      .then((data: Activity[]) => {
        if (cancelled) return;
        setActivities(data);
        setStats(deriveStats(data));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [user]);

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

  if (loading) {
    return (
      <div style={{ display: 'flex', height: '100dvh', alignItems: 'center', justifyContent: 'center', background: tokens.cream }}>
        <p style={{ fontFamily: "'Space Grotesk'", color: tokens.inkLight, letterSpacing: 2 }}>{t('common.loading')}</p>
      </div>
    );
  }

  // Activités filtrées par le sport courant.
  // Les stats "En un coup d'œil" sont aussi recalculées sur cet ensemble
  // pour que la sidebar reflète le couple utilisateur + sport sélectionné.
  const filteredActivities = activities.filter(a => a.type === sport);
  const filteredStats = deriveStats(filteredActivities);

  // Sports actually present in this user's data → drives which toggle
  // buttons appear in the sidebar. Computed below the early return because
  // it's a derived value, not a hook.
  const SPORT_ORDER: SportId[] = ['cycling', 'running', 'hiking', 'ski', 'snowshoe', 'walking', 'swim'];
  const presentSports = new Set(activities.map(a => a.type as SportId));
  const availableSports: SportId[] = SPORT_ORDER.filter(s => presentSports.has(s));

  const pageContent: Record<PageId, React.ReactNode> = {
    feed:      <FeedPage      activities={filteredActivities} stats={filteredStats!} sport={sport} onSelect={openActivity} />,
    planner:   <PlannerPage   activities={filteredActivities} />,
    itinerary: <ItineraryPage user={user} />,
    compare:   <ComparePage   activities={filteredActivities} />,
    map:       <MapPage       activities={activities} selectedActivity={selectedActivityForMap} />,
    stats:     <StatsPage     activities={filteredActivities} stats={filteredStats!} />,
    wrapped:   <WrappedPage   activities={activities} />,
    ftp:       <FtpPage       activities={filteredActivities} />,
    photos:    <PhotosPage    activities={filteredActivities} />,
  };

  return (
    <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', height: '100dvh', overflow: 'hidden' }}>
      {!isMobile && (
        <Sidebar activePage={page} onNav={handleNav} stats={filteredStats} darkMode={darkMode} onToggleDark={toggleDark}
                 sport={sport} onSportChange={handleSportChange} user={user} onUserChange={handleUserChange} onHome={handleHome} availableSports={availableSports} />
      )}
      <main style={{ flex: 1, display: 'flex', overflow: 'hidden', background: tokens.cream, minHeight: 0 }}>
        {analysisActivity
          ? <AnalysisPage activity={analysisActivity} onBack={closeActivity} />
          : pageContent[page]
        }
      </main>
      {isMobile && (
        <Sidebar activePage={page} onNav={handleNav} stats={filteredStats} darkMode={darkMode} onToggleDark={toggleDark} mobile
                 sport={sport} onSportChange={handleSportChange} user={user} onUserChange={handleUserChange} onHome={handleHome} availableSports={availableSports} />
      )}
    </div>
  );
}
