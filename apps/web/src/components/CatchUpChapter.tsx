// Handbuch-Kapitel „Aufholhilfe“: Baugutschrift für Häfen weit unter dem Median und Startpaket für Spät-Einsteiger.
// Zahlen aus balance.catchUp (sonst die Startwerte).
import type { ReactNode } from "react";
import type { Balance } from "../lib/trpc.ts";

function P({ children }: { children: ReactNode }) {
  return <p className="text-sm text-slate-200 mb-2 leading-relaxed">{children}</p>;
}

const pct = (x: number) => `${Math.round(x * 100)} %`;

export function CatchUpChapter({ b }: { b: Balance | undefined }) {
  const c = b?.catchUp ?? { from: 0.7, full: 0.3, cap: 0.5, resumeBelow: 0.6, minBaseAgeDays: 3, storeHours: 24, stopDay: 40, latePackFromDay: 8, latePackShare: 0.15 };
  const mid = (c.from + c.full) / 2;
  return (
    <>
      <P>Wer später einsteigt oder weit zurückliegt, bekommt eine <strong>Baugutschrift</strong>. Gemessen wird dein <strong>Ausbau</strong> (Kosten aller Gebäudestufen, wie in der Rangliste, alle Häfen zusammen) im Verhältnis zum <strong>Median</strong> aller Spieler und KI-Spieler, deren erster Hafen mindestens {c.minBaseAgeDays} Tage alt ist. Der Server rechnet das einmal je Stunde neu.</P>
      <ul className="text-sm list-disc pl-5 space-y-1 mb-2 text-slate-200">
        <li>Unter {pct(c.from)} des Medians fließt stündlich eine Gutschrift von bis zu <strong>+{pct(c.cap)} deiner Gebäudeproduktion</strong>: bei {pct(mid)} etwa +{pct(c.cap / 2)}, ab {pct(c.full)} und darunter voll +{pct(c.cap)}.</li>
        <li>Ab {pct(c.from)} endet die Hilfe; sie beginnt erst wieder, wenn du unter {pct(c.resumeBelow)} fällst. Mehr als {c.storeHours} Stunden Zufluss sammeln sich nicht an. Ab Saisontag {c.stopDay} fließt nichts mehr.</li>
        <li><strong>Startpaket:</strong> Wer seinen ersten Hafen ab Saisontag {c.latePackFromDay} gründet, bekommt einmalig {pct(c.latePackShare)} des Median-Ausbauwerts als Gutschrift.</li>
      </ul>
      <P>Die Gutschrift bezahlt <strong>nur Gebäude</strong>. Beim Ausbau wird sie zuerst verrechnet (derselbe Anteil jeder Ressource), den Rest zahlt dein Lager; im Info-Blatt eines Gebäudes siehst du beide Teile. Ein Abbruch erstattet den Gutschrift-Anteil in die Gutschrift zurück. Sie liegt nicht im Lager, lässt sich nicht plündern, handeln oder verschicken und verfällt zum Saisonende. Bauzeiten bleiben unverändert.</P>
      <P>Die Hilfe gilt für Menschen und KI-Spieler gleich. Sie endet weit unter dem Median – an der Spitze zieht damit niemand vorbei. Absichtlich klein bleiben lohnt nicht: Wer nur rüstet, kann die Gutschrift nicht ausgeben; wer baut, holt auf und beendet sie damit selbst. Bestand und Herkunft zeigen die Zeile unter der Ressourcenleiste und der Bauhof.</P>
    </>
  );
}
