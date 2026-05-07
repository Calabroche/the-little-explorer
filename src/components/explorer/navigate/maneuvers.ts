// Human-friendly French/English text for OSRM maneuvers, plus an SVG
// arrow icon picker. Keeps the navigation panel and voice prompts
// driven by the same vocabulary.

import { NavStep } from './types';

type Lang = 'fr' | 'en';

// Map OSRM modifier → arrow glyph. Cycling routes mostly use turn /
// continue / roundabout, so a small inline SVG set is enough.
export function arrowFor(step: NavStep | null): string {
  if (!step) return '✓';
  if (step.type === 'arrive') return '🏁';
  if (step.type === 'depart') return '▲';
  if (step.type === 'roundabout' || step.type === 'rotary') return '↻';
  switch (step.modifier) {
    case 'left':         return '←';
    case 'sharp left':   return '⤺';
    case 'slight left':  return '↖';
    case 'right':        return '→';
    case 'sharp right':  return '⤻';
    case 'slight right': return '↗';
    case 'uturn':        return '⤴';
    case 'straight':
    default:             return '↑';
  }
}

const FR = {
  depart:           'Départ',
  arrive:           'Vous êtes arrivé',
  arriveSoon:       'Arrivée dans {d}',
  continue:         'Continuez tout droit',
  turnLeft:         'Tournez à gauche',
  turnRight:        'Tournez à droite',
  slightLeft:       'Légère gauche',
  slightRight:      'Légère droite',
  sharpLeft:        'Tournez fortement à gauche',
  sharpRight:       'Tournez fortement à droite',
  uturn:            'Faites demi-tour',
  straight:         'Continuez tout droit',
  roundabout:       'Au rond-point, prenez la {n}e sortie',
  roundaboutNoExit: 'Au rond-point',
  inDistance:       'Dans {d}, ',
  onto:             ' sur {name}',
};

const EN = {
  depart:           'Start',
  arrive:           'You have arrived',
  arriveSoon:       'Arriving in {d}',
  continue:         'Continue straight',
  turnLeft:         'Turn left',
  turnRight:        'Turn right',
  slightLeft:       'Slight left',
  slightRight:      'Slight right',
  sharpLeft:        'Sharp left',
  sharpRight:       'Sharp right',
  uturn:            'Make a U-turn',
  straight:         'Continue straight',
  roundabout:       'At the roundabout, take exit {n}',
  roundaboutNoExit: 'At the roundabout',
  inDistance:       'In {d}, ',
  onto:             ' onto {name}',
};

const ORDINAL_FR = ['', '1ère', '2e', '3e', '4e', '5e', '6e', '7e'];

function dict(lang: Lang) { return lang === 'en' ? EN : FR; }

/** Format a distance as a short, speech-friendly string. */
export function formatDistance(m: number, lang: Lang = 'fr'): string {
  if (m < 30)   return lang === 'fr' ? 'maintenant'    : 'now';
  if (m < 1000) return `${Math.round(m / 10) * 10} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

/** Short core phrase ("Tournez à gauche") — no distance, no street. */
export function maneuverCore(step: NavStep, lang: Lang = 'fr'): string {
  const D = dict(lang);
  if (step.type === 'depart')   return D.depart;
  if (step.type === 'arrive')   return D.arrive;
  if (step.type === 'roundabout' || step.type === 'rotary') {
    if (step.exit && step.exit > 0 && step.exit < ORDINAL_FR.length) {
      const ord = lang === 'fr' ? ORDINAL_FR[step.exit] : `${step.exit}`;
      return D.roundabout.replace('{n}', ord);
    }
    return D.roundaboutNoExit;
  }
  switch (step.modifier) {
    case 'left':         return D.turnLeft;
    case 'right':        return D.turnRight;
    case 'slight left':  return D.slightLeft;
    case 'slight right': return D.slightRight;
    case 'sharp left':   return D.sharpLeft;
    case 'sharp right':  return D.sharpRight;
    case 'uturn':        return D.uturn;
    case 'straight':
    default:             return D.continue;
  }
}

/** Full speech sentence with optional distance prefix and street name. */
export function maneuverSentence(
  step: NavStep,
  distanceM: number | null,
  lang: Lang = 'fr',
): string {
  const D    = dict(lang);
  const core = maneuverCore(step, lang);
  const onto = step.name && step.type !== 'arrive' && step.type !== 'depart'
    ? D.onto.replace('{name}', step.name)
    : '';
  if (distanceM == null || step.type === 'arrive') return `${core}${onto}`;
  if (distanceM < 30) return `${core}${onto}`;
  return `${D.inDistance.replace('{d}', formatDistance(distanceM, lang))}${core.toLowerCase()}${onto}`;
}

/**
 * Decide whether a fresh prompt should fire at this distance, given
 * what's already been announced for this step.
 *
 * We schedule three prompts per step: ~500m / ~150m / ~30m. Once the
 * user crosses each threshold (going down), that level is consumed.
 */
export type AnnounceLevel = 'far' | 'mid' | 'near' | 'now';
export function pickAnnouncement(
  distanceM: number,
  alreadyAnnounced: Set<AnnounceLevel>,
): AnnounceLevel | null {
  if (distanceM < 30  && !alreadyAnnounced.has('now'))  return 'now';
  if (distanceM < 150 && !alreadyAnnounced.has('near')) return 'near';
  if (distanceM < 500 && !alreadyAnnounced.has('mid'))  return 'mid';
  if (distanceM < 1200 && !alreadyAnnounced.has('far')) return 'far';
  return null;
}
