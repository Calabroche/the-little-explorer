'use client';

import { useState, useEffect, useCallback } from 'react';
import { Activity, GlobalStats, deriveStats, tokens } from './tokens';
import { Sidebar, PageId } from './Sidebar';
import { useIsMobile } from './ui';
import { FeedPage } from './pages/FeedPage';
import { MapPage } from './pages/MapPage';
import { StatsPage } from './pages/StatsPage';
import { PhotosPage } from './pages/PhotosPage';
import { PlannerPage } from './pages/PlannerPage';
import { FtpPage } from './pages/FtpPage';
import { AnalysisPage } from './AnalysisPage';

// ── URL <-> state helpers ────────────────────────────────────────────────────

const PAGE_PATHS: Record<PageId, string> = {
  feed:    '/',
  planner: '/planificateur',
  map:     '/carte',
  stats:   '/stats',
  ftp:     '/ftp',
  photos:  '/photos',
};

function pathToPage(pathname: string): PageId {
  if (pathname.startsWith('/planificateur')) return 'planner';
  if (pathname.startsWith('/carte'))         return 'map';
  if (pathname.startsWith('/stats'))         return 'stats';
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
  const isMobile = useIsMobile();

  // Dark mode persistence (localStorage — pas lié à l'URL)
  useEffect(() => {
    const dark = localStorage.getItem('tle_dark') === '1';
    setDarkMode(dark);
    if (dark) document.documentElement.setAttribute('data-dark', '');
  }, []);

  const toggleDark = () => {
    const next = !darkMode;
    setDarkMode(next);
    if (next) document.documentElement.setAttribute('data-dark', '');
    else document.documentElement.removeAttribute('data-dark');
    localStorage.setItem('tle_dark', next ? '1' : '0');
  };

  // Charge les activités une fois.
  useEffect(() => {
    fetch('/api/activities')
      .then(r => r.json())
      .then((data: Activity[]) => {
        setActivities(data);
        setStats(deriveStats(data));
      })
      .finally(() => setLoading(false));
  }, []);

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
        <p style={{ fontFamily: "'Space Grotesk'", color: tokens.inkLight, letterSpacing: 2 }}>CHARGEMENT…</p>
      </div>
    );
  }

  const pageContent: Record<PageId, React.ReactNode> = {
    feed:    <FeedPage    activities={activities} stats={stats!} onSelect={openActivity} />,
    planner: <PlannerPage activities={activities} />,
    map:     <MapPage     activities={activities} selectedActivity={selectedActivityForMap} />,
    stats:   <StatsPage   activities={activities} stats={stats!} />,
    ftp:     <FtpPage     activities={activities} />,
    photos:  <PhotosPage  activities={activities} />,
  };

  return (
    <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', height: '100dvh', overflow: 'hidden' }}>
      {!isMobile && (
        <Sidebar activePage={page} onNav={handleNav} stats={stats} darkMode={darkMode} onToggleDark={toggleDark} />
      )}
      <main style={{ flex: 1, display: 'flex', overflow: 'hidden', background: tokens.cream, minHeight: 0 }}>
        {analysisActivity
          ? <AnalysisPage activity={analysisActivity} onBack={closeActivity} />
          : pageContent[page]
        }
      </main>
      {isMobile && (
        <Sidebar activePage={page} onNav={handleNav} stats={stats} darkMode={darkMode} onToggleDark={toggleDark} mobile />
      )}
    </div>
  );
}
