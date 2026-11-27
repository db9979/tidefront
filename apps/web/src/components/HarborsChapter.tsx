// Handbuch-Kapitel „Mehrere Häfen“: Gründung, Hafenwahl, Verlegen, Namen, Belagerung, Kolonie aufgeben, Handel; Zahlen aus balance.expansion (sonst Planwerte).
import type { ReactNode } from "react";
import type { Balance } from "../lib/trpc.ts";
import { fmtNum } from "../lib/names.ts";
import { expansionRules } from "../lib/expansion.ts";

function P({ children }: { children: ReactNode }) {
  return <p className="text-sm text-slate-200 mb-2 leading-relaxed">{children}</p>;
}

export function HarborsChapter({ b }: { b: Balance | undefined }) {
  const x = expansionRules(b);
  return (
    <>
      {!x.live && <P><em>Die Gründung ist auf diesem Server noch nicht freigeschaltet; die Zahlen unten sind vorläufig.</em></P>}
      <P>Dein erster Hafen ist dein <strong>Heimathafen</strong>. Später kannst du bis zu {x.maxBases} Häfen halten: den 2. ab Kommandozentrale Stufe {x.unlockCommandLevels[0] ?? "–"}, den 3. ab Stufe {x.unlockCommandLevels[1] ?? "–"} (jeweils im Heimathafen).</P>
      <P><strong>Gründen:</strong> Baue in der Werft ein <strong>Kolonieschiff</strong>, tippe auf der Karte ein freies Küstenfeld an (kein Hafen, Nest, Handelshafen oder Rohstofffeld) und wähle „Außenposten gründen“. Das Ziel muss höchstens {fmtNum(x.maxRangeKm)} km vom aktiven Hafen entfernt sein und Abstand zu anderen Häfen halten. Bei Ankunft entsteht der Außenposten, das Kolonieschiff wird verbraucht. Wer zuerst ankommt, bekommt das Feld.</P>
      <P><strong>Hafenwahl:</strong> Oben in der Kopfleiste steht der aktive Hafen. Ein Tipp darauf zeigt alle Häfen mit Ressourcen, Bauschlange und Angriffswarnung; „Hierhin wechseln“ macht einen Hafen aktiv. Basis, Truppen, Börse und Missionen beziehen sich immer auf den aktiven Hafen – Missionen laufen dort aus. Wird irgendein Hafen angegriffen, blinkt die Warnung an „Basis“.</P>
      <P><strong>Je Hafen</strong> getrennt: Ressourcen, Lager, Strom, Gebäude, Bauschlange, Ausbildung, Einheiten und Schutz. <strong>Für alle</strong> gemeinsam: Forschung (läuft im Heimathafen, das Forschungsamt steht nur dort, wirkt aber überall), Kredite, Erfolge, Tagesbefehle, Allianz und die Rangliste (Punkte aller Häfen zusammen).</P>
      <P><strong>Zwischen den Häfen:</strong> Mit „Transport“ schickst du Ladung in einen eigenen Hafen, mit „Verlegen“ ziehen Einheiten (und ihr Admiral) dauerhaft um. Auf der Karte: eigenen Hafen antippen. Im Zielhafen stehen eigene Verlegungen und Transporte unter <strong>Truppen → Eingehend</strong> und in „Als Nächstes“ – als „eigen“ gekennzeichnet, ohne Angriffswarnung.</P>
      <P><strong>Namen:</strong> Ein neuer Außenposten heißt nach dem nächsten Küstenort der Karte (weiter draußen „Küste bei …“ oder „Posten …“ nach dem Meer). Über das <strong>Zahnrad</strong> oben rechts auf der Basis (Hafen verwalten) benennst du jeden eigenen Hafen um (2–32 Zeichen: Buchstaben, Ziffern, Leerzeichen, _ . ' -; zwei eigene Häfen dürfen nicht gleich heißen).</P>
      <P><strong>Belagerung:</strong> Liegt ein Belagerungsring vor einem deiner Häfen, kannst du ihn aus einem <em>anderen</em> eigenen Hafen brechen (Überfall oder Sammelangriff) – aus dem belagerten Hafen selbst nicht.</P>
      <P><strong>Kolonie aufgeben:</strong> Über das <strong>Zahnrad</strong> oben rechts auf der Basis (Hafen verwalten) lässt sich ein Außenposten aufgeben (der Heimathafen nie), mit Bestätigung per Hafenname. Es verfallen Bestände, Gebäude, Schlangen, Einheiten im Hafen und Verteidigung; Admirale wechseln in den Heimathafen. Hol Wertvolles vorher per Verlegung oder Transport heraus. Gesperrt, solange von dort Verbände unterwegs (auch gebunden oder stationiert) sind, eigene Verlegungen/Transporte, Lieferungen oder verbündete Gäste unterwegs dorthin sind, ein erkannter Angriff, eine Blockade oder Belagerung läuft, Handelsangebote aus dem Hafen offen sind oder ein Rohstofffeld dorthin liefert. Danach ist wieder Platz für eine neue Gründung.</P>
      <P><strong>Spielerhandel und Börse</strong> öffnen spielerweit, sobald irgendeiner deiner Häfen Hafenkommandantur Stufe 3 hat; Ware und Bezahlung laufen über den aktiven Hafen.</P>
    </>
  );
}
