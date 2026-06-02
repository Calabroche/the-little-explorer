'use client';

/**
 * /onboarding — welcome + 3-step new-user flow.
 *
 *   Step 0: Welcome
 *     Greets the user by name, sketches what the app does in a few
 *     bullets, and links to the full /guide. Shown to every first-time
 *     user before any data is collected (the request was "show the guide
 *     first to welcome them and tell them what they can do"). "Commencer"
 *     fires `onboarding_step_welcome_done` and advances to Step 1.
 *
 *   Step 1: Sport
 *     "Quel sport tu pratiques le plus ?" → vélo / course / les deux
 *     Captured as `preferred_sport` in the onboarding event payload (no
 *     dedicated user column yet — we may add one later if it drives
 *     real UI behaviour).
 *
 *   Step 2: Physical profile
 *     Weight (rider_kg) + bike weight + optional FTP — same fields as
 *     /settings, just gated to "fill them in once before you can use
 *     the app properly". Saved via PATCH /api/me, then the step event
 *     fires.
 *
 *   Step 3: Connect Strava
 *     Strava OAuth button (signIn provider=strava) OR "Skip pour
 *     l'instant". Either choice flips onboarded_at = now() and
 *     redirects the user to /.
 *
 * Every transition logs an event (`onboarding_step_*`) so the
 * /admin/metrics dashboard can show drop-off between steps.
 *
 * Middleware redirects authed users with onboarded_at = NULL here. To
 * unblock the page itself, the middleware whitelists /onboarding.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { signIn, useSession } from 'next-auth/react';
import { tokens } from '@/components/explorer/tokens';

type Sport = 'cycling' | 'running' | 'both';

interface MeResponse {
  id:         string;
  email:      string | null;
  name:       string | null;
  athleteId:  number | null;
  effective:  { riderKg: number; bikeKg: number; customFtp: number | null };
}

export default function OnboardingPage() {
  const router  = useRouter();
  // `update` triggers NextAuth to re-issue the JWT cookie with the
  // freshly-read onboarded_at — without it the middleware sees the
  // pre-onboarding token and bounces back to /onboarding even after
  // markComplete writes the DB. Without this fix, a user has to
  // refresh / re-attempt several times before the redirect takes;
  // 52c8bead-…-c7e4 reported filling out the flow 3 times.
  const { update: refreshSession } = useSession();
  // Step 0 is the welcome screen (greeting + "what you can do" + link to
  // the full guide). Steps 1-3 are the original data-collection flow.
  const [step,        setStep]        = useState<0 | 1 | 2 | 3>(0);
  const [me,          setMe]          = useState<MeResponse | null>(null);
  const [sport,       setSport]       = useState<Sport | null>(null);
  const [riderKg,     setRiderKg]     = useState<string>('');
  const [bikeKg,      setBikeKg]      = useState<string>('');
  const [ftp,         setFtp]         = useState<string>('');
  const [saving,      setSaving]      = useState(false);
  const [error,       setError]       = useState<string | null>(null);

  // Initial load + onboarding_started event (fired once when the page
  // mounts — used by the funnel chart as step 0).
  useEffect(() => {
    void fireEvent('onboarding_started');
    fetch('/api/me')
      .then(r => r.ok ? r.json() as Promise<MeResponse> : null)
      .then(d => {
        if (!d) return;
        setMe(d);
        // Pre-fill from existing effective values so the user sees the
        // defaults rather than empty inputs.
        setRiderKg(String(d.effective.riderKg));
        setBikeKg(String(d.effective.bikeKg));
        setFtp(d.effective.customFtp != null ? String(d.effective.customFtp) : '');
      })
      .catch(() => {});
  }, []);

  const fireEvent = async (event: string, props?: Record<string, unknown>) => {
    try {
      await fetch('/api/me/onboarding', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ op: 'event', event, props }),
      });
    } catch { /* best-effort */ }
  };

  const goStep1 = async () => {
    await fireEvent('onboarding_step_welcome_done');
    setStep(1);
  };

  const goStep2 = async () => {
    if (!sport) return;
    await fireEvent('onboarding_step_sport_done', { sport });
    setStep(2);
  };

  const goStep3 = async () => {
    setSaving(true);
    setError(null);
    try {
      const patch: Record<string, number | null> = {};
      const r = parseFloat(riderKg.replace(',', '.'));
      const b = parseFloat(bikeKg.replace(',', '.'));
      const f = parseInt(ftp, 10);
      if (Number.isFinite(r)) patch.rider_kg = r;
      if (Number.isFinite(b)) patch.bike_kg  = b;
      if (Number.isFinite(f)) patch.custom_ftp = f;
      const resp = await fetch('/api/me', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(patch),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({})) as { error?: string; message?: string };
        throw new Error(err.message ?? err.error ?? `HTTP ${resp.status}`);
      }
      await fireEvent('onboarding_step_profile_done', { rider_kg: r, bike_kg: b, custom_ftp: Number.isFinite(f) ? f : null });
      setStep(3);
    } catch (e) {
      setError((e as Error).message ?? 'Erreur inconnue');
    } finally {
      setSaving(false);
    }
  };

  const connectStrava = async () => {
    await fireEvent('onboarding_step_strava_connected', { sport });
    await markComplete();
    // Use the custom link-account endpoint instead of NextAuth's
    // signIn — the user is already authed here (Google), so we want
    // to ATTACH Strava credentials to the existing account, not
    // create a parallel "strava-only" user that NextAuth would
    // otherwise spawn (and then fail to link).
    window.location.href = '/api/connect/strava/start';
  };

  const skipStrava = async () => {
    setSaving(true);
    await fireEvent('onboarding_step_strava_skipped', { sport });
    await markComplete();
    router.push('/');
  };

  const markComplete = async () => {
    try {
      const r = await fetch('/api/me/onboarding', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ op: 'complete', props: { sport } }),
      });
      if (!r.ok) {
        // Don't swallow the failure silently — the rider would
        // otherwise be looped back to /onboarding indefinitely on
        // next nav, with no clue why. We just log; the caller still
        // proceeds to redirect, and the middleware will catch the
        // missing onboarded_at and bring them back here so they can
        // retry the final click.
        console.error('[onboarding] markComplete returned non-OK:', r.status);
      }
    } catch (err) {
      console.error('[onboarding] markComplete threw:', err);
    }
    // Critical: force NextAuth to hit /api/auth/session, which re-runs
    // the jwt callback (which reads the FRESH onboarded_at + writes
    // a new JWT cookie). Without this, the middleware on the next
    // request reads the stale cookie and redirects right back here.
    // The user who reported having to fill the flow 3 times was
    // racing this exact gap — eventually the cookie naturally
    // refreshed and the gate opened.
    await refreshSession();
  };

  return (
    // `body { overflow: hidden }` in globals.css clamps the page —
    // <main> owns its own scroll context so the 4-step onboarding
    // flow can grow past one viewport.
    <main style={{
      height:     '100dvh',
      overflowY:  'auto',
      background: tokens.cream,
      padding:    '40px 24px 80px',
      fontFamily: "'Space Grotesk', sans-serif",
    }}>
      <div style={{
        maxWidth:     520,
        margin:       '0 auto',
        background:   tokens.surface,
        border:       `1px solid ${tokens.creamBorder}`,
        borderRadius: 4,
        padding:      '40px 36px',
      }}>
        {step >= 1 && <StepIndicator current={step as 1 | 2 | 3} />}

        {error && (
          <div style={{
            padding: '10px 12px', marginBottom: 16,
            background: '#FEE', border: '1px solid #FCC', borderRadius: 4,
            color: '#A00', fontSize: 12,
          }}>{error}</div>
        )}

        {step === 0 && (
          <Step0
            userName={me?.name ?? null}
            onNext={goStep1}
          />
        )}
        {step === 1 && (
          <Step1
            sport={sport}
            onChange={setSport}
            onNext={goStep2}
            userName={me?.name ?? null}
          />
        )}
        {step === 2 && (
          <Step2
            riderKg={riderKg}    setRiderKg={setRiderKg}
            bikeKg={bikeKg}      setBikeKg={setBikeKg}
            ftp={ftp}            setFtp={setFtp}
            onNext={goStep3}
            saving={saving}
          />
        )}
        {step === 3 && (
          <Step3
            onConnect={connectStrava}
            onSkip={skipStrava}
            saving={saving}
          />
        )}
      </div>
    </main>
  );
}

