// Elevation helpers — geometry-aware downsampling, distance/grade
// computation, and aggregate stats (D+ / D-).

const EARTH_R = 6371_000; // meters

/** Haversine distance between two [lat, lng] points, in meters. */
export function haversineM(a: [number, number], b: [number, number]): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const [lat1, lng1] = a;
  const [lat2, lng2] = b;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const sLat = Math.sin(dLat / 2);
  const sLng = Math.sin(dLng / 2);
  const h = sLat * sLat + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * sLng * sLng;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Pick at most `n` points along the polyline that are roughly evenly
 * spaced by cumulative distance (not by index). Always keeps the first
 * and last points. Returns the picked points along with their original
 * indices so we can interpolate other arrays back later.
 */
export function downsampleByDistance(
  positions: [number, number][],
  n: number,
): { points: [number, number][]; indices: number[] } {
  if (positions.length <= n) {
    return { points: positions.slice(), indices: positions.map((_, i) => i) };
  }
  const cumul = [0];
  for (let i = 1; i < positions.length; i++) {
    cumul.push(cumul[i - 1] + haversineM(positions[i - 1], positions[i]));
  }
  const total = cumul[cumul.length - 1];
  if (total === 0) {
    return { points: [positions[0]], indices: [0] };
  }
  const step = total / (n - 1);
  const points: [number, number][] = [];
  const indices: number[] = [];
  let target = 0;
  let j = 0;
  for (let k = 0; k < n; k++) {
    while (j < cumul.length - 1 && cumul[j + 1] < target) j++;
    points.push(positions[j]);
    indices.push(j);
    target += step;
  }
  // Ensure last point is the actual last point.
  points[points.length - 1]  = positions[positions.length - 1];
  indices[indices.length - 1] = positions.length - 1;
  return { points, indices };
}

/**
 * Build a `{ km, ele }` series suitable for a Recharts AreaChart.
 * `positions` is the full polyline; `sampleIndices` are the indices in
 * `positions` for which we have elevations, so we emit one chart point
 * per sampled index with cumulative km along the full polyline.
 */
export function buildElevationSeries(
  positions: [number, number][],
  sampleIndices: number[],
  elevations: number[],
): { km: number; ele: number }[] {
  const cumul = [0];
  for (let i = 1; i < positions.length; i++) {
    cumul.push(cumul[i - 1] + haversineM(positions[i - 1], positions[i]));
  }
  const out: { km: number; ele: number }[] = [];
  for (let k = 0; k < sampleIndices.length; k++) {
    const idx = sampleIndices[k];
    out.push({ km: +(cumul[idx] / 1000).toFixed(2), ele: Math.round(elevations[k] ?? 0) });
  }
  return out;
}

/** Total positive / negative elevation change, in meters. Robust to noise via threshold. */
export function ascentDescent(elevations: number[]): { ascent: number; descent: number } {
  let asc = 0, desc = 0;
  for (let i = 1; i < elevations.length; i++) {
    const d = elevations[i] - elevations[i - 1];
    if (d > 0) asc  += d;
    else       desc += -d;
  }
  return { ascent: Math.round(asc), descent: Math.round(desc) };
}
