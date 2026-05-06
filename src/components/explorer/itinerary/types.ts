// ── Itinerary types ──────────────────────────────────────────────────────────
//
// A waypoint is a village (one stop on the tour). The itinerary is the
// ordered list of waypoints + a target distance; the cached geometry +
// distance come from the routing engine.

export interface Waypoint {
  name:    string;
  code:    string;          // INSEE commune code
  postal?: string;
  lat:     number;
  lng:     number;
}

export interface Itinerary {
  id:           string;
  name:         string;     // user-given title
  createdAt:    string;     // ISO date
  waypoints:    Waypoint[];
  targetKm:     number;     // user-chosen target distance
  // Cached routing result — refreshed when waypoints change.
  distanceKm?:  number;
  durationMin?: number;
  geometry?:    [number, number][]; // ordered [lat, lng] polyline
}
