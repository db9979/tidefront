// Handbuch-Kapitel „Rohstofffelder“ (Felder): Zahlen aus der Balance (docs/REGELN-FELDER.md).
import type { ReactNode } from "react";
import type { Balance } from "../lib/trpc.ts";
import { fmtNum, label } from "../lib/names.ts";
import { KIND_TEXT, fieldsRules } from "./Fields.tsx";

function P({ children }: { children: ReactNode }) {
  return <p className="text-sm text-slate-200 mb-2 leading-relaxed">{children}</p>;
}

const pct = (x: number) => `${Math.round(x * 100)} %`;

export function FieldsChapter({ b }: { b: Balance | undefined }) {
  const f = fieldsRules(b);
  if (!f) return <P>Rohstofffelder gibt es in dieser Saison nicht.</P>;
  return (
    <>
      <P><strong>Felder</strong> liegen auf See vor den Küsten, bevorzugt zwischen den Häfen mehrerer Spieler, nie näher als {fmtNum(f.minKmFromBase)} km an einem Hafen. Es gibt vier Arten in drei Stufen: {Object.entries(f.kinds).map(([k, v]) => `${KIND_TEXT[k]} (${label(v.resource)} ${v.yieldPerHour.join("/")} je Stunde)`).join(", ")}. Zum Saisonwechsel werden alle Felder neu verteilt, Besitz verfällt.</P>
      <P><strong>Einnehmen:</strong> Erst aufklären – die Aufklärung zeigt Wache oder Besatzung und Besitzer. Dann über das Feld auf der Karte <strong>Besetzen</strong>: nur Schiffe, bewaffnet, mindestens {f.minGarrisonCommandPoints} Kommandopunkte. Neutrale Felder bewacht eine kleine Kartell-Wache (Seekampf, schwächer als ein Nest); nach Sieg oder Räumung kehrt sie nach {f.guardRespawnHours} Stunden zurück. Nach dem Sieg bleibt die Mindestbesatzung (oder auf Wunsch der ganze Verband) dort, der Rest fährt heim. Die Besatzung belegt einen Missionsplatz, kostet ihren normalen Unterhalt und verteidigt das Feld. Rückruf unter Truppen → Meine Felder: das Feld wird neutral. Ein <strong>Admiral</strong> kann den Verband führen; nach der Einnahme bleibt er bei der Besatzung (Status unterwegs), führt sie bei jedem Angriff auf das Feld und kehrt mit ihr heim. Mit <strong>Admiral abziehen</strong> (am Feld oder unter Admirale) fährt er allein heim – so schnell wie eine Korvette, ohne Treibstoff und ohne Missionsplatz –, die Besatzung hält das Feld weiter. Eine Verstärkung mit Admiral übergibt ihn der Besatzung, wenn sie noch keinen hat.</P>
      <P><strong>Verstärken:</strong> „Besetzen“ auf ein eigenes Feld schickt weitere Schiffe ohne Kampf zur Besatzung – kein Rückruf nötig. Kommen sie aus einem anderen eigenen Hafen, wechseln sie in den Hafen des Felds (Veteranen werden gewichtet gemischt).</P>
      <P><strong>Ertrag:</strong> Alle {f.deliveryHours} Stunden läuft ein Konvoi mit dem gesammelten Ertrag zum Heimathafen – das Kartell und Kriegsgegner können ihn abfangen, eine Blockade des Hafens hält ihn zurück. Unter Meine Felder teilst du einen Teil der Besatzung als <strong>Geleit</strong> ein: diese Schiffe begleiten die Ertragskonvois und kämpfen bei Abfangversuchen – fahren mehrere Konvois zugleich, teilen sie sich nach Warenwert auf. Gegen angekündigte Kartellangriffe verteidigen sie das Feld mit, gegen Spielerangriffe nicht; was bleibt, muss mindestens {f.escortMinRemainCommandPoints ?? f.minGarrisonCommandPoints} Kommandopunkte bewaffneter Schiffe haben. Je Feld zahlt der Hafen Unterhalt in Proviant ({f.upkeepProviantPerHour.join("/")} je Stunde nach Stufe).</P>
      <P><strong>Bremse:</strong> Höchstens 1 Feld plus 1 je {f.maxFieldsPerHarborLevels} Stufen der Hafenkommandantur, insgesamt {f.maxFields}. Jedes weitere Feld bringt weniger: {f.yieldFactors.map(pct).join(" / ")}.</P>
      <P><strong>Angriffe:</strong> Andere Spieler greifen besetzte Felder mit „Angreifen“ an (Schutzregeln wie beim Überfall, nicht Verbündete oder Paktpartner); gewinnen sie, übernehmen sie das Feld mit ihrer Besatzung. Das Radar des Hafens, dem das Feld gehört, meldet solche Angriffe vorab ({pct(f.radarWarningFactor ?? 0)} seiner Vorwarnzeit, Push und Meldung) – Zeit zum Verstärken oder Zurückrufen. Das Kartell greift besetzte Felder gelegentlich an ({pct(f.cartelRaidChance)} je Lieferzyklus, mit Vorwarnung); schwache Besatzungen fallen dann, das Feld ist wieder neutral. Getauchte U-Boote halten kein Feld: Bleiben nach einem Kampf nur U-Boote übrig, ist das Feld verloren und sie fahren heim.</P>
      <P><strong>Allianz-Einflusszone:</strong> Felder derselben Allianz bis {fmtNum(f.zoneLinkKm)} km auseinander bilden eine Zone (auf der Karte verbunden). Ab {f.zoneMinFields} Feldern bringt jedes Feld der Zone +{pct(f.zoneBonus)} Ertrag. Die Allianzwertung erhält {f.alliancePointsPerFieldDay} Punkte je Feld und Tag.</P>
    </>
  );
}
