// Missionsplanung vom Ziel her (UX-0.43 U-2): Öffnet die Planung mit einem Ziel aus einem Blatt (Nest, Feld,
// Weltereignis, Hafen) oder dem Auftragsbuch, rechnet sie den kleinsten siegreichen Verband aus dem Bestand
// (Probekampf ≥ 90 % gegen frische Würfe, game-core plan-suggest.ts über die Suche „Was fehlt zum Sieg?“ im Web Worker)
// und setzt ihn als Verband ein. Reicht der Bestand nicht, steht da, was fehlt („+8 Schützen“) mit „Ausbilden“; ist
// die Lage am Ziel unbekannt, „Erst aufklären“.
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { classifySuggestion, PLAN_SUGGEST_TARGET, type DefenderInput, type PlanSuggestion, type VictoryRule } from "@tidefront/game-core";
import { trpc, type Balance, type BaseData } from "../lib/trpc.ts";
import { fmtNum } from "../lib/names.ts";
import { fmtSeconds } from "../lib/time.ts";
import { runWinSearch } from "../lib/sim-client.ts";
import { winInput } from "../lib/win-input.ts";
import { nestProbeDefenders, type MapNestLagebild } from "../lib/nest-intel.ts";
import { setTrainPreset } from "../lib/train-request.ts";
import { useNav } from "../lib/nav.ts";
import { Icon } from "../icons.tsx";
import { Bar, Button, Card, Cost, SmallButton, UnitChips } from "../ui.tsx";
import { extraText } from "./WinSearch.tsx";

type Counts = Record<string, number>;

/** Ziel der Planung, wie MissionPlan es kennt. */
export type SuggestFor =
  | { kind: "nest"; level: number | null; empty?: boolean | null; lagebild?: MapNestLagebild | null }
  | { kind: "base"; col: number; row: number; name: string }
  | { kind: "field"; units: Counts | null; free: boolean }
  | { kind: "event"; units: Counts | null };

/** Ziel für den Vorschlag aus dem, was die Planung über das Ziel weiß; null = kein Vorschlag (andere Art, eigenes Ziel). */
export function suggestForOf(p: {
  type: string; target: { col: number; row: number; eventId?: number; fieldId?: number };
  nest?: { level: number | null; empty?: boolean | null; lagebild?: MapNestLagebild | null } | null;
  harbor?: { name: string; own?: boolean } | null; own: boolean;
  event?: { units: Counts; finale?: unknown } | null;
  field?: { relation: string; guard?: Counts | null; garrison?: Counts | null; intel?: { units: Counts } | null } | null;
}): SuggestFor | null {
  const { type, target: t } = p;
  const has = (c: Counts | null | undefined) => (c && Object.values(c).some((n) => n > 0) ? c : null);
  if (type === "besetzen" && t.fieldId) {
    if (!p.field || p.field.relation === "own") return null;
    return { kind: "field", units: has(p.field.guard) ?? has(p.field.garrison) ?? has(p.field.intel?.units) ?? null, free: p.field.relation === "frei" };
  }
  if (type !== "ueberfall") return null;
  if (t.eventId) return p.event && !p.event.finale ? { kind: "event", units: has(p.event.units) } : null;
  if (p.nest) return { kind: "nest", level: p.nest.level, empty: p.nest.empty, lagebild: p.nest.lagebild };
  if (p.harbor && !p.harbor.own && !p.own) return { kind: "base", col: t.col, row: t.row, name: p.harbor.name };
  return null;
}

const REASON: Record<string, string> = {
  command_points: "Die Kommandopunkte reichen nicht für einen so großen Verband – Kommandozentrale ausbauen.",
  no_units: "Keine passende Kampfeinheit kann ausgebildet werden – erst Werft, Kaserne oder Flugfeld bauen.",
  no_progress: "Auch mit deutlich mehr Einheiten der heute ausbildbaren Arten steigt die Siegchance nicht genug.",
};
const pct = (v: number) => `${fmtNum(Math.round(v * 100))} %`;

/** Gegner und Siegregel des Ziels; null = Lage unbekannt (erst aufklären), "leer" = kein Kampf. */
function defendersOf(t: SuggestFor, balance: Balance, scout: DefenderInput | null | undefined): { defenders: DefenderInput[]; rule?: VictoryRule } | null | "leer" {
  if (t.kind === "nest") return t.level === null ? null : t.empty ? "leer" : { defenders: nestProbeDefenders(t.level, t.lagebild, Date.now(), balance) };
  if (t.kind === "base") return scout ? { defenders: [scout] } : null;
  if (t.kind === "field") return t.units ? { defenders: [{ units: t.units, defenses: {} }], rule: "halten" } : t.free ? "leer" : null;
  return t.units ? { defenders: [{ units: t.units, defenses: {} }], rule: "vernichtung" } : null;
}

