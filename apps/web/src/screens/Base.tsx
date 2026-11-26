import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { trpc, trpcClient, type Balance, type BaseData } from "../lib/trpc.ts";
import { useCommand } from "../lib/command.ts";
import { fmtNum, label } from "../lib/names.ts";
import { fmtDuration, fmtSeconds, fmtTime, useNow } from "../lib/time.ts";
import { liveResources } from "../lib/live.res.ts";
import { buildingEffect, buildingText, cancelLoss, cancelQuestion } from "../lib/info.ts";
import { Icon, IconTile } from "../icons.tsx";
import { BuildingArt, BuildingArtTile, nextStageLevel, stageOf } from "../building-art/index.tsx";
import { Badge, Bar, Button, Card, Cost, CountsLine, ErrorLine, Sheet } from "../ui.tsx";
import { Guide, type GuideAction } from "../components/Guide.tsx";
import { DailyOrders } from "../components/Daily.tsx";
import { HarborVignette, fmtDeg } from "../components/Vignette.tsx";
import { hexCenter } from "@tidefront/world";
import { Timeline } from "../components/Timeline.tsx";
import { WorldEventBanner } from "../components/WorldEvents.tsx";
import { researchNote } from "../lib/research.ts";
import { buildingBreakdown } from "../lib/breakdown.ts";
import { Breakdown } from "../components/Breakdown.tsx";
import { IntelPanel, SabotageBanner, sabotagedUntil } from "../components/Intel.tsx"; // Nachrichtendienst

const invalidateBase = () => [trpc.base.pathFilter().queryKey];

const GROUPS: { title: string; ids: string[] }[] = [
  { title: "Wirtschaft", ids: ["stahlwerk", "raffinerie", "chipfabrik", "versorgungshof", "kraftwerk", "lagerkomplex"] },
  { title: "Militär", ids: ["werft", "kaserne", "flugfeld"] },
  { title: "Führung und Schutz", ids: ["kommandozentrale", "hafenkommandantur", "radarstation", "tiefbunker", "forschungsamt", "nachrichtendienst"] },
];

type Building = BaseData["buildings"][number];

export function BaseScreen(props: {
  base: BaseData;
  asOf: number;
  sheet: string | null;
  setSheet: (id: string | null) => void;
  onGuide: (a: GuideAction) => void;
  onTroops: () => void;
  onResearch: () => void;
}) {
  const { base, asOf, sheet, setSheet } = props;
  const now = useNow();
  const res = liveResources(base, asOf, now);
  const queue = base.buildQueue;
  const queueFull = queue.length >= base.buildQueueSlots;
  const byId = Object.fromEntries(base.buildings.map((b) => [b.id, b]));

  return (
    <div>
      {/* Hafen-Kopf */}
      <section className="mb-3 pb-3 flex items-center gap-3.5 border-b border-rule">
        <HarborVignette levels={base.buildings.reduce((a, b) => a + b.level, 0)} />
        <div className="min-w-0 flex-1">
          <div className="font-display text-[10px] uppercase tracking-[0.2em] text-ink2">Stützpunkt</div>
          <h1 className="font-serif text-[32px] leading-none mt-0.5 mb-1 truncate">{base.name}</h1>
          <div className="mono text-[10.5px] text-ink2">{coords(base.col, base.row)} · Feld {base.col}/{base.row}</div>
          <div className="flex flex-wrap gap-1 mt-1.5">
            {base.protection.status ? <Badge tone="green">{label(base.protection.status)}</Badge> : <Badge tone="red">ungeschützt</Badge>}
            <Badge>Hafen {base.market.port.name} {fmtNum(base.market.port.distanceKm)} km</Badge>
          </div>
        </div>
      </section>

      {base.incoming.filter((i) => i.type !== "transport").map((i) => (
        <div key={i.id} className="rounded-xl bg-red-950 border border-siegel border-l-4 p-3 mb-3 flex gap-3 items-center" role="alert">
          <Icon id={i.type === "kartell" ? "kartell" : "ueberfall"} size={40} />
          <div className="text-sm">
            <strong className="text-siegel uppercase font-display text-xs">{label(i.type)} im Anmarsch</strong>
            <div className="font-serif text-lg leading-tight">Ankunft in <span className="mono">{fmtDuration(i.arriveAtMs - now)}</span></div>
            {i.units && <div className="text-xs text-ink2"><CountsLine counts={i.units} /></div>}
          </div>
        </div>
      ))}

      <SabotageBanner base={base} now={now} />
      <WorldEventBanner onMap={() => props.onGuide({ kind: "tab", tab: "karte" })} />
      <Guide base={base} onAction={props.onGuide} />
      <DailyOrders />
      <Timeline base={base} />

      {/* Bauschlange */}
      <BuildYard base={base} now={now} />

      {GROUPS.map((g) => (
        <Card key={g.title} title={g.title}>
          <div className="grid grid-cols-3 gap-2">
            {g.ids.map((id) => byId[id] && <BuildingTile key={id} b={byId[id]} sabotaged={sabotagedUntil(base, id, now) !== null} res={res} queueFull={queueFull} running={queue[0]?.buildingId === id} queued={queue.some((o) => o.buildingId === id)} onOpen={() => setSheet(id)} />)}
          </div>
        </Card>
      ))}

      <Supply base={base} />
      <Protection base={base} now={now} />

      {sheet && byId[sheet] && (
        <BuildingSheet b={byId[sheet]} base={base} res={res} onClose={() => setSheet(null)} onTroops={props.onTroops} onResearch={props.onResearch} />
      )}
    </div>
  );
}