// ── Step 0: welcome ──────────────────────────────────────────────────────
// First thing a brand-new user sees. Greets them, sketches what the app
// does in a few bullets, and points to the full /guide — without burying
// them in it. "Commencer" drops them into the 3-step data flow.
function Step0({ userName, onNext }: {
  userName: string | null;
  onNext: () => void;
}) {
  const HIGHLIGHTS: { icon: string; text: string }[] = [
    { icon: '◎', text: 'Toutes tes sorties Strava synchronisées : récap, graphes annuels et cartes.' },
    { icon: '✦', text: 'Un planificateur d\'itinéraires + plans d\'entraînement calibrés sur ta FTP.' },
    { icon: '⚡', text: 'Suivi de ta FTP, de ta charge (TSS) et de ta forme dans le temps.' },
    { icon: '⚙', text: 'Carnet d\'entretien de ton matériel et suivi des pièces d\'usure.' },
    { icon: '◎', text: 'Apple Watch : enregistre tes rides en GPS standalone, guidage vocal inclus.' },
  ];
  return (
    <>
      <Title small="§ BIENVENUE" big="Bienvenue" italic={userName ? userName.split(' ')[0] : 'à bord'} />
      <p style={blurb}>
        The Little Explorer rassemble tout ton suivi sportif au même endroit.
        Voici un aperçu de ce que tu peux faire :
      </p>
      <div style={{ display: 'grid', gap: 12, marginTop: 18 }}>
        {HIGHLIGHTS.map((h, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <span style={{ color: tokens.terra, fontSize: 16, lineHeight: '20px', flexShrink: 0 }}>{h.icon}</span>
            <span style={{ fontSize: 13, color: tokens.inkMid, lineHeight: 1.5 }}>{h.text}</span>
          </div>
        ))}
      </div>
      <a
        href="/guide"
        style={{
          display: 'block', textAlign: 'center', marginTop: 18,
          fontSize: 12, fontWeight: 600, color: tokens.terra,
          textDecoration: 'none', letterSpacing: '0.02em',
        }}
      >
        📖 Voir le guide complet
      </a>
      <PrimaryButton onClick={onNext} disabled={false} label="COMMENCER" />
    </>
  );
}

