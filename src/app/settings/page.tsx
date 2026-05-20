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
import { tokens } from '@/components/explorer/tokens';

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
  const [riderKg,   setRiderKg]   = useState('');
  const [bikeKg,    setBikeKg]    = useState('');
  const [customFtp, setCustomFtp] = useState('');

  useEffect(() => {
    fetch('/api/me')
      .then(async r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<MeResponse>;
      })
      .then(d => {
        setMe(d);
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
    const patch: Record<string, number | null> = {};
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

  return (
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
          </>
        )}
      </div>
    </main>
  );
}
