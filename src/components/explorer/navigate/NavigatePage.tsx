'use client';

import { useState, useEffect, useRef, useMemo, useCallback, CSSProperties } from 'react';
import dynamic from 'next/dynamic';
import { tokens } from '../tokens';
import { Itinerary } from '../itinerary/types';
import { loadAll } from '../itinerary/storage';
import { NavStep } from './types';
import { closestPointOnPolyline, distanceAlongRemaining, distanceAlongTo } from './geo';
import { arrowFor, maneuverCore, maneuverSentence, formatDistance, pickAnnouncement, AnnounceLevel } from './maneuvers';

const MapContainer = dynamic(() => import('react-leaflet').then(m => m.MapContainer), { ssr: false });
const Polyline     = dynamic(() => import('react-leaflet').then(m => m.Polyline),     { ssr: false });
const CircleMarker = dynamic(() => import('react-leaflet').then(m => m.CircleMarker), { ssr: false });
const FollowCamera = dynamic(() => import('./FollowCamera').then(m => m.FollowCamera), { ssr: false });
const UserMarker   = dynamic(() => import('./UserMarker').then(m => m.UserMarker),     { ssr: false });
const BasemapTiles = dynamic(() => import('../MapBasemap').then(m => m.BasemapTiles), { ssr: false });
import { useBasemap, BasemapToggle } from '../MapBasemap';

interface Props { itineraryId: string }

// ── Hook: speak text via the Web Speech API. iOS only allows the first
// utterance after a user-initiated event, so we lazy-initialise on the
// first call (which is bound to the Start button click).
function useSpeech() {
  const enabled = useRef(false);
  const enable = useCallback(() => { enabled.current = true; }, []);
  const speak  = useCallback((text: string, lang = 'fr-FR') => {
    if (!enabled.current || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang;
      u.rate = 1.0;
      window.speechSynthesis.speak(u);
    } catch { /* ignore — speech is decorative */ }
  }, []);
  return { enable, speak };
}

// ── Hook: keep the screen on while navigating. Available in Safari iOS
// 16.4+. Re-acquired on visibility change because iOS releases the lock
// when the page goes to background.
function useWakeLock(active: boolean) {
  const lockRef = useRef<{ release: () => Promise<void> } | null>(null);
  useEffect(() => {
    let cancelled = false;
    type WakeLockSentinel = { release: () => Promise<void> };
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<WakeLockSentinel> } };
    const acquire = async () => {
      if (!active || !nav.wakeLock) return;
      try {
        const lock = await nav.wakeLock.request('screen');
        if (cancelled) { lock.release(); return; }
        // Race guard — if a previous acquire() raced ahead (e.g. user
        // toggled active rapidly, or visibilitychange fired before
        // the first request resolved), release the older sentinel
        // before overwriting the ref so we never leak a lock.
        if (lockRef.current) lockRef.current.release().catch(() => {});
        lockRef.current = lock;
      } catch { /* user denied or unavailable — silent */ }
    };
    acquire();
    const onVis = () => { if (document.visibilityState === 'visible') acquire(); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVis);
      lockRef.current?.release().catch(() => {});
      lockRef.current = null;
    };
  }, [active]);
}

// ── Hook: continuously read GPS via Geolocation API. Returns the latest
// fix plus a status flag so the UI can show "acquiring signal".
interface Fix { lat: number; lng: number; speed: number | null; heading: number | null; accuracy: number; ts: number }
function useGeolocation(active: boolean): { fix: Fix | null; error: string | null; ready: boolean } {
  const [fix,   setFix]   = useState<Fix | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!active) { setReady(false); return; }
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setError('geolocation_unsupported');
      return;
    }
    let cancelled = false;
    const id = navigator.geolocation.watchPosition(
      pos => {
        if (cancelled) return;
        setReady(true); setError(null);
        setFix({
          lat:      pos.coords.latitude,
          lng:      pos.coords.longitude,
          speed:    pos.coords.speed,         // m/s, null if unsupported
          heading:  pos.coords.heading,       // deg, null when stationary
          accuracy: pos.coords.accuracy,      // meters
          ts:       pos.timestamp,
        });
      },
      err => { if (!cancelled) setError(err.message || 'geolocation_error'); },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 10_000 },
    );
    return () => { cancelled = true; navigator.geolocation.clearWatch(id); };
  }, [active]);
  return { fix, error, ready };
}

