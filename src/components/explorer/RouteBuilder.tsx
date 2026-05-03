'use client';

import { useState, useMemo } from 'react';
import { tokens, Activity } from './tokens';
import { Label, useIsMobile } from './ui';
import { RouteModal, Proposal } from './RouteModal';
import { useT } from '@/i18n';

// ── Bibliothèque de boucles ─────────────────────────────────────────────────
// Toutes au départ et arrivée de Chemin du Manoir, Dardilly (HOME = [45.8183, 4.7521]).
// Waypoints listés dans l'ordre de parcours (sens horaire ou antihoraire).

type Direction = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';

interface LibraryRoute {
  name: string;
  dist: number;          // km
  elev: number;          // m D+
  direction: Direction;
  hilly: boolean;
  waypoints: [number, number][];
}

// Waypoints calés sur des centres-villes / intersections de routes départementales
// (D6, D7, D16, D70, D75, D77, D389…) pour qu'OSRM colle aux axes principaux et
// ne fasse jamais de demi-tour sur une petite voie sans issue.
//
// Coordonnées de référence :
//   Limonest centre        [45.8316, 4.7706]  D16/D73
//   Saint-Didier-au-MO     [45.8418, 4.7894]  D75/D73e
//   Saint-Cyr-au-MO        [45.8553, 4.7921]  D6/D73e
//   Saint-Romain-au-MO     [45.8385, 4.8197]  D6
//   Curis-au-MO            [45.8915, 4.8089]  D6
//   Poleymieux-au-MO       [45.8918, 4.7765]  D77/D6
//   Champagne-au-MO        [45.7937, 4.7770]  D73/D67
//   Charbonnières          [45.7848, 4.7591]  D7/D70
//   Marcy-l'Étoile         [45.7806, 4.7280]  D7
//   La Tour-de-Salvagny    [45.8062, 4.7090]  D7/D77
//   Lentilly centre        [45.8170, 4.7048]  D70/D70e
//   Lentilly nord          [45.8351, 4.6965]  D389
//   Dommartin              [45.8455, 4.7196]  D70
//   Lozanne                [45.8514, 4.6826]  D389/D70
//   Civrieux-d'Azergues    [45.8666, 4.7191]  D389/D16
//   Chazay-d'Azergues      [45.8765, 4.6990]  D30/D70e
//   Chasselay              [45.8835, 4.7757]  D16
//   Chessy-les-Mines       [45.8980, 4.6828]  D389/D70
//   L'Arbresle             [45.8369, 4.6175]  D389/D7
//   Sain-Bel               [45.8204, 4.5703]  D7
//   Vaugneray              [45.7501, 4.7065]  D70/D11
//   Tarare                 [45.8989, 4.4310]  D389/N7

