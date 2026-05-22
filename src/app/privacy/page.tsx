/**
 * /privacy — privacy policy page.
 *
 * Required by Google OAuth verification before we can publish the
 * consent screen out of "Testing" mode. Covers what we collect,
 * what we use it for, who we share with (no one), and how to delete.
 *
 * Public — middleware excludes /privacy from the auth gate so the
 * Google verification crawler can read it.
 *
 * Editorial styling consistent with the rest of the app: cream
 * background, Playfair Display headlines, Space Grotesk body.
 */

import Link from 'next/link';

const CONTACT_EMAIL = 'florian.calabrese@gmail.com';
const APP_URL       = 'https://the-little-explorer-app.vercel.app';

export const metadata = {
  title:       'Politique de confidentialité — The Little Explorer',
  description: 'Comment The Little Explorer collecte, utilise et protège vos données personnelles.',
};

const cream      = '#F5EFE6';
const surface    = '#FFFCF6';
const ink        = '#2A2723';
const inkMid     = '#5C544A';
const inkLight   = '#8A8175';
const terra      = '#C4602A';
const border     = '#E0D5C2';

export default function PrivacyPage() {
  const updatedAt = '21 mai 2026';

  return (
    <main style={{
      minHeight:  '100dvh',
      background: cream,
      padding:    '40px 24px 80px',
      fontFamily: "'Space Grotesk', sans-serif",
    }}>
      <div style={{
        maxWidth:     760,
        margin:       '0 auto',
        background:   surface,
        border:       `1px solid ${border}`,
        borderRadius: 4,
        padding:      '40px 48px',
      }}>
        <p style={{
          fontSize:      11,
          fontWeight:    700,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color:         terra,
          margin:        '0 0 8px',
        }}>
          § CONFIDENTIALITÉ
        </p>

        <h1 style={{
          fontFamily: "'Playfair Display', serif",
          fontSize:   36,
          fontWeight: 800,
          color:      ink,
          margin:     '0 0 8px',
          lineHeight: 1.15,
        }}>
          Politique de confidentialité
        </h1>

        <p style={{ fontSize: 12, color: inkLight, margin: '0 0 32px' }}>
          Dernière mise à jour : {updatedAt}
        </p>

        <Section title="Vue d&apos;ensemble">
          <p>
            The Little Explorer (« l&apos;Application ») est une application de
            suivi sportif gérée à titre personnel par Florian Calabrese
            (« nous »). Cette politique décrit quelles données nous collectons,
            pourquoi, et ce que vous pouvez en faire.
          </p>
          <p>
            L&apos;Application est hébergée à l&apos;adresse{' '}
            <a href={APP_URL} style={linkStyle}>{APP_URL}</a>.
          </p>
        </Section>

        <Section title="Données que nous collectons">
          <p>
            Lors de la création de votre compte (via Google ou Strava), nous
            collectons :
          </p>
          <ul style={listStyle}>
            <li><strong>Email</strong> (fourni par Google OAuth) — sert d&apos;identifiant unique du compte.</li>
            <li><strong>Nom et photo de profil</strong> (fournis par Google ou Strava) — pour l&apos;affichage UI.</li>
            <li><strong>Identifiant athlète Strava</strong> (athlete_id) — lien vers vos sorties Strava.</li>
            <li><strong>Jeton OAuth Strava (refresh_token)</strong> — utilisé uniquement côté serveur pour récupérer vos activités via l&apos;API officielle Strava. Jamais exposé au navigateur.</li>
          </ul>

          <p style={{ marginTop: 16 }}>
            Lorsque vous connectez Strava, nous récupérons et stockons vos activités :
          </p>
          <ul style={listStyle}>
            <li>Métadonnées par sortie : titre, date, type (vélo, course, randonnée…), durée, distance, dénivelé.</li>
            <li>Streams GPS si disponibles : trace GPS, vitesse, fréquence cardiaque, altitude.</li>
            <li>Métriques dérivées calculées localement : puissance estimée, TSS, FTP, W/kg.</li>
          </ul>

          <p style={{ marginTop: 16 }}>
            Nous n&apos;utilisons <strong>aucun outil de tracking publicitaire</strong> ni
            de cookies tiers à des fins de profilage. Vercel Analytics + Speed Insights
            mesurent les performances anonymisées des pages (latence,
            Core Web Vitals) — pas de profilage individuel.
          </p>
        </Section>

        <Section title="Comment nous utilisons vos données">
          <p>Vos données servent uniquement à :</p>
          <ul style={listStyle}>
            <li>Vous afficher <strong>vos propres</strong> sorties, calendrier, records personnels, objectifs hebdo, et analyses (FTP, courbes de puissance, etc.).</li>
            <li>Synchroniser automatiquement les nouvelles sorties depuis Strava (toutes les 15 min).</li>
            <li>Pour les emails listés comme administrateurs : afficher la liste des comptes de l&apos;application (sans accès aux activités d&apos;autrui).</li>
          </ul>
          <p style={{ marginTop: 16 }}>
            Nous ne vendons, ne louons et ne partageons <strong>aucune
            donnée</strong> avec des tiers à des fins commerciales.
          </p>
        </Section>

        <Section title="Où sont stockées vos données">
          <p>Vos données sont hébergées chez deux prestataires :</p>
          <ul style={listStyle}>
            <li><strong>Supabase</strong> (Postgres) — région eu-west-3 (Paris). Stocke les utilisateurs, activités et jetons OAuth.</li>
            <li><strong>Vercel</strong> — héberge l&apos;application elle-même (code Next.js). Les fonctions serverless tournent en région CDG1 (Paris).</li>
          </ul>
        </Section>

        <Section title="Durée de conservation">
          <p>
            Vos données sont conservées tant que votre compte est actif. Vous
            pouvez demander leur suppression à tout moment (voir « Vos
            droits » ci-dessous) — toutes vos données seront effacées sous 30 jours.
          </p>
        </Section>

        <Section title="Vos droits (RGPD)">
          <p>
            Conformément au RGPD, vous disposez à tout moment des droits
            suivants sur vos données :
          </p>
          <ul style={listStyle}>
            <li><strong>Accès</strong> — voir l&apos;ensemble des données qu&apos;on stocke à votre sujet.</li>
            <li><strong>Rectification</strong> — corriger ou modifier des informations inexactes.</li>
            <li><strong>Effacement</strong> — supprimer votre compte et toutes les données associées.</li>
            <li><strong>Portabilité</strong> — recevoir vos données dans un format structuré (JSON).</li>
            <li><strong>Opposition</strong> — refuser certains traitements.</li>
          </ul>
          <p style={{ marginTop: 16 }}>
            Pour exercer ces droits, envoyez un email à{' '}
            <a href={`mailto:${CONTACT_EMAIL}`} style={linkStyle}>{CONTACT_EMAIL}</a> —
            nous répondrons sous 30 jours.
          </p>
          <p>
            Vous pouvez aussi révoquer l&apos;accès Strava à tout moment depuis{' '}
            <a href="https://www.strava.com/settings/apps" target="_blank" rel="noreferrer" style={linkStyle}>
              strava.com/settings/apps
            </a> — l&apos;application ne pourra plus synchroniser de nouvelles
            sorties, mais les données déjà importées resteront dans votre
            compte The Little Explorer jusqu&apos;à demande de suppression.
          </p>
        </Section>

        <Section title="Sécurité">
          <p>
            Toutes les communications avec l&apos;application transitent en
            HTTPS. Les jetons OAuth (Google et Strava) sont stockés chiffrés
            au repos chez Supabase et ne sont jamais exposés au navigateur. La
            clé de service Supabase qui permet d&apos;y accéder vit
            uniquement dans les variables d&apos;environnement Vercel,
            protégées par chiffrement.
          </p>
        </Section>

        <Section title="Modifications de cette politique">
          <p>
            Si nous modifions cette politique, la date « Dernière mise à
            jour » en haut de page sera changée. Pour les modifications
            importantes (nouveaux types de données collectées, nouveaux
            tiers), nous vous préviendrons par email.
          </p>
        </Section>

        <Section title="Contact">
          <p>
            Pour toute question concernant cette politique ou vos données :{' '}
            <a href={`mailto:${CONTACT_EMAIL}`} style={linkStyle}>{CONTACT_EMAIL}</a>.
          </p>
        </Section>

        <div style={{
          marginTop:    40,
          paddingTop:   24,
          borderTop:    `1px solid ${border}`,
          fontSize:     12,
          color:        inkLight,
        }}>
          <Link href="/" style={linkStyle}>← Retour à l&apos;app</Link>
        </div>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 28 }}>
      <h2 style={{
        fontFamily: "'Playfair Display', serif",
        fontSize:   20,
        fontWeight: 700,
        color:      ink,
        margin:     '0 0 10px',
      }}>
        {title}
      </h2>
      <div style={{
        fontSize:    14,
        color:       inkMid,
        lineHeight:  1.65,
      }}>
        {children}
      </div>
    </section>
  );
}

const linkStyle: React.CSSProperties = {
  color:          terra,
  textDecoration: 'underline',
  textDecorationThickness: 1,
  textUnderlineOffset: 3,
};

const listStyle: React.CSSProperties = {
  paddingLeft: 22,
  margin:      '8px 0',
};
