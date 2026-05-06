// Build a GPX 1.1 string from an itinerary so it can be loaded onto a
// Garmin / Wahoo / phone for navigation.
//
// We emit:
//   - one <wpt> per village (named, with INSEE code as comment)
//   - one <trk> with a single <trkseg> holding the routed polyline,
//     elevations attached if available

import { Waypoint } from './types';

function esc(s: string): string {
  return s.replace(/[&<>"']/g, c => (
    c === '&'  ? '&amp;'
  : c === '<'  ? '&lt;'
  : c === '>'  ? '&gt;'
  : c === '"'  ? '&quot;'
  :              '&apos;'
  ));
}

export function buildGpx(opts: {
  name:       string;
  waypoints:  Waypoint[];
  polyline:   [number, number][];
  elevations?: number[]; // optional, same length as polyline (or downsampled — we'll skip if mismatched)
}): string {
  const { name, waypoints, polyline, elevations } = opts;
  const useEle = !!elevations && elevations.length === polyline.length;
  const now = new Date().toISOString();

  const wpts = waypoints.map(w => (
    `  <wpt lat="${w.lat.toFixed(6)}" lon="${w.lng.toFixed(6)}">\n`
    + `    <name>${esc(w.name)}</name>\n`
    + (w.postal ? `    <cmt>${esc(w.postal)}</cmt>\n` : '')
    + `  </wpt>`
  )).join('\n');

  const trkpts = polyline.map(([lat, lng], i) => {
    const ele = useEle ? `\n      <ele>${(elevations![i] ?? 0).toFixed(1)}</ele>` : '';
    return `    <trkpt lat="${lat.toFixed(6)}" lon="${lng.toFixed(6)}">${ele}\n    </trkpt>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="The Little Explorer"
     xmlns="http://www.topografix.com/GPX/1/1"
     xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
     xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata>
    <name>${esc(name)}</name>
    <time>${now}</time>
  </metadata>
${wpts}
  <trk>
    <name>${esc(name)}</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>
`;
}

/** Trigger a browser download for a GPX file. Client-only. */
export function downloadGpx(filename: string, gpx: string): void {
  if (typeof window === 'undefined') return;
  const blob = new Blob([gpx], { type: 'application/gpx+xml' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename.endsWith('.gpx') ? filename : `${filename}.gpx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Make a filesystem-safe, ASCII-ish slug for the GPX filename. */
export function slugify(s: string): string {
  return s
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'itineraire';
}
