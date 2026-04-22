export const tokens = {
  cream:       'oklch(96% 0.012 80)',
  creamDark:   'oklch(92% 0.018 78)',
  creamBorder: 'oklch(88% 0.02 75)',
  ink:         'oklch(14% 0.02 60)',
  inkMid:      'oklch(42% 0.02 60)',
  inkLight:    'oklch(65% 0.015 70)',
  terra:       'oklch(54% 0.15 44)',
  terraLight:  'oklch(90% 0.06 60)',
  green:       'oklch(43% 0.11 150)',
  greenLight:  'oklch(90% 0.06 150)',
  blue:        'oklch(48% 0.12 240)',
} as const;

export interface Activity {
  id: number;
  type: 'cycling' | 'hiking';
  title: string;
  date: string;
  location: string;
  duration: string;
  distance: number;
  speed: number | null;
  elevation: number;
  descent: number;
  photos: string[];
}

export const activities: Activity[] = [
  {
    id: 1, type: 'cycling', title: 'De Dardilly à Alix', date: '22 AVR. 2026', location: 'Dardilly, France',
    duration: '1h 43m', distance: 33.3, speed: 19.3, elevation: 520, descent: 520,
    photos: [
      'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=600&q=80',
      'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=400&q=80',
      'https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?w=400&q=80',
    ],
  },
  {
    id: 2, type: 'hiking', title: "Crête du Mont Cindre", date: '18 AVR. 2026', location: "Saint-Cyr-au-Mont-d'Or",
    duration: '2h 15m', distance: 9.8, speed: null, elevation: 380, descent: 380,
    photos: [
      'https://images.unsplash.com/photo-1551632811-561732d1e306?w=600&q=80',
      'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=400&q=80',
    ],
  },
  {
    id: 3, type: 'cycling', title: "Boucle des Monts d'Or", date: '14 AVR. 2026', location: 'Lyon, France',
    duration: '3h 02m', distance: 57.1, speed: 18.8, elevation: 820, descent: 820,
    photos: [
      'https://images.unsplash.com/photo-1471506480208-91b3a4cc78be?w=600&q=80',
    ],
  },
  {
    id: 4, type: 'hiking', title: 'Gorges du Régalon', date: '6 AVR. 2026', location: 'Luberon, France',
    duration: '4h 30m', distance: 14.2, speed: null, elevation: 610, descent: 610,
    photos: [
      'https://images.unsplash.com/photo-1527489377706-5bf97e608852?w=600&q=80',
      'https://images.unsplash.com/photo-1519681393784-d120267933ba?w=400&q=80',
    ],
  },
];

export const globalStats = {
  totalActivities: 89,
  totalDistance: 2847,
  totalElevation: 48200,
  totalHours: 312,
  cycling: 54,
  hiking: 35,
};
