// Aufträge auf der Basis als kompakte Leiste: Auftragsbuch, Tagesbefehle und Wochenziele als drei Siegel-Kacheln
// (Fortschritt + „x abholbereit“). Ein Tipp öffnet das jeweilige Blatt mit der bisherigen, vollständigen Komponente.
// Neue Spieler: solange das Auftragsbuch läuft, steht darunter der nächste Auftrag mit seinem Knopf.
import { useState } from "react";
import type { BaseData } from "../lib/trpc.ts";
import { Icon } from "../icons.tsx";
import { Bar, Button, Sheet } from "../ui.tsx";
import { Guide, STEPS, nextAction, runGuideAction, useGuide, useRefreshAtCountdowns, type GuideAction } from "./Guide.tsx";
import { DailyOrders, useDaily } from "./Daily.tsx";
import { WeeklyGoals, useWeekly } from "./Weekly.tsx";

type Which = "guide" | "daily" | "weekly";

/** Zahlen der drei Kacheln; prominent = Leiste gehört nach oben (Auftragsbuch läuft oder etwas ist abholbereit). */
export function useQuestSummary() {
  const guide = useGuide();
  const daily = useDaily();
  const weekly = useWeekly();
  const g = guide.data;
  const d = daily.data;
  const w = weekly.data;
  const guideOpen = !!g?.hasBase && !g.final.claimed;
  const weeklyClaimable = w?.hasBase ? [...w.goals, ...w.older].filter((x) => x.done && !x.claimed).length : 0;
  // g.claimable zählt die Abschlussbelohnung schon mit (guideView) – nicht noch einmal addieren.
  const claimable = (g?.claimable ?? 0) + (d?.claimable ?? 0) + weeklyClaimable;
  return { guide: g, daily: d, weekly: w, guideOpen, weeklyClaimable, claimable, prominent: guideOpen || claimable > 0 };
}

export function QuestBar({ base, onAction }: { base: BaseData; onAction: (a: GuideAction) => void }) {
  const q = useQuestSummary();
  const [open, setOpen] = useState<Which | null>(null);
  useRefreshAtCountdowns(base);
  const { guide: g, daily: d, weekly: w } = q;
  if (!g?.hasBase && !d?.hasBase && !w?.hasBase) return null;

  const byId = new Map((g?.steps ?? []).map((s) => [s.id, s]));
  const current = q.guideOpen ? STEPS.find((s) => !byId.get(s.id)?.done) : undefined;
  const dailyDone = d ? d.challenges.filter((c) => c.done).length : 0;
  const weeklyDone = w ? w.goals.filter((x) => x.done).length : 0;
  // Aus dem Blatt heraus: erst schließen, dann zum Ziel (Gebäudeblatt oder Reiter).
  const act = (a: GuideAction) => { setOpen(null); runGuideAction(a, onAction); };

  return (
    <section className={`panel rounded-xl p-3 mb-3 ${q.claimable > 0 ? "border-siegel" : ""}`} aria-label="Aufträge">
      <h2 className="font-display text-[11px] uppercase tracking-[0.16em] text-ink2 mb-2">Aufträge</h2>
      <div className="grid grid-cols-3 gap-2">
        {g?.hasBase && (
          <Tile icon="hafenmeister" title="Auftragsbuch" value={g.doneCount / STEPS.length} count={`${g.doneCount}/${STEPS.length}`}
            ready={g.claimable} onOpen={() => setOpen("guide")} />
        )}
        {d?.hasBase && (
          <Tile icon="uhr" title="Tagesbefehle" value={d.challenges.length ? dailyDone / d.challenges.length : 0} count={`${dailyDone}/${d.challenges.length}`}
            ready={d.claimable} onOpen={() => setOpen("daily")} />
        )}
        {w?.hasBase && (
          <Tile icon="admiral" title="Wochenziele" value={w.goals.length ? weeklyDone / w.goals.length : 0} count={`${weeklyDone}/${w.goals.length}`}
            ready={q.weeklyClaimable} onOpen={() => setOpen("weekly")} />
        )}
      </div>
      {/* Neue Spieler: der nächste Schritt bleibt sichtbar, ohne das Blatt zu öffnen. */}
      {current && (() => {
        const a = nextAction(current, base);
        const building = a.kind === "building" && base.buildQueue.some((o) => o.buildingId === a.id);
        return (
          <div className="mt-2.5 pt-2.5 border-t border-dotted border-rule flex items-center gap-2.5">
            <Icon id={current.icon} size={30} />
            <button type="button" className="tap min-w-0 flex-1 text-left" onClick={() => setOpen("guide")}>
              <span className="block text-[11px] uppercase tracking-wider text-ink2">Nächster Auftrag</span>
              <span className="block font-serif text-[15.5px] leading-tight truncate">{current.title}</span>
            </button>
            {building ? <span className="text-xs text-sea-300 shrink-0">wird gebaut</span>
              : <Button className="shrink-0 px-3" onClick={() => act(a)}>Los</Button>}
          </div>
        );
      })()}

      <Sheet open={open === "guide"} onClose={() => setOpen(null)} title="Auftragsbuch" icon={<Icon id="hafenmeister" size={36} />}>
        <Guide base={base} onAction={act} />
      </Sheet>
      <Sheet open={open === "daily"} onClose={() => setOpen(null)} title="Tagesbefehle" icon={<Icon id="uhr" size={36} />}>
        <DailyOrders />
      </Sheet>
      <Sheet open={open === "weekly"} onClose={() => setOpen(null)} title="Wochenziele" icon={<Icon id="admiral" size={36} />}>
        <WeeklyGoals />
      </Sheet>
    </section>
  );
}

/** Siegel-Kachel: Symbol, Titel, Fortschritt, Zähler; abholbereit als rotes Siegel oben rechts. */
function Tile({ icon, title, value, count, ready, onOpen }: { icon: string; title: string; value: number; count: string; ready: number; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} aria-label={`${title}: ${count}${ready > 0 ? `, ${ready} abholbereit` : ""}`}
      className={`tap relative rounded-xl border bg-card px-2 pt-2 pb-1.5 flex flex-col items-center text-center active:scale-[0.97] ${ready > 0 ? "border-siegel" : "border-rule"}`}>
      <Icon id={icon} size={28} />
      <span className="font-serif text-[12.5px] leading-tight mt-0.5">{title}</span>
      <span className="w-full mt-1"><Bar value={value} tone={value >= 1 ? "green" : "brass"} /></span>
      <span className="mono text-[11px] text-ink2 mt-0.5">{count}</span>
      {ready > 0 && (
        <span className="absolute -top-2 -right-1.5 rounded-full bg-siegel text-white text-[10.5px] px-1.5 py-0.5 leading-none shadow-sm whitespace-nowrap">
          {ready} abholbereit
        </span>
      )}
    </button>
  );
}
