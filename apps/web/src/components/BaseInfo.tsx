// Basis, unterer Teil: Versorgung (Strom, Lager, Proviant) und Schutz (Nachtschild) als einklappbare Karten.
// Zugeklappt zeigt jede Karte eine Zeile Zusammenfassung; der Zustand wird geräteweit gemerkt.
// Hinweis Zusammenführen: PowerGrid (Wetter) bleibt inhaltlich unverändert und steht hier in „Versorgung“.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { trpc, trpcClient, type BaseData } from "../lib/trpc.ts";
import { useCommand } from "../lib/command.ts";
import { fmtNum, label } from "../lib/names.ts";
import { fmtDuration, fmtTime, useNow } from "../lib/time.ts";
import { researchNote } from "../lib/research.ts";
import { Icon } from "../icons.tsx";
import { Button, Card, ErrorLine } from "../ui.tsx";
import { PowerGrid } from "./PowerGrid.tsx";
import { PowerCable } from "./PowerCable.tsx"; // Seekabel (v1.21)

const invalidateBase = () => [trpc.base.pathFilter().queryKey];
const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);

export function Supply({ base }: { base: BaseData }) {
  return (
    <Card title="Versorgung" collapsible storageKey="basis-versorgung" defaultOpen={false} summary={<SupplySummary base={base} />}>
      <div className="space-y-2 text-sm">
        <PowerGrid base={base} />
        <PowerCable baseId={base.id} />
        <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-slate-300 [&>span:nth-child(even)]:mono">
          <span>Lager je Ressource</span><span className="text-right">{fmtNum(base.capacity)}<Note text={researchNote(base.modifiers, "storage")} /></span>
          <span>Bunkerschutz</span><span className="text-right">{fmtNum(base.bunkerProtection)}<Note text={researchNote(base.modifiers, "bunker")} /></span>
          <span>Proviant erzeugt</span><span className="text-right">+{fmtNum((base.rates.proviant ?? 0) + base.upkeepPerHour, 1)}/h</span>
          <span>Truppen essen (Unterhalt)</span><span className="text-right">−{fmtNum(base.upkeepPerHour, 1)}/h</span>
          <span className="font-semibold">Proviant-Saldo</span><span className={`text-right font-semibold ${(base.rates.proviant ?? 0) < 0 ? "text-siegel" : "text-[#3f6b3a]"}`}>{(base.rates.proviant ?? 0) >= 0 ? "+" : "−"}{fmtNum(Math.abs(base.rates.proviant ?? 0), 1)}/h</span>
          <span>Kommandopunkte</span><span className="text-right">{fmtNum(base.commandPoints)}</span>
          <span>Missionsplätze</span><span className="text-right">{base.activeMissions}/{base.missionSlots}</span>
          <span>Stellplätze Flugfeld</span><span className="text-right">{base.aircraftSlots.used}/{base.aircraftSlots.total}</span>
          <span>Radar-Vorwarnzeit</span><span className="text-right">{fmtNum(base.radarWarningMinutes, 1)} min<Note text={researchNote(base.modifierSources.find((m) => m.id === "forschung")?.mods, "radarWarning")} /><Note text={researchNote(base.modifierSources.find((m) => m.id === "wetter")?.mods, "radarWarning")?.replace("Forschung", "Nebel") ?? null} /></span>
        </div>
        <p className="text-xs text-ink2">Jede Einheit isst Proviant, auch unterwegs. Der Saldo steht oben in der Leiste bei Proviant. Ist er negativ, schrumpft der Vorrat; bei 0 droht Versorgungsmangel.</p>
        {(base.rates.proviant ?? 0) < 0 && !base.versorgungsmangel && <p className="text-siegel text-xs">Deine Truppen essen mehr, als du erzeugst: Vorrat reicht noch {fmtNum(Math.floor((base.resources.proviant ?? 0) / -(base.rates.proviant ?? -1)))} h. Versorgungshof ausbauen oder Proviant kaufen.</p>}
        {base.versorgungsmangel && <p className="text-red-300">Versorgungsmangel: keine Ausbildung, Angriffswert −20 %. Versorgungshof ausbauen oder Proviant kaufen.</p>}
        {base.deliveries.length > 0 && <DeliveryList base={base} />}
      </div>
    </Card>
  );
}

/** Kleiner Forschungshinweis hinter einem Wert („+20 % durch Forschung“). */
function Note({ text }: { text: string | null }) {
  return text ? <span className="block text-[11px] text-emerald-300 font-sans">{text}</span> : null;
}

function DeliveryList({ base }: { base: BaseData }) {
  const now = useNow();
  return (
    <div className="text-sea-300">
      {base.deliveries.map((d) => <div key={d.id}>Konvoi: {fmtNum(d.qty)} {label(d.resource)} in {fmtDuration(d.arriveAtMs - now)}</div>)}
    </div>
  );
}

