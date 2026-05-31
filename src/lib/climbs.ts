/**
 * Climb detection — port of the iOS `ClimbDetector.swift` to TypeScript.
 *
 * Walks the altitude stream, accumulates elevation gain over rolling
 * windows, and emits a `Climb` when the run meets all thresholds. Same
 * algorithm, identical defaults, so the cards on web and iOS surface
 * the same climbs for any given ride.
 *
 * Defaults are tuned for road / gravel cycling:
 *   - 500 m minimum length
 *   - 30 m minimum elevation gain
 *   - 3 % minimum average grade
 *   - 8 m tolerance for a dip mid-climb (lets false plateaus through)
 *
 * Future: per-sport tuning. Running + hiking want lower thresholds.
 */

export interface Climb {
  /** Index into the activity's altitude / distance arrays — start of the climb. */
  startIndex:   number;
  /** Index of the climb's peak (where we cut). */
  endIndex:     number;
  /** Linear distance covered by the climb, metres. */
  distanceM:    number;
  /** Net elevation gain start → end, metres. */
  elevationM:   number;
  /** Average grade in %, signed positive. */
  avgGradePct:  number;
  /** Max sustained grade over a 100 m window, %. Capped at 30 %. */
  maxGradePct:  number;
  /** Time spent climbing, seconds. 0 if the time stream was absent. */
  durationSec:  number;
  /** "Montée 1", "Montée 2", … — view layer can rename via geocoding. */
  name:         string;
}

export interface ClimbThresholds {
  /** 500 m minimum total climb length. */
  minDistanceM:               number;
  /** 30 m minimum elevation gain. */
  minElevationM:              number;
  /** 3 % minimum average grade. */
  minAvgGradePct:             number;
  /**
   * Upper sanity cap on avg grade. Even Mauna Kea (the worst road
   * climb on Earth) averages 12 %, Mortirolo & Angliru top out at
   * 13 %. A "climb" averaging more than 15 % almost always means
   * GPS-altitude corruption (signal lost under a tunnel / canopy,
   * recorder reporting altitude = 0 for a stretch, then jumping
   * back to the real value). Rejecting it here is more honest
   * than letting a phantom Mortirolo into the list.
   */
  maxAvgGradePct:             number;
  /** 8 m tolerance for a dip mid-climb before we close the climb at the peak. */
  maxNetDescentDuringClimb:   number;
}

// Thresholds deliberately kept on the "major climb" side, not the
// "every kicker" side. Rationale: a 200 m bump at 8 % (= 16 m gain) is
// a 30-second effort — surfacing it as a "Montée" alongside a 3 km col
// dilutes the meaning of the card. We'd rather show 1-5 real climbs
// per ride than 25 micro-events. The card's NB explains this to
// users so a missing-bump isn't read as a bug.
//
// If someone wants a "kicker tracker" we'd ship it as a separate card
// with its own visual treatment (Strava does this with their "punchy
// efforts" overlay), not by mutating these numbers.
export const DEFAULT_THRESHOLDS: ClimbThresholds = {
  minDistanceM:             500,  // 500 m mini
  minElevationM:            30,   // 30 m de gain
  minAvgGradePct:           3,    // 3 % moyens
  maxAvgGradePct:           15,   // 15 % — au-delà = artefact GPS
  maxNetDescentDuringClimb: 8,    // 8 m de creux toléré au milieu
};

/**
 * Detect climbs in an activity. Pass the raw altitude + distance streams
 * (and time if available, for duration computation). Returns an array of
 * `Climb` ordered by start index.
 */
export function detectClimbs(
  altitude:  number[] | null | undefined,
  distanceM: number[] | null | undefined,
  timeS:    number[] | null | undefined,
  thresholds: ClimbThresholds = DEFAULT_THRESHOLDS,
): Climb[] {
  if (!altitude || !distanceM) return [];
  if (altitude.length < 30) return [];
  if (altitude.length !== distanceM.length) return [];

  // STEP 1 — outlier rejection.
  // A single sample of `altitude = 0` (recorder briefly loses
  // vertical lock under a tunnel / dense canopy) survives moving-
  // average smoothing as a 200-300 m altitude dip. The dip then
  // generates a phantom climb on the recovery side that averages
  // 25-30 % grade. Clean BEFORE smoothing so the average isn't
  // polluted by the outlier.
  const cleaned = cleanAltitudeOutliers(altitude);
  // STEP 2 — 30-sample centered moving average smooths the ±3 m GPS
  // bounce that would otherwise fragment a single climb into 20
  // micro-climbs.
  const smoothed = smoothAltitude(cleaned, 30);
  const climbs: Climb[] = [];
  const n = smoothed.length;

  let i = 0;
  while (i < n - 1) {
    if (!isAscentStarting(i, smoothed, distanceM)) {
      i += 1;
      continue;
    }

    // Walk forward until the run loses too much elevation off its peak.
    let bestEnd     = i;
    let bestPeakAlt = smoothed[i];
    let j = i + 1;
    while (j < n) {
      const alt = smoothed[j];
      if (alt > bestPeakAlt) {
        bestPeakAlt = alt;
        bestEnd = j;
      }
      const descentFromPeak = bestPeakAlt - alt;
      if (descentFromPeak > thresholds.maxNetDescentDuringClimb) break;
      j += 1;
    }

    const start = i;
    const end   = bestEnd;
    const elev  = smoothed[end] - smoothed[start];
    const dist  = distanceM[end] - distanceM[start];

    if (elev >= thresholds.minElevationM && dist >= thresholds.minDistanceM) {
      const avg = (elev / Math.max(dist, 1)) * 100;
      if (avg >= thresholds.minAvgGradePct && avg <= thresholds.maxAvgGradePct) {
        const maxGrade = peakSustainedGrade(start, end, smoothed, distanceM);
        const duration = (timeS && timeS[start] != null && timeS[end] != null)
          ? Math.max(0, timeS[end] - timeS[start])
          : 0;
        climbs.push({
          startIndex:   start,
          endIndex:     end,
          distanceM:    dist,
          elevationM:   elev,
          avgGradePct:  avg,
          maxGradePct:  maxGrade,
          durationSec:  duration,
          name:         `Montée ${climbs.length + 1}`,
        });
      }
    }
    // Resume scanning AFTER the end of this climb (or i+1 if it didn't
    // qualify, so we don't loop forever).
    i = Math.max(end, i + 1);
  }
  return climbs;
}

