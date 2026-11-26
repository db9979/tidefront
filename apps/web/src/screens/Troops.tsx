import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { trpc, trpcClient, type BaseData, type Balance, type MapData } from "../lib/trpc.ts";
import { useCommand } from "../lib/command.ts";
import { fmtNum, label } from "../lib/names.ts";
import { fmtDuration, fmtSeconds, fmtTime, useNow } from "../lib/time.ts";
import type { Target } from "../App.tsx";
import { Button, Card, Cost, ErrorLine, Loading, Sheet, StatTable, Stepper, UnitChips } from "../ui.tsx";
import { Icon, IconTile } from "../icons.tsx";
import { cancelLoss, cancelQuestion, unitStats, unitText, unitTone } from "../lib/info.ts";
import { Progress } from "./Base.tsx";
import { RecentMissions } from "../components/Repeat.tsx";
import { FreeSimCard } from "../components/SimLauncher.tsx";
import { TECH, techName } from "../lib/research.ts";
import { unitBreakdown } from "../lib/breakdown.ts";
import { Breakdown, RankBadge, VeteranLine } from "../components/Breakdown.tsx";

/** Werte, die die Aufschlüsselung zeigt (aus der festen Werte-Tabelle ausgeblendet). */
const BROKEN_DOWN = /^(Lebenspunkte|Angriff|U-Jagd|Tempo|Ladung|Treibstoff)/;

const invalidateBase = () => [trpc.base.pathFilter().queryKey];
const GROUPS: { builtIn: string; title: string }[] = [
  { builtIn: "werft", title: "Werft" },
  { builtIn: "kaserne", title: "Kaserne" },
  { builtIn: "flugfeld", title: "Flugfeld" },
  { builtIn: "anlagen", title: "Verteidigungsanlagen" },
];

/** Höchstmenge je Ausbildungsauftrag (wie im Server). */
const MAX_TRAIN = 10000;

/** Name eines Missionsziels aus der Karte: Hafen oder Nest mit Stufe, sonst Koordinaten. */
export function targetName(map: MapData | undefined, col: number, row: number): string {
  const b = map?.bases.find((x) => x.col === col && x.row === row);
  // Kein doppeltes „Hafen Hafen …“, wenn der Name schon so beginnt.
  if (b) return /^hafen\b/i.test(b.name) ? b.name : `Hafen ${b.name}`;
  const n = map?.nests.find((x) => x.col === col && x.row === row);
  if (n) return `Nest Stufe ${n.level}`;
  return `Feld ${col}/${row}`;
}

function scale(cost: Record<string, number> | undefined, n: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [r, v] of Object.entries(cost ?? {})) out[r] = v * n;
  return out;
}

