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
import { ServiceLogPanel } from './ServiceLogPanel';

type EquipmentKind =
  | 'frame' | 'fork'
  | 'chain' | 'cassette' | 'crankset' | 'bottom_bracket'
  | 'derailleur_front' | 'derailleur_rear' | 'battery_di2'
  | 'brake_lever_front' | 'brake_lever_rear'
  | 'brake_pads_front' | 'brake_pads_rear'
  | 'brake_rotor_front' | 'brake_rotor_rear' | 'brake_mount'
  | 'wheel_front' | 'wheel_rear'
  | 'tire_front' | 'tire_rear'
  | 'thru_axle_front' | 'thru_axle_rear'
  | 'cables' | 'bar_tape' | 'pedals' | 'other';

type EquipmentCategory = 'cadre' | 'transmission' | 'freins' | 'roues' | 'autre';

const CATEGORY_LABEL: Record<EquipmentCategory, string> = {
  cadre:        'Cadre',
  transmission: 'Transmission',
  freins:       'Freins',
  roues:        'Roues',
  autre:        'Autre',
};

// Display order of categories in the page.
const CATEGORY_ORDER: EquipmentCategory[] = ['cadre', 'transmission', 'freins', 'roues', 'autre'];

interface Equipment {
  id:              string;
  name:            string;
  kind:            EquipmentKind;
  installed_at:    string;
  installed_at_km: number;
  lifetime_km:     number;
  replaced_at:     string | null;
  notes:           string | null;
  /** Strava gear_id this piece is bound to, or null for "all bikes". */
  gear_id:         string | null;
  /** The bike's nickname when known (server denormalizes this). */
  gear_name:       string | null;
  totalKmToday:    number;
  kmSinceInstall:  number;
  wearRatio:       number;
}

interface Bike {
  id:           string;
  name:         string;
  primary_bike: boolean;
  totalKm:      number;
}

/** Per-kind UI metadata: category, icon, default lifetime, and the
 *  human label we surface in the type picker. Aligned with the SQL
 *  kind enum + sensible defaults from real-world cycling wear data
 *  (5500 km for a chain comes from 3000-8000 km typical range; 30000
 *  km rear wheel from 25-50k road carbon range; etc).
 *
 *  The `category` field drives the grouped layout in the page —
 *  cards with the same category are rendered under a shared header.
 */
