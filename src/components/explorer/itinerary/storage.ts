// localStorage-backed itinerary library.
//
// Per-user key (Florian and Helena have separate libraries since their
// regions of interest are different). No backend — the app has no auth,
// so all "saves" live in the browser. Lossy across devices but matches
// the app's no-account model.

import { Itinerary } from './types';

const KEY = (user: string) => `tle_itineraries_${user}`;

export function loadAll(user: string): Itinerary[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(KEY(user));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveAll(user: string, list: Itinerary[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(KEY(user), JSON.stringify(list));
  } catch {
    // localStorage full / blocked — silent fail rather than breaking the UI.
  }
}

export function upsert(user: string, it: Itinerary): Itinerary[] {
  const list = loadAll(user);
  const idx  = list.findIndex(x => x.id === it.id);
  if (idx >= 0) list[idx] = it;
  else          list.unshift(it);    // newest first
  saveAll(user, list);
  return list;
}

export function remove(user: string, id: string): Itinerary[] {
  const list = loadAll(user).filter(x => x.id !== id);
  saveAll(user, list);
  return list;
}

export function newId(): string {
  return `itin_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}
