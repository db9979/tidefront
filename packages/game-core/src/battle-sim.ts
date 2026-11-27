// Kampfsimulator (Regelkern, im Browser und in Tests): rechnet resolveBattle über feste Seeds durch und fasst die
// Läufe zusammen – Siegchance, Verluste, Beute, Restkampfkraft und Phasen –, immer aus Sicht der eigenen Seite
// (`mine`: Angreifer im Probekampf, Verteidiger z. B. bei der Kartell-Abwehr). Der Sieger folgt der Siegregel der
// Kampfart (settleBattle, wie der Server), die Beute der Beuteregel (lootByRule).
import { resolveBattle } from "./combat.ts";
import { lootByRule, settleBattle, type LootRule, type VictoryRule } from "./battle-victory.ts";
import type { AttackerInput, Balance, BattleReport, Counts, DefenderInput, PhaseReport, ResourceMap, Side } from "./types.ts";
import type { CombatWeather } from "./weather.ts";

export const SIM_RUNS = 50;

/** Fester Seed je Durchlauf (wie raidPlanSeed): gleiche Eingabe, gleiches Ergebnis. `offset` für Prüf-Seeds. */
export function simSeed(i: number, offset = 0): number {
  return Math.imul(i + offset + 1, 0x9e3779b1) >>> 0;
}

export interface Range { avg: number; min: number; max: number }

/** Phasen im Ergebnis: Luftkampf, Luftschlag, U-Boot, Seegefecht, Landung (gelandet?), Bodenkampf. */
export type SimPhase = "luftkampf" | "luftschlag" | "ubootangriff" | "seegefecht" | "landung" | "bodenkampf";

export interface PhaseStat {
  phase: SimPhase;
  /** In so vielen Läufen fand die Phase statt. */
  fought: number;
  /** … und so oft lag die eigene Seite vorn (mehr Lebenspunkte des Gegners vernichtet; Landung: gelandet bzw. abgewehrt). */
  won: number;
  /** So oft fiel in dieser Phase die Entscheidung gegen die eigene Seite (letzte Phase mit dem Ausschlag). */
  lostHere: number;
}

export interface SimStats {
  runs: number;
  mine: Side;
  /** Siegchance der eigenen Seite. */
  winRate: number;
  landedRate: number;
  /** Eigene dauerhafte Verluste je Typ (Verluste minus Rückkehrer). */
  ownLost: Record<string, Range>;
  enemyLost: Record<string, Range>;
  ownLostTotal: Range;
  /** Beute des Angreifers je Ressource; lootUnknown: Bestände des Ziels unbekannt. */
  loot: Record<string, Range>;
  lootTotal: Range;
  lootUnknown: boolean;
  /** Je Durchlauf: eigene Restkampfkraft (Lebenspunkte der Überlebenden / vorher, 0..1) und eigener Sieg. */
  runsDetail: { remaining: number; won: boolean }[];
  /** Spannweite der Siegchance (Wilson-Intervall, 90 %). */
  winInterval: [number, number];
  phases: PhaseStat[];
}

export interface SimOpts {
  runs?: number;
  weather?: CombatWeather;
  rule?: VictoryRule;
  loot?: LootRule;
  /** Eigene Seite (Vorgabe Angreifer). */
  mine?: Side;
  /** Erster Seed-Index (Prüf-Seeds). */
  seedOffset?: number;
}

function range(values: number[]): Range {
  if (values.length === 0) return { avg: 0, min: 0, max: 0 };
  let sum = 0, min = Infinity, max = -Infinity;
  for (const v of values) {
    sum += v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { avg: sum / values.length, min, max };
}

function perKey(samples: Counts[], keys: string[]): Record<string, Range> {
  const out: Record<string, Range> = {};
  for (const k of keys) {
    const r = range(samples.map((s) => s[k] ?? 0));
    if (r.max > 0) out[k] = r;
  }
  return out;
}

export function netLost(before: Counts, final: Counts): Counts {
  const out: Counts = {};
  for (const [id, n] of Object.entries(before)) out[id] = Math.max(0, n - (final[id] ?? 0));
  return out;
}

/** Lebenspunkte einer Zählung (Grundwerte aus der Balance). */
export function hpOfCounts(c: Counts, b: Balance): number {
  let s = 0;
  for (const [id, n] of Object.entries(c)) s += (b.units[id]?.hp ?? b.npcUnits[id]?.hp ?? b.defenses[id]?.hp ?? 0) * n;
  return s;
}

/** Wilson-Intervall für eine Quote p aus n Versuchen (z = 1,645 für 90 %). */
export function wilson(p: number, n: number, z = 1.645): [number, number] {
  if (n <= 0) return [0, 1];
  const z2 = z * z;
  const mid = (p + z2 / (2 * n)) / (1 + z2 / n);
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n);
  return [Math.max(0, mid - half), Math.min(1, mid + half)];
}

const SEA_PHASES: SimPhase[] = ["luftkampf", "luftschlag", "ubootangriff", "seegefecht"];

