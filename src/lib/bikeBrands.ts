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

function norm(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Brands (display names) whose name appears as a word in `text`. Accent- and
 *  case-insensitive, word-boundary matched so "look" doesn't hit "looking".
 *  Best-effort: a mention isn't proof of an official dealership. */
export function brandsInText(text: string): string[] {
  const t = norm(text);
  return BIKE_BRANDS.filter(b => {
    const pat = norm(b).replace(/&/g, ' ').replace(/[^a-z0-9 ]/g, '').trim().replace(/\s+/g, '\\s+');
    if (!pat) return false;
    return new RegExp(`(^|[^a-z0-9])${pat}([^a-z0-9]|$)`).test(t);
  });
}
