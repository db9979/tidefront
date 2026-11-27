// „Was fehlt zum Sieg?“ (Simulator-Chunk): sucht im Web Worker den günstigsten Verband zum Richtpreis, der gegen das
// Ziel die gewählte Sicherheit (70/90/99 %) erreicht – Bestand zuerst, was fehlt mit Kosten und Ausbildungszeit.
// Knöpfe: „Ausbilden“ (Truppen → Ausbilden mit vorgewählten Mengen) und „Mit diesem Verband planen“.
import { useEffect, useRef, useState } from "react";
import type { WinSearchResult } from "@tidefront/game-core";
import type { Balance, BaseData } from "../lib/trpc.ts";
import { countLabel, fmtNum } from "../lib/names.ts";
import { fmtSeconds } from "../lib/time.ts";
import { runWinSearch } from "../lib/sim-client.ts";
import { winInput, type WinTarget } from "../lib/win-input.ts";
import { setTrainPreset } from "../lib/train-request.ts";
import { requestPlan } from "../lib/plan-request.ts";
import { useNav } from "../lib/nav.ts";
import type { Target } from "../App.tsx";
import { Icon } from "../icons.tsx";
import { Bar, Button, Cost, ResChips, SmallButton, UnitChips } from "../ui.tsx";

const GOALS = [0.7, 0.9, 0.99];
const pctText = (v: number) => `${fmtNum(Math.round(v * 1000) / 10, v > 0.99 && v < 1 ? 1 : 0)} %`;
const REASON: Record<string, string> = {
  command_points: "Die Kommandopunkte reichen nicht für einen so großen Verband – Kommandozentrale ausbauen.",
  no_units: "Keine Kampfeinheit kann ausgebildet werden – erst Werft, Kaserne oder Flugfeld bauen.",
  no_progress: "Auch mit deutlich mehr Einheiten der heute ausbildbaren Arten steigt die Siegchance nicht genug.",
};

/** „+8 Schützen, +1 Landungsschiff“ */
export function extraText(extra: Record<string, number>): string {
  return Object.entries(extra).map(([id, n]) => `+${fmtNum(n)} ${countLabel(id, n)}`).join(", ");
}

type State = { running: boolean; progress: number; result: WinSearchResult | null; error: boolean; goal: number; ms: number };

export function WinSearch({ target, base, balance, planAt, title = "Was fehlt zum Sieg?", autoStart = false }: { target: WinTarget; base: BaseData; balance: Balance; planAt?: Target | null; title?: string; autoStart?: boolean }) {
  const [goal, setGoal] = useState(0.9);
  const [s, setS] = useState<State>({ running: false, progress: 0, result: null, error: false, goal: 0.9, ms: 0 });
  const job = useRef<{ cancel: () => void; abort: () => void } | null>(null);
  const nav = useNav();
  const start = (g = goal) => {
    job.current?.abort(); // neue Suche: die alte (falls sie noch läuft) beenden
    const t0 = performance.now();
    setS({ running: true, progress: 0, result: null, error: false, goal: g, ms: 0 });
    const run = runWinSearch(winInput(target, base, balance, g), balance, (p) => setS((x) => ({ ...x, progress: p })));
    job.current = run;
    const done = () => { if (job.current === run) job.current = null; };
    run.promise.then(
      (result) => { done(); setS({ running: false, progress: 1, result, error: false, goal: g, ms: performance.now() - t0 }); },
      (e: Error) => { if (e.message === "cancelled") return; done(); setS((x) => ({ ...x, running: false, error: true })); },
    );
  };
  // Beim Öffnen einmal rechnen; beim Abbau nur die Antwort verwerfen (React baut Effekte im Entwicklungsmodus doppelt auf).
  useEffect(() => {
    if (autoStart) start();
    return () => { job.current?.cancel(); job.current = null; };
  }, []);
  const r = s.result;
  return (
    <div className="rounded-xl border border-rule bg-card p-3 space-y-2" data-testid="win-search">
      <div className="flex items-center gap-2">
        <Icon id="admiral" size={28} />
        <strong className="font-serif flex-1 min-w-0">{title}</strong>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-ink2">Sicherheit</span>
        <div className="flex gap-1" role="radiogroup" aria-label="Sicherheit">
          {GOALS.map((g) => (
            <button key={g} type="button" role="radio" aria-checked={goal === g} onClick={() => setGoal(g)}
              className={`tap min-w-12 rounded-lg border px-2 text-sm ${goal === g ? "border-ink bg-paper font-semibold" : "border-rule"}`}>{Math.round(g * 100)} %</button>
          ))}
        </div>
        <Button kind="secondary" className="ml-auto" disabled={s.running} onClick={() => start()}>{s.result ? "Neu rechnen" : "Suchen"}</Button>
      </div>
      {s.running && (
        <div data-testid="win-search-progress">
          <Bar value={s.progress} tone="sea" />
          <div className="flex justify-between text-xs text-ink2 mt-0.5">
            <span>rechnet … {Math.round(s.progress * 100)} %</span>
            <button type="button" className="underline" onClick={() => { job.current?.abort(); setS((x) => ({ ...x, running: false })); }}>Abbrechen</button>
          </div>
        </div>
      )}
      {s.error && <p className="text-sm text-siegel">Die Suche ist fehlgeschlagen. Bitte erneut versuchen.</p>}
      {!s.running && !r && !s.error && <p className="text-xs text-ink2">Sucht den günstigsten Verband zum Richtpreis, der dieses Ziel mit der gewählten Sicherheit schlägt – dein Bestand zuerst, Landungsschiffe, Kommandopunkte und ausbildbare Einheiten eingerechnet.</p>}
      {r && !s.running && <WinResult r={r} goal={s.goal} ms={s.ms} base={base} planAt={planAt}
        onTrain={() => { setTrainPreset(r.extra); nav.go({ to: "troops", seg: "ausbilden" }); }}
        onPlan={planAt ? () => requestPlan({ target: planAt, type: "ueberfall", units: r.units }) : undefined} />}
    </div>
  );
}