const LIBRARY: LibraryRoute[] = [
  // ── Récup & courtes (12-20 km, peu de D+) ──────────────────────────────────
  { name: 'Marcy / Charbonnières',          dist: 13, elev: 100, direction: 'S',  hilly: false,
    waypoints: [[45.7848,4.7591],[45.7806,4.7280]] },
  { name: 'Lentilly aller',                 dist: 14, elev: 130, direction: 'NW', hilly: false,
    waypoints: [[45.8351,4.6965],[45.8170,4.7048]] },
  { name: 'Saint-Didier doux',              dist: 15, elev: 180, direction: 'NE', hilly: false,
    waypoints: [[45.8316,4.7706],[45.8418,4.7894]] },
  { name: 'Lozanne plat',                   dist: 17, elev: 220, direction: 'NW', hilly: false,
    waypoints: [[45.8351,4.6965],[45.8514,4.6826]] },
  { name: 'Tour des trois villages',        dist: 19, elev: 200, direction: 'S',  hilly: false,
    waypoints: [[45.7937,4.7770],[45.7848,4.7591],[45.7806,4.7280]] },
  { name: 'Lentilly / Charbonnières doux',  dist: 20, elev: 230, direction: 'W',  hilly: false,
    waypoints: [[45.8351,4.6965],[45.8170,4.7048],[45.7848,4.7591]] },

  // ── Multi-sommets courts à fort D+ (14-22 km, vallonné Monts d'Or) ─────────
  { name: 'Mont Cindre direct',             dist: 14, elev: 320, direction: 'NE', hilly: true,
    waypoints: [[45.8316,4.7706],[45.8553,4.7921],[45.8418,4.7894]] },
  { name: 'Mont Verdun + Mont Cindre',      dist: 16, elev: 430, direction: 'N',  hilly: true,
    waypoints: [[45.8316,4.7706],[45.8418,4.7894],[45.8553,4.7921],[45.7937,4.7770]] },
  { name: 'Saint-Cyr / Saint-Romain',       dist: 18, elev: 480, direction: 'NE', hilly: true,
    waypoints: [[45.8316,4.7706],[45.8553,4.7921],[45.8385,4.8197],[45.8418,4.7894]] },
  { name: 'Triple sommet Monts d\'Or',      dist: 20, elev: 550, direction: 'N',  hilly: true,
    waypoints: [[45.8316,4.7706],[45.8553,4.7921],[45.8385,4.8197],[45.8553,4.7921],[45.8418,4.7894]] },
  { name: 'Mont Cindre × Champagne ×2',     dist: 22, elev: 600, direction: 'NE', hilly: true,
    waypoints: [[45.8316,4.7706],[45.8553,4.7921],[45.8418,4.7894],[45.7937,4.7770],[45.8316,4.7706],[45.8553,4.7921]] },

  // ── Endurance moyennes (20-30 km) ──────────────────────────────────────────
  { name: 'Mont Verdun',                    dist: 22, elev: 380, direction: 'NE', hilly: true,
    waypoints: [[45.8316,4.7706],[45.8553,4.7921],[45.8418,4.7894]] },
  { name: 'Lentilly classique',             dist: 22, elev: 260, direction: 'W',  hilly: false,
    waypoints: [[45.8351,4.6965],[45.8170,4.7048],[45.7848,4.7591]] },
  { name: 'Civrieux / Lozanne',             dist: 24, elev: 300, direction: 'NW', hilly: false,
    waypoints: [[45.8316,4.7706],[45.8666,4.7191],[45.8514,4.6826]] },
  { name: 'Marcy / Lentilly',               dist: 26, elev: 280, direction: 'W',  hilly: false,
    waypoints: [[45.8351,4.6965],[45.8170,4.7048],[45.7806,4.7280],[45.7848,4.7591]] },
  { name: 'Saint-Cyr boucle',               dist: 28, elev: 420, direction: 'NE', hilly: true,
    waypoints: [[45.8316,4.7706],[45.8418,4.7894],[45.8553,4.7921],[45.7937,4.7770]] },

  // ── Course aux km (30-40 km) ───────────────────────────────────────────────
  { name: 'Lozanne grand tour',             dist: 30, elev: 380, direction: 'NW', hilly: false,
    waypoints: [[45.8316,4.7706],[45.8666,4.7191],[45.8514,4.6826],[45.8170,4.7048]] },
  { name: 'Vaugneray',                      dist: 32, elev: 480, direction: 'SW', hilly: true,
    waypoints: [[45.8170,4.7048],[45.7501,4.7065],[45.7848,4.7591]] },
  { name: 'Chessy via Civrieux',            dist: 34, elev: 460, direction: 'NW', hilly: true,
    waypoints: [[45.8316,4.7706],[45.8666,4.7191],[45.8980,4.6828],[45.8514,4.6826]] },
  { name: "L'Arbresle plat",                dist: 36, elev: 420, direction: 'W',  hilly: false,
    waypoints: [[45.8170,4.7048],[45.8369,4.6175],[45.7848,4.7591]] },
  { name: 'Chessy via Chazay',              dist: 38, elev: 480, direction: 'NW', hilly: true,
    waypoints: [[45.8316,4.7706],[45.8666,4.7191],[45.8765,4.6990],[45.8980,4.6828],[45.8514,4.6826]] },

  // ── Volume + relief (40-50 km, vallonné) ───────────────────────────────────
  { name: "Triple col Monts d'Or",          dist: 40, elev: 600, direction: 'N',  hilly: true,
    waypoints: [[45.8316,4.7706],[45.8918,4.7765],[45.8915,4.8089],[45.8385,4.8197],[45.8553,4.7921],[45.8418,4.7894]] },
  { name: 'Chessy / Vaugneray',             dist: 43, elev: 520, direction: 'W',  hilly: true,
    waypoints: [[45.8514,4.6826],[45.8980,4.6828],[45.8170,4.7048],[45.7501,4.7065],[45.7848,4.7591]] },
  { name: 'Curis / Poleymieux complet',     dist: 46, elev: 620, direction: 'N',  hilly: true,
    waypoints: [[45.8316,4.7706],[45.8918,4.7765],[45.8915,4.8089],[45.8385,4.8197],[45.8553,4.7921],[45.8418,4.7894],[45.7937,4.7770]] },
  { name: "L'Arbresle / Vaugneray",         dist: 50, elev: 580, direction: 'W',  hilly: true,
    waypoints: [[45.8514,4.6826],[45.8369,4.6175],[45.7501,4.7065],[45.7848,4.7591]] },

  // ── Grandes boucles (55-65 km) ─────────────────────────────────────────────
  { name: "Sain-Bel / L'Arbresle",          dist: 55, elev: 680, direction: 'W',  hilly: true,
    waypoints: [[45.8514,4.6826],[45.8369,4.6175],[45.8204,4.5703],[45.7501,4.7065],[45.7848,4.7591]] },
  { name: 'Tarare / Vaugneray',             dist: 60, elev: 760, direction: 'W',  hilly: true,
    waypoints: [[45.8514,4.6826],[45.8369,4.6175],[45.8989,4.4310],[45.7501,4.7065],[45.7848,4.7591]] },

  // ── Très longues : Beaujolais sud + Tarare étendu (70-110 km) ──────────────
  // POIs ajoutés (intersections D-roads) :
  //   Anse                 [45.9362, 4.7224] — D70/D6 Saône
  //   Charnay              [45.8944, 4.6633] — D70/D38
  //   Theizé               [45.9162, 4.6122] — D38/D70
  //   Le Bois-d'Oingt      [45.9249, 4.5908] — D485/D38
  //   Oingt                [45.9285, 4.5894] — D120
  //   Pontcharra-sur-T.    [45.8728, 4.5077] — D389/N7
  //   Saint-Romain-de-Popey[45.8581, 4.5158] — D389
  { name: 'Pontcharra / Tarare',            dist: 70, elev: 850,  direction: 'W',  hilly: true,
    waypoints: [[45.8514,4.6826],[45.8980,4.6828],[45.9249,4.5908],[45.8728,4.5077],[45.8204,4.5703],[45.7501,4.7065],[45.7848,4.7591]] },
  { name: 'Oingt / Tarare',                 dist: 75, elev: 900,  direction: 'W',  hilly: true,
    waypoints: [[45.8514,4.6826],[45.8980,4.6828],[45.9285,4.5894],[45.8989,4.4310],[45.8204,4.5703],[45.7501,4.7065]] },
  { name: 'Tour Beaujolais sud',            dist: 85, elev: 1050, direction: 'NW', hilly: true,
    waypoints: [[45.9362,4.7224],[45.8944,4.6633],[45.9162,4.6122],[45.9285,4.5894],[45.8989,4.4310],[45.8204,4.5703],[45.7501,4.7065]] },
  { name: 'Tour crus du Beaujolais',        dist: 95, elev: 1200, direction: 'NW', hilly: true,
    waypoints: [[45.9362,4.7224],[45.8944,4.6633],[45.9249,4.5908],[45.9162,4.6122],[45.8989,4.4310],[45.8728,4.5077],[45.8204,4.5703],[45.7501,4.7065]] },
  { name: 'Grande randonnée Beaujolais',    dist: 110, elev: 1400, direction: 'NW', hilly: true,
    waypoints: [[45.9362,4.7224],[45.8944,4.6633],[45.9249,4.5908],[45.9162,4.6122],[45.8989,4.4310],[45.8581,4.5158],[45.8728,4.5077],[45.8204,4.5703],[45.7501,4.7065]] },
];

