/**
 * Per-IP token-bucket rate limiter for public API routes.
 *
 * Why this exists: our proxy routes (`/api/elevation`, `/api/route-bike`,
 * `/api/commune-search`) forward to third-party services (Open-Elevation,
 * OSRM, BAN) that have their own quotas. Without a rate limit, anyone who
 * scrapes our URL can blow through our daily allowance — and there's no
 * auth on those endpoints because the iOS app and the web both call them.
 *
 * Implementation: in-memory map keyed by IP. Each entry holds a "tokens"
 * count that refills linearly over time. When tokens hits 0, the request
 * is rejected with 429. Token capacity + refill rate are per-route.
 *
 * Caveat — Vercel serverless: the map lives in the Node process, which
 * means it's per function instance. Vercel may spin up multiple parallel
 * instances under load → the effective limit is `instances × capacity`.
 * For our scale (≤ 15 users) this is still strong protection. If we ever
 * grow we'll swap this for Upstash Redis by replacing `getBucket` /
 * `consume` with calls to `redis.eval(LUA_SCRIPT, …)`.
 *
 * Returns `{ ok: true }` on a permitted request, or `{ ok: false,
 * retryAfter: <seconds> }` when the bucket is empty.
 */

import { NextRequest, NextResponse } from 'next/server';

interface Bucket {
  tokens:    number;
  lastFill:  number; // ms epoch
}

interface Config {
  /** Maximum tokens in the bucket (= burst capacity). */
  capacity:   number;
  /** Tokens added per second (= sustained throughput). */
  refillPerS: number;
}

// Per-route configs. Conservative — these are personal-project ceilings,
// not commercial limits. Override per-route at the call site if needed.
export const RATE_LIMITS = {
  /** 30 reqs/min sustained, 60 burst — enough for typical elevation
      lookups during a route build (we batch points server-side). */
  elevation:  { capacity: 60, refillPerS: 0.5 } satisfies Config,
  /** 20 reqs/min sustained, 30 burst — bike routing is heavier per call
      so we trim it tighter. */
  routeBike:  { capacity: 30, refillPerS: 0.33 } satisfies Config,
  /** 60 reqs/min sustained — village autocomplete fires on each keystroke
      after debounce, so this needs to be generous. */
  commune:    { capacity: 60, refillPerS: 1.0 } satisfies Config,
} as const;

const buckets = new Map<string, Bucket>();

/**
 * Best-effort client IP. Vercel sets `x-real-ip` and `x-forwarded-for`.
 * Falls back to a constant "anonymous" bucket so we still rate-limit
 * unknown-source requests rather than letting them through unbounded.
 */
function clientIp(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  const real = req.headers.get('x-real-ip');
  if (real) return real;
  return 'anonymous';
}

/**
 * Token-bucket consume. Returns whether a token was available, and how
 * many seconds the caller should wait before retrying.
 */
function consume(key: string, cfg: Config): { ok: boolean; retryAfter: number } {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { tokens: cfg.capacity, lastFill: now };
    buckets.set(key, bucket);
  }

  // Refill: add tokens linearly since lastFill, capped at capacity.
  const elapsedSec = (now - bucket.lastFill) / 1000;
  if (elapsedSec > 0) {
    bucket.tokens = Math.min(cfg.capacity, bucket.tokens + elapsedSec * cfg.refillPerS);
    bucket.lastFill = now;
  }

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return { ok: true, retryAfter: 0 };
  }

  // Empty bucket — compute how long until 1 token will be available.
  const retryAfter = Math.ceil((1 - bucket.tokens) / cfg.refillPerS);
  return { ok: false, retryAfter };
}

/**
 * Sweep buckets older than 1 h to keep the map bounded. Called
 * opportunistically on each rate-limited request, so it doesn't run on
 * an idle process. O(n) but n is bounded by recent unique IPs.
 */
let lastSweep = Date.now();
function maybeSweep() {
  const now = Date.now();
  if (now - lastSweep < 60_000) return; // sweep at most once per minute
  lastSweep = now;
  const cutoff = now - 3_600_000;
  // Map.forEach to avoid downlevel-iteration warnings — same effect as
  // `for (const [k, v] of buckets)` but compiles cleanly on ES5 target.
  buckets.forEach((v, k) => {
    if (v.lastFill < cutoff) buckets.delete(k);
  });
}

/**
 * Guard a route handler. Returns `null` if the request is allowed
 * (handler should proceed), or a 429 NextResponse if rate-limited.
 *
 * Usage:
 *   export async function POST(req: NextRequest) {
 *     const limited = enforceRateLimit(req, RATE_LIMITS.elevation, 'elevation');
 *     if (limited) return limited;
 *     // … real handler
 *   }
 */
export function enforceRateLimit(
  req: NextRequest,
  cfg: Config,
  routeName: string,
): NextResponse | null {
  const ip = clientIp(req);
  const key = `${routeName}:${ip}`;
  const { ok, retryAfter } = consume(key, cfg);
  if (ok) return null;
  maybeSweep();
  console.warn(`[rate-limit] ${routeName} blocked ip=${ip} retry_after=${retryAfter}s`);
  return NextResponse.json(
    {
      error:        'rate_limited',
      message:      `Trop de requêtes. Réessaie dans ${retryAfter}s.`,
      retry_after:  retryAfter,
    },
    {
      status:  429,
      headers: {
        'Retry-After':           String(retryAfter),
        'X-RateLimit-Limit':     String(cfg.capacity),
        'X-RateLimit-Refill':    String(cfg.refillPerS),
      },
    },
  );
}
