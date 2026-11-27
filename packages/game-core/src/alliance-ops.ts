// Allianz-Ops (Welle 2): Sammelangriff und Stationierung – reine, deterministische Regeln.
// Gemeinsame Streitmacht aus mehreren Verbänden, Aufteilung der Kampfergebnisse nach Besitzer und Beute nach
// Kampfbeitrag (REGELN-SOZIAL.md, Abschnitt Sammelangriff und Stationierung).
import type { AttackerInput, Balance, Counts, ResourceMap, SideOutcome } from "./types.ts";
import type { ModBranch, Modifiers } from "./modifiers.ts";
import { modEntry, modValue } from "./modifiers.ts";
import { buildStats, withModifiers } from "./combat-stats.ts";
import { SUPPLY_SHORTAGE_ATTACK_FACTOR } from "./economy.ts";

export interface AllianceOpsBalance {
  raid: {
    /** Beitrittsfrist: mindestens so viele Minuten nach dem Eröffnen. */
    minJoinMinutes: number;
    /** Beitrittsfrist: höchstens so viele Stunden nach dem Eröffnen. */
    maxJoinHours: number;
    /** Gewünschte Ankunft: höchstens so viele Stunden nach dem Eröffnen. */
    maxArriveHours: number;
    /** Gleichzeitig offene Sammelangriffe je Allianz. */
    maxOpenPerAlliance: number;
    /** Höchstzahl Teilnehmer (Verbände) je Sammelangriff. */
    maxParticipants: number;
  };
  station: {
    /** Höchstzahl stationierter fremder Verbände je Hafen. */
    maxPerBase: number;
  };
}

export const DEFAULT_ALLIANCE_OPS: AllianceOpsBalance = {
  raid: { minJoinMinutes: 15, maxJoinHours: 24, maxArriveHours: 48, maxOpenPerAlliance: 3, maxParticipants: 8 },
  station: { maxPerBase: 3 },
};

export function allianceOpsOf(balance: Balance): AllianceOpsBalance {
  const b = (balance as { allianceOps?: Partial<AllianceOpsBalance> }).allianceOps;
  return {
    raid: { ...DEFAULT_ALLIANCE_OPS.raid, ...(b?.raid ?? {}) },
    station: { ...DEFAULT_ALLIANCE_OPS.station, ...(b?.station ?? {}) },
  };
}

/** Ein Verband in einer gemeinsamen Streitmacht (Sammelangriff) oder Verteidigung (Stationierung). */
export interface ForcePart {
  units: Counts;
  modifiers?: Modifiers;
  versorgungsmangel?: boolean;
}

/**
 * Kampfwert eines Verbands: Summe je Einheit aus Lebenspunkten mal Summe der Angriffswerte (mit den
 * Modifikatoren des Besitzers). Dieselbe Größe wie im Kampf (Werte-Tabelle), nur ohne Zufall.
 */
export function combatValue(units: Counts, balance: Balance, mods?: Modifiers): number {
  const table = withModifiers(buildStats(balance), mods);
  let sum = 0;
  for (const [id, n] of Object.entries(units)) {
    const s = table.byId[id];
    if (!s || n <= 0 || s.kind === "defense") continue;
    const a = s.attack;
    sum += n * s.hp * (a.see + a.luft + a.land + a.anlage + a.uboot);
  }
  return sum;
}

function branchOf(balance: Balance, id: string): ModBranch {
  return (balance.units[id]?.branch ?? "see") as ModBranch;
}

function addCounts(a: Counts, b: Counts): Counts {
  const out: Counts = { ...a };
  for (const [id, n] of Object.entries(b)) if (n > 0) out[id] = (out[id] ?? 0) + n;
  return out;
}

/**
 * Gemeinsame Streitmacht: Einheiten summiert; Modifikatoren je Teilnehmer gemittelt, gewichtet nach seinem
 * Anteil an der jeweiligen Größe. Angriff (Gattung × Einheit × Versorgungsmangel) je Einheitentyp nach Anzahl,
 * Lebenspunkte je Gattung nach Lebenspunkten, Angriff gegen Ziele und Beute nach Kampfwert, Minenschaden nach
 * Truppen. Ladung zählt nicht (Beute wird je Teilnehmer begrenzt: `unlimitedCargo`). Tarnung: die schwächste.
 */