function coords(col: number, row: number): string {
  const c = hexCenter(col, row);
  return `${fmtDeg(c.lat, "N", "S")} · ${fmtDeg(c.lon, "O", "W")}`;
}

function affordable(cost: Record<string, number> | null, res: Record<string, number>): boolean {
  return !!cost && Object.entries(cost).every(([r, v]) => (res[r] ?? 0) >= v);
}

/** Kosten des Ausbaus von Stufe L auf L+1 (wie im Regelkern: cost × costFactor^L, aufgerundet). */
function levelCost(balance: Balance, id: string, level: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [r, v] of Object.entries(balance.buildings[id]?.cost ?? {})) out[r] = Math.ceil(v * balance.building.costFactor ** level);
  return out;
}

function BuildYard({ base, now }: { base: BaseData; now: number }) {
  const meta = useQuery({ ...trpc.meta.queryOptions(), staleTime: Infinity });
  const cancel = useCommand(
    (i: { key: string; buildingId: string; targetLevel: number }) => trpcClient.base.cancelUpgrade.mutate(i),
    invalidateBase,
  );
  const queue = base.buildQueue;
  return (
    <Card title="Bauhof" right={<span className="text-xs text-slate-400 tabular-nums">Schlange {queue.length}/{base.buildQueueSlots}</span>}>
      {queue.length === 0 ? (
        <p className="text-sm text-ink2 flex items-center gap-2"><Icon id="uhr" size={26} className="shrink-0" /> Der Bauhof ist frei. Tippe ein Gebäude an, um es auszubauen.</p>
      ) : (
        <ol className="divide-y divide-navy-700">
          {queue.map((o, i) => {
            const running = o.startedAt <= now;
            return (
              <li key={`${o.buildingId}:${o.targetLevel}`} className="py-2 flex items-center gap-3">
                <BuildingArtTile id={o.buildingId} level={o.targetLevel} size={i === 0 ? 60 : 48} />
                <div className="flex-1 min-w-0">
                  <div className="font-medium">{label(o.buildingId)} · Ausbau auf Stufe {o.targetLevel}</div>
                  {running ? (
                    <>
                      <div className="text-xs mono text-ink2 mb-1.5">{o.finishesAt <= now ? "wird abgeschlossen …" : `noch ${fmtDuration(o.finishesAt - now)}`}</div>
                      <Bar value={(now - o.startedAt) / Math.max(1, o.finishesAt - o.startedAt)} tone="red" />
                    </>
                  ) : (
                    <div className="text-xs text-slate-400">
                      Platz {i + 1} · beginnt in {fmtDuration(o.startedAt - now)} · fertig {fmtTime(o.finishesAt)}
                    </div>
                  )}
                </div>
                <Button
                  kind="secondary"
                  disabled={cancel.busy || o.finishesAt <= now}
                  onClick={() => {
                    const cost = meta.data ? levelCost(meta.data.balance, o.buildingId, o.targetLevel - 1) : {};
                    const loss = cancelLoss(cost, o.startedAt, o.finishesAt, Date.now());
                    const later = queue.some((x) => x.buildingId === o.buildingId && x.targetLevel > o.targetLevel);
                    const q = cancelQuestion(`Ausbau ${label(o.buildingId)} auf Stufe ${o.targetLevel}`, loss)
                      + (later ? " Spätere Stufen desselben Gebäudes fallen mit weg (voll erstattet)." : "");
                    if (confirm(q)) void cancel.run({ buildingId: o.buildingId, targetLevel: o.targetLevel });
                  }}
                >
                  Abbruch
                </Button>
              </li>
            );
          })}
        </ol>
      )}
      {queue.length > 1 && <p className="text-xs text-slate-400 mt-1">Abbruch: der laufende Auftrag nach Restzeit, wartende voll erstattet. Spätere Stufen desselben Gebäudes fallen mit weg.</p>}
      <ErrorLine text={cancel.error} />
    </Card>
  );
}

