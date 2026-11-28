// Lage „Nächster Schritt“ (UX 0.43, A1/A3, Entscheidung E-4b): unter „Wartet auf dich“ eine sichtbare Bauempfehlung
// je Hafen mit leerer Bauschlange – „Bauhof frei: Stahlwerk 7 · Engpass Stahl · 3 min · Bauen“. Zwei bewusste Taps
// (Abholen, Bauen), kein Kombi-Knopf. Neulinge sehen „Erste Schritte“ mit dem aktuellen Auftrag, Fortschritt,
// Belohnung und „Los“ – seit UX-0.43 C3 bis zum ersten gewonnenen Nestüberfall (Auftrag „nest“); die Bauempfehlung
// erscheint ab 5 erledigten Aufträgen zusätzlich darunter. Server: lage.get → advice (engine/lage.ts, game-core/build-advice).
import { trpc, trpcClient, type BaseData, type Outputs } from "../../lib/trpc.ts";
import { useCommand } from "../../lib/command.ts";
import { fmtNum, label } from "../../lib/names.ts";
import { fmtDuration } from "../../lib/time.ts";
import { activeBaseId, setActiveBase } from "../../lib/active-base.ts";
import { useNav } from "../../lib/nav.ts";
import { Icon } from "../../icons.tsx";
import { Bar, ErrorLine, ResChips } from "../../ui.tsx";
import { STEPS, nextAction, runGuideAction, useGuide, type GuideAction } from "../Guide.tsx";
import { askPushAfter } from "../PushAsk.tsx";

export type LageAdvice = Outputs["lage"]["get"]["advice"][number];
type Option = LageAdvice["options"][number];

/** Bis zu diesem Stand des Auftragsbuchs gilt man als ganz neu (Weltpolitik/Nachtschild eingeklappt, keine Bauempfehlung). */
export const FIRST_STEPS_UNTIL = 5;
/** „Erste Schritte“ führen bis zu diesem Auftrag (erster gewonnener Nestüberfall, UX-0.43 C3). */
export const FIRST_WIN_STEP = "nest";
const WIN_COUNT = STEPS.findIndex((s) => s.id === FIRST_WIN_STEP) + 1;

const REASON: Record<string, (o: Option) => string> = {
  strom: () => "Strom fehlt",
  lager: (o) => `Lager fast voll${o.resource ? ` (${label(o.resource)})` : ""}`,
  engpass: (o) => `Engpass ${o.resource ? label(o.resource) : ""}`.trim(),
  guenstig: () => "günstigster Ausbau",
};

export function adviceReason(o: Option): string {
  return REASON[o.reason]?.(o) ?? "";
}

/** Neuling: Auftragsbuch läuft und steht unter FIRST_STEPS_UNTIL erledigten Schritten. */
export function useNewcomer(): boolean {
  const g = useGuide().data;
  return !!g?.hasBase && !g.final.claimed && g.doneCount < FIRST_STEPS_UNTIL;
}

/** Noch kein gewonnener Nestüberfall: „Erste Schritte“ zeigen (UX-0.43 C3). */
export function useBeforeFirstWin(): boolean {
  const g = useGuide().data;
  return !!g?.hasBase && !g.final.claimed && !g.steps.find((s) => s.id === FIRST_WIN_STEP)?.done;
}

export function FirstSteps({ base, onGuide }: { base: BaseData; onGuide: (a: GuideAction) => void }) {
  const g = useGuide().data;
  if (!g?.hasBase || g.final.claimed || g.steps.find((s) => s.id === FIRST_WIN_STEP)?.done) return null;
  const byId = new Map(g.steps.map((s) => [s.id, s]));
  const current = STEPS.find((s) => !byId.get(s.id)?.done);
  if (!current) return null;
  const done = STEPS.slice(0, WIN_COUNT).filter((s) => byId.get(s.id)?.done).length;
  const a = nextAction(current, base, g.nestTarget);
  const building = a.kind === "building" && base.buildQueue.some((o) => o.buildingId === a.id);
  return (
    <section className="panel rounded-xl p-3.5 mb-3 border-l-4 border-see" aria-label="Erste Schritte" data-testid="lage-first-steps">
      <div className="flex items-center gap-2 mb-1.5">
        <h2 className="font-display text-[11px] uppercase tracking-[0.16em] text-ink2 flex-1">Erste Schritte</h2>
        <span className="mono text-xs text-ink2" data-testid="first-steps-count">{done}/{WIN_COUNT} bis zum ersten Sieg</span>
      </div>
      <Bar value={done / WIN_COUNT} tone="brass" />
      <div className="mt-2.5 flex items-center gap-2.5">
        <Icon id={current.icon} size={34} />
        <span className="min-w-0 flex-1">
          <span className="block font-serif text-[16px] leading-tight">{current.title}</span>
          <span className="block text-xs text-ink2 mt-0.5 flex flex-wrap items-center gap-x-1.5">Belohnung <ResChips values={byId.get(current.id)?.reward} /></span>
        </span>
        {building ? <span className="text-xs text-see shrink-0">wird gebaut</span> : (
          <button type="button" className="tap shrink-0 rounded-lg bg-ink text-paper font-display uppercase tracking-[0.12em] text-[13px] px-4 py-2" onClick={() => runGuideAction(a, onGuide)}>Los</button>
        )}
      </div>
    </section>
  );
}