export function TroopsScreen({ base, onPlan, onShowOnMap, onResearch }: { base: BaseData; onPlan: () => void; onShowOnMap: (t: Target) => void; onResearch: () => void }) {
  const meta = useQuery({ ...trpc.meta.queryOptions(), staleTime: Infinity });
  const now = useNow();
  const cancel = useCommand((i: { key: string; builtIn: string }) => trpcClient.base.cancelTraining.mutate(i), invalidateBase);
  const map = useQuery(trpc.world.map.queryOptions());
  const [recallId, setRecallId] = useState<number | null>(null);
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
                <strong>{label(m.type)} {m.status === "returning" ? (m.recalled ? "· zurückgerufen" : "· Rückfahrt") : ""}</strong>
                <button type="button" className="tap text-sea-300 underline text-xs" onClick={() => onShowOnMap({ col: m.target.col, row: m.target.row })}>
                  {targetName(map.data, m.target.col, m.target.row)}
                </button>
              </div>
              <div className="text-xs text-slate-300"><UnitChips counts={m.status === "returning" ? m.returning : m.units} /></div>
              <div className="text-sea-300">
                {m.status === "outbound" ? `Ankunft in ${fmtDuration(m.arriveAtMs - now)}` : `Rückkehr in ${fmtDuration(m.returnAtMs - now)}`}
              </div>
              {m.cargoHome && Object.values(m.cargoHome).some((v) => v > 0) && (
                <div className="text-xs text-brass-400">Ladung: <UnitChips counts={m.cargoHome} /></div>
              )}
              {m.status === "outbound" && m.arriveAtMs > now && (
                <div className="mt-1"><Button kind="secondary" onClick={() => setRecallId(m.id)}>Zurückrufen</Button></div>
              )}
              </div>
            </li>
          ))}
        </ul>
      </Card>
      <ResearchCard base={base} now={now} onOpen={onResearch} />
      <RecentMissions />
      <FreeSimCard balance={balance} base={base} />
      {(() => {
        const m = base.missions.find((x) => x.id === recallId && x.status === "outbound");
        return m ? <RecallSheet mission={m} name={targetName(map.data, m.target.col, m.target.row)} now={now} onClose={() => setRecallId(null)} /> : null;
      })()}

      <ErrorLine text={cancel.error} />
      {GROUPS.map((g) => {
        const order = base.trainingQueue.find((o) => o.builtIn === g.builtIn);
        const level = g.builtIn === "anlagen" ? 1 : base.buildings.find((b) => b.id === g.builtIn)?.level ?? 0;
        return (
          <Card key={g.builtIn} title={<span className="flex items-center gap-2"><Icon id={g.builtIn === "anlagen" ? "kuestenbatterie" : g.builtIn} size={22} />{g.title}</span>} right={g.builtIn !== "anlagen" ? <span className="text-xs text-slate-400">Stufe {level}</span> : undefined}>
            {g.builtIn === "flugfeld" && <p className="text-xs text-slate-400 mb-1">Stellplätze {base.aircraftSlots.used}/{base.aircraftSlots.total}</p>}
            {order && (
              <div className="rounded-lg bg-paper border border-rule p-2 mb-2 flex items-center justify-between gap-2">
                <div className="text-sm">
                  {fmtNum(order.count)} × {label(order.id)}
                  <div className="text-sea-300">{order.finishesAt <= now ? "wird abgeschlossen …" : `noch ${fmtDuration(order.finishesAt - now)}`}</div>
                  <Progress start={order.startedAt} end={order.finishesAt} now={now} />
                </div>
                <Button
                  kind="danger"
                  disabled={cancel.busy || order.finishesAt <= now}
                  onClick={() => {
                    const def = balance.units[order.id] ?? balance.defenses[order.id];
                    const loss = cancelLoss(scale(def?.cost, order.count), order.startedAt, order.finishesAt, Date.now());
                    if (confirm(cancelQuestion(`Ausbildung von ${fmtNum(order.count)} × ${label(order.id)}`, loss))) void cancel.run({ builtIn: g.builtIn });
                  }}
                >Abbruch</Button>
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
                      <TrainRow key={u.id} id={u.id} have={u.home} away={u.away} base={base} balance={balance} busy={!!order} secondsEach={u.secondsEach} cost={balance.units[u.id].cost} needLevel={(balance.units[u.id].requiresLevel ?? 1) > level ? balance.units[u.id].requiresLevel : undefined} />
                    ))}
              </ul>
            )}
          </Card>
        );
      })}
    </div>
  );
}

