// See: Empfohlenes Geleit je Frachtwert (ENTSCHEIDUNGEN-5.md). Günstigste Schiffsmischung aus dem Bestand daheim,
// die die erwartete Kartellgruppe im Probekampf mit mindestens ESCORT_TARGET abwehrt. „Günstig“ heißt: Treibstoff
// (hin und zurück) + Proviant-Unterhalt für die Zeit, in der die Schiffe fehlen + erwartete Schiffsverluste, alles
// zum Richtpreis. Gesucht wird je Schiffstyp allein (Halbierung), je Paar von Typen (zwei Zeiger: mehr vom einen,
// weniger vom anderen) und durch Verkleinern des ganzen Bestands; die Empfehlung wird danach mit frischen Seeds
// geprüft und wächst, bis sie auch dort hält. Reicht der Bestand nicht: was fehlt (je Typ zusätzlich nötig).
import {
  ESCORT_RUNS, ESCORT_TARGET, ESCORT_VERIFY_OFFSET, ESCORT_VERIFY_RUNS, escortCost, escortTradeoff, expectedCartelGroup, probeEscort, unitsValue,
  type CartelThreat, type EscortProbe, type EscortTradeoff, type EscortTrip,
} from "./escort-advice.ts";
import { fleetTotals } from "./mission.ts";
import { modValue, type Modifiers } from "./modifiers.ts";
import type { Balance, Counts } from "./types.ts";

export interface EscortAdviceInput {
  /** Warenwert der Ladung (Richtpreis). */
  value: number;
  /** Strecke fürs Kartellrisiko (wie der Server würfelt). */
  riskKm: number;
  /** Börse oder Liefervertrag (geringere Kartellchance). */
  market: boolean;
  trip: EscortTrip;
  /** Schiffe daheim (andere Einheiten werden ignoriert). */
  home: Counts;
  /** Modifikatoren des Heimathafens (das Geleit kämpft mit ihnen). */
  modifiers?: Modifiers;
  /** Freie Kommandopunkte (fehlt: unbegrenzt). */
  commandPoints?: number;
  /** Treibstoff im Lager (fehlt: nicht geprüft). */
  fuelAvailable?: number;
  target?: number;
}

export interface EscortMissing {
  unit: string;
  /** So viele zusätzlich (zum ganzen Bestand daheim) bräuchte es. */
  extra: number;
}

export interface EscortAdvice {
  threat: CartelThreat;
  /** none: das Kartell fängt hier nicht ab; ok: Empfehlung; short: Bestand reicht nicht; no_ships: keine Kriegsschiffe daheim. */
  status: "none" | "ok" | "short" | "no_ships";
  /** Empfehlung (ok) bzw. alle Kriegsschiffe daheim (short). */
  units: Counts;
  /** Geprüfte Siegchance (Prüf-Seeds) der Empfehlung bzw. des ganzen Bestands. */
  winRate: number | null;
  tradeoff: EscortTradeoff | null;
  /** Bei short: zusätzlich nötig je Typ (günstigste zuerst, höchstens zwei). */
  missing: EscortMissing[];
  /** Der ganze Bestand gewönne, aber die Kommandopunkte reichen nicht. */
  commandPointsShort: boolean;
  /** Treibstoff reicht nicht für die Geleitfahrt. */
  fuelShort: boolean;
}

const key = (c: Counts) => JSON.stringify(Object.entries(c).filter(([, n]) => n > 0).sort(([a], [b]) => a.localeCompare(b)));
const clean = (c: Counts): Counts => Object.fromEntries(Object.entries(c).filter(([, n]) => n > 0));
const total = (c: Counts) => Object.values(c).reduce((s, n) => s + Math.max(0, n), 0);

/**
 * Taugt der Typ als empfohlenes Geleit? Kriegsschiff: Schiff mit Waffen gegen Schiffe, nicht verdeckt, nicht getaucht
 * (U-Boote halten keinen Konvoi, Siegregel „halten“), ohne Truppenraum und Laderaum (Landungs- und Kolonieschiffe dürfen mitfahren, werden aber nicht empfohlen).
 */
export function escortCapable(id: string, balance: Balance): boolean {
  const d = balance.units[id];
  return !!d && d.branch === "see" && !d.covert && !d.submerged && (d.attack?.see ?? 0) > 0 && !(d.troopSpace ?? 0) && !(d.cargo ?? 0);
}

