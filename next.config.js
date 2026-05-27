/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow `npm run build:check` to use a separate dist dir so it doesn't
  // clobber the running dev server's .next cache (which causes a
  // MODULE_NOT_FOUND on /611.js until you `rm -rf .next` and restart).
  distDir: process.env.NEXT_DIST_DIR || '.next',

  // Defence-in-depth headers applied to every response. Vercel sets
  // reasonable defaults; these tighten the surface meaningfully.
  // CSP (`Content-Security-Policy` full policy) intentionally
  // deferred — Leaflet / Recharts / next/font inject inline styles
  // that would need careful allow-listing first; a future Report-Only
  // pass will catch the actual sources we need. We do ship
  // `frame-ancestors 'none'` already because that directive doesn't
  // affect inline scripts/styles.
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          // Force HTTPS for the next 2 years (incl. subdomains, with
          // preload eligibility). After first visit, a downgrade-to-
          // HTTP attacker can't trick the browser into accepting an
          // HTTP variant of the site.
          { key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload' },
          // Stops the browser from guessing MIME types (mitigates
          // legacy script-injection vectors via uploaded files).
          { key: 'X-Content-Type-Options',  value: 'nosniff' },
          // Limit referrer info we leak on outbound clicks (Strava,
          // Vercel dashboard, etc.).
          { key: 'Referrer-Policy',         value: 'strict-origin-when-cross-origin' },
          // Tighten the legacy clickjacking guard from SAMEORIGIN to
          // DENY — we don't self-embed any flow in an iframe, so
          // disallowing the lot stops UI-redress on the delete-
          // account / disconnect-Strava buttons.
          { key: 'X-Frame-Options',         value: 'DENY' },
          // Modern equivalent of X-Frame-Options. Ships now even
          // without a full CSP so we don't lose anything if X-Frame-
          // Options drops out of a browser someday.
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          // Isolate the browsing context so Spectre-class cross-
          // origin reads are mitigated. `same-origin` is the strictest
          // level that still lets external links open in a new tab —
          // the new tab gets a fresh context, can't reach back into
          // ours via window.opener.
          { key: 'Cross-Origin-Opener-Policy',    value: 'same-origin' },
          // Resources private to same-origin requestors — stops other
          // sites from <img>-loading our pages to fingerprint logged-
          // in state via timing.
          { key: 'Cross-Origin-Resource-Policy',  value: 'same-origin' },
          // Lock browser permissions to a minimum — geolocation
          // allowed for our own origin (used in /navigate/<id>);
          // every other sensor / device explicitly denied.
          { key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(self), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()' },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
