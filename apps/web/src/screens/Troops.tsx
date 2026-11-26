import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { trpc, trpcClient, type BaseData, type Balance } from "../lib/trpc.ts";
import { useCommand } from "../lib/command.ts";
import { fmtNum, label } from "../lib/names.ts";
import { fmtDuration, fmtSeconds, useNow } from "../lib/time.ts";
import type { Target } from "../App.tsx";
import { Button, Card, Cost, CountsLine, ErrorLine, Loading, Stepper } from "../ui.tsx";
import { Progress } from "./Base.tsx";

const invalidateBase = () => [trpc.base.pathFilter().queryKey];
const GROUPS: { builtIn: string; title: string }[] = [
  { builtIn: "werft", title: "Werft" },
  { builtIn: "kaserne", title: "Kaserne" },
  { builtIn: "flugfeld", title: "Flugfeld" },
  { builtIn: "anlagen", title: "Verteidigungsanlagen" },
];

function scale(cost: Record<string, number> | undefined, n: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [r, v] of Object.entries(cost ?? {})) out[r] = v * n;
  return out;
}

export function TroopsScreen({ base, onPlan, onShowOnMap }: { base: BaseData; onPlan: () => void; onShowOnMap: (t: Target) => void }) {
  const meta = useQuery({ ...trpc.meta.queryOptions(), staleTime: Infinity });
  const now = useNow();
  const cancel = useCommand((i: { key: string; builtIn: string }) => trpcClient.base.cancelTraining.mutate(i), invalidateBase);
  if (!meta.data) return <Loading />;
  const balance = meta.data.balance;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-xl font-bold">Truppen</h1>
        <Button onClick={onPlan}>Mission planen</Button>
      </div>

      <Card title={`Missionen ${base.activeMissions}/${base.missionSlots}`}>
        {base.missions.length === 0 && <p className="text-sm text-slate-400">Keine laufenden Missionen.</p>}
        <ul className="divide-y divide-navy-700">
          {base.missions.map((m) => (
            <li key={m.id} className="py-2 text-sm">
              <div className="flex justify-between gap-2">
                <strong>{label(m.type)}</strong>
                <button type="button" className="tap text-sea-300 underline text-xs" onClick={() => onShowOnMap({ col: m.target.col, row: m.target.row })}>
                  Ziel {m.target.col}/{m.target.row}
                </button>
              </div>
              <div className="text-xs text-slate-300"><CountsLine counts={m.status === "returning" ? m.returning : m.units} /></div>
              <div className="text-sea-300">
                {m.status === "outbound" ? `Ankunft in ${fmtDuration(m.arriveAtMs - now)}` : `Rückkehr in ${fmtDuration(m.returnAtMs - now)}`}
              </div>
              {m.cargoHome && Object.values(m.cargoHome).some((v) => v > 0) && (
                <div className="text-xs text-brass-400">Ladung: <CountsLine counts={m.cargoHome} /></div>
              )}
            </li>
          ))}
        </ul>
      </Card>

      <ErrorLine text={cancel.error} />
      {GROUPS.map((g) => {
        const order = base.trainingQueue.find((o) => o.builtIn === g.builtIn);
        const level = g.builtIn === "anlagen" ? 1 : base.buildings.find((b) => b.id === g.builtIn)?.level ?? 0;
        return (
          <Card key={g.builtIn} title={g.title} right={g.builtIn !== "anlagen" ? <span className="text-xs text-slate-400">Stufe {level}</span> : undefined}>
            {g.builtIn === "flugfeld" && <p className="text-xs text-slate-400 mb-1">Stellplätze {base.aircraftSlots.used}/{base.aircraftSlots.total}</p>}
            {order && (
              <div className="rounded-lg bg-navy-900 p-2 mb-2 flex items-center justify-between gap-2">
                <div className="text-sm">
                  {fmtNum(order.count)} × {label(order.id)}
                  <div className="text-sea-300">{order.finishesAt <= now ? "wird abgeschlossen …" : `noch ${fmtDuration(order.finishesAt - now)}`}</div>
                  <Progress start={order.startedAt} end={order.finishesAt} now={now} />
                </div>
                <Button kind="danger" disabled={cancel.busy} onClick={() => void cancel.run({ builtIn: g.builtIn })}>Abbruch</Button>
              </div>
            )}
            {level < 1 ? (
              <>
                <p className="text-sm text-slate-400">Erst {label(g.builtIn)} bauen.</p>
                {base.units.some((u) => u.builtIn === g.builtIn && u.home + u.away > 0) && (
                  <p className="text-sm mt-1">
                    Vorhanden: <CountsLine counts={Object.fromEntries(base.units.filter((u) => u.builtIn === g.builtIn).map((u) => [u.id, u.home + u.away]))} />
                  </p>
                )}
              </>
            ) : (
              <ul className="divide-y divide-navy-700">
                {g.builtIn === "anlagen"
                  ? base.defenses.map((d) => (
                      <TrainRow key={d.id} id={d.id} have={d.count} away={0} base={base} balance={balance} busy={!!order} secondsEach={balance.defenses[d.id].seconds} cost={balance.defenses[d.id].cost} />
                    ))
                  : base.units.filter((u) => u.builtIn === g.builtIn).map((u) => (
                      <TrainRow key={u.id} id={u.id} have={u.home} away={u.away} base={base} balance={balance} busy={!!order} secondsEach={u.secondsEach} cost={balance.units[u.id].cost} />
                    ))}
              </ul>
            )}
          </Card>
        );
      })}
    </div>
  );
}

