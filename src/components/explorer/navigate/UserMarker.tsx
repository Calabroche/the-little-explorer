'use client';

import { useEffect, useMemo } from 'react';
import { Marker, useMap } from 'react-leaflet';
import L from 'leaflet';
import { tokens } from '../tokens';

// Lazy-loaded user puck with heading-aware arrow. We use a Leaflet
// divIcon (not CircleMarker) so we can rotate an SVG arrow via CSS.
// The icon is rebuilt only when heading bucket changes — rotating to
// the nearest 5° avoids spamming Leaflet with new icons every frame.
interface Fix { lat: number; lng: number; speed: number | null; heading: number | null; accuracy: number; ts: number }

function buildIcon(heading: number | null, hasFix: boolean): L.DivIcon {
  const rot = heading != null && Number.isFinite(heading) ? Math.round(heading / 5) * 5 : null;
  const arrow = rot != null
    ? `<div style="position:absolute;top:-12px;left:50%;width:0;height:0;
                   transform:translateX(-50%) rotate(${rot}deg) translateY(-12px);
                   border-left:8px solid transparent;border-right:8px solid transparent;
                   border-bottom:14px solid ${tokens.terra};
                   transform-origin:center 26px"></div>`
    : '';
  return L.divIcon({
    className: 'tle-user-puck',
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    html: `
      <div style="position:relative;width:22px;height:22px;">
        <div style="position:absolute;inset:0;background:${hasFix ? tokens.terra : tokens.inkLight};
                    border:3px solid #fff;border-radius:50%;
                    box-shadow:0 2px 8px rgba(0,0,0,0.35);"></div>
        ${arrow}
      </div>
    `,
  });
}

export function UserMarker({ fix }: { fix: Fix | null }) {
  const map = useMap();
  // Re-render the icon when heading changes (bucketed) or fix state flips.
  const icon = useMemo(
    () => buildIcon(fix?.heading ?? null, !!fix),
    [fix?.heading, !!fix],
  );

  // Smoothly fly the map to the first fix so the user sees themselves
  // appear in context (the parent's FollowCamera handles subsequent
  // pans).
  useEffect(() => {
    if (fix) map.setView([fix.lat, fix.lng], Math.max(map.getZoom(), 16));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!fix]);

  if (!fix) return null;
  return <Marker position={[fix.lat, fix.lng]} icon={icon} interactive={false} />;
}
