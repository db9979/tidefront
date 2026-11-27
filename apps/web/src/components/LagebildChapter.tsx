// Handbuch-Kapitel „Lagebild“ (Kartennebel, Sensoren, Alter des Wissens): Zahlen aus der Balance (docs/REGELN-LAGEBILD.md).
import type { ReactNode } from "react";
import type { Balance } from "../lib/trpc.ts";
import { fmtNum } from "../lib/names.ts";

function P({ children }: { children: ReactNode }) {
  return <p className="text-sm text-slate-200 mb-2 leading-relaxed">{children}</p>;
}

type IntelRules = { lookoutKm: number; radarBaseKm: number; radarKmPerLevel: number; radarPowerShortageFactor: number; staleHours: number; forgetHours: number; fleetMemoryHours: number; sizeSmallMax: number; sizeMediumMax: number };

export function LagebildChapter({ b }: { b: Balance | undefined }) {
  const i = (b as unknown as { intel?: IntelRules } | undefined)?.intel;
  const fog = Math.round((b?.weather?.fogRadarMax ?? 0.3) * 100);
  if (!i) return <P>In dieser Welt gibt es keinen Kartennebel: Du siehst alles.</P>;
  return (
    <>
      <P><strong>Was du immer siehst:</strong> Küsten, Handelshäfen, die Positionen, Namen und Besitzer aller Häfen und die Positionen der Piratennester und Rohstofffelder (mit Art und Stufe). Weltereignisse werden wie bisher öffentlich angekündigt, Minenfelder folgen ihren eigenen Regeln.</P>
      <P><strong>Was du nur mit Sicht siehst:</strong> Stufe und Zustand eines Nests, den Schutzstatus fremder Häfen, Besitzer und Besatzung fremder Felder, Wracks und fremde Verbände auf See. Außerhalb jeder Sicht liegt ein leichter graublauer <strong>Kartennebel</strong> über der Karte; deine Sensorreichweiten sind gestrichelt eingezeichnet (Knopf „Sensoren“ rechts).</P>
      <P><strong>Ausguck:</strong> Jeder Hafen sieht {fmtNum(i.lookoutKm)} km weit, ohne Strom, und <em>erkennt</em> alles darin (Besitzer, Stufe, Verbände mit Besitzer). <strong>Radarstation:</strong> {fmtNum(i.radarBaseKm)} km plus {fmtNum(i.radarKmPerLevel)} km je Stufe (Stufe 10: {fmtNum(i.radarBaseKm + 10 * i.radarKmPerLevel)} km). Häfen, Nester, Felder und Wracks werden erkannt, Verbände nur <em>gesichtet</em>: Größenklasse (klein bis {i.sizeSmallMax}, mittel bis {i.sizeMediumMax}, groß darüber) und Kurs, ohne Besitzer. Bei Strommangel sinkt die Reichweite auf {Math.round(i.radarPowerShortageFactor * 100)} %, Nebel kürzt sie um bis zu {fog} %, eine Sabotage schaltet das Radar ab. <strong>U-Boote</strong> sieht kein Radar und kein Ausguck. Die Vorwarnzeit bleibt wie bisher; ein erkannter Angriff erscheint zusätzlich als Verband auf der Karte.</P>
      <P><strong>Allianz:</strong> Alle Mitglieder teilen Sicht und Wissen. Ein Nichtangriffspakt teilt nichts.</P>
      <P><strong>Wissen hat ein Alter:</strong> Was du einmal gesehen hast, bleibt als <em>bekannt</em> auf der Karte (blasser, im Feld-Blatt „Stand: vor 5 h (Radar Hafen X)“), nach {i.staleHours} Stunden <em>veraltet</em> (Angaben in Klammern) und nach {i.forgetHours} Stunden vergessen. Verbände auf See gibt es nur live; ihre letzte Sichtung bleibt {i.fleetMemoryHours} Stunden stehen.</P>
      <P><strong>Aufklärung und Kampf:</strong> Eine Mission „Aufklärung“ liefert ein genaues <em>Lagebild</em> des Ziels, ebenso jeder Kampfbericht über den Gegner. Ohne Erkennung zeigt die Missionsplanung „Lage unbekannt“ statt Stufe und Besatzung, und es gibt keinen Probekampf. Ein Überfall auf ein unerkanntes Nest ist erlaubt – ist es verlassen, kehrt der Verband mit leeren Händen zurück.</P>
      <P><strong>KI-Spieler</strong> sehen genau so viel wie du. Der Freibeuter klärt unbekannte Nester und Felder vor einem Angriff auf.</P>
    </>
  );
}
