/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow `npm run build:check` to use a separate dist dir so it doesn't
  // clobber the running dev server's .next cache (which causes a
  // MODULE_NOT_FOUND on /611.js until you `rm -rf .next` and restart).
  distDir: process.env.NEXT_DIST_DIR || '.next',

  // Lightweight security headers applied to every response. Vercel
  // already sets reasonable defaults, but these tighten the surface
  // without breaking any feature (no CSP — too easy to break Leaflet
  // / Strava / Recharts inline styles in dev).
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          // Stops the browser from guessing MIME types (mitigates
          // some legacy script-injection vectors via uploaded files).
          { key: 'X-Content-Type-Options',  value: 'nosniff' },
          // Limit referrer info we leak when the user clicks an
          // outbound link (Strava, Vercel dashboard, etc.).
          { key: 'Referrer-Policy',         value: 'strict-origin-when-cross-origin' },
          // Block embedding in iframes — there's no legitimate
          // embedding usecase for this app and it stops UI-redress
          // attacks (clickjacking) on the navigation flow.
          { key: 'X-Frame-Options',         value: 'SAMEORIGIN' },
          // Lock permissions to a minimum — we use geolocation in
          // /navigate/<id> and the GPX-export uses no APIs beyond
          // standard JS. Camera / microphone explicitly denied.
          { key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(self), payment=(), usb=()' },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
