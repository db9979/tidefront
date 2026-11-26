// Forschung: Technikbaum in vier Zweigen, laufender Auftrag mit Countdown und Abbruch, Info-Blatt je Technik,
// Durchbruch-Würfel. Erreichbar aus dem Forschungsamt (Basis) und aus Truppen.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { trpc, trpcClient, type Balance, type BaseData } from "../lib/trpc.ts";
import { useCommand } from "../lib/command.ts";
import { fmtNum } from "../lib/names.ts";
import { fmtDuration, fmtSeconds, useNow } from "../lib/time.ts";
import { liveResources } from "../lib/live.res.ts";
import { BRANCHES, TECH, modRows, pctText, roman, techEffectText, techName } from "../lib/research.ts";
import { Icon, IconTile } from "../icons.tsx";
import { Badge, Bar, Button, Card, Cost, ErrorLine, Loading, Sheet, StatTable } from "../ui.tsx";
import { BreakthroughChoice, DiceRoll } from "../components/ResearchDice.tsx";

type Research = NonNullable<BaseData["research"]>;
type TechRow = Research["techs"][number];
type TechDef = NonNullable<Balance["research"]>["techs"][string];

const invalidateBase = () => [trpc.base.pathFilter().queryKey];

const BLOCKER: Record<string, string> = {
  building_required: "Erst das Forschungsamt bauen.",
  building_level: "Das Forschungsamt muss weiter ausgebaut sein.",
  max_level: "Höchststufe erreicht.",
  requires_tech: "Voraussetzung fehlt.",
  research_busy: "Es läuft schon eine Forschung.",
  breakthrough_pending: "Erst die Durchbruch-Belohnung wählen.",
};

