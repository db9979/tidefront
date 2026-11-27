// Ausbildung in Truppen (Segmente „Ausbilden“ und „Abwehr“): je Baugebäude eine Karte mit laufendem Auftrag und
// einzeiligen Ausbildungszeilen (Symbol · Name · Bestand · Stepper · Bauen, ~64 px). Werte, Aufschlüsselung und
// Kosten je Stück stehen im Infoblatt (ⓘ); Kosten und Dauer der gewählten Menge erscheinen kompakt unter der
// Zeile, sobald die Menge ≥ 1 ist – also immer vor dem Bauen.
import { useState } from "react";
import { trpc, trpcClient, type BaseData, type Balance } from "../lib/trpc.ts";
import { useCommand } from "../lib/command.ts";
import { fmtNum, label } from "../lib/names.ts";
import { fmtDuration, fmtSeconds } from "../lib/time.ts";
import { Button, Card, Cost, ErrorLine, Sheet, StatTable, Stepper, UnitChips } from "../ui.tsx";
import { ActionRemedy, ReasonLine, useWhatHelps } from "./Remedy.tsx"; // „Was hilft?“
import { Icon, IconTile } from "../icons.tsx";
import { cancelLoss, cancelQuestion, unitStats, unitText, unitTone } from "../lib/info.ts";
import { Progress } from "../screens/Base.tsx";
import { unitBreakdown } from "../lib/breakdown.ts";
import { Breakdown, RankBadge, VeteranLine } from "./Breakdown.tsx";

/** Werte, die die Aufschlüsselung zeigt (aus der festen Werte-Tabelle ausgeblendet). */
const BROKEN_DOWN = /^(Lebenspunkte|Angriff|U-Jagd|Tempo|Ladung|Treibstoff)/;
/** Höchstmenge je Ausbildungsauftrag (wie im Server). */
const MAX_TRAIN = 10000;

const invalidateBase = () => [trpc.base.pathFilter().queryKey];

/** Weiche Trennstellen an Wortfugen langer Einheitennamen (nur dort wird umbrochen, nie mitten im Wort). */
const FUGEN = ["Landungs", "Minen", "Aufklärungs", "Abfang", "Jagd", "Kampf", "Küsten", "Flak", "Bunker", "Schnell", "Kolonie"];
function softName(name: string): string {
  for (const f of FUGEN) if (name.startsWith(f) && name.length > f.length + 3) return f + "\u00ad" + name.slice(f.length);
  return name;
}

export function scale(cost: Record<string, number> | undefined, n: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [r, v] of Object.entries(cost ?? {})) out[r] = v * n;
  return out;
}

/** Eine Baugebäude-Karte (Werft, Kaserne, Flugfeld, Nachrichtendienst oder „anlagen“ = Verteidigungsanlagen). */
export function TrainGroup({ builtIn, title, base, balance, now }: { builtIn: string; title: string; base: BaseData; balance: Balance; now: number }) {
  const cancel = useCommand((i: { key: string; builtIn: string }) => trpcClient.base.cancelTraining.mutate(i), invalidateBase);
  const order = base.trainingQueue.find((o) => o.builtIn === builtIn);
  const level = builtIn === "anlagen" ? 1 : base.buildings.find((b) => b.id === builtIn)?.level ?? 0;
  return (
    <Card title={<span className="flex items-center gap-2"><Icon id={builtIn === "anlagen" ? "kuestenbatterie" : builtIn} size={22} />{title}</span>} right={builtIn !== "anlagen" ? <span className="text-xs text-slate-400">Stufe {level}</span> : undefined}>
      {builtIn === "flugfeld" && <p className="text-xs text-slate-400 mb-1">Stellplätze {base.aircraftSlots.used}/{base.aircraftSlots.total}</p>}
      {builtIn === "nachrichtendienst" && base.intel && level > 0 && <p className="text-xs text-slate-400 mb-1">Spione {base.intel.spies.home + base.intel.spies.away + base.intel.spies.training}/{base.intel.cap} · Aufträge über „Mission planen“ → Spionage</p>}
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
              if (confirm(cancelQuestion(`Ausbildung von ${fmtNum(order.count)} × ${label(order.id)}`, loss))) void cancel.run({ builtIn });
            }}
          >Abbruch</Button>
        </div>
      )}
      <ErrorLine text={cancel.error} code={cancel.code} />
      {level < 1 ? (
        <>
          <div className="text-sm text-slate-400 flex items-center gap-2"><IconTile id={builtIn} size={36} /> Erst {label(builtIn)} bauen (Basis → {title}).</div>
          {base.units.some((u) => u.builtIn === builtIn && u.home + u.away > 0) && (
            <p className="text-sm mt-1">
              Vorhanden: <UnitChips counts={Object.fromEntries(base.units.filter((u) => u.builtIn === builtIn).map((u) => [u.id, u.home + u.away]))} />
            </p>
          )}
        </>
      ) : (
        <ul className="divide-y divide-navy-700">
          {builtIn === "anlagen"
            ? base.defenses.map((d) => (
                <TrainRow key={d.id} id={d.id} have={d.count} away={0} base={base} balance={balance} busy={!!order} secondsEach={balance.defenses[d.id].seconds} cost={balance.defenses[d.id].cost} />
              ))
            : base.units.filter((u) => u.builtIn === builtIn).map((u) => (
                <TrainRow key={u.id} id={u.id} have={u.home} away={u.away} base={base} balance={balance} busy={!!order} secondsEach={u.secondsEach} cost={balance.units[u.id].cost} needLevel={(balance.units[u.id].requiresLevel ?? 1) > level ? balance.units[u.id].requiresLevel : undefined} />
              ))}
        </ul>
      )}
    </Card>
  );
}