/** needLevel: Baugebäude ist noch unter der Mindeststufe der Einheit (requiresLevel). */
function TrainRow(props: { id: string; have: number; away: number; base: BaseData; balance: Balance; busy: boolean; secondsEach: number | null; cost: Record<string, number> | undefined; needLevel?: number }) {
  const [n, setN] = useState(1);
  const cmd = useCommand((i: { key: string; id: string; count: number }) => trpcClient.base.train.mutate(i), invalidateBase);
  const [info, setInfo] = useState(false);
  const vet = props.base.veterans?.find((v) => v.id === props.id);
  // Bezahlbare Höchstmenge: begrenzt die Eingabe, damit Kosten und Bauzeit sinnvoll bleiben.
  const afford = Object.entries(props.cost ?? {}).reduce(
    (m, [r, v]) => (v > 0 ? Math.min(m, Math.floor((props.base.resources[r] ?? 0) / v)) : m),
    MAX_TRAIN,
  );
  // Menge 0 ist kein Fehler: nur „Bauen“ gesperrt, Hinweis neutral, Kosten je Stück statt „kostenlos“.
  const why = props.busy
    ? "Hier läuft schon ein Auftrag (oben) – neue Ausbildung erst nach Abschluss oder Abbruch."
    : props.base.versorgungsmangel ? "Versorgungsmangel: keine Ausbildung möglich."
    : afford < 1 ? "Nicht genug Ressourcen für ein Stück."
    : n > afford ? `Nicht genug Ressourcen (höchstens ${fmtNum(afford)}).` : null;
  return (
    <li className="py-2">
      <div className="flex gap-3 items-start">
        <button type="button" onClick={() => setInfo(true)} aria-label={`${label(props.id)}: Info`}><IconTile id={props.id} size={52} tone={unitTone(props.balance, props.id)} /></button>
        <div className="min-w-0 flex-1">
          <div className="flex justify-between gap-2">
            <button type="button" className="font-serif text-[17px] leading-tight text-left min-h-[44px] -my-2" onClick={() => setInfo(true)}>{label(props.id)} <span className="text-sea-300 text-xs">ⓘ</span>{vet && vet.rank !== "rekrut" && <> <RankBadge vet={vet} /></>}</button>
            <div className="text-sm tabular-nums"><strong>{fmtNum(props.have)}</strong>{props.away > 0 ? <span className="text-slate-400"> +{fmtNum(props.away)} unterwegs</span> : ""}</div>
          </div>
          <div className="text-xs text-slate-400">{unitText(props.balance, props.id)}</div>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 mt-2 flex-wrap">
        {props.needLevel ? (
          <span className="text-xs text-brass-300">Bau ab {label(props.balance.units[props.id]?.builtIn ?? "")} Stufe {props.needLevel}</span>
        ) : (
          <>
            <Stepper value={n} onChange={setN} limit={Math.max(1, afford)} />
            <Button kind="secondary" disabled={!!why || cmd.busy || n < 1} onClick={() => void cmd.run({ id: props.id, count: n })}>
              Bauen
            </Button>
          </>
        )}
      </div>
      <div className="flex justify-between gap-2 mt-1">
        {n >= 1 ? (
          <>
            <Cost cost={scale(props.cost, n)} have={props.base.resources} />
            {props.secondsEach !== null && <span className="text-xs text-slate-400 flex items-center gap-1"><Icon id="uhr" size={14} /> {fmtSeconds(props.secondsEach * n)}</span>}
          </>
        ) : (
          <>
            <span className="text-xs text-slate-400 flex flex-wrap items-center gap-x-1">je Stück: <Cost cost={props.cost} have={props.base.resources} /></span>
            {props.secondsEach !== null && <span className="text-xs text-slate-400 flex items-center gap-1"><Icon id="uhr" size={14} /> {fmtSeconds(props.secondsEach)} je Stück</span>}
          </>
        )}
      </div>
      {why && !props.needLevel && <p className="text-xs text-brass-300 mt-1">{why}</p>}
      {!why && n < 1 && !props.needLevel && <p className="text-xs text-slate-400 mt-1">Anzahl wählen (bezahlbar: bis {fmtNum(afford)}).</p>}
      <ErrorLine text={cmd.error} />
      <Sheet open={info} onClose={() => setInfo(false)} title={label(props.id)} icon={<IconTile id={props.id} size={56} tone={unitTone(props.balance, props.id)} />}>
        <p className="text-sm text-slate-200 mb-3">{unitText(props.balance, props.id)}</p>
        {/* Wirksame Werte mit Aufschlüsselung (Grundwert · Forschung · Veteranen …), dann die übrigen festen Werte. */}
        <Breakdown rows={unitBreakdown(props.balance, props.base.modifierSources, props.id)} />
        <VeteranLine vet={vet} />
        <div className="mt-2">
          <StatTable rows={unitStats(props.balance, props.id).filter(([k]) => !BROKEN_DOWN.test(k)).map(([k, v]) => [k.replace(/^Bonus gegen (.*)$/, (_m, t: string) => `Bonus gegen ${label(t)}`), v])} />
        </div>
        <div className="mt-3 text-sm"><span className="text-slate-400">Kosten je Stück: </span><Cost cost={props.cost} /></div>
      </Sheet>
    </li>
  );
}

