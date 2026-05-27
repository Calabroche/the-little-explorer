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
  /** Authenticated read endpoints (/api/me, /api/activities). 60/min is
      enough for normal browsing — anyone hitting this ceiling is
      scripting against us. */
  authedRead: { capacity: 60, refillPerS: 1.0 } satisfies Config,
  /** Heavy authenticated endpoints (/api/me/export with full activity
      pull). 5/min is more than enough for a human; stops a curl loop
      from running our Supabase egress bill up. */
  heavyRead:  { capacity: 5,  refillPerS: 0.083 } satisfies Config, // 5/min
  /** Authenticated write endpoints (/api/me PATCH, /api/me/onboarding).
      Same ceiling as read — writes don't need to be slower per se,
      but a misbehaving client shouldn't be able to spam either. */
  authedWrite:{ capacity: 30, refillPerS: 0.5 } satisfies Config,
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
 * Reject requests whose declared body size exceeds `maxBytes`. Defends
 * against the "POST 50 MB of garbage to crash the lambda" attack: the
 * Content-Length header gets checked before we read the body into
 * memory, so a malicious client can't even start streaming.
 *
 * Returns a 413 NextResponse if too large, otherwise `null`.
 *
 * Usage:
 *   const tooBig = enforceBodySize(req, 1_000_000); // 1 MB cap
 *   if (tooBig) return tooBig;
 */
export function enforceBodySize(req: NextRequest, maxBytes: number): NextResponse | null {
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > maxBytes) {
    console.warn(`[body-size] rejected ${declared} bytes (cap ${maxBytes})`);
    return NextResponse.json(
      { error: 'payload_too_large', max_bytes: maxBytes },
      { status: 413, headers: { 'Content-Length': '0' } },
    );
  }
  return null;
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
 * Usage (per-IP):
 *   const limited = enforceRateLimit(req, RATE_LIMITS.elevation, 'elevation');
 *
 * Usage (per-user, for authenticated routes — preferred over IP
 * once the user is known so a noisy office NAT doesn't punish a
 * second user behind the same gateway):
 *   const limited = enforceRateLimit(req, RATE_LIMITS.authedRead,
 *     'me-get', { userId: authed.id });
 */
export function enforceRateLimit(
  req: NextRequest,
  cfg: Config,
  routeName: string,
  /** Optional per-user keying. When provided, the bucket is keyed on
   *  the user id rather than the IP — bypasses the shared-NAT
   *  problem and follows the actor across reconnects. */
  opts: { userId?: string | null } = {},
): NextResponse | null {
  const subject = opts.userId ? `u:${opts.userId}` : `ip:${clientIp(req)}`;
  const key = `${routeName}:${subject}`;
  const { ok, retryAfter } = consume(key, cfg);
  if (ok) return null;
  maybeSweep();
  console.warn(`[rate-limit] ${routeName} blocked ${subject} retry_after=${retryAfter}s`);
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
