'use client';

import { useEffect, useState, CSSProperties } from 'react';
import { tokens, Activity } from '../tokens';
import { SectionTag, useIsMobile } from '../ui';
import { RouteBuilder } from '../RouteBuilder';
import { RouteProposals } from '../RouteProposals';
import { TrainingPlan } from '../TrainingPlan';
import { ItineraryPage } from './ItineraryPage';
import { useT } from '@/i18n';
import { UserId, SportId } from '../Sidebar';

type PlannerTab = 'itineraire' | 'plan' | 'auto' | 'proposals';

interface Props {
  activities: Activity[];
  user: UserId;
  // Which tab to show on first render. Lets the host route to a
  // specific sub-tool: hitting /itineraire shows itineraire, hitting
  // /planificateur shows the training plan by default.
  initialTab?: PlannerTab;
  sport?: SportId;
}

const TABS: { id: PlannerTab; icon: string; labelKey: string }[] = [
  { id: 'itineraire', icon: '⤳', labelKey: 'planner.tab.itinerary' },
  { id: 'plan',       icon: '✦', labelKey: 'planner.tab.plan'       },
  { id: 'auto',       icon: '↻', labelKey: 'planner.tab.auto'       },
  { id: 'proposals',  icon: '✺', labelKey: 'planner.tab.proposals'  },
];

export function PlannerPage({ activities, user, initialTab = 'itineraire', sport = 'cycling' }: Props) {
  const isMobile = useIsMobile();
  const { t } = useT();
  // Auto-generated loops (auto / proposals) come from a cycling-only route
  // library, so runners only get the route planner + training plan.
  const isRunning = sport === 'running';
  const tabs = isRunning ? TABS.filter(t => t.id === 'itineraire' || t.id === 'plan') : TABS;
  const safeInitial: PlannerTab = tabs.some(t => t.id === initialTab) ? initialTab : 'itineraire';
  const [tab, setTab] = useState<PlannerTab>(safeInitial);

  // Sync internal tab when the host changes initialTab (URL navigation).
  useEffect(() => { setTab(safeInitial); }, [safeInitial]);

  // Per-tab metadata shown under the headline so the user knows what
  // each pane actually does — addresses the "too many similar things"
  // confusion by labelling them clearly one at a time.
  const subtitle = (() => {
    switch (tab) {
      case 'itineraire': return t('planner.sub.itinerary');
      case 'plan':       return t('planner.sub.plan');
      case 'auto':       return t('planner.sub.auto');
      case 'proposals':  return t('planner.sub.proposals');
    }
  })();

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '20px 16px' : '32px 40px' }}>
      <SectionTag num={2} title={t('planner.sectionTag')} />
      <h1 style={{
        fontFamily: "'Playfair Display'", fontSize: isMobile ? 28 : 40, fontWeight: 900,
        color: tokens.ink, lineHeight: 1.1, marginBottom: 10,
      }}>
        {t('planner.headline')}<br />
        <em style={{ color: tokens.terra, fontStyle: 'italic', fontWeight: 700 }}>
          {t('planner.headlineEm')}
        </em>
      </h1>
      <p style={{
        fontFamily: "'Space Grotesk'", fontSize: 13, color: tokens.inkLight, lineHeight: 1.5,
        marginBottom: 18, maxWidth: 720,
      }}>{subtitle}</p>

      {/* Tab bar — horizontal pill buttons, scrolls on narrow viewports. */}
      <div style={tabBarStyle}
        onWheel={(e) => {
          // Wheel-scroll → horizontal on desktop where there's no native
          // gesture. Lets the user preview tabs that overflow the row
          // without a touchpad.
          const el = e.currentTarget as HTMLDivElement;
          if (e.deltaY !== 0) el.scrollLeft += e.deltaY;
        }}
      >
        {tabs.map(({ id, icon, labelKey }) => {
          const active = tab === id;
          return (
            <button
              key={id}
              onClick={() => setTab(id)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, flex: '0 0 auto',
                padding: '8px 14px', borderRadius: 18, border: 'none', cursor: 'pointer',
                background: active ? tokens.terra : tokens.creamDark,
                color: active ? '#fff' : tokens.inkMid,
                fontFamily: "'Space Grotesk'", fontSize: 12,
                fontWeight: active ? 700 : 500, letterSpacing: '0.04em',
                whiteSpace: 'nowrap', transition: 'background 0.12s, color 0.12s',
              }}
            >
              <span style={{ fontSize: 14 }}>{icon}</span>
              <span>{t(labelKey)}</span>
            </button>
          );
        })}
      </div>

      {/* Pane content — only one feature visible at a time, no more
          stacked confusion. */}
      <div style={{ marginTop: 20 }}>
        {tab === 'itineraire' && <ItineraryPage user={user} embedded sport={isRunning ? 'running' : 'cycling'} />}
        {tab === 'plan'       && <TrainingPlan   activities={activities} initialSport={sport} />}
        {tab === 'auto'       && <RouteBuilder   activities={activities} />}
        {tab === 'proposals'  && <RouteProposals activities={activities} />}
      </div>
    </div>
  );
}

const tabBarStyle: CSSProperties = {
  display: 'flex', gap: 6, padding: 6,
  background: tokens.surface, border: `1px solid ${tokens.creamBorder}`,
  borderRadius: 22, overflowX: 'auto', maxWidth: '100%',
  WebkitOverflowScrolling: 'touch',
  scrollbarWidth: 'none',
};