// Defaults calibrated against real-world cycling wear data sources
// (Shimano service intervals, Bicycle Quarterly, road.cc / CyclingTips
// teardown reports). Per-kind reasoning is in the inline comments —
// when in doubt, we err on the *lower* side for safety-critical
// components (chain, brake pads) so the user gets a warning *before*
// damage cascades to dependent parts (a worn chain destroys cassettes).
const KIND_META: Record<EquipmentKind, { category: EquipmentCategory; icon: string; label: string; defaultLifetime: number }> = {
  // ─ Cadre ─────────────────────────────────────────────────────────
  frame:              { category: 'cadre',        icon: '□', label: 'Cadre',                   defaultLifetime: 80000 },  // carbone, ne s'use pas vraiment
  fork:               { category: 'cadre',        icon: 'Y', label: 'Fourche',                 defaultLifetime: 60000 },  // idem, un peu plus stressée
  // ─ Transmission ──────────────────────────────────────────────────
  chain:              { category: 'transmission', icon: '⚙', label: 'Chaîne',                  defaultLifetime: 3000 },   // 2000-4000 km, pièce la plus critique
  cassette:           { category: 'transmission', icon: '◐', label: 'Cassette',                defaultLifetime: 10000 },  // 8000-12000, ≈ 2-3 chaînes
  crankset:           { category: 'transmission', icon: '⊕', label: 'Pédalier',                defaultLifetime: 25000 },  // 20000-30000, ≈ 3-4 cassettes
  bottom_bracket:     { category: 'transmission', icon: '◎', label: 'Boîtier de pédalier',     defaultLifetime: 15000 },  // Pressfit 10-20k
  derailleur_rear:    { category: 'transmission', icon: '⊂', label: 'Dérailleur arrière',      defaultLifetime: 20000 },  // galets à 15-25k (le derailleur lui-même dure +)
  derailleur_front:   { category: 'transmission', icon: '⊃', label: 'Dérailleur avant',        defaultLifetime: 20000 },  // idem pour cohérence
  battery_di2:        { category: 'transmission', icon: '⚡', label: 'Batterie Di2',            defaultLifetime: 25000 },  // capacité baisse après plusieurs années
  // ─ Freins ────────────────────────────────────────────────────────
  brake_mount:        { category: 'freins',       icon: '⌒', label: 'Adaptateur frein',        defaultLifetime: 100000 }, // métal, monitoring seulement
  brake_lever_front:  { category: 'freins',       icon: '↿', label: 'Levier frein avant',      defaultLifetime: 45000 },  // quasi-illimité hors casse
  brake_lever_rear:   { category: 'freins',       icon: '↾', label: 'Levier frein arrière',    defaultLifetime: 45000 },  // idem
  brake_pads_front:   { category: 'freins',       icon: '◉', label: 'Plaquettes avant',        defaultLifetime: 2500 },   // 1500-4000, safety-critical (alerte tôt)
  brake_pads_rear:    { category: 'freins',       icon: '◉', label: 'Plaquettes arrière',      defaultLifetime: 2500 },   // idem
  brake_rotor_front:  { category: 'freins',       icon: '◷', label: 'Disque avant',            defaultLifetime: 20000 },  // 10000-30000, change when < 1.5mm
  brake_rotor_rear:   { category: 'freins',       icon: '◷', label: 'Disque arrière',          defaultLifetime: 20000 },  // idem
  // ─ Roues ─────────────────────────────────────────────────────────
  wheel_front:        { category: 'roues',        icon: '○', label: 'Roue avant',              defaultLifetime: 40000 },  // carbone, 30-60k
  wheel_rear:         { category: 'roues',        icon: '○', label: 'Roue arrière',            defaultLifetime: 30000 },  // use plus vite (motrice)
  tire_front:         { category: 'roues',        icon: '◯', label: 'Pneu avant',              defaultLifetime: 5500 },   // 3000-6000, use moins vite que l'arrière
  tire_rear:          { category: 'roues',        icon: '◯', label: 'Pneu arrière',            defaultLifetime: 3500 },   // motrice + porte + freine
  thru_axle_front:    { category: 'roues',        icon: '|', label: 'Axe traversant avant',    defaultLifetime: 100000 }, // métal, monitoring
  thru_axle_rear:     { category: 'roues',        icon: '|', label: 'Axe traversant arrière',  defaultLifetime: 100000 }, // idem
  // ─ Autre ─────────────────────────────────────────────────────────
  cables:             { category: 'autre',        icon: '⊥', label: 'Câbles + gaines',         defaultLifetime: 5000 },   // sans objet en Di2
  bar_tape:           { category: 'autre',        icon: '⌒', label: 'Guidoline',               defaultLifetime: 4000 },   // 1-2x/an confort
  pedals:             { category: 'autre',        icon: '⌖', label: 'Pédales',                 defaultLifetime: 20000 },  // long-lasting
  other:              { category: 'autre',        icon: '+', label: 'Autre',                    defaultLifetime: 5000 },
};

