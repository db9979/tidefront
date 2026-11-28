// Verwaltung → Welt (UX-0.43 B3): KI-Spieler und Allianzgröße; darunter die rot umrandete Gefahrenzone mit allem, was
// sofort auf alle Spieler wirkt (Weltpolitik-Not-Aus und Fenster absagen, Kartell-Stärke, Kartennebel, Saisonfinale
// vorziehen) – jede dieser Aktionen fragt vorher nach. Statistik und Weltpolitik-Übersicht stehen unter „Statistik“.
import { AdminBots } from "./AdminBots.tsx"; // KI-Spieler
import { AdminAlliance } from "./AdminAlliance.tsx"; // v1.35: Allianzgröße
import { AdminPolitik } from "./AdminPolitik.tsx";
import { AdminCartel } from "./AdminCartel.tsx";
import { AdminIntel } from "./AdminIntel.tsx"; // Lagebild: Kartennebel an/aus
import { AdminFinale } from "./AdminFinale.tsx"; // Saisonfinale vorziehen

export function AdminWorld() {
  return (
    <div>
      <div className="lg:grid lg:grid-cols-2 lg:gap-x-4 lg:items-start">
        <div className="min-w-0"><AdminBots /></div>
        <div className="min-w-0"><AdminAlliance /></div>
      </div>
      <section aria-labelledby="admin-gefahr-h" data-testid="admin-gefahrenzone" className="rounded-xl border-2 border-siegel p-2.5 pt-2 mt-2">
        <h2 id="admin-gefahr-h" className="font-display text-sm uppercase tracking-[0.12em] text-siegel mb-1">Gefahrenzone</h2>
        <p className="text-xs text-ink2 mb-2">Wirkt sofort auf alle Spieler. Jede Aktion fragt vorher nach.</p>
        <div className="lg:grid lg:grid-cols-2 lg:gap-x-4 lg:items-start">
          <div className="min-w-0">
            <AdminPolitik mode="danger" />
            <AdminIntel />
          </div>
          <div className="min-w-0">
            <AdminCartel />
            <AdminFinale />
          </div>
        </div>
      </section>
    </div>
  );
}
