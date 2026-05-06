// ── Itinerary types ──────────────────────────────────────────────────────────
//
// A waypoint is a village (one stop on the tour). The itinerary is the
// ordered list of waypoints + a target distance + a loop flag; the
// cached geometry, distance, and elevation profile come from external
// services and live in the saved record so re-opening an itinerary is
// instant.

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
  loop?:        boolean;    // start = end (start village appended as final stop on routing)
  // Cached routing result — refreshed when waypoints change.
  distanceKm?:  number;
  durationMin?: number;
  geometry?:    [number, number][]; // ordered [lat, lng] polyline
  // Cached elevation profile (downsampled to ≤100 points along the polyline).
  elevSampleIndices?: number[];
  elevations?:        number[];
  totalAscent?:       number;
  totalDescent?:      number;
}
