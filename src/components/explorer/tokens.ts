import type { CSSProperties } from 'react';

export const tokens = {
  cream:       'var(--bg)',
  creamDark:   'var(--bg-dark)',
  creamBorder: 'var(--bg-border)',
  surface:     'var(--surface)',
  ink:         'var(--ink)',
  inkMid:      'var(--ink-mid)',
  inkLight:    'var(--ink-light)',
  terra:       'var(--terra)',
  terraLight:  'var(--terra-light)',
  green:       'var(--green)',
  greenLight:  'var(--green-light)',
  blue:        'var(--blue)',
} as const;

// Shared "card" style — was duplicated inline across 12 files.
// Default values match the most common usage (padding 24, marginBottom
// 32, radius 4). Sites with a different layout (tighter padding, no
// bottom margin, smaller radius) spread + override:
//
//   <div style={CARD_STYLE} />                             // default
//   <div style={{ ...CARD_STYLE, marginBottom: 24 }} />    // tighter
//   <div style={{ ...CARD_STYLE, padding: 20 }} />         // compact
export const CARD_STYLE: CSSProperties = {
  background:   tokens.surface,
  border:       `1px solid ${tokens.creamBorder}`,
  borderRadius: 4,
  padding:      24,
  marginBottom: 32,
};

export interface Activity {
  id: number;
  type:
    | 'cycling' | 'running' | 'hiking' | 'walking' | 'swim' | 'snowshoe'
    | 'ski' | 'snowboard' | 'iceSkate'
    | 'yoga' | 'workout' | 'cardio'
    | 'rowing' | 'kayak' | 'paddle' | 'surf' | 'sail'
    | 'inlineSkate' | 'skateboard'
    | 'climbing' | 'racket' | 'soccer' | 'golf' | 'wheelchair'
    | 'other';
  pace_s_per_km?: number | null;
  title: string;
  date: string;
  rawDate: string;
  location: string;
  duration: string;
  distance: number;
  speed: number | null;
  elevation: number;
  descent: number;
  photos: string[];
  gps: { lat: number; lng: number }[];
  duration_min?: number;
  max_speed?: number;
  max_incline?: number | null;
  min_incline?: number | null;
  avg_hr?: number | null;
  max_hr?: number | null;
  calories?: number | null;
  speed_kmh?: number[];
  altitude?: number[];
  heartrate?: number[];
  time_s?: number[];
  distance_m?: number[];
  // Advanced training metrics
  np?: number | null;
  avg_power?: number | null;
  tss?: number | null;
  if_factor?: number | null;
  vi?: number | null;
  wkg?: number | null;
  ef?: number | null;
  trimp?: number | null;
  hrZones?: { z1: number; z2: number; z3: number; z4: number; z5: number } | null;
  aed?: number | null;
  vam?: number | null;
  bestEfforts?: {
    s60:   number | null;
    s300:  number | null;
    s600:  number | null;
    s1200: number | null;
    s1800: number | null;
    s3600: number | null;
  } | null;
  original_type?: string;
  /** Strava gear_id — present on cycling activities tagged with a bike. */
  gear_id?: string | null;
  /** Bike nickname denormalized server-side from bike_gears.name
   *  (e.g. "Rocket", "Elon musk"). Null when gear_id is null or
   *  when the bike row hasn't been synced yet. */
  gear_name?: string | null;
  ftp?: number;
  rider_kg?: number;
  total_mass?: number;
  // Weather
  weather?: {
    temp: number;
    windspeed: number;
    humidity: number;
    code: number;
    description: string;
  } | null;
}

export interface GlobalStats {
  totalActivities: number;
  totalDistance: number;
  totalElevation: number;
  totalHours: number;
  cycling: number;
  running: number;
  hiking: number;
}

export function deriveStats(activities: Activity[]): GlobalStats {
  const cycling = activities.filter(a => a.type === 'cycling');
  const running = activities.filter(a => a.type === 'running');
  const hiking  = activities.filter(a => a.type === 'hiking');
  // Use duration_min (already in minutes) instead of parsing the formatted
  // duration string — the old "27m" parser was treating the 27 as hours.
  const totalMinutes = activities.reduce((s, a) => s + (a.duration_min ?? 0), 0);
  return {
    totalActivities: activities.length,
    totalDistance:   +activities.reduce((s, a) => s + a.distance, 0).toFixed(0),
    totalElevation:  +activities.reduce((s, a) => s + a.elevation, 0).toFixed(0),
    totalHours:      Math.round(totalMinutes / 60),
    cycling: cycling.length,
    running: running.length,
    hiking:  hiking.length,
  };
}
