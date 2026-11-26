import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { trpc, trpcClient, type BaseData, type Balance } from "../lib/trpc.ts";
import { useCommand } from "../lib/command.ts";
import { fmtNum, label } from "../lib/names.ts";
import { fmtDuration, fmtSeconds, useNow } from "../lib/time.ts";
import type { Target } from "../App.tsx";
import { Button, Card, Cost, ErrorLine, Loading, Sheet, StatTable, Stepper, UnitChips } from "../ui.tsx";
import { Icon, IconTile } from "../icons.tsx";
import { UNIT_TEXT, unitStats, unitTone } from "../lib/info.ts";
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
        <h1 className="font-display text-xl font-bold uppercase">Truppen</h1>
        <Button onClick={onPlan}>Mission planen</Button>
      </div>

      <Card title={`Missionen ${base.activeMissions}/${base.missionSlots}`}>
        {base.missions.length === 0 && <p className="text-sm text-slate-400">Keine laufenden Missionen. Plane einen Überfall auf ein Piratennest über die Karte oder „Mission planen“.</p>}
        <ul className="divide-y divide-navy-700">
          {base.missions.map((m) => (
            <li key={m.id} className="py-2 text-sm flex gap-3">
              <Icon id={m.type} size={36} />
              <div className="flex-1 min-w-0">
              <div className="flex justify-between gap-2">
                <strong>{label(m.type)} {m.status === "returning" ? "· Rückfahrt" : ""}</strong>
                <button type="button" className="tap text-sea-300 underline text-xs" onClick={() => onShowOnMap({ col: m.target.col, row: m.target.row })}>
                  Ziel {m.target.col}/{m.target.row}
                </button>
              </div>
              <div className="text-xs text-slate-300"><UnitChips counts={m.status === "returning" ? m.returning : m.units} /></div>
              <div className="text-sea-300">
                {m.status === "outbound" ? `Ankunft in ${fmtDuration(m.arriveAtMs - now)}` : `Rückkehr in ${fmtDuration(m.returnAtMs - now)}`}
              </div>
              {m.cargoHome && Object.values(m.cargoHome).some((v) => v > 0) && (
                <div className="text-xs text-brass-400">Ladung: <UnitChips counts={m.cargoHome} /></div>
              )}
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <ErrorLine text={cancel.error} />
      {GROUPS.map((g) => {
        const order = base.trainingQueue.find((o) => o.builtIn === g.builtIn);
        const level = g.builtIn === "anlagen" ? 1 : base.buildings.find((b) => b.id === g.builtIn)?.level ?? 0;
        return (
          <Card key={g.builtIn} title={<span className="flex items-center gap-2"><Icon id={g.builtIn === "anlagen" ? "kuestenbatterie" : g.builtIn} size={22} />{g.title}</span>} right={g.builtIn !== "anlagen" ? <span className="text-xs text-slate-400">Stufe {level}</span> : undefined}>
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
                <p className="text-sm text-slate-400 flex items-center gap-2"><IconTile id={g.builtIn} size={36} /> Erst {label(g.builtIn)} bauen (Basis → {g.title}).</p>
                {base.units.some((u) => u.builtIn === g.builtIn && u.home + u.away > 0) && (
                  <p className="text-sm mt-1">
                    Vorhanden: <UnitChips counts={Object.fromEntries(base.units.filter((u) => u.builtIn === g.builtIn).map((u) => [u.id, u.home + u.away]))} />
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

function TrainRow(props: { id: string; have: number; away: number; base: BaseData; balance: Balance; busy: boolean; secondsEach: number | null; cost: Record<string, number> | undefined }) {
  const [n, setN] = useState(1);
  const cmd = useCommand((i: { key: string; id: string; count: number }) => trpcClient.base.train.mutate(i), invalidateBase);
  const [info, setInfo] = useState(false);
  return (
    <li className="py-2">
      <div className="flex gap-3 items-start">
        <button type="button" onClick={() => setInfo(true)} aria-label={`${label(props.id)}: Info`}><IconTile id={props.id} size={52} tone={unitTone(props.balance, props.id)} /></button>
        <div className="min-w-0 flex-1">
          <div className="flex justify-between gap-2">
            <button type="button" className="font-semibold text-left" onClick={() => setInfo(true)}>{label(props.id)} <span className="text-sea-300 text-xs">ⓘ</span></button>
            <div className="text-sm tabular-nums"><strong>{fmtNum(props.have)}</strong>{props.away > 0 ? <span className="text-slate-400"> +{fmtNum(props.away)} unterwegs</span> : ""}</div>
          </div>
          <div className="text-xs text-slate-400">{UNIT_TEXT[props.id]}</div>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 mt-2 flex-wrap">
        <Stepper value={n} onChange={setN} />
        <Button kind="secondary" disabled={props.busy || cmd.busy || n < 1} onClick={() => void cmd.run({ id: props.id, count: n })}>
          Bauen
        </Button>
      </div>
      <div className="flex justify-between gap-2 mt-1">
        <Cost cost={scale(props.cost, n)} have={props.base.resources} />
        {props.secondsEach !== null && <span className="text-xs text-slate-400 flex items-center gap-1"><Icon id="uhr" size={14} /> {fmtSeconds(props.secondsEach * n)}</span>}
      </div>
      <ErrorLine text={cmd.error} />
      <Sheet open={info} onClose={() => setInfo(false)} title={label(props.id)} icon={<IconTile id={props.id} size={56} tone={unitTone(props.balance, props.id)} />}>
        <p className="text-sm text-slate-200 mb-3">{UNIT_TEXT[props.id]}</p>
        <StatTable rows={unitStats(props.balance, props.id).map(([k, v]) => [k.replace(/^Bonus gegen (.*)$/, (_m, t: string) => `Bonus gegen ${label(t)}`), v])} />
        <div className="mt-3 text-sm"><span className="text-slate-400">Kosten je Stück: </span><Cost cost={props.cost} /></div>
      </Sheet>
    </li>
  );
}
