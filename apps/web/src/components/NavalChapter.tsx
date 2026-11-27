// Handbuch-Kapitel „Minen, Blockade, Konvois“ (See): Zahlen aus der Balance (docs/REGELN-SEE.md).
import type { ReactNode } from "react";
import type { Balance } from "../lib/trpc.ts";
import { fmtNum } from "../lib/names.ts";

function P({ children }: { children: ReactNode }) {
  return <p className="text-sm text-slate-200 mb-2 leading-relaxed">{children}</p>;
}

const pct = (x: number) => `${Math.round(x * 100)} %`;

export function NavalChapter({ b }: { b: Balance | undefined }) {
  const m = b?.mines;
  const k = b?.blockade;
  const c = b?.convoys;
  const ml = b?.units.minenleger;
  const mr = b?.units.minenraeumer;
  if (!m && !k && !c) return <P>Minen, Blockaden und Konvois sind in dieser Saison nicht verfügbar.</P>;
  return (
    <>
      {m && (
        <>
          <P><strong>Minenleger</strong> (Werft ab Stufe {ml?.requiresLevel ?? 4}) legen über <strong>Mission planen → Minen legen</strong> ein Minenfeld auf offener See, höchstens {fmtNum(m.layRadiusKm)} km vom eigenen Hafen. Jeder Minenleger bringt Stärke {ml?.mineLayer ?? 25} (Feld höchstens {m.maxStrength}); je Stärkepunkt kostet das {fmtNum(m.costPerStrength.stahl ?? 0)} Stahl und {fmtNum(m.costPerStrength.elektronik ?? 0)} Elektronik. Ein Feld hält {m.lifetimeHours} Stunden, du kannst höchstens {m.maxFieldsPerPlayer} gleichzeitig auslegen; erneutes Legen verstärkt und verlängert es.</P>
          <P><strong>Durchfahrt:</strong> Kreuzt die Route eines fremden Verbands ein Feld (Wirkradius {m.fieldRadiusKm} km), sinken auf der Hin- und auf der Rückfahrt Schiffe (nach einem Rückruf ab dem Wendepunkt): je Stärkepunkt {fmtNum(m.lossPerStrength * 100, 1)} %, höchstens {pct(m.maxLossShare)} je Typ und Feld, gewürfelt. U-Boote leiden nur zu {pct(m.typeFactor.uboot ?? 1)}, Minenräumer zu {pct(m.typeFactor.minenraeumer ?? 1)}. Truppen ohne Platz an Bord gehen mit unter, Flugzeuge bleiben verschont. Jedes versenkte Schiff verbraucht {m.strengthPerHit} Stärke. Was der verbliebene Laderaum auf der Rückfahrt nicht mehr fasst, sinkt mit. Eigene und verbündete Verbände fahren sicher, Paktpartner ebenso. <strong>Handelskonvois</strong> im Spielerhandel verlieren in einem Feld, das weder Absender noch Empfänger gehört oder verbündet ist, {pct(Math.min(m.maxLossShare, m.maxStrength * m.lossPerStrength) * (m.cargoLossFactor ?? 0))} der Ladung bei voller Stärke (weniger bei schwächeren Feldern; Minenräumer im Geleit schützen auch die Ladung). Lieferverträge zählen dabei wie Handelskonvois; Börsenkonvois fahren sicher durch Minenfelder.</P>
          <P><strong>Minenräumer</strong> (Werft ab Stufe {mr?.requiresLevel ?? 2}) räumen auf einer Räumfahrt je Schiff {mr?.mineSweeper ?? 30} Stärke und schützen einen Verband, in dem sie mitfahren: Schutz = {m.shieldPerSweeperShare} × Anteil der Räumer an den Schiffen, höchstens {pct(m.maxShield)}.</P>
          <P><strong>Sichtbar</strong> sind fremde Felder nur, wenn du sie kennst: nach einem Treffer, einer Räumfahrt, einer Aufklärung (bis {m.scoutRevealKm} km von Ziel und Route) – oder im Radarbereich ({m.radarKmPerLevel} km je Stufe der Radarstation). Die Planung warnt, wenn die Route ein bekanntes Feld kreuzt.</P>
        </>
      )}
      {k && (
        <P><strong>Seeblockade:</strong> Über <strong>Mission planen → Blockade</strong> legt sich ein Verband aus bewaffneten Schiffen (mindestens {k.minCommandPoints} Kommandopunkte) {k.minHours}–{k.maxHours} Stunden vor einen fremden Hafen. Schutzregeln wie beim Überfall (kein Anfängerschutz, kein Nachtschild, nicht gegen Verbündete oder Paktpartner). Solange er hält: Produktion des Ziels × {fmtNum(k.productionFactor, 2)}, eingehende Lieferungen (Börse und Spielerhandel) werden zurückgehalten, Börsenverkäufe sind gesperrt. Der Verteidiger und seine Verbündeten greifen den Verband auf der Karte an (Seekampf auf dem Feld); sinkt er, ist die Blockade gebrochen. Der Blockierer kann sie jederzeit aufheben.</P>
      )}
      {c && (
        <P><strong>Konvois:</strong> Börsenkäufe (vom nächsten Handelshafen), Lieferverträge (vom Hafen des Verkäufers, auch Albers und Falkenberg), Spielerhandel-Lieferungen, Transporte und Felderträge reisen als Konvoi über die Seewege und sind auf der Karte zu sehen – antippen zeigt Art, Absender und Empfänger, Ladung, Geleit, Ankunft und Route. Das Kartell fängt gelegentlich ab ({pct(c.cartelBaseChance)} Grundchance, mehr bei langer Route und wertvoller Ladung, höchstens {pct(c.cartelMaxChance)}; unter {c.cartelMinDistanceKm} km nie). Kriegsgegner können einen Konvoi gezielt abfangen (Abfangpunkt wie beim Schatzschiff). Ohne Geleitschutz gehen {pct(c.lossShareUnescorted)} der Ladung an das Kartell verloren; ein Geleit kämpft – unterliegt es, sind es {pct(c.lossShareEscortBeaten)}. Getauchte U-Boote halten keinen Konvoi: Bleiben nach dem Kampf nur U-Boote übrig, gilt das Geleit als geschlagen (die U-Boote selbst überleben). Ein siegreicher Kriegsgegner nimmt bis zu {pct(c.plunderShare)} der Ladung, so viel sein Laderaum fasst; der Rest sinkt. Geleitschutz: beim Transport die Kriegsschiffe im Verband, beim Spielerhandel wählst du beim Annehmen Schiffe, die der Ware entgegenfahren – oder der Anbieter trägt schon beim Einstellen Geleit für seine Ware ein: Es läuft bei Annahme aus seinem Hafen aus, begleitet die Ware zum Käufer und fährt heim (fehlen dann die Schiffe, fährt die Ware ohne Geleit). Für dieselbe Ware gibt es nur ein Geleit.</P>
      )}
      {c && (
        <P><strong>Börse und Verträge:</strong> Börsenkäufe kommen nach fester Lieferzeit an (für alle gleich, siehe Börse); das Kartellrisiko rechnet deshalb mit derselben Strecke für alle. Für Börsenkäufe wählst du das Geleit optional in der Order (es fährt dem Konvoi zum Handelshafen entgegen), für Kaufverträge beim Abschluss. Das Kartell fängt diese Konvois seltener ab: Chance × {fmtNum(c.marketChanceFactor ?? 1, 2)}, höchstens {pct(c.marketMaxChance ?? c.cartelMaxChance)} – ohne Geleit verlierst du so im Mittel höchstens {fmtNum((c.marketMaxChance ?? c.cartelMaxChance) * c.lossShareUnescorted * 100, 1)} % der Ladung (die Order zeigt die Rechnung für deinen Kauf). Abfangen dürfen nur das Kartell und Kriegsgegner. <strong>Fremde Konvois</strong> siehst du mit Kartennebel nur in Sensorreichweite (auch der Allianz): Radar meldet Größe und Kurs, Erkennung dazu Art, Absender, Empfänger und ob Geleit fährt; die genaue Ladung erst mit einem Lagebild des Zielhafens (Spionage). Kriegsgegner-Konvois stehen immer mit Route auf der Karte.</P>
      )}
    </>
  );
}
