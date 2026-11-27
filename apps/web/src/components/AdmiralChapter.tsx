// Handbuch-Kapitel „Admirale“: Plätze, Kosten, Ränge, Spezialisierungen, Erfahrung und Risiko; Zahlen aus der Balance.
import type { ReactNode } from "react";
import type { Balance } from "../lib/trpc.ts";
import { fmtNum } from "../lib/names.ts";
import { bonusText } from "./Admirals.tsx";

function P({ children }: { children: ReactNode }) {
  return <p className="text-sm text-slate-200 mb-2 leading-relaxed">{children}</p>;
}

export function AdmiralChapter({ b }: { b: Balance | undefined }) {
  const a = b?.admirals;
  if (!a) return <P>Admirale gibt es in dieser Welt nicht.</P>;
  const r = a.risk;
  const second = a.ranks[a.secondSpecFromRank - 1];
  return (
    <>
      <P>In der <strong>Hafenkommandantur</strong> ernennst du Admirale (Truppen → Admirale): {a.slots.base} Platz, je {a.slots.perHarborLevels} Stufen Hafenkommandantur einer mehr, höchstens {a.slots.max}. Ein Admiral kostet {fmtNum(a.cost.credits)} Kredite und {fmtNum(a.cost.elektronik)} Elektronik. Den Namen wählst du aus einer Liste oder lässt ihn auslosen.</P>
      <P><strong>Ränge:</strong> {a.ranks.map((x) => `${x.name} (ab ${fmtNum(x.minXp)} Erfahrung, ${Math.round(x.factor * 100)} % Wirkung)`).join(" → ")}. Beim Ernennen wählst du eine Spezialisierung, ab {second?.name ?? `Rang ${a.secondSpecFromRank}`} eine zweite.</P>
      <ul className="text-sm text-slate-200 mb-2 list-disc ml-5 space-y-1">
        {Object.entries(a.specs).map(([id, s]) => (
          <li key={id}>
            <strong>{s.name}:</strong> {s.text}
            {s.mission ? ` Auf Mission ${bonusText(s.mission)}.` : ""}
            {s.defense ? ` Daheim ${bonusText(s.defense)}.` : ""}
            {s.harbor ? ` Als Hafenkommandant ${bonusText(s.harbor)}.` : ""}
          </li>
        ))}
      </ul>
      <P>Die Werte gelten voll ausgebildet; ein Kapitän zur See bringt die Hälfte. Ein Admiral wirkt nur auf den Verband, den er führt (Auswahl „Führung“ in der Missionsplanung – auch gegen Weltereignisse und Rohstofffelder; nach einer Feldeinnahme bleibt er bei der Besatzung, führt sie bei Angriffen und kehrt mit ihr heim oder allein, wenn du ihn abziehst), oder als <strong>Hafenkommandant</strong> auf die Verteidigung des eigenen Hafens – auch gegen das Kartell. Ist der Hafenkommandant unterwegs, verwundet oder gefangen, fehlt er daheim. Seine Wirkung steht im Kampfbericht und wird mit Forschung und Veteranen multipliziert. Ein voll ausgebildeter Admiral mit zwei Kampf-Spezialisierungen bringt etwa 10 bis 20 % Kampfwert.</P>
      <P><strong>Erfahrung</strong> gibt es nur für Siege: zerstörte gegnerische Lebenspunkte / {a.xp.hpPerXp}, mindestens {a.xp.minWin}, höchstens {a.xp.maxPerBattle} je Kampf. Beförderungen erfolgen von selbst.</P>
      <P><strong>Risiko:</strong> Verliert sein Verband einen Kampf mit mehr als {Math.round(r.lossShare * 100)} % Verlusten, wird ein W{r.die} gewürfelt (aus dem Kampf-Seed, der Wurf steht im Bericht): {r.fallenMax} – gefallen; bis {r.capturedMax} – gefangen ({r.captiveHours} Stunden oder Lösegeld {fmtNum(r.ransomCredits)} Kredite; der Sieger bekommt ihn nicht); bis {r.woundedMax} – verwundet ({r.woundedHours} Stunden); darüber unversehrt.</P>
    </>
  );
}