/** Bauempfehlung je Hafen mit leerer Bauschlange; „Bauen“ beginnt den Ausbau direkt, Antippen öffnet das Gebäudeblatt. */
export function BuildAdvice({ advice }: { advice: LageAdvice[] }) {
  const idle = advice.filter((a) => a.idle && a.options.length > 0);
  if (idle.length === 0) return null;
  return (
    <section className="panel rounded-xl p-3.5 mb-3" aria-label="Nächster Schritt" data-testid="lage-next">
      <h2 className="font-display text-[11px] uppercase tracking-[0.16em] text-ink2 mb-1">Nächster Schritt</h2>
      <ul>{idle.map((a) => <AdviceRow key={a.baseId} a={a} />)}</ul>
    </section>
  );
}

function AdviceRow({ a }: { a: LageAdvice }) {
  const nav = useNav();
  const o = a.options[0];
  const up = useCommand((i: { key: string; buildingId: string }) => trpcClient.base.upgrade.mutate(i),
    () => [trpc.base.pathFilter().queryKey, trpc.lage.pathFilter().queryKey, trpc.guide.pathFilter().queryKey]);
  const home = nav.base?.bases.find((b) => b.isHome)?.id;
  const pick = () => { if ((activeBaseId() ?? home) !== a.baseId) setActiveBase(a.baseId === home ? null : a.baseId); };
  const open = () => { pick(); nav.go({ to: "building", id: o.buildingId }); };
  const build = async () => {
    pick();
    const r = await up.run({ buildingId: o.buildingId });
    if (r?.ok) askPushAfter("bau");
  };
  const missing = Object.entries(o.missing).filter(([, n]) => n > 0);
  return (
    <li className="border-b border-dotted border-rule last:border-b-0 py-2" data-lage-row="bauempfehlung" data-lage-key={`bau-empfehlung:${a.baseId}`}>
      <div className="flex items-center gap-2.5">
        <button type="button" className="tap flex items-center gap-2.5 min-w-0 flex-1 text-left" onClick={open}>
          <Icon id={o.buildingId} size={30} />
          <span className="min-w-0">
            <span className="block text-sm leading-snug">
              <span className="text-ink2">{a.baseName ? `${a.baseName}: ` : ""}Bauhof frei · </span>
              <strong className="font-semibold">{label(o.buildingId)} {o.level}</strong>
            </span>
            <span className="block text-xs text-ink2 truncate">
              {adviceReason(o)} · {fmtDuration(o.durationMs)}{missing.length > 0 ? ` · fehlt ${missing.map(([r, n]) => `${fmtNum(n)} ${label(r)}`).join(", ")}` : ""}
            </span>
          </span>
        </button>
        {o.affordable ? (
          <button type="button" data-testid="advice-build" disabled={up.busy} onClick={() => void build()}
            className="tap shrink-0 rounded-lg bg-ink text-paper font-display uppercase tracking-[0.12em] text-[13px] px-4 py-2 disabled:opacity-50">
            {o.level === 1 ? "Bauen" : "Ausbauen"}
          </button>
        ) : (
          <button type="button" onClick={open} className="tap shrink-0 rounded-lg btn-quiet font-display uppercase tracking-[0.1em] text-[12px] px-3 py-2">Ansehen</button>
        )}
      </div>
      <ErrorLine text={up.error} code={up.code} detail={{ cost: o.cost, building: o.buildingId }} />
    </li>
  );
}
