// Mehrere Häfen: Hafenwahl in der Kopfleiste. Zeile mit dem Namen des aktiven Hafens (▾), Blatt mit allen Häfen
// (Heimathafen markiert, Ressourcen, Angriff, Bauschlange) und dem Freischaltstand für den nächsten Hafen.
import { useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { trpc, type BaseData } from "../lib/trpc.ts";
import { fmtNum, label } from "../lib/names.ts";
import { RES_ORDER, liveAmount } from "../lib/live.res.ts";
import { expansionRules, foundingState } from "../lib/expansion.ts";
import { Icon } from "../icons.tsx";
import { Badge, Button, Sheet } from "../ui.tsx";

type Entry = BaseData["bases"][number];

function short(n: number): string {
  return n >= 10000 ? `${fmtNum(n / 1000, n >= 100000 ? 0 : 1)}k` : fmtNum(n);
}

/** Zeile über den Ressourcen; erscheint erst mit zweitem Hafen oder freigeschalteter Gründung. */
export function HarborSwitcher({ base, now, onSwitch, onPlanFounding }: { base: BaseData; now: number; onSwitch: (id: number) => void; onPlanFounding: () => void }) {
  const meta = useQuery({ ...trpc.meta.queryOptions(), staleTime: Infinity });
  const [open, setOpen] = useState(false);
  const rules = expansionRules(meta.data?.balance);
  const f = foundingState(base, rules);
  if (base.bases.length < 2 && !f.possible) return null;
  const otherAttack = base.bases.some((b) => b.id !== base.id && b.underAttack);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="w-full flex items-center gap-1.5 px-2 pt-1 -mb-0.5 text-left min-h-[26px]" aria-label={`Hafen ${base.name} – Hafen wechseln`}>
        <Icon id={base.isHome ? "heimathafen" : "gruendung"} size={16} className="shrink-0" />
        <span className="font-serif text-[15px] leading-tight truncate">{base.name}</span>
        <span className="text-[11px] font-display uppercase tracking-[0.12em] text-ink2 shrink-0">{base.isHome ? "Heimathafen" : "Außenposten"}</span>
        <span className="text-ink2 text-xs shrink-0" aria-hidden="true">▾</span>
        {otherAttack && <span className="ml-auto shrink-0 text-[11px] font-display uppercase tracking-wider text-siegel flex items-center gap-1"><span className="w-2 h-2 rotate-45 bg-siegel pulse" />Anderer Hafen bedroht</span>}
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Deine Häfen" icon={<Icon id="heimathafen" size={28} />}>
        <HarborList base={base} now={now} onSwitch={(id) => { setOpen(false); onSwitch(id); }} />
        <FoundingHint base={base} onPlan={() => { setOpen(false); onPlanFounding(); }} />
      </Sheet>
    </>
  );
}

function HarborList({ base, now, onSwitch }: { base: BaseData; now: number; onSwitch: (id: number) => void }) {
  // Kurzlage der anderen Häfen (eigener Cache-Schlüssel je Hafen; macht den Wechsel danach sofort).
  const others = base.bases.filter((b) => b.id !== base.id);
  const qs = useQueries({ queries: others.map((b) => ({ ...trpc.base.get.queryOptions({ baseId: b.id }), staleTime: 30000 })) });
  const data = new Map<number, { b: BaseData; asOf: number }>([[base.id, { b: base, asOf: 0 }]]);
  others.forEach((o, i) => { const d = qs[i]?.data; if (d?.base) data.set(o.id, { b: d.base, asOf: d.serverNow }); });
  return (
    <ul className="divide-y divide-rule -mt-1">
      {base.bases.map((e) => (
        <HarborRow key={e.id} e={e} active={e.id === base.id} d={data.get(e.id)} now={now} onSwitch={() => onSwitch(e.id)} />
      ))}
    </ul>
  );
}