function BuildingTile({ b, res, queueFull, running, queued, onOpen, sabotaged }: { b: Building; res: Record<string, number>; queueFull: boolean; running: boolean; queued: boolean; onOpen: () => void; sabotaged?: boolean }) {
  const can = !queueFull && b.planned < b.maxAllowed && affordable(b.cost, res);
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`relative rounded-xl px-1.5 pt-2 pb-2 flex flex-col items-center text-center border bg-card transition ${queued ? "reticle" : "border-rule"} active:scale-[0.97]`}
    >
      <BuildingArt id={b.id} level={b.level} size={68} />
      <span className="w-full font-serif text-[12.5px] mt-1 leading-tight break-words hyphens-auto" lang="de">{label(b.id).replace("kommandantur", "\u00ADkommandantur").replace("zentrale", "\u00ADzentrale")}</span>
      <span className="mt-1 flex items-center gap-1">
        <span className={`w-[22px] h-[22px] rounded-full grid place-items-center text-[11px] mono border ${b.level > 0 ? "border-ink text-ink" : "border-rule text-ink2"}`}>{b.level}</span>
        {sabotaged ? <Badge tone="red">sabotiert</Badge> : running ? <Badge tone="red">Ausbau</Badge> : queued ? <Badge tone="sea">→ {b.planned}</Badge> : null}
      </span>
      {can && <span className="absolute top-1.5 left-1.5 diamond bg-moos" title="Ausbau möglich" />}
    </button>
  );
}

