import { NextRequest, NextResponse } from 'next/server';

// Proxy to the French government's free communes API.
// Search-as-you-type lookup of French villages by name.
//
// Upstream: https://geo.api.gouv.fr/communes
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

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get('q') || '').trim();
  if (q.length < 2) return NextResponse.json([]);

  const url = `https://geo.api.gouv.fr/communes`
    + `?nom=${encodeURIComponent(q)}`
    + `&fields=nom,code,codesPostaux,centre,population`
    + `&format=json&geometry=centre&boost=population&limit=10`;

  try {
    const upstream = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!upstream.ok) {
      return NextResponse.json({ error: `geo.api.gouv.fr ${upstream.status}` }, { status: 502 });
    }
    const data: UpstreamCommune[] = await upstream.json();
    const out = data
      .filter(c => c.centre?.coordinates)
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