function HarborRow({ e, active, d, now, onSwitch }: { e: Entry; active: boolean; d?: { b: BaseData; asOf: number }; now: number; onSwitch: () => void }) {
  const queue = d?.b.buildQueue.length ?? null;
  const training = d?.b.trainingQueue.length ?? 0;
  return (
    <li className="py-2.5">
      <div className="flex items-center gap-2">
        <Icon id={e.isHome ? "heimathafen" : "gruendung"} size={26} className="shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="font-serif text-[17px] leading-tight truncate">{e.name}</div>
          <div className="text-[11px] mono text-ink2">Feld {e.col}/{e.row}</div>
        </div>
        {e.isHome && <Badge tone="brass">Heimathafen</Badge>}
        {active && <Badge tone="sea">Aktiv</Badge>}
      </div>
      {e.underAttack && <div className="mt-1 text-xs text-siegel font-semibold flex items-center gap-1.5"><span className="w-2 h-2 rotate-45 bg-siegel pulse" />Feindlicher Verband im Anmarsch</div>}
      {d ? (
        <>
          <div className="mt-1 grid grid-cols-4 gap-1 text-[12px] mono">
            {RES_ORDER.map((r) => (
              <span key={r} className="flex items-center gap-0.5 min-w-0" title={label(r)}><Icon id={r} size={14} className="shrink-0" />{short(d.asOf ? liveAmount(d.b, d.asOf, now, r) : d.b.resources[r] ?? 0)}</span>
            ))}
          </div>
          <div className="mt-0.5 text-xs text-ink2">
            {queue === 0 ? "Bauschlange leer" : `Bau: ${queue} in Arbeit`}{training > 0 ? ` · Ausbildung: ${training}` : ""}
          </div>
        </>
      ) : <div className="mt-1 text-xs text-ink2">Lädt …</div>}
      {!active && <Button kind="secondary" className="mt-2 w-full" onClick={onSwitch}>Hierhin wechseln</Button>}
    </li>
  );
}

/** „Weiteren Hafen gründen“: Freischaltstand (Kommandozentrale, Kolonieschiff) und Weg zur Karte. */
export function FoundingHint({ base, onPlan }: { base: BaseData; onPlan?: () => void }) {
  const meta = useQuery({ ...trpc.meta.queryOptions(), staleTime: Infinity });
  const rules = expansionRules(meta.data?.balance);
  const f = foundingState(base, rules);
  if (f.need === null) {
    return <p className="mt-3 text-xs text-ink2">Höchstzahl erreicht: {rules.maxBases} Häfen je Spieler.</p>;
  }
  return (
    <div className="mt-3 rounded-[3px] border border-rule bg-paper p-2.5 text-sm">
      <div className="font-display uppercase tracking-[0.12em] text-[12px] flex items-center gap-1.5"><Icon id="gruendung" size={18} />Weiteren Hafen gründen</div>
      <ul className="mt-1 space-y-0.5 text-xs">
        <li className={f.unlocked ? "text-moos" : ""}>
          {f.unlocked ? "✓ " : "· "}Kommandozentrale im Heimathafen Stufe {f.need} für den {base.bases.length + 1}. Hafen{f.level !== null ? ` (jetzt ${f.level})` : ""}
        </li>
        <li className={f.ships > 0 ? "text-moos" : ""}>{f.ships > 0 ? `✓ ${f.ships} Kolonieschiff${f.ships > 1 ? "e" : ""} daheim` : "· Kolonieschiff aus der Werft (wird bei der Gründung verbraucht)"}</li>
        <li>· Freies Küstenfeld im Umkreis von {fmtNum(rules.maxRangeKm)} km, mit Abstand zu anderen Häfen</li>
      </ul>
      {!rules.live && <p className="mt-1 text-xs text-messing">Die Gründung ist in dieser Saison noch nicht freigeschaltet.</p>}
      {onPlan && f.possible && <Button className="mt-2 w-full" onClick={onPlan}>Küstenfeld auf der Karte wählen</Button>}
    </div>
  );
}
