'use client';

/**
 * Public login page. Renders two big buttons (Google + Strava) and kicks
 * off the relevant OAuth flow via /api/auth/signin/<provider>.
 *
 * We deliberately don't use `signIn()` from next-auth/react — the import
 * cost (and the dependency on the SessionProvider being mounted) is more
 * than we need for two static buttons. A plain `<a href>` to the signin
 * endpoint is enough; NextAuth handles the rest.
 */

import { tokens } from '@/components/explorer/tokens';

const CARD: React.CSSProperties = {
  background: tokens.surface,
  border:     `1px solid ${tokens.creamBorder}`,
  borderRadius: 4,
  padding:    32,
  maxWidth:   420,
  width:      '100%',
};

const BUTTON: React.CSSProperties = {
  display:        'flex',
  alignItems:     'center',
  justifyContent: 'center',
  gap:            10,
  width:          '100%',
  padding:        '14px 18px',
  border:         `1px solid ${tokens.creamBorder}`,
  borderRadius:   4,
  background:     tokens.cream,
  color:          tokens.ink,
  fontFamily:     "'Space Grotesk'",
  fontSize:       14,
  fontWeight:     600,
  cursor:         'pointer',
  textDecoration: 'none',
  transition:     'background 120ms ease',
};

export default function LoginPage() {
  return (
    <main style={{
      minHeight: '100vh',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24,
      background: tokens.cream,
    }}>
      <div style={CARD}>
        <h1 style={{
          fontFamily: "'Playfair Display'",
          fontSize: 28, fontWeight: 800,
          color: tokens.ink,
          marginBottom: 8,
        }}>
          The Little Explorer
        </h1>
        <p style={{
          fontFamily: "'Space Grotesk'",
          fontSize: 13, color: tokens.inkLight,
          marginBottom: 28,
          lineHeight: 1.5,
        }}>
          Connecte-toi pour retrouver tes sorties Strava, ton calendrier
          d&apos;activités et tes objectifs.
        </p>

        <a href="/api/auth/signin/google" style={BUTTON}>
          <span style={{ fontSize: 16 }}>G</span>
          Continuer avec Google
        </a>

        <div style={{ height: 12 }} />

        <a
          href="/api/auth/signin/strava"
          style={{ ...BUTTON, background: '#FC4C02', color: '#fff', borderColor: '#FC4C02' }}
        >
          <span style={{ fontSize: 16, fontWeight: 800 }}>S</span>
          Continuer avec Strava
        </a>

        <p style={{
          marginTop: 24,
          fontFamily: "'Space Grotesk'",
          fontSize: 11, color: tokens.inkLight,
          lineHeight: 1.5,
        }}>
          En continuant, tu acceptes que nous récupérions tes activités
          Strava via l&apos;API officielle. Aucun mot de passe stocké.
        </p>
      </div>
    </main>
  );
}
