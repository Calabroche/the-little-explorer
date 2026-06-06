'use client';

import { useEffect, useState } from 'react';
import { useT } from '@/i18n';
import { tokens } from './tokens';
import { FEATURE_NOTES, FeatureNote } from './featureNotes';

const SEEN_KEY = 'tle_seen_features';

function readSeen(): string[] {
  try { return JSON.parse(localStorage.getItem(SEEN_KEY) || '[]'); } catch { return []; }
}

// Home-screen "what's new" popup. Shows the most recent feature note the
// rider hasn't dismissed; ✕ or the OK button marks it seen so it never
// shows again. Mounted once at the app root.
export function FeatureAnnouncement() {
  const { lang } = useT();
  const [note, setNote] = useState<FeatureNote | null>(null);

  // Decide on mount (client-only) to avoid an SSR hydration mismatch.
  // Only the NEWEST note can pop up — older/backfilled entries live in the
  // "i" panel and must never resurface as launch popups.
  useEffect(() => {
    const newest = FEATURE_NOTES[0];
    if (newest && !readSeen().includes(newest.id)) setNote(newest);
  }, []);

  if (!note) return null;
  const copy = lang === 'en' ? note.en : note.fr;

  const dismiss = () => {
    try {
      const seen = readSeen();
      if (!seen.includes(note.id)) {
        seen.push(note.id);
        localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
      }
    } catch { /* private mode — still close it for this session */ }
    setNote(null);
  };

  return (
    <div
      onClick={dismiss}
      style={{
        position: 'fixed', inset: 0, zIndex: 4000,
        background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          position: 'relative', width: '100%', maxWidth: 420,
          background: tokens.surface, border: `1px solid ${tokens.creamBorder}`,
          borderRadius: 10, padding: '28px 26px',
          boxShadow: '0 24px 64px rgba(0,0,0,0.3)',
          fontFamily: "'Space Grotesk'",
        }}
      >
        <button
          onClick={dismiss}
          aria-label={lang === 'en' ? 'Close' : 'Fermer'}
          style={{
            position: 'absolute', top: 12, right: 12, width: 28, height: 28,
            background: 'transparent', border: `1px solid ${tokens.creamBorder}`, borderRadius: 6,
            color: tokens.inkMid, cursor: 'pointer', fontSize: 14, lineHeight: '1',
          }}
        >✕</button>

        <div style={{ fontSize: 40, marginBottom: 10 }}>{note.icon}</div>
        <div style={{
          fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase',
          color: tokens.terra, marginBottom: 8,
        }}>
          {lang === 'en' ? '✦ New' : '✦ Nouveau'}
        </div>
        <h2 style={{
          fontFamily: "'Playfair Display'", fontSize: 22, fontWeight: 800,
          color: tokens.ink, margin: '0 0 10px', lineHeight: 1.2,
        }}>
          {copy.title}
        </h2>
        <p style={{ fontSize: 13.5, color: tokens.inkMid, lineHeight: 1.6, margin: '0 0 22px' }}>
          {copy.body}
        </p>
        <button
          onClick={dismiss}
          style={{
            width: '100%', padding: '12px 14px', border: 'none', borderRadius: 6,
            background: tokens.terra, color: '#fff', cursor: 'pointer',
            fontFamily: "'Space Grotesk'", fontSize: 13, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
          }}
        >
          {lang === 'en' ? 'OK, thanks!' : "OK, merci pour l'info"}
        </button>
      </div>
    </div>
  );
}
