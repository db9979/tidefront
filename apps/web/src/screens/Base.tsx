import { useState } from "react";
import { trpc, trpcClient, type BaseData } from "../lib/trpc.ts";
import { useCommand } from "../lib/command.ts";
import { RES_ICON, fmtNum, label } from "../lib/names.ts";
import { fmtDuration, fmtSeconds, fmtTime, useNow } from "../lib/time.ts";
import { Button, Card, Cost, CountsLine, ErrorLine } from "../ui.tsx";

const INFO: Record<string, string> = {
  kommandozentrale: "Kommandopunkte, Deckel für alle Gebäude",
  stahlwerk: "Stahl je Stunde",
  raffinerie: "Treibstoff je Stunde",
  chipfabrik: "Elektronik je Stunde",
  versorgungshof: "Proviant je Stunde",
  kraftwerk: "Strom für die Produktion",
  lagerkomplex: "Lagerkapazität",
  tiefbunker: "Schutz vor Plünderung",
  werft: "Schiffe bauen",
  kaserne: "Bodentruppen ausbilden",
  flugfeld: "Flugzeuge und Stellplätze",
  radarstation: "Vorwarnzeit bei Angriffen",
  hafenkommandantur: "Missionsplätze, Börse ab Stufe 3",
};

const invalidateBase = () => [trpc.base.pathFilter().queryKey];

const ORDER = ["stahl", "treibstoff", "elektronik", "proviant"];

export function BaseScreen({ base, asOf, playerName, onLogout }: { base: BaseData; asOf: number; playerName: string; onLogout: () => void }) {
  const now = useNow();
  const up = useCommand((i: { key: string; buildingId: string }) => trpcClient.base.upgrade.mutate(i), invalidateBase);
  const cancel = useCommand((i: { key: string }) => trpcClient.base.cancelUpgrade.mutate(i), invalidateBase);
  const order = base.buildQueue[0];
  const busy = base.buildQueue.length > 0;

  return (
    <div>
      <header className="flex items-center justify-between mb-3">
        <div>
          <h1 className="text-xl font-bold">{base.name}</h1>
          <p className="text-xs text-slate-400">Kommandant {playerName} · Feld {base.col}/{base.row}</p>
        </div>
        <Button kind="ghost" onClick={onLogout}>Abmelden</Button>
      </header>

      {base.incoming.filter((i) => i.type !== "transport").map((i) => (
        <div key={i.id} className="rounded-xl bg-red-900/70 border border-red-500 p-3 mb-3" role="alert">
          <strong>⚠ {label(i.type)} im Anmarsch</strong> – Ankunft in {fmtDuration(i.arriveAtMs - now)}
          {i.units && <div className="text-sm"><CountsLine counts={i.units} /></div>}
        </div>
      ))}

      <Card title="Ressourcen" right={<span className="text-xs text-slate-400">Lager je {fmtNum(base.capacity)}</span>}>
        <div className="grid grid-cols-2 gap-2">
          {ORDER.filter((r) => r in base.resources).map((r) => {
            const rate = base.rates[r] ?? 0;
            // Im Client fortschreiben: Produktion füllt nur bis zur Kapazität, Bestand nie unter 0.
            const raw = base.resources[r];
            const grown = raw + (rate * Math.max(0, now - asOf)) / 3600000;
            const v = rate >= 0 ? (raw >= base.capacity ? raw : Math.min(base.capacity, grown)) : Math.max(0, grown);
            const full = v >= base.capacity;
            return (
              <div key={r} className="rounded-lg bg-navy-900 p-2">
                <div className="text-xs text-slate-400">{RES_ICON[r]} {label(r)}</div>
                <div className={`text-lg font-semibold ${full ? "text-brass-400" : ""}`}>{fmtNum(v)}</div>
                <div className={`text-xs ${rate < 0 ? "text-red-300" : "text-emerald-300"}`}>{rate >= 0 ? "+" : ""}{fmtNum(rate)}/h{full ? " · voll" : ""}</div>
              </div>
            );
          })}
        </div>
        <div className="text-xs text-slate-400 mt-2 flex flex-wrap gap-x-3">
          <span>⚡ Strom {fmtNum(base.power.demand)}/{fmtNum(base.power.supply)}{base.power.factor < 1 ? ` – Drosselung auf ${fmtNum(base.power.factor * 100)} %` : ""}</span>
          <span>Unterhalt {fmtNum(base.upkeepPerHour, 1)} Proviant/h</span>
          <span>Bunkerschutz {fmtNum(base.bunkerProtection)} je Ressource</span>
        </div>
        {base.versorgungsmangel && <p className="text-red-300 text-sm mt-2">Versorgungsmangel: keine Ausbildung, Angriffswert −20 %.</p>}
        {base.deliveries.length > 0 && (
          <div className="text-xs mt-2 text-sea-300">
            {base.deliveries.map((d) => <div key={d.id}>Lieferung {fmtNum(d.qty)} {label(d.resource)} in {fmtDuration(d.arriveAtMs - now)}</div>)}
          </div>
        )}
      </Card>

      <Protection base={base} now={now} />

      <Card title="Bauschlange">
        {order ? (
          <div className="flex items-center justify-between gap-2">
            <div>
              <div>{label(order.buildingId)} → Stufe {order.targetLevel}</div>
              <div className="text-sm text-sea-300">{order.finishesAt <= now ? "wird abgeschlossen …" : `noch ${fmtDuration(order.finishesAt - now)}`}</div>
              <Progress start={order.startedAt} end={order.finishesAt} now={now} />
            </div>
            <Button kind="danger" disabled={cancel.busy} onClick={() => void cancel.run({})}>Abbruch</Button>
          </div>
        ) : (
          <p className="text-sm text-slate-400">Kein Ausbau. Wähle ein Gebäude.</p>
        )}
        <ErrorLine text={cancel.error} />
      </Card>

      <Card title="Gebäude">
        <ErrorLine text={up.error} />
        <ul className="divide-y divide-navy-700">
          {base.buildings.map((b) => {
            const capped = b.level >= b.maxAllowed;
            return (
              <li key={b.id} className="py-2 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium">{label(b.id)} <span className="text-slate-400 text-sm">Stufe {b.level}</span></div>
                  <div className="text-xs text-slate-400">{INFO[b.id]}</div>
                  {b.cost && <Cost cost={b.cost} have={base.resources} />}
                  {b.seconds !== null && <div className="text-xs text-slate-400">⏱ {fmtSeconds(b.seconds)}{capped ? " · erst Kommandozentrale ausbauen" : ""}</div>}
                </div>
                <Button kind="secondary" disabled={busy || up.busy || capped || !b.cost} onClick={() => void up.run({ buildingId: b.id })}>
                  Ausbau
                </Button>
              </li>
            );
          })}
        </ul>
      </Card>

      <Card title="Kommando">
        <div className="text-sm grid grid-cols-2 gap-1">
          <span>Kommandopunkte</span><span className="text-right">{fmtNum(base.commandPoints)}</span>
          <span>Missionsplätze</span><span className="text-right">{base.activeMissions}/{base.missionSlots}</span>
          <span>Stellplätze Flugfeld</span><span className="text-right">{base.aircraftSlots.used}/{base.aircraftSlots.total}</span>
          <span>Radar-Vorwarnzeit</span><span className="text-right">{base.radarWarningMinutes} min</span>
        </div>
      </Card>
    </div>
  );
}

