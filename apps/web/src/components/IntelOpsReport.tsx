// Berichte Lagebild Stufe 2: Radarposten (errichtet, abgelehnt, zerstört/gehalten), Drohnen abgefangen, Sichtung fremder
// Patrouillen und Aufklärer. Kampfverläufe zeigt der allgemeine Kampfbericht darunter.
// Stufe 3: Satellit gestartet (Bahn, Kosten, erster Überflug) und verglüht (Überflüge, Sichtungen).
import { errorText, fmtNum } from "../lib/names.ts";
import { fmtTime } from "../lib/time.ts";
import { Card, Cost, UnitChips } from "../ui.tsx";

type D = Record<string, unknown>;

export function IntelOpsReport({ d }: { d: D }) {
  const post = d.post as { refused?: string; col?: number; row?: number; crew?: Record<string, number>; rangeKm?: number; fuelPerHour?: number; destroyed?: boolean } | undefined;
  const intercept = d.intercept as { shot: number; drones: number; fighters: number; chance: number; baseName: string; owner: string } | undefined;
  const sighting = d.sighting as { owner?: string; scout?: boolean; baseName?: string } | undefined;
  const sat = d.satellite as {
    event?: string; name?: string; baseName?: string; cost?: Record<string, number>; expiresAtMs?: number; passes?: number; plannedPasses?: number;
    periodHours?: number; stripKm?: number; liveMinutes?: number; level?: string; firstPass?: { atMs: number; where: string } | null; seen?: number; clouded?: number;
  } | undefined;
  return (
    <Card>
      {sat && (sat.event === "end" ? (
        <div className="text-sm space-y-1" data-testid="sat-report"><p>{sat.name} aus {sat.baseName} ist verglüht: {fmtNum(sat.passes ?? 0)} von {fmtNum(sat.plannedPasses ?? 0)} Überflügen, {fmtNum(sat.seen ?? 0)} Sichtungen{(sat.clouded ?? 0) > 0 ? `, ${fmtNum(sat.clouded ?? 0)} Ziele unter Wolken` : ""}.</p><p className="text-xs text-ink2">Das Wissen bleibt wie jede Sichtung bis zu 72 Stunden erhalten. Ein neuer Start unter Meldungen → Lagebild.</p></div>
      ) : (
        <div className="text-sm space-y-1" data-testid="sat-report">
          <p>{sat.name} von der Startrampe {sat.baseName}: alle {sat.periodHours} h ein Überflug, {fmtNum(sat.stripKm ?? 600)} km breit, je {sat.liveMinutes} min live. {sat.level === "sichtung" ? "Sieht durch Wolken und Nebel, nur Sichtung." : "Erkennung, aber nicht unter Wolken."}</p>
          {sat.firstPass && <p>Erster Überflug {fmtTime(sat.firstPass.atMs)} über {sat.firstPass.where}.</p>}
          <p className="text-xs text-ink2">{fmtNum(sat.passes ?? 0)} Überflüge bis {sat.expiresAtMs ? fmtTime(sat.expiresAtMs) : "?"}.</p>
          <div className="text-xs">Startkosten: <Cost cost={sat.cost} /></div>
        </div>
      ))}
      {post && (post.refused ? <p>Nicht errichtet: {errorText(post.refused)} Die Baustoffe kommen mit zurück.</p>
        : post.destroyed !== undefined ? <p>{post.destroyed ? "Die Besatzung ist geschlagen, der Posten zerstört." : "Die Besatzung hat den Posten gehalten."} (Feld {post.col}/{post.row})</p>
        : <div className="text-sm space-y-1"><p>Der Radarposten auf Feld {post.col}/{post.row} ist in Betrieb: {fmtNum(post.rangeKm ?? 0)} km Reichweite, {fmtNum(post.fuelPerHour ?? 0)} Treibstoff je Stunde aus dem Hafen.</p><div className="text-xs">Besatzung: <UnitChips counts={post.crew} /></div><p className="text-xs text-ink2">Abbauen unter Meldungen → Lagebild (die Hälfte der Kosten kommt zurück).</p></div>)}
      {intercept && <p>Abfangjäger aus {intercept.baseName} ({fmtNum(intercept.fighters)} Jäger, {Math.round(intercept.chance * 100)} % je Drohne) haben {fmtNum(intercept.shot)} von {fmtNum(intercept.drones)} Drohnen abgeschossen.</p>}
      {sighting && <p>{sighting.scout ? `Ein Aufklärer von ${sighting.owner ?? "?"} hat ${sighting.baseName ?? "deinen Hafen"} erkundet. Dein Radar hat ihn erfasst.` : `${sighting.owner ?? "Ein fremder Spieler"} patrouilliert in Sichtweite von ${sighting.baseName ?? "deinem Hafen"}. Die Patrouille sieht deinen Hafen.`}</p>}
    </Card>
  );
}
