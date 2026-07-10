'use client';

/**
 * PerfCollector — invisible real-user monitoring. Mounted once in the authed
 * app; it measures:
 *   - every same-origin /api/* fetch round-trip (kind=api),
 *   - page navigation timing: TTFB, DOMContentLoaded, load (kind=nav),
 *   - Largest Contentful Paint (kind=vital, label=lcp),
 * and flushes batches to POST /api/perf (interval + on page hide via
 * sendBeacon). Read back only on /admin/perf. No UI.
 */
import { useEffect } from 'react';

interface Sample { kind: 'api' | 'nav' | 'vital'; label: string; ms: number; status?: number | null }

// Module-level so React re-mounts / strict-mode double-invoke don't double-patch
// fetch or spin up two flush loops.
let installed = false;
let buffer: Sample[] = [];

/** Normalize a URL path to a low-cardinality label: strip query, replace
 *  numeric ids and uuids with ":id" so /api/users/<uuid>/connections and
 *  /api/activities?activityId=5 collapse to stable route keys. */
function normalizePath(url: string): string {
  let path = url;
  try { path = new URL(url, window.location.origin).pathname; } catch { /* keep raw */ }
  return path
    .split('/')
    .map(seg =>
      /^\d+$/.test(seg) ||
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg)
        ? ':id'
        : seg,
    )
    .join('/');
}

function push(s: Sample) {
  buffer.push(s);
  if (buffer.length >= 40) flush();
}

function flush(useBeacon = false) {
  if (buffer.length === 0) return;
  const batch = buffer;
  buffer = [];
  const payload = JSON.stringify({ samples: batch });
  try {
    if (useBeacon && typeof navigator.sendBeacon === 'function') {
      navigator.sendBeacon('/api/perf', new Blob([payload], { type: 'application/json' }));
    } else {
      // keepalive lets an in-flight flush survive a navigation.
      fetch('/api/perf', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true })
        .catch(() => { /* drop — telemetry must never break the app */ });
    }
  } catch { /* ignore */ }
}

export function PerfCollector() {
  useEffect(() => {
    if (installed || typeof window === 'undefined') return;
    installed = true;

    // 1. Patch fetch to time same-origin /api/* round-trips.
    const origFetch = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const isApi = typeof url === 'string' && url.includes('/api/') && !url.includes('/api/perf');
      if (!isApi) return origFetch(input, init);
      const t0 = performance.now();
      try {
        const res = await origFetch(input, init);
        push({ kind: 'api', label: normalizePath(url), ms: performance.now() - t0, status: res.status });
        return res;
      } catch (e) {
        push({ kind: 'api', label: normalizePath(url), ms: performance.now() - t0, status: 0 });
        throw e;
      }
    };

    // 2. Navigation timing (once the load event has settled).
    const recordNav = () => {
      const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
      if (!nav) return;
      if (nav.responseStart > 0) push({ kind: 'nav', label: 'ttfb', ms: nav.responseStart - nav.requestStart });
      if (nav.domContentLoadedEventEnd > 0) push({ kind: 'nav', label: 'dcl', ms: nav.domContentLoadedEventEnd - nav.startTime });
      if (nav.loadEventEnd > 0) push({ kind: 'nav', label: 'load', ms: nav.loadEventEnd - nav.startTime });
    };
    if (document.readyState === 'complete') recordNav();
    else window.addEventListener('load', () => setTimeout(recordNav, 0), { once: true });

    // 3. Largest Contentful Paint (keep the latest reported value).
    let lcp = 0;
    let lcpObserver: PerformanceObserver | undefined;
    try {
      lcpObserver = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) lcp = entry.startTime;
      });
      lcpObserver.observe({ type: 'largest-contentful-paint', buffered: true });
    } catch { /* unsupported browser */ }
    const commitLcp = () => { if (lcp > 0) { push({ kind: 'vital', label: 'lcp', ms: lcp }); lcp = 0; } };

    // 4. Flush loop + page-hide flush.
    const interval = window.setInterval(() => flush(), 12000);
    const onHide = () => { if (document.visibilityState === 'hidden') { commitLcp(); flush(true); } };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', () => { commitLcp(); flush(true); });

    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onHide);
      lcpObserver?.disconnect();
      // Leave fetch patched + installed=true: the app is a SPA, this mounts once
      // for the session and we don't want to unpatch/repatch on route changes.
    };
  }, []);

  return null;
}
