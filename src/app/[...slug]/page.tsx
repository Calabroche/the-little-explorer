import { ExplorerApp } from "@/components/explorer/ExplorerApp";

// Catch-all : `/planificateur`, `/carte`, `/activites/<slug>-<id>`, etc.
// rendent tous le même composant SPA. ExplorerApp lit window.location.pathname
// pour décider quoi afficher.
export default function CatchAll() {
  return <ExplorerApp />;
}
