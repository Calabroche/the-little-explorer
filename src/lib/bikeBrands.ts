/**
 * Well-known bike brands — shared by the "Trouver un professionnel" brand
 * picker (dropdown) and the server-side website scan that detects which brands
 * a shop mentions.
 */
export const BIKE_BRANDS: string[] = [
  'Canyon', 'Specialized', 'Trek', 'Giant', 'Cannondale', 'Scott', 'Cube',
  'BMC', 'Bianchi', 'Merida', 'Orbea', 'Lapierre', 'Cervélo', 'Pinarello',
  'Look', 'Focus', 'Wilier', 'Colnago', 'Ridley', 'Santa Cruz', 'Decathlon',
  'Van Rysel', 'Moustache', 'Riese & Müller',
];

function deaccent(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Brands whose name appears as a PROPER NOUN (capitalised or all-caps) word in
 *  `text`. The capitalisation requirement is what makes this usable: many brand
 *  names are common words (Focus, Giant, Look, Scott…), so we only count them
 *  when written like a name — "Focus"/"FOCUS" yes, "focus sur" no. Accent- and
 *  whitespace-insensitive, word-boundary matched. Best-effort: a mention isn't
 *  proof of an official dealership. */
export function brandsInText(text: string): string[] {
  const T = deaccent(text);
  return BIKE_BRANDS.filter(b => {
    const base = deaccent(b).replace(/&/g, ' ').replace(/[^A-Za-z0-9 ]/g, '').trim();
    if (!base) return false;
    const cap = base.replace(/\s+/g, '\\s+');                 // display caps (Van Rysel)
    const up  = base.toUpperCase().replace(/\s+/g, '\\s+');   // all-caps (logos / headings)
    return new RegExp(`(^|[^A-Za-z0-9])(${cap}|${up})([^A-Za-z0-9]|$)`).test(T);
  });
}
