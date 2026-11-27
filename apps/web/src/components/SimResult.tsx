// Ergebnis des Kampfsimulators (Simulator-Chunk): Siegchance der eigenen Seite, Verteilung, Phasen, Verluste, Beute.
// Alles aus Sicht der eigenen Seite (stats.mine): bei der Kartell-Abwehr ist „Sieg“ die gehaltene Verteidigung.
import { useMemo } from "react";
import { beaufort, simNotConsidered, type AttackerInput, type CombatWeather, type DefenderInput, type LootRule, type Side, type VictoryRule } from "@tidefront/game-core";
import type { Balance } from "../lib/trpc.ts";
import { errorText, fmtNum, label } from "../lib/names.ts";
import { simulate, type PhaseStat, type Range, type SimStats } from "../lib/sim.ts";
import { Icon } from "../icons.tsx";
import { Bar, ResChips } from "../ui.tsx";
import { SimHistogram } from "./SimHistogram.tsx";

export const pct = (v: number) => `${fmtNum(v * 100)} %`;
export const rangeText = (r: Range) => `Ø ${fmtNum(r.avg, r.avg < 10 && r.avg % 1 !== 0 ? 1 : 0)} (${fmtNum(r.min)}–${fmtNum(r.max)})`;

function LossRows({ title, rows }: { title: string; rows: Record<string, Range> }) {
  const ids = Object.keys(rows);
  return (
    <div>
      <div className="text-[11px] font-display uppercase tracking-[0.12em] text-ink2 mb-1">{title}</div>
      {ids.length === 0 ? <p className="text-sm text-ink2">keine</p> : (
        <dl className="grid grid-cols-[1fr_auto] gap-x-3 text-sm">
          {ids.map((id) => (
            <div key={id} className="contents">
              <dt className="py-0.5 border-b border-dotted border-rule flex items-center gap-1.5 min-w-0"><Icon id={id} size={18} /> <span className="min-w-0 break-words">{label(id)}</span></dt>
              <dd className="py-0.5 border-b border-dotted border-rule text-right mono">{rangeText(rows[id])}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

const PHASE_TEXT: Record<PhaseStat["phase"], string> = {
  luftkampf: "Luftkampf", luftschlag: "Luftschlag", ubootangriff: "U-Boot-Angriff", seegefecht: "Seegefecht", landung: "Landung", bodenkampf: "Bodenkampf",
};

/** Phasenaufschlüsselung: wie oft fand die Phase statt, wie oft lag die eigene Seite vorn, wo fiel die Entscheidung. */
function PhaseTable({ stats }: { stats: SimStats }) {
  if (stats.phases.length === 0) return null;
  const lost = stats.runs - Math.round(stats.winRate * stats.runs);
  return (
    <div data-testid="sim-phasen">
      <div className="text-[11px] font-display uppercase tracking-[0.12em] text-ink2 mb-1">Phasen über {stats.runs} Durchläufe</div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[11px] text-ink2 text-left">
            <th className="font-normal py-0.5">Phase</th>
            <th className="font-normal text-right">fand statt</th>
            <th className="font-normal text-right">{stats.mine === "attacker" ? "vorn" : "gehalten"}</th>
            {lost > 0 && <th className="font-normal text-right">entschied Niederl.</th>}
          </tr>
        </thead>
        <tbody>
          {stats.phases.map((p) => (
            <tr key={p.phase} className="border-t border-dotted border-rule">
              <td className="py-0.5">{PHASE_TEXT[p.phase]}</td>
              <td className="text-right mono">{fmtNum(p.fought)}</td>
              <td className="text-right mono">{fmtNum(p.won)}</td>
              {lost > 0 && <td className={`text-right mono ${p.lostHere > 0 ? "text-siegel" : ""}`}>{p.lostHere > 0 ? fmtNum(p.lostHere) : "–"}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-[11px] text-ink2 mt-0.5">„{stats.mine === "attacker" ? "vorn" : "gehalten"}“: {stats.mine === "attacker" ? "mehr Lebenspunkte des Gegners vernichtet als eigene verloren; Landung: gelandet; Bodenkampf: Ziel genommen" : "mehr Lebenspunkte des Gegners vernichtet; Landung: abgewehrt; Bodenkampf: gehalten"}.</p>
    </div>
  );
}

/** Ergebnis über alle Durchläufe: Siegchance, Verteilung, Phasen, Verluste, Beute. */
export function SimResult({ stats, ownTitle = "Eigene Verluste", enemyTitle = "Verluste des Gegners", showLoot = true, winLabel }: { stats: SimStats; ownTitle?: string; enemyTitle?: string; showLoot?: boolean; winLabel?: string }) {
  const tone = stats.winRate >= 0.8 ? "green" : stats.winRate >= 0.5 ? "brass" : "red";
  const color = { green: "text-moos", brass: "text-messing", red: "text-siegel" }[tone];
  const lootAvg = Object.fromEntries(Object.entries(stats.loot).map(([r, v]) => [r, Math.round(v.avg)]));
  const defending = stats.mine === "defender";
  return (
    <div className="space-y-3">
      <div>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm text-ink2">{winLabel ?? (defending ? "Abwehrchance" : "Siegchance")}</span>
          <span className={`font-serif text-3xl ${color}`} data-testid="sim-siegchance">{pct(stats.winRate)}</span>
        </div>
        <Bar value={stats.winRate} tone={tone} />
        <div className="text-xs text-ink2 mt-1">
          Spannweite {pct(stats.winInterval[0])}–{pct(stats.winInterval[1])} (90 %, Kriegsglück eingerechnet) · Landung in {pct(stats.landedRate)} der {stats.runs} Durchläufe · eigene verlorene Einheiten {rangeText(stats.ownLostTotal)}
        </div>
      </div>
      <SimHistogram stats={stats} />
      <PhaseTable stats={stats} />
      <LossRows title={ownTitle} rows={stats.ownLost} />
      <LossRows title={enemyTitle} rows={stats.enemyLost} />
      {showLoot && (
        <div>
          <div className="text-[11px] font-display uppercase tracking-[0.12em] text-ink2 mb-1">{defending ? "Beute des Angreifers (Ø je Kampf)" : "Beute (Ø je Kampf)"}</div>
          {stats.lootUnknown ? <p className="text-sm text-ink2" data-testid="sim-beute-unbekannt">unbekannt – die Bestände des Ziels sind nicht bekannt</p> : <div className="text-sm"><ResChips values={lootAvg} empty="keine" /></div>}
          {!stats.lootUnknown && stats.lootTotal.max > 0 && <div className="text-xs text-ink2 mt-1 mono">insgesamt {rangeText(stats.lootTotal)}</div>}
        </div>
      )}
    </div>
  );
}

const RUNS_NOTE = "Je 50 Durchläufe mit festen Seeds.";

/** Hinweis unter dem Ergebnis: Durchläufe und – nur wenn zutreffend – was nicht berücksichtigt ist. */
export function SimNote({ attacker, defender, weather, rule, extra }: { attacker: AttackerInput; defender: DefenderInput; weather?: CombatWeather; rule?: VictoryRule; extra?: string }) {
  const missing = simNotConsidered(attacker, defender, weather, rule);
  return <p className="text-xs text-ink2 mt-2" data-testid="sim-note">{RUNS_NOTE}{missing.length > 0 ? ` Nicht berücksichtigt: ${missing.join(", ")}.` : ""}{extra ? ` ${extra}` : ""}</p>;
}

/** Wetter als kurzer Text: „Wolken 60 %, Sturm“. */
export function weatherText(w: CombatWeather): string {
  return `${w.storm ? "Sturm" : `Wind ${beaufort(w.wind)} Bft`}, Wolken ${Math.round(w.clouds * 100)} % – Flugzeuge ×${fmtNum(w.air, 2)}, Luftschlag ×${fmtNum(w.air * w.strike, 2)}`;
}

export function Outcome({ attacker, defender, balance, ownTitle, enemyTitle, weather, rule, loot, mine }: {
  attacker: AttackerInput; defender: DefenderInput; balance: Balance; ownTitle?: string; enemyTitle?: string; weather?: CombatWeather; rule?: VictoryRule; loot?: LootRule; mine?: Side;
}) {
  const r = useMemo(() => simulate(attacker, defender, balance, { ...(weather ? { weather } : {}), ...(rule ? { rule } : {}), ...(loot ? { loot } : {}), ...(mine ? { mine } : {}) }), [attacker, defender, balance, weather, rule, loot, mine]);
  if (Object.keys(attacker.units).length === 0) return <p className="text-sm text-ink2">Angreifer wählen.</p>;
  if (!r.ok) return <p className="text-sm text-siegel">{errorText(r.code)}</p>;
  return <SimResult stats={r.stats} ownTitle={ownTitle} enemyTitle={enemyTitle} />;
}

