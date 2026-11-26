import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { trpc, trpcClient, type BaseData } from "../lib/trpc.ts";
import { useCommand } from "../lib/command.ts";
import { fmtNum, label } from "../lib/names.ts";
import { fmtDuration, fmtSeconds, fmtTime, useNow } from "../lib/time.ts";
import { liveResources } from "../lib/live.res.ts";
import { BUILDING_TEXT, buildingEffect } from "../lib/info.ts";
import { Icon, IconTile } from "../icons.tsx";
import { Badge, Bar, Button, Card, Cost, CountsLine, ErrorLine, Sheet } from "../ui.tsx";
import { Guide, type GuideAction } from "../components/Guide.tsx";

const invalidateBase = () => [trpc.base.pathFilter().queryKey];

const GROUPS: { title: string; ids: string[] }[] = [
  { title: "Wirtschaft", ids: ["stahlwerk", "raffinerie", "chipfabrik", "versorgungshof", "kraftwerk", "lagerkomplex"] },
  { title: "Militär", ids: ["werft", "kaserne", "flugfeld"] },
  { title: "Führung und Schutz", ids: ["kommandozentrale", "hafenkommandantur", "radarstation", "tiefbunker"] },
];

type Building = BaseData["buildings"][number];

export function BaseScreen(props: {
  base: BaseData;
  asOf: number;
  sheet: string | null;
  setSheet: (id: string | null) => void;
  onGuide: (a: GuideAction) => void;
  onTroops: () => void;
}) {
  const { base, asOf, sheet, setSheet } = props;
  const now = useNow();
  const reports = useQuery(trpc.report.list.queryOptions());
  const wonRaid = (reports.data ?? []).some((r) => r.kind === "ueberfall" && r.role === "attacker" && r.won);
  const cancel = useCommand((i: { key: string }) => trpcClient.base.cancelUpgrade.mutate(i), invalidateBase);
  const res = liveResources(base, asOf, now);
  const order = base.buildQueue[0];
  const byId = Object.fromEntries(base.buildings.map((b) => [b.id, b]));

  return (
    <div>
      {/* Hafen-Kopf */}
      <section className="panel rounded-2xl p-3 mb-3 flex items-center gap-3">
        <div className="w-14 h-14 grid place-items-center bg-[#80c0ff] border-2 border-[#0a1a2a]" title="Eigener Stützpunkt (Taktikzeichen)">
          <Icon id="anker" size={36} className="[&_*]:!stroke-[#0a1a2a]" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-xl font-bold uppercase truncate">{base.name}</h1>
          <div className="flex flex-wrap gap-1 mt-0.5">
            {base.protection.status ? <Badge tone="green">{label(base.protection.status)}</Badge> : <Badge tone="red">ungeschützt</Badge>}
            <Badge>Feld {base.col}/{base.row}</Badge>
            <Badge>Hafen {base.market.port.name} {fmtNum(base.market.port.distanceKm)} km</Badge>
          </div>
        </div>
      </section>

      {base.incoming.filter((i) => i.type !== "transport").map((i) => (
        <div key={i.id} className="rounded-2xl bg-red-950/90 border-2 border-red-500 p-3 mb-3 flex gap-3 items-center" role="alert">
          <Icon id={i.type === "kartell" ? "kartell" : "ueberfall"} size={40} />
          <div className="text-sm">
            <strong className="text-red-200 uppercase font-display">{label(i.type)} im Anmarsch</strong>
            <div>Ankunft in <strong>{fmtDuration(i.arriveAtMs - now)}</strong></div>
            {i.units && <div className="text-xs text-red-200"><CountsLine counts={i.units} /></div>}
          </div>
        </div>
      ))}

      <Guide base={base} wonRaid={wonRaid} onAction={props.onGuide} />

      {/* Bauschlange */}
      <Card title="Bauhof">
        {order ? (
          <div className="flex items-center gap-3">
            <IconTile id={order.buildingId} size={52} />
            <div className="flex-1 min-w-0">
              <div className="font-bold">{label(order.buildingId)} → Stufe {order.targetLevel}</div>
              <div className="text-sm text-sea-300 mb-1">{order.finishesAt <= now ? "wird abgeschlossen …" : `noch ${fmtDuration(order.finishesAt - now)}`}</div>
              <Bar value={(now - order.startedAt) / Math.max(1, order.finishesAt - order.startedAt)} />
            </div>
            <Button kind="danger" disabled={cancel.busy} onClick={() => void cancel.run({})}>Abbruch</Button>
          </div>
        ) : (
          <p className="text-sm text-slate-300 flex items-center gap-2"><Icon id="uhr" size={22} /> Der Bauhof ist frei. Tippe ein Gebäude an, um es auszubauen.</p>
        )}
        <ErrorLine text={cancel.error} />
      </Card>

      {GROUPS.map((g) => (
        <Card key={g.title} title={g.title}>
          <div className="grid grid-cols-3 gap-2">
            {g.ids.map((id) => byId[id] && <BuildingTile key={id} b={byId[id]} res={res} busy={!!order} building={order?.buildingId === id} onOpen={() => setSheet(id)} />)}
          </div>
        </Card>
      ))}

      <Supply base={base} />
      <Protection base={base} now={now} />

      {sheet && byId[sheet] && (
        <BuildingSheet b={byId[sheet]} base={base} res={res} queueBusy={!!order} onClose={() => setSheet(null)} onTroops={props.onTroops} />
      )}
    </div>
  );
}