export function combineForces(parts: ForcePart[], balance: Balance): AttackerInput & { warningFactor: number } {
  const table = buildStats(balance);
  let units: Counts = {};
  for (const p of parts) units = addCounts(units, p.units);
  const attackUnit: Record<string, number> = {};
  for (const id of Object.keys(units)) {
    let w = 0;
    let f = 0;
    for (const p of parts) {
      const n = p.units[id] ?? 0;
      if (n <= 0) continue;
      const morale = p.versorgungsmangel ? SUPPLY_SHORTAGE_ATTACK_FACTOR : 1;
      f += n * modEntry(p.modifiers, "attack", branchOf(balance, id)) * modEntry(p.modifiers, "attackUnit", id) * morale;
      w += n;
    }
    if (w > 0) attackUnit[id] = f / w;
  }
  const hp: Partial<Record<ModBranch, number>> = {};
  for (const br of ["see", "land", "luft"] as ModBranch[]) {
    let w = 0;
    let f = 0;
    for (const p of parts) {
      let h = 0;
      for (const [id, n] of Object.entries(p.units)) if (n > 0 && branchOf(balance, id) === br) h += n * (table.byId[id]?.hp ?? 0);
      f += h * modEntry(p.modifiers, "hp", br);
      w += h;
    }
    if (w > 0) hp[br] = f / w;
  }
  const values = parts.map((p) => combatValue(p.units, balance, p.modifiers));
  const vSum = values.reduce((a, b) => a + b, 0);
  const weighted = (get: (m?: Modifiers) => number, weights: number[]) => {
    const total = weights.reduce((a, b) => a + b, 0);
    if (total <= 0) return parts.length ? parts.reduce((s, p) => s + get(p.modifiers), 0) / parts.length : 1;
    return parts.reduce((s, p, i) => s + get(p.modifiers) * weights[i], 0) / total;
  };
  const w = vSum > 0 ? values : parts.map(() => 1);
  const attackVs: Record<string, number> = {};
  for (const k of ["see", "luft", "land", "anlage", "uboot"]) attackVs[k] = weighted((m) => modEntry(m, "attackVs", k), w);
  const troops = parts.map((p) => Object.entries(p.units).reduce((s, [id, n]) => s + (balance.units[id]?.branch === "land" ? n : 0), 0));
  const modifiers: Modifiers = {
    attackUnit,
    hp,
    attackVs,
    loot: weighted((m) => modValue(m, "loot"), w),
    nestLoot: weighted((m) => modValue(m, "nestLoot"), w),
    mineDamage: weighted((m) => modValue(m, "mineDamage"), troops),
  };
  const warningFactor = parts.reduce((mx, p) => Math.max(mx, modValue(p.modifiers, "stealth")), parts.length ? 0 : 1);
  return { units, modifiers, versorgungsmangel: false, unlimitedCargo: true, warningFactor };
}

/**
 * Ganzzahlige Aufteilung von `total` nach Gewichten (größte Reste; bei Gleichstand der kleinere Index).
 * Ohne positive Gewichte gleich verteilt.
 */
export function apportion(total: number, weights: number[]): number[] {
  const n = weights.length;
  const out = new Array<number>(n).fill(0);
  if (n === 0 || total <= 0) return out;
  const w = weights.some((x) => x > 0) ? weights.map((x) => Math.max(0, x)) : weights.map(() => 1);
  const sum = w.reduce((a, b) => a + b, 0);
  const rest: [number, number][] = [];
  let given = 0;
  for (let i = 0; i < n; i++) {
    const exact = (total * w[i]) / sum;
    out[i] = Math.floor(exact + 1e-9);
    given += out[i];
    rest.push([exact - out[i], i]);
  }
  rest.sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; given < total && k < rest.length; k++) {
    if (w[rest[k][1]] <= 0) continue;
    out[rest[k][1]]++;
    given++;
  }
  return out;
}

/**
 * Ergebnis einer Seite nach Besitzern trennen: Überlebende je Typ anteilig zum Einsatz, Rückkehrer (Lazarett,
 * beschädigte Flugzeuge) anteilig zu den Verlusten. Summen stimmen exakt mit dem Gesamtergebnis überein.
 */
