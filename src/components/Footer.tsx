/**
 * Site footer — shown on auth-gated content routes (settings, profile,
 * admin) plus the public /login, /privacy, /terms pages. Deliberately
 * NOT mounted on full-bleed map routes (`/`, `/navigate/[id]`) because
 * the footer would overlay the canvas.
 *
 * Two responsibilities:
 *   1. Mandatory Strava attribution — "Powered by Strava" mark next to
 *      the brand. Required by the Strava API Agreement; refusal to ship
 *      this is one of the top reasons they reject athlete-limit increase
 *      requests.
 *   2. Legal links — Privacy + Terms. Required by Google OAuth
 *      verification and by the Strava API Agreement (which mandates
 *      that any app collecting athlete data publishes both).
 *
 * The Strava logo is the official "Compatible with Strava" mark. The
 * file lives at `public/strava-powered.svg` — download the latest one
 * from https://www.strava.com/brand if Strava ever refreshes the kit.
 */

import Link from 'next/link';

const ink      = '#5C544A';
const inkLight = '#8A8175';
const border   = '#E0D5C2';
const strava   = '#FC5200'; // official Strava orange

export function Footer() {
  return (
    <footer style={{
      marginTop:    48,
      padding:      '20px 24px 28px',
      borderTop:    `1px solid ${border}`,
      fontFamily:   "'Space Grotesk', sans-serif",
      fontSize:     12,
      color:        inkLight,
      display:      'flex',
      flexWrap:     'wrap',
      gap:          16,
      alignItems:   'center',
      justifyContent: 'space-between',
    }}>
      <PoweredByStrava />

      <nav style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
        <Link href="/privacy" style={linkStyle}>Confidentialité</Link>
        <Link href="/terms"   style={linkStyle}>CGU</Link>
        <span style={{ color: inkLight }}>© {new Date().getFullYear()} The Little Explorer</span>
      </nav>
    </footer>
  );
}

/**
 * Plain-text "Powered by Strava" mark — the bare-minimum-compliant
 * version while we wait for the official SVG to land at
 * /public/strava-powered.svg. Once that asset is in place, swap the
 * span below for an <img>:
 *
 *   <img src="/strava-powered.svg" alt="Powered by Strava" height={24} />
 *
 * Strava's brand kit requires the mark be at least 16 px tall and
 * surrounded by a clear-space margin of 1× its height.
 */
function PoweredByStrava() {
  return (
    <a
      href="https://www.strava.com"
      target="_blank"
      rel="noreferrer"
      style={{
        display:        'inline-flex',
        alignItems:     'center',
        gap:            8,
        textDecoration: 'none',
        color:          ink,
      }}
    >
      <span style={{
        display:       'inline-block',
        width:         16,
        height:        16,
        background:    strava,
        borderRadius:  3,
        flexShrink:    0,
        // SVG-equivalent of Strava's chevron mark embedded as a CSS mask.
        // Avoids shipping an external image until the official SVG is
        // dropped in public/.
        maskImage:     `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><path fill='white' d='M11.7 4h5.5l4.9 9.7h-4l-3.7-7.2-3.6 7.2H7l4.7-9.7zm-1 14.7h4l2.6 5 2.6-5h4l-6.6 12.3-6.6-12.3z'/></svg>")`,
        WebkitMaskImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><path fill='white' d='M11.7 4h5.5l4.9 9.7h-4l-3.7-7.2-3.6 7.2H7l4.7-9.7zm-1 14.7h4l2.6 5 2.6-5h4l-6.6 12.3-6.6-12.3z'/></svg>")`,
      }} />
      <span style={{
        fontFamily:    "'Space Grotesk', sans-serif",
        fontSize:      11,
        fontWeight:    600,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
      }}>
        Powered by <span style={{ color: strava }}>Strava</span>
      </span>
    </a>
  );
}

const linkStyle: React.CSSProperties = {
  color:          inkLight,
  textDecoration: 'none',
  fontSize:       12,
};
