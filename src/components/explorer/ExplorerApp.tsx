'use client';

import { useState, useEffect } from 'react';
import { Activity, tokens } from './tokens';
import { Sidebar, PageId } from './Sidebar';
import { ActivityDetail } from './ActivityDetail';
import { FeedPage } from './pages/FeedPage';
import { MapPage } from './pages/MapPage';
import { StatsPage } from './pages/StatsPage';
import { PhotosPage } from './pages/PhotosPage';

export function ExplorerApp() {
  const [page, setPage] = useState<PageId>('feed');
  const [selected, setSelected] = useState<Activity | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem('tle_page') as PageId | null;
    if (saved) setPage(saved);
  }, []);

  const handleNav = (id: PageId) => {
    setPage(id);
    localStorage.setItem('tle_page', id);
  };

  const pageContent: Record<PageId, React.ReactNode> = {
    feed:   <FeedPage onSelect={setSelected} />,
    map:    <MapPage />,
    stats:  <StatsPage />,
    photos: <PhotosPage />,
  };

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <Sidebar activePage={page} onNav={handleNav} />
      <main style={{ flex: 1, display: 'flex', overflow: 'hidden', background: tokens.cream }}>
        {pageContent[page]}
      </main>
      {selected && <ActivityDetail activity={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