// ── Format helpers ───────────────────────────────────────────────────────
function formatDuration(s: number): string {
  if (!Number.isFinite(s) || s <= 0) return '—';
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return h > 0 ? `${h}h${m.toString().padStart(2, '0')}` : `${m} min`;
}
function formatEta(secondsRemaining: number): string {
  if (!Number.isFinite(secondsRemaining) || secondsRemaining <= 0) return '—';
  const eta = new Date(Date.now() + secondsRemaining * 1000);
  return eta.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ── Main component ──────────────────────────────────────────────────────
export function NavigatePage({ itineraryId }: Props) {
  const [itin, setItin]     = useState<Itinerary | null>(null);
  const [checked, setChecked] = useState(false);
  const [steps, setSteps]   = useState<NavStep[] | null>(null);
  const [stepsErr, setStepsErr] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const [arrived, setArrived] = useState(false);
  const [basemap, setBasemap] = useBasemap();

  // Look the itinerary up across both users' libraries (no auth in this app).
  useEffect(() => {
    const search = (['florian', 'helena'] as const)
      .flatMap(u => loadAll(u))
      .find(it => it.id === itineraryId);
    setItin(search ?? null);
    setChecked(true);
  }, [itineraryId]);

  // Re-fetch the route with steps. The saved itinerary may already
  // have a polyline cached, but maneuvers aren't persisted (they bloat
  // localStorage and OSRM is fast enough).
  useEffect(() => {
    if (!itin) return;
    let cancelled = false;
    const eff = itin.loop ? [...itin.waypoints, itin.waypoints[0]] : itin.waypoints;
    if (eff.length < 2) return;
    fetch('/api/route-bike', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ waypoints: eff.map(w => [w.lat, w.lng]), steps: true }),
    })
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then((data: { steps?: NavStep[]; geometry?: [number, number][] }) => {
        if (cancelled) return;
        setSteps(data.steps ?? []);
        // If we got a fresher geometry, prefer it (no-op in practice).
        if (data.geometry && (!itin.geometry || itin.geometry.length === 0)) {
          setItin(prev => prev ? { ...prev, geometry: data.geometry } : prev);
        }
      })
      .catch(() => { if (!cancelled) setStepsErr('routing_failed'); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itin?.id]);

  const polyline = itin?.geometry ?? null;

  // Hooks must run unconditionally (they return early via `active` flags
  // when navigation isn't started yet) so the hook order stays stable
  // across renders that toggle `started`.
  useWakeLock(started && !arrived);
  const { enable: enableSpeech, speak } = useSpeech();
  const { fix, ready } = useGeolocation(started);

  // ── Progress along the route ─────────────────────────────────────────
  const segIdxRef = useRef(0); // monotonically advancing — prevents loop snapback
  const progress = useMemo(() => {
    if (!polyline || polyline.length < 2 || !fix) return null;
    const here = closestPointOnPolyline(polyline, [fix.lat, fix.lng], segIdxRef.current);
    if (here.segIdx > segIdxRef.current) segIdxRef.current = here.segIdx;
    return here;
  }, [polyline, fix]);

  const distRemainingM = useMemo(() => {
    if (!polyline || !progress) return null;
    return distanceAlongRemaining(polyline, progress.segIdx, progress.t);
  }, [polyline, progress]);

  // Identify the next maneuver: the first step whose location is still
  // ahead of the user along the polyline.
  const nextStep = useMemo<{ step: NavStep; idx: number; distM: number } | null>(() => {
    if (!polyline || !progress || !steps || steps.length === 0) return null;
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      if (s.type === 'depart') continue;
      const d = distanceAlongTo(polyline, progress.segIdx, progress.t, s.start);
      if (d > 1) return { step: s, idx: i, distM: d };
    }
    // Past the last maneuver — surface the arrival step. (Reverse
    // for-loop instead of Array.prototype.findLastIndex which is
    // ES2023 — Safari < 16 and older Firefox/Chrome would throw a
    // TypeError mid-navigation.)
    let arriveIdx = -1;
    for (let i = steps.length - 1; i >= 0; i--) {
      if (steps[i].type === 'arrive') { arriveIdx = i; break; }
    }
    if (arriveIdx >= 0) {
      return { step: steps[arriveIdx], idx: arriveIdx, distM: distRemainingM ?? 0 };
    }
    return null;
  }, [polyline, progress, steps, distRemainingM]);

  // ── Voice announcements ─────────────────────────────────────────────
  // For each step, remember which thresholds we already spoke. When the
  // active step changes, we wipe its bucket so far/mid/near/now play
  // again for the next one.
  const announcedRef = useRef<Map<number, Set<AnnounceLevel>>>(new Map());
  useEffect(() => {
    if (!started || !nextStep) return;
    const bucket = announcedRef.current.get(nextStep.idx) ?? new Set<AnnounceLevel>();
    const pick = pickAnnouncement(nextStep.distM, bucket);
    if (pick) {
      bucket.add(pick);
      announcedRef.current.set(nextStep.idx, bucket);
      const phrase = maneuverSentence(
        nextStep.step,
        pick === 'now' ? null : nextStep.distM,
        'fr',
      );
      speak(phrase);
    }
  }, [started, nextStep, speak]);

  // Arrival detection: distance to end < 25 m AND we've passed the last
  // real maneuver. Triggers the arrival prompt + UI lockout.
  useEffect(() => {
    if (!started || arrived || distRemainingM == null) return;
    if (distRemainingM < 25) {
      setArrived(true);
      speak('Vous êtes arrivé à destination');
    }
  }, [started, arrived, distRemainingM, speak]);

  // ── Layout ───────────────────────────────────────────────────────────
  if (!checked) {
    return (
      <div style={fullScreen}>
        <div style={emptyState}>
          <p style={{ fontFamily: "'Space Grotesk'", color: tokens.inkLight, letterSpacing: '0.1em', textTransform: 'uppercase', fontSize: 11 }}>
            Chargement…
          </p>
        </div>
      </div>
    );
  }
  if (!itin) {
    return (
      <div style={fullScreen}>
        <div style={emptyState}>
          <p style={{ fontFamily: "'Space Grotesk'", color: tokens.inkLight }}>
            Itinéraire introuvable. <a href="/itineraire" style={{ color: tokens.terra }}>Retour</a>
          </p>
        </div>
      </div>
    );
  }
  if (!polyline || polyline.length < 2) {
    return (
      <div style={fullScreen}>
        <div style={emptyState}>
          <p style={{ fontFamily: "'Space Grotesk'", color: tokens.inkLight }}>
            Cet itinéraire n&apos;a pas de tracé. Recalcule-le sur la page Itinéraire.
          </p>
        </div>
      </div>
    );
  }

  const speedKmh = fix?.speed != null ? Math.max(0, fix.speed * 3.6) : null;
  const arrowGlyph = arrowFor(nextStep?.step ?? null);
  const corePhrase = nextStep ? maneuverCore(nextStep.step, 'fr') : (started ? 'Cap sur la destination' : 'Prêt');
  const distLabel  = nextStep && nextStep.step.type !== 'arrive' ? formatDistance(nextStep.distM, 'fr') : null;

  // Average speed estimate for ETA. Falls back to 18 km/h when we
  // haven't seen a fix yet (sane cycling pace).
  const avgKmh   = speedKmh && speedKmh > 5 ? speedKmh : 18;
  const etaSec   = distRemainingM != null ? (distRemainingM / 1000) / avgKmh * 3600 : null;

  return (
    <div style={fullScreen}>
      {/* ─── Top instruction bar ───────────────────────────── */}
      <div style={topBar}>
        <a href="/itineraire" aria-label="Retour"
           style={closeBtn}
           onClick={() => { try { window.speechSynthesis?.cancel(); } catch { /* */ } }}>
          ✕
        </a>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={arrowBox}>{arrowGlyph}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: "'Playfair Display'", fontWeight: 800, fontSize: 22, color: tokens.ink, lineHeight: 1.1 }}>
              {arrived ? 'Vous êtes arrivé' : corePhrase}
            </div>
            {distLabel && !arrived && (
              <div style={{ fontFamily: "'Space Grotesk'", fontSize: 12, color: tokens.terra, fontWeight: 600, letterSpacing: '0.05em', marginTop: 2 }}>
                dans {distLabel}{nextStep!.step.name && ` · ${nextStep!.step.name}`}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ─── Map (fills remaining height) ───────────────────── */}
      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
        <MapContainer
          center={fix ? [fix.lat, fix.lng] : polyline[0]}
          zoom={16}
          style={{ height: '100%', width: '100%' }}
          zoomControl={false}
          maxZoom={20}
        >
          {/* Basemap follows the shared useBasemap preference — plan or
              satellite. Either works for navigation; satellite is handy
              for spotting features that aren't on the road map (trail
              forks in a forest, building edges in a city). */}
          <BasemapTiles basemap={basemap} darkMode={false} />

          {/* Komoot-style route line: a wide white halo underneath
              and a bold blue ribbon on top, so the path POPS against
              the road network at any zoom. Two layers, both rounded.
              The unridden portion fades to grey once you've passed it,
              and the remaining portion stays vivid blue. */}
          {progress ? (
            <>
              {/* Already-ridden tail (greyed) */}
              <Polyline
                positions={[...polyline.slice(0, progress.segIdx + 1), progress.foot]}
                pathOptions={{ color: '#fff', weight: 11, opacity: 0.9, lineCap: 'round', lineJoin: 'round' }}
              />
              <Polyline
                positions={[...polyline.slice(0, progress.segIdx + 1), progress.foot]}
                pathOptions={{ color: tokens.inkLight, weight: 6, opacity: 0.55, lineCap: 'round', lineJoin: 'round' }}
              />
              {/* Remaining (vivid) */}
              <Polyline
                positions={[progress.foot, ...polyline.slice(progress.segIdx + 1)]}
                pathOptions={{ color: '#fff', weight: 12, opacity: 1, lineCap: 'round', lineJoin: 'round' }}
              />
              <Polyline
                positions={[progress.foot, ...polyline.slice(progress.segIdx + 1)]}
                pathOptions={{ color: tokens.blue, weight: 7, opacity: 1, lineCap: 'round', lineJoin: 'round' }}
              />
            </>
          ) : (
            // Pre-start view: the whole route in one bold blue ribbon.
            <>
              <Polyline positions={polyline} pathOptions={{ color: '#fff', weight: 12, opacity: 1, lineCap: 'round', lineJoin: 'round' }} />
              <Polyline positions={polyline} pathOptions={{ color: tokens.blue, weight: 7, opacity: 1, lineCap: 'round', lineJoin: 'round' }} />
            </>
          )}

          {/* Bigger, higher-contrast maneuver markers — visible against
              both the route ribbon and the basemap. */}
          {steps?.map((s, i) => (
            s.type !== 'depart' && s.type !== 'arrive' ? (
              <CircleMarker key={i} center={s.start} radius={6}
                pathOptions={{ fillColor: '#fff', color: tokens.ink, weight: 2, fillOpacity: 1 }} />
            ) : null
          ))}
          <UserMarker fix={fix} />
          {fix && started && !arrived && <FollowCamera lat={fix.lat} lng={fix.lng} />}
        </MapContainer>
        <BasemapToggle basemap={basemap} onChange={setBasemap} compact />

        {/* GPS-warmup overlay */}
        {started && !ready && (
          <div style={overlay}>
            <div style={overlayCard}>
              <div style={{ fontFamily: "'Space Grotesk'", fontSize: 11, letterSpacing: '0.15em', textTransform: 'uppercase', color: tokens.inkLight, marginBottom: 6 }}>
                Acquisition GPS
              </div>
              <div style={{ fontFamily: "'Playfair Display'", fontSize: 18, fontWeight: 700 }}>
                Reste immobile quelques secondes…
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ─── Bottom stats / control bar ─────────────────────── */}
      <div style={bottomBar}>
        {!started ? (
          <button onClick={() => { enableSpeech(); setStarted(true); speak('Démarrage'); }} style={startBtn}>
            ▶ Démarrer le trip
          </button>
        ) : arrived ? (
          <a href="/itineraire" style={{ ...startBtn, textDecoration: 'none', textAlign: 'center', background: tokens.green }}>
            Terminer
          </a>
        ) : (
          <>
            <div style={statBlock}>
              <div style={statValue}>{speedKmh != null ? speedKmh.toFixed(1) : '—'}</div>
              <div style={statLabel}>km/h</div>
            </div>
            <div style={statBlockCenter}>
              <div style={statValue}>{distRemainingM != null ? (distRemainingM / 1000).toFixed(1) : '—'}</div>
              <div style={statLabel}>km restants</div>
            </div>
            <div style={statBlock}>
              <div style={statValue}>{etaSec != null ? formatEta(etaSec) : '—'}</div>
              <div style={statLabel}>ETA · {etaSec != null ? formatDuration(etaSec) : '—'}</div>
            </div>
            <button onClick={() => { try { window.speechSynthesis?.cancel(); } catch { /* */ } setStarted(false); }}
                    style={stopBtn} aria-label="Arrêter">
              ■
            </button>
          </>
        )}
      </div>

      {stepsErr && (
        <div style={{ position: 'absolute', top: 80, left: 16, right: 16, padding: '8px 12px', background: tokens.terra, color: '#fff', fontFamily: "'Space Grotesk'", fontSize: 12, borderRadius: 4, zIndex: 10 }}>
          Erreur de calcul de l&apos;itinéraire pour la navigation.
        </div>
      )}
    </div>
  );
}

