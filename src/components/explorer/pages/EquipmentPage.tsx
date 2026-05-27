'use client';

/**
 * Bike Maintenance Tracker — "where am I on chain wear, brake pads,
 * tires" at a glance. Reads from /api/equipment which computes km
 * since install + wear ratio server-side.
 *
 * Workflow:
 *   1. User clicks "Ajouter une pièce" → picks a type (chain, tires,
 *      brake pads, …), confirms suggested lifetime, the part is
 *      created with installed_at_km = current cycling total.
 *   2. Page lists active parts as cards with a wear bar:
 *        green ≤ 75 %
 *        terra 75-100 %
 *        red   > 100 % (replace now)
 *   3. "Marquer remplacé" on a card retires it and prompts to add a
 *      replacement of the same kind.
 *
 * v1 = web-only. iOS read-only port can come later if Florian wants.
 */

import { useEffect, useState, useCallback } from 'react';
import { tokens } from '../tokens';
import { Label, useIsMobile } from '../ui';

type EquipmentKind =
  | 'chain' | 'brake_pads_front' | 'brake_pads_rear'
  | 'tire_front' | 'tire_rear' | 'cassette' | 'cables'
  | 'bar_tape' | 'bottom_bracket' | 'pedals' | 'other';

interface Equipment {
  id:              string;
  name:            string;
  kind:            EquipmentKind;
  installed_at:    string;
  installed_at_km: number;
  lifetime_km:     number;
  replaced_at:     string | null;
  notes:           string | null;
  totalKmToday:    number;
  kmSinceInstall:  number;
  wearRatio:       number;
}

/** Per-kind UI metadata: icon, default lifetime, and the human name we
 *  surface in the type picker. Aligned with the SQL kind enum + the
 *  default lifetimes a typical road cyclist would use. */
const KIND_META: Record<EquipmentKind, { icon: string; label: string; defaultLifetime: number }> = {
  chain:            { icon: '⚙', label: 'Chaîne',                 defaultLifetime: 3000 },
  cassette:         { icon: '◐', label: 'Cassette',               defaultLifetime: 9000 },
  brake_pads_front: { icon: '◉', label: 'Plaquettes avant',       defaultLifetime: 2500 },
  brake_pads_rear:  { icon: '◉', label: 'Plaquettes arrière',     defaultLifetime: 2500 },
  tire_front:       { icon: '○', label: 'Pneu avant',             defaultLifetime: 5000 },
  tire_rear:        { icon: '○', label: 'Pneu arrière',           defaultLifetime: 4000 },
  cables:           { icon: '⊥', label: 'Câbles + gaines',        defaultLifetime: 5000 },
  bar_tape:         { icon: '⌒', label: 'Guidoline',              defaultLifetime: 3000 },
  bottom_bracket:   { icon: '◎', label: 'Boîtier de pédalier',    defaultLifetime: 15000 },
  pedals:           { icon: '⌖', label: 'Pédales',                defaultLifetime: 20000 },
  other:            { icon: '+', label: 'Autre',                   defaultLifetime: 5000 },
};

