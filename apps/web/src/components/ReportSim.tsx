// „Im Kampfsimulator öffnen“ an Berichten (Knopf und E-Mail-Link ?bericht=ID&sim=1): freier Simulator, vorbelegt mit
// den Verbänden vor dem Kampf, Anlagen, Wetter und den gespeicherten Modifikatoren (game-core reportSimPreset).
// Danach frei änderbar; was nicht gespeichert ist, steht offen darüber. Der Simulator selbst lädt nach.
import { lazy, Suspense, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { reportSimPreset, type ReportSimPreset } from "@tidefront/game-core";
import { trpc, type Balance, type BaseData } from "../lib/trpc.ts";
import { fmtNum } from "../lib/names.ts";
import { Icon } from "../icons.tsx";
import { Loading, Sheet } from "../ui.tsx";
import type { FreeSimPreset } from "./BattleSim.tsx";

const FreeSim = lazy(() => import("./BattleSim.tsx").then((m) => ({ default: m.FreeSim })));
const WinSearch = lazy(() => import("./WinSearch.tsx").then((m) => ({ default: m.WinSearch }))); // „Was hätte gefehlt?“

export interface SimReport { id?: number; kind: string; role: string; data: Record<string, unknown>; opponentIsPlayer?: boolean }

/** Verlorener eigener Angriff (nachstellbar): „Was hätte gefehlt?“ anbieten. */
export function lostAttack(r: SimReport): boolean {
  const battle = r.data.battle as { winner?: unknown } | undefined;
  return r.role === "attacker" && !!battle && battle.winner === "defender" && r.kind !== "spionage";
}

/** Vorbelegung aus einem Bericht; null ohne Kampf bzw. aufgeklärtes Ziel. */
export function presetOf(r: SimReport, balance: Balance): ReportSimPreset | null {
  return reportSimPreset(r.kind, r.role, r.data, balance, { opponentIsPlayer: !!r.opponentIsPlayer });
}

const homeUnits = (base: BaseData, balance: Balance) =>
  Object.fromEntries(base.units.filter((u) => u.home > 0 && !balance.units[u.id]?.covert).map((u) => [u.id, u.home]));

/** Seite des Lesers mit seinen aktuellen Werten (Forschung, Veteranen, Versorgung daheim) statt der gespeicherten. */
export function toFreeSim(p: ReportSimPreset, base: BaseData, balance: Balance, current: boolean): FreeSimPreset {
  const own = { modifiers: base.modifiers, versorgungsmangel: base.versorgungsmangel };
  const kind = { rule: p.rule, loot: p.loot, mine: p.mine, ...(p.weather ? { weather: p.weather } : {}) };
  if (!p.attacker) return { attacker: { units: homeUnits(base, balance), ...own }, defender: p.defender, rule: p.rule, loot: p.loot, mine: "attacker" };
  // Abwehr ohne gespeicherte Bestände: Beute des Angreifers mit den heutigen eigenen Beständen.
  const stock = p.ownStockNeeded ? { resources: base.resources } : {};
  if (!current) return { attacker: p.attacker, defender: { ...p.defender, ...stock }, ...kind };
  const attacker = p.mine === "attacker" ? { ...p.attacker, ...own } : p.attacker;
  const defender = p.mine === "defender" ? { ...p.defender, ...own, ...stock } : p.defender;
  return { attacker, defender, ...kind };
}

const f2 = (n: number) => `×${fmtNum(n, 2)}`;

function RealFight({ p }: { p: ReportSimPreset }) {
  const won = p.winner === p.mine;
  return (
    <div className="rounded-xl border border-rule bg-card p-3 text-sm" data-testid="report-sim-real">
      <div className="font-display text-[11px] uppercase tracking-[0.14em] text-ink2 mb-1">Im echten Kampf</div>
      <p>
        <strong className={won ? "text-moos" : "text-siegel"}>{won ? "Sieg" : "Niederlage"}</strong> für dich
        {p.luck ? <> · Glück {p.names[0]} {f2(p.luck.attacker)}, {p.names[1]} {f2(p.luck.defender)}</> : " · ohne Kriegsglück-Würfe"}.
      </p>
      <p className="text-xs text-ink2 mt-1">Der Simulator rechnet 50-mal mit zufälligem Kriegsglück – so siehst du, ob das Ergebnis Glück oder Pech war.</p>
    </div>
  );
}

export function ReportSimSheet({ report, title, onClose, missing = false }: { report: SimReport; title: string; onClose: () => void; missing?: boolean }) {
  const meta = useQuery({ ...trpc.meta.queryOptions(), staleTime: Infinity });
  const baseQ = useQuery(trpc.base.get.queryOptions());
  const base = { data: baseQ.data?.base ?? undefined };
  const [current, setCurrent] = useState(false);
  const balance = meta.data?.balance;
  const p = useMemo(() => (balance ? presetOf(report, balance) : null), [report, balance]);
  const sim = useMemo(() => (p && base.data && balance ? toFreeSim(p, base.data, balance, current) : null), [p, base.data, balance, current]);
  // „Was hätte gefehlt?“: mit den heutigen eigenen Werten gegen das Ziel des Berichts; Planen zum Ziel des Berichts.
  const today = useMemo(() => (p && base.data && balance ? toFreeSim(p, base.data, balance, true) : null), [p, base.data, balance]);
  const at = useQuery({ ...trpc.comfort.repeat.queryOptions({ reportId: report.id ?? 0 }), enabled: missing && report.id !== undefined });
  const planAt = at.data ? { col: at.data.col, row: at.data.row } : null;
  return (
    <Sheet open onClose={onClose} title="Kampfsimulator" icon={<Icon id="korvette" size={40} />}>
      {!balance || !base.data ? <Loading /> : !p || !sim ? <p className="text-sm text-ink2">Dieser Bericht enthält keinen Kampf zum Nachstellen.</p> : (
        <div className="space-y-3" data-testid="report-sim">
          <p className="text-sm"><span className="text-ink2">Aus dem Bericht:</span> <strong className="font-serif">{title}</strong></p>
          {p.source === "kampf" && <RealFight p={p} />}
          {missing && today && p.mine === "attacker" && (() => {
            const { units: _u, ...conditions } = today.attacker;
            return (
              <Suspense fallback={<p className="text-sm text-ink2 font-serif italic">Simulator lädt …</p>}>
                <WinSearch title="Was hätte gefehlt?" autoStart base={base.data} balance={balance} planAt={planAt}
                  target={{ attacker: conditions, defenders: [today.defender], ...(today.weather ? { weather: today.weather } : {}), ...(today.rule ? { rule: today.rule } : {}), ...(today.loot ? { loot: today.loot } : {}) }} />
              </Suspense>
            );
          })()}
          {p.ownStockNeeded && <p className="text-xs text-ink2">Bestände nicht gespeichert – Beute des Angreifers mit deinen heutigen Beständen gerechnet.</p>}
          {p.notes.length > 0 && (
            <ul className="text-xs text-ink2 space-y-0.5" data-testid="report-sim-notes">
              {p.notes.map((n) => <li key={n} className="flex gap-1.5"><span aria-hidden="true">·</span><span className="min-w-0 break-words">{n}</span></li>)}
            </ul>
          )}
          {p.source === "kampf" && (
            <label className="flex items-center gap-2 text-sm min-h-[44px]">
              <input type="checkbox" className="h-5 w-5" checked={current} onChange={(e) => setCurrent(e.target.checked)} />
              <span>Mit meinen heutigen Werten rechnen (Forschung, Veteranen, Versorgung)</span>
            </label>
          )}
          <Suspense fallback={<p className="text-sm text-ink2 font-serif italic">Simulator lädt …</p>}>
            <FreeSim key={current ? "heute" : "damals"} balance={balance} base={base.data} preset={sim} planAt={planAt} />
          </Suspense>
        </div>
      )}
    </Sheet>
  );
}
