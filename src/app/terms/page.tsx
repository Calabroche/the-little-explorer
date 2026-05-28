/**
 * /terms — terms of service.
 *
 * Required by the Strava API Agreement: any application that accesses
 * Strava athlete data must publish terms of service alongside its
 * privacy policy. Strava's developer relations team specifically
 * checks for this URL before granting an athlete-limit increase.
 *
 * Public — middleware excludes /terms from the auth gate.
 *
 * Editorial styling identical to /privacy. The two pages are siblings
 * and intentionally share the same shell so they read as a coherent
 * "legal" pair from the footer.
 */

import Link from 'next/link';
import { Footer } from '@/components/Footer';

const CONTACT_EMAIL = 'florian.calabrese@gmail.com';
const APP_URL       = 'https://the-little-explorer-app.vercel.app';

export const metadata = {
  title:       'Conditions d\'utilisation — The Little Explorer',
  description: 'Conditions générales d\'utilisation de The Little Explorer.',
};

const cream    = '#F5EFE6';
const surface  = '#FFFCF6';
const ink      = '#2A2723';
const inkMid   = '#5C544A';
const inkLight = '#8A8175';
const terra    = '#C4602A';
const border   = '#E0D5C2';

export default function TermsPage() {
  const updatedAt = '26 mai 2026';

  return (
    // `body { overflow: hidden }` in globals.css clamps the page —
    // wrap in our own scroll container so <main> + <Footer> can grow.
    <div style={{ height: '100dvh', overflowY: 'auto', background: cream }}>
      <main style={{
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
            § CONDITIONS
          </p>

          <h1 style={{
            fontFamily: "'Playfair Display', serif",
            fontSize:   36,
            fontWeight: 800,
            color:      ink,
            margin:     '0 0 8px',
            lineHeight: 1.15,
          }}>
            Conditions d&apos;utilisation
          </h1>

          <p style={{ fontSize: 12, color: inkLight, margin: '0 0 32px' }}>
            Dernière mise à jour : {updatedAt}
          </p>

          <Section title="Acceptation des conditions">
            <p>
              En accédant à The Little Explorer (« l&apos;Application »), accessible
              à l&apos;adresse{' '}
              <a href={APP_URL} style={linkStyle}>{APP_URL}</a>, vous acceptez les
              présentes conditions d&apos;utilisation. Si vous n&apos;acceptez
              pas ces conditions, n&apos;utilisez pas l&apos;Application.
            </p>
          </Section>

          <Section title="Nature de l'application">
            <p>
              The Little Explorer est une application <strong>personnelle et
              non commerciale</strong> de suivi sportif, gérée à titre privé par
              Florian Calabrese. Elle est mise à disposition d&apos;un cercle
              restreint d&apos;utilisateurs (famille et amis) à des fins
              d&apos;analyse de leurs propres données d&apos;entraînement.
            </p>
            <p>
              L&apos;Application n&apos;est <strong>pas un service public</strong> :
              l&apos;inscription est conditionnée à une autorisation explicite
              de l&apos;administrateur. Aucun engagement de disponibilité,
              support ou conservation de données n&apos;est offert.
            </p>
          </Section>

          <Section title="Compte utilisateur">
            <p>
              Vous accédez à l&apos;Application via Google ou Strava OAuth.
              Vous êtes responsable :
            </p>
            <ul style={listStyle}>
              <li>De la sécurité de votre compte Google et/ou Strava sous-jacent.</li>
              <li>De toute activité réalisée depuis votre compte sur l&apos;Application.</li>
              <li>De la véracité des paramètres saisis (poids, FTP custom, etc.).</li>
            </ul>
          </Section>

          <Section title="Utilisation autorisée">
            <p>Vous vous engagez à utiliser l&apos;Application uniquement :</p>
            <ul style={listStyle}>
              <li>Pour consulter et analyser <strong>vos propres données</strong> sportives.</li>
              <li>De bonne foi, sans tenter de contourner les contrôles d&apos;accès.</li>
              <li>Dans le respect des conditions de Strava (<a href="https://www.strava.com/legal/api" target="_blank" rel="noreferrer" style={linkStyle}>API Agreement</a>) et de Google.</li>
            </ul>
            <p style={{ marginTop: 16 }}>
              Il est interdit de tenter d&apos;accéder aux données d&apos;autres
              utilisateurs, d&apos;automatiser massivement des requêtes
              (scraping), de revendre ou redistribuer les données affichées,
              ou d&apos;utiliser l&apos;Application à des fins commerciales.
            </p>
          </Section>

          <Section title="Données Strava">
            <p>
              L&apos;Application utilise l&apos;API Strava conformément à son{' '}
              <a href="https://www.strava.com/legal/api" target="_blank" rel="noreferrer" style={linkStyle}>API Agreement</a>.
              Lorsque vous connectez votre compte Strava :
            </p>
            <ul style={listStyle}>
              <li>Nous récupérons uniquement les données nécessaires à l&apos;affichage de vos sorties (métadonnées + streams GPS / FC / altitude).</li>
              <li>Nous ne redistribuons aucune donnée Strava à un tiers.</li>
              <li>Vous pouvez révoquer l&apos;accès à tout moment depuis <a href="https://www.strava.com/settings/apps" target="_blank" rel="noreferrer" style={linkStyle}>strava.com/settings/apps</a>.</li>
            </ul>
            <p style={{ marginTop: 16, fontSize: 12, color: inkLight }}>
              <em>Strava</em> et le logo Strava sont des marques déposées de
              Strava, Inc., utilisées ici conformément aux{' '}
              <a href="https://www.strava.com/brand" target="_blank" rel="noreferrer" style={linkStyle}>
                Strava Brand Guidelines
              </a>. The Little Explorer n&apos;est pas affilié à Strava, Inc.
            </p>
          </Section>

          <Section title="Propriété intellectuelle">
            <p>
              Le code, le design éditorial, les algorithmes d&apos;analyse
              (TSS, FTP, courbe de puissance, plan d&apos;entraînement) et
              l&apos;identité visuelle de l&apos;Application sont la
              propriété de Florian Calabrese.
            </p>
            <p>
              Vos données sportives <strong>restent votre propriété</strong>.
              Vous pouvez les exporter ou demander leur suppression à tout
              moment — voir notre{' '}
              <Link href="/privacy" style={linkStyle}>politique de confidentialité</Link>.
            </p>
          </Section>

          <Section title="Limitation de responsabilité">
            <p>
              L&apos;Application est fournie <strong>« en l&apos;état »</strong>,
              sans garantie de fonctionnement, d&apos;exactitude des
              estimations (FTP, puissance estimée, TSS) ni de continuité de
              service. Les recommandations d&apos;entraînement n&apos;ont
              aucune valeur médicale et ne remplacent pas l&apos;avis d&apos;un
              professionnel.
            </p>
            <p>
              En aucun cas Florian Calabrese ne pourra être tenu responsable
              de dommages indirects (perte d&apos;historique, blessure
              sportive, mauvaise interprétation des métriques affichées)
              découlant de l&apos;utilisation de l&apos;Application.
            </p>
          </Section>

          <Section title="Suspension et résiliation">
            <p>
              Nous nous réservons le droit de suspendre ou supprimer un
              compte en cas de violation manifeste des présentes conditions
              ou de l&apos;API Agreement Strava — notamment en cas d&apos;accès
              automatisé non autorisé ou de tentative d&apos;accès aux
              données d&apos;autres utilisateurs.
            </p>
            <p>
              Vous pouvez fermer votre compte à tout moment via le bouton
              « Supprimer mon compte » dans les{' '}
              <Link href="/settings" style={linkStyle}>paramètres</Link>.
            </p>
          </Section>

          <Section title="Modifications">
            <p>
              Ces conditions peuvent évoluer. La date « Dernière mise à
              jour » en haut de page reflète la dernière révision. Les
              modifications importantes seront annoncées par email aux
              utilisateurs actifs.
            </p>
          </Section>

          <Section title="Droit applicable">
            <p>
              Les présentes conditions sont régies par le droit français.
              Tout litige relatif à l&apos;utilisation de l&apos;Application
              relève de la compétence exclusive des tribunaux de Lyon, sous
              réserve des dispositions impératives applicables aux
              consommateurs.
            </p>
          </Section>

          <Section title="Contact">
            <p>
              Toute question relative à ces conditions :{' '}
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
      <Footer />
    </div>
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