export function EquipmentPage() {
  const isMobile = useIsMobile();
  const [items,   setItems]   = useState<Equipment[]>([]);
  const [totalKm, setTotalKm] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch('/api/equipment');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json() as { totalKm: number; items: Equipment[] };
      setItems(data.items);
      setTotalKm(data.totalKm);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const markReplaced = async (id: string) => {
    if (!confirm('Marquer comme remplacé ? La pièce sera retirée du tableau et ses km gelés à la valeur actuelle.')) return;
    await fetch('/api/equipment', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, replaced: true }),
    });
    await load();
  };

  const deleteItem = async (id: string) => {
    if (!confirm('Supprimer définitivement ?')) return;
    await fetch('/api/equipment', {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    await load();
  };

  return (
    // The parent ExplorerApp main is `overflow: hidden` — each page
    // must provide its own scroll container with `flex:1 + overflowY:
    // auto`. Same pattern as FtpPage / WrappedPage.
    <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '20px 16px' : '40px 24px', background: tokens.cream }}>
      <div style={{ maxWidth: 1080, margin: '0 auto' }}>
        <Header totalKm={totalKm} onAdd={() => setShowAdd(true)} />

        {error && (
          <div style={{
            padding: 14, marginBottom: 16, background: '#FEE',
            border: '1px solid #FCC', borderRadius: 4,
            color: '#A00', fontFamily: "'Space Grotesk'", fontSize: 12,
          }}>
            {error}
          </div>
        )}

        {loading ? (
          <p style={{ color: tokens.inkLight, fontFamily: "'Space Grotesk'", fontSize: 13 }}>Chargement…</p>
        ) : items.length === 0 ? (
          <EmptyState onAdd={() => setShowAdd(true)} />
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(320px, 1fr))',
            gap: 16,
          }}>
            {items.map(item => (
              <EquipmentCard
                key={item.id}
                item={item}
                onReplaced={() => markReplaced(item.id)}
                onDelete={() => deleteItem(item.id)}
              />
            ))}
          </div>
        )}

        {showAdd && (
          <AddDialog
            onClose={() => setShowAdd(false)}
            onCreated={async () => { setShowAdd(false); await load(); }}
          />
        )}
      </div>
    </div>
  );
}

// ── Header ──────────────────────────────────────────────────────────