function affordable(cost: Record<string, number> | null, res: Record<string, number>): boolean {
  return !!cost && Object.entries(cost).every(([r, v]) => (res[r] ?? 0) >= v);
}

function BuildingTile({ b, res, busy, building, onOpen }: { b: Building; res: Record<string, number>; busy: boolean; building: boolean; onOpen: () => void }) {
  const can = !busy && b.level < b.maxAllowed && affordable(b.cost, res);
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`relative rounded-xl p-2 flex flex-col items-center text-center border transition ${building ? "border-sea-400 bg-sea-400/10" : "border-white/10 bg-navy-900/70"} active:scale-95`}
    >
      <IconTile id={b.id} size={52} />
      <span className="w-full text-[11px] font-semibold mt-1 leading-tight break-words hyphens-auto" lang="de">{label(b.id).replace("kommandantur", "\u00ADkommandantur").replace("zentrale", "\u00ADzentrale")}</span>
      <span className={`absolute top-1 right-1 min-w-6 h-5 px-1 grid place-items-center text-[11px] mono border ${b.level > 0 ? "border-sea-400/60 text-sea-300 bg-navy-950" : "border-white/10 text-slate-500 bg-navy-950"}`}>{b.level}</span>
      {can && <span className="absolute top-1 left-1 w-2 h-2 bg-emerald-400" title="Ausbau möglich" />}
      {building && <span className="text-[10px] text-sea-300">im Bau</span>}
    </button>
  );
}

function BuildingSheet({ b, base, res, queueBusy, onClose, onTroops }: { b: Building; base: BaseData; res: Record<string, number>; queueBusy: boolean; onClose: () => void; onTroops: () => void }) {
  const meta = useQuery({ ...trpc.meta.queryOptions(), staleTime: Infinity });
  const up = useCommand((i: { key: string; buildingId: string }) => trpcClient.base.upgrade.mutate(i), invalidateBase);
  const balance = meta.data?.balance;
  const capped = b.level >= b.maxAllowed;
  const maxed = !b.cost;
  const enough = affordable(b.cost, res);
  const reason = maxed ? "Höchststufe erreicht." : capped ? "Erst die Kommandozentrale ausbauen." : queueBusy ? "Es läuft schon ein Ausbau." : !enough ? "Noch nicht genug Ressourcen." : null;
  const now = balance ? buildingEffect(balance, b.id, b.level) : null;
  const next = balance && !maxed ? buildingEffect(balance, b.id, b.level + 1) : null;
  const trains = ["werft", "kaserne", "flugfeld"].includes(b.id);
  return (
    <Sheet open onClose={onClose} title={<>{label(b.id)} <span className="text-sea-300 mono">Stufe {b.level}</span></>} icon={<IconTile id={b.id} size={56} />}>
      <p className="text-sm text-slate-200 mb-3">{BUILDING_TEXT[b.id]?.lang}</p>
      {(now || next) && (
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div className="rounded-xl bg-navy-900 p-2">
            <div className="text-[11px] uppercase text-slate-400">Jetzt</div>
            <div className="text-sm font-semibold">{now ?? "–"}</div>
          </div>
          <div className="rounded-xl bg-emerald-950/60 border border-emerald-700/50 p-2">
            <div className="text-[11px] uppercase text-emerald-300">Stufe {b.level + 1}</div>
            <div className="text-sm font-semibold">{next ?? "–"}</div>
          </div>
        </div>
      )}
      {!maxed && (
        <div className="rounded-xl bg-navy-900 p-2 mb-3">
          <div className="text-[11px] uppercase text-slate-400 mb-1">Kosten</div>
          <Cost cost={b.cost} have={res} />
          {b.seconds !== null && <div className="text-sm mt-1 flex items-center gap-1"><Icon id="uhr" size={16} /> {fmtSeconds(b.seconds)}</div>}
        </div>
      )}
      {reason && <p className="text-sm text-brass-300 mb-2">{reason}</p>}
      <ErrorLine text={up.error} />
      <div className="flex gap-2">
        {trains && b.level > 0 && <Button kind="secondary" className="flex-1" onClick={() => { onClose(); onTroops(); }}>Ausbilden</Button>}
        <Button className="flex-1" disabled={!!reason || up.busy} onClick={async () => { const r = await up.run({ buildingId: b.id }); if (r?.ok) onClose(); }}>
          Ausbau auf {b.level + 1}
        </Button>
      </div>
      {b.id === "hafenkommandantur" && <p className="text-xs text-slate-400 mt-2">Missionsplätze jetzt: {base.missionSlots}</p>}
    </Sheet>
  );
}