export function EquipmentPage() {
  const isMobile = useIsMobile();
  const [items,   setItems]   = useState<Equipment[]>([]);
  const [totalKm, setTotalKm] = useState(0);
  const [bikes,   setBikes]   = useState<Bike[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  // Editing surfaces the same modal as AddDialog but pre-filled with
  // the row's current values + PATCHes instead of POSTing. Keeping the
  // editing item in state (rather than mounting a separate dialog per
  // row) lets the same UI handle both cases.
  const [editingItem, setEditingItem] = useState<Equipment | null>(null);
  // Two tabs inside /equipement:
  //   pieces    — the existing wear-item tracker (chain, brakes, …)
  //   service   — the new carnet d'entretien (lube, bleed, tune, …)
  // Local state, resets when navigating away.
  const [tab, setTab] = useState<'pieces' | 'service'>('pieces');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch('/api/equipment');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json() as { totalKm: number; items: Equipment[]; bikes?: Bike[] };
      setItems(data.items);
      setTotalKm(data.totalKm);
      setBikes(data.bikes ?? []);
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

  /**
   * Bulk-assign every unbound piece to a target bike. Used by the
   * banner that surfaces when the user has bikes but no pieces are
   * scoped — common right after migrating from the pre-multi-bike
   * version. Confirms once, then fires N parallel PATCHes.
   */
  const bulkAssign = async (targetGearId: string, targetName: string) => {
    const unbound = items.filter(it => !it.gear_id);
    if (unbound.length === 0) return;
    const ok = confirm(
      `Associer les ${unbound.length} pièces non liées à « ${targetName} » ? `
      + `Leur usure sera désormais calculée sur les sorties de ce vélo uniquement.`,
    );
    if (!ok) return;
    await Promise.all(unbound.map(it =>
      fetch('/api/equipment', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: it.id, gear_id: targetGearId }),
      }),
    ));
    await load();
  };

  const unboundCount = items.filter(it => !it.gear_id).length;

  /**
   * Reset `installed_at_km = 0` on every piece bound to `gearId`.
   *
   * Used after the legacy → per-bike migration: pieces still carry an
   * `installed_at_km` from the all-bikes era (e.g. 160 km of mixed
   * Canyon + e-bike rides at install time), which under per-bike
   * scoping subtracts wrongly and under-reports wear by exactly that
   * amount. Resetting to 0 treats the piece as "new at this bike's
   * km=0" — the right model when you've just assigned a brand-new
   * inventory to a brand-new bike.
   */
  const resetInstalledKm = async (gearId: string, gearName: string) => {
    const onBike = items.filter(it => it.gear_id === gearId);
    if (onBike.length === 0) return;
    const ok = confirm(
      `Réinitialiser le km de pose à 0 pour les ${onBike.length} pièces sur « ${gearName} » ? `
      + `L'usure repartira à 0 km et augmentera au rythme des sorties sur ce vélo. `
      + `Utile après une migration depuis le suivi global.`,
    );
    if (!ok) return;
    await Promise.all(onBike.map(it =>
      fetch('/api/equipment', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: it.id, installed_at_km: 0 }),
      }),
    ));
    await load();
  };

  return (
    // The parent ExplorerApp main is `overflow: hidden` — each page
    // must provide its own scroll container with `flex:1 + overflowY:
    // auto`. Same pattern as FtpPage / WrappedPage.
    <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '20px 16px' : '40px 24px', background: tokens.cream }}>
      <div style={{ maxWidth: 1080, margin: '0 auto' }}>
        <Header totalKm={totalKm} bikes={bikes} items={items} onAdd={() => setShowAdd(true)} onResetBike={resetInstalledKm} />

        {/* Tab toggle — Pièces (wear tracker) vs Entretien (carnet).
            Sits just under the header so the bike pills stay above
            both views (they're shared context). */}
        <TabBar tab={tab} onChange={setTab} />

        {error && (
          <div style={{
            padding: 14, marginBottom: 16, background: '#FEE',
            border: '1px solid #FCC', borderRadius: 4,
            color: '#A00', fontFamily: "'Space Grotesk'", fontSize: 12,
          }}>
            {error}
          </div>
        )}

        {tab === 'service' ? (
          <ServiceLogPanel bikes={bikes} />
        ) : (
          <PiecesPanel
            loading={loading}
            items={items}
            unboundCount={unboundCount}
            bikes={bikes}
            isMobile={isMobile}
            onAdd={() => setShowAdd(true)}
            onBulkAssign={bulkAssign}
            onEdit={setEditingItem}
            onReplaced={markReplaced}
            onDelete={deleteItem}
          />
        )}

        {showAdd && (
          <AddDialog
            bikes={bikes}
            onClose={() => setShowAdd(false)}
            onCreated={async () => { setShowAdd(false); await load(); }}
          />
        )}

        {editingItem && (
          <EditDialog
            item={editingItem}
            bikes={bikes}
            onClose={() => setEditingItem(null)}
            onSaved={async () => { setEditingItem(null); await load(); }}
          />
        )}
      </div>
    </div>
  );
}

