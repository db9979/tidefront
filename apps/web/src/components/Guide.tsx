// Leitfaden: eine Kette von Aufträgen, die durch die ersten Spieltage führt. Erfüllt wird aus dem Spielstand.
import { useState } from "react";
import type { BaseData } from "../lib/trpc.ts";
import { Icon } from "../icons.tsx";
import { Bar, Button } from "../ui.tsx";

export type GuideAction = { kind: "building"; id: string } | { kind: "tab"; tab: "karte" | "truppen" | "boerse" | "berichte" };

interface Step {
  id: string;
  icon: string;
  title: string;
  why: string;
  done: (b: BaseData, wonRaid: boolean) => boolean;
  action: GuideAction;
  actionText: string;
}

const lvl = (b: BaseData, id: string) => b.buildings.find((x) => x.id === id)?.level ?? 0;
const units = (b: BaseData, id: string) => {
  const u = b.units.find((x) => x.id === id);
  return u ? u.home + u.away : 0;
};

export const STEPS: Step[] = [
  { id: "stahl", icon: "stahlwerk", title: "Stahlwerk bauen", why: "Stahl ist der wichtigste Rohstoff. Fast jeder Ausbau und jedes Schiff braucht ihn.", done: (b) => lvl(b, "stahlwerk") >= 1, action: { kind: "building", id: "stahlwerk" }, actionText: "Zum Stahlwerk" },
  { id: "strom", icon: "kraftwerk", title: "Kraftwerk bauen", why: "Produktionsgebäude brauchen Strom. Ohne Kraftwerk läuft nur die kleine Grundproduktion.", done: (b) => lvl(b, "kraftwerk") >= 1, action: { kind: "building", id: "kraftwerk" }, actionText: "Zum Kraftwerk" },
  { id: "basis", icon: "versorgungshof", title: "Raffinerie und Versorgungshof", why: "Treibstoff brauchst du für jede Mission, Proviant ernährt deine Truppen.", done: (b) => lvl(b, "raffinerie") >= 1 && lvl(b, "versorgungshof") >= 1, action: { kind: "building", id: "raffinerie" }, actionText: "Ausbauen" },
  { id: "kz", icon: "kommandozentrale", title: "Kommandozentrale auf Stufe 1", why: "Sie hebt den Deckel für alle anderen Gebäude und gibt mehr Kommandopunkte für größere Verbände.", done: (b) => lvl(b, "kommandozentrale") >= 1, action: { kind: "building", id: "kommandozentrale" }, actionText: "Zur Kommandozentrale" },
  { id: "kaserne", icon: "kaserne", title: "Kaserne bauen", why: "Nur Bodentruppen können landen, siegen und Beute holen – und deinen Hafen halten.", done: (b) => lvl(b, "kaserne") >= 1, action: { kind: "building", id: "kaserne" }, actionText: "Zur Kaserne" },
  { id: "wache", icon: "schuetzen", title: "20 Schützen ausbilden", why: "Nach dem Anfängerschutz greift das Freibeuter-Kartell regelmäßig an. Schon 20 Schützen schlagen kleine Überfälle zurück.", done: (b) => units(b, "schuetzen") >= 20, action: { kind: "tab", tab: "truppen" }, actionText: "Zu den Truppen" },
  { id: "werft", icon: "werft", title: "Werft bauen", why: "Ohne Schiffe kommst du nicht übers Meer – weder zum Plündern noch zum Handeln.", done: (b) => lvl(b, "werft") >= 1, action: { kind: "building", id: "werft" }, actionText: "Zur Werft" },
  { id: "flotte", icon: "landungsschiff", title: "2 Korvetten und 1 Landungsschiff", why: "Korvetten versenken die Schnellboote der Piraten, das Landungsschiff bringt 100 Mann an Land und 4.000 Beute heim.", done: (b) => units(b, "korvette") >= 2 && units(b, "landungsschiff") >= 1, action: { kind: "tab", tab: "truppen" }, actionText: "Schiffe bauen" },
  { id: "nest", icon: "kartell", title: "Ein Piratennest Stufe 1 überfallen", why: "Nester liegen an den Küsten. Stufe 1 hat 6 Schnellboote und 40 Milizionäre – mit 2 Korvetten, 1 Landungsschiff und 60 Schützen sicher zu holen.", done: (_b, won) => won, action: { kind: "tab", tab: "karte" }, actionText: "Nest auf der Karte suchen" },
  { id: "hafen", icon: "hafenkommandantur", title: "Hafenkommandantur auf Stufe 3", why: "Öffnet die Börse: Überschüsse verkaufen, Fehlendes kaufen. Jede zweite Stufe bringt einen Missionsplatz.", done: (b) => lvl(b, "hafenkommandantur") >= 3, action: { kind: "building", id: "hafenkommandantur" }, actionText: "Zur Hafenkommandantur" },
  { id: "schutz", icon: "radarstation", title: "Radarstation und Tiefbunker", why: "Das Radar warnt vor Angriffen, der Bunker schützt einen Grundstock vor Plünderung.", done: (b) => lvl(b, "radarstation") >= 1 && lvl(b, "tiefbunker") >= 1, action: { kind: "building", id: "radarstation" }, actionText: "Zur Radarstation" },
];