// ── Internals ──────────────────────────────────────────────────────────────

/**
 * Replace clearly-corrupt altitude samples with a linear interpolation
 * between their valid neighbors. Two checks:
 *   1. `altitude === 0` — the sentinel a GPS chipset writes when it has
 *      horizontal lock but no vertical fix. Real road cycling samples are
 *      essentially never exactly zero.
 *   2. Single-sample spikes — a value that differs from BOTH its
 *      neighbors by more than 30 m. 30 m/sec vertical = 108 km/h vertical
 *      descent, physically out of reach for a bike. Anything past that
 *      is GPS noise.
 * Runs of invalid samples are interpolated linearly between the last
 * valid sample before and the first valid sample after. Leading /
 * trailing invalid runs are filled with the nearest valid value.
 */
function cleanAltitudeOutliers(alt: number[]): number[] {
  const n = alt.length;
  if (n < 3) return alt.slice();

  // Validity mask.
  const valid = new Array<boolean>(n).fill(true);
  for (let i = 0; i < n; i++) if (alt[i] === 0) valid[i] = false;
  // Spike check on still-valid positions only.
  for (let i = 1; i < n - 1; i++) {
    if (!valid[i]) continue;
    const prev = alt[i - 1];
    const next = alt[i + 1];
    if (Math.abs(alt[i] - prev) > 30 && Math.abs(alt[i] - next) > 30) {
      valid[i] = false;
    }
  }

  // Interpolate invalid runs.
  const out = alt.slice();
  let i = 0;
  while (i < n) {
    if (valid[i]) { i += 1; continue; }
    const runStart = i;
    while (i < n && !valid[i]) i += 1;
    const runEnd = i;  // exclusive
    const before: number | null = runStart > 0 ? out[runStart - 1] : null;
    const after:  number | null = runEnd  < n ? out[runEnd]       : null;
    if (before != null && after != null) {
      const span = runEnd - runStart + 1;
      for (let k = runStart; k < runEnd; k++) {
        const t = (k - runStart + 1) / span;
        out[k] = before + (after - before) * t;
      }
    } else if (before != null) {
      for (let k = runStart; k < runEnd; k++) out[k] = before;
    } else if (after != null) {
      for (let k = runStart; k < runEnd; k++) out[k] = after;
    }
    // both null → whole series invalid, leave alone
  }
  return out;
}

/**
 * Centered moving average. Returns an array the same length as input.
 * For values near the edges (where the window would overshoot), we use
 * a smaller asymmetric window — same convention as the iOS port.
 */
function smoothAltitude(alt: number[], window: number): number[] {
  if (alt.length < window) return alt.slice();
  const out = new Array<number>(alt.length).fill(0);
  const half = Math.floor(window / 2);
  for (let i = 0; i < alt.length; i++) {
    const lo = Math.max(0, i - half);
    const hi = Math.min(alt.length - 1, i + half);
    let sum = 0;
    for (let k = lo; k <= hi; k++) sum += alt[k];
    out[i] = sum / (hi - lo + 1);
  }
  return out;
}

/**
 * Heuristic: a climb starts at index `i` when the next 20 m of smoothed
 * altitude trends upward more than 2 m AND the gradient over that
 * lookahead is ≥ 2 %.
 */
function isAscentStarting(i: number, smoothed: number[], distanceM: number[]): boolean {
  const look = 20;
  if (i + look >= smoothed.length) return false;
  const elev = smoothed[i + look] - smoothed[i];
  const dist = distanceM[i + look] - distanceM[i];
  if (dist < 50) return false;
  return elev >= 2 && (elev / dist) * 100 >= 2;
}

/**
 * Sliding 100 m window peak grade across the climb. Reasonable proxy for
 * what cyclists feel as "the steep bit". Capped at 30 % to filter GPS
 * spikes (no real-world road climb exceeds that).
 */
function peakSustainedGrade(start: number, end: number, smoothed: number[], distanceM: number[]): number {
  let maxGrade = 0;
  let j = start;
  while (j < end) {
    // Find k such that distanceM[k] >= distanceM[j] + 100.
    let k = j + 1;
    while (k < end && distanceM[k] - distanceM[j] < 100) k += 1;
    if (k >= end) break;
    const dAlt  = smoothed[k] - smoothed[j];
    const dDist = distanceM[k] - distanceM[j];
    if (dDist > 50) {
      const grade = (dAlt / dDist) * 100;
      if (grade > maxGrade) maxGrade = grade;
    }
    j += 10; // step 10 samples — faster than 1-by-1
  }
  return Math.min(maxGrade, 30);
}
