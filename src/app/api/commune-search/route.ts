import { NextRequest, NextResponse } from 'next/server';

// Proxy to the French government's free communes API.
//
// Two modes:
//   ?q=...                → search by name (typeahead autocomplete)
//   ?lat=...&lng=...      → reverse-lookup the commune containing a point
//                           (used by auto-extend to pick a detour village)
//   ?exclude=code1,code2  → drop matching INSEE codes from the response
//                           (so auto-extend never re-suggests an existing
//                           waypoint)
//
// We strip the response down to what the itinerary builder needs:
// { name, code, postal, lat, lng }.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface UpstreamCommune {
  nom:           string;
  code:          string;
  codesPostaux?: string[];
  population?:   number;
  centre?:       { type: 'Point'; coordinates: [number, number] };
}

const FIELDS = 'nom,code,codesPostaux,centre,population';

export async function GET(req: NextRequest) {
  const q       = (req.nextUrl.searchParams.get('q') || '').trim();
  const lat     = req.nextUrl.searchParams.get('lat');
  const lng     = req.nextUrl.searchParams.get('lng');
  const exRaw   = req.nextUrl.searchParams.get('exclude') || '';
  const exclude = new Set(exRaw.split(',').filter(Boolean));

  let url: string;
  if (lat && lng && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))) {
    // Reverse-lookup mode — geo.api.gouv.fr returns the commune
    // containing this point (every point in metropolitan France is in
    // exactly one commune, so this is reliable for picking a detour).
    url = `https://geo.api.gouv.fr/communes`
      + `?lat=${lat}&lon=${lng}`
      + `&fields=${FIELDS}&format=json&geometry=centre`;
  } else if (q.length >= 2) {
    url = `https://geo.api.gouv.fr/communes`
      + `?nom=${encodeURIComponent(q)}`
      + `&fields=${FIELDS}&format=json&geometry=centre&boost=population&limit=10`;
  } else {
    return NextResponse.json([]);
  }

  try {
    const upstream = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!upstream.ok) {
      return NextResponse.json({ error: `geo.api.gouv.fr ${upstream.status}` }, { status: 502 });
    }
    const data: UpstreamCommune[] = await upstream.json();
    const out = data
      .filter(c => c.centre?.coordinates)
      .filter(c => !exclude.has(c.code))
      .map(c => ({
        name:   c.nom,
        code:   c.code,
        postal: c.codesPostaux?.[0] ?? '',
        // GeoJSON is [lng, lat] — flip to our preferred [lat, lng] convention.
        lat:    c.centre!.coordinates[1],
        lng:    c.centre!.coordinates[0],
      }));
    return NextResponse.json(out, {
      headers: { 'Cache-Control': 'public, max-age=300, s-maxage=300' },
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