export function Progress({ start, end, now }: { start: number; end: number; now: number }) {
  const p = Math.max(0, Math.min(1, (now - start) / Math.max(1, end - start)));
  return (
    <div className="h-1.5 w-40 max-w-full rounded bg-navy-950 mt-1 overflow-hidden">
      <div className="h-full bg-sea-400" style={{ width: `${p * 100}%` }} />
    </div>
  );
}

function Protection({ base, now }: { base: BaseData; now: number }) {
  const p = base.protection;
  const [hour, setHour] = useState<number | null>(p.nightShieldStartHour);
  const save = useCommand(
    (i: { key: string; startHour: number | null; tzOffsetMinutes: number }) => trpcClient.base.nightShield.mutate(i),
    invalidateBase,
  );
  const win = p.nightWindow;
  return (
    <Card title="Schutz">
      <p className="text-sm">
        {p.status ? <span className="text-emerald-300">🛡 {label(p.status)} aktiv</span> : <span className="text-slate-300">Kein Schutz aktiv</span>}
      </p>
      {win && (
        <p className="text-xs text-slate-400">
          {now >= win.startMs && now < win.endMs ? `Nachtschild bis ${fmtTime(win.endMs)}` : `Nächster Nachtschild ${fmtTime(win.startMs)} – ${fmtTime(win.endMs)}`}
          {p.nightShieldSuspendedUntilMs > now ? " (durch eigenen Angriff aufgehoben)" : ""}
        </p>
      )}
      <div className="flex items-center gap-2 mt-2">
        <select className="h-11 flex-1 rounded-lg bg-navy-950 border border-navy-600 px-2" value={hour ?? ""} onChange={(e) => setHour(e.target.value === "" ? null : Number(e.target.value))}>
          <option value="">kein Nachtschild</option>
          {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>ab {h}:00 Uhr</option>)}
        </select>
        <Button
          kind="secondary"
          disabled={save.busy || hour === p.nightShieldStartHour}
          onClick={() => void save.run({ startHour: hour, tzOffsetMinutes: -new Date().getTimezoneOffset() })}
        >
          Speichern
        </Button>
      </div>
      <ErrorLine text={save.error} />
    </Card>
  );
}
