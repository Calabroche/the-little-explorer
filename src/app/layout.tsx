import type { Metadata } from "next";
import "./globals.css";
import { LanguageProvider } from "@/i18n";

export const metadata: Metadata = {
  title: "The Little Explorer",
  description: "Track your treks, rides and cycling adventures",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover" />
        {/* iOS Add-to-Home-Screen: when launched from the home screen
            icon, drop the Safari chrome so /navigate/<id> looks like a
            real cycling-nav app on the iPhone. Status bar stays
            translucent so the map can flow under it. */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Le Petit Explorateur" />
        <meta name="theme-color" content="#c75a3c" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;0,900;1,400;1,700&family=Space+Grotesk:wght@300;400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body><LanguageProvider>{children}</LanguageProvider></body>
    </html>
  );
}
