/**
 * GET /api/bike-shops?lat=&lng=&radiusKm=  (5 | 10 | 15)
 *
 * Every bike shop / repairer around a point, from OpenStreetMap. Used by the
 * "Trouver un professionnel" feature in the Matériel section. Returns name,
 * coordinates, address, phone, website, opening hours, whether OSM flags
 * repair, and a best-effort hint about the rider's brand (OSM rarely lists
 * which brands a shop services, so this is informational, not a hard filter).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/api-auth';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { runOverpass, elementLatLng } from '@/lib/overpass';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 40;

interface Shop {
  id:       string;
  name:     string;
  lat:      number;
  lng:      number;
  distKm:   number;
  address:  string | null;
  phone:    string | null;
  website:  string | null;
  hours:    string | null;
  repairs:  boolean;        // OSM explicitly tags repair
  type:     'shop' | 'repair' | 'sports';
  brandMatch: boolean;      // OSM tags mention the rider's brand
}

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const la1 = (aLat * Math.PI) / 180, la2 = (bLat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function buildAddress(t: Record<string, string>): string | null {
  const parts = [
    [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' '),
    [t['addr:postcode'], t['addr:city']].filter(Boolean).join(' '),
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

export async function GET(req: NextRequest) {
  const authed = await getAuthedUser(req);
  if (!authed?.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const limited = enforceRateLimit(req, RATE_LIMITS.commune, 'bike-shops', { userId: authed.id });
  if (limited) return limited;

  const url = new URL(req.url);
  const lat = Number(url.searchParams.get('lat'));
  const lng = Number(url.searchParams.get('lng'));
  const brand = (url.searchParams.get('brand') ?? '').trim().toLowerCase();
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return NextResponse.json({ error: 'invalid_coordinates' }, { status: 400 });
  }
  const radiusKm = Math.max(1, Math.min(25, Number(url.searchParams.get('radiusKm')) || 10));
  const r = Math.round(radiusKm * 1000);

  // node/way/relation = nwr; `out center tags` gives ways/relations a centroid.
  const query =
    `[out:json][timeout:25];(` +
    `nwr(around:${r},${lat},${lng})[shop=bicycle];` +
    `nwr(around:${r},${lat},${lng})[craft=bicycle];` +
    `nwr(around:${r},${lat},${lng})[shop=sports][service:bicycle:repair];` +
    `nwr(around:${r},${lat},${lng})[service:bicycle:repair=yes];` +
    `);out center tags;`;

  const data = await runOverpass(query, 14_000, 30_000);
  if (!data) return NextResponse.json({ shops: [] });

  const seen = new Set<string>();
  const shops: Shop[] = [];
  for (const el of data.elements ?? []) {
    const t = el.tags ?? {};
    const pos = elementLatLng(el);
    if (!pos) continue;
    const name = t.name || t.brand || t.operator;
    if (!name) continue;                                  // skip unnamed
    const key = `${name.toLowerCase()}|${pos.lat.toFixed(3)},${pos.lng.toFixed(3)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const tagsBlob = JSON.stringify(t).toLowerCase();
    const repairs = t['service:bicycle:repair'] === 'yes'
      || t.craft === 'bicycle'
      || /repair|réparation|atelier/.test(tagsBlob);
    const type: Shop['type'] = t.shop === 'bicycle' ? 'shop' : t.shop === 'sports' ? 'sports' : 'repair';

    shops.push({
      id: `${el.type}/${el.id}`,
      name,
      lat: pos.lat,
      lng: pos.lng,
      distKm: +haversineKm(lat, lng, pos.lat, pos.lng).toFixed(1),
      address: buildAddress(t),
      phone:   t.phone || t['contact:phone'] || null,
      website: t.website || t['contact:website'] || null,
      hours:   t.opening_hours || null,
      repairs,
      type,
      brandMatch: brand.length >= 3 && tagsBlob.includes(brand),
    });
  }
  shops.sort((a, b) => a.distKm - b.distKm);

  return NextResponse.json(
    { shops: shops.slice(0, 200) },
    { headers: { 'Cache-Control': 'private, max-age=600' } },
  );
}
