// Handbuch-Kapitel „KI-Spieler“: wer die Bots sind, was sie dürfen und was nicht. Zahlen aus balance.bots (sonst Planwerte).
import type { ReactNode } from "react";
import type { Balance } from "../lib/trpc.ts";

function P({ children }: { children: ReactNode }) {
  return <p className="text-sm text-slate-200 mb-2 leading-relaxed">{children}</p>;
}

export function BotsChapter({ b }: { b: Balance | undefined }) {
  const bots = (b as unknown as { bots?: { humanAttackCooldownHours?: number; profiles?: Record<string, { nestMaxLevel?: number; fields?: string }> } } | undefined)?.bots;
  const cooldown = bots?.humanAttackCooldownHours ?? 12;
  const traderNests = bots?.profiles?.haendler?.nestMaxLevel ?? 2;
  const fieldsAll = ["haendler", "festung", "freibeuter"].every((k) => (bots?.profiles?.[k]?.fields ?? "all") !== "none");
  return (
    <>
      <P>Auf dem Server spielen auch <strong>KI-Spieler</strong> mit. Du erkennst sie am Kennzeichen <strong>KI</strong> in der Rangliste und in der Spielerübersicht. Sie haben einen Hafen wie alle, bauen, bilden aus, forschen, handeln und kämpfen – und zwar <em>nur über dieselben Befehle wie du</em>. Für sie gelten alle Regeln: Kosten, Bauzeiten, Missionsplätze, Treibstoff, Wetter, Kartell.</P>
      <P><strong>Drei Spielweisen:</strong></P>
      <ul className="text-sm text-slate-200 mb-2 list-disc pl-5 space-y-1">
        <li><strong>Händler</strong> (leicht): baut Wirtschaft und Lager aus, verkauft Überschuss an der Börse, stellt Angebote im Spielerhandel ein und nimmt faire Angebote an. Überfällt nur leichte Piratennester (bis Stufe {traderNests}), greift keine Spieler an.</li>
        <li><strong>Festung</strong> (mittel): Küstenbatterien, Flak, Bunker, Radar und Forschung; mindestens die Hälfte des Verbands bleibt daheim. Überfällt Piratennester und Weltereignisse, Spieler nur selten.</li>
        <li><strong>Freibeuter</strong> (stark): rüstet stark, klärt vor Angriffen auf und rechnet einen Probekampf durch, jagt Weltereignisse, legt Minen und gründet früh Außenposten.</li>
      </ul>
      {fieldsAll && <P>Alle drei nehmen <strong>Rohstofffelder</strong> und bieten <strong>Lieferverträge</strong> an; bei großen Börsenkäufen schicken sie Geleit mit.</P>}
      <P>Alle KI-Spieler verkaufen Überschuss an der Börse (was über etwa einen Tag Produktion hinausgeht) und kaufen Knappes zu – ihr Lager bleibt klein. An den meisten Tagen holen sie auch ihre Tagesbefehle ab.</P>
      <P><strong>Angriffe auf Menschen</strong> sind je KI-Spieler in der Verwaltung einstellbar und zunächst aus. Ist es erlaubt, gelten Anfängerschutz, Nachtschild, Schutz nach Niederlage, Gründungsschutz und Diplomatie wie bei jedem Spieler; zusätzlich greift derselbe KI-Spieler denselben Menschen höchstens alle {cooldown} Stunden an. Andere KI-Spieler überfällt nur der Freibeuter, und höchstens alle zwei bis drei Tage; gegen Nester gilt keine Sperrfrist.</P>
      <P><strong>Tagesablauf:</strong> KI-Spieler sind nicht rund um die Uhr wach. Jeder hat eigene aktive Stunden (mit Nachtschild) und zieht in unregelmäßigen Abständen – der Händler selten, der Freibeuter oft.</P>
      <P>KI-Spieler können sich nicht anmelden, bekommen keine Push-Benachrichtigungen oder E-Mails, und nach einem Saisonwechsel gründen sie wie alle einen neuen Hafen. Du kannst mit ihnen handeln, sie überfallen (Schutzregeln gelten auch für sie) und ihnen Nachrichten schreiben – lesen werden sie sie allerdings nicht.</P>
    </>
  );
}