// ── Tab bar + Pieces panel (extracted so the Entretien tab is a clean
//    sibling of the Pièces tab without duplicating the loading/empty
//    plumbing) ──────────────────────────────────────────────────────

function TabBar({ tab, onChange }: { tab: 'pieces' | 'service'; onChange: (t: 'pieces' | 'service') => void }) {
  const tabs: { id: 'pieces' | 'service'; label: string; icon: string }[] = [
    { id: 'pieces',  label: 'Pièces d’usure', icon: '⚙' },
    { id: 'service', label: 'Carnet d’entretien', icon: '✦' },
  ];
  return (
    <div style={{
      display: 'flex', gap: 0,
      borderBottom: `1px solid ${tokens.creamBorder}`,
      marginBottom: 24,
    }}>
      {tabs.map(t => {
        const active = tab === t.id;
        return (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            style={{
              padding: '10px 16px',
              background: 'transparent', border: 'none',
              borderBottom: `2px solid ${active ? tokens.terra : 'transparent'}`,
              marginBottom: -1, cursor: 'pointer',
              fontFamily: "'Space Grotesk'", fontSize: 13,
              fontWeight: active ? 700 : 500, letterSpacing: '0.04em',
              color: active ? tokens.terra : tokens.inkMid,
              transition: 'color 0.12s, border-color 0.12s',
            }}
          >
            <span style={{ marginRight: 6 }}>{t.icon}</span>{t.label}
          </button>
        );
      })}
    </div>
  );
}

function PiecesPanel({
  loading, items, unboundCount, bikes, isMobile,
  onAdd, onBulkAssign, onEdit, onReplaced, onDelete,
}: {
  loading: boolean;
  items: Equipment[];
  unboundCount: number;
  bikes: Bike[];
  isMobile: boolean;
  onAdd: () => void;
  onBulkAssign: (gearId: string, name: string) => Promise<void>;
  onEdit: (item: Equipment) => void;
  onReplaced: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  return (
    <>
      {/* Bulk-assign nudge — when the user has bikes synced from Strava
          but pieces are still "any bike", their wear is inflated by
          rides on the other bike. Surface a one-click fix per bike. */}
      {!loading && unboundCount > 0 && bikes.length > 0 && (
        <UnboundBanner count={unboundCount} bikes={bikes} onAssign={onBulkAssign} />
      )}

      {loading ? (
        <p style={{ color: tokens.inkLight, fontFamily: "'Space Grotesk'", fontSize: 13 }}>Chargement…</p>
      ) : items.length === 0 ? (
        <EmptyState onAdd={onAdd} />
      ) : (
        // Group items by category for display. Items whose `kind`
        // isn't in KIND_META (shouldn't happen with the constraint
        // but defensive) fall into 'autre'.
        CATEGORY_ORDER.map(category => {
          const itemsInCat = items.filter(it => (KIND_META[it.kind]?.category ?? 'autre') === category);
          if (itemsInCat.length === 0) return null;
          return (
            <section key={category} style={{ marginBottom: 32 }}>
              <CategoryHeader category={category} count={itemsInCat.length} />
              <div style={{
                display: 'grid',
                gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(320px, 1fr))',
                gap: 16,
              }}>
                {itemsInCat.map(item => (
                  <EquipmentCard
                    key={item.id}
                    item={item}
                    onEdit={() => onEdit(item)}
                    onReplaced={() => onReplaced(item.id)}
                    onDelete={() => onDelete(item.id)}
                  />
                ))}
              </div>
            </section>
          );
        })
      )}
    </>
  );
}

// ── Header ──────────────────────────────────────────────────────────

