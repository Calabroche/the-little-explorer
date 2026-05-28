'use client';

/**
 * Carnet d'entretien — the event-log half of /equipement.
 *
 * Sits behind the "Entretien" tab of EquipmentPage. Reads
 * /api/service-events scoped to one bike, surfaces:
 *   1. À FAIRE BIENTÔT — kinds whose `status` is 'due' or 'overdue'
 *      based on server-computed intervals (chain lube every 200 km,
 *      brake bleed every 5 000 km / 365 days, etc.).
 *   2. DERNIÈRES INTERVENTIONS — chronological list of past events
 *      with kind, date, km, optional notes.
 *
 * Write path: a single "+ Ajouter une intervention" dialog that
 * defaults km_at_event to the bike's current total (server-side).
 */

import { useEffect, useState, useCallback, useMemo } from 'react';
import { tokens } from '../tokens';
import { Label } from '../ui';

type ServiceKind =
  | 'chain_lube' | 'chain_clean'
  | 'brake_bleed' | 'brake_pads_check'
  | 'wheel_true' | 'tire_pressure'
  | 'derailleur_tune' | 'bottom_bracket_check'
  | 'cable_check' | 'bike_wash' | 'general_service'
  | 'other';

const KIND_LABEL: Record<ServiceKind, string> = {
  chain_lube:           'Lubrification chaîne',
  chain_clean:          'Nettoyage transmission',
  brake_bleed:          'Purge freins',
  brake_pads_check:     'Vérif plaquettes',
  wheel_true:           'Voilage roue',
  tire_pressure:        'Pression pneus',
  derailleur_tune:      'Réglage dérailleurs',
  bottom_bracket_check: 'Vérif boîtier pédalier',
  cable_check:          'Vérif câbles',
  bike_wash:            'Lavage vélo',
  general_service:      'Révision complète',
  other:                'Autre intervention',
};
const KIND_ICON: Record<ServiceKind, string> = {
  chain_lube:           '⛁',  chain_clean:          '⌬',
  brake_bleed:          '⊙',  brake_pads_check:     '◉',
  wheel_true:           '○',  tire_pressure:        '◯',
  derailleur_tune:      '⊂',  bottom_bracket_check: '◎',
  cable_check:          '⊥',  bike_wash:            '≋',
  general_service:      '✦',  other:                '·',
};

// Display order — most-frequent / most-important first so the carnet
// reads top-down naturally.
const KIND_ORDER: ServiceKind[] = [
  'chain_lube', 'chain_clean',
  'brake_pads_check', 'brake_bleed',
  'tire_pressure',
  'derailleur_tune',
  'wheel_true', 'bottom_bracket_check', 'cable_check',
  'bike_wash', 'general_service', 'other',
];

interface ServiceEvent {
  id:          string;
  gear_id:     string | null;
  gear_name:   string | null;
  kind:        ServiceKind;
  date:        string;
  km_at_event: number | null;
  notes:       string | null;
}

interface NextDue {
  kind:         ServiceKind;
  last_date:    string | null;
  last_km:      number | null;
  km_since:     number | null;
  days_since:   number | null;
  km_interval:  number | null;
  day_interval: number | null;
  status:       'fresh' | 'due' | 'overdue' | 'unknown';
}

interface Bike {
  id:           string;
  name:         string;
  primary_bike: boolean;
  totalKm:      number;
}

