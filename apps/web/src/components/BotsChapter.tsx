// Handbuch-Kapitel „KI-Spieler“: wer die Bots sind, was sie dürfen und was nicht. Zahlen aus balance.bots (sonst Planwerte).
import type { ReactNode } from "react";
import type { Balance } from "../lib/trpc.ts";

function P({ children }: { children: ReactNode }) {
  return <p className="text-sm text-slate-200 mb-2 leading-relaxed">{children}</p>;
}

export function BotsChapter({ b }: { b: Balance | undefined }) {
  const cooldown = (b as unknown as { bots?: { humanAttackCooldownHours?: number } } | undefined)?.bots?.humanAttackCooldownHours ?? 12;
  return (
    <>
      <P>Auf dem Server spielen auch <strong>KI-Spieler</strong> mit. Du erkennst sie am Kennzeichen <strong>KI</strong> in der Rangliste und in der Spielerübersicht. Sie haben einen Hafen wie alle, bauen, bilden aus, forschen, handeln und kämpfen – und zwar <em>nur über dieselben Befehle wie du</em>. Für sie gelten alle Regeln: Kosten, Bauzeiten, Missionsplätze, Treibstoff, Wetter, Kartell.</P>
      <P><strong>Drei Spielweisen:</strong></P>
      <ul className="text-sm text-slate-200 mb-2 list-disc pl-5 space-y-1">
        <li><strong>Händler</strong> (leicht): baut Wirtschaft und Lager aus, verkauft Überschuss an der Börse, stellt Angebote im Spielerhandel ein und nimmt faire Angebote an. Greift nicht an, verteidigt sich nur.</li>
        <li><strong>Festung</strong> (mittel): Küstenbatterien, Flak, Bunker, Radar und Forschung. Überfällt Piratennester, Spieler nur selten.</li>
        <li><strong>Freibeuter</strong> (stark): rüstet stark, klärt vor Angriffen auf und rechnet einen Probekampf durch, legt Minen, nimmt Rohstofffelder und gründet früh Außenposten.</li>
      </ul>
      <P><strong>Angriffe auf Menschen</strong> sind je KI-Spieler in der Verwaltung einstellbar und zunächst aus. Ist es erlaubt, gelten Anfängerschutz, Nachtschild, Schutz nach Niederlage, Gründungsschutz und Diplomatie wie bei jedem Spieler; zusätzlich greift derselbe Bot denselben Menschen höchstens alle {cooldown} Stunden an. Untereinander und gegen Nester kämpfen die Bots ohne diese Sperrfrist.</P>
      <P><strong>Tagesablauf:</strong> KI-Spieler sind nicht rund um die Uhr wach. Jeder hat eigene aktive Stunden (mit Nachtschild) und zieht in unregelmäßigen Abständen – der Händler selten, der Freibeuter oft.</P>
      <P>KI-Spieler können sich nicht anmelden, bekommen keine Push-Benachrichtigungen oder E-Mails, und nach einem Saisonwechsel gründen sie wie alle einen neuen Hafen. Du kannst mit ihnen handeln, sie überfallen (Schutzregeln gelten auch für sie) und ihnen Nachrichten schreiben – lesen werden sie sie allerdings nicht.</P>
    </>
  );
}
