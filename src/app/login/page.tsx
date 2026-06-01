'use client';

/**
 * Public login page — split-screen layout.
 *
 * Desktop (≥768px):
 *   ┌─────────────────────┬──────────────────────┐
 *   │  forest photo       │  signup/login card   │
 *   │  full-bleed left    │  right, fixed width  │
 *   └─────────────────────┴──────────────────────┘
 *
 * Mobile (<768px):
 *   ┌──────────────────────────────────────────────┐
 *   │  forest photo banner (220px tall)            │
 *   ├──────────────────────────────────────────────┤
 *   │  signup/login card                           │
 *   └──────────────────────────────────────────────┘
 *
 * Implementation note: we use plain CSS @media queries via a <style>
 * block instead of the project's useIsMobile() hook. useIsMobile is
 * driven by useState + useEffect, which re-renders on resize — but
 * during the initial paint (SSR + hydration), it returns its default
 * value (false), causing a layout flash. CSS media queries don't have
 * that hydration race, so the split-screen renders correctly at every
 * viewport size from first paint.
 */

import { useEffect, useState } from 'react';
import { signIn, useSession } from 'next-auth/react';
import { tokens } from '@/components/explorer/tokens';

const BUTTON_BASE: React.CSSProperties = {
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
  transition:     'background 120ms ease, transform 120ms ease',
};

const STYLES = `
  .tle-login-root {
    min-height: 100dvh;
    display: flex;
    flex-direction: row;
    background: ${tokens.cream};
  }
  .tle-login-photo {
    flex: 1 1 50%;
    min-width: 0;             /* lets the flex item shrink below intrinsic content size */
    position: relative;
    overflow: hidden;
    /* CSS url() without quotes — React escapes apostrophes inside a
       <style>{...}</style> child string into &#x27; which then breaks
       the URL parse. Unquoted url() avoids the issue entirely. */
    background-image: url(/login-forest.avif);
    background-size: cover;
    background-position: center;
  }
  .tle-login-photo::before {
    content: '';
    position: absolute; inset: 0;
    background: linear-gradient(180deg, rgba(0,0,0,0.25) 0%, rgba(0,0,0,0.55) 100%);
    z-index: 0;
  }
  .tle-login-photo-inner {
    position: relative;
    z-index: 1;
    height: 100%;
    padding: 56px;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    color: #fff;
  }
  .tle-login-photo h1 {
    font-family: 'Playfair Display', serif;
    font-size: 56px;
    font-weight: 800;
    line-height: 1.05;
    margin: 0;
    text-shadow: 0 2px 12px rgba(0,0,0,0.4);
  }
  .tle-login-photo h1 em {
    color: #FFD3A3;
    font-style: italic;
  }
  .tle-login-photo p {
    font-family: 'Space Grotesk', sans-serif;
    font-size: 14px;
    margin: 12px 0 0;
    max-width: 420px;
    line-height: 1.55;
    color: rgba(255,255,255,0.85);
    text-shadow: 0 1px 6px rgba(0,0,0,0.4);
  }
  .tle-login-card-wrap {
    flex: 0 0 480px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 40px;
    background: ${tokens.cream};
  }
  .tle-login-card { width: 100%; max-width: 380px; }

  /* ── Mobile breakpoint ─────────────────────────────────────────── */
  @media (max-width: 767px) {
    .tle-login-root      { flex-direction: column; }
    .tle-login-photo     { flex: 0 0 220px; }
    .tle-login-photo-inner { padding: 28px; }
    .tle-login-photo h1  { font-size: 32px; }
    .tle-login-photo p   { font-size: 12px; }
    .tle-login-card-wrap { flex: 1 1 auto; padding: 32px 24px; }
  }
`;

/**
 * Map raw NextAuth error codes (?error=…) to French explanations.
 * Most failures here are transient (network blip, user denied the
 * authorize prompt, expired state token). The Strava 1-athlete-quota
 * scenario that used to be the dominant case is gone — Strava
 * approved the 10-athlete tier — so the copy now reads as a
 * generic "try again" instead of pointing every user at the dev.
 */
function friendlyAuthError(code: string): string {
  switch (code) {
    case 'OAuthCallback':
    case 'OAuthSignin':
    case 'Callback':
      return "La connexion Strava a échoué. Réessaie dans un instant — si ça persiste, signe en Google et écris à Florian.";
    case 'OAuthAccountNotLinked':
      return "Cet email est déjà lié à un autre compte. Utilise le même fournisseur que la première fois (Google ou Strava).";
    case 'AccessDenied':
      return "Tu as refusé l'autorisation côté Strava — clique à nouveau si c'était par accident.";
    case 'Verification':
      return "Le lien de vérification a expiré. Reconnecte-toi pour en demander un autre.";
    default:
      return `Erreur de connexion : ${code}`;
  }
}

