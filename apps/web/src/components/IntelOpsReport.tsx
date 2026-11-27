// Berichte Lagebild Stufe 2: Radarposten (errichtet, abgelehnt, zerstört/gehalten), Drohnen abgefangen, Sichtung fremder
// Patrouillen und Aufklärer. Kampfverläufe zeigt der allgemeine Kampfbericht darunter.
import { errorText, fmtNum } from "../lib/names.ts";
import { Card, UnitChips } from "../ui.tsx";

type D = Record<string, unknown>;

export function IntelOpsReport({ d }: { d: D }) {
  const post = d.post as { refused?: string; col?: number; row?: number; crew?: Record<string, number>; rangeKm?: number; fuelPerHour?: number; destroyed?: boolean } | undefined;
  const intercept = d.intercept as { shot: number; drones: number; fighters: number; chance: number; baseName: string; owner: string } | undefined;
  const sighting = d.sighting as { owner?: string; scout?: boolean; baseName?: string } | undefined;
  return (
    <Card>
      {post && (post.refused ? <p>Nicht errichtet: {errorText(post.refused)} Die Baustoffe kommen mit zurück.</p>
        : post.destroyed !== undefined ? <p>{post.destroyed ? "Die Besatzung ist geschlagen, der Posten zerstört." : "Die Besatzung hat den Posten gehalten."} (Feld {post.col}/{post.row})</p>
        : <div className="text-sm space-y-1"><p>Der Radarposten auf Feld {post.col}/{post.row} ist in Betrieb: {fmtNum(post.rangeKm ?? 0)} km Reichweite, {fmtNum(post.fuelPerHour ?? 0)} Treibstoff je Stunde aus dem Hafen.</p><div className="text-xs">Besatzung: <UnitChips counts={post.crew} /></div><p className="text-xs text-ink2">Abbauen unter Meldungen → Lagebild (die Hälfte der Kosten kommt zurück).</p></div>)}
      {intercept && <p>Abfangjäger aus {intercept.baseName} ({fmtNum(intercept.fighters)} Jäger, {Math.round(intercept.chance * 100)} % je Drohne) haben {fmtNum(intercept.shot)} von {fmtNum(intercept.drones)} Drohnen abgeschossen.</p>}
      {sighting && <p>{sighting.scout ? `Ein Aufklärer von ${sighting.owner ?? "?"} hat ${sighting.baseName ?? "deinen Hafen"} erkundet. Dein Radar hat ihn erfasst.` : `${sighting.owner ?? "Ein fremder Spieler"} patrouilliert in Sichtweite von ${sighting.baseName ?? "deinem Hafen"}. Die Patrouille sieht deinen Hafen.`}</p>}
    </Card>
  );
}
