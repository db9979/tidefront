// Kampfbericht als Logbuch: Siegel-Kopf, Phasen als Einträge an einer Tintenlinie, Beute als Tafel.
// Je Phase seit v1.4 die W20-Würfe beider Seiten (Kriegsglück) und Balken des ausgeteilten Schadens.
import { fmtNum, label } from "../lib/names.ts";
import { Icon } from "../icons.tsx";
import { beaufort } from "@tidefront/game-core";
import { UnitChips } from "../ui.tsx";
import { DamageBars, PhaseDice } from "./BattleDice.tsx";

type Counts = Record<string, number>;
export interface Phase {
  phase: string;
  skipped: boolean;
  skipReason: string | null;
  rounds: number;
  before: { attacker: Counts; defender: Counts };
  after: { attacker: Counts; defender: Counts };
  entscheidend: string | null;
  entscheidendSide: "attacker" | "defender" | null;
  /** Ausgeteilter Schaden je Einheitentyp (ältere Berichte: evtl. fehlend). */
  damage?: { attacker: Record<string, number>; defender: Record<string, number> };
  /** W20-Würfe des Kriegsglücks (seit v1.4; ältere Berichte ohne). */
  luck?: { attacker: number; defender: number };
  /** Faktor der Würfe (vom Server ergänzt, report.get). */
  luckFactor?: { attacker: number; defender: number };
}
interface Outcome { before: Counts; survivors: Counts; losses: Counts; returned: Counts; final: Counts }
export interface Battle {
  winner: "attacker" | "defender";
  airSuperiority: "attacker" | "defender" | null;
  landed: boolean;
  phases: Phase[];
  attacker: Outcome;
  defender: Outcome;
  loot: Counts;
  wreck: Counts;
  /** Wetter am Kampfort (seit v1.6). */
  weather?: { air: number; strike: number; wind: number; clouds: number; storm: boolean };
}

const SKIP: Record<string, string> = {
  no_fighters: "keine Jäger", no_opponent: "kein Gegner", no_bombers: "keine Bomber", no_targets: "keine Ziele",
  no_submarines: "keine U-Boote", no_ships: "keine Schiffe", no_landing_ships: "keine Landungsschiffe", no_troops: "keine Truppen",
};
const RES = ["stahl", "treibstoff", "elektronik", "proviant"];
/** Kurze Erklärung unter einer ausgetragenen Phase. */
const NOTE: Record<string, string> = {
  ubootangriff: "Torpedos aus dem Verborgenen auf Schiffe über Wasser – ohne Gegenwehr.",
};
const hasSubs = (c: Counts) => (c.uboot ?? 0) > 0;

