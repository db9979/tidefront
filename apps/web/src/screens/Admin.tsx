// Verwaltung (nur Admins; der Server prüft jede Anfrage). Eigene Ansicht neben Handbuch und Einstellungen (App.tsx),
// vier Reiter (UX-0.43 B3, passt bei 390 px): Übersicht (Ampel, Fehlermeldungen, Ereignisse, Einrichtung eingeklappt) ·
// Spieler (Spieler, Einladungscodes, Freunde einladen, Auffällige Paare) · Welt (KI-Spieler, Allianzgröße, Gefahrenzone)
// · Statistik (Kennzahlen, Balance live, Weltpolitik-Übersicht). Gewählter Reiter wird geräteweit gemerkt.
import { BackButton, SegmentPanel, Segments, useSegment } from "../ui.tsx";
import { AdminOverview } from "./AdminOverview.tsx";
import { AdminPlayers } from "./AdminPlayers.tsx";
import { AdminWorld } from "./AdminWorld.tsx";
import { AdminStats } from "./AdminStats.tsx";
import { AdminPolitik } from "./AdminPolitik.tsx";

export type AdminTab = "uebersicht" | "spieler" | "welt" | "statistik";
const TABS: { id: AdminTab; label: string }[] = [
  { id: "uebersicht", label: "Übersicht" },
  { id: "spieler", label: "Spieler" },
  { id: "welt", label: "Welt" },
  { id: "statistik", label: "Statistik" },
];

export function AdminScreen({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useSegment<AdminTab>("verwaltung", TABS.map((t) => t.id), "uebersicht");
  return (
    <div data-testid="admin-screen">
      <div className="flex items-center justify-between mb-3">
        <h1 className="font-display text-2xl font-bold uppercase">Verwaltung</h1>
        <BackButton onClick={onClose} />
      </div>
      <Segments label="Verwaltung" value={tab} onChange={setTab} items={TABS} controls />
      <SegmentPanel label="Verwaltung" value={tab}>
        {tab === "uebersicht" ? <AdminOverview />
          : tab === "spieler" ? <AdminPlayers />
          : tab === "welt" ? <AdminWorld />
          : <><AdminStats /><AdminPolitik mode="stats" /></>}
      </SegmentPanel>
    </div>
  );
}
