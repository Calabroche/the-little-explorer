/**
 * GET /api/share/activity/<id> — PUBLIC, read-only view of ONE activity.
 *
 * The target of the "copier le lien public" share action. Served from /api/*
 * (excluded from the auth middleware) so the link works logged-out. Only
 * activities with visibility='public' are served — anything else 404s, so a
 * followers-only or private ride can't be leaked by guessing its id.
 *
 * Self-contained HTML: Leaflet map of the trace, an elevation profile, the
 * stats, author name. Mirrors the itinerary share page (../[id]/route.ts).
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/db';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type LatLng = [number, number];

function esc(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function fmtDuration(min: number): string {
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return h > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${m} min`;
}

// Elevation profile straight from the per-point altitude[] array, plotted
// against sample index (evenly spaced is close enough for a share card).
function elevationSvg(altitude: number[]): string {
  const eles = (altitude ?? []).filter(e => typeof e === 'number' && isFinite(e));
  if (eles.length < 2) return '';
  const minE = Math.min(...eles), maxE = Math.max(...eles);
  const span = Math.max(1, maxE - minE);
  const W = 1000, H = 200, pad = 12;
  const x = (i: number) => (i / (eles.length - 1)) * W;
  const y = (e: number) => H - pad - ((e - minE) / span) * (H - pad * 2);
  const pts = eles.map((e, i) => `${x(i).toFixed(1)},${y(e).toFixed(1)}`).join(' ');
  const area = `M0,${H} L${pts.replace(/ /g, ' L')} L${W},${H} Z`;
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%;height:160px;display:block">
    <path d="${area}" fill="rgba(196,96,42,0.15)" />
    <polyline points="${pts}" fill="none" stroke="#C4602A" stroke-width="2.5" vector-effect="non-scaling-stroke" />
  </svg>`;
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const limited = enforceRateLimit(req, RATE_LIMITS.commune, 'share-activity');
  if (limited) return limited;

  const page = (body: string, status = 200) =>
    new NextResponse(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>The Little Explorer</title></head><body style="margin:0;font-family:system-ui,-apple-system,sans-serif;background:#F5EFE6;color:#2A2723">${body}</body></html>`,
      { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300, s-maxage=300' } });

  const id = Number(params.id);
  if (!Number.isFinite(id)) return page(`<div style="padding:40px;text-align:center">Lien invalide.</div>`, 400);

  const { data, error } = await supabaseAdmin()
    .from('activities')
    .select('id, user_id, sport, title, start_date, duration_min, distance_km, elevation_m, visibility, payload')
    .eq('id', id)
    .maybeSingle();
  if (error) return page(`<div style="padding:40px;text-align:center">Erreur serveur.</div>`, 500);
  // Only public activities are shareable by link.
  if (!data || data.visibility !== 'public') {
    return page(`<div style="padding:60px 20px;text-align:center"><div style="font-size:40px">🔒</div><h1 style="font-family:Georgia,serif">Sortie introuvable</h1><p style="color:#8A8175">Ce lien n'existe plus ou la sortie n'est pas publique.</p></div>`, 404);
  }

  // Author name (best-effort — the card still renders without it).
  const { data: author } = await supabaseAdmin()
    .schema('next_auth').from('users').select('name').eq('id', data.user_id as string).maybeSingle();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p: any = data.payload ?? {};
  const title: string = data.title || p.name || 'Sortie';
  const geometry: LatLng[] = Array.isArray(p.gps) ? p.gps : [];
  const distanceKm: number | null = data.distance_km != null ? Number(data.distance_km) : (p.distance_km ?? null);
  const durationMin: number | null = data.duration_min ?? p.duration_min ?? null;
  const elevM: number = data.elevation_m ?? p.elevation_m ?? 0;
  const avgKmh: number | null = p.avg_speed_kmh ?? (distanceKm != null && durationMin ? distanceKm / (durationMin / 60) : null);
  const maxKmh: number | null = p.max_speed_kmh ?? null;

  const stat = (label: string, value: string, color = '#2A2723') =>
    `<div style="min-width:0"><div style="font-family:Georgia,serif;font-size:22px;font-weight:800;color:${color};line-height:1.1">${value}</div><div style="font-size:10px;color:#8A8175;letter-spacing:.05em;text-transform:uppercase;margin-top:2px">${label}</div></div>`;

  const stats = [
    distanceKm != null ? stat('Distance', `${distanceKm.toFixed(1)} <span style="font-size:12px;color:#8A8175">km</span>`) : '',
    elevM ? stat('Dénivelé +', `${elevM.toLocaleString('fr-FR')} <span style="font-size:12px;color:#8A8175">m</span>`, '#C4602A') : '',
    durationMin != null ? stat('Temps', fmtDuration(durationMin)) : '',
    avgKmh != null ? stat('Vitesse moy.', `${avgKmh.toFixed(1)} <span style="font-size:12px;color:#8A8175">km/h</span>`, '#3E6FA3') : '',
    maxKmh != null ? stat('Vitesse max', `${maxKmh.toFixed(1)} <span style="font-size:12px;color:#8A8175">km/h</span>`, '#3E6FA3') : '',
  ].filter(Boolean).join('');

  const card = (inner: string) => `<div style="background:#FFFCF6;border:1px solid #E0D5C2;border-radius:12px;padding:16px;margin-bottom:14px">${inner}</div>`;
  const hdr = (t: string) => `<div style="font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#C4602A;margin-bottom:10px">${t}</div>`;
  const elev = elevationSvg(p.altitude);
  const dataJson = JSON.stringify({ geometry }).replace(/</g, '\\u003c');

  const body = `
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <div style="max-width:780px;margin:0 auto;padding:18px 16px 40px">
    <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:4px">
      <span style="font-family:Georgia,serif;font-weight:900;font-size:18px;color:#C4602A">The Little Explorer</span>
    </div>
    <h1 style="font-family:Georgia,serif;font-weight:900;font-size:26px;margin:6px 0 2px">${esc(title)}</h1>
    <div style="color:#8A8175;font-size:13px;margin:2px 0 16px">${author?.name ? 'par ' + esc(author.name) + ' · ' : ''}${esc(data.sport)}</div>

    <div id="map" style="height:340px;border-radius:12px;overflow:hidden;border:1px solid #E0D5C2;margin-bottom:14px;background:#EDE5D8"></div>

    ${card(`<div style="display:flex;flex-wrap:wrap;gap:22px;align-items:baseline">${stats}</div>`)}
    ${elev ? card(hdr('Profil d\'altitude') + elev) : ''}

    <div style="text-align:center;color:#8A8175;font-size:12px;margin-top:18px">Créé avec <a href="https://the-little-explorer-app.vercel.app" style="color:#C4602A;text-decoration:none">The Little Explorer</a></div>
  </div>

  <script>window.__SHARE__ = ${dataJson};</script>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
  (function(){
    var d = window.__SHARE__ || {};
    var geo = (d.geometry||[]).filter(function(p){return Array.isArray(p)&&p.length>=2});
    var map = L.map('map', { scrollWheelZoom: true });
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      maxZoom: 20, attribution: '&copy; OpenStreetMap &copy; CARTO'
    }).addTo(map);
    if (geo.length > 1) {
      var line = L.polyline(geo, { color: '#C4602A', weight: 4, opacity: 0.9 }).addTo(map);
      map.fitBounds(line.getBounds(), { padding: [30,30] });
    } else if (geo.length === 1) {
      map.setView(geo[0], 13);
    } else {
      map.setView([45.81, 4.75], 11);
    }
  })();
  </script>`;

  return page(body);
}