/** Phasen eines Laufs aus Sicht von `mine`: fand statt, vorn, Entscheidung gegen die eigene Seite. */
function phaseOutcome(rep: BattleReport, mine: Side, won: boolean, rule: VictoryRule, b: Balance, acc: Map<SimPhase, PhaseStat>) {
  const opp: Side = mine === "attacker" ? "defender" : "attacker";
  const lostHp = (p: PhaseReport, side: Side) => hpOfCounts(p.before[side], b) - hpOfCounts(p.after[side], b);
  let behind: SimPhase | null = null; // letzte Seephase, in der der Gegner vorn lag
  for (const p of rep.phases) {
    if (p.phase === "landung" || p.skipped) continue;
    const s = acc.get(p.phase)!;
    s.fought++;
    if (lostHp(p, opp) > lostHp(p, mine)) s.won++;
    else behind = p.phase;
  }
  const land = rep.phases.find((p) => p.phase === "landung");
  let decided: SimPhase | null = behind ?? "seegefecht";
  if (rule === "landung" && land) {
    const isLand = (id: string) => (b.units[id] ?? b.npcUnits[id])?.branch === "land";
    const hadTroops = Object.entries(land.before.attacker).some(([id, n]) => n > 0 && isLand(id));
    if (hadTroops) {
      const l = acc.get("landung")!;
      l.fought++;
      if (rep.landed === (mine === "attacker")) l.won++;
    }
    if (rep.landed && land.rounds > 0) {
      const g = acc.get("bodenkampf")!;
      g.fought++;
      if ((rep.winner === "attacker") === (mine === "attacker")) g.won++;
    }
    decided = rep.landed ? "bodenkampf" : hadTroops ? "landung" : decided;
  }
  if (!won && decided) acc.get(decided)!.lostHere++;
}

/** Nur die Beute: Laufergebnis nach Siegregel und Beuteregel. */
export function settleRun(rep: BattleReport, attacker: AttackerInput, b: Balance, rule: VictoryRule, loot: LootRule | undefined): { report: BattleReport; loot: ResourceMap } {
  const s = settleBattle(rep, b, rule);
  const l = loot ?? (rule === "landung" ? { kind: "kampf" as const } : { kind: "keine" as const });
  return { report: s.report, loot: lootByRule(s.report, s.destroyed, l, b, attacker.modifiers) };
}

/**
 * Rechnet den Kampf über `runs` Seeds; Fehlercode (unknown_unit, bad_count) statt Ausnahme. `defender` als Liste:
 * Lauf i gegen defenders[i mod n] (lebendige Nester über die Spanne).
 */
export function simulateBattle(attacker: AttackerInput, defender: DefenderInput | DefenderInput[], b: Balance, opts: SimOpts = {}): { ok: true; stats: SimStats } | { ok: false; code: string } {
  const runs = opts.runs ?? SIM_RUNS;
  const mine: Side = opts.mine ?? "attacker";
  const opp: Side = mine === "attacker" ? "defender" : "attacker";
  const rule = opts.rule ?? "landung";
  const defs = Array.isArray(defender) ? defender : [defender];
  const own: Counts[] = [];
  const enemy: Counts[] = [];
  const loot: Counts[] = [];
  let wins = 0, landed = 0;
  const runsDetail: SimStats["runsDetail"] = [];
  const acc = new Map<SimPhase, PhaseStat>((([...SEA_PHASES, "landung", "bodenkampf"]) as SimPhase[]).map((p) => [p, { phase: p, fought: 0, won: 0, lostHere: 0 }]));
  for (let i = 0; i < runs; i++) {
    const r = resolveBattle(attacker, defs[i % defs.length], b, simSeed(i, opts.seedOffset ?? 0), opts.weather);
    if (!r.ok) return { ok: false, code: r.code };
    const { report: rep, loot: l } = settleRun(r.report, attacker, b, rule, opts.loot);
    const won = rep.winner === mine;
    if (won) wins++;
    if (r.report.landed) landed++;
    own.push(netLost(rep[mine].before, rep[mine].final));
    enemy.push(netLost(rep[opp].before, rep[opp].final));
    loot.push(l);
    const before = hpOfCounts(rep[mine].before, b);
    runsDetail.push({ remaining: before > 0 ? hpOfCounts(rep[mine].survivors, b) / before : 0, won });
    phaseOutcome(r.report, mine, won, rule, b, acc);
  }
  const aKeys = Object.keys(attacker.units);
  const dKeys = [...new Set(defs.flatMap((d) => [...Object.keys(d.units), ...Object.keys(d.defenses)]))];
  const unknown = opts.loot?.kind === "unbekannt";
  return {
    ok: true,
    stats: {
      runs,
      mine,
      winRate: wins / runs,
      landedRate: landed / runs,
      ownLost: perKey(own, mine === "attacker" ? aKeys : dKeys),
      enemyLost: perKey(enemy, mine === "attacker" ? dKeys : aKeys),
      ownLostTotal: range(own.map((c) => Object.values(c).reduce((s, v) => s + v, 0))),
      loot: unknown ? {} : perKey(loot, b.resources),
      lootTotal: unknown ? { avg: 0, min: 0, max: 0 } : range(loot.map((c) => Object.values(c).reduce((s, v) => s + v, 0))),
      lootUnknown: unknown,
      runsDetail,
      winInterval: wilson(wins / runs, runs),
      phases: [...acc.values()].filter((p) => p.fought > 0 || p.lostHere > 0),
    },
  };
}

/**
 * Was der Simulator nicht berücksichtigt (nur Punkte, die für dieses Ziel wirklich fehlen): Abschlag für wiederholte
 * Angriffe und Schwachziel-Regel nur bei Beute aus dem Bestand, Wetter nur ohne Wetterangabe.
 */
export function simNotConsidered(attacker: AttackerInput, defender: DefenderInput, weather: CombatWeather | undefined, rule: VictoryRule = "landung"): string[] {
  const out: string[] = [];
  const share = rule === "landung" && !defender.fixedLoot && !!defender.resources;
  if (share && attacker.priorAttacksInWindow === undefined) out.push("Abschlag für wiederholte Angriffe");
  if (share && attacker.weakTarget === undefined) out.push("Schwachziel-Regel");
  if (!weather) out.push("Wetter am Kampfort");
  return out;
}