/** Kriegsschiffe daheim, die als Geleit taugen. */
export function escortHome(home: Counts, balance: Balance): Counts {
  return Object.fromEntries(Object.entries(home).filter(([id, n]) => n > 0 && escortCapable(id, balance)).map(([id, n]) => [id, Math.floor(n)]));
}

/** Empfohlenes Geleit für einen Konvoi (siehe Kopf). */
export function recommendEscort(input: EscortAdviceInput, balance: Balance): EscortAdvice {
  const target = input.target ?? ESCORT_TARGET;
  const threat = expectedCartelGroup(input.value, input.riskKm, balance, input.market);
  const home = escortHome(input.home, balance);
  const base = { threat, missing: [] as EscortMissing[], commandPointsShort: false, fuelShort: false };
  if (threat.chance <= 0 || Object.keys(threat.force).length === 0) return { ...base, status: "none", units: {}, winRate: null, tradeoff: null };
  if (Object.keys(home).length === 0) return { ...base, status: "no_ships", units: {}, winRate: null, tradeoff: null, missing: missingFor({}, threat.force, balance, input.modifiers, target) };

  const mods = input.modifiers;
  const memo = new Map<string, EscortProbe | null>();
  const probe = (c: Counts) => {
    const k = key(c);
    if (!memo.has(k)) memo.set(k, probeEscort(c, threat.force, balance, { modifiers: mods, runs: ESCORT_RUNS }));
    return memo.get(k)!;
  };
  const cpCap = input.commandPoints ?? Infinity;
  const cpOk = (c: Counts) => fleetTotals(clean(c), balance, mods).commandPointsUsed <= cpCap + 1e-9;
  const wins = (c: Counts) => (probe(c)?.winRate ?? 0) >= target;
  const good = (c: Counts) => total(c) > 0 && cpOk(c) && wins(c);
  // Kosten je Schiff (linear, für Reihenfolge und Abbruch) und Gesamtkosten eines Kandidaten (mit Schiffsverlusten).
  const ref = balance.market.refPrice;
  const perShip = (id: string) => {
    const d = balance.units[id];
    return ((d?.fuelPer100Km ?? 0) * 2 * Math.max(0, input.trip.km) / 100) * modValue(mods, "fuel") * (ref.treibstoff ?? 0)
      + (d?.upkeepPerHour ?? 0) * Math.max(0, input.trip.awayHours) * (ref.proviant ?? 0);
  };
  const linear = (c: Counts) => Object.entries(c).reduce((s, [id, n]) => s + perShip(id) * Math.max(0, n), 0);
  const fullCost = (c: Counts) => escortCost(c, input.trip, threat, balance, mods, probe(c)).total;

  const types = Object.keys(home).sort((a, b) => perShip(a) - perShip(b) || a.localeCompare(b));
  const found: Counts[] = [];
  const single: Record<string, number> = {};
  // 1. Je Typ allein: kleinste Anzahl per Halbierung.
  for (const t of types) {
    if (!good({ [t]: home[t] })) continue;
    let lo = 1, hi = home[t];
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (good({ [t]: mid })) hi = mid;
      else lo = mid + 1;
    }
    single[t] = hi;
    found.push({ [t]: hi });
  }
  // 2. Paare: mehr vom einen, weniger vom anderen (zwei Zeiger; die nötige Zahl des zweiten fällt mit dem ersten).
  const cap = (t: string) => Math.min(home[t], single[t] !== undefined ? single[t] - 1 : home[t], 60);
  for (let a = 0; a < types.length; a++) for (let b = a + 1; b < types.length; b++) {
    const [i, j] = [types[a], types[b]];
    let nj = Math.min(home[j], single[j] ?? home[j]);
    for (let ni = 1; ni <= cap(i) && nj > 0; ni++) {
      if (!good({ [i]: ni, [j]: nj })) continue;
      while (nj > 1 && good({ [i]: ni, [j]: nj - 1 })) nj--;
      found.push({ [i]: ni, [j]: nj });
    }
  }
  // 3. Ganzer Bestand, teure Schiffe zuerst verkleinert.
  if (good(home)) {
    const cur: Counts = { ...home };
    for (const t of [...types].reverse()) {
      let lo = 0, hi = cur[t];
      while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2);
        if (good({ ...cur, [t]: mid })) hi = mid;
        else lo = mid + 1;
      }
      cur[t] = hi;
    }
    found.push(clean(cur));
  }

  const fuelShortOf = (c: Counts) => input.fuelAvailable !== undefined && escortCost(c, input.trip, threat, balance, mods).fuel > input.fuelAvailable;
  if (found.length === 0) {
    // Reicht nicht: ganzer Bestand (Siegchance mit Prüf-Seeds) und was fehlt.
    const all = probeEscort(home, threat.force, balance, { modifiers: mods, runs: ESCORT_VERIFY_RUNS, seedOffset: ESCORT_VERIFY_OFFSET });
    const winRate = all?.winRate ?? 0;
    const cpShort = winRate >= target && !cpOk(home);
    return {
      ...base, status: "short", units: home, winRate,
      tradeoff: escortTradeoff(threat, winRate, escortCost(home, input.trip, threat, balance, mods, all)),
      missing: cpShort ? [] : missingFor(home, threat.force, balance, mods, target),
      commandPointsShort: cpShort, fuelShort: fuelShortOf(home),
    };
  }
  found.sort((x, y) => fullCost(x) - fullCost(y) || total(x) - total(y) || linear(x) - linear(y) || key(x).localeCompare(key(y)));
  const verified = verify(found[0], home, threat.force, balance, mods, target, cpOk);
  const vprobe = probeEscort(verified, threat.force, balance, { modifiers: mods, runs: ESCORT_VERIFY_RUNS, seedOffset: ESCORT_VERIFY_OFFSET });
  const winRate = vprobe?.winRate ?? 0;
  if (winRate < target) {
    return {
      ...base, status: "short", units: home, winRate,
      tradeoff: escortTradeoff(threat, winRate, escortCost(verified, input.trip, threat, balance, mods, vprobe)),
      missing: missingFor(home, threat.force, balance, mods, target), fuelShort: fuelShortOf(home),
    };
  }
  return {
    ...base, status: "ok", units: verified, winRate,
    tradeoff: escortTradeoff(threat, winRate, escortCost(verified, input.trip, threat, balance, mods, vprobe)),
    fuelShort: fuelShortOf(verified),
  };
}

