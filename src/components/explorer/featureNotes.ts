// ── "What's new" feature announcements ──────────────────────────────────────
//
// Each new feature gets an entry here (NEWEST FIRST). The app shows the most
// recent one the rider hasn't dismissed yet as a popup on the home screen;
// dismissing it (✕ or the "OK" button) marks it seen so it never reappears.
//
// To announce a new feature: add a new object at the TOP with a fresh `id`.
// Keep ids stable — they're the dismissal key.

export interface FeatureNote {
  id:   string;   // stable dismissal key — never reuse
  icon: string;   // emoji shown at the top of the card
  date: string;   // 'YYYY-MM-DD' — drives the "today / this week / this month" grouping
  fr: { title: string; body: string };
  en: { title: string; body: string };
}

export const FEATURE_NOTES: FeatureNote[] = [
  {
    id: 'ravito-2026-06',
    icon: '💧',
    date: '2026-06-04',
    fr: {
      title: 'Points de ravitaillement sur ton parcours',
      body: "Sur la carte du planificateur, active le bouton « Ravito » : l'app repère le long de ton trajet les points d'eau (fontaines, robinets, cimetières) et les commerces où manger ou acheter de l'eau (supermarchés, supérettes, boulangeries). Plus jamais à sec en pleine sortie.",
    },
    en: {
      title: 'Resupply points along your route',
      body: "On the planner map, tap the “Ravito” button: the app finds water points (fountains, taps, cemeteries) and food stops (supermarkets, convenience stores, bakeries) within reach of your route. Never run dry mid-ride again.",
    },
  },
];