function BuildingSheet({ b, base, res, onClose, onTroops, onResearch }: { b: Building; base: BaseData; res: Record<string, number>; onClose: () => void; onTroops: () => void; onResearch: () => void }) {
  const meta = useQuery({ ...trpc.meta.queryOptions(), staleTime: Infinity });
  const up = useCommand((i: { key: string; buildingId: string }) => trpcClient.base.upgrade.mutate(i), invalidateBase);
  const balance = meta.data?.balance;
  const capped = b.planned >= b.maxAllowed;
  const maxed = !b.cost;
  const enough = affordable(b.cost, res);
  const used = base.buildQueue.length;
  const queueFull = used >= base.buildQueueSlots;
  const target = b.planned + 1;
  const reason = maxed
    ? b.planned > b.level ? `Höchststufe eingereiht (Stufe ${b.planned}).` : "Höchststufe erreicht."
    : capped ? "Erst die Kommandozentrale ausbauen."
    : queueFull ? `Bauschlange voll (${used}/${base.buildQueueSlots}).`
    : !enough ? "Noch nicht genug Ressourcen." : null;
  const now = balance ? buildingEffect(balance, b.id, b.level) : null;
  const next = balance && !maxed ? buildingEffect(balance, b.id, target) : null;
  const trains = ["werft", "kaserne", "flugfeld", "nachrichtendienst"].includes(b.id);
  const sabotaged = sabotagedUntil(base, b.id, Date.now());
  // Wirksame Werte mit Aufschlüsselung nach Quelle (nur, wenn eine Quelle wirkt).
  const effective = balance ? buildingBreakdown(balance, base.modifierSources, b.id, b.level).filter((r) => r.parts.length > 1) : [];
  const buildNote = researchNote(base.modifiers, "buildTime");
  return (
    <Sheet open onClose={onClose} title={<>{label(b.id)} <span className="text-ink2 font-sans text-sm mono">Stufe {b.level}</span></>} icon={<IconTile id={b.id} size={56} />}>
      <p className="text-sm text-slate-200 mb-3">{buildingText(balance, b.id)}</p>
      <StagePictures id={b.id} level={b.level} target={maxed ? null : target} />
      {sabotaged !== null && <p className="text-sm text-siegel mb-2">Sabotiert bis {fmtTime(sabotaged)} – der Täter ist unbekannt.</p>}
      {b.id === "nachrichtendienst" && b.level > 0 && <IntelPanel base={base} now={Date.now()} />}
      {(now || next) && (
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div className="rounded-xl bg-paper border border-rule p-2">
            <div className="text-[11px] uppercase tracking-wider text-slate-400">Jetzt</div>
            <div className="text-sm font-semibold">{now ?? "–"}</div>
          </div>
          {maxed ? (
            <div className="rounded-xl bg-paper border border-messing/60 p-2">
              <div className="text-[11px] uppercase tracking-wider text-slate-400">Höchststufe</div>
              <div className="text-sm font-semibold">Voll ausgebaut</div>
            </div>
          ) : (
            <div className="rounded-xl bg-emerald-950 border border-moos/50 p-2">
              <div className="text-[11px] uppercase tracking-wider text-emerald-300">Stufe {target}</div>
              <div className="text-sm font-semibold">{next ?? "–"}</div>
            </div>
          )}
        </div>
      )}
      {effective.length > 0 && <div className="mb-3"><Breakdown rows={effective} digits={0} /></div>}
      {!maxed && (
        <div className="rounded-xl bg-paper border border-rule p-2 mb-3">
          <div className="text-[11px] uppercase tracking-wider text-slate-400 mb-1">Kosten</div>
          <Cost cost={b.cost} have={res} />
          {b.seconds !== null && <div className="text-sm mt-1 flex items-center gap-1"><Icon id="uhr" size={16} /> {fmtSeconds(b.seconds)}{buildNote && <span className="text-xs text-emerald-300">({buildNote})</span>}</div>}
        </div>
      )}
      {b.planned > b.level && <p className="text-sm text-sea-300 mb-2">In der Bauschlange bis Stufe {b.planned}. Ein weiterer Ausbau wird dahinter eingereiht.</p>}
      {reason && <p className="text-sm text-brass-300 mb-2">{reason}</p>}
      <ErrorLine text={up.error} />
      <div className="flex gap-2">
        {trains && b.level > 0 && <Button kind="secondary" className="flex-1" onClick={() => { onClose(); onTroops(); }}>Ausbilden</Button>}
        {b.id === "forschungsamt" && <Button kind="secondary" className="flex-1" onClick={() => { onClose(); onResearch(); }}>Forschung</Button>}
        {!maxed && (
          <Button className="flex-1" disabled={!!reason || up.busy} onClick={async () => { const r = await up.run({ buildingId: b.id }); if (r?.ok) onClose(); }}>
            {used > 0 ? `Einreihen: Stufe ${target}` : `Ausbau auf ${target}`}
          </Button>
        )}
      </div>
      {b.id === "hafenkommandantur" && <p className="text-xs text-slate-400 mt-2">Missionsplätze jetzt: {base.missionSlots}</p>}
    </Sheet>
  );
}