/** needLevel: Baugebäude ist noch unter der Mindeststufe der Einheit (requiresLevel). */
function TrainRow(props: { id: string; have: number; away: number; base: BaseData; balance: Balance; busy: boolean; secondsEach: number | null; cost: Record<string, number> | undefined; needLevel?: number }) {
  // Start bei 0: die Zeile bleibt einzeilig; ab Menge 1 erscheinen Kosten und Dauer darunter.
  const [n, setN] = useState(0);
  const cmd = useCommand((i: { key: string; id: string; count: number }) => trpcClient.base.train.mutate(i), invalidateBase);
  const [info, setInfo] = useState(false);
  const vet = props.base.veterans?.find((v) => v.id === props.id);
  // Bezahlbare Höchstmenge: begrenzt die Eingabe, damit Kosten und Bauzeit sinnvoll bleiben.
  const afford = Object.entries(props.cost ?? {}).reduce(
    (m, [r, v]) => (v > 0 ? Math.min(m, Math.floor((props.base.resources[r] ?? 0) / v)) : m),
    MAX_TRAIN,
  );
  const why = props.busy
    ? "Hier läuft schon ein Auftrag (oben) – neue Ausbildung erst nach Abschluss oder Abbruch."
    : props.base.versorgungsmangel ? "Versorgungsmangel: keine Ausbildung möglich."
    : afford < 1 ? "Nicht genug Ressourcen für ein Stück."
    : n > afford ? `Nicht genug Ressourcen (höchstens ${fmtNum(afford)}).` : null;
  // Ablehnungscode zum Grund und Zusatzangaben für „Was hilft?“.
  const whyCode = props.busy ? "queue_busy" : props.base.versorgungsmangel ? "supply_shortage" : why ? "insufficient_resources" : null;
  const detail = { unit: props.id, cost: scale(props.cost, Math.max(1, n)) };
  const [help, setHelp] = useWhatHelps();
  return (
    <li className="py-2.5">
      <div className="flex items-center gap-2">
        {/* Symbol mit ⓘ (oben) und Bestand (unten) als Marken: die Namensspalte bleibt frei für den Namen. */}
        <button type="button" onClick={() => setInfo(true)} aria-label={`${label(props.id)}: Info, Bestand ${fmtNum(props.have)}`} className="shrink-0 relative">
          <IconTile id={props.id} size={40} tone={unitTone(props.balance, props.id)} />
          <span aria-hidden className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-card border border-see text-see text-[10px] leading-none grid place-items-center">i</span>
          <span aria-hidden className="absolute -bottom-1.5 -right-2 min-w-5 px-1 rounded-full bg-ink text-paper mono text-[10.5px] leading-4 text-center">{fmtNum(props.have)}</span>
        </button>
        <button type="button" className="min-w-0 flex-1 text-left leading-tight pl-1" onClick={() => setInfo(true)}>
          <span className="block font-serif text-[13.5px] [hyphens:manual]" lang="de">{softName(label(props.id))}</span>
          {(props.away > 0 || (vet && vet.rank !== "rekrut")) && (
            <span className="block text-[11px] tabular-nums text-ink2">{props.away > 0 ? `+${fmtNum(props.away)} unterwegs ` : ""}{vet && vet.rank !== "rekrut" && <RankBadge vet={vet} />}</span>
          )}
        </button>
        {props.needLevel ? (
          <button type="button" aria-expanded={help} onClick={() => setHelp(!help)} className="tap text-xs text-brass-300 text-right w-28 shrink-0 leading-tight">
            Bau ab {label(props.balance.units[props.id]?.builtIn ?? "")} Stufe {props.needLevel} <span className="text-ink2">▾</span>
          </button>
        ) : (
          <>
            <Stepper compact value={n} onChange={setN} limit={Math.max(1, afford)} />
            {/* Gesperrt mit Grund (ab Menge 1): Antippen klappt „Was hilft?“ auf. */}
            <button type="button" className={`tap shrink-0 rounded-lg btn-secondary px-2 font-display uppercase text-[12px] tracking-[0.06em] disabled:opacity-45 ${why && n >= 1 ? "opacity-45" : ""}`} disabled={cmd.busy || n < 1} aria-disabled={!!why || undefined}
              onClick={async () => { if (why) return setHelp(!help); const r = await cmd.run({ id: props.id, count: n }); if (r) setN(0); }}>
              Bauen
            </button>
          </>
        )}
      </div>
      {n >= 1 && !props.needLevel && (
        <div className="flex justify-between gap-2 mt-1 pl-12">
          <Cost cost={scale(props.cost, n)} have={props.base.resources} />
          {props.secondsEach !== null && <span className="text-xs text-slate-400 flex items-center gap-1 shrink-0"><Icon id="uhr" size={14} /> {fmtSeconds(props.secondsEach * n)}</span>}
        </div>
      )}
      {why && n >= 1 && !props.needLevel && <ReasonLine code={whyCode} text={why} detail={detail} open={help} onOpenChange={setHelp} className="text-xs text-brass-300 mt-1 pl-12" />}
      {props.needLevel && help && <div className="pl-12"><ActionRemedy code="building_level" detail={detail} open onClose={() => setHelp(false)} /></div>}
      <ErrorLine text={cmd.error} code={cmd.code} detail={detail} />
      <Sheet open={info} onClose={() => setInfo(false)} title={label(props.id)} icon={<IconTile id={props.id} size={56} tone={unitTone(props.balance, props.id)} />}>
        <p className="text-sm text-slate-200 mb-3">{unitText(props.balance, props.id)}</p>
        <p className="text-sm mb-3">Bestand <strong className="mono">{fmtNum(props.have)}</strong>{props.away > 0 ? <span className="text-ink2"> · {fmtNum(props.away)} unterwegs</span> : ""}</p>
        {/* Wirksame Werte mit Aufschlüsselung (Grundwert · Forschung · Veteranen …), dann die übrigen festen Werte. */}
        <Breakdown rows={unitBreakdown(props.balance, props.base.modifierSources, props.id)} />
        <VeteranLine vet={vet} />
        <div className="mt-2">
          <StatTable rows={unitStats(props.balance, props.id).filter(([k]) => !BROKEN_DOWN.test(k)).map(([k, v]) => [k.replace(/^Bonus gegen (.*)$/, (_m, t: string) => `Bonus gegen ${label(t)}`), v])} />
        </div>
        <div className="mt-3 text-sm flex flex-wrap items-center gap-x-2"><span className="text-slate-400">Kosten je Stück: </span><Cost cost={props.cost} have={props.base.resources} /></div>
        {props.secondsEach !== null && <div className="mt-1 text-sm flex items-center gap-1"><Icon id="uhr" size={16} /> {fmtSeconds(props.secondsEach)} je Stück</div>}
        {!props.needLevel && <p className="text-xs text-ink2 mt-1">Bezahlbar: bis {fmtNum(Math.max(0, afford))} Stück.</p>}
      </Sheet>
    </li>
  );
}