export function splitOutcome(total: SideOutcome, owners: Counts[]): SideOutcome[] {
  const out: SideOutcome[] = owners.map((o) => ({ before: { ...o }, survivors: {}, losses: {}, returned: {}, final: {} }));
  for (const id of Object.keys(total.before)) {
    const before = owners.map((o) => o[id] ?? 0);
    if (before.every((x) => x <= 0)) continue;
    const surv = apportion(Math.min(total.survivors[id] ?? 0, before.reduce((a, b) => a + b, 0)), before);
    const lost = before.map((b, i) => b - surv[i]);
    const ret = apportion(total.returned[id] ?? 0, lost).map((r, i) => Math.min(r, lost[i]));
    owners.forEach((_, i) => {
      if (before[i] <= 0) return;
      const o = out[i];
      o.survivors[id] = surv[i];
      o.losses[id] = lost[i];
      o.returned[id] = ret[i];
      o.final[id] = surv[i] + ret[i];
    });
  }
  return out;
}

/**
 * Beute nach Kampfbeitrag: Anteil je Teilnehmer = Gewicht (Kampfwert vor dem Kampf) / Summe; jeder höchstens
 * sein Laderaum (`caps`), der Rest an die anderen nach gleichem Schlüssel. Ganzzahlig je Ressource: abgerundet,
 * verbleibende Einheiten nach größtem Rest (bei Gleichstand der kleinere Index), nur bei freiem Laderaum.
 * Insgesamt höchstens min(Beute, Summe der Laderäume).
 */
export function shareLoot(loot: ResourceMap, weights: number[], caps: number[], resources: readonly string[] = Object.keys(loot)): ResourceMap[] {
  const n = weights.length;
  const out: ResourceMap[] = weights.map(() => Object.fromEntries(resources.map((r) => [r, 0])));
  const L = resources.reduce((s, r) => s + Math.max(0, loot[r] ?? 0), 0);
  if (n === 0 || L <= 0) return out;
  const cap = caps.map((c) => Math.max(0, Math.floor(c + 1e-9)));
  const T = Math.min(L, cap.reduce((a, b) => a + b, 0));
  // Wasserstand: wer seine Grenze erreicht, ist voll; der Rest verteilt sich nach Gewicht auf die anderen.
  const amount = new Array<number>(n).fill(0);
  let active = cap.map((c, i) => (c > 0 ? i : -1)).filter((i) => i >= 0);
  if (!active.some((i) => weights[i] > 0)) weights = cap.slice();
  active = active.filter((i) => weights[i] > 0);
  let left = T;
  while (active.length > 0 && left > 1e-9) {
    const W = active.reduce((s, i) => s + weights[i], 0);
    const full = active.filter((i) => (left * weights[i]) / W >= cap[i] - amount[i] - 1e-9);
    if (full.length === 0) {
      for (const i of active) amount[i] += (left * weights[i]) / W;
      left = 0;
      break;
    }
    for (const i of full) {
      left -= cap[i] - amount[i];
      amount[i] = cap[i];
    }
    active = active.filter((i) => !full.includes(i));
  }
  const used = new Array<number>(n).fill(0);
  for (const r of resources) {
    const v = Math.max(0, loot[r] ?? 0);
    if (v <= 0) continue;
    const exact = amount.map((a) => (v * a) / L);
    const target = Math.floor(exact.reduce((a, b) => a + b, 0) + 1e-9);
    let given = 0;
    for (let i = 0; i < n; i++) {
      const g = Math.floor(exact[i] + 1e-9);
      out[i][r] = g;
      used[i] += g;
      given += g;
    }
    const order = exact.map((e, i) => [e - Math.floor(e + 1e-9), i] as [number, number]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
    for (const [, i] of order) {
      if (given >= target) break;
      if (used[i] + 1 > cap[i] || exact[i] <= 0) continue;
      out[i][r] += 1;
      used[i] += 1;
      given++;
    }
  }
  return out;
}

/** Anteile in Prozent (eine Nachkommastelle) aus Gewichten, für Berichte. */
export function sharePercents(weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + Math.max(0, b), 0);
  return weights.map((w) => (sum > 0 ? Math.round((Math.max(0, w) / sum) * 1000) / 10 : 0));
}

/**
 * Gemeinsame Ankunft: alle Verbände laufen frühestens zur Beitrittsfrist aus; die Ankunft ist die gewünschte Zeit,
 * mindestens aber Frist + längste Reisezeit. Liefert Ankunft und Abfahrt je Verband.
 */
export function jointSchedule(desiredArriveMs: number, deadlineMs: number, travelMs: number[]): { arriveAtMs: number; departAtMs: number[] } {
  const longest = travelMs.reduce((m, t) => Math.max(m, t), 0);
  const arriveAtMs = Math.max(desiredArriveMs, deadlineMs + longest);
  return { arriveAtMs, departAtMs: travelMs.map((t) => arriveAtMs - t) };
}
