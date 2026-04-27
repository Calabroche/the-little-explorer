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

export interface Activity {
  id: number;
  type: 'cycling' | 'hiking';
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
  hiking: number;
}

export function deriveStats(activities: Activity[]): GlobalStats {
  const cycling = activities.filter(a => a.type === 'cycling');
  const hiking  = activities.filter(a => a.type === 'hiking');
  return {
    totalActivities: activities.length,
    totalDistance:   +activities.reduce((s, a) => s + a.distance, 0).toFixed(0),
    totalElevation:  +activities.reduce((s, a) => s + a.elevation, 0).toFixed(0),
    totalHours:      +activities.reduce((s, a) => {
      const [h = 0, m = 0] = a.duration.replace('h ', ':').replace('m', '').split(':').map(Number);
      return s + h + m / 60;
    }, 0).toFixed(0),
    cycling: cycling.length,
    hiking:  hiking.length,
  };
}