/** Stufenbilder im Info-Blatt: jetzt und nach dem nächsten Ausbau nebeneinander. */
function StagePictures({ id, level, target }: { id: string; level: number; target: number | null }) {
  const next = nextStageLevel(level);
  const changes = target !== null && stageOf(target) !== stageOf(level);
  return (
    <div className="mb-3">
      <div className="grid grid-cols-2 gap-2">
        <figure className="rounded-xl bg-[#f6f1e5] border border-rule p-1.5 flex flex-col items-center">
          <BuildingArt id={id} level={level} size={128} />
          <figcaption className="text-[11px] uppercase tracking-wider text-slate-400 mt-1">Jetzt · Stufe {level}</figcaption>
        </figure>
        {target !== null ? (
          <figure className={`rounded-xl bg-[#f6f1e5] border p-1.5 flex flex-col items-center ${changes ? "border-moos/60" : "border-rule"}`}>
            <BuildingArt id={id} level={target} size={128} />
            <figcaption className={`text-[11px] uppercase tracking-wider mt-1 ${changes ? "text-emerald-300" : "text-slate-400"}`}>Stufe {target}</figcaption>
          </figure>
        ) : (
          <div className="rounded-xl border border-rule p-2 grid place-items-center text-center text-xs text-ink2">Prachtbau – höchste Ausbaustufe.</div>
        )}
      </div>
      {next !== null && <p className="text-xs text-ink2 mt-1">{changes ? "Mit diesem Ausbau wächst das Gebäude sichtbar." : `Neues Ausbaubild ab Stufe ${next}.`}</p>}
    </div>
  );
}

function Supply({ base }: { base: BaseData }) {
  const short = base.power.factor < 1;
  return (
    <Card title="Versorgung">
      <div className="space-y-2 text-sm">
        <div>
          <div className="flex justify-between"><span className="flex items-center gap-1"><Icon id="strom" size={16} /> Strom</span><span className={`mono ${short ? "text-red-300" : ""}`}>{fmtNum(base.power.demand)} / {fmtNum(base.power.supply)}</span></div>
          <Bar value={base.power.supply > 0 ? base.power.demand / base.power.supply : base.power.demand > 0 ? 1 : 0} tone={short ? "red" : "green"} />
          {short && <p className="text-xs text-red-300 mt-1">Zu wenig Strom: Produktion läuft nur mit {fmtNum(base.power.factor * 100)} %. Kraftwerk ausbauen!</p>}
        </div>
        <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-slate-300 [&>span:nth-child(even)]:mono">
          <span>Lager je Ressource</span><span className="text-right">{fmtNum(base.capacity)}<Note text={researchNote(base.modifiers, "storage")} /></span>
          <span>Bunkerschutz</span><span className="text-right">{fmtNum(base.bunkerProtection)}<Note text={researchNote(base.modifiers, "bunker")} /></span>
          <span>Unterhalt</span><span className="text-right">{fmtNum(base.upkeepPerHour, 1)} Proviant/h</span>
          <span>Kommandopunkte</span><span className="text-right">{fmtNum(base.commandPoints)}</span>
          <span>Missionsplätze</span><span className="text-right">{base.activeMissions}/{base.missionSlots}</span>
          <span>Stellplätze Flugfeld</span><span className="text-right">{base.aircraftSlots.used}/{base.aircraftSlots.total}</span>
          <span>Radar-Vorwarnzeit</span><span className="text-right">{fmtNum(base.radarWarningMinutes, 1)} min<Note text={researchNote(base.modifiers, "radarWarning")} /></span>
        </div>
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

export function Progress({ start, end, now }: { start: number; end: number; now: number }) {
  return <div className="w-40 max-w-full mt-1"><Bar value={(now - start) / Math.max(1, end - start)} /></div>;
}

function Protection({ base, now }: { base: BaseData; now: number }) {
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
      <ErrorLine text={save.error} />
    </Card>
  );
}
