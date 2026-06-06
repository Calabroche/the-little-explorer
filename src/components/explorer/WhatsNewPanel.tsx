'use client';

import { useT } from '@/i18n';
import { tokens } from './tokens';
import { FEATURE_NOTES, FeatureNote } from './featureNotes';

// Recency buckets, relative to today.
type Bucket = 'today' | 'week' | 'month' | 'earlier';
function bucketOf(dateStr: string): Bucket {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(`${dateStr}T00:00:00`);
  const days = Math.floor((today.getTime() - d.getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days <= 7) return 'week';
  if (days <= 30) return 'month';
  return 'earlier';
}

const SECTION_LABELS: Record<Bucket, { fr: string; en: string }> = {
  today:   { fr: "Aujourd'hui",       en: 'Today' },
  week:    { fr: '7 derniers jours',  en: 'Last 7 days' },
  month:   { fr: '30 derniers jours', en: 'Last 30 days' },
  earlier: { fr: 'Plus tôt',          en: 'Earlier' },
};
const ORDER: Bucket[] = ['today', 'week', 'month', 'earlier'];

// The full "what's new" archive, opened from the "i" button. Lists every
// feature note grouped into today / this week / this month / earlier.
export function WhatsNewPanel({ onClose }: { onClose: () => void }) {
  const { lang } = useT();
  const en = lang === 'en';

  const grouped: Record<Bucket, FeatureNote[]> = { today: [], week: [], month: [], earlier: [] };
  for (const n of FEATURE_NOTES) grouped[bucketOf(n.date)].push(n);

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
          {ORDER.filter(b => grouped[b].length > 0).map(b => (
            <div key={b} style={{ marginTop: 16 }}>
              <div style={{
                fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
                color: tokens.inkLight, marginBottom: 10,
              }}>
                {en ? SECTION_LABELS[b].en : SECTION_LABELS[b].fr}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {grouped[b].map(n => {
                  const copy = en ? n.en : n.fr;
                  return (
                    <div key={n.id} style={{
                      display: 'flex', gap: 12, padding: 12,
                      background: tokens.creamDark, borderRadius: 8,
                    }}>
                      <span style={{ fontSize: 22, lineHeight: '24px', flexShrink: 0 }}>{n.icon}</span>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 700, color: tokens.ink, marginBottom: 3 }}>
                          {copy.title}
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