/**
 * Prüft die Empfehlung gegen frische Seeds; hält sie dort nicht, kommt je Schritt das Schiff dazu, das die Siegchance
 * am stärksten hebt (bei Gleichstand das billigere), bis sie hält oder der Bestand erschöpft ist.
 */
function verify(start: Counts, home: Counts, force: Counts, balance: Balance, mods: Modifiers | undefined, target: number, cpOk: (c: Counts) => boolean): Counts {
  const check = (c: Counts) => probeEscort(c, force, balance, { modifiers: mods, runs: ESCORT_VERIFY_RUNS, seedOffset: ESCORT_VERIFY_OFFSET })?.winRate ?? 0;
  let cur = { ...start };
  let rate = check(cur);
  for (let step = 0; step < 40 && rate < target; step++) {
    let best: { c: Counts; r: number; v: number } | null = null;
    for (const id of Object.keys(home)) {
      if ((cur[id] ?? 0) >= home[id]) continue;
      const c = { ...cur, [id]: (cur[id] ?? 0) + 1 };
      if (!cpOk(c)) continue;
      const r = check(c);
      const v = unitsValue({ [id]: 1 }, balance);
      if (!best || r > best.r + 1e-12 || (Math.abs(r - best.r) <= 1e-12 && v < best.v)) best = { c, r, v };
    }
    if (!best) break;
    cur = best.c;
    rate = best.r;
  }
  return clean(cur);
}

/** Was fehlt: je baubarem Geleittyp die kleinste Zahl zusätzlich zum Bestand, die das Ziel erreicht (höchstens 60). */
function missingFor(home: Counts, force: Counts, balance: Balance, mods: Modifiers | undefined, target: number): EscortMissing[] {
  const rate = (c: Counts) => probeEscort(c, force, balance, { modifiers: mods, runs: ESCORT_RUNS })?.winRate ?? 0;
  const out: EscortMissing[] = [];
  for (const id of Object.keys(balance.units)) {
    if (!escortCapable(id, balance) || !balance.units[id].builtIn) continue;
    const at = (k: number) => ({ ...home, [id]: (home[id] ?? 0) + k });
    if (rate(at(60)) < target) continue;
    let lo = 1, hi = 60;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (rate(at(mid)) >= target) hi = mid;
      else lo = mid + 1;
    }
    out.push({ unit: id, extra: hi });
  }
  return out.sort((a, b) => unitsValue({ [a.unit]: a.extra }, balance) - unitsValue({ [b.unit]: b.extra }, balance)).slice(0, 2);
}
