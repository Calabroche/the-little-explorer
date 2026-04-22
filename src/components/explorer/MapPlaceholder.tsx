'use client';

import { tokens } from './tokens';
import { Label } from './ui';

export function MapPlaceholder({ mini }: { mini?: boolean }) {
  return (
    <div style={{
      width: mini ? 80 : '100%',
      height: mini ? 80 : '100%',
      background: `repeating-linear-gradient(45deg, ${tokens.creamDark} 0px, ${tokens.creamDark} 1px, transparent 1px, transparent 18px)`,
      borderRadius: mini ? 4 : 0, position: 'relative', overflow: 'hidden',
      border: mini ? `1px solid ${tokens.creamBorder}` : 'none',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0, opacity: 0.4 }}>
        <path d="M 60 420 C 120 350, 200 300, 280 260 C 360 220, 440 240, 520 200 C 580 170, 640 140, 700 120"
          fill="none" stroke={tokens.terra} strokeWidth={mini ? 1 : 2.5} strokeLinecap="round" />
        <path d="M 80 480 C 160 430, 240 380, 320 340 C 400 300, 480 290, 560 260 C 620 240, 660 200, 720 180"
          fill="none" stroke={tokens.green} strokeWidth={mini ? 1 : 2} strokeLinecap="round" strokeDasharray="4 4" />
        {!mini && <>
          <circle cx="60" cy="420" r="5" fill={tokens.terra} />
          <circle cx="700" cy="120" r="5" fill={tokens.terra} />
          <circle cx="80" cy="480" r="4" fill={tokens.green} />
          <circle cx="720" cy="180" r="4" fill={tokens.green} />
        </>}
      </svg>
      {!mini && (
        <Label style={{ position: 'relative', zIndex: 1, background: tokens.cream, padding: '4px 10px', borderRadius: 2 }}>
          CARTE · APERÇU
        </Label>
      )}
    </div>
  );
}
