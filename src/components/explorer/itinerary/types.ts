// ── Itinerary types ──────────────────────────────────────────────────────────
//
// A waypoint is a village (one stop on the tour). The itinerary is the
// ordered list of waypoints + a target distance + a loop flag; the
// cached geometry, distance, and elevation profile come from external
// services and live in the saved record so re-opening an itinerary is
// instant.

export interface Waypoint {
  name:    string;
  code:    string;          // INSEE commune code (always present)
  postal?: string;
  lat:     number;
  lng:     number;
  // Optional full human-readable address from BAN
  // ("12 Chemin du Manoir 69570 Dardilly"). Falls back to `name` if
  // missing — older itineraries saved before BAN integration won't
  // have it.
  label?:  string;
  // Commune name (e.g. "Dardilly") — only differs from `name` for
  // street-level / housenumber results.
  city?:   string;
  // What kind of place this waypoint is. Lets the UI render a precise
  // address differently from a municipality stop.
  kind?:   'housenumber' | 'street' | 'locality' | 'municipality';
}

/// Trimmed OSRM maneuver shape — same as the NavStep returned by
/// /api/route-bike when called with `steps: true`. Used by the Watch
/// to fire voice nav cues at the right moments.
export interface NavStep {
  start:    [number, number];     // [lat, lng] where the maneuver happens
  type:     string;               // OSRM type: turn, depart, arrive, fork, …
  modifier: string;               // OSRM modifier: left, right, slight left, …
  exit:     number | null;        // for roundabouts
  name:     string;               // street name after the maneuver
  distance: number;               // meters of this step
  duration: number;               // seconds of this step
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
  /// Turn-by-turn maneuvers used by the Watch's voice navigation.
  /// Optional because older itineraries saved before this field
  /// existed won't have it — the Watch falls back to silent map
  /// guidance in that case.
  steps?:       NavStep[];
  // Cached elevation profile (downsampled to ≤100 points along the polyline).
  elevSampleIndices?: number[];
  elevations?:        number[];
  totalAscent?:       number;
  totalDescent?:      number;
}