// ── Step 1: sport ────────────────────────────────────────────────────────
function Step1({ sport, onChange, onNext, userName }: {
  sport: Sport | null;
  onChange: (s: Sport) => void;
  onNext: () => void;
  userName: string | null;
}) {
  // userName retained for symmetry with the other steps; the greeting
  // now lives on the welcome screen (Step 0).
  void userName;
  return (
    <>
      <Title small="§ ONBOARDING — 1/3" big="Ton sport" italic="le principal" />
      <p style={blurb}>Pour t&apos;afficher les bonnes métriques, dis-moi ce que tu pratiques le plus.</p>
      <div style={{ display: 'grid', gap: 10, marginTop: 18 }}>
        {([
          { v: 'cycling', label: 'Vélo',    icon: '🚴' },
          { v: 'running', label: 'Course',  icon: '🏃' },
          { v: 'both',    label: 'Les deux', icon: '🚴🏃' },
        ] as const).map(opt => {
          const active = sport === opt.v;
          return (
            <button
              key={opt.v}
              onClick={() => onChange(opt.v)}
              style={{
                padding: '14px 16px',
                background:   active ? tokens.terra : tokens.cream,
                border:       `1px solid ${active ? tokens.terra : tokens.creamBorder}`,
                color:        active ? '#fff' : tokens.ink,
                borderRadius: 3,
                display:      'flex', alignItems: 'center', gap: 12,
                cursor:       'pointer',
                fontFamily:   "'Space Grotesk'", fontWeight: 600, fontSize: 14,
              }}
            >
              <span style={{ fontSize: 20 }}>{opt.icon}</span>
              {opt.label}
            </button>
          );
        })}
      </div>
      <PrimaryButton onClick={onNext} disabled={!sport} label="CONTINUER" />
    </>
  );
}

// ── Step 2: physical profile ─────────────────────────────────────────────
function Step2({ riderKg, setRiderKg, bikeKg, setBikeKg, ftp, setFtp, onNext, saving }: {
  riderKg: string; setRiderKg: (v: string) => void;
  bikeKg:  string; setBikeKg:  (v: string) => void;
  ftp:     string; setFtp:     (v: string) => void;
  onNext: () => void;
  saving: boolean;
}) {
  return (
    <>
      <Title small="§ ONBOARDING — 2/3" big="Tes mesures" italic="2 minutes" />
      <p style={blurb}>Ton poids sert à estimer ta puissance et ton TSS. Tu peux changer ces valeurs plus tard dans Paramètres.</p>
      <div style={{ display: 'grid', gap: 14, marginTop: 18 }}>
        <Field label="Ton poids (kg)" value={riderKg} onChange={setRiderKg} placeholder="ex. 66" />
        <Field label="Poids de ton vélo (kg)" value={bikeKg} onChange={setBikeKg} placeholder="ex. 8.2" />
        <Field label="FTP (W) — optionnel" value={ftp} onChange={setFtp} placeholder="auto-dérivée si vide" />
      </div>
      <PrimaryButton onClick={onNext} disabled={saving || !riderKg.trim()} label={saving ? 'ENREGISTREMENT…' : 'CONTINUER'} />
    </>
  );
}

