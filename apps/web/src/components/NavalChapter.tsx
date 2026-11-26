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
  if (!m && !k && !c) return <P>Minen, Blockaden und Konvois sind in dieser Welt nicht verfügbar.</P>;
  return (
    <>
      {m && (
        <>
          <P><strong>Minenleger</strong> (Werft ab Stufe {ml?.requiresLevel ?? 4}) legen über <strong>Mission planen → Minen legen</strong> ein Minenfeld auf offener See, höchstens {fmtNum(m.layRadiusKm)} km vom eigenen Hafen. Jeder Minenleger bringt Stärke {ml?.mineLayer ?? 25} (Feld höchstens {m.maxStrength}); je Stärkepunkt kostet das {fmtNum(m.costPerStrength.stahl ?? 0)} Stahl und {fmtNum(m.costPerStrength.elektronik ?? 0)} Elektronik. Ein Feld hält {m.lifetimeHours} Stunden, du kannst höchstens {m.maxFieldsPerPlayer} gleichzeitig auslegen; erneutes Legen verstärkt und verlängert es.</P>
          <P><strong>Durchfahrt:</strong> Kreuzt die Route eines fremden Verbands ein Feld (Wirkradius {m.fieldRadiusKm} km), sinken auf der Hinfahrt Schiffe: je Stärkepunkt {fmtNum(m.lossPerStrength * 100, 1)} %, höchstens {pct(m.maxLossShare)} je Typ und Feld, gewürfelt. U-Boote leiden nur zu {pct(m.typeFactor.uboot ?? 1)}, Minenräumer zu {pct(m.typeFactor.minenraeumer ?? 1)}. Truppen ohne Platz an Bord gehen mit unter, Flugzeuge bleiben verschont. Jedes versenkte Schiff verbraucht {m.strengthPerHit} Stärke. Eigene und verbündete Verbände fahren sicher, Paktpartner ebenso.</P>
          <P><strong>Minenräumer</strong> (Werft ab Stufe {mr?.requiresLevel ?? 2}) räumen auf einer Räumfahrt je Schiff {mr?.mineSweeper ?? 30} Stärke und schützen einen Verband, in dem sie mitfahren: Schutz = {m.shieldPerSweeperShare} × Anteil der Räumer an den Schiffen, höchstens {pct(m.maxShield)}.</P>
          <P><strong>Sichtbar</strong> sind fremde Felder nur, wenn du sie kennst: nach einem Treffer, einer Räumfahrt, einer Aufklärung (bis {m.scoutRevealKm} km von Ziel und Route) – oder im Radarbereich ({m.radarKmPerLevel} km je Stufe der Radarstation). Die Planung warnt, wenn die Route ein bekanntes Feld kreuzt.</P>
        </>
      )}
      {k && (
        <P><strong>Seeblockade:</strong> Über <strong>Mission planen → Blockade</strong> legt sich ein Verband aus bewaffneten Schiffen (mindestens {k.minCommandPoints} Kommandopunkte) {k.minHours}–{k.maxHours} Stunden vor einen fremden Hafen. Schutzregeln wie beim Überfall (kein Anfängerschutz, kein Nachtschild, nicht gegen Verbündete oder Paktpartner). Solange er hält: Produktion des Ziels × {fmtNum(k.productionFactor, 2)}, eingehende Lieferungen (Börse und Spielerhandel) werden zurückgehalten, Börsenverkäufe sind gesperrt. Der Verteidiger und seine Verbündeten greifen den Verband auf der Karte an (Seekampf auf dem Feld); sinkt er, ist die Blockade gebrochen. Der Blockierer kann sie jederzeit aufheben.</P>
      )}
      {c && (
        <P><strong>Konvois:</strong> Spielerhandel-Lieferungen und Transporte reisen als Konvoi auf der Karte. Das Kartell fängt gelegentlich ab ({pct(c.cartelBaseChance)} Grundchance, mehr bei langer Route und wertvoller Ladung, höchstens {pct(c.cartelMaxChance)}; unter {c.cartelMinDistanceKm} km nie). Kriegsgegner können einen Konvoi gezielt abfangen (Abfangpunkt wie beim Schatzschiff). Ohne Geleitschutz gehen {pct(c.lossShareUnescorted)} der Ladung an das Kartell verloren; ein Geleit kämpft – unterliegt es, sind es {pct(c.lossShareEscortBeaten)}. Ein siegreicher Kriegsgegner nimmt bis zu {pct(c.plunderShare)} der Ladung, so viel sein Laderaum fasst; der Rest sinkt. Geleitschutz: beim Transport die Kriegsschiffe im Verband, beim Spielerhandel wählst du beim Annehmen Schiffe, die der Ware entgegenfahren.</P>
      )}
    </>
  );
}
