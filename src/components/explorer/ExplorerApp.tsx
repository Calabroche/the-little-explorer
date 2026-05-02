'use client';

import { useState, useEffect } from 'react';
import { Activity, GlobalStats, deriveStats, tokens } from './tokens';
import { Sidebar, PageId } from './Sidebar';
import { useIsMobile } from './ui';
import { FeedPage } from './pages/FeedPage';
import { MapPage } from './pages/MapPage';
import { StatsPage } from './pages/StatsPage';
import { PhotosPage } from './pages/PhotosPage';
import { PlannerPage } from './pages/PlannerPage';
import { AnalysisPage } from './AnalysisPage';

export function ExplorerApp() {
  const [page, setPage] = useState<PageId>('feed');
  const [selectedActivityForMap, setSelectedActivityForMap] = useState<Activity | null>(null);
  const [analysisActivity, setAnalysisActivity] = useState<Activity | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [stats, setStats] = useState<GlobalStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [darkMode, setDarkMode] = useState(false);
  const isMobile = useIsMobile();

  useEffect(() => {
    const saved = localStorage.getItem('tle_page') as PageId | null;
    if (saved) setPage(saved);
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

  useEffect(() => {
    fetch('/api/activities')
      .then(r => r.json())
      .then((data: Activity[]) => {
        setActivities(data);
        setStats(deriveStats(data));
      })
      .finally(() => setLoading(false));
  }, []);

  const handleNav = (id: PageId) => {
    setAnalysisActivity(null); // close analysis when nav changes
    setPage(id);
    localStorage.setItem('tle_page', id);
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', background: tokens.cream }}>
        <p style={{ fontFamily: "'Space Grotesk'", color: tokens.inkLight, letterSpacing: 2 }}>CHARGEMENT…</p>
      </div>
    );
  }

  const pageContent: Record<PageId, React.ReactNode> = {
    feed:    <FeedPage
               activities={activities}
               stats={stats!}
               onSelect={(a) => setAnalysisActivity(a)}
             />,
    planner: <PlannerPage activities={activities} />,
    map:     <MapPage activities={activities} selectedActivity={selectedActivityForMap} />,
    stats:   <StatsPage activities={activities} stats={stats!} />,
    photos:  <PhotosPage activities={activities} />,
  };

  return (
    <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', height: '100vh', overflow: 'hidden' }}>
      {!isMobile && (
        <Sidebar activePage={page} onNav={handleNav} stats={stats} darkMode={darkMode} onToggleDark={toggleDark} />
      )}
      <main style={{ flex: 1, display: 'flex', overflow: 'hidden', background: tokens.cream, minHeight: 0 }}>
        {analysisActivity
          ? <AnalysisPage activity={analysisActivity} onBack={() => setAnalysisActivity(null)} />
          : pageContent[page]
        }
      </main>
      {isMobile && (
        <Sidebar activePage={page} onNav={handleNav} stats={stats} darkMode={darkMode} onToggleDark={toggleDark} mobile />
      )}
    </div>
  );
}
