// Types shared by the navigation flow. These mirror the trimmed step
// shape returned by /api/route-bike.

export interface NavStep {
  start:    [number, number];     // maneuver location [lat, lng]
  type:     string;                // OSRM maneuver type ("turn", "continue", "roundabout"…)
  modifier: string;                // OSRM modifier ("left", "right", "slight left"…)
  exit:     number | null;         // for roundabouts, which exit to take
  name:     string;                // street name AFTER the maneuver
  distance: number;                // meters covered by this step
  duration: number;                // seconds
}
