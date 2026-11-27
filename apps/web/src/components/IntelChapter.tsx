// Handbuch-Kapitel „Nachrichtendienst“: Spione, Auftragsarten, offener W20 und Gegenspionage; Zahlen aus der Balance.
import type { ReactNode } from "react";
import type { Balance } from "../lib/trpc.ts";
import { fmtNum } from "../lib/names.ts";

function P({ children }: { children: ReactNode }) {
  return <p className="text-sm text-slate-200 mb-2 leading-relaxed">{children}</p>;
}

export function IntelChapter({ b }: { b: Balance | undefined }) {
  const e = b?.espionage;
  const spy = b?.units.spion;
  if (!e) return <P>Der Nachrichtendienst ist in dieser Saison nicht verfügbar.</P>;
  const k = e.kinds;
  return (
    <>
      <P>Der <strong>Nachrichtendienst</strong> (Basis → Hafen → Führung und Schutz) bildet <strong>Spione</strong> aus: {fmtNum(spy?.maxPerLevel ?? 2)} je Stufe, teuer ({fmtNum(spy?.cost?.elektronik ?? 0)} Elektronik und mehr) und mit {spy?.upkeepPerHour ?? 1} Proviant Unterhalt je Stunde. Spione kämpfen nicht, fahren in keinem Verband mit und werden bei Überfällen nicht getroffen.</P>
      <P>Spionageaufträge startest du über <strong>Mission planen → Spionage</strong>. Sie belegen einen Missionsplatz, reisen unauffällig mit {e.speedKmh} km/h und ohne Treibstoff und tauchen bei keinem Radar auf.</P>
      <ul className="text-sm text-slate-200 mb-2 list-disc ml-5 space-y-1">
        <li><strong>Erkunden</strong> (ab Stufe {k.erkunden.minLevel}, {k.erkunden.spies} Spion): Lagebild wie eine Aufklärung, dazu laufende Forschung, Bauschlange, Ausbildung und Veteranenränge; ab Stufe {e.missionsFromLevel} auch die Missionen des Ziels. Erlaubt auch bei Verbündeten und Paktpartnern.</li>
        <li><strong>Desinformation</strong> (ab Stufe {k.desinformation.minLevel}): Das Ziel sieht im nächsten Lagebild (Aufklärung oder Erkunden) über dich etwa {fmtNum(e.disinfo.forceFactor, 1)}-mal so viele Truppen und Anlagen und nur {Math.round(e.disinfo.resourceFactor * 100)} % deiner Vorräte – einmalig, höchstens {e.disinfo.hours} Stunden lang.</li>
        <li><strong>Sabotage</strong> (ab Stufe {k.sabotage.minLevel}, {k.sabotage.spies} {k.sabotage.spies === 1 ? "Spion" : "Spione"}, schwerer): Kraftwerk (Gebäudeproduktion halbiert), Radarstation (keine Vorwarnung), Werft, Kaserne, Flugfeld oder Forschungsamt (laufender Auftrag steht still, neue dauern doppelt) fallen {e.sabotage.hours} Stunden aus – oder die Bauschlange verzögert sich um {e.sabotage.delayHours} Stunden. Nichts wird zerstört. Nicht gegen Verbündete und Paktpartner, höchstens eine Sabotage je Hafen in {e.sabotage.cooldownHours} Stunden.</li>
        <li><strong>Kartell-Aufklärung</strong> (ab Stufe {k.kartell.minLevel}): Informanten verraten das nächste Weltereignis mit Art und Zeitpunkt sowie Kurs, Zielhäfen und Zeitplan der laufenden. Dauer {k.kartell.hours} Stunden je Richtung.</li>
      </ul>
      <P><strong>Offener Würfel (W{e.die}):</strong> Erfolgswert = {e.base} + Stufe deines Nachrichtendiensts + Agentenschulung + Erfahrung (je {e.xpPerPoint} gelungene Aufträge +1, höchstens +{e.maxXpPoints}) + Zuschlag der Art (Erkunden {k.erkunden.bonus >= 0 ? "+" : "−"}{Math.abs(k.erkunden.bonus)}, Sabotage −{Math.abs(k.sabotage.bonus)}). Abwehr = Stufe des gegnerischen Nachrichtendiensts + Verschlüsselung (das Kartell: {k.kartell.defense}). Der Auftrag gelingt, wenn der Wurf höchstens Erfolgswert − Abwehr ist (mindestens 1, höchstens {e.die - 1}): eine 1 gelingt immer, eine {e.die} scheitert immer. Die Chancen stehen vor dem Auslaufen in der Planung; gewürfelt wird bei Ankunft, der Wurf steht im Bericht.</P>
      <P><strong>Enttarnt:</strong> Die Spione sind verloren, das Ziel erhält eine Nachricht mit deinem Namen und einen Bericht mit dem Wurf. Verlorene Spione zählen in Kampfbilanz und Wertung. <strong>Unentdeckt:</strong> Das Ziel merkt nichts – bei einer Sabotage nur die Folgen, ohne Absender.</P>
      <P><strong>Schutz:</strong> Häfen im Anfängerschutz sind tabu. Nachtschild und Schutz nach einer Niederlage halten Spione nicht auf.</P>
    </>
  );
}