function Header({
  totalKm, bikes, items, onAdd, onResetBike,
}: {
  totalKm: number;
  bikes: Bike[];
  items: Equipment[];
  onAdd: () => void;
  onResetBike: (gearId: string, gearName: string) => Promise<void>;
}) {
  return (
    <div style={{ marginBottom: 24, display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
      <div>
        <p style={{ fontFamily: "'Space Grotesk'", fontSize: 10, fontWeight: 700,
                    letterSpacing: '0.12em', color: tokens.terra, textTransform: 'uppercase', margin: '0 0 6px' }}>
          § MATÉRIEL
        </p>
        <h1 style={{ fontFamily: "'Playfair Display'", fontSize: 32, fontWeight: 800,
                     color: tokens.ink, margin: 0, lineHeight: 1.15 }}>
          {/* Le total global est désormais déclinable par vélo dans la
              rangée de pills juste en dessous — pas besoin de le
              dupliquer dans le titre. */}
          Suivi d&apos;usure
        </h1>
        <p style={{ fontFamily: "'Space Grotesk'", fontSize: 13, color: tokens.inkMid, lineHeight: 1.55, marginTop: 8, maxWidth: 640 }}>
          Suis l&apos;usure de chaîne, plaquettes, pneus, câbles… Ajoute une pièce à chaque
          fois que tu remplaces quelque chose. L&apos;usure se met à jour automatiquement
          à chaque nouvelle sortie vélo.
        </p>
        {/* Per-bike km pills — visible breakdown so the user can tell
            at a glance how the global total decomposes. Each pill is
            actionable: it carries a "reset install km" affordance for
            pieces bound to that bike (one-shot fix-up for the legacy
            global → per-bike migration). */}
        {bikes.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
            {bikes.map(b => {
              const piecesOnBike = items.filter(it => it.gear_id === b.id);
              return (
                <span key={b.id} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 8,
                  padding: '4px 4px 4px 10px', background: tokens.surface,
                  border: `1px solid ${tokens.creamBorder}`, borderRadius: 3,
                  fontFamily: "'Space Grotesk'", fontSize: 11,
                }}>
                  <span style={{ color: tokens.ink, fontWeight: 600 }}>{b.name}</span>
                  <span style={{ color: tokens.inkMid }}>{b.totalKm.toFixed(0)} km</span>
                  {b.primary_bike && (
                    <span style={{ color: tokens.terra, fontSize: 9, fontWeight: 700, letterSpacing: '0.08em' }}>
                      PRINCIPAL
                    </span>
                  )}
                  {piecesOnBike.length > 0 && (
                    <button
                      onClick={() => onResetBike(b.id, b.name)}
                      title={`Réinitialiser km de pose pour les ${piecesOnBike.length} pièces sur ${b.name}`}
                      style={{
                        padding: '2px 6px',
                        background: tokens.creamDark,
                        border: `1px solid ${tokens.creamBorder}`,
                        borderRadius: 2,
                        color: tokens.inkMid,
                        fontFamily: "'Space Grotesk'", fontSize: 10, fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      ↻ km
                    </button>
                  )}
                </span>
              );
            })}
          </div>
        )}
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

/**
 * Surfaces when ≥1 piece has no bike association AND ≥1 bike is known.
 * Lets the user one-click reassign every orphan piece to a target bike
 * — the typical case after rolling out per-bike scoping for the first
 * time, where every existing piece is implicitly on the user's main
 * bike but the row's gear_id is still NULL.
 */
function UnboundBanner({
  count, bikes, onAssign,
}: {
  count: number;
  bikes: Bike[];
  onAssign: (gearId: string, name: string) => Promise<void>;
}) {
  return (
    <div style={{
      marginBottom: 20, padding: 14,
      background: tokens.surface,
      border: `1px solid ${tokens.terra}`,
      borderLeft: `4px solid ${tokens.terra}`,
      borderRadius: 4,
    }}>
      <p style={{ fontFamily: "'Space Grotesk'", fontSize: 11, fontWeight: 700,
                  letterSpacing: '0.1em', color: tokens.terra, textTransform: 'uppercase',
                  margin: '0 0 6px' }}>
        § {count} pièce{count > 1 ? 's' : ''} non rattachée{count > 1 ? 's' : ''} à un vélo
      </p>
      <p style={{ fontFamily: "'Space Grotesk'", fontSize: 12, color: tokens.inkMid, margin: '0 0 10px', lineHeight: 1.5 }}>
        Sans rattachement, leur usure est calculée sur <strong>l&apos;ensemble</strong> de tes
        sorties vélo (route + e-bike). Rattache-les à un vélo pour ne compter que les km roulés
        avec ce vélo-là.
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {bikes.map(b => (
          <button key={b.id} onClick={() => onAssign(b.id, b.name)} style={{
            padding: '7px 12px', background: 'transparent',
            border: `1px solid ${tokens.terra}`, borderRadius: 3,
            color: tokens.terra, fontFamily: "'Space Grotesk'", fontSize: 11,
            fontWeight: 700, letterSpacing: '0.04em', cursor: 'pointer',
          }}>
            → Tout rattacher à {b.name}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Header above each category group. Acts as a visual anchor when the
 * user has many parts — without it the page is just a wall of cards.
 * Tag-style label matches the editorial system used across the rest
 * of the app ("§ MONTÉES DÉTECTÉES", "§ PLAN", etc.).
 */
function CategoryHeader({ category, count }: { category: EquipmentCategory; count: number }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
      gap: 12, marginBottom: 12, paddingBottom: 8,
      borderBottom: `1px solid ${tokens.creamBorder}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
        <span style={{
          fontFamily: "'Space Grotesk'", fontSize: 10, fontWeight: 700,
          letterSpacing: '0.12em', color: tokens.terra, textTransform: 'uppercase',
        }}>§ {CATEGORY_LABEL[category]}</span>
        <span style={{ width: 24, height: 1, background: tokens.creamBorder, alignSelf: 'center' }} />
        <span style={{ fontFamily: "'Space Grotesk'", fontSize: 10, color: tokens.inkLight }}>
          {count} pièce{count > 1 ? 's' : ''}
        </span>
      </div>
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
  item, onEdit, onReplaced, onDelete,
}: {
  item: Equipment;
  onEdit: () => void;
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

      {/* Bike chip — empty (not "tous vélos") when unbound so the
          user can see at a glance which pieces still need scoping. */}
      {item.gear_name ? (
        <div style={{
          display: 'inline-block', padding: '2px 7px',
          background: tokens.creamDark, borderRadius: 2,
          fontFamily: "'Space Grotesk'", fontSize: 10, fontWeight: 600,
          color: tokens.inkMid, marginBottom: 8,
        }}>
          {item.gear_name}
        </div>
      ) : (
        <div style={{
          display: 'inline-block', padding: '2px 7px',
          background: 'transparent',
          border: `1px dashed ${tokens.terra}`,
          borderRadius: 2,
          fontFamily: "'Space Grotesk'", fontSize: 10, fontWeight: 600,
          color: tokens.terra, marginBottom: 8,
        }}>
          tous vélos (à rattacher)
        </div>
      )}

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

      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <button onClick={onEdit} style={{
          padding: '6px 12px', background: 'transparent',
          border: `1px solid ${tokens.creamBorder}`, borderRadius: 3,
          color: tokens.inkMid, fontFamily: "'Space Grotesk'", fontSize: 11,
          fontWeight: 600, letterSpacing: '0.04em', cursor: 'pointer',
        }}>ÉDITER</button>
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
          marginLeft: 'auto',
        }}>×</button>
      </div>
    </div>
  );
}

// ── Add dialog ─────────────────────────────────────────────────────

function AddDialog({
  bikes, onClose, onCreated,
}: {
  bikes: Bike[];
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const [kind, setKind]               = useState<EquipmentKind>('chain');
  const [name, setName]               = useState('Chaîne');
  const [lifetime, setLifetime]       = useState(3000);
  const [installedKm, setInstalledKm] = useState<number | ''>('');
  const [installedAt, setInstalledAt] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes]             = useState('');
  // Default to the user's primary bike when present. Empty string =
  // "tous vélos" (= null on the wire).
  const [gearId, setGearId]           = useState<string>(
    bikes.find(b => b.primary_bike)?.id ?? bikes[0]?.id ?? '',
  );
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
          gear_id:         gearId || null,
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
            {CATEGORY_ORDER.map(cat => {
              // Group options by category for clarity — `<optgroup>`
              // is the native HTML way and works in all browsers.
              const kindsInCat = (Object.keys(KIND_META) as EquipmentKind[])
                .filter(k => KIND_META[k].category === cat);
              if (kindsInCat.length === 0) return null;
              return (
                <optgroup key={cat} label={CATEGORY_LABEL[cat]}>
                  {kindsInCat.map(k => (
                    <option key={k} value={k}>{KIND_META[k].icon} {KIND_META[k].label}</option>
                  ))}
                </optgroup>
              );
            })}
          </select>
        </Field>

        {/* Bike picker — only shown when we have bikes to pick from.
            If the user has just one bike (or none synced yet), the
            field is hidden and we send whatever gearId state was
            pre-seeded with. */}
        {bikes.length > 0 && (
          <Field label="Vélo">
            <select value={gearId} onChange={e => setGearId(e.target.value)} style={INPUT}>
              {bikes.map(b => (
                <option key={b.id} value={b.id}>
                  {b.name}{b.primary_bike ? ' (principal)' : ''} · {b.totalKm.toFixed(0)} km
                </option>
              ))}
              <option value="">Tous mes vélos (non-recommandé)</option>
            </select>
          </Field>
        )}

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

// ── Edit dialog ────────────────────────────────────────────────────

/**
 * Edit an existing equipment item. Sibling of AddDialog but pre-fills
 * the inputs from the current row's values and PATCHes instead of
 * POSTing. Only `name`, `lifetime_km`, and `notes` are editable — the
 * type / install date / starting km would change wear math
 * retroactively and are best handled via "delete + re-add".
 */
function EditDialog({
  item, bikes, onClose, onSaved,
}: {
  item: Equipment;
  bikes: Bike[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName]         = useState(item.name);
  const [lifetime, setLifetime] = useState(item.lifetime_km);
  const [notes, setNotes]       = useState(item.notes ?? '');
  const [gearId, setGearId]     = useState<string>(item.gear_id ?? '');
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState<string | null>(null);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const r = await fetch('/api/equipment', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          id:          item.id,
          name:        name.trim(),
          lifetime_km: lifetime,
          notes:       notes.trim() || null,
          // Send null explicitly when unbound so the server clears the
          // binding (vs. undefined which is "don't touch").
          gear_id:     gearId || null,
        }),
      });
      if (!r.ok && r.status !== 204) {
        const err = await r.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? `HTTP ${r.status}`);
      }
      await onSaved();
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
        <h2 style={{ fontFamily: "'Playfair Display'", fontSize: 20, fontWeight: 700, color: tokens.ink, margin: '0 0 8px' }}>
          Éditer
        </h2>
        <p style={{ fontFamily: "'Space Grotesk'", fontSize: 11, color: tokens.inkLight, margin: '0 0 20px' }}>
          Type, date de pose et km initiaux ne sont pas éditables ici (ils changeraient le calcul d&apos;usure rétroactivement). Si tu veux les corriger : supprime + re-ajoute.
        </p>

        {error && (
          <div style={{
            padding: 10, marginBottom: 14, background: '#FEE',
            border: '1px solid #FCC', borderRadius: 4, color: '#A00',
            fontFamily: "'Space Grotesk'", fontSize: 12,
          }}>{error}</div>
        )}

        <Field label="Nom">
          <input value={name} onChange={e => setName(e.target.value)} maxLength={80} style={INPUT} />
        </Field>

        {bikes.length > 0 && (
          <Field label="Vélo">
            <select value={gearId} onChange={e => setGearId(e.target.value)} style={INPUT}>
              {bikes.map(b => (
                <option key={b.id} value={b.id}>
                  {b.name}{b.primary_bike ? ' (principal)' : ''} · {b.totalKm.toFixed(0)} km
                </option>
              ))}
              <option value="">Tous mes vélos (non-recommandé)</option>
            </select>
          </Field>
        )}

        <Field label="Durée de vie estimée (km)">
          <input type="number" value={lifetime} min={100} max={50000} step={100}
            onChange={e => setLifetime(Number(e.target.value))} style={INPUT} />
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
          <button onClick={submit} disabled={saving || name.trim().length === 0} style={{
            padding: '10px 20px', background: tokens.terra, color: 'white',
            border: 'none', borderRadius: 3, cursor: 'pointer',
            fontFamily: "'Space Grotesk'", fontSize: 12, fontWeight: 700, letterSpacing: '0.06em',
          }}>{saving ? 'SAUVEGARDE…' : 'SAUVEGARDER'}</button>
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
