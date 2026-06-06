'use client';

import { useT } from '@/i18n';
import { tokens } from './tokens';
import { FEATURE_NOTES, FeatureNote, FeatureSport } from './featureNotes';
import { WhyBetterThanStrava } from './WhyBetterThanStrava';

// Features are grouped BY SPORT in the panel.
const SPORT_ORDER: FeatureSport[] = ['all', 'cycling', 'running'];
const SPORT_LABELS: Record<FeatureSport, { fr: string; en: string }> = {
  all:     { fr: 'Tous les sports', en: 'All sports' },
  cycling: { fr: '🚴 Vélo',         en: '🚴 Cycling' },
  running: { fr: '🏃 Course',       en: '🏃 Running' },
};

// Small "when" caption per item (the recency is still visible without
// being the primary grouping).
function relDate(dateStr: string, en: boolean): string {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(`${dateStr}T00:00:00`);
  const days = Math.floor((today.getTime() - d.getTime()) / 86_400_000);
  if (days <= 0) return en ? 'today' : "aujourd'hui";
  if (days === 1) return en ? 'yesterday' : 'hier';
  if (days <= 30) return en ? `${days}d ago` : `il y a ${days} j`;
  return d.toLocaleDateString(en ? 'en-US' : 'fr-FR', { day: '2-digit', month: 'short' });
}

// The full "what's new" archive, opened from the "i" button. Lists every
// feature note grouped by sport (newest first within each).
export function WhatsNewPanel({ onClose }: { onClose: () => void }) {
  const { lang } = useT();
  const en = lang === 'en';

  const grouped: Record<FeatureSport, FeatureNote[]> = { all: [], cycling: [], running: [] };
  for (const n of FEATURE_NOTES) grouped[n.sport].push(n);

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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 22px 12px' }}>
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

        <div style={{ overflowY: 'auto', padding: '4px 22px 22px' }}>
          {/* Pinned: why The Little Explorer beats Strava. */}
          <div style={{ marginTop: 12 }}>
            <WhyBetterThanStrava />
          </div>
          {SPORT_ORDER.filter(sp => grouped[sp].length > 0).map(sp => (
            <div key={sp} style={{ marginTop: 16 }}>
              <div style={{
                fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
                color: tokens.terra, marginBottom: 10,
              }}>
                {en ? SPORT_LABELS[sp].en : SPORT_LABELS[sp].fr}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {grouped[sp].map(n => {
                  const copy = en ? n.en : n.fr;
                  return (
                    <div key={n.id} style={{
                      display: 'flex', gap: 12, padding: 12,
                      background: tokens.creamDark, borderRadius: 8,
                    }}>
                      <span style={{ fontSize: 22, lineHeight: '24px', flexShrink: 0 }}>{n.icon}</span>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 3 }}>
                          <span style={{ fontSize: 13.5, fontWeight: 700, color: tokens.ink }}>{copy.title}</span>
                          <span style={{ marginLeft: 'auto', flexShrink: 0, fontSize: 10, color: tokens.inkLight }}>{relDate(n.date, en)}</span>
                        </div>
                        <div style={{ fontSize: 12.5, color: tokens.inkMid, lineHeight: 1.5 }}>
                          {copy.body}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          {FEATURE_NOTES.length === 0 && (
            <div style={{ fontSize: 13, color: tokens.inkLight, padding: '20px 0' }}>
              {en ? 'Nothing yet.' : 'Rien pour le moment.'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
