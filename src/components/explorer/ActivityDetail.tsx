'use client';

import { useEffect } from 'react';
import { Activity, tokens } from './tokens';
import { TypeBadge, Label, StatChip } from './ui';

export function ActivityDetail({ activity, onClose }: { activity: Activity; onClose: () => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(20,15,10,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 100, backdropFilter: 'blur(4px)',
    }} onClick={onClose}>
      <div style={{
        background: tokens.cream, borderRadius: 6, maxWidth: 720, width: '90%',
        maxHeight: '88vh', overflowY: 'auto', padding: 40, position: 'relative',
      }} onClick={e => e.stopPropagation()}>
        <button onClick={onClose} style={{
          position: 'absolute', top: 20, right: 20, background: 'none', border: 'none',
          cursor: 'pointer', fontFamily: "'Space Grotesk'", fontSize: 11, letterSpacing: '0.1em',
          color: tokens.inkLight, textTransform: 'uppercase',
        }}>ESC · FERMER</button>

        <TypeBadge type={activity.type} />
        <h2 style={{ fontFamily: "'Playfair Display'", fontSize: 32, fontWeight: 900, color: tokens.ink, marginTop: 10, marginBottom: 4 }}>
          {activity.title}
        </h2>
        <Label style={{ display: 'block', marginBottom: 28 }}>{activity.date} · {activity.location}</Label>

        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 0,
          borderTop: `1px solid ${tokens.creamBorder}`, borderBottom: `1px solid ${tokens.creamBorder}`,
          padding: '20px 0', marginBottom: 28,
        }}>
          <StatChip label="Durée" value={activity.duration} unit="" />
          <StatChip label="Distance" value={activity.distance} unit="km" />
          <StatChip label="Montée" value={activity.elevation} unit="m" />
          <StatChip label="Descente" value={activity.descent} unit="m" />
        </div>

        <div style={{ marginBottom: 28 }}>
          <Label style={{ display: 'block', marginBottom: 12 }}>PROFIL D&apos;ÉLÉVATION</Label>
          <div style={{
            height: 80, background: 'white', border: `1px solid ${tokens.creamBorder}`,
            borderRadius: 4, padding: '8px 16px', display: 'flex', alignItems: 'flex-end', overflow: 'hidden',
          }}>
            <svg viewBox="0 0 400 60" width="100%" height="100%" preserveAspectRatio="none">
              <defs>
                <linearGradient id="elevGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={tokens.terra} stopOpacity="0.3" />
                  <stop offset="100%" stopColor={tokens.terra} stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d="M0,55 C20,50 40,45 70,30 C100,15 130,10 160,18 C190,26 210,35 240,25 C270,15 300,8 330,12 C360,16 380,20 400,15 L400,60 L0,60 Z" fill="url(#elevGrad)" />
              <path d="M0,55 C20,50 40,45 70,30 C100,15 130,10 160,18 C190,26 210,35 240,25 C270,15 300,8 330,12 C360,16 380,20 400,15" fill="none" stroke={tokens.terra} strokeWidth="2" />
            </svg>
          </div>
        </div>

        {activity.photos.length > 0 && <>
          <Label style={{ display: 'block', marginBottom: 12 }}>PHOTOS</Label>
          <div style={{ display: 'flex', gap: 8, height: 160 }}>
            <div style={{ flex: 2, borderRadius: 4, overflow: 'hidden' }}>
              <img src={activity.photos[0]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            </div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {activity.photos.slice(1).map((p, i) => (
                <div key={i} style={{ flex: 1, borderRadius: 4, overflow: 'hidden' }}>
                  <img src={p} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
              ))}
            </div>
          </div>
        </>}
      </div>
    </div>
  );
}
