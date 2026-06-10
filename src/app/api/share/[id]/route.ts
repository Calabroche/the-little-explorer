/**
 * GET /api/share/<id> — PUBLIC, read-only view of a saved itinerary.
 *
 * Served from /api/* (and therefore excluded from the auth middleware) so the
 * link works for anyone, logged in or not. Returns a self-contained HTML page:
 * a Leaflet map of the trace, a server-rendered elevation profile, the stats,
 * the list of waypoints, and (fetched client-side) the way-type breakdown.
 *
 * Itinerary ids are unguessable random strings (`itin_<ts>_<rand>`), so reading
 * by id without auth is acceptable for a share-by-link feature — the same model
 * Strava / Komoot use. No personal data beyond the route itself is exposed.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/db';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type LatLng = [number, number];

function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLng = ((b[1] - a[1]) * Math.PI) / 180;
  const la1 = (a[0] * Math.PI) / 180, la2 = (b[0] * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function esc(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtDuration(min: number): string {
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return h > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${m} min`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function elevationSvg(geometry: LatLng[], indices: number[], elevations: number[]): string {
  if (!Array.isArray(geometry) || !Array.isArray(indices) || !Array.isArray(elevations) || indices.length !== elevations.length || indices.length < 2) return '';
  const cum: number[] = [0];
  for (let i = 1; i < geometry.length; i++) cum[i] = cum[i - 1] + haversineKm(geometry[i - 1], geometry[i]);
  const series = indices.map((gi, s) => ({ km: cum[gi] ?? 0, ele: elevations[s] }));
  const totalKm = series[series.length - 1].km || 1;
  const eles = series.map(p => p.ele);
  const minE = Math.min(...eles), maxE = Math.max(...eles);
  const span = Math.max(1, maxE - minE);
  const W = 1000, H = 200, pad = 12;
  const x = (km: number) => (km / totalKm) * W;
  const y = (e: number) => H - pad - ((e - minE) / span) * (H - pad * 2);
  const pts = series.map(p => `${x(p.km).toFixed(1)},${y(p.ele).toFixed(1)}`).join(' ');
  const area = `M0,${H} L${pts.replace(/ /g, ' L')} L${W},${H} Z`;
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%;height:160px;display:block">
    <path d="${area}" fill="rgba(196,96,42,0.15)" />
    <polyline points="${pts}" fill="none" stroke="#C4602A" stroke-width="2.5" vector-effect="non-scaling-stroke" />
  </svg>
  <div style="display:flex;justify-content:space-between;font-size:11px;color:#8A8175;margin-top:2px">
    <span>${Math.round(minE)} m</span><span>${Math.round(maxE)} m · ${totalKm.toFixed(1)} km</span>
  </div>`;
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const limited = enforceRateLimit(req, RATE_LIMITS.commune, 'share-itinerary');
  if (limited) return limited;

  const id = params.id;
  const page = (body: string, status = 200) =>
    new NextResponse(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>The Little Explorer</title></head><body style="margin:0;font-family:system-ui,-apple-system,sans-serif;background:#F5EFE6;color:#2A2723">${body}</body></html>`,
      { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300, s-maxage=300' } });

  if (!id) return page(`<div style="padding:40px;text-align:center">Lien invalide.</div>`, 400);

  const { data, error } = await supabaseAdmin()
    .from('itineraries')
    .select('id, name, distance_km, payload')
    .eq('id', id)
    .maybeSingle();

  if (error) return page(`<div style="padding:40px;text-align:center">Erreur serveur.</div>`, 500);
  if (!data) return page(`<div style="padding:60px 20px;text-align:center"><div style="font-size:40px">🗺️</div><h1 style="font-family:Georgia,serif">Itinéraire introuvable</h1><p style="color:#8A8175">Ce lien n'existe plus ou a expiré.</p></div>`, 404);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p: any = data.payload ?? {};
  const name: string = data.name || p.name || 'Itinéraire';
  const geometry: LatLng[] = Array.isArray(p.geometry) ? p.geometry : [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const waypoints: any[] = Array.isArray(p.waypoints) ? p.waypoints : [];
  const distanceKm: number | null = data.distance_km != null ? Number(data.distance_km) : (p.distanceKm ?? null);
  const durationMin: number | null = p.durationMin ?? null;
  const ascent: number = p.totalAscent ?? 0;
  const descent: number = p.totalDescent ?? 0;
  const effort = (distanceKm ?? 0) + ascent / 8;
  const diff = effort < 50 ? { l: 'Facile', bg: '#E4EFDD', fg: '#4F7A43' } : effort < 150 ? { l: 'Modéré', bg: '#F3E0CC', fg: '#9C4E1E' } : { l: 'Difficile', bg: '#F0D2C4', fg: '#9B3A1A' };
  const avgKmh = distanceKm != null && durationMin ? distanceKm / (durationMin / 60) : null;

  const stat = (label: string, value: string, color = '#2A2723') =>
    `<div style="min-width:0"><div style="font-family:Georgia,serif;font-size:22px;font-weight:800;color:${color};line-height:1.1">${value}</div><div style="font-size:10px;color:#8A8175;letter-spacing:.05em;text-transform:uppercase;margin-top:2px">${label}</div></div>`;

  const stats = [
    distanceKm != null ? stat('Distance', `${distanceKm.toFixed(1)} <span style="font-size:12px;color:#8A8175">km</span>`) : '',
    durationMin != null ? stat('Durée', fmtDuration(durationMin)) : '',
    ascent ? stat('Dénivelé +', `${ascent.toLocaleString('fr-FR')} <span style="font-size:12px;color:#8A8175">m</span>`, '#C4602A') : '',
    descent ? stat('Dénivelé −', `${descent.toLocaleString('fr-FR')} <span style="font-size:12px;color:#8A8175">m</span>`, '#3E6FA3') : '',
    avgKmh != null ? stat('Vitesse moy.', `${avgKmh.toFixed(1)} <span style="font-size:12px;color:#8A8175">km/h</span>`, '#3E6FA3') : '',
    stat('Points', String(waypoints.length)),
  ].filter(Boolean).join('');

  const elev = elevationSvg(geometry, p.elevSampleIndices, p.elevations);

  const wpRows = waypoints.map((w, i) => {
    const sub = w.label && w.label !== w.name ? w.label : (w.city && w.city !== w.name ? w.city : (w.postal ?? ''));
    return `<div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid #E0D5C2">
      <span style="width:24px;height:24px;border-radius:50%;background:#C4602A;color:#fff;display:flex;align-items:center;justify-content:center;font-family:Georgia,serif;font-weight:700;font-size:12px;flex-shrink:0">${i + 1}</span>
      <span style="min-width:0"><span style="display:block;font-weight:600;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(w.name)}</span>${sub ? `<span style="display:block;font-size:11px;color:#8A8175;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(sub)}</span>` : ''}</span>
    </div>`;
  }).join('');

  const card = (inner: string) => `<div style="background:#FFFCF6;border:1px solid #E0D5C2;border-radius:12px;padding:16px;margin-bottom:14px">${inner}</div>`;
  const hdr = (t: string) => `<div style="font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#C4602A;margin-bottom:10px">${t}</div>`;

  // Geometry handed to the client for the Leaflet map + the way-types fetch.
  const dataJson = JSON.stringify({ geometry, waypoints: waypoints.map(w => ({ name: w.name, lat: w.lat, lng: w.lng })) }).replace(/</g, '\\u003c');

  const body = `
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <div style="max-width:780px;margin:0 auto;padding:18px 16px 40px">
    <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:4px">
      <span style="font-family:Georgia,serif;font-weight:900;font-size:18px;color:#C4602A">The Little Explorer</span>
    </div>
    <h1 style="font-family:Georgia,serif;font-weight:900;font-size:26px;margin:6px 0 2px">${esc(name)}</h1>
    <div style="margin:6px 0 16px"><span style="display:inline-block;padding:5px 12px;border-radius:14px;background:${diff.bg};color:${diff.fg};font-size:12px;font-weight:700">${diff.l}</span></div>

    <div id="map" style="height:340px;border-radius:12px;overflow:hidden;border:1px solid #E0D5C2;margin-bottom:14px;background:#EDE5D8"></div>

    ${card(`<div style="display:flex;flex-wrap:wrap;gap:22px;align-items:baseline">${stats}</div>`)}
    ${elev ? card(hdr('Profil d\'altitude') + elev) : ''}
    <div id="ways"></div>
    ${waypoints.length ? card(hdr('Points de passage') + wpRows) : ''}

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
    (d.waypoints||[]).forEach(function(w){
      if (typeof w.lat !== 'number' || typeof w.lng !== 'number') return;
      L.circleMarker([w.lat, w.lng], { radius:5, fillColor:'#C4602A', color:'#fff', weight:1.5, fillOpacity:1 }).addTo(map);
    });

    // Way types — fetched client-side (route-ways is public). Downsample to
    // <=25 points so OSRM accepts it.
    if (geo.length >= 2) {
      var step = Math.max(1, Math.ceil(geo.length / 24));
      var wp = []; for (var i=0;i<geo.length;i+=step) wp.push(geo[i]);
      if (wp[wp.length-1] !== geo[geo.length-1]) wp.push(geo[geo.length-1]);
      fetch('/api/route-ways', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ waypoints: wp }) })
        .then(function(r){ return r.ok ? r.json() : null; })
        .then(function(res){
          if (!res) return;
          var colors = { route:'#99abbd', rue:'#c4ced9', piste_cyclable:'#4fa394', route_nationale:'#e3b33d', chemin:'#d6dce3', asphalte:'#99abbd', revetu:'#e8e8e8', non_pave:'#cfc4a8' };
          function block(title, buckets){
            if(!buckets||!buckets.length) return '';
            var total = buckets.reduce(function(s,b){return s+b.meters;},0)||1;
            var bar = buckets.map(function(b){return '<div style="width:'+(b.meters/total*100)+'%;background:'+(colors[b.key]||'#999')+'"></div>';}).join('');
            var legend = buckets.map(function(b){
              var m = b.meters>=1000 ? (b.meters/1000).toFixed(1).replace('.',',')+' km' : b.meters+' m';
              return '<div style="display:flex;align-items:center;gap:8px;padding:4px 0"><span style="width:14px;height:14px;border-radius:4px;background:'+(colors[b.key]||'#999')+'"></span><span style="font-size:13px">'+b.label+'</span><span style="margin-left:auto;font-family:monospace;font-size:12px;color:#5C544A">'+m+'</span></div>';
            }).join('');
            return '<div style="font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#C4602A;margin:10px 0 8px">'+title+'</div><div style="display:flex;height:11px;border-radius:6px;overflow:hidden;gap:1px;margin-bottom:8px">'+bar+'</div>'+legend;
          }
          var html = block('Types de voies', res.wayTypes) + block('Surfaces', res.surfaces);
          if (html) document.getElementById('ways').innerHTML = '<div style="background:#FFFCF6;border:1px solid #E0D5C2;border-radius:12px;padding:16px;margin-bottom:14px">'+html+'</div>';
        }).catch(function(){});
    }
  })();
  </script>`;

  return page(body);
}