function stats(balance: Balance, id: string): string {
  const u = balance.units[id] ?? balance.npcUnits[id];
  const d = balance.defenses[id];
  const a = u?.attack ?? d?.attack;
  const hp = u?.hp ?? d?.hp;
  const parts = [`HP ${hp}`];
  if (a) parts.push(`See ${a.see} · Luft ${a.luft} · Land ${a.land}${a.anlage ? ` · Anlage ${a.anlage}` : ""}`);
  if (d?.oneShotDamageToLanding) parts.push(`${d.oneShotDamageToLanding} Schaden bei Landung`);
  if (u?.cargo) parts.push(`Ladung ${u.cargo}`);
  if (u?.troopSpace) parts.push(`Truppenraum ${u.troopSpace}`);
  if (u?.rangeKm) parts.push(`Reichweite ${u.rangeKm} km`);
  return parts.join(" · ");
}

function TrainRow(props: { id: string; have: number; away: number; base: BaseData; balance: Balance; busy: boolean; secondsEach: number | null; cost: Record<string, number> | undefined }) {
  const [n, setN] = useState(1);
  const cmd = useCommand((i: { key: string; id: string; count: number }) => trpcClient.base.train.mutate(i), invalidateBase);
  return (
    <li className="py-2">
      <div className="flex justify-between gap-2">
        <div className="font-medium">{label(props.id)}</div>
        <div className="text-sm text-slate-300">{fmtNum(props.have)}{props.away > 0 ? ` (+${fmtNum(props.away)} unterwegs)` : ""}</div>
      </div>
      <div className="text-xs text-slate-400">{stats(props.balance, props.id)}</div>
      <div className="flex items-center justify-between gap-2 mt-1 flex-wrap">
        <Stepper value={n} onChange={setN} />
        <Button kind="secondary" disabled={props.busy || cmd.busy || n < 1} onClick={() => void cmd.run({ id: props.id, count: n })}>
          Bauen
        </Button>
      </div>
      <div className="flex justify-between gap-2 mt-1">
        <Cost cost={scale(props.cost, n)} have={props.base.resources} />
        {props.secondsEach !== null && <span className="text-xs text-slate-400">⏱ {fmtSeconds(props.secondsEach * n)}</span>}
      </div>
      <ErrorLine text={cmd.error} />
    </li>
  );
}