// ── Filtrage & scoring ───────────────────────────────────────────────────────

interface BuilderInputs {
  targetDist: number;
  targetElev: number;
  direction: Direction | 'any';
  terrain: 'any' | 'flat' | 'hilly';
}

const DIST_TOLERANCE_KM = 5;   // ±5 km absolu — toujours respecté (strict ET fallback)
const ELEV_TOLERANCE    = 0.10; // ±10% sur D+ (uniquement en mode strict)

const ADJACENT: Record<Direction, Direction[]> = {
  N:  ['NE', 'NW'], NE: ['N', 'E'],
  E:  ['NE', 'SE'], SE: ['E', 'S'],
  S:  ['SE', 'SW'], SW: ['S', 'W'],
  W:  ['SW', 'NW'], NW: ['W', 'N'],
};

function isWithinDistanceWindow(r: LibraryRoute, target: number): boolean {
  return Math.abs(r.dist - target) <= DIST_TOLERANCE_KM;
}

function passesHardFilter(r: LibraryRoute, inp: BuilderInputs): boolean {
  // Distance : ±5 km absolu (toujours strict)
  if (!isWithinDistanceWindow(r, inp.targetDist)) return false;

  // D+ : ±10% (mode strict uniquement)
  const elevOk = Math.abs(r.elev - inp.targetElev) / Math.max(inp.targetElev, 1) <= ELEV_TOLERANCE;
  if (!elevOk) return false;

  // terrain : strict si choisi
  if (inp.terrain !== 'any') {
    const wantHilly = inp.terrain === 'hilly';
    if (r.hilly !== wantHilly) return false;
  }

  // direction : même direction OU adjacente (±45°)
  if (inp.direction !== 'any') {
    if (r.direction !== inp.direction && !ADJACENT[inp.direction].includes(r.direction)) return false;
  }

  return true;
}

