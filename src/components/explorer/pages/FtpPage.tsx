'use client';

import { useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { tokens, Activity } from '../tokens';
import { SectionTag, Label, useIsMobile } from '../ui';

const RIDER_KG = 66;
const DEFAULT_FTP_W = 291;

const DURATIONS: { key: 's60'|'s300'|'s600'|'s1200'|'s1800'|'s3600'; sec: number; label: string }[] = [
  { key: 's60',   sec: 60,   label: '1 min' },
  { key: 's300',  sec: 300,  label: '5 min' },
  { key: 's600',  sec: 600,  label: '10 min' },
  { key: 's1200', sec: 1200, label: '20 min' },
  { key: 's1800', sec: 1800, label: '30 min' },
  { key: 's3600', sec: 3600, label: '60 min' },
];

interface BestEffort {
  sec: number;
  label: string;
  power: number | null;
  rideId: number | null;
  rideTitle: string | null;
  rideDate: string | null;
}

function aggregateBestEfforts(activities: Activity[]): BestEffort[] {
  return DURATIONS.map(d => {
    let best: number | null = null;
    let rideId: number | null = null;
    let rideTitle: string | null = null;
    let rideDate: string | null = null;
    for (const a of activities) {
      const v = a.bestEfforts?.[d.key] ?? null;
      if (v != null && (best == null || v > best)) {
        best = v;
        rideId = a.id;
        rideTitle = a.title;
        rideDate = a.date;
      }
    }
    return { sec: d.sec, label: d.label, power: best, rideId, rideTitle, rideDate };
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function PdcTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload as BestEffort;
  return (
    <div style={{
      background: tokens.surface, border: `1px solid ${tokens.creamBorder}`,
      borderRadius: 4, padding: '8px 10px',
      fontFamily: "'Space Grotesk'", fontSize: 11, color: tokens.ink,
      boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
    }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>Best {p.label}</div>
      <div style={{ color: tokens.terra }}>{p.power != null ? `${p.power} W` : '—'}</div>
      {p.rideTitle && <div style={{ color: tokens.inkLight, marginTop: 2, maxWidth: 220 }}>{p.rideTitle.slice(0, 40)}</div>}
      {p.rideDate  && <div style={{ color: tokens.inkLight }}>{p.rideDate}</div>}
    </div>
  );
}

export function FtpPage({ activities }: { activities: Activity[] }) {
  const isMobile = useIsMobile();

  // Exclure les sorties Strava typées EBikeRide : l'assistance fausse les chiffres.
  const ftpActivities = useMemo(
    () => activities.filter(a => a.original_type !== 'EBikeRide'),
    [activities]
  );
  const efforts = useMemo(() => aggregateBestEfforts(ftpActivities), [ftpActivities]);
  const best20  = efforts.find(e => e.sec === 1200)?.power ?? null;
  const estimatedFtp = best20 != null ? Math.round(best20 * 0.95) : null;
  const excludedCount = activities.length - ftpActivities.length;

  const effectiveFtp = estimatedFtp ?? DEFAULT_FTP_W;
  const effectiveSource = estimatedFtp ? 'estimé (best 20 min × 0.95)' : 'défaut (66 kg × 2.205 × 2)';
  const wkg = +(effectiveFtp / RIDER_KG).toFixed(2);

  const hasData = efforts.some(e => e.power != null);

  const CARD: React.CSSProperties = {
    background: tokens.surface, border: `1px solid ${tokens.creamBorder}`,
    borderRadius: 4, padding: 24, marginBottom: 24,
  };

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '20px 16px' : '32px 40px' }}>
      <SectionTag num={5} title="FTP & PUISSANCE" />
      <h1 style={{
        fontFamily: "'Playfair Display'", fontSize: isMobile ? 28 : 40, fontWeight: 900,
        color: tokens.ink, lineHeight: 1.1, marginBottom: isMobile ? 20 : 32,
      }}>
        Ta puissance.<br />
        <em style={{ color: tokens.terra, fontStyle: 'italic', fontWeight: 700 }}>Mesurée par les données.</em>
      </h1>

      {/* FTP card */}
      <div style={CARD}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <Label style={{ color: tokens.terra }}>§ FTP</Label>
          <div style={{ width: 24, height: 1, background: tokens.creamBorder }} />
          <Label>SEUIL FONCTIONNEL DE PUISSANCE</Label>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 24, marginBottom: 20 }}>
          <div>
            <Label style={{ display: 'block', marginBottom: 6 }}>FTP ESTIMÉ</Label>
            <div style={{ fontFamily: "'Playfair Display'", fontSize: 56, fontWeight: 900, color: tokens.terra, lineHeight: 1 }}>
              {effectiveFtp}<span style={{ fontFamily: "'Space Grotesk'", fontSize: 14, color: tokens.inkLight, marginLeft: 6 }}>W</span>
            </div>
            <div style={{ fontFamily: "'Space Grotesk'", fontSize: 11, color: tokens.inkLight, marginTop: 4 }}>
              {effectiveSource} · {wkg} W/kg
            </div>
          </div>

          <div>
            <Label style={{ display: 'block', marginBottom: 6 }}>FORMULE</Label>
            <div style={{ fontFamily: "'Space Grotesk'", fontSize: 13, color: tokens.inkMid, lineHeight: 1.7 }}>
              best 20 min × 0.95 (Coggan){best20 != null && <> — best 20 min : <strong style={{ color: tokens.ink }}>{best20} W</strong></>}
              {excludedCount > 0 && <><br /><span style={{ color: tokens.inkLight }}>{excludedCount} sortie{excludedCount > 1 ? 's' : ''} EBikeRide exclue{excludedCount > 1 ? 's' : ''}</span></>}
            </div>
          </div>
        </div>

        <div style={{ padding: '12px 14px', background: tokens.creamDark, borderRadius: 4, fontFamily: "'Space Grotesk'", fontSize: 11, color: tokens.inkLight, lineHeight: 1.7 }}>
          <strong style={{ color: tokens.ink }}>Comment c&apos;est calculé ?</strong> La puissance affichée n&apos;est <em>pas mesurée</em> :
          elle est dérivée d&apos;un modèle physique (vitesse + pente + masse + Crr + CdA). C&apos;est utile en relatif (suivre la
          progression) mais l&apos;absolu dépend de la qualité des constantes. Pour avoir un chiffre fiable, un capteur de puissance
          (pédales / manivelle / home-trainer) reste la seule solution.
        </div>
      </div>

      {/* Power-Duration Curve */}
      <div style={CARD}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <Label style={{ color: tokens.green }}>§ COURBE</Label>
          <div style={{ width: 24, height: 1, background: tokens.creamBorder }} />
          <Label>PUISSANCE — DURÉE (BEST EFFORTS)</Label>
        </div>

        {!hasData ? (
          <div style={{ fontFamily: "'Space Grotesk'", fontSize: 12, color: tokens.inkLight, padding: 20 }}>
            Pas assez de données : il faut au moins une sortie avec un stream de puissance &gt; 60 s.
          </div>
        ) : (
          <>
            <div style={{ width: '100%', height: 260 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={efforts} margin={{ top: 8, right: 16, left: -8, bottom: 12 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={tokens.creamBorder} />
                  <XAxis
                    dataKey="sec"
                    type="number"
                    scale="log"
                    domain={[60, 3600]}
                    ticks={[60, 300, 600, 1200, 1800, 3600]}
                    tickFormatter={s => s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s/60)}m` : '1h'}
                    tick={{ fontFamily: "'Space Grotesk'", fontSize: 10, fill: tokens.inkLight }}
                    axisLine={{ stroke: tokens.creamBorder }}
                  />
                  <YAxis
                    width={40}
                    tickFormatter={v => `${v}W`}
                    tick={{ fontFamily: "'Space Grotesk'", fontSize: 10, fill: tokens.inkLight }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip content={<PdcTooltip />} />
                  <ReferenceLine
                    y={effectiveFtp}
                    stroke={tokens.terra}
                    strokeDasharray="5 5"
                    label={{ value: `FTP ${effectiveFtp}W`, position: 'right', fill: tokens.terra, fontFamily: "'Space Grotesk'", fontSize: 10 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="power"
                    stroke={tokens.green}
                    strokeWidth={2.5}
                    dot={{ r: 4, fill: tokens.green, strokeWidth: 0 }}
                    activeDot={{ r: 6 }}
                    connectNulls
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Best efforts table */}
            <div style={{ marginTop: 20, display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(6, 1fr)', gap: 8 }}>
              {efforts.map(e => (
                <div key={e.sec} style={{
                  padding: '10px 12px',
                  background: tokens.creamDark,
                  borderRadius: 3,
                  borderTop: `2px solid ${e.sec === 1200 ? tokens.terra : tokens.creamBorder}`,
                }}>
                  <Label style={{ display: 'block', marginBottom: 3 }}>{e.label}</Label>
                  <div style={{ fontFamily: "'Playfair Display'", fontSize: 18, fontWeight: 700, color: e.sec === 1200 ? tokens.terra : tokens.ink, lineHeight: 1 }}>
                    {e.power != null ? <>{e.power}<span style={{ fontFamily: "'Space Grotesk'", fontSize: 9, color: tokens.inkLight, marginLeft: 2 }}>W</span></> : '—'}
                  </div>
                  {e.power != null && (
                    <div style={{ fontFamily: "'Space Grotesk'", fontSize: 9, color: tokens.inkLight, marginTop: 4, lineHeight: 1.3 }}>
                      {e.rideDate}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Methodology */}
      <div style={CARD}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <Label style={{ color: tokens.blue }}>§ MÉTHODOLOGIE</Label>
          <div style={{ width: 24, height: 1, background: tokens.creamBorder }} />
          <Label>POUR UN VRAI TEST FTP</Label>
        </div>
        <div style={{ fontFamily: "'Space Grotesk'", fontSize: 12, color: tokens.inkMid, lineHeight: 1.8 }}>
          <p style={{ marginBottom: 12 }}>
            <strong style={{ color: tokens.ink }}>Test 20 min Coggan</strong> — 20 min en pleine charge sur du plat / faux-plat constant,
            après 15-20 min d&apos;échauffement progressif. FTP = puissance moyenne × 0.95.
          </p>
          <p style={{ marginBottom: 12 }}>
            <strong style={{ color: tokens.ink }}>Test 8 min × 2</strong> — Friel : deux efforts de 8 min séparés de 10 min de récup.
            FTP = moyenne des deux × 0.90.
          </p>
          <p style={{ marginBottom: 12 }}>
            <strong style={{ color: tokens.ink }}>Ramp test</strong> — paliers de 1 min (+25 W chacun) jusqu&apos;à l&apos;abandon.
            FTP = puissance maximale moyenne sur la dernière minute × 0.75.
          </p>
          <p style={{ color: tokens.inkLight }}>
            Pour mesurer (et pas seulement estimer) : pédales à puissance Favero Assioma (~600 €), Stages, 4iiii ou home-trainer
            connecté Wahoo / Tacx.
          </p>
        </div>
      </div>
    </div>
  );
}