// ── Step 3: Strava ───────────────────────────────────────────────────────
function Step3({ onConnect, onSkip, saving }: {
  onConnect: () => void;
  onSkip:    () => void;
  saving:    boolean;
}) {
  return (
    <>
      <Title small="§ ONBOARDING — 3/3" big="Connecte Strava" italic="ou skip" />
      <p style={blurb}>
        Importer ton historique Strava te donne accès à tes records, ta FTP estimée
        et le calendrier rempli en un clic. Tu peux le faire plus tard depuis tes
        paramètres.
      </p>
      <div style={{ display: 'grid', gap: 10, marginTop: 18 }}>
        <button
          onClick={onConnect}
          disabled={saving}
          style={{
            padding:      '14px 16px',
            background:   '#FC5200',    // Strava orange
            color:        '#fff',
            border:       '1px solid #FC5200',
            borderRadius: 3,
            cursor:       'pointer',
            fontFamily:   "'Space Grotesk'", fontWeight: 700, fontSize: 14,
            letterSpacing: '0.04em',
          }}
        >
          CONNECTER STRAVA
        </button>
        <button
          onClick={onSkip}
          disabled={saving}
          style={{
            padding:      '12px 16px',
            background:   'transparent',
            color:        tokens.inkMid,
            border:       `1px solid ${tokens.creamBorder}`,
            borderRadius: 3,
            cursor:       'pointer',
            fontFamily:   "'Space Grotesk'", fontWeight: 600, fontSize: 12,
            letterSpacing: '0.04em',
          }}
        >
          {saving ? 'CHARGEMENT…' : 'PLUS TARD'}
        </button>
      </div>
    </>
  );
}

// ── UI helpers ───────────────────────────────────────────────────────────
function StepIndicator({ current }: { current: 1 | 2 | 3 }) {
  return (
    <div style={{ display: 'flex', gap: 4, marginBottom: 24 }}>
      {[1, 2, 3].map(n => (
        <div
          key={n}
          style={{
            flex:         1,
            height:       3,
            background:   n <= current ? tokens.terra : tokens.creamBorder,
            borderRadius: 2,
            transition:   'background 240ms ease',
          }}
        />
      ))}
    </div>
  );
}

function Title({ small, big, italic }: { small: string; big: string; italic: string }) {
  return (
    <>
      <p style={{
        fontSize: 10, fontWeight: 700, letterSpacing: '0.12em',
        textTransform: 'uppercase', color: tokens.terra, margin: '0 0 8px',
      }}>{small}</p>
      <h1 style={{
        fontFamily: "'Playfair Display', serif",
        fontSize: 32, fontWeight: 800, color: tokens.ink, margin: '0 0 4px', lineHeight: 1.15,
      }}>
        {big} <span style={{ fontStyle: 'italic', fontWeight: 700 }}>{italic}</span>.
      </h1>
    </>
  );
}

function Field({ label, value, onChange, placeholder }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <label style={{ display: 'block' }}>
      <span style={{
        display: 'block', marginBottom: 4,
        fontSize: 11, fontWeight: 700, letterSpacing: '0.06em',
        textTransform: 'uppercase', color: tokens.inkLight,
      }}>{label}</span>
      <input
        type="number"
        step="0.1"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          width: '100%',
          padding: '10px 12px',
          background: tokens.cream,
          border: `1px solid ${tokens.creamBorder}`,
          borderRadius: 3,
          fontSize: 14, color: tokens.ink, fontFamily: 'monospace',
          boxSizing: 'border-box',
        }}
      />
    </label>
  );
}

function PrimaryButton({ onClick, disabled, label }: { onClick: () => void; disabled: boolean; label: string }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        marginTop:    24,
        padding:      '14px 16px',
        background:   disabled ? tokens.creamBorder : tokens.terra,
        color:        '#fff',
        border:       `1px solid ${disabled ? tokens.creamBorder : tokens.terra}`,
        borderRadius: 3,
        cursor:       disabled ? 'not-allowed' : 'pointer',
        fontFamily:   "'Space Grotesk'", fontWeight: 700, fontSize: 13,
        letterSpacing: '0.06em',
        width:        '100%',
      }}
    >
      {label}
    </button>
  );
}

const blurb: React.CSSProperties = {
  marginTop: 8, fontSize: 13, color: tokens.inkMid, lineHeight: 1.55,
};