function scoreRoute(r: LibraryRoute, inp: BuilderInputs): number {
  // Plus le score est bas, meilleur le match. Utilisé pour le tri (strict ou fallback).
  const distScore = Math.abs(r.dist - inp.targetDist) / Math.max(inp.targetDist, 1);
  const elevScore = Math.abs(r.elev - inp.targetElev) / Math.max(inp.targetElev, 1);
  let dirScore = 0;
  if (inp.direction !== 'any') {
    if (r.direction === inp.direction) dirScore = 0;
    else if (ADJACENT[inp.direction].includes(r.direction)) dirScore = 0.3;
    else dirScore = 0.8;
  }
  let terrainScore = 0;
  if (inp.terrain !== 'any') {
    const wantHilly = inp.terrain === 'hilly';
    terrainScore = r.hilly === wantHilly ? 0 : 0.5;
  }
  return distScore * 2 + elevScore * 1.5 + dirScore + terrainScore;
}

// ── Component ────────────────────────────────────────────────────────────────

export function RouteBuilder({ activities }: { activities: Activity[] }) {
  const isMobile = useIsMobile();
  const { t } = useT();

  const sorted = [...activities].sort((a, b) => new Date(b.rawDate).getTime() - new Date(a.rawDate).getTime());
  const last5  = sorted.slice(0, 5);
  const avgDist = last5.length ? Math.round(last5.reduce((s, a) => s + a.distance, 0) / last5.length) : 25;
  const avgElev = last5.length ? Math.round(last5.reduce((s, a) => s + a.elevation, 0) / last5.length) : 300;
  const tssVals = last5.map(a => a.tss).filter((t): t is number => t != null);
  const avgTSS  = tssVals.length ? Math.round(tssVals.reduce((s, v) => s + v, 0) / tssVals.length) : 80;

  const [targetDist, setTargetDist] = useState(avgDist);
  const [targetElev, setTargetElev] = useState(avgElev);
  const [direction, setDirection]   = useState<Direction | 'any'>('any');
  const [terrain, setTerrain]       = useState<'any' | 'flat' | 'hilly'>('any');
  const [hasGenerated, setHasGenerated] = useState(false);
  const [selected, setSelected]     = useState<Proposal | null>(null);

  const result = useMemo(() => {
    if (!hasGenerated) return { matches: [] as LibraryRoute[], approximate: false };
    const inp: BuilderInputs = { targetDist, targetElev, direction, terrain };

    // 1ère passe : filtre strict ±10% sur dist & D+ + terrain/direction
    const strict = LIBRARY
      .filter(r => passesHardFilter(r, inp))
      .map(r => ({ r, score: scoreRoute(r, inp) }))
      .sort((a, b) => a.score - b.score)
      .slice(0, 5)
      .map(({ r }) => r);

    if (strict.length > 0) return { matches: strict, approximate: false };

    // 2e passe (fallback) : on relâche D+/direction/terrain mais on garde
    // TOUJOURS la fenêtre ±5 km sur la distance.
    const fallback = LIBRARY
      .filter(r => isWithinDistanceWindow(r, inp.targetDist))
      .map(r => ({ r, score: scoreRoute(r, inp) }))
      .sort((a, b) => a.score - b.score)
      .slice(0, 5)
      .map(({ r }) => r);

    return { matches: fallback, approximate: true };
  }, [hasGenerated, targetDist, targetElev, direction, terrain]);

  const matches = result.matches;
  const approximate = result.approximate;

  const buildProposal = (r: LibraryRoute): Proposal => {
    const tss = Math.round(avgTSS * (r.dist / Math.max(avgDist, 1)) * (r.hilly ? 1.15 : 1.0));
    const color = approximate
      ? '#c4602a'
      : (r.hilly ? (r.dist >= 40 ? '#5a7a9e' : '#c4602a') : (r.dist >= 30 ? '#9b6fb5' : tokens.terra));
    return {
      tag: approximate ? t('planner.approximation') : t('planner.generated'), color,
      title: r.name,
      dist: r.dist, elev: r.elev, tss,
      tracks: [{ name: r.name, dist: r.dist, elev: r.elev, tss, waypoints: r.waypoints }],
      desc: `${r.dist} km · ${r.elev} m D+ · ${r.direction}${r.hilly ? ' · ' + t('planner.terrainHilly') : ' · ' + t('planner.terrainFlat')}`,
      cues: [
        t('planner.cardCue1'),
        r.hilly ? t('planner.cardCueHilly') : t('planner.cardCueFlat'),
        t('planner.cardCueTss', { tss }),
      ],
    };
  };

  const CARD: React.CSSProperties = {
    background: tokens.surface, border: `1px solid ${tokens.creamBorder}`,
    borderRadius: 4, padding: 24, marginBottom: 32,
  };

  const FIELD: React.CSSProperties = {
    display: 'flex', flexDirection: 'column', gap: 8,
  };

  const SLIDER: React.CSSProperties = {
    width: '100%', accentColor: tokens.terra, cursor: 'pointer',
  };

  const PILL = (active: boolean): React.CSSProperties => ({
    padding: '7px 12px',
    borderRadius: 3,
    border: `1px solid ${active ? tokens.terra : tokens.creamBorder}`,
    background: active ? tokens.terra + '18' : tokens.creamDark,
    color: active ? tokens.terra : tokens.inkMid,
    fontFamily: "'Space Grotesk'", fontSize: 11, fontWeight: active ? 700 : 500,
    cursor: 'pointer', letterSpacing: '0.05em',
    transition: 'all 0.12s',
  });

  return (
    <>
      {selected && <RouteModal proposal={selected} onClose={() => setSelected(null)} />}
      <div style={CARD}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
          <Label style={{ color: tokens.terra }}>{t('planner.tag')}</Label>
          <div style={{ width: 24, height: 1, background: tokens.creamBorder }} />
          <Label>{t('planner.label')}</Label>
        </div>
        <div style={{ fontFamily: "'Space Grotesk'", fontSize: 11, color: tokens.inkLight, marginBottom: 20 }}>
          {t('planner.intro')}{' '}
          <strong style={{ color: tokens.terra }}>{t('planner.introBold')}</strong>{' '}
          {t('planner.introEnd')} <strong style={{ color: tokens.terra }}>{t('planner.introEndBold')}</strong> {t('planner.introEndEnd')}
        </div>

        {/* Form */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
          gap: 20,
          marginBottom: 18,
        }}>
          {/* Distance */}
          <div style={FIELD}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <Label>{t('planner.distance')}</Label>
              <span style={{ fontFamily: "'Playfair Display'", fontSize: 22, fontWeight: 700, color: tokens.ink }}>
                {targetDist}<span style={{ fontFamily: "'Space Grotesk'", fontSize: 11, color: tokens.inkLight, marginLeft: 3 }}>km</span>
              </span>
            </div>
            <input type="range" min={10} max={120} step={1} value={targetDist}
              onChange={e => setTargetDist(+e.target.value)} style={SLIDER} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: "'Space Grotesk'", fontSize: 9, color: tokens.inkLight }}>
              <span>10 km</span><span>120 km</span>
            </div>
          </div>

          {/* D+ */}
          <div style={FIELD}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <Label>{t('planner.elev')}</Label>
              <span style={{ fontFamily: "'Playfair Display'", fontSize: 22, fontWeight: 700, color: tokens.ink }}>
                {targetElev}<span style={{ fontFamily: "'Space Grotesk'", fontSize: 11, color: tokens.inkLight, marginLeft: 3 }}>m</span>
              </span>
            </div>
            <input type="range" min={50} max={1000} step={10} value={targetElev}
              onChange={e => setTargetElev(+e.target.value)} style={SLIDER} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: "'Space Grotesk'", fontSize: 9, color: tokens.inkLight }}>
              <span>50 m</span><span>1000 m</span>
            </div>
          </div>

          {/* Terrain */}
          <div style={FIELD}>
            <Label>{t('planner.terrain')}</Label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {([
                { val: 'any',   lbl: t('planner.terrainAny') },
                { val: 'flat',  lbl: t('planner.terrainFlat') },
                { val: 'hilly', lbl: t('planner.terrainHilly') },
              ] as const).map(o => (
                <button key={o.val} onClick={() => setTerrain(o.val)} style={PILL(terrain === o.val)}>
                  {o.lbl}
                </button>
              ))}
            </div>
          </div>

          {/* Direction */}
          <div style={FIELD}>
            <Label>{t('planner.direction')}</Label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {(['any','N','NE','E','SE','S','SW','W','NW'] as const).map(d => (
                <button key={d} onClick={() => setDirection(d)} style={PILL(direction === d)}>
                  {d === 'any' ? t('planner.dirAny') : d}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Generate button */}
        <button
          onClick={() => setHasGenerated(true)}
          style={{
            width: '100%',
            padding: '14px 20px',
            background: tokens.terra,
            color: 'white',
            border: 'none',
            borderRadius: 3,
            cursor: 'pointer',
            fontFamily: "'Space Grotesk'", fontSize: 12, fontWeight: 700,
            letterSpacing: '0.15em',
          }}
        >
          {t('planner.generate')}
        </button>

        {/* Results */}
        {hasGenerated && (
          <div style={{ marginTop: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
              <Label style={{ color: approximate ? tokens.terra : tokens.green }}>
                § {matches.length} {approximate ? t('planner.approxResults') : t('planner.results')}
              </Label>
              <div style={{ flex: 1, height: 1, background: tokens.creamBorder }} />
              <span style={{ fontFamily: "'Space Grotesk'", fontSize: 10, color: tokens.inkLight }}>
                {t('planner.sortedBy')}
              </span>
            </div>

            {approximate && matches.length > 0 && (
              <div style={{
                fontFamily: "'Space Grotesk'", fontSize: 11, color: tokens.inkMid,
                padding: '12px 16px', background: tokens.creamDark, borderRadius: 4,
                borderLeft: `3px solid ${tokens.terra}`, lineHeight: 1.6, marginBottom: 14,
              }}>
                <strong style={{ color: tokens.ink }}>{t('planner.approxBanner1')}</strong>{' '}
                {t('planner.approxBanner2')} <strong style={{ color: tokens.terra }}>±5 km</strong> ({targetDist - 5}–{targetDist + 5} km).{' '}
                {t('planner.approxBanner3', { n: matches.length })}
              </div>
            )}

            {matches.length === 0 ? (
              <div style={{
                fontFamily: "'Space Grotesk'", fontSize: 12, color: tokens.inkMid,
                padding: 18, background: tokens.creamDark, borderRadius: 4,
                borderLeft: `3px solid ${tokens.terra}`, lineHeight: 1.7,
              }}>
                <strong style={{ color: tokens.ink }}>{t('planner.noneTitle', { min: targetDist - 5, max: targetDist + 5 })}</strong><br />
                {t('planner.noneBody')}
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, 1fr)', gap: 12 }}>
                {matches.map((r, i) => {
                  const p = buildProposal(r);
                  const distDelta = r.dist - targetDist;
                  const elevDelta = r.elev - targetElev;
                  return (
                    <div key={i}
                      onClick={() => setSelected(p)}
                      style={{
                        border: `1px solid ${tokens.creamBorder}`,
                        borderLeft: `3px solid ${p.color}`,
                        borderRadius: 4,
                        padding: 14,
                        cursor: 'pointer',
                        transition: 'box-shadow 0.15s',
                        background: tokens.creamDark,
                      }}
                      onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.08)')}
                      onMouseLeave={e => (e.currentTarget.style.boxShadow = 'none')}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                        <span style={{ fontFamily: "'Playfair Display'", fontSize: 15, fontWeight: 700, color: tokens.ink, lineHeight: 1.3 }}>
                          {r.name}
                        </span>
                        <span style={{ fontFamily: "'Space Grotesk'", fontSize: 9, fontWeight: 700, color: p.color, letterSpacing: '0.1em', flexShrink: 0, marginLeft: 8 }}>
                          #{i + 1}
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: 14, marginBottom: 8, flexWrap: 'wrap' }}>
                        <Stat label="DIST" value={r.dist} unit="km" delta={distDelta} />
                        <Stat label="D+"   value={r.elev} unit="m"  delta={elevDelta} />
                        <Stat label="DIR"  value={r.direction} />
                        <Stat label="TYPE" value={r.hilly ? 'vallonné' : 'roulant'} />
                      </div>
                      <div style={{ fontFamily: "'Space Grotesk'", fontSize: 10, color: tokens.inkLight, letterSpacing: '0.05em' }}>
                        VOIR LE TRACÉ →
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}

function Stat({ label, value, unit, delta }: { label: string; value: string | number; unit?: string; delta?: number }) {
  const showDelta = delta != null && delta !== 0;
  const deltaColor = delta != null && Math.abs(delta) <= (typeof value === 'number' && value > 100 ? 50 : 5)
    ? tokens.green : tokens.inkLight;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontFamily: "'Space Grotesk'", fontSize: 8, color: tokens.inkLight, letterSpacing: '0.1em', fontWeight: 700 }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
        <span style={{ fontFamily: "'Playfair Display'", fontSize: 14, fontWeight: 700, color: tokens.ink }}>
          {value}{unit && <span style={{ fontFamily: "'Space Grotesk'", fontSize: 9, color: tokens.inkLight, marginLeft: 2 }}>{unit}</span>}
        </span>
        {showDelta && (
          <span style={{ fontFamily: "'Space Grotesk'", fontSize: 9, color: deltaColor }}>
            {delta! > 0 ? '+' : ''}{delta}
          </span>
        )}
      </div>
    </div>
  );
}
