import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

// Force dynamic rendering : la route lit `data/activities/` à chaque requête
// (sinon Next.js 13 app-router la rend statique au build et le CDN sert un
// résultat figé même après ajout de nouveaux fichiers).
export const dynamic = 'force-dynamic';

const DATA_DIR      = path.join(process.cwd(), 'data', 'activities');
const WEATHER_CACHE = path.join(process.cwd(), 'data', 'weather_cache.json'); // read-only on serverless

// ── Physics & training constants ──────────────────────────────────────────────
const MASS = 74.18, G = 9.81, CRR = 0.004, CDA = 0.3, RHO = 1.225;
const FTP       = 291;  // FTP estimé : 66kg × 2.205 lb/kg × 2 = 291W
const RIDER_KG  = 66;   // rider weight (kg)
const HR_REST   = 60;   // resting heart rate (bpm)

// ── Formatting helpers ────────────────────────────────────────────────────────
function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m.toString().padStart(2, '0')}m` : `${m}m`;
}

function formatDate(isoStr: string): string {
  return new Date(isoStr)
    .toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
    .toUpperCase().replace('.', '');
}

// ── Inclines ──────────────────────────────────────────────────────────────────
function calcInclines(altitude: number[], distance_m: number[]) {
  if (!altitude || !distance_m || altitude.length < 50) return { max_incline: null, min_incline: null };

  // Short 5-pt window (~30m at typical cycling speed) — no pre-smoothing
  // to preserve steep short segments as Strava reports them.
  // 97th percentile up / 5th percentile down removes GPS spikes while
  // matching Strava's reported max gradient within ~0.1–0.2%.
  const WINDOW = 5, MIN_DIST = 8, CAP = 30;
  const ups: number[] = [], downs: number[] = [];
  for (let i = 0; i < altitude.length - WINDOW; i++) {
    const dAlt  = altitude[i + WINDOW] - altitude[i];
    const dDist = distance_m[i + WINDOW] - distance_m[i];
    if (dDist >= MIN_DIST) {
      const g = (dAlt / dDist) * 100;
      if (g > 0 && g <= CAP) ups.push(g);
      if (g < 0 && g >= -CAP) downs.push(g);
    }
  }

  const pct = (arr: number[], p: number) => {
    if (!arr.length) return null;
    const s = [...arr].sort((a, b) => a - b);
    return +(s[Math.min(Math.floor(s.length * p), s.length - 1)]).toFixed(1);
  };
  return {
    max_incline: pct(ups, 0.97),
    min_incline: pct(downs, 0.05),
  };
}

// ── Power stream ──────────────────────────────────────────────────────────────
function computePowerStream(speed_kmh: number[], altitude: number[], distance_m: number[]): number[] {
  const n = Math.min(speed_kmh.length, altitude.length, distance_m.length);
  const power = new Array(n).fill(0);
  const W = 30;
  for (let i = 0; i < n; i++) {
    const v = (speed_kmh[i] || 0) / 3.6;
    let grad = 0;
    if (i >= W && i < n - W) {
      const dAlt  = altitude[i + W] - altitude[i - W];
      const dDist = distance_m[i + W] - distance_m[i - W];
      if (dDist >= 10) grad = Math.max(-0.3, Math.min(0.3, dAlt / dDist));
    }
    const F = MASS * G * grad + MASS * G * CRR + 0.5 * RHO * CDA * v * v;
    power[i] = Math.max(0, F * v);
  }
  return power;
}

// NP: rolling 30s avg → ^4 → mean → ^0.25
function computeNP(power: number[]): number {
  const W = 30;
  if (power.length < W) return 0;
  let windowSum = 0;
  for (let i = 0; i < W; i++) windowSum += power[i];
  let sum4 = Math.pow(windowSum / W, 4);
  const count = power.length - W + 1;
  for (let i = W; i < power.length; i++) {
    windowSum += power[i] - power[i - W];
    sum4 += Math.pow(windowSum / W, 4);
  }
  return Math.round(Math.pow(sum4 / count, 0.25));
}

// HR Zones (absolute bpm): Z1<136 Z2 137-149 Z3 150-162 Z4 163-175 Z5>175
function computeHRZones(heartrate: number[], durationSec: number) {
  if (!heartrate.length) return null;
  const dt = durationSec / heartrate.length;
  const z = { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 };
  for (const hr of heartrate) {
    if      (hr < 136) z.z1 += dt;
    else if (hr < 150) z.z2 += dt;
    else if (hr < 163) z.z3 += dt;
    else if (hr < 176) z.z4 += dt;
    else               z.z5 += dt;
  }
  return {
    z1: +(z.z1 / 60).toFixed(1), z2: +(z.z2 / 60).toFixed(1),
    z3: +(z.z3 / 60).toFixed(1), z4: +(z.z4 / 60).toFixed(1),
    z5: +(z.z5 / 60).toFixed(1),
  };
}

// TRIMP (Banister): Σ(Δt_min × hr_ratio × 0.64 × e^(1.92×hr_ratio))
function computeTRIMP(heartrate: number[], hrMax: number, durationSec: number): number {
  if (!heartrate.length) return 0;
  const dtMin = (durationSec / heartrate.length) / 60;
  let trimp = 0;
  for (const hr of heartrate) {
    const ratio = (hr - HR_REST) / (hrMax - HR_REST);
    if (ratio > 0) trimp += dtMin * ratio * 0.64 * Math.exp(1.92 * ratio);
  }
  return Math.round(trimp);
}

// VAM: average ascent rate on climbing segments >2% (m/h)
function computeVAM(altitude: number[], distance_m: number[], durationSec: number): number | null {
  const n = altitude.length;
  if (n < 60) return null;
  const dt = durationSec / n;
  const W = 20;
  let totalGain = 0, climbSec = 0;
  for (let i = W; i < n - W; i++) {
    const dAlt  = altitude[i + W] - altitude[i - W];
    const dDist = distance_m[i + W] - distance_m[i - W];
    if (dDist > 5 && dAlt / dDist > 0.02) {
      totalGain += Math.max(0, altitude[i] - altitude[i - 1]);
      climbSec  += dt;
    }
  }
  if (climbSec < 60) return null;
  return Math.round((totalGain / climbSec) * 3600);
}

// Aerobic Decoupling: EF first half vs second half
function computeAeD(power: number[], heartrate: number[]): number | null {
  const n = Math.min(power.length, heartrate.length);
  if (n < 120) return null;
  const mid = Math.floor(n / 2);
  let p1 = 0, hr1 = 0, p2 = 0, hr2 = 0;
  for (let i = 0; i < mid; i++) { p1 += power[i]; hr1 += heartrate[i]; }
  for (let i = mid; i < n; i++)  { p2 += power[i]; hr2 += heartrate[i]; }
  const ef1 = (p1 / mid) / (hr1 / mid);
  const ef2 = (p2 / (n - mid)) / (hr2 / (n - mid));
  if (!ef1) return null;
  return +((ef1 - ef2) / ef1 * 100).toFixed(1);
}

// ── Weather ───────────────────────────────────────────────────────────────────
interface WeatherData {
  temp: number; windspeed: number; humidity: number; code: number; description: string;
}

function weatherDesc(code: number): string {
  if (code === 0)  return 'Ensoleillé';
  if (code <= 3)   return 'Nuageux';
  if (code <= 48)  return 'Brouillard';
  if (code <= 67)  return 'Pluie';
  if (code <= 77)  return 'Neige';
  if (code <= 82)  return 'Averses';
  return 'Orage';
}

// In-memory cache for serverless environments (Vercel)
const memWeatherCache: Record<string, WeatherData> = (() => {
  try { if (fs.existsSync(WEATHER_CACHE)) return JSON.parse(fs.readFileSync(WEATHER_CACHE, 'utf8')); }
  catch {}
  return {};
})();

async function getWeather(id: number, lat: number, lng: number, isoDate: string): Promise<WeatherData | null> {
  const key = String(id);
  if (memWeatherCache[key]) return memWeatherCache[key];
  const date = isoDate.split('T')[0];
  const hour = new Date(isoDate).getUTCHours();
  try {
    const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}&start_date=${date}&end_date=${date}&hourly=temperature_2m,windspeed_10m,relativehumidity_2m,weathercode&timezone=UTC`;
    const res  = await fetch(url);
    if (!res.ok) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await res.json();
    const h = Math.min(hour, (data.hourly?.temperature_2m?.length ?? 1) - 1);
    const weather: WeatherData = {
      temp:        Math.round(data.hourly.temperature_2m[h]),
      windspeed:   Math.round(data.hourly.windspeed_10m[h]),
      humidity:    Math.round(data.hourly.relativehumidity_2m[h]),
      code:        data.hourly.weathercode[h] ?? 0,
      description: weatherDesc(data.hourly.weathercode[h] ?? 0),
    };
    memWeatherCache[key] = weather;
    return weather;
  } catch { return null; }
}

