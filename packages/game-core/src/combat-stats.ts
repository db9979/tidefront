// Bausteine des Kampfs: Werte-Tabelle, Salven, Schaden mit Restschaden, Phasenbericht, Ergebnis einer Seite.
import type { Balance, Counts, PhaseName, PhaseReport, ResourceMap, Result, Side, SideOutcome } from "./types.ts";

/** "sub" = getauchtes U-Boot (UnitDef.submerged): nur durch U-Jagd (`uboot`) zu treffen. */
export type Kind = "ship" | "sub" | "ground" | "fighter" | "bomber" | "airOther" | "defense";
export type AttackKey = "see" | "luft" | "land" | "anlage" | "uboot";

export interface Stat {
  id: string;
  kind: Kind;
  hp: number;
  attack: Record<AttackKey, number>;
  bonus: Record<string, number>;
  troopSpace: number;
  cargo: number;
  size: number;
  cost: ResourceMap;
  oneShot: number;
}

export interface StatTable {
  /** Alle IDs in fester Reihenfolge (units, npcUnits, defenses) für deterministische Schleifen. */
  ids: string[];
  byId: Record<string, Stat>;
}

export function buildStats(balance: Balance): StatTable {
  const ids: string[] = [];
  const byId: Record<string, Stat> = {};
  for (const group of [balance.units, balance.npcUnits]) {
    for (const [id, def] of Object.entries(group)) {
      const a = def.attack;
      const strikes = a.see > 0 || a.land > 0 || (a.anlage ?? 0) > 0;
      let kind: Kind = def.branch === "see" ? (def.submerged ? "sub" : "ship") : "ground";
      // Flugzeugrollen aus den Werten: Bomber wirken gegen See/Land/Anlagen, Jäger nur gegen Luft.
      if (def.branch === "luft") kind = strikes ? "bomber" : a.luft > 0 ? "fighter" : "airOther";
      ids.push(id);
      byId[id] = {
        id,
        kind,
        hp: def.hp,
        attack: { see: a.see, luft: a.luft, land: a.land, anlage: a.anlage ?? 0, uboot: a.uboot ?? 0 },
        bonus: def.bonus ?? {},
        troopSpace: def.troopSpace ?? 0,
        cargo: def.cargo ?? 0,
        size: def.size ?? 0,
        cost: def.cost ?? {},
        oneShot: 0,
      };
    }
  }
  for (const [id, def] of Object.entries(balance.defenses)) {
    const a = def.attack;
    ids.push(id);
    byId[id] = {
      id,
      kind: "defense",
      hp: def.hp,
      attack: { see: a?.see ?? 0, luft: a?.luft ?? 0, land: a?.land ?? 0, anlage: 0, uboot: a?.uboot ?? 0 },
      bonus: {},
      troopSpace: 0,
      cargo: 0,
      size: 0,
      cost: def.cost ?? {},
      oneShot: def.oneShotDamageToLanding ?? 0,
    };
  }
  return { ids, byId };
}

export type Group = [Stat, number][];

export function pick(table: StatTable, counts: Counts, pred: (s: Stat) => boolean): Group {
  const out: Group = [];
  for (const id of table.ids) {
    const n = counts[id] ?? 0;
    if (n > 0 && pred(table.byId[id])) out.push([table.byId[id], n]);
  }
  return out;
}

export function totalHp(group: Group): number {
  let sum = 0;
  for (const [s, n] of group) sum += s.hp * n;
  return sum;
}

/**
 * Eine Salve: Schaden je Schütze = Angriff * Anzahl, verteilt auf die Ziele proportional zu
 * deren gesamten Lebenspunkten; bonus[zieltyp] multipliziert den Anteil.
 */
