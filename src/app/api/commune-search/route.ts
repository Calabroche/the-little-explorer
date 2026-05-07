import { NextRequest, NextResponse } from 'next/server';

// Proxy to the French government's free address API: BAN (Base Adresse
// Nationale) at api-adresse.data.gouv.fr. Replaces the older
// commune-only proxy — BAN returns mixed results from precise
// housenumbers ("12 Chemin du Manoir 69570 Dardilly") all the way down
// to municipalities, so the same endpoint serves the planning
// autocomplete and the auto-extend reverse-lookup.
//
// Two modes:
//   ?q=...                → forward search (typeahead)
//   ?lat=...&lng=...      → reverse geocode (returns the place
//                           covering the point — used by auto-extend
//                           when picking a detour)
//   ?exclude=code1,code2  → drop matching INSEE codes from the response
//
// Response shape kept compatible with the previous version so existing
// callers don't have to change:
//   { name, code, postal, lat, lng, label?, kind? }
//
// New optional fields:
//   label: full human-readable address ("12 Chemin du Manoir 69570 Dardilly")
//   kind:  'housenumber' | 'street' | 'locality' | 'municipality'
//          (so the UI can format/icon results differently)
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface BanFeature {
  type:     'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] }; // [lng, lat]
  properties: {
    label:        string;
    name:         string;
    type:         'housenumber' | 'street' | 'locality' | 'municipality';
    score:        number;
    citycode:     string;
    postcode:     string;
    city:         string;
    context?:     string;
    housenumber?: string;
    street?:      string;
  };
}
interface BanResponse { type: 'FeatureCollection'; features: BanFeature[] }

export async function GET(req: NextRequest) {
  const q       = (req.nextUrl.searchParams.get('q') || '').trim();
  const lat     = req.nextUrl.searchParams.get('lat');
  const lng     = req.nextUrl.searchParams.get('lng');
  const exRaw   = req.nextUrl.searchParams.get('exclude') || '';
  const exclude = new Set(exRaw.split(',').filter(Boolean));

  let url: string;
  if (lat && lng && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))) {
    // Reverse mode: returns the place at the given point. We bias to
    // street-level results (`type=street`) so auto-extend's detour
    // suggestions are anchored on a real road rather than a polygon
    // centroid. BAN falls back to the municipality if no street is
    // close enough.
    url = `https://api-adresse.data.gouv.fr/reverse/?lat=${lat}&lon=${lng}&limit=1`;
  } else if (q.length >= 2) {
    url = `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(q)}&limit=10&autocomplete=1`;
  } else {
    return NextResponse.json([]);
  }

  try {
    const upstream = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!upstream.ok) {
      return NextResponse.json({ error: `ban ${upstream.status}` }, { status: 502 });
    }
    const data = await upstream.json() as BanResponse;
    const out = (data.features ?? [])
      .filter(f => f.geometry?.coordinates && f.properties?.citycode)
      // For reverse-lookup we use citycode as the dedup key; for
      // forward search a single municipality may have many street/
      // address results, so we use the BAN id (label is unique).
      .filter(f => !exclude.has(f.properties.citycode))
      .map(f => ({
        // `name` is the headline of the result. For municipalities
        // it's just the city; for streets/housenumbers it's the
        // variable part ("12 Chemin du Manoir") so the UI can show
        // street + city on two lines.
        name:   f.properties.type === 'municipality'
                  ? f.properties.city
                  : (f.properties.name || f.properties.label),
        code:   f.properties.citycode,
        postal: f.properties.postcode ?? '',
        city:   f.properties.city,
        lat:    f.geometry.coordinates[1],
        lng:    f.geometry.coordinates[0],
        label:  f.properties.label,
        kind:   f.properties.type,
      }));
    return NextResponse.json(out, {
      headers: { 'Cache-Control': 'public, max-age=300, s-maxage=300' },
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
