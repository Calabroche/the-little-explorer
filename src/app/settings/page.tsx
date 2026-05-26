'use client';

/**
 * /settings — per-user training profile editor.
 *
 * Three fields the signed-in user can override:
 *   - rider_kg    (body weight)
 *   - bike_kg     (bike weight)
 *   - custom_ftp  (overrides the auto-derived FTP from best 20-min power)
 *
 * Leaving a field blank reverts to the default (legacy hardcoded
 * profile for Florian + Helena, or the global default 70kg/9kg for
 * everyone else). The Effective box always shows the value that will
 * actually be used by /api/activities after save.
 *
 * Auth-gated by middleware (no extra check needed here — unauthed
 * users never reach this page).
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { signOut } from 'next-auth/react';
import { tokens } from '@/components/explorer/tokens';
import { Footer } from '@/components/Footer';

interface MeResponse {
  id:        string;
  email:     string | null;
  name:      string | null;
  athleteId: number | null;
  settings: {
    rider_kg:   number | null;
    bike_kg:    number | null;
    custom_ftp: number | null;
  };
  effective: {
    riderKg:   number;
    bikeKg:    number;
    customFtp: number | null;
  };
}

const CARD: React.CSSProperties = {
  background:   tokens.surface,
  border:       `1px solid ${tokens.creamBorder}`,
  borderRadius: 4,
  padding:      24,
  maxWidth:     560,
  margin:       '0 auto',
};

const ROW: React.CSSProperties = {
  display:      'grid',
  gridTemplateColumns: '160px 1fr',
  alignItems:   'center',
  gap:          12,
  marginBottom: 14,
};

const LABEL: React.CSSProperties = {
  fontFamily:    "'Space Grotesk'",
  fontSize:      11,
  fontWeight:    700,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color:         tokens.inkLight,
};

const INPUT: React.CSSProperties = {
  padding:      '8px 10px',
  background:   tokens.cream,
  border:       `1px solid ${tokens.creamBorder}`,
  borderRadius: 3,
  fontFamily:   'monospace',
  fontSize:     13,
  color:        tokens.ink,
  width:        '100%',
  boxSizing:    'border-box',
};

const BUTTON: React.CSSProperties = {
  padding:      '10px 18px',
  background:   tokens.terra,
  border:       `1px solid ${tokens.terra}`,
  borderRadius: 3,
  color:        '#fff',
  fontFamily:   "'Space Grotesk'", fontSize: 12, fontWeight: 700,
  letterSpacing: '0.04em',
  cursor:       'pointer',
};

function toInput(n: number | null): string {
  return n === null ? '' : String(n);
}
function parseInput(s: string): number | null {
  const t = s.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

export default function SettingsPage() {
  const [me,       setMe]       = useState<MeResponse | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);
  const [saving,   setSaving]   = useState(false);
  const [saved,    setSaved]    = useState(false);

  // Form state — strings so the user can type freely (including empty).
  const [name,      setName]      = useState('');
  const [riderKg,   setRiderKg]   = useState('');
  const [bikeKg,    setBikeKg]    = useState('');
  const [customFtp, setCustomFtp] = useState('');

  // "Exporter mes données" + "Déconnecter Strava" — RGPD art. 20
  // (portability) and granular control over the Strava link.
  const [exporting,    setExporting]    = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [profileError, setProfileError]   = useState<string | null>(null);

  // "Supprimer mon compte" — two-step confirm so a misclick doesn't
  // wipe months of training history. First tap arms; second tap
  // (within the same render) actually fires DELETE /api/me.
  const [deleteArmed,  setDeleteArmed]  = useState(false);
  const [deleting,     setDeleting]     = useState(false);
  const [deleteError,  setDeleteError]  = useState<string | null>(null);

  // "Déconnexion de tous les appareils" — bumps session_invalidated_at
  // on the user row (kills every web JWT) + revokes every iOS bearer
  // token. Less destructive than delete-account; useful when a device
  // was lost or shared with someone who shouldn't have access.
  const [logoutAllRunning, setLogoutAllRunning] = useState(false);
  const [logoutAllError,   setLogoutAllError]   = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/me')
      .then(async r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<MeResponse>;
      })
      .then(d => {
        setMe(d);
        setName(d.name ?? '');
        setRiderKg(toInput(d.settings.rider_kg));
        setBikeKg(toInput(d.settings.bike_kg));
        setCustomFtp(toInput(d.settings.custom_ftp));
      })
      .catch(e => setError(e.message ?? 'Erreur inconnue'))
      .finally(() => setLoading(false));
  }, []);

  const onSave = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);

    // Build patch — empty string means "clear override" → null.
    // NaN means "user typed garbage" → bail with error.
    const patch: Record<string, number | string | null> = {};
    for (const [k, v] of [
      ['rider_kg',   riderKg],
      ['bike_kg',    bikeKg],
      ['custom_ftp', customFtp],
    ] as const) {
      const parsed = parseInput(v);
      if (Number.isNaN(parsed)) {
        setError(`Valeur invalide pour ${k}`);
        setSaving(false);
        return;
      }
      patch[k] = parsed;
    }
    // Display name — trim + send. Empty → clears the override on the
    // server, falling back to the OAuth-provided name.
    const nameTrim = name.trim();
    patch.name = nameTrim.length === 0 ? null : nameTrim;

    try {
      const r = await fetch('/api/me', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(patch),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({})) as { error?: string; message?: string };
        throw new Error(err.message ?? err.error ?? `HTTP ${r.status}`);
      }
      const fresh = await r.json() as MeResponse;
      setMe(fresh);
      setName(fresh.name ?? '');
      setRiderKg(toInput(fresh.settings.rider_kg));
      setBikeKg(toInput(fresh.settings.bike_kg));
      setCustomFtp(toInput(fresh.settings.custom_ftp));
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError((e as Error).message ?? 'Erreur inconnue');
    } finally {
      setSaving(false);
    }
  };

  const onExport = async () => {
    setExporting(true);
    setProfileError(null);
    try {
      const r = await fetch('/api/me/export');
      if (!r.ok) {
        const err = await r.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? `HTTP ${r.status}`);
      }
      // Stream the body as a Blob and trigger a download. We don't
      // use the server-set Content-Disposition because <a download>
      // is more reliable cross-browser than relying on the response
      // headers when the request was kicked off via fetch().
      const blob = await r.blob();
      const today = new Date().toISOString().slice(0, 10);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `the-little-explorer-export-${today}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      setProfileError(`Export échoué : ${(e as Error).message}`);
    } finally {
      setExporting(false);
    }
  };

  const onDisconnectStrava = async () => {
    setDisconnecting(true);
    setProfileError(null);
    try {
      const r = await fetch('/api/me/disconnect-strava', { method: 'POST' });
      if (!r.ok) {
        const err = await r.json().catch(() => ({})) as { error?: string; detail?: string };
        throw new Error(err.detail ?? err.error ?? `HTTP ${r.status}`);
      }
      // Reload the page so the session refreshes (athleteId is now
      // null in the JWT on the next request) and any Strava-gated UI
      // re-renders accordingly. Simpler than threading invalidation
      // through every component.
      window.location.reload();
    } catch (e) {
      setProfileError(`Déconnexion Strava échouée : ${(e as Error).message}`);
      setDisconnecting(false);
    }
  };

  const onLogoutAll = async () => {
    setLogoutAllRunning(true);
    setLogoutAllError(null);
    try {
      const r = await fetch('/api/me/logout-all', { method: 'POST' });
      if (r.status !== 204 && !r.ok) {
        const err = await r.json().catch(() => ({})) as { error?: string; detail?: string };
        throw new Error(err.detail ?? err.error ?? `HTTP ${r.status}`);
      }
      // Current cookie is now invalid server-side — bounce to /login.
      await signOut({ callbackUrl: '/login' });
    } catch (e) {
      setLogoutAllError((e as Error).message ?? 'Erreur inconnue');
      setLogoutAllRunning(false);
    }
  };

  const onDelete = async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      const r = await fetch('/api/me', { method: 'DELETE' });
      // 204 No Content on success — Strava deauth is best-effort
      // server-side, so even a 5xx on Strava's end doesn't surface
      // here as long as the local wipe succeeded.
      if (r.status !== 204 && !r.ok) {
        const err = await r.json().catch(() => ({})) as { error?: string; detail?: string };
        throw new Error(err.detail ?? err.error ?? `HTTP ${r.status}`);
      }
      // Clear the NextAuth cookie + bounce to /login. callbackUrl
      // ensures we land on the public login page (not back here, which
      // would 401 → redirect-loop).
      await signOut({ callbackUrl: '/login' });
    } catch (e) {
      setDeleteError((e as Error).message ?? 'Erreur inconnue');
      setDeleting(false);
      setDeleteArmed(false);
    }
  };

  return (
    <>
    <main style={{ minHeight: '100vh', padding: '40px 24px', background: tokens.cream }}>
      <div style={{ maxWidth: 560, margin: '0 auto 16px', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <h1 style={{
          fontFamily: "'Playfair Display'", fontSize: 28, fontWeight: 800,
          color: tokens.ink, margin: 0,
        }}>
          Paramètres
        </h1>
        <Link href="/" style={{
          padding: '6px 14px',
          background: tokens.surface,
          border: `1px solid ${tokens.creamBorder}`,
          borderRadius: 3,
          color: tokens.inkMid,
          fontFamily: "'Space Grotesk'", fontSize: 11, fontWeight: 600,
          letterSpacing: '0.04em',
          textDecoration: 'none',
        }}>
          ← APP
        </Link>
      </div>

      <div style={CARD}>
        {loading && (
          <p style={{ fontFamily: "'Space Grotesk'", color: tokens.inkLight }}>Chargement…</p>
        )}

        {error && (
          <div style={{
            padding: '10px 12px', marginBottom: 16,
            background: '#FEE', border: '1px solid #FCC', borderRadius: 4,
            color: '#A00', fontFamily: "'Space Grotesk'", fontSize: 12,
          }}>{error}</div>
        )}

        {!loading && me && (
          <>
            <p style={{
              fontFamily: "'Space Grotesk'", fontSize: 13, color: tokens.inkLight,
              marginTop: 0, marginBottom: 24, lineHeight: 1.55,
            }}>
              Tes paramètres d&apos;entraînement. Laisse vide pour utiliser
              les valeurs par défaut (70 kg coureur, 9 kg vélo). Les power
              metrics (TSS, W/kg, IF) sont recalculés à partir de ces
              valeurs sur chaque chargement du feed.
            </p>

            <div style={ROW}>
              <label style={LABEL} htmlFor="name">Nom affiché</label>
              <input id="name" type="text" maxLength={64}
                value={name} onChange={e => setName(e.target.value)}
                placeholder={me.name ?? 'auto'}
                style={INPUT} />
            </div>

            <div style={ROW}>
              <label style={LABEL} htmlFor="rider_kg">Poids du coureur (kg)</label>
              <input id="rider_kg" type="number" step="0.1" min="30" max="200"
                value={riderKg} onChange={e => setRiderKg(e.target.value)}
                placeholder={`défaut : ${me.effective.riderKg}`}
                style={INPUT} />
            </div>

            <div style={ROW}>
              <label style={LABEL} htmlFor="bike_kg">Poids du vélo (kg)</label>
              <input id="bike_kg" type="number" step="0.1" min="3" max="30"
                value={bikeKg} onChange={e => setBikeKg(e.target.value)}
                placeholder={`défaut : ${me.effective.bikeKg}`}
                style={INPUT} />
            </div>

            <div style={ROW}>
              <label style={LABEL} htmlFor="custom_ftp">FTP custom (W)</label>
              <input id="custom_ftp" type="number" step="1" min="50" max="600"
                value={customFtp} onChange={e => setCustomFtp(e.target.value)}
                placeholder="auto-dérivée si vide"
                style={INPUT} />
            </div>

            <p style={{
              fontFamily: "'Space Grotesk'", fontSize: 11, color: tokens.inkLight,
              marginTop: 14, marginBottom: 18, lineHeight: 1.5,
            }}>
              FTP par défaut = best 20 min de puissance × 0.95 (formule
              Coggan). Mets une valeur ici pour la verrouiller (utile
              si ta FTP a baissé après une coupure et que les bests
              anciens sont plus représentatifs).
            </p>

            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <button onClick={onSave} disabled={saving} style={BUTTON}>
                {saving ? 'ENREGISTREMENT…' : 'ENREGISTRER'}
              </button>
              {saved && (
                <span style={{
                  fontFamily: "'Space Grotesk'", fontSize: 12, color: tokens.green,
                  fontWeight: 600,
                }}>✓ Enregistré</span>
              )}
            </div>

            <hr style={{ margin: '28px 0', border: 'none', borderTop: `1px solid ${tokens.creamBorder}` }} />

            <div style={{ fontFamily: "'Space Grotesk'", fontSize: 11, color: tokens.inkLight, lineHeight: 1.6 }}>
              <div><strong style={{ color: tokens.inkMid }}>Effectif actuel :</strong></div>
              <div>· Coureur {me.effective.riderKg} kg · Vélo {me.effective.bikeKg} kg · Masse totale {(me.effective.riderKg + me.effective.bikeKg).toFixed(2)} kg</div>
              <div>· FTP {me.effective.customFtp ?? 'auto'}</div>
            </div>

            {/* RGPD art. 20 portability + granular Strava control.
                Both are low-friction (no two-step) — Export is a
                read-only download, Disconnect Strava is reversible
                (the user can re-link by signing in with Strava). */}
            <hr style={{ margin: '32px 0 20px', border: 'none', borderTop: `1px solid ${tokens.creamBorder}` }} />
            <div style={{
              padding:      14,
              border:       `1px solid ${tokens.creamBorder}`,
              background:   tokens.surface,
              borderRadius: 4,
              marginBottom: 16,
            }}>
              <div style={{
                fontFamily: "'Playfair Display'", fontSize: 14, fontWeight: 700,
                color: tokens.ink, marginBottom: 4,
              }}>
                Mes données
              </div>
              <p style={{
                fontFamily: "'Space Grotesk'", fontSize: 12, color: tokens.inkMid,
                lineHeight: 1.55, margin: '0 0 12px',
              }}>
                Télécharge un fichier JSON contenant ton profil, tes
                paramètres et toutes tes activités (RGPD art. 20).
                Format <code>tle-export-v1</code>.
              </p>
              {profileError && (
                <div style={{
                  padding: '8px 10px', marginBottom: 10,
                  background: '#FEE', border: '1px solid #FCC', borderRadius: 4,
                  color: '#A00', fontFamily: "'Space Grotesk'", fontSize: 12,
                }}>{profileError}</div>
              )}
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button
                  onClick={onExport}
                  disabled={exporting}
                  style={{
                    padding: '8px 14px',
                    background: tokens.terra,
                    border: `1px solid ${tokens.terra}`,
                    borderRadius: 3,
                    color: '#fff',
                    fontFamily: "'Space Grotesk'", fontSize: 11, fontWeight: 700,
                    letterSpacing: '0.04em',
                    cursor: 'pointer',
                  }}
                >
                  {exporting ? 'EXPORT…' : 'EXPORTER MES DONNÉES'}
                </button>
                {me.athleteId && (
                  <button
                    onClick={onDisconnectStrava}
                    disabled={disconnecting}
                    style={{
                      padding: '8px 14px',
                      background: 'transparent',
                      border: `1px solid ${tokens.creamBorder}`,
                      borderRadius: 3,
                      color: tokens.inkMid,
                      fontFamily: "'Space Grotesk'", fontSize: 11, fontWeight: 700,
                      letterSpacing: '0.04em',
                      cursor: 'pointer',
                    }}
                  >
                    {disconnecting ? 'DÉCONNEXION…' : 'DÉCONNECTER STRAVA'}
                  </button>
                )}
              </div>
            </div>
            <div style={{
              padding:      14,
              border:       `1px solid ${tokens.creamBorder}`,
              background:   tokens.creamDark,
              borderRadius: 4,
              marginBottom: 16,
            }}>
              <div style={{
                fontFamily: "'Playfair Display'", fontSize: 14, fontWeight: 700,
                color: tokens.ink, marginBottom: 4,
              }}>
                Sécurité de la session
              </div>
              <p style={{
                fontFamily: "'Space Grotesk'", fontSize: 12, color: tokens.inkMid,
                lineHeight: 1.55, margin: '0 0 12px',
              }}>
                Déconnecte toutes les sessions actives (web + iOS / Apple Watch).
                Utile après un appareil perdu ou un partage involontaire.
                Tes données restent intactes — tu pourras te reconnecter
                ensuite.
              </p>
              {logoutAllError && (
                <div style={{
                  padding: '8px 10px', marginBottom: 10,
                  background: '#FEE', border: '1px solid #FCC', borderRadius: 4,
                  color: '#A00', fontFamily: "'Space Grotesk'", fontSize: 12,
                }}>{logoutAllError}</div>
              )}
              <button
                onClick={onLogoutAll}
                disabled={logoutAllRunning}
                style={{
                  padding:      '8px 14px',
                  background:   'transparent',
                  border:       `1px solid ${tokens.terra}`,
                  borderRadius: 3,
                  color:        tokens.terra,
                  fontFamily:   "'Space Grotesk'", fontSize: 11, fontWeight: 700,
                  letterSpacing: '0.04em',
                  cursor:       'pointer',
                }}
              >
                {logoutAllRunning ? 'DÉCONNEXION…' : 'DÉCONNECTER TOUS LES APPAREILS'}
              </button>
            </div>

            {/* Danger zone — "Supprimer mon compte" (RGPD art. 17 +
                Strava API Agreement requirement). Two-step confirm to
                avoid accidental clicks. */}
            <div style={{
              padding:      16,
              border:       '1px solid #E8C9C9',
              background:   '#FCF4F4',
              borderRadius: 4,
            }}>
              <div style={{
                fontFamily: "'Playfair Display'", fontSize: 16, fontWeight: 700,
                color: '#A23838', marginBottom: 6,
              }}>
                Danger zone
              </div>
              <p style={{
                fontFamily: "'Space Grotesk'", fontSize: 12, color: tokens.inkMid,
                lineHeight: 1.55, margin: '0 0 14px',
              }}>
                Supprime ton compte et toutes les données associées :
                profil, paramètres, activités synchronisées, jetons OAuth.
                Strava est aussi prévenu (révocation du token côté Strava).
                <strong> Action irréversible.</strong>
              </p>

              {deleteError && (
                <div style={{
                  padding: '8px 10px', marginBottom: 12,
                  background: '#FEE', border: '1px solid #FCC', borderRadius: 4,
                  color: '#A00', fontFamily: "'Space Grotesk'", fontSize: 12,
                }}>{deleteError}</div>
              )}

              {!deleteArmed ? (
                <button
                  onClick={() => setDeleteArmed(true)}
                  disabled={deleting}
                  style={{
                    padding:      '8px 14px',
                    background:   'transparent',
                    border:       '1px solid #A23838',
                    borderRadius: 3,
                    color:        '#A23838',
                    fontFamily:   "'Space Grotesk'", fontSize: 11, fontWeight: 700,
                    letterSpacing: '0.04em',
                    cursor:       'pointer',
                  }}
                >
                  SUPPRIMER MON COMPTE
                </button>
              ) : (
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{
                    fontFamily: "'Space Grotesk'", fontSize: 12, color: '#A23838', fontWeight: 600,
                  }}>
                    Tu es sûr ?
                  </span>
                  <button
                    onClick={onDelete}
                    disabled={deleting}
                    style={{
                      padding: '8px 14px',
                      background: '#A23838',
                      border: '1px solid #A23838',
                      borderRadius: 3,
                      color: '#fff',
                      fontFamily: "'Space Grotesk'", fontSize: 11, fontWeight: 700,
                      letterSpacing: '0.04em',
                      cursor: 'pointer',
                    }}
                  >
                    {deleting ? 'SUPPRESSION…' : 'OUI, SUPPRIME TOUT'}
                  </button>
                  <button
                    onClick={() => { setDeleteArmed(false); setDeleteError(null); }}
                    disabled={deleting}
                    style={{
                      padding: '8px 14px',
                      background: 'transparent',
                      border: `1px solid ${tokens.creamBorder}`,
                      borderRadius: 3,
                      color: tokens.inkMid,
                      fontFamily: "'Space Grotesk'", fontSize: 11, fontWeight: 600,
                      letterSpacing: '0.04em',
                      cursor: 'pointer',
                    }}
                  >
                    Annuler
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </main>
    <Footer />
    </>
  );
}
