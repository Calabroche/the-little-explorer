'use client';

import { useState } from 'react';
import { useT } from '@/i18n';
import { tokens } from './tokens';
import { FEATURE_NOTES } from './featureNotes';
import { WhyBetterThanStrava } from './WhyBetterThanStrava';

type PanelTab = 'cycling' | 'running' | 'strava';

// Small "when" caption per item.
function relDate(dateStr: string, en: boolean): string {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(`${dateStr}T00:00:00`);
  const days = Math.floor((today.getTime() - d.getTime()) / 86_400_000);
  if (days <= 0) return en ? 'today' : "aujourd'hui";
  if (days === 1) return en ? 'yesterday' : 'hier';
  if (days <= 30) return en ? `${days}d ago` : `il y a ${days} j`;
  return d.toLocaleDateString(en ? 'en-US' : 'fr-FR', { day: '2-digit', month: 'short' });
}

// The "what's new" panel, opened from the "i" button. Tabs: Vélo / Course /
// Mieux que Strava. Sport tabs show that sport's notes plus the cross-sport
// ('all') ones; the Strava tab holds the comparison pitch.
export function WhatsNewPanel({ onClose, initialSport = 'cycling' }: { onClose: () => void; initialSport?: 'cycling' | 'running' | string }) {
  const { lang } = useT();
  const en = lang === 'en';
  const [tab, setTab] = useState<PanelTab>(initialSport === 'running' ? 'running' : 'cycling');

  const TABS: { id: PanelTab; label: string }[] = [
    { id: 'cycling', label: '🚴 ' + (en ? 'Cycling' : 'Vélo') },
    { id: 'running', label: '🏃 ' + (en ? 'Running' : 'Course') },
    { id: 'strava',  label: '🟧 ' + (en ? 'vs Strava' : 'vs Strava') },
  ];

  const notes = tab === 'cycling'
    ? FEATURE_NOTES.filter(n => n.sport === 'cycling' || n.sport === 'all')
    : tab === 'running'
      ? FEATURE_NOTES.filter(n => n.sport === 'running' || n.sport === 'all')
      : [];

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 4000,
        background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          position: 'relative', width: '100%', maxWidth: 460, maxHeight: '82vh',
          display: 'flex', flexDirection: 'column',
          background: tokens.surface, border: `1px solid ${tokens.creamBorder}`,
          borderRadius: 10, boxShadow: '0 24px 64px rgba(0,0,0,0.3)',
          fontFamily: "'Space Grotesk'",
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 22px 10px' }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: tokens.terra }}>
              ✦ {en ? 'Changelog' : 'Nouveautés'}
            </div>
            <h2 style={{ fontFamily: "'Playfair Display'", fontSize: 22, fontWeight: 800, color: tokens.ink, margin: '4px 0 0' }}>
              {en ? "What's new" : 'Quoi de neuf'}
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label={en ? 'Close' : 'Fermer'}
            style={{
              width: 28, height: 28, background: 'transparent',
              border: `1px solid ${tokens.creamBorder}`, borderRadius: 6,
              color: tokens.inkMid, cursor: 'pointer', fontSize: 14,
            }}
          >✕</button>
        </div>

        {/* Tab bar */}
        <div style={{ display: 'flex', gap: 6, padding: '0 22px 12px' }}>
          {TABS.map(tb => {
            const active = tab === tb.id;
            return (
              <button
                key={tb.id}
                onClick={() => setTab(tb.id)}
                style={{
                  flex: 1, padding: '8px 6px', borderRadius: 8, border: 'none', cursor: 'pointer',
                  background: active ? tokens.terra : tokens.creamDark,
                  color: active ? '#fff' : tokens.inkMid,
                  fontFamily: "'Space Grotesk'", fontSize: 12, fontWeight: active ? 700 : 500,
                  whiteSpace: 'nowrap',
                }}
              >
                {tb.label}
              </button>
            );
          })}
        </div>

        <div style={{ overflowY: 'auto', padding: '4px 22px 22px' }}>
          {tab === 'strava' ? (
            <WhyBetterThanStrava />
          ) : notes.length === 0 ? (
            <div style={{ fontSize: 13, color: tokens.inkLight, padding: '20px 0' }}>
              {en ? 'Nothing yet for this sport.' : 'Rien pour le moment pour ce sport.'}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {notes.map(n => {
                const copy = en ? n.en : n.fr;
                return (
                  <div key={n.id} style={{ display: 'flex', gap: 12, padding: 12, background: tokens.creamDark, borderRadius: 8 }}>
                    <span style={{ fontSize: 22, lineHeight: '24px', flexShrink: 0 }}>{n.icon}</span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 3 }}>
                        <span style={{ fontSize: 13.5, fontWeight: 700, color: tokens.ink }}>{copy.title}</span>
                        <span style={{ marginLeft: 'auto', flexShrink: 0, fontSize: 10, color: tokens.inkLight }}>{relDate(n.date, en)}</span>
                      </div>
                      <div style={{ fontSize: 12.5, color: tokens.inkMid, lineHeight: 1.5 }}>{copy.body}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
