/**
 * Max / min gradient from raw GPS streams — THE single source of truth,
 * shared by the activity page (/api/activities) and the wear analysis
 * (/api/equipment/wear-analysis) so both surfaces show identical numbers.
 *
 * Method: short 5-sample window (~30 m at typical cycling speed), no
 * pre-smoothing (preserves steep short ramps as Strava reports them), then
 * 97th percentile up / 5th percentile down to discard GPS spikes. Tuned to
 * match Strava's reported max gradient within ~0.1-0.2 %.
 */
export function calcInclines(altitude: number[], distance_m: number[]): { max_incline: number | null; min_incline: number | null } {
  if (!altitude || !distance_m || altitude.length < 50) return { max_incline: null, min_incline: null };

  const WINDOW = 5, MIN_DIST = 8, CAP = 30;
  const ups: number[] = [], downs: number[] = [];
  for (let i = 0; i < altitude.length - WINDOW; i++) {
    const dAlt  = altitude[i + WINDOW] - altitude[i];
    const dDist = distance_m[i + WINDOW] - distance_m[i];
    if (dDist >= MIN_DIST) {
      const g = (dAlt / dDist) * 100;
      if (g > 0 && g <= CAP) ups.push(g);
      if (g < 0 && g >= -CAP) downs.push(g);
    }
  }

  const pct = (arr: number[], p: number) => {
    if (!arr.length) return null;
    const s = [...arr].sort((a, b) => a - b);
    return +(s[Math.min(Math.floor(s.length * p), s.length - 1)]).toFixed(1);
  };
  return {
    max_incline: pct(ups, 0.97),
    min_incline: pct(downs, 0.05),
  };
}
