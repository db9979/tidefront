// Handbuch-Kapitel „Saisonfinale“: die Kartell-Armada mit dem Flaggschiff „Leviathan“. Zahlen aus balance.worldEvents.finale.
import type { ReactNode } from "react";
import type { Balance } from "../lib/trpc.ts";

function P({ children }: { children: ReactNode }) {
  return <p className="text-sm text-slate-200 mb-2 leading-relaxed">{children}</p>;
}

interface FinaleValues {
  announceAfterDays: number; appearAfterDays: number; durationHours: number; referenceFactor: number; minHp: number; squadronShare: number;
  sectorFactor: number; minSectorBoats: number; lootPerHp: number; treasureShare: number; botIntervalHours: number;
  vanguardKm?: number; vanguardSpreadKm?: number; botKFactor?: number; squadronUJagd?: number; ordinaryEventsUntilDays?: number;
}

/** „Tag 36, 12:00“ aus 35,5 Tagen nach Saisonbeginn. */
function dayText(after: number): string {
  const day = Math.floor(after) + 1;
  const h = Math.round((after % 1) * 24);
  return `Tag ${day}, ${String(h).padStart(2, "0")}:00 Uhr`;
}

export function FinaleChapter({ b }: { b: Balance | undefined }) {
  const f = (b as unknown as { worldEvents?: { finale?: FinaleValues } } | undefined)?.worldEvents?.finale;
  const factor = (b as unknown as { scoring?: { armadaFactor?: number } } | undefined)?.scoring?.armadaFactor ?? 0.5;
  const pct = (x: number | undefined, d: number) => Math.round((x ?? d) * 100);
  return (
    <>
      <P>In der letzten Saisonwoche sammelt das Kartell seine <strong>Armada</strong> mit dem Flaggschiff <strong>„Leviathan“</strong> – ein gemeinsames Ziel für alle Spieler und Allianzen. Am {dayText(f?.announceAfterDays ?? 35.5)} wird sie angekündigt (Nachricht, Push, Banner, Karte mit Countdown); ab dem {dayText(f?.ordinaryEventsUntilDays ?? f?.announceAfterDays ?? 35.5)} entstehen keine gewöhnlichen Weltereignisse mehr. Am {dayText(f?.appearAfterDays ?? 37.5)} erscheint sie am <strong>Sammelpunkt</strong>, einem Seefeld möglichst mittig zwischen allen Häfen, und bleibt {f?.durationHours ?? 72} Stunden. Ist eine Saison kürzer oder länger als 42 Tage, verschieben sich die Zeiten anteilig; das Finale endet immer vor dem Saisonwechsel. {(f?.vanguardSpreadKm ?? 1500) > 0 ? "Liegen die Häfen sehr weit auseinander, stellt" : `Liegt ein Hafen mehr als ${(f?.vanguardKm ?? 400).toLocaleString("de-DE")} km vom Sammelpunkt entfernt, stellt`} die Armada zusätzlich <strong>Vorhuten</strong> vor die fernen Häfen (höchstens {(f?.vanguardKm ?? 400).toLocaleString("de-DE")} km vor ihnen) – dort kämpfst du gegen dieselben Geschwader mit kürzerer Anfahrt.</P>
      <P><strong>Stärke:</strong> Beim Erscheinen wird sie einmal festgelegt: {f?.referenceFactor ?? 4} × die Lebenspunkte aller Kriegsschiffe und Flugzeuge der aktiven Häfen (daheim und unterwegs, ohne Landungs-, Kolonie- und Minenschiffe; KI-Spieler zählen {(f?.botKFactor ?? 1) !== 1 ? `zu ${pct(f?.botKFactor, 1)} % ` : ""}mit), mindestens {(f?.minHp ?? 40000).toLocaleString("de-DE")} Lebenspunkte. {pct(f?.squadronShare, 0.9)} % davon sind <strong>Geschwader</strong> (Schnellboote mit Miliz), {100 - pct(f?.squadronShare, 0.9)} % das Flaggschiff aus <strong>Sektionen</strong> zu 1.000 Lebenspunkten – jede Sektion sinkt für sich, Teilschaden bleibt.{f?.squadronUJagd ? " Anders als Kartell und Nester führen die Geschwader der Armada Wasserbomben: Getauchte U-Boote werden hier getroffen." : ""}</P>
      <P><strong>Abschnitte:</strong> Jeder Überfall (Missionsart Überfall, Fahrt über die Seewege) trifft einen Abschnitt aus dem Rest der Geschwader: {pct(f?.sectorFactor, 0.5)} % der Kriegsschiff- und Flugzeug-Lebenspunkte deines Verbands, mindestens {f?.minSectorBoats ?? 4} Boote. So gewinnt auch ein kleiner Verband seinen Abschnitt sicher, ein großer richtet mehr Schaden an. Die Vorschau beim Planen zeigt Abschnitt, Siegchance und Beute. Erst wenn die Geschwader versenkt sind, ist das Flaggschiff dran – allein kaum zu schaffen, darum: <strong>Sammelangriff</strong> der Allianz, der Abschnitt richtet sich dann nach allen Teilnehmern zusammen.</P>
      <P><strong>Belohnung:</strong> {String(f?.lootPerHp ?? 0.9).replace(".", ",")} Richtwert Beute je vernichtetem Lebenspunkt (Stahl, Treibstoff, Elektronik, Proviant), ohne Laderaumgrenze, gutgeschrieben bei der Heimkehr. Wer das Flaggschiff versenkt, teilt zusätzlich einen Schatz von {pct(f?.treasureShare, 0.05)} % der Armada-Stärke nach Beitrag. Kampfpunkte aus Armada-Kämpfen zählen × {String(factor).replace(".", ",")}, Beutepunkte voll. Erfolg <strong>Armada-Jäger</strong>: Bronze, Silber, Gold ab 5, 15 und 30 % des Gesamtschadens.</P>
      <P><strong>Ruhmeshalle:</strong> versenkt (mit Zeitpunkt) oder entkommen, Rangliste nach Schaden und die Titel <strong>„Bezwinger des Leviathan“</strong> (meister Schaden) und <strong>„Leviathan-Flotte“</strong> (Allianz mit dem meisten Schaden). KI-Spieler kämpfen mit und zählen beim Gesamtschaden, Titel und Ruhmeshalle gehören nur Menschen. Wird die Armada nicht versenkt, zieht sie nach Ablauf ab – ohne Strafe, nur die Restbeute verfällt.</P>
      <P><strong>KI-Spieler</strong> (Freibeuter und Festung) greifen einen Abschnitt an, wenn ihr Probekampf ihn sicher gewinnt, höchstens alle {f?.botIntervalHours ?? 12} Stunden. Während die Armada vor der Küste liegt, zieht Treibstoff an der Börse an.</P>
    </>
  );
}