// ── Main transform ────────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function transform(raw: any) {
  const { max_incline, min_incline } = calcInclines(raw.altitude, raw.distance_m);
  const speed_kmh: number[] = raw.speed_kmh  ?? [];
  const altitude:  number[] = raw.altitude   ?? [];
  const distance_m: number[] = raw.distance_m ?? [];
  const heartrate:  number[] = raw.heartrate  ?? [];
  const duration_s = (raw.duration_min ?? 0) * 60;

  const n = Math.min(speed_kmh.length, altitude.length, distance_m.length);
  const powerStream = n > 60 ? computePowerStream(speed_kmh, altitude, distance_m) : [];

  const np       = powerStream.length > 30 ? computeNP(powerStream) : null;
  const avgPower = powerStream.length ? Math.round(powerStream.reduce((s, v) => s + v, 0) / powerStream.length) : null;
  const ifFactor = np ? +(np / FTP).toFixed(2) : null;
  const tss      = (np && ifFactor && duration_s) ? Math.round((duration_s * np * ifFactor) / (FTP * 3600) * 100) : null;
  const vi       = (np && avgPower) ? +(np / avgPower).toFixed(2) : null;
  const wkg      = np ? +(np / RIDER_KG).toFixed(2) : null;

  const hasHR = heartrate.length > 60;
  const hrMax = (raw.max_hr as number) || 190;
  const avgHR = hasHR ? Math.round(heartrate.reduce((s, v) => s + v, 0) / heartrate.length) : null;
  const ef    = (np && avgHR) ? +(np / avgHR).toFixed(2) : null;
  const trimp = hasHR ? computeTRIMP(heartrate, hrMax, duration_s) : null;
  const hrZones = hasHR ? computeHRZones(heartrate, duration_s) : null;
  const aed   = (powerStream.length > 120 && hasHR) ? computeAeD(powerStream, heartrate) : null;
  const vam   = altitude.length > 60 ? computeVAM(altitude, distance_m, duration_s) : null;

  return {
    id:          raw.id,
    type:        'cycling' as const,
    title:       raw.name,
    date:        formatDate(raw.date),
    rawDate:     raw.date,
    location:    'France',
    duration:    formatDuration(raw.duration_min),
    distance:    raw.distance_km,
    duration_min: raw.duration_min as number,
    speed:       raw.avg_speed_kmh,
    elevation:   raw.elevation_m,
    descent:     raw.elevation_m,
    photos:      [] as string[],
    gps:         (raw.gps as [number, number][]).map(([lat, lng]) => ({ lat, lng })),
    max_speed:   raw.max_speed_kmh   as number,
    max_incline, min_incline,
    avg_hr:      raw.avg_hr          as number | null,
    max_hr:      hrMax,
    calories:    raw.calories        as number | null,
    speed_kmh, altitude, heartrate,
    time_s:      raw.time_s          as number[],
    distance_m,
    // Advanced metrics
    np, avg_power: avgPower, tss, if_factor: ifFactor, vi, wkg, ef, trimp, hrZones, aed, vam,
  };
}

// ── API handler ───────────────────────────────────────────────────────────────
export async function GET() {
  if (!fs.existsSync(DATA_DIR)) return NextResponse.json([]);

  const raws = fs
    .readdirSync(DATA_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8')));

  raws.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const activities = await Promise.all(
    raws.map(async (raw) => {
      const act    = transform(raw);
      const lat    = raw.gps?.[0]?.[0] ?? 0;
      const lng    = raw.gps?.[0]?.[1] ?? 0;
      const weather = (lat && lng) ? await getWeather(raw.id, lat, lng, raw.date) : null;
      return { ...act, weather };
    })
  );

  return NextResponse.json(activities, {
    headers: {
      // Forcer l'invalidation au niveau CDN edge (Vercel) — sinon une réponse
      // précédemment baked au build reste servie en HIT pendant des jours.
      'Cache-Control': 'no-store, must-revalidate',
      'CDN-Cache-Control': 'no-store',
      'Vercel-CDN-Cache-Control': 'no-store',
    },
  });
}