// ── Inline styles ─────────────────────────────────────────────────────────
const fullScreen: CSSProperties = {
  height: '100dvh', width: '100vw', display: 'flex', flexDirection: 'column',
  background: tokens.cream, overflow: 'hidden', position: 'relative',
};
const topBar: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10,
  padding: '12px 14px',
  background: tokens.surface, borderBottom: `1px solid ${tokens.creamBorder}`,
  flexShrink: 0,
};
const closeBtn: CSSProperties = {
  width: 36, height: 36, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  background: tokens.creamDark, color: tokens.ink,
  borderRadius: '50%', textDecoration: 'none',
  fontFamily: "'Space Grotesk'", fontSize: 14, fontWeight: 700,
  flexShrink: 0,
};
const arrowBox: CSSProperties = {
  width: 56, height: 56, borderRadius: 8,
  background: tokens.terra, color: '#fff',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontSize: 32, fontWeight: 800,
  flexShrink: 0,
};
const bottomBar: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8,
  padding: '14px 16px',
  background: tokens.surface, borderTop: `1px solid ${tokens.creamBorder}`,
  flexShrink: 0, minHeight: 70,
};
const statBlock: CSSProperties = { flex: 1, textAlign: 'left', minWidth: 0 };
const statBlockCenter: CSSProperties = { flex: 1, textAlign: 'center', minWidth: 0 };
const statValue: CSSProperties = {
  fontFamily: "'Playfair Display'", fontSize: 24, fontWeight: 800, color: tokens.ink, lineHeight: 1,
};
const statLabel: CSSProperties = {
  fontFamily: "'Space Grotesk'", fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase',
  color: tokens.inkLight, marginTop: 2,
};
const stopBtn: CSSProperties = {
  width: 56, height: 56, borderRadius: '50%',
  background: tokens.terra, color: '#fff', border: 'none',
  fontSize: 20, fontWeight: 800,
  display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
  flexShrink: 0,
};
const startBtn: CSSProperties = {
  flex: 1, padding: '14px 20px',
  background: tokens.terra, color: '#fff', border: 'none', borderRadius: 6,
  fontFamily: "'Space Grotesk'", fontSize: 14, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
  cursor: 'pointer',
};
const emptyState: CSSProperties = {
  flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 40,
};
const overlay: CSSProperties = {
  position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'rgba(0,0,0,0.15)', zIndex: 5, pointerEvents: 'none',
};
const overlayCard: CSSProperties = {
  background: tokens.surface, padding: '20px 28px', borderRadius: 8,
  boxShadow: '0 8px 24px rgba(0,0,0,0.15)', textAlign: 'center',
};
