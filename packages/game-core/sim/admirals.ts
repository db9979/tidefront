// Admirale (Welle 2): Wie viel Kampfwert bringt ein Admiral? Für vier Gefechte wird die Feuerkraft des Angreifers
// gesucht, bei der er 50 % gewinnt – ohne Admiral und mit Admiral. Der Kampfwert-Bonus ist das Verhältnis der
// beiden Faktoren (ohne / mit − 1): so viel mehr Feuerkraft bräuchte ein Verband ohne Admiral für dieselbe Chance.
// Ziel: ein voll ausgebildeter Admiral (Rang Admiral, zwei Kampf-Spezialisierungen) +10–20 %, nicht mehr.
import type { AttackerInput, Balance, BattleReport, Counts, DefenderInput, Modifiers } from "../src/index.ts";
import { admiralModifiers, combineModifiers, nestDefender, resolveBattle } from "../src/index.ts";
import { buildStats } from "../src/combat-stats.ts";

const SEEDS = 200;

interface Case {
  label: string;
  attacker: Counts;
  defender: DefenderInput;
  won?: (r: BattleReport, balance: Balance) => boolean;
}

function power(f: number): Modifiers {
  return { attack: { see: f, land: f, luft: f, anlage: f } };
}

/** Seegefecht ohne Landung: Sieg, wenn der Gegner anteilig mehr Lebenspunkte verloren hat. */
function seaWin(r: BattleReport, balance: Balance): boolean {
  const t = buildStats(balance);
  const hp = (c: Counts) => Object.entries(c).reduce((s, [id, n]) => s + t.byId[id].hp * n, 0);
  return hp(r.attacker.survivors) / Math.max(1, hp(r.attacker.before)) > hp(r.defender.survivors) / Math.max(1, hp(r.defender.before));
}

function winRate(c: Case, f: number, adm: Modifiers, def: Modifiers, balance: Balance): number {
  let wins = 0;
  for (let seed = 1; seed <= SEEDS; seed++) {
    const a: AttackerInput = { units: c.attacker, modifiers: combineModifiers(power(f), adm) };
    const d: DefenderInput = { ...c.defender, modifiers: combineModifiers(c.defender.modifiers, def) };
    const r = resolveBattle(a, d, balance, seed);
    if (!r.ok) throw new Error(r.code);
    if (c.won ? c.won(r.report, balance) : r.report.winner === "attacker") wins++;
  }
  return wins / SEEDS;
}

function evenFactor(c: Case, adm: Modifiers, def: Modifiers, balance: Balance): number {
  let lo = 0.2;
  let hi = 5;
  for (let i = 0; i < 12; i++) {
    const mid = Math.sqrt(lo * hi);
    if (winRate(c, mid, adm, def, balance) < 0.5) lo = mid;
    else hi = mid;
  }
  return Math.sqrt(lo * hi);
}

export function runAdmiralSim(balance: Balance): void {
  const cfg = balance.admirals;
  console.log(`\nAdmirale (Welle 2): Kampfwert-Bonus gegenüber demselben Verband ohne Admiral, ${SEEDS} Seeds je Fall`);
  if (!cfg) {
    console.log("  balance.admirals fehlt – keine Admirale.");
    return;
  }
  const nest = (level: number) => {
    const n = nestDefender(level, balance);
    if (!n.ok) throw new Error(n.code);
    return n.defender;
  };
  const cases: Case[] = [
    { label: "Seegefecht 10 Korv. / 4 Zerst.", attacker: { korvette: 10 }, defender: { units: { zerstoerer: 4 }, defenses: {} }, won: seaWin },
    { label: "Landung 3 L, 5 Pz, 200 Sch.", attacker: { landungsschiff: 3, kampfpanzer: 5, schuetzen: 200 }, defender: { units: { schuetzen: 150 }, defenses: { bunkerlinie: 1 } } },
    { label: "Nest 3", attacker: { zerstoerer: 4, landungsschiff: 3, kampfpanzer: 5, schuetzen: 200 }, defender: nest(3) },
    { label: "Nest 5", attacker: { zerstoerer: 8, jagdbomber: 4, landungsschiff: 5, kampfpanzer: 10, schuetzen: 300, pioniere: 50 }, defender: nest(5) },
  ];
  const full = cfg.ranks[cfg.ranks.length - 1].minXp;
  const variants: [string, Modifiers, Modifiers][] = [
    ["Kapitän z. S., Angriff", admiralModifiers(["angriff"], 0, "mission", balance), {}],
    ["Admiral, Angriff", admiralModifiers(["angriff"], full, "mission", balance), {}],
    ["Admiral, Verteidigung", admiralModifiers(["verteidigung"], full, "mission", balance), {}],
    ["Admiral, Angriff + Verteid.", admiralModifiers(["angriff", "verteidigung"], full, "mission", balance), {}],
    ["Hafen: Admiral Angr.+Vert.", {}, admiralModifiers(["angriff", "verteidigung"], full, "defense", balance)],
  ];
  const bases = cases.map((c) => evenFactor(c, {}, {}, balance));
  console.log(`  ${"".padEnd(30)}${cases.map((c) => c.label.slice(0, 16).padStart(18)).join("")}`);
  for (const [label, adm, def] of variants) {
    const cells = cases.map((c, i) => {
      const f = evenFactor(c, adm, def, balance);
      // Verteidiger-Admiral: der Angreifer braucht mehr Feuerkraft (f > Bezug) → Bonus des Verteidigers.
      const bonus = def === undefined || Object.keys(def).length === 0 ? bases[i] / f - 1 : f / bases[i] - 1;
      return `${bonus >= 0 ? "+" : ""}${(bonus * 100).toFixed(1)} %`.padStart(18);
    });
    console.log(`  ${label.padEnd(30)}${cells.join("")}`);
  }
  console.log("  Bezug: Feuerkraft-Faktor für 50 % Sieg ohne Admiral; Bonus = nötige Mehr-Feuerkraft ohne Admiral (Hafen: für den Angreifer).");
}