export function ResearchScreen({ base, asOf, onClose }: { base: BaseData; asOf: number; onClose: () => void }) {
  const meta = useQuery({ ...trpc.meta.queryOptions(), staleTime: Infinity });
  const now = useNow();
  const [open, setOpen] = useState<string | null>(null);
  const cancel = useCommand((i: { key: string }) => trpcClient.research.cancel.mutate(i), invalidateBase);
  const r = base.research;
  const balance = meta.data?.balance;
  if (!balance) return <Loading />;
  if (!r || !balance.research) return <p className="text-sm">Forschung ist in dieser Saison nicht verfügbar.</p>;
  const defs = balance.research.techs as Record<string, TechDef>;
  const byId = Object.fromEntries(r.techs.map((t) => [t.id, t]));
  const res = liveResources(base, asOf, now);
  const o = r.order;
  const bonuses = modRows(base.modifiers);

  return (
    <div>
      <div className="flex items-center justify-between mb-3 gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <IconTile id="forschungsamt" size={52} />
          <div className="min-w-0">
            <h1 className="font-serif text-[28px] leading-none">Forschung</h1>
            <div className="text-xs text-ink2 mt-1">
              Forschungsamt Stufe {r.buildingLevel} · Durchbruch-Chance {Math.round(r.chance * 100)} %
            </div>
          </div>
        </div>
        <Button kind="secondary" onClick={onClose}>Zurück</Button>
      </div>

      {r.buildingLevel < 1 && (
        <Card><p className="text-sm flex items-center gap-2"><Icon id="forschungsamt" size={32} /> Baue in der Basis das Forschungsamt, um zu forschen. Forschung gilt für diese Saison.</p></Card>
      )}

      <Card title="Laboratorium">
        {o ? (
          <div className="flex items-center gap-3">
            <IconTile id={TECH[o.techId]?.icon ?? "forschungsamt"} size={52} />
            <div className="flex-1 min-w-0">
              <div className="font-medium">{techName(o.techId)} · Stufe {roman(o.targetLevel)} {o.halved && <Badge tone="green">halbe Dauer</Badge>}</div>
              <div className="text-xs mono text-ink2 mb-1.5">{o.finishesAt <= now ? "wird abgeschlossen …" : `noch ${fmtDuration(o.finishesAt - now)}`} · Durchbruch {Math.round((o.chance ?? 0) * 100)} %</div>
              <Bar value={(now - o.startedAt) / Math.max(1, o.finishesAt - o.startedAt)} tone="brass" />
            </div>
            <Button kind="secondary" disabled={cancel.busy || o.finishesAt <= now} onClick={() => void cancel.run({})}>Abbruch</Button>
          </div>
        ) : (
          <p className="text-sm text-ink2 flex items-center gap-2"><Icon id="uhr" size={26} className="shrink-0" /> Keine Forschung läuft. Tippe eine Technik an.</p>
        )}
        {r.halfNext && <p className="text-sm text-emerald-300 mt-2">Durchbruch-Belohnung bereit: die nächste Forschung dauert nur halb so lange.</p>}
        <ErrorLine text={cancel.error} />
        {r.lastRoll && (
          <div className="mt-3">
            <DiceRoll key={r.lastRoll.atMs} roll={r.lastRoll} animate={false} />
            <BreakthroughChoice research={r} />
          </div>
        )}
      </Card>

      {BRANCHES.map((br) => {
        const ids = Object.keys(defs).filter((id) => defs[id].branch === br.id);
        const tiers = [...new Set(ids.map((id) => defs[id].requiresBuildingLevel ?? 1))].sort((a, b) => a - b);
        return (
          <Card key={br.id} title={<span className="flex items-center gap-2"><Icon id={br.icon} size={22} />{br.name}</span>}>
            <div className="relative">
              {tiers.map((tier, ti) => (
                <div key={tier} className={`relative pl-7 ${ti > 0 ? "pt-2" : ""}`}>
                  {/* Kartenlinie zwischen den Rängen des Zweigs */}
                  <div className="absolute left-2.5 top-0 bottom-0 border-l-2 border-dashed border-rule" aria-hidden="true" />
                  <div className="absolute left-0 top-3 w-5 h-5 rounded-full bg-paper border border-ink grid place-items-center text-[10px] font-display" title={`ab Forschungsamt Stufe ${tier}`}>{roman(ti + 1)}</div>
                  <div className="text-[10px] uppercase tracking-wider text-ink2 mb-1">ab Forschungsamt Stufe {tier}</div>
                  <div className="grid grid-cols-2 gap-2">
                    {ids.filter((id) => (defs[id].requiresBuildingLevel ?? 1) === tier).map((id) => (
                      <TechTile key={id} id={id} def={defs[id]} row={byId[id]} running={o?.techId === id} res={res} onOpen={() => setOpen(id)} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        );
      })}

      <Card title="Wirksame Boni">
        {bonuses.length === 0 ? <p className="text-sm text-ink2">Noch keine. Boni gelten bis zum Saisonende.</p> : <StatTable rows={bonuses} />}
      </Card>

      {open && defs[open] && byId[open] && (
        <TechSheet id={open} def={defs[open]} row={byId[open]} research={r} defs={defs} res={res} onClose={() => setOpen(null)} />
      )}
    </div>
  );
}

function affordable(cost: Record<string, number> | null, res: Record<string, number>): boolean {
  return !!cost && Object.entries(cost).every(([k, v]) => (res[k] ?? 0) >= v);
}

function Pips({ level, max }: { level: number; max: number }) {
  return (
    <span className="flex gap-0.5" aria-label={`Stufe ${level} von ${max}`}>
      {Array.from({ length: max }, (_, i) => <span key={i} className={`diamond ${i < level ? "bg-ink" : "bg-paper border border-rule"}`} />)}
    </span>
  );
}

function TechTile({ id, def, row, running, res, onOpen }: { id: string; def: TechDef; row: TechRow; running: boolean; res: Record<string, number>; onOpen: () => void }) {
  const locked = row.blocker === "building_level" || row.blocker === "requires_tech" || row.blocker === "building_required";
  const can = row.blocker === null && affordable(row.cost, res);
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`relative rounded-xl p-2 flex items-center gap-2 text-left border bg-card ${running ? "reticle" : "border-rule"} ${locked ? "opacity-60" : ""} active:scale-[0.98]`}
    >
      <Icon id={TECH[id]?.icon ?? "forschungsamt"} size={38} />
      <span className="min-w-0 flex-1">
        <span className="block font-serif text-[13.5px] leading-tight">{techName(id)}</span>
        <span className="mt-1 flex items-center gap-1.5">
          <Pips level={row.level} max={def.maxLevel} />
          {running ? <Badge tone="red">läuft</Badge> : row.level >= def.maxLevel ? <Badge tone="green">fertig</Badge> : null}
        </span>
      </span>
      {can && <span className="absolute top-1.5 right-1.5 diamond bg-moos" title="Forschung möglich" />}
    </button>
  );
}

function TechSheet(props: { id: string; def: TechDef; row: TechRow; research: Research; defs: Record<string, TechDef>; res: Record<string, number>; onClose: () => void }) {
  const { id, def, row, research, defs, res } = props;
  const start = useCommand((i: { key: string; techId: string }) => trpcClient.research.start.mutate(i), invalidateBase);
  const maxed = row.level >= def.maxLevel;
  const enough = affordable(row.cost, res);
  const reason = row.blocker ? BLOCKER[row.blocker] ?? row.blocker : !enough ? "Noch nicht genug Ressourcen." : null;
  const reqRows: [string, string][] = [
    [`Forschungsamt Stufe ${def.requiresBuildingLevel ?? 1}`, research.buildingLevel >= (def.requiresBuildingLevel ?? 1) ? "✓" : `✗ (jetzt ${research.buildingLevel})`],
    ...Object.entries(def.requires ?? {}).map(([t, n]): [string, string] => [
      `${techName(t)} Stufe ${roman(n)}`,
      (research.levels[t] ?? 0) >= n ? "✓" : `✗ (jetzt ${roman(research.levels[t] ?? 0)})`,
    ]),
  ];
  return (
    <Sheet open onClose={props.onClose} title={<>{techName(id)} <span className="text-ink2 font-sans text-sm mono">Stufe {roman(row.level)}/{roman(def.maxLevel)}</span></>} icon={<IconTile id={TECH[id]?.icon ?? "forschungsamt"} size={56} />}>
      <p className="text-sm text-slate-200 mb-3">{TECH[id]?.text}</p>
      <div className="grid grid-cols-2 gap-2 mb-3">
        <div className="rounded-xl bg-paper border border-rule p-2">
          <div className="text-[11px] uppercase tracking-wider text-slate-400">Jetzt</div>
          <div className="text-sm font-semibold">{techEffectText(def.effects, row.level)}</div>
        </div>
        <div className="rounded-xl bg-emerald-950 border border-moos/50 p-2">
          <div className="text-[11px] uppercase tracking-wider text-emerald-300">{maxed ? "Höchststufe" : `Stufe ${roman(row.level + 1)}`}</div>
          <div className="text-sm font-semibold">{maxed ? "–" : techEffectText(def.effects, row.level + 1)}</div>
        </div>
      </div>
      <p className="text-xs text-ink2 mb-3">Je Stufe {def.effects.map((e) => pctText(1 + e.perLevel, e.path)).join(" / ")}. Mehrere Quellen auf denselben Wert werden multipliziert.</p>
      {!maxed && (
        <div className="rounded-xl bg-paper border border-rule p-2 mb-3">
          <div className="text-[11px] uppercase tracking-wider text-slate-400 mb-1">Kosten</div>
          <Cost cost={row.cost} have={res} />
          {row.seconds !== null && (
            <div className="text-sm mt-1 flex items-center gap-1">
              <Icon id="uhr" size={16} /> {fmtSeconds(row.seconds)}{research.halfNext ? " (halbe Dauer durch Durchbruch)" : ""}
            </div>
          )}
          <div className="text-sm mt-1 flex items-center gap-1">
            <Icon id="wuerfel" size={16} /> {fmtNum(research.chance * 100)} % Chance auf einen Durchbruch beim Abschluss
          </div>
        </div>
      )}
      <div className="mb-3">
        <div className="text-[11px] uppercase tracking-wider text-slate-400 mb-1">Voraussetzungen</div>
        <StatTable rows={reqRows} />
      </div>
      {Object.entries(defs).some(([, d]) => d.requires?.[id]) && (
        <p className="text-xs text-ink2 mb-2">Öffnet: {Object.entries(defs).filter(([, d]) => d.requires?.[id]).map(([t, d]) => `${techName(t)} (ab Stufe ${roman(d.requires![id])})`).join(", ")}</p>
      )}
      {reason && <p className="text-sm text-brass-300 mb-2">{reason}</p>}
      <ErrorLine text={start.error} />
      {!maxed && (
        <Button className="w-full" disabled={!!reason || start.busy} onClick={async () => { const r = await start.run({ techId: id }); if (r?.ok) props.onClose(); }}>
          Forschen: Stufe {roman(row.level + 1)}
        </Button>
      )}
    </Sheet>
  );
}
