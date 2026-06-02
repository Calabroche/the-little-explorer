'use client';

/**
 * /guide — comprehensive user guide.
 *
 * Reference doc that surfaces every TLE feature in one scrollable page.
 * Accessible from /settings ("📖 Guide d'utilisation"). Same content
 * is mirrored on iOS in Features/Profile/GuideView.swift — keep the
 * two in sync when adding/removing features.
 *
 * Structure: TOC at the top, then sections per surface (Activités,
 * Planificateur, Comparer, FTP & Charge, Matériel, Bilan, Profil,
 * Apple Watch, App iOS). Each section has a "Ce que tu y trouves" +
 * "Ce que tu peux y faire" pair so readers can scan or deep-read.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { tokens } from '@/components/explorer/tokens';

interface Section {
  id:       string;
  title:    string;
  emoji:    string;
  intro:    string;
  contains: string[];        // "Ce que tu y trouves"
  actions:  string[];        // "Ce que tu peux y faire"
  note?:    string;          // Optional "Astuce / Note" callout
}

const SECTIONS: Section[] = [
  {
    id:    'activites',
    title: 'Activités',
    emoji: '◎',
    intro: 'La page d\'accueil — le fil de toutes tes sorties Strava synchronisées, avec récap chiffré, graphes annuels et cartes des derniers parcours.',
    contains: [
      'Le titre + récap chiffré du nombre total de sorties.',
      'Bandeau filtre sport (Vélo, Course, Rando, Nage, Yoga, etc.) — n\'affiche que les sports que tu pratiques vraiment.',
      'Filtre vélo (uniquement si tu en as 2+) pour scoper les widgets à un vélo précis.',
      'Calendrier annuel d\'activités (style GitHub) — un carré par jour, intensité = volume.',
      '"Last 5 stats" — moyennes des 5 dernières sorties (distance, D+, durée, FC, vitesse).',
      'Objectifs en cours avec barre de progression (annuels ou personnalisés).',
      'Records personnels par distance + vitesse.',
      'Zones FC ou zones d\'allure (course) — temps passé dans chaque zone sur la période.',
      'Programme d\'entraînement (cyclisme uniquement) — chart TSS + recommandation pour la prochaine sortie.',
      'Liste chronologique des sorties avec miniature carte, durée, distance, allure ou vitesse.',
    ],
    actions: [
      'Filtrer par sport via la sidebar (desktop) ou le bandeau du haut (mobile).',
      'Filtrer par vélo si tu as plusieurs montures bindées sur Strava.',
      'Cliquer sur une sortie → ouvre la page de détail.',
      'Cliquer "↻ RE-SYNCER STRAVA" dans la sidebar/Profil pour forcer une re-synchronisation (auto au premier login normalement).',
    ],
  },
  {
    id:    'activite-detail',
    title: 'Détail d\'une sortie',
    emoji: '✦',
    intro: 'Quand tu cliques sur une activité — analyse complète : carte, courbes, zones, montées détectées, records battus.',
    contains: [
      'En-tête : titre, sport, lieu, date.',
      'Récap chiffré : durée, distance, allure ou vitesse moy., D+, FC max, calories.',
      'Carte du trajet avec polyline colorée selon la vitesse ou la FC.',
      'Courbe vitesse au fil de la sortie.',
      'Profil d\'altitude détaillé.',
      'Zones FC — répartition du temps passé en Z1/Z2/Z3/Z4/Z5.',
      'Montées détectées (climbs) avec longueur, dénivelé, pente moy., pente max.',
      'Records personnels battus sur cette sortie (best 1km, 5km, 10km, etc.).',
      'Métriques avancées : puissance estimée, IF, NP, TSS (cyclisme uniquement).',
      'Pour les sorties indoor (yoga, muscu) : seul le récap chiffré s\'affiche, pas de chart vide.',
    ],
    actions: [
      'Survoler une montée dans la liste → la sectionne sur la carte.',
      'Survoler la courbe → tooltip avec valeurs précises à ce moment.',
      'Bouton "← Retour" pour revenir au fil.',
    ],
    note: 'Si une sortie n\'a pas de cartes ni de graphes, c\'est probablement une session indoor (muscu / yoga) — par nature Strava ne stocke pas le tracé GPS de ces séances.',
  },
  {
    id:    'planificateur',
    title: 'Planificateur',
    emoji: '✦',
    intro: 'Hub de planification 4 onglets : créer un itinéraire, générer un plan d\'entraînement, découvrir des parcours, ou proposer des sorties auto.',
    contains: [
      '**Itinéraire** — carte interactive pour créer un parcours en cliquant des points, distance auto-calculée, profil d\'altitude, surface, type de voie.',
      '**Plan d\'entraînement** (cyclisme) — génère un plan périodisé selon ta FTP, ton objectif et tes disponibilités hebdo.',
      '**Auto-route** — propose des itinéraires aléatoires selon une distance cible et un dénivelé voulu, depuis ton point de départ.',
      '**Parcours** — liste des segments Strava populaires dans ta zone.',
    ],
    actions: [
      'Créer un itinéraire en cliquant des waypoints sur la carte.',
      'Sauvegarder un itinéraire — il apparaît dans ta bibliothèque + se sync automatiquement sur ton Apple Watch via WCSession.',
      'Exporter un itinéraire en GPX pour ton GPS Garmin/Wahoo.',
      'Générer un plan d\'entraînement complet (4-12 semaines) calibré sur ta FTP.',
      'Demander des suggestions d\'auto-route si tu n\'as pas d\'idée de sortie.',
    ],
    note: 'Les itinéraires sauvegardés ici sont disponibles **immédiatement** sur l\'app Watch via la sync iPhone ↔ Watch — pas besoin de re-créer la route sur la montre.',
  },
  {
    id:    'comparer',
    title: 'Comparer',
    emoji: '⇄',
    intro: 'Mets deux sorties côte à côte pour voir tes progrès — utile pour comparer le même parcours fait à 2 mois d\'écart.',
    contains: [
      'Sélecteur de 2 activités via menu déroulant.',
      'Comparaison chiffrée : durée, distance, allure, FC moy., D+.',
      'Calcul de l\'écart en % et en valeurs absolues.',
      'Cartes superposées (si même parcours).',
    ],
    actions: [
      'Comparer 2 sorties identiques pour mesurer un gain de performance.',
      'Comparer 2 sorties similaires (même distance, même D+) sur différents vélos.',
    ],
  },
  {
    id:    'ftp-charge',
    title: 'FTP & Charge',
    emoji: '⚡',
    intro: 'Suivi de ta FTP estimée + courbe de charge (TSS) sur 7 / 30 / 90 / 365 jours. Cyclisme uniquement.',
    contains: [
      'FTP estimée — best effort de 20 min × 0.95 (formule Coggan).',
      'Évolution de la FTP dans le temps.',
      'TSS hebdomadaire / mensuel / annuel.',
      'CTL (charge chronique, forme), ATL (charge aiguë, fatigue), TSB (équilibre).',
      'Détection des semaines de surcharge (>10% d\'augmentation TSS).',
    ],
    actions: [
      'Modifier ta FTP manuellement si tu as fait un test précis (test 20 min ou test rampes).',
      'Voir les recommandations basées sur ton TSB (récup / continuer / charger).',
    ],
    note: 'La FTP par défaut est estimée automatiquement depuis tes meilleures sorties. Si tu as une valeur précise (test labo, ramp test), surcharge-la dans Settings.',
  },
  {
    id:    'materiel',
    title: 'Matériel',
    emoji: '⚙',
    intro: 'Suivi de tes vélos + de chaque composant : pièces d\'usure d\'un côté, carnet d\'entretien de l\'autre.',
    contains: [
      'Liste des vélos synchronisés depuis Strava (avec km totaux + bouton "Reset km").',
      '**Pièces d\'usure** — chaîne, plaquettes, câbles, pneus, cassette, etc. avec barre d\'usure colorée selon la durée de vie restante.',
      '**Carnet d\'entretien** — sections "À faire bientôt" (en rouge si overdue) et "Dernières interventions" en chronologique.',
      'Intervalles recommandés : chain lube 200 km, brake pads 1000 km, brake bleed 5000 km, etc.',
    ],
    actions: [
      'Ajouter une pièce d\'usure avec sa date/km d\'installation.',
      'Marquer une pièce comme remplacée — l\'usure repart à zéro depuis le km du jour.',
      'Logger une intervention d\'entretien (lubrification chaîne, purge freins, etc.) avec date + km.',
      'Switcher entre tes différents vélos via le sélecteur en haut.',
    ],
    note: 'Les km par vélo sont calculés depuis tes sorties Strava taggées avec le bon vélo. Si tu vois des km étranges, vérifie que tes sorties Strava ont bien le bon vélo assigné.',
  },
  {
    id:    'bilan',
    title: 'Bilan',
    emoji: '✺',
    intro: 'Rétrospective annuelle façon Spotify Wrapped — chiffres clés de l\'année, top sport, records, podiums.',
    contains: [
      'Distance totale, dénivelé cumulé, heures passées sur l\'année.',
      'Sport principal pratiqué.',
      'Mois le plus actif, jour de la semaine préféré.',
      'Top 3 plus longues sorties, top 3 plus grosses montées.',
      'Évolution de la FC moy. / VO2 max estimé.',
      'Comparatif vs l\'année précédente.',
    ],
    actions: [
      'Changer l\'année affichée via le sélecteur.',
      'Partager le bilan en PNG (capture d\'écran).',
    ],
  },
  {
    id:    'profil-settings',
    title: 'Profil & Paramètres',
    emoji: '◐',
    intro: 'Ton compte, ta connexion Strava et tes réglages physiologiques pour des calculs précis.',
    contains: [
      'Avatar + nom + email Google/Strava.',
      'Statut de la connexion Strava (athleteId, scope).',
      'Bouton "↻ RE-SYNCER STRAVA" — re-pull complet (summaries + streams).',
      'Bouton "Connecter/Déconnecter Strava".',
      'Réglages dans /settings : poids cycliste, poids vélo, FTP custom, langue (FR/EN), mode sombre.',
      'Export GPX/CSV/JSON de toutes tes données.',
      'Suppression de compte (cascade sur toutes tes données).',
    ],
    actions: [
      'Modifier ton poids → tous les calculs de puissance et de TSS s\'ajustent.',
      'Override ta FTP avec une valeur testée précisément.',
      'Exporter tes données (GDPR / backup avant changement d\'app).',
      'Supprimer ton compte — irréversible, cascade sur toutes les tables.',
    ],
  },
  {
    id:    'app-ios',
    title: 'App iOS',
    emoji: '◉',
    intro: 'Compagnon iPhone — toutes les sections du web + recording standalone GPS sur Apple Watch.',
    contains: [
      'Mêmes pages que la version web : Activités, Planificateur, Comparer, FTP & Charge, Matériel, Bilan.',
      'Profil natif iOS avec lien direct vers les Réglages système (autorisation HealthKit, Localisation).',
      'Carnet d\'entretien identique à la version web avec sync temps réel.',
      'Mode sombre / clair suivant le système.',
    ],
    actions: [
      'Tout ce que tu peux faire sur le web, en mobile-first.',
      'Activer la sync Apple Health pour que tes sorties remontent en HKWorkouts.',
      'Coupler une ceinture cardio Bluetooth (Polar H10, Wahoo TICKR) pour les sessions live.',
    ],
  },
  {
    id:    'apple-watch',
    title: 'Apple Watch',
    emoji: '◎',
    intro: 'Recording GPS standalone — pas besoin de l\'iPhone pendant le ride. Sync auto au retour.',
    contains: [
      'Page d\'accueil avec "Start ride" + bouton "Itinéraires" si tu en as planifiés sur iPhone/web.',
      'Countdown 5 secondes avant le démarrage du timer.',
      'Page Métriques : TIME / DIST / SPEED / AVG / HR / CLIMB (3×2 grille) + barre de zones FC.',
      'Page Carte (mode itinéraire) : trace planifiée + position en temps réel.',
      'Page Contrôles : Pause / End ride.',
      'Always-On Display : la grille reste lisible en mode dim.',
      'Crash recovery : si la montre redémarre en cours de ride, snapshot toutes les 30s.',
      'Complication sur le cadran : tap → ouvre direct l\'app.',
    ],
    actions: [
      'Lancer un ride freeform (sans itinéraire).',
      'Lancer un ride avec un itinéraire planifié — guidage vocal turn-by-turn en français via AVSpeech.',
      'Mettre en pause / reprendre / terminer.',
      'Recevoir des annonces vocales aux carrefours (200 m avant + au moment du virage).',
      'Voir la position sur la carte planifiée pendant le ride.',
    ],
    note: 'Pendant un ride avec itinéraire, ton iPhone affiche une **Live Activity** sur le lock screen avec carte + métriques mises à jour toutes les 3 secondes.',
  },
  {
    id:    'auto-features',
    title: 'Fonctionnalités automatiques',
    emoji: '✦',
    intro: 'Ce qui se passe sans que tu cliques sur rien.',
    contains: [
      '**Sync auto** à la connexion : dès qu\'un user lie son Strava, on importe ses activités + tous les streams (cartes, FC, vitesse, altitude).',
      '**Webhooks Strava** : chaque nouvelle sortie publiée sur Strava est syncée en temps réel chez nous (1-2 secondes après publication).',
      '**Backfill streams** : si une sortie arrive sans GPS/altitude, on les fetch automatiquement.',
      '**Détection des montées** : algorithme qui scanne chaque sortie pour identifier les climbs (≥500 m, ≥30 m de gain, ≥3% pente moy.).',
      '**Calcul de TSS** : pour chaque sortie cyclisme, le TSS est calculé depuis la puissance et ta FTP.',
      '**Mise à jour des km par vélo** : à chaque ride, le km counter de chaque vélo s\'incrémente.',
      '**Watch ↔ iPhone sync** : itinéraires créés sur iPhone/web → instantanément dispo sur la Watch.',
    ],
    actions: [
      'Pas d\'action requise — tout tourne en arrière-plan.',
    ],
    note: 'Si jamais une sync semble bloquée, le bouton "↻ RE-SYNCER STRAVA" dans la sidebar (web) ou dans Profil (iOS/mobile) force une re-synchronisation complète.',
  },
];

const CARD_STYLE: React.CSSProperties = {
  background: tokens.surface,
  border: `1px solid ${tokens.creamBorder}`,
  borderRadius: 6,
  padding: 28,
  marginBottom: 24,
};

export default function GuidePage() {
  // Smooth scroll on TOC click. Uses native scrollIntoView — works
  // everywhere modern.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  return (
    <main style={{
      minHeight:   '100dvh',
      overflowY:   'auto',
      padding:     '40px 20px 80px',
      background:  tokens.cream,
      fontFamily:  "'Space Grotesk', sans-serif",
    }}>
      <style>{`
        .tle-guide-wrap { max-width: 820px; margin: 0 auto; }
        .tle-guide-h1 {
          font-family: 'Playfair Display', serif;
          font-weight: 800; line-height: 1.1;
          color: ${tokens.ink};
          font-size: 32px;
          margin: 0 0 8px;
        }
        @media (min-width: 768px) {
          .tle-guide-h1 { font-size: 44px; }
        }
        .tle-guide-toc {
          display: grid; grid-template-columns: 1fr; gap: 8px;
        }
        @media (min-width: 600px) {
          .tle-guide-toc { grid-template-columns: 1fr 1fr; }
        }
        .tle-guide-toc a {
          padding: 10px 14px;
          background: ${tokens.surface};
          border: 1px solid ${tokens.creamBorder};
          border-radius: 4;
          color: ${tokens.ink};
          font-size: 13;
          text-decoration: none;
          font-weight: 600;
          transition: background 0.15s;
        }
        .tle-guide-toc a:hover {
          background: ${tokens.creamDark};
        }
        .tle-guide-section h2 {
          font-family: 'Playfair Display', serif;
          font-weight: 800;
          font-size: 24px;
          color: ${tokens.ink};
          margin: 0 0 6px;
          display: flex; align-items: baseline; gap: 12px;
        }
        .tle-guide-section h2 .emoji {
          color: ${tokens.terra};
          font-size: 22px;
        }
        .tle-guide-list h3 {
          font-family: 'Space Grotesk', sans-serif;
          font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase;
          font-size: 11px; color: ${tokens.terra};
          margin: 18px 0 8px;
        }
        .tle-guide-list ul {
          margin: 0; padding-left: 18px;
          color: ${tokens.inkMid};
          font-size: 13px; line-height: 1.7;
        }
        .tle-guide-list ul li { margin-bottom: 4px; }
        .tle-guide-list ul li strong {
          color: ${tokens.ink}; font-weight: 700;
        }
        .tle-guide-note {
          margin-top: 16px;
          padding: 12px 14px;
          background: #FFF4E6;
          border: 1px solid #FFD8A6;
          border-radius: 4;
          color: #8A4A00;
          font-size: 12px; line-height: 1.55;
        }
      `}</style>

      <div className="tle-guide-wrap">
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 24 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', color: tokens.terra, textTransform: 'uppercase', marginBottom: 6 }}>
              § DOCUMENTATION
            </div>
            <h1 className="tle-guide-h1">
              Guide d&apos;utilisation
            </h1>
            <p style={{ color: tokens.inkLight, fontSize: 13, margin: '8px 0 0', maxWidth: 600, lineHeight: 1.6 }}>
              Toutes les fonctionnalités de The Little Explorer — pour le web, l&apos;app iOS et l&apos;Apple Watch.
            </p>
          </div>
          <Link
            href="/settings"
            style={{
              padding: '8px 14px',
              background: tokens.surface,
              border: `1px solid ${tokens.creamBorder}`,
              borderRadius: 3,
              color: tokens.inkMid,
              fontSize: 11, fontWeight: 600,
              letterSpacing: '0.04em', textTransform: 'uppercase',
              textDecoration: 'none', whiteSpace: 'nowrap',
            }}
          >
            ← Paramètres
          </Link>
        </div>

        {/* TOC */}
        <div style={CARD_STYLE}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', color: tokens.terra, textTransform: 'uppercase', marginBottom: 14 }}>
            § Sommaire
          </div>
          <nav className="tle-guide-toc">
            {SECTIONS.map(s => (
              <a key={s.id} href={`#${s.id}`}>
                <span style={{ color: tokens.terra, marginRight: 6 }}>{s.emoji}</span>
                {s.title}
              </a>
            ))}
          </nav>
        </div>

        {/* Sections */}
        {SECTIONS.map(s => (
          <section
            key={s.id}
            id={s.id}
            className="tle-guide-section"
            style={{
              ...CARD_STYLE,
              scrollMarginTop: 20,  // so the anchor doesn't land flush against the viewport top
            }}
          >
            <h2>
              <span className="emoji">{s.emoji}</span>
              {s.title}
            </h2>
            <p style={{ color: tokens.inkMid, fontSize: 14, lineHeight: 1.7, margin: '8px 0 0' }}>
              {s.intro}
            </p>

            <div className="tle-guide-list">
              <h3>Ce que tu y trouves</h3>
              <ul>
                {s.contains.map((line, i) => (
                  <li key={i} dangerouslySetInnerHTML={{ __html: highlightMarkdown(line) }} />
                ))}
              </ul>
            </div>

            <div className="tle-guide-list">
              <h3>Ce que tu peux y faire</h3>
              <ul>
                {s.actions.map((line, i) => (
                  <li key={i} dangerouslySetInnerHTML={{ __html: highlightMarkdown(line) }} />
                ))}
              </ul>
            </div>

            {s.note && (
              <div className="tle-guide-note">
                💡 <strong>Astuce —</strong> {s.note}
              </div>
            )}
          </section>
        ))}

        {/* Footer */}
        <div style={{ textAlign: 'center', marginTop: 32, color: tokens.inkLight, fontSize: 12 }}>
          Un truc qui manque ou qui est pas clair ? Écris à <a href="mailto:florian.calabrese@gmail.com" style={{ color: tokens.terra }}>florian.calabrese@gmail.com</a>.
        </div>

        {mounted && <div style={{ height: 1 }} aria-hidden />}
      </div>
    </main>
  );
}

/// Tiny markdown-ish highlighter for **bold** spans inside list items.
/// Avoids pulling a full MD parser for 2 syntax cases.
function highlightMarkdown(line: string): string {
  return line
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}
