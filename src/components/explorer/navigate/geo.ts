// Geographic utilities used during navigation: distance, closest-point
// projection onto the route, and along-route distance.
//
// All angles are in degrees, distances in meters. We use the haversine
// formula on a spherical Earth model — accurate to ~0.5 % at the
// distances cycling routes actually cover.

const EARTH_R = 6371_000; // meters
const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

export function haversineM(a: [number, number], b: [number, number]): number {
  const [lat1, lng1] = a;
  const [lat2, lng2] = b;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const sLat = Math.sin(dLat / 2);
  const sLng = Math.sin(dLng / 2);
  const h = sLat * sLat + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * sLng * sLng;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Compass bearing from `a` to `b`, in degrees clockwise from north. */
export function bearingDeg(a: [number, number], b: [number, number]): number {
  const [lat1, lng1] = a;
  const [lat2, lng2] = b;
  const φ1 = toRad(lat1), φ2 = toRad(lat2);
  const Δλ = toRad(lng2 - lng1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// Convert lat/lng to a local equirectangular tangent at a reference point.
// At cycling distances (≤ a few km between samples) this is way faster
// than haversine inside hot loops and the error is negligible.
function project(p: [number, number], ref: [number, number]): [number, number] {
  const cos = Math.cos(toRad(ref[0]));
  return [
    (p[1] - ref[1]) * cos * 111_320, // x in meters
    (p[0] - ref[0])       * 110_540, // y in meters
  ];
}

/**
 * Find the closest point on the polyline to `p`. Returns the index of
 * the segment (poly[i]→poly[i+1]) and the parameter t ∈ [0,1] along
 * that segment, plus the projected lat/lng of the foot of the
 * perpendicular and its distance to `p` in meters.
 *
 * If `searchFrom` is provided, only segments at index ≥ searchFrom are
 * considered — this is what the navigation loop uses to avoid
 * "snapping back" if the user crosses an earlier portion of a loop.
 */
export function closestPointOnPolyline(
  poly: [number, number][],
  p: [number, number],
  searchFrom = 0,
): { segIdx: number; t: number; foot: [number, number]; distM: number } {
  let bestSeg = searchFrom;
  let bestT   = 0;
  let bestD2  = Infinity;
  let bestFoot: [number, number] = poly[searchFrom] ?? p;

  const ref = p; // tangent at the user's position is plenty accurate
  const [px, py] = project(p, ref);

  for (let i = Math.max(0, searchFrom); i < poly.length - 1; i++) {
    const [ax, ay] = project(poly[i], ref);
    const [bx, by] = project(poly[i + 1], ref);
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) continue;
    let t = ((px - ax) * dx + (py - ay) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const fx = ax + t * dx;
    const fy = ay + t * dy;
    const d2 = (fx - px) * (fx - px) + (fy - py) * (fy - py);
    if (d2 < bestD2) {
      bestD2  = d2;
      bestSeg = i;
      bestT   = t;
      bestFoot = [
        poly[i][0] + (poly[i + 1][0] - poly[i][0]) * t,
        poly[i][1] + (poly[i + 1][1] - poly[i][1]) * t,
      ];
    }
  }
  return { segIdx: bestSeg, t: bestT, foot: bestFoot, distM: Math.sqrt(bestD2) };
}

/**
 * Distance from a point on the polyline (segIdx + t) to the END of the
 * polyline, measured along the line.
 */
export function distanceAlongRemaining(
  poly: [number, number][],
  segIdx: number,
  t: number,
): number {
  if (poly.length < 2 || segIdx >= poly.length - 1) return 0;
  // Remaining piece of the current segment
  const cur = haversineM(poly[segIdx], poly[segIdx + 1]) * (1 - t);
  let total = cur;
  for (let i = segIdx + 1; i < poly.length - 1; i++) {
    total += haversineM(poly[i], poly[i + 1]);
  }
  return total;
}

/**
 * Distance from a point on the polyline (segIdx + t) to a target lat/lng
 * that lies somewhere on the polyline at index ≥ segIdx — measured
 * along the line. Used to compute "how far to the next maneuver".
 */
export function distanceAlongTo(
  poly: [number, number][],
  fromSeg: number,
  fromT: number,
  target: [number, number],
): number {
  if (poly.length < 2) return 0;
  // Find the closest segment to the target (constrained to >= fromSeg).
  const tg = closestPointOnPolyline(poly, target, fromSeg);

  // If the target happens to land before us, return 0.
  if (tg.segIdx < fromSeg || (tg.segIdx === fromSeg && tg.t <= fromT)) return 0;

  // Tail of current segment past the user.
  let total = haversineM(poly[fromSeg], poly[fromSeg + 1]) * (1 - fromT);
  // Whole segments strictly between us and the target's segment.
  for (let i = fromSeg + 1; i < tg.segIdx; i++) {
    total += haversineM(poly[i], poly[i + 1]);
  }
  // Head of the target's segment up to the projected target point.
  if (tg.segIdx > fromSeg) {
    total += haversineM(poly[tg.segIdx], poly[tg.segIdx + 1]) * tg.t;
  } else {
    // same segment, target later in it
    total = haversineM(poly[fromSeg], poly[fromSeg + 1]) * (tg.t - fromT);
  }
  return Math.max(0, total);
}
