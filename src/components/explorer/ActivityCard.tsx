'use client';

import dynamic from 'next/dynamic';
import { Activity, tokens } from './tokens';
import { TypeBadge, Label, StatChip, useIsMobile } from './ui';

const CardMap = dynamic(() => import('./CardMap').then(m => m.CardMap), { ssr: false });

function WeatherBadge({ w }: { w: NonNullable<Activity['weather']> }) {
  const icons: Record<string, string> = {
    'Ensoleillé': '☀', 'Nuageux': '☁', 'Brouillard': '≋',
    'Pluie': '⛆', 'Neige': '❄', 'Averses': '⛆', 'Orage': '↯',
  };
  const icon = icons[w.description] ?? '~';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontFamily: "'Space Grotesk'", fontSize: 11, color: tokens.inkLight }}>
      <span style={{ fontSize: 13 }}>{icon}</span>
      <span>{w.temp}°C</span>
      <span>{w.windspeed} km/h</span>
      <span>{w.humidity}% hum.</span>
      <span style={{ color: tokens.inkMid }}>{w.description}</span>
    </div>
  );
}

export function ActivityCard({ activity, onClick }: { activity: Activity; onClick: (a: Activity) => void }) {
  const traceColor = activity.type === 'cycling' ? tokens.terra : tokens.green;
  const isMobile = useIsMobile();

  return (
    <div
      onClick={() => onClick(activity)}
      style={{
        background: tokens.surface,
        border: `1px solid ${tokens.creamBorder}`,
        borderRadius: 4, marginBottom: 16, cursor: 'pointer',
        display: 'flex', flexDirection: isMobile ? 'column' : 'row',
        overflow: 'hidden', minHeight: isMobile ? 0 : 220,
      }}
    >
      {/* Info */}
      <div style={{ flex: 1, padding: isMobile ? 16 : 24, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, flexWrap: 'wrap', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <TypeBadge type={activity.type} />
              <Label>{activity.date} · {activity.location}</Label>
            </div>
            {activity.weather && !isMobile && <WeatherBadge w={activity.weather} />}
          </div>
          <h3 style={{ fontFamily: "'Playfair Display'", fontSize: isMobile ? 18 : 22, fontWeight: 700, color: tokens.ink, lineHeight: 1.2, marginBottom: 16 }}>
            {activity.title}
          </h3>
        </div>

        {/* Primary stats */}
        <div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)',
            gap: '12px 0', borderTop: `1px solid ${tokens.creamBorder}`, paddingTop: 14, marginBottom: 12,
          }}>
            <StatChip label="Durée"    value={activity.duration}  unit="" />
            <StatChip label="Distance" value={activity.distance}  unit="km" />
            {activity.speed     != null && <StatChip label="Moy"    value={activity.speed}      unit="km/h" />}
            {activity.max_speed != null && <StatChip label="Max"    value={activity.max_speed}  unit="km/h" />}
            <StatChip label="Montée"   value={activity.elevation} unit="m" />
            {activity.max_incline != null && <StatChip label="Pente ▲" value={`+${activity.max_incline}`} unit="%" />}
            {activity.min_incline != null && <StatChip label="Pente ▼" value={activity.min_incline}       unit="%" />}
            {activity.avg_hr     != null && <StatChip label="FC moy" value={activity.avg_hr}    unit="bpm" />}
          </div>

          {/* Training metrics row */}
          {(activity.np || activity.tss || activity.wkg) && (
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', paddingTop: 10, borderTop: `1px solid ${tokens.creamBorder}` }}>
              {activity.np   != null && (
                <div>
                  <Label style={{ display: 'block', marginBottom: 2 }}>NP</Label>
                  <span style={{ fontFamily: "'Playfair Display'", fontSize: 20, fontWeight: 700, color: tokens.green }}>{activity.np}<span style={{ fontFamily: "'Space Grotesk'", fontSize: 10, color: tokens.inkLight, marginLeft: 2 }}>W</span></span>
                </div>
              )}
              {activity.tss  != null && (
                <div>
                  <Label style={{ display: 'block', marginBottom: 2 }}>TSS</Label>
                  <span style={{ fontFamily: "'Playfair Display'", fontSize: 20, fontWeight: 700, color: tokens.terra }}>{activity.tss}</span>
                </div>
              )}
              {activity.wkg  != null && (
                <div>
                  <Label style={{ display: 'block', marginBottom: 2 }}>W/kg</Label>
                  <span style={{ fontFamily: "'Playfair Display'", fontSize: 20, fontWeight: 700, color: tokens.blue }}>{activity.wkg}</span>
                </div>
              )}
              {activity.trimp != null && (
                <div>
                  <Label style={{ display: 'block', marginBottom: 2 }}>TRIMP</Label>
                  <span style={{ fontFamily: "'Playfair Display'", fontSize: 20, fontWeight: 700, color: tokens.inkMid }}>{activity.trimp}</span>
                </div>
              )}
              {activity.if_factor != null && (
                <div>
                  <Label style={{ display: 'block', marginBottom: 2 }}>IF</Label>
                  <span style={{ fontFamily: "'Playfair Display'", fontSize: 20, fontWeight: 700, color: tokens.inkMid }}>{activity.if_factor}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Map */}
      <div style={{
        width: isMobile ? '100%' : 360,
        height: isMobile ? 160 : undefined,
        flexShrink: 0,
        borderLeft: isMobile ? 'none' : `1px solid ${tokens.creamBorder}`,
        borderTop: isMobile ? `1px solid ${tokens.creamBorder}` : 'none',
      }}>
        <CardMap gps={activity.gps} color={traceColor} height="100%" speedKmh={activity.speed_kmh} />
      </div>
    </div>
  );
}
