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
import { brandsInText } from '@/lib/bikeBrands';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

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
  brandOnSite: boolean;     // the rider's brand appears on the shop's website
  brands:   string[];       // all known brands found (OSM tag + website scan)
}

const WEB_UA = 'Mozilla/5.0 (compatible; TheLittleExplorer/0.1; +https://the-little-explorer-app.vercel.app)';

/** Pull brand signals from one HTML document. We drop <script>/<style> (CSS/JS
 *  use "focus", "look"… as keywords → false hits) and scan three signals:
 *   - visible body text,
 *   - image alt attributes,
 *   - image file names (brand logos are often shown as images, e.g.
 *     alt="Canyon" / src=".../Canyon-h.jpg", so the name never appears in the
 *     body text — many shop sites are like this).
 *  brandsInText still requires proper-noun capitalisation, so lowercase noise
 *  from any of these signals is ignored. */
function brandsInHtml(rawHtml: string): string[] {
  const html = rawHtml
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ');
  const alts = Array.from(html.matchAll(/\balt\s*=\s*["']([^"']+)["']/gi)).map(m => m[1]);
  const imgs = Array.from(html.matchAll(/\bsrc\s*=\s*["']([^"']+\.(?:jpe?g|png|webp|svg|gif))["']/gi))
    .map(m => { try { return decodeURIComponent(m[1]); } catch { return m[1]; } })
    .map(u => (u.split(/[/\\]/).pop() || '').replace(/[-_]+/g, ' '));
  const visible = html.replace(/<[^>]+>/g, ' ');
  return brandsInText([visible, alts.join(' '), imgs.join(' ')].join(' \n '));
}

/** On a homepage, find the most likely "our brands / our bikes" page so we can
 *  scan it too (shops list their brands there, not always on the homepage).
 *  Returns an absolute, same-origin HTML URL, or null. */
function brandsPageUrl(html: string, baseUrl: string): string | null {
  let origin: string;
  try { origin = new URL(baseUrl).origin; } catch { return null; }
  const re = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const KW = /(marque|nos[\s-]*v[ée]lo|catalogue|boutique|nos[\s-]*produit|\bbrand|magasin)/i;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const href = m[1];
    const label = m[2].replace(/<[^>]+>/g, ' ');
    if (!KW.test(href) && !KW.test(label)) continue;
    try {
      const u = new URL(href, baseUrl);
      if (u.origin !== origin) continue;                                  // same site only
      if (/\.(jpe?g|png|webp|gif|svg|pdf|zip|mp4)$/i.test(u.pathname)) continue;
      return u.toString();
    } catch { /* skip malformed href */ }
  }
  return null;
}

/** Fetch a shop site and return the known bike brands it mentions. Scans the
 *  homepage, then (best-effort) one linked "brands / our bikes" sub-page.
 *  `timeoutMs` is a shared budget across both fetches so it can't blow the
 *  function deadline. */
async function siteBrands(website: string, timeoutMs: number): Promise<string[]> {
  const deadline = Date.now() + timeoutMs;
  const getHtml = async (url: string): Promise<string | null> => {
    const left = deadline - Date.now();
    if (left <= 250) return null;                                         // no time for a fetch
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), left);
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': WEB_UA, 'Accept': 'text/html' }, redirect: 'follow' });
      if (!res.ok) return null;
      return await res.text();
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };

  const home = await getHtml(website);
  if (!home) return [];
  const brands = new Set(brandsInHtml(home));

  const sub = brandsPageUrl(home, website);
  if (sub && sub !== website) {
    const page = await getHtml(sub);
    if (page) brandsInHtml(page).forEach(b => brands.add(b));
  }
  return Array.from(brands);
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

  // Use a BOUNDING BOX (index-based, fast) instead of `around` (a distance per
  // node — slow and the cause of function timeouts). Over-fetch the square,
  // then filter to the circle in code. node/way/relation = nwr; `out center`
  // gives ways/relations a centroid.
  const dLat = radiusKm / 111;
  const dLng = radiusKm / (111 * Math.cos((lat * Math.PI) / 180));
  const box = `${(lat - dLat).toFixed(4)},${(lng - dLng).toFixed(4)},${(lat + dLat).toFixed(4)},${(lng + dLng).toFixed(4)}`;
  // NB: tag keys with colons (service:bicycle:repair) MUST be quoted in
  // Overpass QL, else the parser errors on the ':' (400 → empty list). And
  // `out center` already includes tags — `out center tags` is a parse error.
  const query =
    `[out:json][timeout:25];(` +
    `nwr(${box})[shop=bicycle];` +
    `nwr(${box})[craft=bicycle];` +
    `nwr(${box})[shop=sports]["service:bicycle:repair"];` +
    `nwr(${box})["service:bicycle:repair"=yes];` +
    `);out center;`;

  const data = await runOverpass(query, 14_000, 28_000);
  if (!data) return NextResponse.json({ shops: [] });

  const seen = new Set<string>();
  const shops: Shop[] = [];
  for (const el of data.elements ?? []) {
    const t = el.tags ?? {};
    const pos = elementLatLng(el);
    if (!pos) continue;
    const name = t.name || t.brand || t.operator;
    if (!name) continue;                                  // skip unnamed
    const dist = haversineKm(lat, lng, pos.lat, pos.lng);
    if (dist > radiusKm) continue;                        // square → circle
    const key = `${name.toLowerCase()}|${pos.lat.toFixed(3)},${pos.lng.toFixed(3)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const tagsBlob = JSON.stringify(t).toLowerCase();
    const repairs = t['service:bicycle:repair'] === 'yes'
      || t.craft === 'bicycle'
      || /repair|réparation|atelier/.test(tagsBlob);
    const type: Shop['type'] = t.shop === 'bicycle' ? 'shop' : t.shop === 'sports' ? 'sports' : 'repair';
    // Brands listed in OSM tags (rare, but reliable when present).
    const osmBrands = t.brand ? t.brand.split(/[;,/]/).map(s => s.trim()).filter(Boolean) : [];

    shops.push({
      id: `${el.type}/${el.id}`,
      name,
      lat: pos.lat,
      lng: pos.lng,
      distKm: +dist.toFixed(1),
      address: buildAddress(t),
      phone:   t.phone || t['contact:phone'] || null,
      website: t.website || t['contact:website'] || null,
      hours:   t.opening_hours || null,
      repairs,
      type,
      brandMatch: brand.length >= 3 && tagsBlob.includes(brand),
      brandOnSite: false,
      brands: osmBrands,
    });
  }
  shops.sort((a, b) => a.distKm - b.distKm);
  const top = shops.slice(0, 200);

  // Best-effort: scan the nearest shops' sites (homepage + one linked "brands"
  // page) and collect the known bike brands they mention (which brands they
  // sell / service). Bounded so it can't blow the function budget: nearest 36,
  // a 7 s shared budget per shop for the two pages, all in parallel.
  const toScan = top.filter(s => s.website).slice(0, 36);
  await Promise.all(toScan.map(async s => {
    const found = await siteBrands(s.website!, 7000);
    if (found.length) s.brands = Array.from(new Set([...s.brands, ...found]));
  }));
  // Recompute brand flags now that website brands are known.
  for (const s of top) {
    s.brandOnSite = brand.length >= 3 && s.brands.some(b => b.toLowerCase() === brand);
  }

  return NextResponse.json(
    { shops: top },
    { headers: { 'Cache-Control': 'private, max-age=600' } },
  );
}