/** Bei Schritten mit zwei Gebäuden zum noch fehlenden führen. */
export function nextAction(step: Step, b: BaseData): GuideAction {
  if (step.id === "basis") return { kind: "building", id: lvl(b, "raffinerie") < 1 ? "raffinerie" : "versorgungshof" };
  if (step.id === "schutz") return { kind: "building", id: lvl(b, "radarstation") < 1 ? "radarstation" : "tiefbunker" };
  return step.action;
}

export function Guide({ base, wonRaid, onAction }: { base: BaseData; wonRaid: boolean; onAction: (a: GuideAction) => void }) {
  const [showAll, setShowAll] = useState(false);
  const doneCount = STEPS.filter((s) => s.done(base, wonRaid)).length;
  const current = STEPS.find((s) => !s.done(base, wonRaid));
  return (
    <section className="panel brass-edge rounded-2xl p-3 mb-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <h2 className="font-display text-xs font-bold uppercase text-slate-300 flex items-center gap-2"><span className="w-1.5 h-3 bg-sea-400 inline-block" aria-hidden="true" />Auftragsbuch</h2>
        <span className="text-xs text-slate-400 mono">{doneCount}/{STEPS.length} erledigt</span>
      </div>
      <Bar value={doneCount / STEPS.length} />
      {current ? (
        <div className="flex gap-3 mt-3">
          <div className="shrink-0 self-start reticle"><div className="bg-navy-900 border border-sea-400/40 p-1"><Icon id={current.icon} size={44} /></div></div>
          <div className="min-w-0 flex-1">
            <div className="font-bold">{current.title}</div>
            <p className="text-sm text-slate-300">{current.why}</p>
            {(() => {
              const a = nextAction(current, base);
              // In Arbeit: das Gebäude steht in der Bauschlange (laufend oder eingereiht).
              const pos = a.kind === "building" ? base.buildQueue.findIndex((o) => o.buildingId === a.id) : -1;
              return pos >= 0 ? (
                <p className="mt-2 text-sm text-sea-300">
                  {pos === 0 ? "Wird gerade gebaut – gleich geht es weiter." : `In Arbeit: steht auf Platz ${pos + 1} der Bauschlange.`}
                </p>
              ) : (
                <Button className="mt-2 w-full" onClick={() => onAction(a)}>{current.actionText}</Button>
              );
            })()}
          </div>
        </div>
      ) : (
        <p className="text-sm mt-3">Alle Grundaufträge erledigt. Baue deine Flotte aus, nimm stärkere Nester ins Visier und handle an der Börse.</p>
      )}
      <button type="button" className="tap w-full text-left text-xs text-sea-300 mt-1" onClick={() => setShowAll((v) => !v)}>
        {showAll ? "Liste ausblenden" : "Alle Aufträge zeigen"}
      </button>
      {showAll && (
        <ol className="mt-1 space-y-1">
          {STEPS.map((s) => {
            const ok = s.done(base, wonRaid);
            return (
              <li key={s.id} className={`flex items-center gap-2 text-sm ${ok ? "text-slate-400 line-through" : ""}`}>
                <span className={`grid place-items-center w-5 h-5 text-xs border ${ok ? "border-emerald-500 text-emerald-300" : "border-white/15"}`}>{ok ? "✓" : ""}</span>
                <Icon id={s.icon} size={20} /> {s.title}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