function Supply({ base }: { base: BaseData }) {
  const short = base.power.factor < 1;
  return (
    <Card title="Versorgung">
      <div className="space-y-2 text-sm">
        <div>
          <div className="flex justify-between"><span className="flex items-center gap-1"><Icon id="strom" size={16} /> Strom</span><span className={short ? "text-red-300" : ""}>{fmtNum(base.power.demand)} / {fmtNum(base.power.supply)}</span></div>
          <Bar value={base.power.supply > 0 ? base.power.demand / base.power.supply : base.power.demand > 0 ? 1 : 0} tone={short ? "red" : "green"} />
          {short && <p className="text-xs text-red-300 mt-1">Zu wenig Strom: Produktion läuft nur mit {fmtNum(base.power.factor * 100)} %. Kraftwerk ausbauen!</p>}
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-slate-300">
          <span>Lager je Ressource</span><span className="text-right">{fmtNum(base.capacity)}</span>
          <span>Bunkerschutz</span><span className="text-right">{fmtNum(base.bunkerProtection)}</span>
          <span>Unterhalt</span><span className="text-right">{fmtNum(base.upkeepPerHour, 1)} Proviant/h</span>
          <span>Kommandopunkte</span><span className="text-right">{fmtNum(base.commandPoints)}</span>
          <span>Missionsplätze</span><span className="text-right">{base.activeMissions}/{base.missionSlots}</span>
          <span>Stellplätze Flugfeld</span><span className="text-right">{base.aircraftSlots.used}/{base.aircraftSlots.total}</span>
          <span>Radar-Vorwarnzeit</span><span className="text-right">{base.radarWarningMinutes} min</span>
        </div>
        {base.versorgungsmangel && <p className="text-red-300">Versorgungsmangel: keine Ausbildung, Angriffswert −20 %. Versorgungshof ausbauen oder Proviant kaufen.</p>}
        {base.deliveries.length > 0 && <DeliveryList base={base} />}
      </div>
    </Card>
  );
}

function DeliveryList({ base }: { base: BaseData }) {
  const now = useNow();
  return (
    <div className="text-sea-300">
      {base.deliveries.map((d) => <div key={d.id}>Konvoi: {fmtNum(d.qty)} {label(d.resource)} in {fmtDuration(d.arriveAtMs - now)}</div>)}
    </div>
  );
}

export function Progress({ start, end, now }: { start: number; end: number; now: number }) {
  return <div className="w-40 max-w-full mt-1"><Bar value={(now - start) / Math.max(1, end - start)} /></div>;
}

function Protection({ base, now }: { base: BaseData; now: number }) {
  const p = base.protection;
  const [hour, setHour] = useState<number | null>(p.nightShieldStartHour);
  const save = useCommand(
    (i: { key: string; startHour: number | null; tzOffsetMinutes: number }) => trpcClient.base.nightShield.mutate(i),
    invalidateBase,
  );
  const win = p.nightWindow;
  const beginnerEnd = p.createdAtMs + 7 * 86400000;
  return (
    <Card title="Schutz">
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
      <label className="block text-xs text-slate-400 mt-3 mb-1">Nachtschild (8 Stunden täglich) beginnt</label>
      <div className="flex items-center gap-2">
        <select className="h-11 flex-1 rounded-lg bg-navy-950 border border-navy-600 px-2" value={hour ?? ""} onChange={(e) => setHour(e.target.value === "" ? null : Number(e.target.value))}>
          <option value="">kein Nachtschild</option>
          {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>um {h}:00 Uhr</option>)}
        </select>
        <Button kind="secondary" disabled={save.busy || hour === p.nightShieldStartHour} onClick={() => void save.run({ startHour: hour, tzOffsetMinutes: -new Date().getTimezoneOffset() })}>
          Speichern
        </Button>
      </div>
      <ErrorLine text={save.error} />
    </Card>
  );
}