export function PlanSuggest({ target, base, balance, seaOnly, autoApply, onApply, onScout }: {
  target: SuggestFor; base: BaseData; balance: Balance;
  /** Felder: nur Schiffe (Seekampf). */ seaOnly?: boolean;
  /** Vorschlag selbst einsetzen, solange der Spieler noch keinen Verband gewählt hat. */ autoApply: boolean;
  onApply: (units: Counts) => void; onScout: () => void;
}) {
  const auto = useRef(autoApply);
  auto.current = autoApply;
  const nav = useNav();
  const scoutQ = useQuery({ ...trpc.comfort.scout.queryOptions(target.kind === "base" ? { col: target.col, row: target.row } : { col: 0, row: 0 }), enabled: target.kind === "base" });
  const scout = scoutQ.data ? { units: scoutQ.data.units, defenses: scoutQ.data.defenses, resources: scoutQ.data.resources, protectedPerResource: scoutQ.data.protectedPerResource } : scoutQ.isLoading ? undefined : null;
  const def = useMemo(() => (target.kind === "base" && scout === undefined ? undefined : defendersOf(target, balance, scout)), [JSON.stringify(target), scoutQ.data, scoutQ.isLoading, balance]); // eslint-disable-line react-hooks/exhaustive-deps
  const [s, setS] = useState<{ running: boolean; progress: number; result: PlanSuggestion | null; error: boolean }>({ running: false, progress: 0, result: null, error: false });
  const applied = useRef(false);
  useEffect(() => {
    if (!def || def === "leer") return;
    const sea = (id: string) => !seaOnly || balance.units[id]?.branch === "see";
    const input = winInput({ attacker: { ...(base.modifiers ? { modifiers: base.modifiers as never } : {}), ...(base.versorgungsmangel ? { versorgungsmangel: true } : {}) }, defenders: def.defenders, ...(def.rule ? { rule: def.rule } : {}) }, base, balance, PLAN_SUGGEST_TARGET);
    input.have = Object.fromEntries(Object.entries(input.have).filter(([id]) => sea(id)));
    input.allowed = input.allowed.filter(sea);
    setS({ running: true, progress: 0, result: null, error: false });
    const run = runWinSearch(input, balance, (p) => setS((x) => ({ ...x, progress: p })));
    run.promise.then(
      (r) => {
        const result = classifySuggestion(r);
        setS({ running: false, progress: 1, result, error: false });
        if (result.status === "bestand" && !applied.current && auto.current) { applied.current = true; onApply(result.units); }
      },
      (e: Error) => { if (e.message !== "cancelled") setS((x) => ({ ...x, running: false, error: true })); },
    );
    return () => run.cancel();
  }, [def]); // eslint-disable-line react-hooks/exhaustive-deps

  if (def === undefined) return null;
  if (def === "leer") return null;
  const r = s.result;
  return (
    <Card title="Vorschlag">
      <div data-testid="plan-suggest" data-status={def === null ? "unbekannt" : s.running ? "rechnet" : r?.status ?? ""}>
        {def === null ? (
          <div className="flex items-center gap-2.5">
            <Icon id="aufklaerung" size={30} />
            <p className="text-sm flex-1">Lage am Ziel unbekannt – ohne Aufklärung kein Probekampf und kein Vorschlag.</p>
            <Button kind="secondary" onClick={onScout}>Erst aufklären</Button>
          </div>
        ) : s.running ? (
          <div>
            <p className="text-sm text-ink2 mb-1">Suche den kleinsten Verband aus deinem Bestand, der 9 von 10 Probekämpfen gewinnt …</p>
            <Bar value={s.progress} tone="sea" />
          </div>
        ) : s.error ? <p className="text-sm text-siegel">Der Vorschlag ließ sich nicht rechnen.</p>
          : r?.status === "bestand" ? (
          <div className="text-sm space-y-1">
            <p><strong className="text-moos">Kleinster siegreicher Verband aus deinem Bestand</strong> – {pct(r.winRate)} Sieg im Probekampf (geprüft gegen 300 weitere Würfe).</p>
            <UnitChips counts={r.units} />
            <SmallButton onClick={() => onApply(r.units)}>Vorschlag einsetzen</SmallButton>
          </div>
        ) : r?.status === "fehlt" ? (
          <div className="text-sm space-y-1">
            <p className="font-semibold text-messing">Dein Bestand reicht nicht für {pct(PLAN_SUGGEST_TARGET)} Sieg.</p>
            <p><span className="text-ink2">Es fehlen:</span> <strong data-testid="plan-suggest-extra">{extraText(r.extra)}</strong></p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1"><Cost cost={r.extraCost} /><span className="text-xs text-ink2">{fmtSeconds(r.trainSeconds)} Ausbildung</span></div>
            <div className="flex flex-wrap gap-2 pt-1">
              <Button onClick={() => { setTrainPreset(r.extra); nav.go({ to: "troops", seg: "ausbilden" }); }}>Ausbilden</Button>
              <SmallButton onClick={() => onApply(r.units)}>Trotzdem mit dem Bestand planen</SmallButton>
            </div>
          </div>
        ) : r ? (
          <div className="text-sm">
            <p className="font-semibold text-siegel">Mit heutigen Einheiten nicht zu schlagen ({pct(PLAN_SUGGEST_TARGET)}).</p>
            <p className="text-xs text-ink2">{REASON[r.reason ?? "no_progress"]} Bestes Ergebnis: {pct(r.winRate)}.</p>
          </div>
        ) : null}
      </div>
    </Card>
  );
}
