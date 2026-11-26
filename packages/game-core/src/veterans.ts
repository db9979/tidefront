// Veteranen (seit v1.4): Erfahrung je Einheitentyp und Stützpunkt (BaseState.veterancy, Durchschnitt je Einheit).
// Rang aus der Erfahrung: Rekrut, Erprobt, Veteran, Elite mit Angriffsbonus über den Modifikator attackUnit[Typ].
// Alles rein und deterministisch; der Server ruft die Funktionen nach Kampf und Ausbildung auf.
import type { Balance, BaseState, BattleReport, Counts, Side, VeteranBalance, VeteranRank } from "./types.ts";
import type { Modifiers } from "./modifiers.ts";
import { buildStats } from "./combat-stats.ts";

export type Veterancy = Record<string, number>;

/** Rang zu einer Erfahrung (höchster Rang mit minXp ≤ xp); ohne Balance-Abschnitt immer null. */
export function veteranRank(xp: number, balance: Balance): VeteranRank | null {
  const ranks = balance.veterans?.ranks;
  if (!ranks || ranks.length === 0) return null;
  let best = ranks[0];
  for (const r of ranks) if (xp + 1e-9 >= r.minXp && r.minXp >= best.minXp) best = r;
  return best;
}

/**
 * Modifikatoren aus der Erfahrung: attackUnit[Typ] = 1 + Angriffsbonus des Rangs, nur für Typen mit Bonus.
 * Wirkt im Kampf allein auf die Einheiten dieses Typs (withModifiers), sonst nirgends.
 */
export function veteranModifiers(veterancy: Veterancy | undefined, balance: Balance): Modifiers {
  if (!veterancy || !balance.veterans) return {};
  const attackUnit: Record<string, number> = {};
  for (const [id, xp] of Object.entries(veterancy)) {
    const bonus = veteranRank(xp, balance)?.attackBonus ?? 0;
    if (bonus > 0 && Object.hasOwn(balance.units, id)) attackUnit[id] = 1 + bonus;
  }
  return Object.keys(attackUnit).length > 0 ? { attackUnit } : {};
}

/** Bestand eines Typs am Stützpunkt: daheim plus unterwegs. */
function poolOf(base: BaseState, id: string): number {
  return (base.units[id] ?? 0) + (base.unitsAway[id] ?? 0);
}

/**
 * Verwässerung: `added` neue Rekruten (Erfahrung 0) kommen zu `have` Einheiten mit Durchschnitt `xp`.
 * Gewichteter Mittelwert xp * have / (have + added).
 */
export function diluteXp(xp: number, have: number, added: number): number {
  if (added <= 0) return xp;
  if (have <= 0) return 0;
  return (xp * have) / (have + added);
}

/** Wendet die Verwässerung auf einen Stützpunkt an, bevor `added` Einheiten des Typs `id` hinzukommen. */
export function diluteBase(base: BaseState, id: string, added: number): Veterancy | undefined {
  const v = base.veterancy;
  if (!v || !(v[id] > 0)) return v;
  const next = { ...v, [id]: diluteXp(v[id], poolOf(base, id), added) };
  if (next[id] < 1e-6) delete next[id];
  return next;
}

/** Stärkefaktor eines Kampfs aus Sicht einer Seite: gegnerische / eigene Lebenspunkte vorher, begrenzt. */
export function strengthRatio(report: BattleReport, side: Side, balance: Balance): number {
  const cfg = balance.veterans;
  const table = buildStats(balance);
  const hp = (c: Counts) => Object.entries(c).reduce((s, [id, n]) => s + (table.byId[id]?.hp ?? 0) * n, 0);
  const own = hp(report[side].before);
  const enemy = hp(report[side === "attacker" ? "defender" : "attacker"].before);
  const raw = own > 0 ? enemy / own : 1;
  if (!cfg) return raw;
  return Math.min(cfg.ratioMax, Math.max(cfg.ratioMin, raw));
}

/** Erfahrung je überlebender Einheit: (Sieg ? xpWin : xpLoss) × Stärkefaktor. */
export function xpPerSurvivor(won: boolean, ratio: number, cfg: VeteranBalance): number {
  return (won ? cfg.xpWin : cfg.xpLoss) * ratio;
}

/**
 * Neue Erfahrung eines Typs nach einem Kampf (rein, für Tests einzeln aufrufbar).
 * `xp`: bisheriger Durchschnitt; `pool`: Bestand des Typs am Stützpunkt nach dem Kampf (daheim + unterwegs);
 * `lost`: endgültig verlorene Einheiten (ohne Rückkehrer); `survivors`: Überlebende des Kampfs.
 * 1. Verluste kosten anteilig: xp × (1 − lossPenalty × lost / (pool + lost)).
 * 2. Gewinn: Überlebende × Erfahrung je Überlebendem, verteilt auf den ganzen Bestand (gewichteter Mittelwert).
 * 3. Begrenzt auf [0, maxXp].
 */
export function nextXp(xp: number, pool: number, lost: number, survivors: number, perSurvivor: number, cfg: VeteranBalance): number {
  if (pool <= 0) return 0;
  let x = xp * (1 - cfg.lossPenalty * (lost / (pool + lost)));
  x += (Math.min(survivors, pool) * perSurvivor) / pool;
  return Math.min(cfg.maxXp, Math.max(0, x));
}

/**
 * Erfahrung einer Seite nach einem Kampf auf den Stützpunkt anwenden. `base` muss den Bestand nach dem Kampf
 * zeigen (Verteidiger: nach applyDefenseResult; Angreifer: nach der Rückkehr). Nur Einheiten (keine Anlagen).
 * Gibt die neue veterancy zurück (unverändert ohne Balance-Abschnitt).
 */
export function battleVeterancy(base: BaseState, report: BattleReport, side: Side, balance: Balance): Veterancy | undefined {
  const cfg = balance.veterans;
  if (!cfg) return base.veterancy;
  const out: Veterancy = { ...(base.veterancy ?? {}) };
  const o = report[side];
  const won = report.winner === side;
  const per = xpPerSurvivor(won, strengthRatio(report, side, balance), cfg);
  for (const [id, before] of Object.entries(o.before)) {
    if (!Object.hasOwn(balance.units, id) || before <= 0) continue;
    const lost = Math.max(0, before - (o.final[id] ?? 0));
    const x = nextXp(out[id] ?? 0, poolOf(base, id), lost, o.survivors[id] ?? 0, per, cfg);
    if (x > 1e-6) out[id] = x;
    else delete out[id];
  }
  return out;
}

/** Erfahrungszuwachs je Typ (neu − alt), für Berichte. */
export function veterancyDelta(before: Veterancy | undefined, after: Veterancy | undefined): Veterancy {
  const out: Veterancy = {};
  const ids = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  for (const id of ids) {
    const d = (after?.[id] ?? 0) - (before?.[id] ?? 0);
    if (Math.abs(d) > 1e-6) out[id] = d;
  }
  return out;
}
