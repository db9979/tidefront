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
      <Stufe2 b={b} />
      <P><strong>KI-Spieler</strong> sehen genau so viel wie du. Der Freibeuter klärt laufend mit Kampagnen und Patrouillen auf, die Festung klärt Nester in Reichweite auf, der Händler sparsam Felder.</P>
    </>
  );
}

type Ops = {
  patrol?: { hours: number[]; shipSightKm: number; droneSightKm: number; droneMaxHours: number; droneMaxRangeKm: number; interceptPerFighter: number; interceptMax: number };
  campaign?: { maxTargets: number; revealKm: number };
  post?: { minCrew: number; cost: Record<string, number>; radarLevel: number; rangeKm: number; fuelPerHour: number; max: number; maxHarbor: number; harborLevel: number; minDistanceKm: number; hp: number; refund: number };
  sonar?: { baseKm: number; perLevelKm: number; subKm: number };
  fleetSight?: { warshipKm: number; transportKm: number; droneKm: number; aircraftKm: number };
};

/** Stufe 2: Bordsicht, Patrouille, Kampagne, Radarposten, Sonar (Zahlen aus der Balance). */
function Stufe2({ b }: { b: Balance | undefined }) {
  const o = (b as unknown as { intel?: Ops } | undefined)?.intel;
  if (!o) return null;
  const { patrol: p, campaign: c, post: r, sonar: s, fleetSight: f } = o;
  return (
    <>
      {f && <P><strong>Bordsicht:</strong> Jeder deiner Verbände auf See sieht unterwegs – auf Hin- und Rückfahrt, bei jeder Missionsart. Es zählt die beste Einheit: Kriegsschiffe {fmtNum(f.warshipKm)} km, Transporter (Landungsschiff, Kolonieschiff, Minenleger) {fmtNum(f.transportKm)} km, Aufklärungsdrohnen {fmtNum(f.droneKm)} km, jeweils mit Erkennung; Jäger und Bomber sichten in {fmtNum(f.aircraftKm)} km nur Verbände. Was der Verband überfährt, bleibt als „bekannt“ im Wissen. Der Sichtkreis wandert auf der Karte mit.</P>}
      {p && <P><strong>Patrouille:</strong> Korvetten, Zerstörer, U-Boote oder Aufklärungsdrohnen fahren {p.hours.join(", ")} Stunden lang eine Runde über 2–4 Wegpunkte auf See (auf der Karte antippen). Sicht mit Erkennung: Schiffe {fmtNum(p.shipSightKm)} km, Drohnen {fmtNum(p.droneSightKm)} km. Drohnen fliegen höchstens {p.droneMaxHours} h und {fmtNum(p.droneMaxRangeKm)} km weit. Treibstoff wie für die ganze Strecke. In der Radarreichweite eines fremden Hafens schießen dessen Abfangjäger Drohnen ab ({Math.round(p.interceptPerFighter * 100)} % je Jäger, höchstens {Math.round(p.interceptMax * 100)} %, einmal je Hafen). Wer von einer Patrouille erfasst wird und sie selbst sieht, bekommt die Meldung „Fremde Patrouille gesichtet“. Heimholen unter Truppen → Einsatz.</P>}
      {c && <P><strong>Aufklärungskampagne:</strong> Eine Aufklärung mit bis zu {c.maxTargets} Zielen (Häfen, Nester, Felder) nacheinander; jedes Ziel bekommt ein Lagebild. Unterwegs erkennt der Aufklärer alles in {fmtNum(c.revealKm)} km um seine Position. Hat ein Zielhafen Radar, meldet er „Aufklärer gesichtet“. Eine Kampagne belegt nur einen Missionsplatz und spart Treibstoff gegenüber Einzelfahrten.</P>}
      {r && <P><strong>Radarposten:</strong> {r.minCrew} Pioniere und ein Landungsschiff errichten auf einer freien Küste oder einem eigenen Rohstofffeld einen Posten (Kosten {Object.entries(r.cost).map(([k, v]) => `${fmtNum(v)} ${k === "stahl" ? "Stahl" : k === "elektronik" ? "Elektronik" : k}`).join(", ")}; Radarstation {r.radarLevel} im Ausgangshafen). Er sieht {fmtNum(r.rangeKm)} km weit wie ein Radar und braucht {fmtNum(r.fuelPerHour)} Treibstoff je Stunde aus seinem Hafen, sonst fällt er aus. Höchstens {r.max} Posten (ab Hafenkommandantur {r.harborLevel}: {r.maxHarbor}), {fmtNum(r.minDistanceKm)} km Abstand zueinander. Gegner greifen ihn wie ein Feld an: Die Pioniere verteidigen, die Anlage ({r.hp} Lebenspunkte) fällt mit ihnen. Beim Abbau (Meldungen → Lagebild) kommen {Math.round(r.refund * 100)} % der Kosten zurück.</P>}
      {s && <P><strong>U-Boote und Sonar:</strong> U-Boote sind für Radar und Ausguck unsichtbar. Korvetten und Zerstörer (U-Jagd) sehen sie im Hafen, auf Patrouille und unterwegs in {fmtNum(s.baseKm)} km, mit der Forschung Sonar {fmtNum(s.perLevelKm)} km mehr je Stufe. U-Boote auf Patrouille sehen andere U-Boote in {fmtNum(s.subKm)} km.</P>}
      <P><strong>Meldungen → Lagebild</strong> zeigt die letzten Sichtungen, fremde Patrouillen und Aufklärer, deine Sensoren mit Reichweite und deine Radarposten. Spionage-Dossiers zählen als Lagebild; nach einem Angriff kennst du den Hafen des Angreifers. Eine Desinformation des Gegners kann die gemeldete Größenklasse seiner Verbände um eine Stufe verfälschen.</P>
    </>
  );
}
