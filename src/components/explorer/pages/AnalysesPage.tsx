'use client';

/**
 * AnalysesPage — one home for every "analyse MY data" tool, replacing the four
 * separate sidebar items (Puissance & Charge, Comparer, Matériel, Bilan) that
 * a newcomer couldn't tell apart. A fixed tab bar on top, the chosen full page
 * scrolls below (same shell pattern as ProfilePage). Cycling-only tabs
 * (Puissance, Matériel) hide for other sports.
 */
import { useMemo, useState, type CSSProperties } from 'react';
import dynamic from 'next/dynamic';
import { tokens, Activity } from '../tokens';
import { useIsMobile } from '../ui';
import { useT } from '@/i18n';
import type { SportId } from '../Sidebar';
import { SportDropdown } from '../Sidebar';
import { PerformancePage } from './PerformancePage';
import { ComparePage } from './ComparePage';
import { EquipmentPage } from './EquipmentPage';
import { WrappedPage } from './WrappedPage';

// Leaflet is client-only.
const HeatmapMap = dynamic(() => import('../HeatmapMap').then(m => m.HeatmapMap), { ssr: false });

type AnalysesTab = 'carte' | 'puissance' | 'comparer' | 'materiel' | 'bilan';

export function AnalysesPage(
  { activities, sport, onSportChange, availableSports }: {
    activities: Activity[]; sport: SportId;
    onSportChange?: (s: SportId) => void; availableSports?: SportId[];
  },
) {
  const { t } = useT();
  const isMobile = useIsMobile();
  const isCycling = sport === 'cycling';

  const tabs: { id: AnalysesTab; icon: string; labelKey: string }[] = [
    { id: 'carte', icon: '◉', labelKey: 'nav.heatmap' },
    ...(isCycling ? [{ id: 'puissance' as const, icon: '⚡', labelKey: 'nav.ftp' }] : []),
    { id: 'comparer', icon: '⇄', labelKey: 'nav.compare' },
    ...(isCycling ? [{ id: 'materiel' as const, icon: '⚙', labelKey: 'nav.equipment' }] : []),
    { id: 'bilan', icon: '✺', labelKey: 'nav.wrapped' },
  ];

  // Every recorded trace for the current sport → the personal heatmap.
  const traces = useMemo(
    () => activities.map(a => a.gps).filter((g): g is { lat: number; lng: number }[] => Array.isArray(g) && g.length >= 2),
    [activities],
  );

  const [tab, setTab] = useState<AnalysesTab>(tabs[0].id);
  const active: AnalysesTab = tabs.some(x => x.id === tab) ? tab : tabs[0].id;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ padding: isMobile ? '16px 16px 0' : '24px 40px 0', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        {/* Sport selector lives here now (moved out of the sidebar) — right where
            it scopes the analyses + heatmap. */}
        {onSportChange && availableSports && availableSports.length > 1 && (
          <div style={{ flexShrink: 0 }}>
            <SportDropdown sport={sport} onChange={onSportChange} available={availableSports} />
          </div>
        )}
        <div style={{ ...tabBarStyle, flex: 1 }}
          onWheel={e => { const el = e.currentTarget as HTMLDivElement; if (e.deltaY !== 0) el.scrollLeft += e.deltaY; }}>
          {tabs.map(({ id, icon, labelKey }) => {
            const on = active === id;
            return (
              <button key={id} onClick={() => setTab(id)} style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, flex: '0 0 auto',
                padding: '8px 14px', borderRadius: 18, border: 'none', cursor: 'pointer',
                background: on ? tokens.terra : tokens.creamDark, color: on ? '#fff' : tokens.inkMid,
                fontFamily: "'Space Grotesk'", fontSize: 12, fontWeight: on ? 700 : 500,
                letterSpacing: '0.04em', whiteSpace: 'nowrap', transition: 'background 0.12s, color 0.12s',
              }}>
                <span style={{ fontSize: 14 }}>{icon}</span>
                <span>{t(labelKey)}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* The selected page keeps its own scroll (flex:1 + overflow), so the tab
          bar stays fixed above it. */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', marginTop: 8 }}>
        {active === 'carte' && (
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: isMobile ? '8px 16px 16px' : '8px 40px 24px' }}>
            <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: isMobile ? 22 : 28, fontWeight: 900, color: tokens.ink, margin: '4px 0 4px' }}>Ma carte</h1>
            <p style={{ fontFamily: "'Space Grotesk'", fontSize: 13, color: tokens.inkLight, marginTop: 0, marginBottom: 12 }}>
              Tous tes tracés superposés. Plus tu passes souvent, plus la ligne est marquée.
            </p>
            {/* Map fills the remaining height (was a fixed short block). */}
            <div style={{ flex: 1, minHeight: 0 }}>
              <HeatmapMap traces={traces} />
            </div>
          </div>
        )}
        {active === 'puissance' && <PerformancePage activities={activities} initialTab="ftp" />}
        {active === 'comparer'  && <ComparePage activities={activities} />}
        {active === 'materiel'  && <EquipmentPage />}
        {active === 'bilan'     && <WrappedPage activities={activities} sport={sport} />}
      </div>
    </div>
  );
}

const tabBarStyle: CSSProperties = {
  display: 'flex', gap: 6, padding: 6,
  background: tokens.surface, border: `1px solid ${tokens.creamBorder}`,
  borderRadius: 22, overflowX: 'auto', maxWidth: '100%',
  WebkitOverflowScrolling: 'touch',
};