/** Eine Zeile für die zugeklappte Versorgung: Strom, Proviant-Saldo, Lager. */
function SupplySummary({ base }: { base: BaseData }) {
  const g = base.grid;
  const supply = sum(g.now.supply);
  const demand = sum(g.now.demand);
  const prov = base.rates.proviant ?? 0;
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-0.5 mono text-[12.5px]">
      <span className={`inline-flex items-center gap-1 ${demand > supply ? "text-siegel" : ""}`}><Icon id="strom" size={15} /> {fmtNum(demand)}/{fmtNum(supply)}</span>
      <span className={`inline-flex items-center gap-1 ${prov < 0 ? "text-siegel" : ""}`}><Icon id="proviant" size={15} /> {prov >= 0 ? "+" : "−"}{fmtNum(Math.abs(prov), 1)}/h</span>
      <span>Lager {fmtNum(base.capacity)}</span>
      {base.versorgungsmangel && <span className="text-siegel">Versorgungsmangel</span>}
    </span>
  );
}

export function Protection({ base, now }: { base: BaseData; now: number }) {
  const p = base.protection;
  const meta = useQuery({ ...trpc.meta.queryOptions(), staleTime: Infinity });
  const prot = meta.data?.balance.protection;
  // Vorgemerkte Einstellung gilt erst ab fromMs; Änderungen höchstens einmal je Frist.
  const next = p.nightShieldNext && p.nightShieldNext.fromMs > now ? p.nightShieldNext : null;
  const chosen = next ? next.startHour : p.nightShieldStartHour;
  const [hour, setHour] = useState<number | null>(chosen);
  const save = useCommand(
    (i: { key: string; startHour: number | null; tzOffsetMinutes: number }) => trpcClient.base.nightShield.mutate(i),
    invalidateBase,
  );
  const changeH = prot?.nightShieldChangeHours ?? 24;
  const lockedUntil = p.nightShieldChangedAtMs !== undefined ? p.nightShieldChangedAtMs + changeH * 3600000 : 0;
  const locked = lockedUntil > now;
  const win = p.nightWindow;
  const beginnerEnd = p.createdAtMs + (prot?.beginnerDays ?? 7) * 86400000;
  return (
    <Card title="Schutz" collapsible storageKey="basis-schutz" defaultOpen={false} summary={<span className={p.status ? "" : "text-siegel"}>{p.status ? `${label(p.status)} aktiv` : "kein Schutz aktiv"}{win ? ` · Nachtschild ${fmtTime(win.startMs)}–${fmtTime(win.endMs)}` : ""}</span>}>
      <div className="flex items-start gap-3">
        <Icon id="schild" size={40} />
        <div className="text-sm min-w-0">
          {p.status ? <div className="text-emerald-300 font-semibold">{label(p.status)} aktiv</div> : <div className="text-red-300 font-semibold">Kein Schutz aktiv – das Kartell kann angreifen.</div>}
          {p.status === "anfaengerschutz" && <div className="text-xs text-slate-400">endet {fmtTime(beginnerEnd)}</div>}
          {p.defeatShieldUntilMs > now && <div className="text-xs text-slate-400">Schutz nach Niederlage bis {fmtTime(p.defeatShieldUntilMs)}</div>}
          {win && (
            <div className="text-xs text-slate-400">
              {now >= win.startMs && now < win.endMs ? `Nachtschild bis ${fmtTime(win.endMs)}` : `Nächster Nachtschild ${fmtTime(win.startMs)} – ${fmtTime(win.endMs)}`}
              {p.nightShieldSuspendedUntilMs > now ? " (durch eigenen Angriff aufgehoben)" : ""}
            </div>
          )}
        </div>
      </div>
      {next && (
        <p className="text-xs text-sea-300 mt-2">
          Neue Einstellung ab {fmtTime(next.fromMs)}: {next.startHour === null ? "kein Nachtschild" : `Beginn um ${next.startHour}:00 Uhr`}.
        </p>
      )}
      <label className="block text-xs text-slate-400 mt-3 mb-1" htmlFor="tf-night">Nachtschild ({prot?.nightShieldHours ?? 8} Stunden täglich) beginnt</label>
      <div className="flex items-center gap-2">
        <select id="tf-night" disabled={locked} className="h-11 flex-1 rounded-lg field px-2" value={hour ?? ""} onChange={(e) => setHour(e.target.value === "" ? null : Number(e.target.value))}>
          <option value="">kein Nachtschild</option>
          {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>um {h}:00 Uhr</option>)}
        </select>
        <Button kind="secondary" disabled={save.busy || locked || hour === chosen} onClick={() => void save.run({ startHour: hour, tzOffsetMinutes: -new Date().getTimezoneOffset() })}>
          Speichern
        </Button>
      </div>
      <p className="text-xs text-slate-400 mt-1">
        {locked
          ? `Nächste Änderung ab ${fmtTime(lockedUntil)} möglich.`
          : `Eine Änderung gilt erst nach ${changeH} Stunden und ist danach ${changeH} Stunden gesperrt – den Schild gegen einen schon gemeldeten Angriff einzuschalten geht nicht.`}
      </p>
      <ErrorLine text={save.error} code={save.code} />
    </Card>
  );
}
