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
