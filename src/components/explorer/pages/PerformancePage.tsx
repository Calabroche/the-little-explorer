'use client';

/**
 * Combined "FTP & Charge" page.
 *
 * The two metrics belong together UX-wise — FTP (your ceiling) and
 * CTL/ATL/TSB (your form vs. fatigue around that ceiling) are read
 * back-to-back during a training planning session. Splitting them
 * into separate sidebar entries forced the user to bounce between
 * pages to answer one question ("how hard should I ride tomorrow?").
 *
 * Implementation: tab-switcher at the top, each tab mounts the
 * pre-existing FtpPage / TrainingLoadPage component (so we don't
 * duplicate logic). The pre-existing pages already own their own
 * scroll wrappers — we just gate them with the active tab.
 *
 * Both PageIds 'ftp' and 'training-load' route here from ExplorerApp;
 * the `initialTab` prop preselects the right tab so legacy bookmarks
 * land where the user expects.
 */

import { useState } from 'react';
import { tokens, Activity } from '../tokens';
import { useIsMobile } from '../ui';
import { FtpPage } from './FtpPage';
import { TrainingLoadPage } from './TrainingLoadPage';

type PerfTab = 'ftp' | 'charge';

export function PerformancePage({
  activities,
  initialTab = 'ftp',
}: {
  activities: Activity[];
  initialTab?: PerfTab;
}) {
  const [tab, setTab] = useState<PerfTab>(initialTab);
  const isMobile = useIsMobile();

  return (
    // Parent ExplorerApp main is `overflow: hidden`. The tab bar is
    // flex-shrink-0 so it stays pinned; the chosen sub-page owns
    // scrolling under it.
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      minHeight: 0, background: tokens.cream,
    }}>
      <TabBar tab={tab} onChange={setTab} isMobile={isMobile} />
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {tab === 'ftp'    && <FtpPage          activities={activities} />}
        {tab === 'charge' && <TrainingLoadPage activities={activities} />}
      </div>
    </div>
  );
}

function TabBar({ tab, onChange, isMobile }: { tab: PerfTab; onChange: (t: PerfTab) => void; isMobile: boolean }) {
  const tabs: { id: PerfTab; label: string; icon: string }[] = [
    { id: 'ftp',    label: 'FTP & Puissance',     icon: '⚡' },
    { id: 'charge', label: "Charge d'entraînement", icon: '◐' },
  ];
  return (
    <div style={{
      display: 'flex', gap: 0,
      padding: isMobile ? '12px 16px 0' : '20px 40px 0',
      borderBottom: `1px solid ${tokens.creamBorder}`,
      background: tokens.cream,
      flexShrink: 0,
    }}>
      {tabs.map(t => {
        const active = tab === t.id;
        return (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            style={{
              padding: '10px 16px',
              background: 'transparent',
              border: 'none',
              borderBottom: `2px solid ${active ? tokens.terra : 'transparent'}`,
              cursor: 'pointer',
              fontFamily: "'Space Grotesk'",
              fontSize: isMobile ? 12 : 13,
              fontWeight: active ? 700 : 500,
              letterSpacing: '0.04em',
              color: active ? tokens.terra : tokens.inkMid,
              marginBottom: -1, // overlap the parent's border
              transition: 'color 0.12s, border-color 0.12s',
            }}
            onMouseEnter={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.color = tokens.ink; }}
            onMouseLeave={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.color = tokens.inkMid; }}
          >
            <span style={{ marginRight: 6 }}>{t.icon}</span>
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
