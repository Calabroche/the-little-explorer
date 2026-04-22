'use client';

import { useState } from 'react';
import { Activity, tokens } from './tokens';
import { TypeBadge, Label, StatChip } from './ui';
import { MapPlaceholder } from './MapPlaceholder';

export function ActivityCard({ activity, onClick }: { activity: Activity; onClick: (a: Activity) => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div onClick={() => onClick(activity)}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered ? tokens.creamDark : 'white',
        border: `1px solid ${tokens.creamBorder}`,
        borderRadius: 4, padding: 24, marginBottom: 16, cursor: 'pointer',
        transition: 'background 0.15s, transform 0.15s',
        transform: hovered ? 'translateY(-1px)' : 'none',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <TypeBadge type={activity.type} />
            <Label>{activity.date} · {activity.location}</Label>
          </div>
          <h3 style={{ fontFamily: "'Playfair Display'", fontSize: 22, fontWeight: 700, color: tokens.ink, lineHeight: 1.2 }}>
            {activity.title}
          </h3>
        </div>
        <MapPlaceholder mini />
      </div>

      <div style={{ display: 'flex', gap: 0, borderTop: `1px solid ${tokens.creamBorder}`, paddingTop: 16, marginBottom: 16 }}>
        <StatChip label="Durée" value={activity.duration} unit="" />
        <StatChip label="Distance" value={activity.distance} unit="km" />
        {activity.speed && <StatChip label="Vitesse" value={activity.speed} unit="km/h" />}
        <StatChip label="Montée" value={activity.elevation} unit="m" />
        <StatChip label="Descente" value={activity.descent} unit="m" />
      </div>

      {activity.photos.length > 0 && (
        <div style={{ display: 'flex', gap: 6, height: 120 }}>
          <div style={{ flex: 2, borderRadius: 3, overflow: 'hidden' }}>
            <img src={activity.photos[0]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </div>
          {activity.photos.slice(1, 3).map((p, i) => (
            <div key={i} style={{ flex: 1, borderRadius: 3, overflow: 'hidden' }}>
              <img src={p} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
