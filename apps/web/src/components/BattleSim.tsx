// Kampfsimulator (eigener, nachgeladener Chunk): Probekampf in der Missionsplanung und freier Simulator.
// Rechnet mit resolveBattle aus dem Regelkern; Einheiten kommen generisch aus der Balance.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AttackerInput, DefenderInput } from "@tidefront/game-core";
import { trpc, type Balance, type BaseData } from "../lib/trpc.ts";
import { errorText, fmtNum, label } from "../lib/names.ts";
import { fmtTime } from "../lib/time.ts";
import { unitTone } from "../lib/info.ts";
import { nestAsDefender, positive, raidAgainst, simulate, splitDefender, type Counts, type Range, type SimStats } from "../lib/sim.ts";
import { Icon, IconTile } from "../icons.tsx";
import { Bar, Button, ResChips, Stepper } from "../ui.tsx";
import { SimHistogram } from "./SimHistogram.tsx";

const pct = (v: number) => `${fmtNum(v * 100)} %`;
const rangeText = (r: Range) => `Ø ${fmtNum(r.avg, r.avg < 10 && r.avg % 1 !== 0 ? 1 : 0)} (${fmtNum(r.min)}–${fmtNum(r.max)})`;

function LossRows({ title, rows }: { title: string; rows: Record<string, Range> }) {
  const ids = Object.keys(rows);
  return (
    <div>
      <div className="text-[11px] font-display uppercase tracking-[0.12em] text-ink2 mb-1">{title}</div>
      {ids.length === 0 ? <p className="text-sm text-ink2">keine</p> : (
        <dl className="grid grid-cols-[1fr_auto] gap-x-3 text-sm">
          {ids.map((id) => (
            <div key={id} className="contents">
              <dt className="py-0.5 border-b border-dotted border-rule flex items-center gap-1.5"><Icon id={id} size={18} /> {label(id)}</dt>
              <dd className="py-0.5 border-b border-dotted border-rule text-right mono">{rangeText(rows[id])}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

/** Ergebnis über alle Durchläufe: Siegchance, Verluste, Beute, Spannweite. */
export function SimResult({ stats, ownTitle = "Eigene Verluste", enemyTitle = "Verluste des Gegners", showLoot = true }: { stats: SimStats; ownTitle?: string; enemyTitle?: string; showLoot?: boolean }) {
  const tone = stats.winRate >= 0.8 ? "green" : stats.winRate >= 0.5 ? "brass" : "red";
  const color = { green: "text-moos", brass: "text-messing", red: "text-siegel" }[tone];
  const lootAvg = Object.fromEntries(Object.entries(stats.loot).map(([r, v]) => [r, Math.round(v.avg)]));
  return (
    <div className="space-y-3">
      <div>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm text-ink2">Siegchance</span>
          <span className={`font-serif text-3xl ${color}`}>{pct(stats.winRate)}</span>
        </div>
        <Bar value={stats.winRate} tone={tone} />
        <div className="text-xs text-ink2 mt-1">
          Spannweite {pct(stats.winInterval[0])}–{pct(stats.winInterval[1])} (90 %, Kriegsglück eingerechnet) · Landung in {pct(stats.landedRate)} der {stats.runs} Durchläufe · verlorene Einheiten {rangeText(stats.attackerLostTotal)}
        </div>
      </div>
      <SimHistogram stats={stats} />
      <LossRows title={ownTitle} rows={stats.attackerLost} />
      <LossRows title={enemyTitle} rows={stats.defenderLost} />
      {showLoot && (
        <div>
          <div className="text-[11px] font-display uppercase tracking-[0.12em] text-ink2 mb-1">Beute (Ø je Kampf)</div>
          <div className="text-sm"><ResChips values={lootAvg} empty="keine" /></div>
          {stats.lootTotal.max > 0 && <div className="text-xs text-ink2 mt-1 mono">insgesamt {rangeText(stats.lootTotal)}</div>}
        </div>
      )}
    </div>
  );
}

const NOTE = "Je 50 Durchläufe mit festen Seeds. Nicht berücksichtigt: Abschlag für wiederholte Angriffe, Schwachziel-Regel, Wracks.";

function Outcome({ attacker, defender, balance, ownTitle, enemyTitle }: { attacker: AttackerInput; defender: DefenderInput; balance: Balance; ownTitle?: string; enemyTitle?: string }) {
  const r = useMemo(() => simulate(attacker, defender, balance), [attacker, defender, balance]);
  if (Object.keys(attacker.units).length === 0) return <p className="text-sm text-ink2">Angreifer wählen.</p>;
  if (!r.ok) return <p className="text-sm text-siegel">{errorText(r.code)}</p>;
  return <SimResult stats={r.stats} ownTitle={ownTitle} enemyTitle={enemyTitle} />;
}

export type ProbeTarget =
  | { kind: "nest"; level: number; empty: boolean }
  | { kind: "base"; col: number; row: number; name: string };

/** Probekampf in der Missionsplanung: gewählter Verband gegen Nest-Besatzung oder letztes Lagebild. */
export function ProbeKampf({ balance, units, versorgungsmangel, modifiers, target, onScout }: { balance: Balance; units: Counts; versorgungsmangel: boolean; modifiers?: BaseData["modifiers"]; target: ProbeTarget; onScout: () => void }) {
  const scout = useQuery({ ...trpc.comfort.scout.queryOptions(target.kind === "base" ? { col: target.col, row: target.row } : { col: 0, row: 0 }), enabled: target.kind === "base" });
  // Eigene Modifikatoren (Forschung, Veteranen) rechnen mit; das Ziel ohne (sein Stand ist unbekannt).
  const attacker = useMemo<AttackerInput>(() => ({ units: positive(units), versorgungsmangel, ...(modifiers ? { modifiers } : {}) }), [units, versorgungsmangel, modifiers]);
  const defender = useMemo<DefenderInput | null>(() => {
    if (target.kind === "nest") return nestAsDefender(target.level, balance);
    const s = scout.data;
    return s ? { units: s.units, defenses: s.defenses, resources: s.resources, protectedPerResource: s.protectedPerResource } : null;
  }, [target, scout.data, balance]);

  if (target.kind === "nest" && target.empty) return <p className="text-sm text-ink2">Das Nest ist verlassen – kein Kampf.</p>;
  if (target.kind === "base") {
    if (scout.isLoading) return <p className="text-sm text-ink2">Lade Lagebild …</p>;
    if (!scout.data) {
      return (
        <div className="text-sm space-y-2">
          <p className="font-semibold text-messing">Erst aufklären.</p>
          <p className="text-ink2">Über {target.name} liegt kein eigenes Lagebild vor. Der Probekampf rechnet nur mit den Daten deiner letzten Aufklärung.</p>
          <Button kind="secondary" onClick={onScout}>Aufklärung planen</Button>
        </div>
      );
    }
  }
  if (!defender) return <p className="text-sm text-siegel">Unbekanntes Ziel.</p>;
  return (
    <div>
      {target.kind === "base" && scout.data && (
        <p className="text-xs text-ink2 mb-2">Lagebild vom {fmtTime(scout.data.atMs)}. Der Hafen kann sich seither verändert haben.</p>
      )}
      {target.kind === "nest" && <p className="text-xs text-ink2 mb-2">Besatzung von Nest Stufe {target.level} laut Balance {balance.version}.</p>}
      <Outcome attacker={attacker} defender={defender} balance={balance} />
      <p className="text-xs text-ink2 mt-2">{NOTE}{versorgungsmangel ? " Dein Versorgungsmangel ist eingerechnet." : ""}</p>
    </div>
  );
}

/** Zählungen bearbeiten: vorhandene Typen mit Zähler, weitere über eine Auswahl hinzufügen. */
function CountEditor({ ids, counts, onChange, balance }: { ids: string[]; counts: Counts; onChange: (c: Counts) => void; balance: Balance }) {
  const shown = ids.filter((id) => (counts[id] ?? 0) > 0);
  const rest = ids.filter((id) => !((counts[id] ?? 0) > 0));
  return (
    <div>
      <ul className="divide-y divide-rule">
        {shown.map((id) => (
          <li key={id} className="py-1.5 flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-sm min-w-0 flex-1"><IconTile id={id} size={32} tone={unitTone(balance, id)} /><span className="min-w-0 break-words leading-tight">{label(id)}</span></span>
            <Stepper value={counts[id] ?? 0} onChange={(v) => onChange({ ...counts, [id]: v })} />
          </li>
        ))}
      </ul>
      {rest.length > 0 && (
        <select className="mt-2 h-11 w-full rounded-lg field px-2 text-sm" value="" onChange={(e) => e.target.value && onChange({ ...counts, [e.target.value]: 1 })}>
          <option value="">+ Einheit hinzufügen …</option>
          {rest.map((id) => <option key={id} value={id}>{label(id)}</option>)}
        </select>
      )}
    </div>
  );
}

type AttMode = "eigen" | "frei" | "kartell";

/** Freier Simulator: beide Seiten frei wählbar, Vorlagen für Nester, eigenen Hafen und Kartell-Überfall. */
export function FreeSim({ balance, base }: { balance: Balance; base: BaseData }) {
  const home = useMemo(() => positive(Object.fromEntries(base.units.map((u) => [u.id, u.home]))), [base.units]);
  const ownDef = useMemo(() => positive(Object.fromEntries(base.defenses.map((d) => [d.id, d.count]))), [base.defenses]);
  const nestLevels = Object.keys(balance.pirates.nestLevels).sort((a, b) => Number(a) - Number(b));
  const [attMode, setAttMode] = useState<AttMode>("eigen");
  const [att, setAtt] = useState<Counts>(home);
  const [defPreset, setDefPreset] = useState<string>(nestLevels[0] ? `nest:${nestLevels[0]}` : "frei");
  const [def, setDef] = useState<Counts>(() => {
    const d = nestLevels[0] ? nestAsDefender(Number(nestLevels[0]), balance) : null;
    return d ? { ...d.units, ...d.defenses } : {};
  });

  const pickDefender = (v: string) => {
    setDefPreset(v);
    if (v.startsWith("nest:")) {
      const d = nestAsDefender(Number(v.slice(5)), balance);
      setDef(d ? { ...d.units, ...d.defenses } : {});
    } else if (v === "hafen") setDef({ ...home, ...ownDef });
  };
  const pickAttacker = (m: AttMode) => {
    setAttMode(m);
    if (m === "eigen") setAtt(home);
    if (m === "kartell") pickDefender("hafen");
  };

  const playerIds = Object.keys(balance.units);
  const defIds = [...playerIds, ...Object.keys(balance.npcUnits), ...Object.keys(balance.defenses)];
  const split = useMemo(() => splitDefender(def, balance), [def, balance]);
  const attacker = useMemo<AttackerInput>(
    // Eigene Verbände rechnen mit den eigenen Modifikatoren (Forschung, Veteranen).
    () => (attMode === "kartell" ? raidAgainst(split.units, split.defenses, balance) : { units: positive(att), versorgungsmangel: attMode === "eigen" && base.versorgungsmangel, ...(attMode === "eigen" ? { modifiers: base.modifiers } : {}) }),
    [attMode, att, split, balance, base.versorgungsmangel, base.modifiers],
  );
  const defender = useMemo<DefenderInput>(() => {
    const nest = defPreset.startsWith("nest:") ? nestAsDefender(Number(defPreset.slice(5)), balance) : null;
    if (nest) return { ...split, fixedLoot: nest.fixedLoot };
    if (defPreset === "hafen") return { ...split, resources: base.resources, protectedPerResource: base.bunkerProtection, versorgungsmangel: base.versorgungsmangel, modifiers: base.modifiers };
    return split;
  }, [defPreset, split, balance, base]);

  const tab = (m: AttMode, text: string) => (
    <button key={m} type="button" onClick={() => pickAttacker(m)} className={`tap flex-1 rounded-lg border text-sm ${attMode === m ? "border-ink bg-card font-semibold reticle" : "border-rule"}`}>{text}</button>
  );

  return (
    <div className="space-y-4">
      <section>
        <h3 className="font-serif text-lg mb-1 flex items-center gap-2"><Icon id="ueberfall" size={24} /> Angreifer</h3>
        <div className="flex gap-2 mb-2">{tab("eigen", "Eigene")}{tab("frei", "Frei")}{tab("kartell", "Kartell")}</div>
        {attMode === "kartell" ? (
          <p className="text-sm">So stellt das Kartell einen Überfall gegen die Verteidigung rechts zusammen: <strong>{Object.entries(attacker.units).map(([id, n]) => `${fmtNum(n)} ${label(id)}`).join(", ")}</strong> (ohne Schwankung).</p>
        ) : (
          <CountEditor ids={playerIds} counts={att} onChange={(c) => { setAtt(c); setAttMode("frei"); }} balance={balance} />
        )}
      </section>
      <section>
        <h3 className="font-serif text-lg mb-1 flex items-center gap-2"><Icon id="schild" size={24} /> Verteidiger</h3>
        <select className="h-11 w-full rounded-lg field px-2 text-sm mb-2" value={defPreset} onChange={(e) => pickDefender(e.target.value)}>
          {nestLevels.map((l) => <option key={l} value={`nest:${l}`}>Piratennest Stufe {l}</option>)}
          <option value="hafen">Eigener Hafen (daheim)</option>
          <option value="frei">Frei</option>
        </select>
        <CountEditor ids={defIds} counts={def} onChange={(c) => { setDef(c); if (defPreset === "hafen" || defPreset.startsWith("nest:")) return; setDefPreset("frei"); }} balance={balance} />
      </section>
      <section className="rounded-xl bg-paper border border-rule p-3">
        <Outcome attacker={attacker} defender={defender} balance={balance} ownTitle={attMode === "kartell" ? "Verluste des Kartells" : "Verluste des Angreifers"} enemyTitle="Verluste des Verteidigers" />
        <p className="text-xs text-ink2 mt-2">{NOTE} Beute bei Nestern fest, beim eigenen Hafen aus den Beständen über dem Bunkerschutz.</p>
      </section>
    </div>
  );
}