export function volley(
  shooters: Group,
  targets: Group,
  valueFor: (shooter: Stat, target: Stat) => number,
  factor: number,
  dealt: Record<string, number>,
): Record<string, number> {
  const damage: Record<string, number> = {};
  const hpSum = totalHp(targets);
  if (hpSum <= 0) return damage;
  for (const [shooter, n] of shooters) {
    for (const [target, m] of targets) {
      const share = (target.hp * m) / hpSum;
      const d = n * valueFor(shooter, target) * share * (shooter.bonus[target.id] ?? 1) * factor;
      if (d <= 0) continue;
      damage[target.id] = (damage[target.id] ?? 0) + d;
      dealt[shooter.id] = (dealt[shooter.id] ?? 0) + d;
    }
  }
  return damage;
}

/**
 * Verluste = floor((Restschaden + Schaden) / hp), höchstens der Bestand. Der Rest unterhalb der
 * Lebenspunkte einer Einheit bleibt je Einheitentyp über Runden und Phasen erhalten (`carry`);
 * ist der Typ ausgelöscht, verfällt er.
 */
export function applyDamage(
  table: StatTable,
  counts: Counts,
  damage: Record<string, number>,
  carry: Record<string, number>,
): void {
  for (const [id, d] of Object.entries(damage)) {
    const have = counts[id] ?? 0;
    if (have <= 0) continue;
    const hp = table.byId[id].hp;
    const total = (carry[id] ?? 0) + d;
    // Kleine Toleranz, damit 3 * 66,666… nicht knapp unter 200 bleibt.
    const lost = Math.min(have, Math.floor(total / hp + 1e-9));
    counts[id] = have - lost;
    carry[id] = counts[id] === 0 ? 0 : Math.max(0, total - lost * hp);
  }
}

export function decisive(damage: { attacker: Record<string, number>; defender: Record<string, number> }, table: StatTable): {
  entscheidend: string | null;
  entscheidendSide: Side | null;
} {
  let best: string | null = null;
  let bestSide: Side | null = null;
  let bestValue = 0;
  for (const side of ["attacker", "defender"] as const) {
    for (const id of table.ids) {
      const d = damage[side][id] ?? 0;
      if (d > bestValue) {
        best = id;
        bestSide = side;
        bestValue = d;
      }
    }
  }
  return { entscheidend: best, entscheidendSide: bestSide };
}

export interface PhaseDraft {
  phase: PhaseName;
  before: { attacker: Counts; defender: Counts };
  damage: { attacker: Record<string, number>; defender: Record<string, number> };
  rounds: number;
}

export function beginPhase(phase: PhaseName, a: Counts, d: Counts): PhaseDraft {
  return { phase, before: { attacker: { ...a }, defender: { ...d } }, damage: { attacker: {}, defender: {} }, rounds: 0 };
}

export function endPhase(draft: PhaseDraft, a: Counts, d: Counts, skipReason: string | null, table: StatTable): PhaseReport {
  return {
    phase: draft.phase,
    skipped: skipReason !== null,
    skipReason,
    rounds: draft.rounds,
    before: draft.before,
    after: { attacker: { ...a }, defender: { ...d } },
    damage: draft.damage,
    ...decisive(draft.damage, table),
  };
}

export function normalizeCounts(input: Counts, allowed: (id: string) => boolean): Result<{ counts: Counts }> {
  const counts: Counts = {};
  for (const [id, n] of Object.entries(input)) {
    if (!allowed(id)) return { ok: false, code: "unknown_unit" };
    if (!Number.isInteger(n) || n < 0) return { ok: false, code: "bad_count" };
    counts[id] = n;
  }
  return { ok: true, counts };
}


export function outcome(
  table: StatTable,
  before: Counts,
  after: Counts,
  returnShare: (s: Stat) => number,
): SideOutcome {
  const survivors: Counts = {};
  const losses: Counts = {};
  const returned: Counts = {};
  const final: Counts = {};
  for (const id of Object.keys(before)) {
    survivors[id] = after[id] ?? 0;
    losses[id] = before[id] - survivors[id];
    returned[id] = Math.floor(losses[id] * returnShare(table.byId[id]) + 1e-9);
    final[id] = survivors[id] + returned[id];
  }
  return { before: { ...before }, survivors, losses, returned, final };
}