function WinResult({ r, goal, ms, base, planAt, onTrain, onPlan }: { r: WinSearchResult; goal: number; ms: number; base: BaseData; planAt?: Target | null; onTrain: () => void; onPlan?: () => void }) {
  const need = Object.keys(r.extra).length > 0;
  return (
    <div className="space-y-2 text-sm" data-testid="win-search-result">
      {!r.reachable ? (
        <div>
          <p className="font-semibold text-siegel">Nicht erreichbar mit heutigen Einheiten ({Math.round(goal * 100)} %).</p>
          <p className="text-xs text-ink2">{REASON[r.reason ?? "no_progress"]} Bestes Ergebnis der Suche: {pctText(r.winRate)} Siegchance.</p>
        </div>
      ) : need ? (
        <div>
          <p><span className="text-ink2">Es fehlen:</span> <strong data-testid="win-search-extra">{extraText(r.extra)}</strong></p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-0.5">
            <Cost cost={r.extraCost} have={base.resources} />
            <span className="text-xs text-ink2 inline-flex items-center gap-1"><Icon id="uhr" size={14} /> {fmtSeconds(r.trainSeconds)} Ausbildung</span>
          </div>
        </div>
      ) : (
        <p className="font-semibold text-moos">Dein Bestand reicht – nichts auszubilden.</p>
      )}
      <div>
        <div className="text-[11px] font-display uppercase tracking-[0.12em] text-ink2">Verband</div>
        <UnitChips counts={r.units} />
      </div>
      <p className="text-xs">
        Siegchance <strong>{pctText(r.winRate)}</strong> <span className="text-ink2">(geprüft gegen 300 weitere Würfe)</span>
        {" · "}erwartete Verluste ≈ {fmtNum(Math.round(r.lossValue))} <span className="text-ink2">(Richtpreis)</span>
      </p>
      {Object.keys(r.losses).length > 0 && <div className="text-xs"><span className="text-ink2">Verluste Ø:</span> <UnitChips counts={Object.fromEntries(Object.entries(r.losses).map(([id, n]) => [id, Math.round(n)]).filter(([, n]) => (n as number) > 0))} /></div>}
      <div className="text-xs"><span className="text-ink2">Beute Ø:</span> {r.lootUnknown ? "unbekannt" : <ResChips values={r.loot} empty="keine" />}</div>
      <div className="flex flex-wrap gap-2">
        {need && <Button onClick={onTrain}>Ausbilden</Button>}
        {onPlan && planAt && r.reachable && <SmallButton onClick={onPlan}>Mit diesem Verband planen</SmallButton>}
      </div>
      <p className="text-[11px] text-ink2">Gerechnet: {fmtNum(r.battles)} Kämpfe in {fmtNum(ms / 1000, 1)} s. Kosten zum Richtpreis; Ausbildung je Baugebäude nacheinander, Werft, Kaserne und Flugfeld gleichzeitig.{need && onPlan ? " Planen kürzt auf das, was daheim ist." : ""}</p>
    </div>
  );
}