export function ServiceLogPanel({ bikes }: { bikes: Bike[] }) {
  // Default to the primary bike (or first one); the user can switch
  // via the picker. Carnet math is per-bike so we always need a
  // selection — when no bike is known yet (legacy state), the panel
  // shows the "connect a bike" hint instead of trying to render math
  // against null.
  const [gearId, setGearId] = useState<string | null>(
    bikes.find(b => b.primary_bike)?.id ?? bikes[0]?.id ?? null,
  );
  // If the bike list arrives after first render (parent fetches in
  // background), seed the default.
  useEffect(() => {
    if (gearId == null && bikes.length > 0) {
      setGearId(bikes.find(b => b.primary_bike)?.id ?? bikes[0].id);
    }
  }, [bikes, gearId]);

  const [events, setEvents] = useState<ServiceEvent[]>([]);
  const [dueByKind, setDueByKind] = useState<NextDue[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const load = useCallback(async () => {
    if (!gearId) return;
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/service-events?gear_id=${encodeURIComponent(gearId)}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json() as { events: ServiceEvent[]; dueByKind: NextDue[] };
      setEvents(data.events);
      setDueByKind(data.dueByKind);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [gearId]);
  useEffect(() => { void load(); }, [load]);

  const deleteEvent = async (id: string) => {
    if (!confirm('Supprimer cette intervention ?')) return;
    await fetch('/api/service-events', {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    await load();
  };

  // Bucket events by gear for the timeline (we filter by gearId on
  // the server, so this is just a convenience for the kind chips).
  const dueSoon = useMemo(
    () => dueByKind
      .filter(d => d.status === 'due' || d.status === 'overdue')
      .sort((a, b) => (a.status === 'overdue' ? -1 : 1) - (b.status === 'overdue' ? -1 : 1)),
    [dueByKind],
  );

  if (bikes.length === 0) {
    return (
      <div style={{
        padding: 28, textAlign: 'center', background: tokens.surface,
        border: `1px solid ${tokens.creamBorder}`, borderRadius: 4,
      }}>
        <p style={{ fontFamily: "'Playfair Display'", fontSize: 16, fontWeight: 700, color: tokens.ink, margin: '0 0 6px' }}>
          Aucun vélo synchronisé
        </p>
        <p style={{ fontFamily: "'Space Grotesk'", fontSize: 12, color: tokens.inkMid, margin: 0 }}>
          Connecte Strava et clique « Re-syncer » pour qu&apos;on récupère tes vélos.
          Une fois ça fait, tu pourras logger tes interventions ici.
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* Bike picker + Add CTA */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 12, marginBottom: 20,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Label>VÉLO</Label>
          <select
            value={gearId ?? ''}
            onChange={e => setGearId(e.target.value || null)}
            style={selectStyle}
          >
            {bikes.map(b => (
              <option key={b.id} value={b.id}>
                {b.name}{b.primary_bike ? ' (principal)' : ''} · {b.totalKm.toFixed(0)} km
              </option>
            ))}
          </select>
        </div>
        <button onClick={() => setShowAdd(true)} style={{
          padding: '10px 16px', background: tokens.terra, color: '#fff',
          border: 'none', borderRadius: 3, cursor: 'pointer',
          fontFamily: "'Space Grotesk'", fontSize: 12, fontWeight: 700,
          letterSpacing: '0.06em',
        }}>+ AJOUTER UNE INTERVENTION</button>
      </div>

      {error && (
        <div style={{
          padding: 12, marginBottom: 16, background: '#FEE',
          border: '1px solid #FCC', borderRadius: 4,
          color: '#A00', fontFamily: "'Space Grotesk'", fontSize: 12,
        }}>{error}</div>
      )}

      {/* À faire bientôt — kinds whose status is 'due' or 'overdue'.
          Server returned `dueByKind` for every kind already, we just
          filter to the ones with pending status here. */}
      {dueSoon.length > 0 && (
        <section style={{ marginBottom: 24 }}>
          <SectionHeader title="À FAIRE BIENTÔT" count={dueSoon.length} />
          <div style={{
            display: 'grid', gap: 12,
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          }}>
            {dueSoon.map(d => <DueCard key={d.kind} due={d} />)}
          </div>
        </section>
      )}

      {/* Last events timeline */}
      <section>
        <SectionHeader title="DERNIÈRES INTERVENTIONS" count={events.length} />
        {loading && events.length === 0 ? (
          <p style={{ fontFamily: "'Space Grotesk'", color: tokens.inkLight, fontSize: 13 }}>Chargement…</p>
        ) : events.length === 0 ? (
          <EmptyEvents onAdd={() => setShowAdd(true)} />
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {events.map(e => <EventRow key={e.id} event={e} onDelete={() => deleteEvent(e.id)} />)}
          </ul>
        )}
      </section>

      {showAdd && gearId && (
        <AddDialog
          gearId={gearId}
          onClose={() => setShowAdd(false)}
          onCreated={async () => { setShowAdd(false); await load(); }}
        />
      )}
    </div>
  );
}

// ── À faire bientôt card ────────────────────────────────────────────

function DueCard({ due }: { due: NextDue }) {
  const overdue = due.status === 'overdue';
  const color   = overdue ? '#A23838' : tokens.terra;
  return (
    <div style={{
      background:  tokens.surface,
      border:      `1px solid ${tokens.creamBorder}`,
      borderLeft:  `4px solid ${color}`,
      borderRadius: 4, padding: 14,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: 18, color: tokens.terra }}>{KIND_ICON[due.kind]}</span>
        <span style={{ fontFamily: "'Playfair Display'", fontSize: 15, fontWeight: 700, color: tokens.ink, flex: 1 }}>
          {KIND_LABEL[due.kind]}
        </span>
        <span style={{
          fontFamily: "'Space Grotesk'", fontSize: 10, fontWeight: 700,
          letterSpacing: '0.06em', color, textTransform: 'uppercase',
        }}>{overdue ? 'EN RETARD' : 'BIENTÔT'}</span>
      </div>
      <p style={{ fontFamily: "'Space Grotesk'", fontSize: 12, color: tokens.inkMid, margin: 0, lineHeight: 1.5 }}>
        {dueDetailLine(due)}
      </p>
    </div>
  );
}

function dueDetailLine(d: NextDue): string {
  if (d.last_date == null) {
    const interval = d.km_interval ? `${d.km_interval} km` : d.day_interval ? `${d.day_interval} j` : '?';
    return `Jamais effectué. Interval recommandé : ${interval}.`;
  }
  const parts: string[] = [];
  if (d.km_since != null && d.km_interval != null) {
    parts.push(`${Math.round(d.km_since)} km depuis (cible ${d.km_interval})`);
  }
  if (d.days_since != null && d.day_interval != null) {
    parts.push(`${d.days_since} j depuis (cible ${d.day_interval})`);
  }
  return parts.join(' · ') || `Dernière le ${formatDate(d.last_date)}.`;
}

// ── Event timeline row ──────────────────────────────────────────────

function EventRow({ event, onDelete }: { event: ServiceEvent; onDelete: () => void }) {
  return (
    <li style={{
      display: 'flex', gap: 12, padding: '12px 0',
      borderBottom: `1px solid ${tokens.creamBorder}`,
    }}>
      <div style={{
        width: 32, height: 32, flexShrink: 0,
        background: tokens.creamDark, borderRadius: '50%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 14, color: tokens.terra,
      }}>{KIND_ICON[event.kind]}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontFamily: "'Playfair Display'", fontSize: 14, fontWeight: 700, color: tokens.ink }}>
            {KIND_LABEL[event.kind]}
          </span>
          <span style={{ fontFamily: "'Space Grotesk'", fontSize: 11, color: tokens.inkLight }}>
            {formatDate(event.date)}
            {event.km_at_event != null && ` · ${Math.round(event.km_at_event)} km`}
          </span>
        </div>
        {event.notes && (
          <p style={{
            margin: '4px 0 0', fontFamily: "'Space Grotesk'", fontSize: 12,
            color: tokens.inkMid, fontStyle: 'italic', lineHeight: 1.45,
          }}>{event.notes}</p>
        )}
      </div>
      <button
        onClick={onDelete}
        title="Supprimer"
        style={{
          background: 'transparent', border: 'none',
          color: tokens.inkLight, cursor: 'pointer',
          fontSize: 16, padding: '2px 6px',
          alignSelf: 'flex-start',
        }}
      >×</button>
    </li>
  );
}

function EmptyEvents({ onAdd }: { onAdd: () => void }) {
  return (
    <div style={{
      background: tokens.surface, border: `1px solid ${tokens.creamBorder}`,
      borderRadius: 4, padding: 28, textAlign: 'center',
    }}>
      <p style={{ fontFamily: "'Playfair Display'", fontSize: 16, fontWeight: 700, color: tokens.ink, margin: '0 0 6px' }}>
        Pas encore d&apos;intervention loggée
      </p>
      <p style={{ fontFamily: "'Space Grotesk'", fontSize: 12, color: tokens.inkMid, margin: '0 0 14px' }}>
        Note chaque graissage de chaîne, purge de frein ou voilage de roue pour suivre
        ton entretien dans le temps.
      </p>
      <button onClick={onAdd} style={{
        padding: '8px 14px', background: tokens.terra, color: '#fff',
        border: 'none', borderRadius: 3, cursor: 'pointer',
        fontFamily: "'Space Grotesk'", fontSize: 12, fontWeight: 700,
      }}>+ Logger ma première intervention</button>
    </div>
  );
}

// ── Add dialog ──────────────────────────────────────────────────────

function AddDialog({
  gearId, onClose, onCreated,
}: {
  gearId: string;
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const [kind, setKind]   = useState<ServiceKind>('chain_lube');
  const [date, setDate]   = useState(new Date().toISOString().slice(0, 10));
  // Leaving km blank → server uses the bike's current total. Sensible
  // default for "I just did this after my last ride".
  const [km, setKm]       = useState<number | ''>('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState<string | null>(null);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const r = await fetch('/api/service-events', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          gear_id:     gearId,
          kind,
          date:        new Date(date + 'T12:00:00Z').toISOString(),
          km_at_event: typeof km === 'number' ? km : undefined,
          notes:       notes.trim() || undefined,
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
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: tokens.surface, borderRadius: 4, padding: 28,
        maxWidth: 460, width: '90%', boxShadow: '0 10px 40px rgba(0,0,0,0.3)',
      }}>
        <h2 style={{ fontFamily: "'Playfair Display'", fontSize: 20, fontWeight: 700, color: tokens.ink, margin: '0 0 20px' }}>
          Logger une intervention
        </h2>

        {error && (
          <div style={{
            padding: 10, marginBottom: 14, background: '#FEE',
            border: '1px solid #FCC', borderRadius: 4, color: '#A00',
            fontFamily: "'Space Grotesk'", fontSize: 12,
          }}>{error}</div>
        )}

        <Field label="Type">
          <select value={kind} onChange={e => setKind(e.target.value as ServiceKind)} style={INPUT}>
            {KIND_ORDER.map(k => (
              <option key={k} value={k}>{KIND_ICON[k]} {KIND_LABEL[k]}</option>
            ))}
          </select>
        </Field>

        <Field label="Date">
          <input type="date" value={date} onChange={e => setDate(e.target.value)} style={INPUT} />
        </Field>

        <Field label="Km du vélo au moment de l'intervention (optionnel)">
          <input type="number" value={km} placeholder="auto si vide (= km actuel)"
            onChange={e => setKm(e.target.value === '' ? '' : Number(e.target.value))}
            style={INPUT} />
        </Field>

        <Field label="Notes (optionnel)">
          <input value={notes} onChange={e => setNotes(e.target.value)} maxLength={300} style={INPUT}
            placeholder="ex. huile sèche après pluie, plaquettes encore OK" />
        </Field>

        <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end' }}>
          <button onClick={onClose} disabled={saving} style={{
            padding: '10px 18px', background: 'transparent', border: `1px solid ${tokens.creamBorder}`,
            borderRadius: 3, color: tokens.inkMid, fontFamily: "'Space Grotesk'", fontSize: 12, cursor: 'pointer',
          }}>Annuler</button>
          <button onClick={submit} disabled={saving} style={{
            padding: '10px 20px', background: tokens.terra, color: '#fff',
            border: 'none', borderRadius: 3, cursor: 'pointer',
            fontFamily: "'Space Grotesk'", fontSize: 12, fontWeight: 700, letterSpacing: '0.06em',
          }}>{saving ? 'AJOUT…' : 'AJOUTER'}</button>
        </div>
      </div>
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────

function SectionHeader({ title, count }: { title: string; count: number }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
      gap: 12, marginBottom: 12, paddingBottom: 8,
      borderBottom: `1px solid ${tokens.creamBorder}`,
    }}>
      <Label>§ {title}</Label>
      <Label style={{ color: tokens.inkLight }}>{count}</Label>
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

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

const INPUT: React.CSSProperties = {
  width: '100%', padding: '8px 10px',
  background: tokens.creamDark, border: `1px solid ${tokens.creamBorder}`,
  borderRadius: 3, fontFamily: "'Space Grotesk'", fontSize: 13,
  color: tokens.ink, boxSizing: 'border-box',
};

const selectStyle: React.CSSProperties = {
  padding: '6px 10px',
  background: tokens.surface, border: `1px solid ${tokens.creamBorder}`,
  borderRadius: 3,
  fontFamily: "'Space Grotesk'", fontSize: 12, color: tokens.ink,
  cursor: 'pointer',
};
