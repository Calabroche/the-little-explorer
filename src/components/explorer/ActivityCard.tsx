'use client';

import dynamic from 'next/dynamic';
import { Activity, tokens } from './tokens';
import { TypeBadge, Label, StatChip, useIsMobile } from './ui';
import { useT, formatDateLocale } from '@/i18n';
import { formatPace } from '@/utils/format';

const CardMap = dynamic(() => import('./CardMap').then(m => m.CardMap), { ssr: false });

const WEATHER_ICON: Record<string, string> = {
  'Ensoleillé': '☀', 'Nuageux': '☁', 'Brouillard': '≋', 'Pluie': '⛆', 'Neige': '❄', 'Averses': '⛆', 'Orage': '↯',
  'Sunny': '☀', 'Cloudy': '☁', 'Fog': '≋', 'Rain': '⛆', 'Snow': '❄', 'Showers': '⛆', 'Storm': '↯',
};
const WEATHER_KEY: Record<string, string> = {
  'Ensoleillé': 'sunny', 'Nuageux': 'cloudy', 'Brouillard': 'fog',
  'Pluie': 'rain', 'Neige': 'snow', 'Averses': 'showers', 'Orage': 'storm',
};

function WeatherBadge({ w }: { w: NonNullable<Activity['weather']> }) {
  const { t } = useT();
  const icon = WEATHER_ICON[w.description] ?? '~';
  const key = WEATHER_KEY[w.description];
  const desc = key ? t(`weather.${key}`) : w.description;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontFamily: "'Space Grotesk'", fontSize: 11, color: tokens.inkLight }}>
      <span style={{ fontSize: 13 }}>{icon}</span>
      <span>{w.temp}°C</span>
      <span>{w.windspeed} km/h</span>
      <span>{w.humidity}% hum.</span>
      <span style={{ color: tokens.inkMid }}>{desc}</span>
    </div>
  );
}

export function ActivityCard({ activity, onClick }: { activity: Activity; onClick: (a: Activity) => void }) {
  const traceColor = activity.type === 'cycling' ? tokens.terra : tokens.green;
  const isMobile = useIsMobile();
  const { t, lang } = useT();
  const localizedDate = formatDateLocale(activity.rawDate, lang);

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
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <TypeBadge type={activity.type} />
              <Label>{localizedDate} · {activity.location}</Label>
              {/* Bike chip — cycling only, shown when we know which
                  bike Strava tagged this ride with. Lets the user tell
                  at a glance whether they were on the Canyon or the
                  e-bike (or any other bike, for users with more than
                  the two we test against). */}
              {activity.type === 'cycling' && activity.gear_name && (
                <span style={{
                  padding: '2px 8px',
                  background: tokens.creamDark,
                  border: `1px solid ${tokens.creamBorder}`,
                  borderRadius: 2,
                  fontFamily: "'Space Grotesk'",
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: '0.04em',
                  color: tokens.inkMid,
                }}>
                  ⛁ {activity.gear_name}
                </span>
              )}
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
            <StatChip label={t('card.duration')} value={activity.duration}  unit="" />
            <StatChip label={t('card.distance')} value={activity.distance}  unit="km" />
            {activity.type === 'running' && activity.pace_s_per_km != null
              ? <StatChip label={t('card.pace')} value={formatPace(activity.pace_s_per_km)} unit="/km" />
              : activity.speed     != null && <StatChip label={t('card.avgSpeed')} value={activity.speed}     unit="km/h" />}
            {activity.type !== 'running' && activity.max_speed != null && <StatChip label={t('card.maxSpeed')} value={activity.max_speed} unit="km/h" />}
            <StatChip label={t('card.elev')}     value={activity.elevation} unit="m" />
            {activity.max_incline != null && <StatChip label={'▲ ' + t('metric.slopeMaxLabel')} value={`+${activity.max_incline}`} unit="%" />}
            {activity.min_incline != null && <StatChip label={'▼ ' + t('metric.slopeMinLabel')} value={activity.min_incline}       unit="%" />}
            {activity.avg_hr     != null && <StatChip label={t('card.hr')} value={activity.avg_hr}    unit="bpm" />}
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
        <CardMap
          gps={activity.gps}
          color={traceColor}
          height="100%"
          speedKmh={activity.speed_kmh}
          activity={activity}  // ← enables the per-point hover tooltip (dist, slope, HR, speed, power, alt)
        />
      </div>
    </div>
  );
}