function Header({ totalKm, onAdd }: { totalKm: number; onAdd: () => void }) {
  return (
    <div style={{ marginBottom: 24, display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
      <div>
        <p style={{ fontFamily: "'Space Grotesk'", fontSize: 10, fontWeight: 700,
                    letterSpacing: '0.12em', color: tokens.terra, textTransform: 'uppercase', margin: '0 0 6px' }}>
          § MATÉRIEL
        </p>
        <h1 style={{ fontFamily: "'Playfair Display'", fontSize: 32, fontWeight: 800,
                     color: tokens.ink, margin: 0, lineHeight: 1.15 }}>
          Suivi d&apos;usure{' '}
          <em style={{ color: tokens.terra, fontStyle: 'italic' }}>{totalKm.toFixed(0)} km</em>
        </h1>
        <p style={{ fontFamily: "'Space Grotesk'", fontSize: 13, color: tokens.inkMid, lineHeight: 1.55, marginTop: 8, maxWidth: 640 }}>
          Suis l&apos;usure de chaîne, plaquettes, pneus, câbles… Ajoute une pièce à chaque
          fois que tu remplaces quelque chose. L&apos;usure se met à jour automatiquement
          à chaque nouvelle sortie vélo.
        </p>
      </div>
      <button onClick={onAdd} style={{
        padding: '12px 18px', background: tokens.terra, color: 'white',
        border: 'none', borderRadius: 3, cursor: 'pointer',
        fontFamily: "'Space Grotesk'", fontSize: 12, fontWeight: 700,
        letterSpacing: '0.06em', textTransform: 'uppercase',
      }}>+ Ajouter une pièce</button>
    </div>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div style={{
      background: tokens.surface, border: `1px solid ${tokens.creamBorder}`,
      borderRadius: 4, padding: 48, textAlign: 'center',
    }}>
      <div style={{ fontSize: 48, color: tokens.inkLight, marginBottom: 8 }}>⚙</div>
      <p style={{ fontFamily: "'Playfair Display'", fontSize: 18, fontWeight: 700, color: tokens.ink, margin: '0 0 8px' }}>
        Pas encore de pièce suivie
      </p>
      <p style={{ fontFamily: "'Space Grotesk'", fontSize: 13, color: tokens.inkMid, marginBottom: 18 }}>
        Commence par ta chaîne — la pièce qui s&apos;use le plus vite.
      </p>
      <button onClick={onAdd} style={{
        padding: '10px 18px', background: tokens.terra, color: 'white',
        border: 'none', borderRadius: 3, cursor: 'pointer',
        fontFamily: "'Space Grotesk'", fontSize: 12, fontWeight: 700,
      }}>+ Ajouter ma première pièce</button>
    </div>
  );
}

// ── Card ────────────────────────────────────────────────────────────

function EquipmentCard({
  item, onReplaced, onDelete,
}: {
  item: Equipment;
  onReplaced: () => void;
  onDelete: () => void;
}) {
  const meta = KIND_META[item.kind];
  const pct = Math.min(100, item.wearRatio * 100);
  const overdue = item.wearRatio > 1;
  const warning = item.wearRatio > 0.75 && !overdue;
  const color = overdue ? '#A23838' : warning ? tokens.terra : tokens.green;

  return (
    <div style={{
      background: tokens.surface,
      border: `1px solid ${tokens.creamBorder}`,
      borderLeft: `4px solid ${color}`,
      borderRadius: 4, padding: 18,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontSize: 18, color: tokens.terra }}>{meta.icon}</span>
          <span style={{ fontFamily: "'Playfair Display'", fontSize: 16, fontWeight: 700, color: tokens.ink }}>
            {item.name}
          </span>
        </div>
        <span style={{ fontFamily: "'Space Grotesk'", fontSize: 10, color: tokens.inkLight, textTransform: 'uppercase' }}>
          {meta.label}
        </span>
      </div>

      {/* Wear bar */}
      <div style={{ marginTop: 12, marginBottom: 10 }}>
        <div style={{ height: 10, background: tokens.creamDark, borderRadius: 2, overflow: 'hidden', position: 'relative' }}>
          <div style={{
            width: `${pct}%`, height: '100%', background: color,
            transition: 'width 320ms ease',
          }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontFamily: "'Space Grotesk'", fontSize: 11, color: tokens.inkMid }}>
          <span><strong style={{ color: tokens.ink }}>{item.kmSinceInstall.toFixed(0)} km</strong> depuis la pose</span>
          <span style={{ color, fontWeight: 700 }}>
            {overdue ? `+${((item.wearRatio - 1) * 100).toFixed(0)} % dépassement` : `${(item.wearRatio * 100).toFixed(0)} % d'usure`}
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontFamily: "'Space Grotesk'", fontSize: 10, color: tokens.inkLight }}>
          <span>posée le {new Date(item.installed_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
          <span>durée de vie {item.lifetime_km.toLocaleString('fr-FR')} km</span>
        </div>
      </div>

      {item.notes && (
        <p style={{ marginTop: 8, fontFamily: "'Space Grotesk'", fontSize: 11, color: tokens.inkLight, fontStyle: 'italic' }}>
          {item.notes}
        </p>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button onClick={onReplaced} style={{
          padding: '6px 12px', background: 'transparent',
          border: `1px solid ${tokens.terra}`, borderRadius: 3,
          color: tokens.terra, fontFamily: "'Space Grotesk'", fontSize: 11,
          fontWeight: 700, letterSpacing: '0.04em', cursor: 'pointer',
        }}>MARQUER REMPLACÉ</button>
        <button onClick={onDelete} style={{
          padding: '6px 12px', background: 'transparent',
          border: `1px solid ${tokens.creamBorder}`, borderRadius: 3,
          color: tokens.inkLight, fontFamily: "'Space Grotesk'", fontSize: 11, cursor: 'pointer',
        }}>×</button>
      </div>
    </div>
  );
}

// ── Add dialog ─────────────────────────────────────────────────────

function AddDialog({
  onClose, onCreated,
}: {
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const [kind, setKind]               = useState<EquipmentKind>('chain');
  const [name, setName]               = useState('Chaîne');
  const [lifetime, setLifetime]       = useState(3000);
  const [installedKm, setInstalledKm] = useState<number | ''>('');
  const [installedAt, setInstalledAt] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes]             = useState('');
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState<string | null>(null);

  // Sync name + lifetime to the kind's default on kind change.
  const handleKindChange = (k: EquipmentKind) => {
    setKind(k);
    setName(KIND_META[k].label);
    setLifetime(KIND_META[k].defaultLifetime);
  };

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const r = await fetch('/api/equipment', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          name:            name.trim(),
          kind,
          lifetime_km:     lifetime,
          installed_at:    new Date(installedAt + 'T12:00:00Z').toISOString(),
          installed_at_km: typeof installedKm === 'number' ? installedKm : undefined,
          notes:           notes.trim() || undefined,
        }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? `HTTP ${r.status}`);
      }
      await onCreated();
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }} onClick={onClose}>
      <div style={{
        background: tokens.surface, borderRadius: 4, padding: 28, maxWidth: 480, width: '90%',
        boxShadow: '0 10px 40px rgba(0,0,0,0.3)',
      }} onClick={e => e.stopPropagation()}>
        <h2 style={{ fontFamily: "'Playfair Display'", fontSize: 20, fontWeight: 700, color: tokens.ink, margin: '0 0 20px' }}>
          Ajouter une pièce
        </h2>

        {error && (
          <div style={{
            padding: 10, marginBottom: 14, background: '#FEE',
            border: '1px solid #FCC', borderRadius: 4, color: '#A00',
            fontFamily: "'Space Grotesk'", fontSize: 12,
          }}>{error}</div>
        )}

        <Field label="Type">
          <select value={kind} onChange={e => handleKindChange(e.target.value as EquipmentKind)} style={INPUT}>
            {(Object.keys(KIND_META) as EquipmentKind[]).map(k => (
              <option key={k} value={k}>{KIND_META[k].icon} {KIND_META[k].label}</option>
            ))}
          </select>
        </Field>

        <Field label="Nom (libre)">
          <input value={name} onChange={e => setName(e.target.value)} maxLength={80} style={INPUT}
            placeholder="ex. Chaîne Shimano CN-HG901" />
        </Field>

        <Field label="Durée de vie estimée (km)">
          <input type="number" value={lifetime} min={100} max={50000} step={100}
            onChange={e => setLifetime(Number(e.target.value))} style={INPUT} />
        </Field>

        <Field label="Date d'installation">
          <input type="date" value={installedAt}
            onChange={e => setInstalledAt(e.target.value)} style={INPUT} />
        </Field>

        <Field label="Km déjà sur la pièce (optionnel — laisse vide si neuve)">
          <input type="number" value={installedKm} placeholder="0 par défaut"
            onChange={e => setInstalledKm(e.target.value === '' ? '' : Number(e.target.value))} style={INPUT} />
        </Field>

        <Field label="Notes (optionnel)">
          <input value={notes} onChange={e => setNotes(e.target.value)} maxLength={200} style={INPUT}
            placeholder="ex. KMC X11, achetée chez Décathlon" />
        </Field>

        <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end' }}>
          <button onClick={onClose} disabled={saving} style={{
            padding: '10px 18px', background: 'transparent', border: `1px solid ${tokens.creamBorder}`,
            borderRadius: 3, color: tokens.inkMid, fontFamily: "'Space Grotesk'", fontSize: 12, cursor: 'pointer',
          }}>Annuler</button>
          <button onClick={submit} disabled={saving} style={{
            padding: '10px 20px', background: tokens.terra, color: 'white',
            border: 'none', borderRadius: 3, cursor: 'pointer',
            fontFamily: "'Space Grotesk'", fontSize: 12, fontWeight: 700, letterSpacing: '0.06em',
          }}>{saving ? 'AJOUT…' : 'AJOUTER'}</button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <Label style={{ display: 'block', marginBottom: 4 }}>{label}</Label>
      {children}
    </div>
  );
}

const INPUT: React.CSSProperties = {
  width: '100%', padding: '8px 10px',
  background: tokens.creamDark, border: `1px solid ${tokens.creamBorder}`,
  borderRadius: 3, fontFamily: "'Space Grotesk'", fontSize: 13,
  color: tokens.ink, boxSizing: 'border-box',
};