export default function LoginPage() {
  const [error, setError]             = useState<string>('');
  const [busy, setBusy]               = useState<'' | 'google' | 'strava'>('');
  const [callbackUrl, setCallbackUrl] = useState<string>('/');
  const { data: session, status }     = useSession();

  useEffect(() => {
    const url = new URL(window.location.href);
    const err = url.searchParams.get('error');
    if (err) setError(err);
    // Honour the ?callbackUrl=... param so native clients (iOS app
    // opening this page via ASWebAuthenticationSession) can route the
    // user to /auth/native-done after OAuth completes. Hardcoding to
    // '/' was breaking the iOS handoff — the app would land on the
    // web home instead of getting the bearer-token redirect.
    const cb = url.searchParams.get('callbackUrl');
    if (cb && cb.startsWith('/')) setCallbackUrl(cb);
  }, []);

  // If the user is already signed in (Google) and was bounced here
  // by a Strava-OAuth failure mid-link, don't make them sign in again
  // — show a short "you're already in" banner with a Return-to-app
  // button. Prevents the loop where Hélena hits /login + error,
  // clicks Strava again, hits the same 403, lands back on /login.
  const alreadySignedIn = status === 'authenticated' && session?.user;

  const onClick = (provider: 'google' | 'strava') => {
    setBusy(provider);
    setError('');
    signIn(provider, { callbackUrl }).catch(err => {
      setBusy('');
      setError('signIn failed: ' + (err?.message ?? 'unknown'));
    });
  };

  return (
    <>
      {/* Inject the page-scoped CSS once. Scoped via the tle-login-* prefix. */}
      <style>{STYLES}</style>

      <main className="tle-login-root">
        <div className="tle-login-photo">
          <div className="tle-login-photo-inner">
            <h1>
              The Little<br />
              <em>Explorer</em>
            </h1>
            <p>
              Suis tes sorties vélo, course, rando — calendrier d&apos;activités,
              objectifs, et tout l&apos;historique Strava au même endroit.
            </p>
          </div>
        </div>

        <div className="tle-login-card-wrap">
          <div className="tle-login-card">
            <p style={{
              fontFamily:    "'Space Grotesk'",
              fontSize:      11,
              fontWeight:    700,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color:         tokens.terra,
              margin:        '0 0 8px',
            }}>
              § BIENVENUE
            </p>
            <h2 style={{
              fontFamily: "'Playfair Display'",
              fontSize:   28,
              fontWeight: 800,
              color:      tokens.ink,
              margin:     '0 0 8px',
              lineHeight: 1.15,
            }}>
              Connecte-toi.
            </h2>
            <p style={{
              fontFamily: "'Space Grotesk'",
              fontSize:   13,
              color:      tokens.inkLight,
              margin:     '0 0 8px',
              lineHeight: 1.55,
            }}>
              Retrouve tes sorties Strava, ton calendrier et tes objectifs.
            </p>
            <p style={{
              fontFamily: "'Space Grotesk'",
              fontSize:   11,
              color:      tokens.inkLight,
              margin:     '0 0 16px',
              lineHeight: 1.55,
              fontStyle:  'italic',
            }}>
              Première fois ici ? Clique l&apos;un des boutons ci-dessous —
              ton compte sera créé automatiquement.
            </p>

            {/* Strava quota notice removed — Strava granted the
                10-athlete tier (2026-06). Re-add a banner if we ever
                approach the cap or if Strava revokes it. */}

            {error && (
              <div style={{
                padding:      '10px 12px',
                marginBottom: 16,
                background:   '#FEE',
                border:       '1px solid #FCC',
                borderRadius: 4,
                fontFamily:   "'Space Grotesk'",
                fontSize:     12,
                color:        '#A00',
                lineHeight:   1.5,
              }}>
                {friendlyAuthError(error)}
                {/* Raw NextAuth code in a small caption so Florian can
                    paste it in a debug message — and so the friendly
                    text isn't the only signal during the active hunt
                    for the Strava-callback failure. */}
                <div style={{ marginTop: 6, fontSize: 10, fontWeight: 600, opacity: 0.75 }}>
                  code : <code>{error}</code>
                </div>
              </div>
            )}

            {alreadySignedIn ? (
              // User got bounced here mid-flow (typically: signed in
              // via Google, tried to *link* Strava from /onboarding,
              // Strava rejected → NextAuth dropped them on /login).
              // Don't pretend they're logged out — give them a way
              // back into the app instead.
              <div style={{
                padding: '14px 12px',
                marginBottom: 12,
                background: '#EFF7EE',
                border: '1px solid #CDE5C9',
                borderRadius: 4,
                fontFamily: "'Space Grotesk'",
                fontSize: 12,
                color: '#2E5C2A',
                lineHeight: 1.55,
              }}>
                Tu es déjà connecté(e) en tant que{' '}
                <strong>{session?.user?.name ?? session?.user?.email ?? 'utilisateur'}</strong>.
                Pas besoin de se reconnecter — Strava sera activé dès que possible.
                <a
                  href="/"
                  style={{
                    display: 'inline-block',
                    marginTop: 10,
                    padding: '8px 14px',
                    background: tokens.terra,
                    color: '#fff',
                    fontWeight: 700,
                    fontSize: 12,
                    textDecoration: 'none',
                    borderRadius: 3,
                  }}
                >
                  Retour à l&apos;app →
                </a>
              </div>
            ) : null}

            <button type="button" onClick={() => onClick('google')} disabled={busy !== ''} style={BUTTON_BASE}>
              <span style={{ fontSize: 16, fontWeight: 800 }}>G</span>
              {busy === 'google' ? 'Connexion…' : 'Continuer avec Google'}
            </button>

            <div style={{ height: 12 }} />

            <button
              type="button"
              onClick={() => onClick('strava')}
              disabled={busy !== ''}
              style={{ ...BUTTON_BASE, background: '#FC4C02', color: '#fff', borderColor: '#FC4C02' }}
            >
              <span style={{ fontSize: 16, fontWeight: 800 }}>S</span>
              {busy === 'strava' ? 'Connexion…' : 'Continuer avec Strava'}
            </button>

            <p style={{
              marginTop:  24,
              fontFamily: "'Space Grotesk'",
              fontSize:   11,
              color:      tokens.inkLight,
              lineHeight: 1.55,
            }}>
              En continuant, tu acceptes que nous récupérions tes activités
              Strava via l&apos;API officielle. Aucun mot de passe stocké.
              {' '}
              <a href="/privacy" style={{ color: tokens.terra, textDecoration: 'underline' }}>
                Politique de confidentialité
              </a>.
            </p>
          </div>
        </div>
      </main>
    </>
  );
}
