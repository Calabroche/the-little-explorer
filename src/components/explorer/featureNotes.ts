// ── "What's new" feature announcements ──────────────────────────────────────
//
// Each shipped feature gets an entry here (NEWEST FIRST). Two surfaces read it:
//   • the launch popup announces ONLY the newest note (so backfilled history
//     never spams the user), once, until dismissed.
//   • the "i" What's-New panel lists everything, grouped by recency (today /
//     last 7 days / last 30 days / earlier) using `date`.
//
// To announce a new feature: add a new object at the TOP with a fresh `id` and
// today's date. Keep ids stable — they're the dismissal key.

export type FeatureSport = 'all' | 'cycling' | 'running';

export interface FeatureNote {
  id:    string;        // stable dismissal key — never reuse
  icon:  string;        // emoji shown at the top of the card
  date:  string;        // 'YYYY-MM-DD'
  sport: FeatureSport;  // which sport the feature serves (drives the "i" grouping)
  fr: { title: string; body: string };
  en: { title: string; body: string };
}

export const FEATURE_NOTES: FeatureNote[] = [
  {
    id: 'running-predictor-2026-06', icon: '🏁', date: '2026-06-06', sport: 'running',
    fr: { title: 'Prédicteur de chrono + allures (course)',
          body: "Prévois tes temps sur 5 km / 10 km / semi / marathon depuis ta meilleure sortie récente, et obtiens tes allures d'entraînement (endurance, seuil, VO2…). Strava fait payer ça — ici c'est gratuit." },
    en: { title: 'Race-time predictor + training paces (running)',
          body: 'Predict your 5K / 10K / half / marathon times from your best recent run, and get your training paces (easy, threshold, VO2…). Strava charges for this — here it\'s free.' },
  },
  {
    id: 'running-planner-2026-06', icon: '🏃', date: '2026-06-06', sport: 'running',
    fr: { title: "Planificateur & plan d'entraînement pour la course",
          body: "Le planificateur d'itinéraire (profil piéton, + points d'eau et surfaces) et le plan d'entraînement sont désormais accessibles en course, pas seulement en vélo." },
    en: { title: 'Route planner & training plan for running',
          body: 'The route planner (foot profile, + water points and surfaces) and the training plan are now available for running, not just cycling.' },
  },
  {
    id: 'ravito-2026-06', icon: '💧', date: '2026-06-04', sport: 'all',
    fr: { title: 'Points de ravitaillement sur ton parcours',
          body: "Active le bouton « Ravito » sur la carte : l'app repère le long de ton trajet les points d'eau (fontaines, robinets, cimetières) et les commerces pour manger ou acheter de l'eau (supermarchés, supérettes, boulangeries)." },
    en: { title: 'Resupply points along your route',
          body: 'Tap “Ravito” on the map: the app finds water points (fountains, taps, cemeteries) and food stops (supermarkets, convenience stores, bakeries) within reach of your route.' },
  },
  {
    id: 'onboarding-favsport-2026-06', icon: '🚦', date: '2026-06-04', sport: 'all',
    fr: { title: 'Onboarding : choisis ton sport de prédilection',
          body: 'Plus de choix de sports à l\'inscription, ton sport favori s\'affiche en premier dans l\'app, et l\'étape poids/vélo est sautée si tu ne fais pas de vélo.' },
    en: { title: 'Onboarding: pick your main sport',
          body: 'More sports to choose at signup, your favourite shows first in the app, and the weight/bike step is skipped if you don\'t cycle.' },
  },
  {
    id: 'power-charge-2026-06', icon: '⚡', date: '2026-06-04', sport: 'cycling',
    fr: { title: 'Section « Puissance & Charge »',
          body: 'Tes records de puissance, ton estimation de FTP et l\'analyse de charge (TSS) + prochaine sortie sont réunis sur une page dédiée — la page d\'accueil est plus épurée.' },
    en: { title: '“Power & Load” section',
          body: 'Your power records, FTP estimate and training-load (TSS) analysis + next ride now live on one dedicated page — the home feed is cleaner.' },
  },
  {
    id: 'fireworks-2026-06', icon: '🎆', date: '2026-06-04', sport: 'all',
    fr: { title: 'Un petit feu d\'artifice au lancement',
          body: 'Pour le plaisir : une animation festive accueille l\'ouverture de l\'app (une fois par session).' },
    en: { title: 'A little fireworks welcome',
          body: 'Just for fun: a festive animation greets you when the app loads (once per session).' },
  },
  {
    id: 'planner-clickmap-2026-06', icon: '📍', date: '2026-06-03', sport: 'all',
    fr: { title: 'Ajoute un point en cliquant sur la carte',
          body: 'Clique n\'importe où sur la carte du planificateur : une confirmation s\'affiche, et le point exact s\'ajoute à ton itinéraire. Le parcours évite aussi de repasser deux fois au même endroit.' },
    en: { title: 'Drop a point by tapping the map',
          body: 'Click anywhere on the planner map: a confirmation appears and the exact point is added to your route. Generated routes also avoid passing the same place twice.' },
  },
  {
    id: 'planner-speed-stats-2026-06', icon: '⏱️', date: '2026-06-03', sport: 'all',
    fr: { title: 'Vitesse modifiable + barre de stats du parcours',
          body: 'Change ta vitesse de croisière et le temps estimé se recalcule. Une barre récap (distance, temps, D+/D−, difficulté) s\'affiche, et la liste d\'étapes est repliable.' },
    en: { title: 'Editable speed + route stats bar',
          body: 'Change your cruising speed and the estimated time recomputes. A summary bar (distance, time, elevation, difficulty) shows up, and the stops list is collapsible.' },
  },
  {
    id: 'planner-terrain-2026-06', icon: '🛤️', date: '2026-06-03', sport: 'all',
    fr: { title: 'Types de chemins & surfaces',
          body: 'Pour chaque itinéraire : la répartition route / piste cyclable / chemin et asphalte / non pavé, calculée depuis OpenStreetMap.' },
    en: { title: 'Way types & surfaces',
          body: 'For each route: the breakdown of road / cycleway / path and paved / unpaved, computed from OpenStreetMap.' },
  },
  {
    id: 'elevation-grade-2026-06', icon: '⛰️', date: '2026-06-03', sport: 'all',
    fr: { title: 'Profil d\'altitude coloré par pente',
          body: 'Le profil est désormais coloré selon la pente (vert/jaune/orange/rouge) avec une résolution de 100 m, sur le web et l\'app iOS.' },
    en: { title: 'Slope-coloured elevation profile',
          body: 'The elevation profile is now coloured by gradient (green/yellow/orange/red) at 100 m resolution, on web and iOS.' },
  },
  {
    id: 'save-routes-2026-05', icon: '💾', date: '2026-05-29', sport: 'all',
    fr: { title: 'Sauvegarde & synchro de tes itinéraires',
          body: 'Tes parcours sont sauvegardés sur ton compte et synchronisés entre le web, l\'iPhone et l\'Apple Watch.' },
    en: { title: 'Save & sync your routes',
          body: 'Your routes are saved to your account and synced across web, iPhone and Apple Watch.' },
  },
  {
    id: 'guide-2026-06', icon: '📖', date: '2026-06-02', sport: 'all',
    fr: { title: 'Guide intégré de l\'app',
          body: 'Un guide complet, accessible depuis les Paramètres, explique chaque page et fonctionnalité.' },
    en: { title: 'Built-in app guide',
          body: 'A full guide, reachable from Settings, walks through every page and feature.' },
  },
  {
    id: 'strava-resync-2026-06', icon: '🔄', date: '2026-06-02', sport: 'all',
    fr: { title: 'Re-synchro Strava en un bouton',
          body: 'Un seul bouton importe tes activités ET les tracés GPS / graphes (FC, vitesse, puissance, altitude). Les cartes s\'affichent dès la connexion.' },
    en: { title: 'One-button Strava re-sync',
          body: 'A single button imports your activities AND the GPS tracks / charts (HR, speed, power, elevation). Maps show up right after connecting.' },
  },
  {
    id: 'sports-coverage-2026-06', icon: '🏅', date: '2026-06-02', sport: 'all',
    fr: { title: 'Tous tes sports Strava couverts',
          body: 'Vélo, course, rando, marche, nage, ski, renfo… 25 types d\'activité gérés, avec un sélecteur qui ne montre que les sports que tu pratiques.' },
    en: { title: 'Every Strava sport covered',
          body: 'Cycling, running, hiking, walking, swim, ski, strength… 25 activity types handled, with a picker that only shows what you actually do.' },
  },
  {
    id: 'service-log-2026-05', icon: '🔧', date: '2026-05-28', sport: 'cycling',
    fr: { title: 'Carnet d\'entretien du matériel',
          body: 'Suis l\'entretien de ton vélo et l\'usure des pièces dans la section Matériel.' },
    en: { title: 'Gear service log',
          body: 'Track your bike maintenance and wear parts in the Matériel section.' },
  },
];