function Side({ name, before, after }: { name: string; before: Counts; after: Counts }) {
  const ids = Object.keys(before).filter((id) => (before[id] ?? 0) > 0);
  return (
    <div className="min-w-0">
      <div className="font-display text-[11px] uppercase tracking-[0.12em] text-see mb-1 truncate">{name}</div>
      {ids.length === 0 ? <span className="text-ink2 text-xs">–</span> : (
        <ul className="space-y-1">
          {ids.map((id) => {
            const lost = before[id] - (after[id] ?? 0);
            return (
              <li key={id} className="flex items-center gap-1.5 text-xs">
                <Icon id={id} size={26} className="shrink-0" />
                <span className="min-w-0 flex-1 leading-tight">
                  <span className="block font-medium truncate">{label(id)}</span>
                  <span className="mono text-[11px] text-ink2">{fmtNum(before[id])} → {fmtNum(after[id] ?? 0)}</span>
                </span>
                <span className={`mono text-[11px] font-semibold ${lost > 0 ? "text-siegel" : "text-moos"}`}>{lost > 0 ? `−${fmtNum(lost)}` : "±0"}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function BattleLog({ b, names, role, protectedPerResource = null, salvage = null, phasesOnly = false }: {
  b: Battle;
  names: [string, string];
  role: "attacker" | "defender";
  /** Vom Angreifer nach dem Kampf geborgenes Wrackgut (zusätzlich zur Beute; ältere Berichte: null). */
  salvage?: Counts | null;
  /** Bunkerschutz je Ressource des Verteidigers (ältere Berichte: null). */
  protectedPerResource?: number | null;
  /** Nur der Phasen-Verlauf (Berichtsansicht: Kopf, Verbände und Beute stehen dort in den Bausteinen). */
  phasesOnly?: boolean;
}) {
  const won = (b.winner === "attacker") === (role === "attacker");
  // Beute aus Sicht des Lesers: Angreifer erbeutet (+, grün), Verteidiger verliert (−, Siegelrot).
  const gain = role === "attacker";
  const lootTotal = RES.reduce((s, r) => s + (b.loot[r] ?? 0), 0);
  const resList = (m: Counts | null | undefined) => Object.entries(m ?? {}).filter(([, v]) => v > 0).map(([r, v]) => `${fmtNum(v)} ${label(r)}`).join(", ");
  const wreck = resList(b.wreck);
  const salvaged = gain ? resList(salvage) : "";
  let no = 0;
  const phases = (
      <ol className="ml-2 mb-3 border-l border-ink">
        {b.phases.map((p) => {
          if (p.skipped) {
            return (
              <li key={p.phase} className="relative pl-4 pb-2.5 flex items-baseline gap-2 text-ink2">
                <span className="diamond absolute -left-[5px] top-1.5 bg-paper border border-ink2" />
                <span className="font-serif text-[15px] line-through decoration-1">{label(p.phase)}</span>
                <span className="text-xs">entfallen ({SKIP[p.skipReason ?? ""] ?? p.skipReason})</span>
              </li>
            );
          }
          no += 1;
          return (
            <li key={p.phase} className="relative pl-4 pb-3">
              <span className="diamond absolute -left-[5px] top-2 bg-ink" />
              <div className="flex items-baseline gap-2 mb-1.5">
                <span className="mono text-[11px] text-siegel">0{no}</span>
                <span className="font-serif text-[18px] flex-1">{label(p.phase)}</span>
                {p.rounds > 0 && <span className="mono text-[11px] text-ink2">{p.phase === "ubootangriff" ? `${p.rounds} ${p.rounds === 1 ? "Salve" : "Salven"}` : `${p.rounds} ${p.rounds === 1 ? "Runde" : "Runden"}`}</span>}
              </div>
              {(NOTE[p.phase] || (p.phase === "seegefecht" && (hasSubs(p.before.attacker) || hasSubs(p.before.defender)))) && (
                <p className="text-[12px] text-ink2 mb-1.5">{NOTE[p.phase] ?? "Getauchte U-Boote können nur von Einheiten mit U-Jagd (Korvette, Zerstörer) getroffen werden."}</p>
              )}
              <div className="grid grid-cols-2 gap-3 bg-card border border-rule rounded-[3px] px-2.5 py-2">
                <Side name={names[0]} before={p.before.attacker} after={p.after.attacker} />
                <Side name={names[1]} before={p.before.defender} after={p.after.defender} />
              </div>
              {p.luck && <PhaseDice luck={p.luck} names={names} factor={p.luckFactor ?? null} />}
              {p.damage && <DamageBars damage={p.damage} names={names} />}
              {p.entscheidend && (
                <p className="font-serif italic text-[13px] text-see mt-1.5">
                  Entscheidend: {label(p.entscheidend)} ({p.entscheidendSide === "attacker" ? names[0] : names[1]})
                </p>
              )}
            </li>
          );
        })}
      </ol>
  );
  if (phasesOnly) return phases;
  return (
    <>
      <section className="text-center pb-3 mb-3 border-b border-rule">
        <div className="font-display text-[11px] uppercase tracking-[0.22em] text-ink2">Kampfbericht · Logbuch</div>
        <div className="flex items-center gap-2 mx-10 mt-2" aria-hidden="true">
          <i className="flex-1 border-t-[3px] border-double border-ink" /><span className="diamond bg-siegel" /><i className="flex-1 border-t-[3px] border-double border-ink" />
        </div>
        <h2 className={`font-serif italic text-[46px] leading-none mt-1.5 mb-1 ${won ? "text-ink" : "text-siegel"}`}>{won ? "Sieg" : "Niederlage"}</h2>
        <div className="font-serif text-[15px]">{names[0]} <em className="text-ink2">gegen</em> {names[1]}</div>
        <div className="text-[11.5px] text-ink2 mt-1">
          Luftüberlegenheit: {b.airSuperiority === null ? "keine" : b.airSuperiority === "attacker" ? names[0] : names[1]} · Landung: {b.landed ? "ja" : "nein"}
        </div>
        {b.weather && (b.weather.air < 0.995 || b.weather.strike < 0.995) && (
          <div className="text-[11.5px] text-ink2">
            Wetter: {b.weather.storm ? "Sturm" : `Wind ${beaufort(b.weather.wind)} Bft`}, Wolken {Math.round(b.weather.clouds * 100)} % – Flugzeuge ×{fmtNum(b.weather.air, 2)}, Luftschlag ×{fmtNum(b.weather.air * b.weather.strike, 2)}
          </div>
        )}
      </section>

      {phases}

      <section className="panel rounded-xl p-3.5 mb-3">
        <div className="flex justify-between gap-2 mb-2.5">
          <h3 className="font-display text-[11px] uppercase tracking-[0.16em] text-ink2">{gain ? "Erbeutet" : "Geplündert"}</h3>
        </div>
        {lootTotal === 0 ? <p className="text-sm text-ink2 mb-2">{gain ? "Keine Beute." : "Nichts geplündert."}</p> : (
          <div className="grid grid-cols-4 gap-1.5 mb-3">
            {RES.map((r) => (
              <div key={r} className="text-center border border-rule rounded-[3px] py-1.5">
                <Icon id={r} size={24} className="mx-auto" />
                <div className={`mono text-[13px] font-semibold ${(b.loot[r] ?? 0) > 0 ? (gain ? "text-moos" : "text-siegel") : "text-ink2"}`}>
                  {(b.loot[r] ?? 0) > 0 ? (gain ? "+" : "−") : ""}{fmtNum(b.loot[r] ?? 0)}
                </div>
                <div className="text-[11px] text-ink2">{label(r)}</div>
              </div>
            ))}
          </div>
        )}
        {/* Wrackgut ist keine Beute: das Wrackfeld entsteht aus versenkten Schiffen am Kampfort, Bergen kostet freie Ladung. */}
        <dl className="text-xs space-y-1 mb-2">
          <div><dt className="text-ink2 inline">Neues Wrackfeld am Kampfort (versenkte Schiffe): </dt><dd className="inline">{wreck || "keins"}</dd></div>
          {salvaged && <div><dt className="text-ink2 inline">Zusätzlich geborgenes Wrackgut (mit freier Ladung, nicht Teil der Beute): </dt><dd className="inline mono">{salvaged}</dd></div>}
        </dl>
        {protectedPerResource !== null && (
          <p className="text-xs text-ink2 mb-2">
            Bunkerschutz {names[1]}: {fmtNum(protectedPerResource)} je Ressource {gain ? "waren nicht erreichbar" : "blieben sicher"}.
          </p>
        )}
        <dl className="text-xs space-y-1.5">
          <div><dt className="text-ink2 inline">Verluste {names[0]}: </dt><dd className="inline"><UnitChips counts={b.attacker.losses} /></dd></div>
          <div><dt className="text-ink2 inline">Rückkehrer {names[0]} (Lazarett, Reparatur): </dt><dd className="inline"><UnitChips counts={b.attacker.returned} /></dd></div>
          <div><dt className="text-ink2 inline">Verluste {names[1]}: </dt><dd className="inline"><UnitChips counts={b.defender.losses} /></dd></div>
          <div><dt className="text-ink2 inline">Lazarett/Reparatur {names[1]}: </dt><dd className="inline"><UnitChips counts={b.defender.returned} /></dd></div>
        </dl>
      </section>
    </>
  );
}