/** Forschung als Abschnitt in Truppen: laufende Forschung und Weg in den Technikbaum. */
function ResearchCard({ base, now, onOpen }: { base: BaseData; now: number; onOpen: () => void }) {
  const r = base.research;
  if (!r) return null;
  const o = r.order;
  return (
    <Card title={<span className="flex items-center gap-2"><Icon id="forschungsamt" size={22} />Forschung</span>} right={<span className="text-xs text-slate-400">Forschungsamt {r.buildingLevel}</span>}>
      <div className="flex items-center gap-3">
        {o ? <IconTile id={TECH[o.techId]?.icon ?? "forschungsamt"} size={44} /> : <Icon id="wuerfel" size={36} />}
        <div className="flex-1 min-w-0 text-sm">
          {o ? (
            <>
              <div>{techName(o.techId)} · Stufe {o.targetLevel}</div>
              <div className="text-sea-300">{o.finishesAt <= now ? "wird abgeschlossen …" : `noch ${fmtDuration(o.finishesAt - now)}`}</div>
              <Progress start={o.startedAt} end={o.finishesAt} now={now} />
            </>
          ) : r.pendingChoice ? (
            <div className="text-siegel">Durchbruch! Belohnung wählen.</div>
          ) : (
            <div className="text-slate-400">{r.buildingLevel < 1 ? "Erst das Forschungsamt bauen (Basis → Führung und Schutz)." : "Keine Forschung läuft."}</div>
          )}
        </div>
        <Button kind="secondary" onClick={onOpen}>Technikbaum</Button>
      </div>
    </Card>
  );
}

type MissionData = BaseData["missions"][number];

/** Bestätigung des Rückrufs: Rückkehr nach der bereits gefahrenen Zeit, Treibstoff ist verbraucht. */
function RecallSheet({ mission, name, now, onClose }: { mission: MissionData; name: string; now: number; onClose: () => void }) {
  const cmd = useCommand(
    (i: { key: string; missionId: number }) => trpcClient.mission.recall.mutate(i),
    () => [trpc.base.pathFilter().queryKey, trpc.world.pathFilter().queryKey],
  );
  const elapsed = Math.max(0, now - mission.departAtMs);
  return (
    <Sheet open onClose={onClose} title={`${label(mission.type)} zurückrufen?`} icon={<Icon id={mission.type} size={48} />}>
      <div className="text-sm space-y-2 mb-3">
        <p>Der Verband kehrt sofort um und ist nach der bereits gefahrenen Zeit wieder daheim.</p>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-xl bg-paper border border-rule p-2">
          <span className="text-slate-400">Ziel</span><span className="text-right">{name}</span>
          <span className="text-slate-400">Unterwegs seit</span><span className="text-right">{fmtDuration(elapsed)}</span>
          <span className="text-slate-400">Wieder daheim</span><span className="text-right">etwa {fmtTime(now + elapsed)}</span>
        </div>
        <p className="text-brass-300">Der Treibstoff ist verbraucht und wird nicht erstattet.{mission.type === "ueberfall" ? " Der Nachtschild bleibt für diese Nacht aufgehoben." : ""}</p>
      </div>
      <ErrorLine text={cmd.error} />
      <div className="flex gap-2">
        <Button kind="secondary" className="flex-1" onClick={onClose}>Weiterfahren</Button>
        <Button kind="danger" className="flex-1" disabled={cmd.busy} onClick={async () => { const r = await cmd.run({ missionId: mission.id }); if (r?.ok) onClose(); }}>
          Zurückrufen
        </Button>
      </div>
    </Sheet>
  );
}
