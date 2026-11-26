// Wirtschafts-Bot für die Balance-Simulation: baut gierig aus (billigster erlaubter Ausbau,
// Kraftwerk bei Strommangel) und steckt einen festen Anteil seiner Ausgaben in einen Verband.
// Der Verband folgt einer Doktrin (Anteile am Rüstungswert) und bleibt innerhalb der
// Kommandopunkte; Landungsschiffe werden nach Bedarf der Truppen gebaut.
import type { Balance, BaseState, Counts, GeoPoint, ResourceMap } from "../src/index.ts";
import {
  commandPoints,
  completeTraining,
  completeUpgrade,
  createBase,
  fleetTotals,
  maxAllowedLevel,
  productionRates,
  settle,
  startTraining,
  startUpgrade,
  storageCapacity,
  trainingCost,
  upgradeCost,
} from "../src/index.ts";

const HOUR = 3600000;
const STEP = 10 * 60000;

/** Anteil der Ausgaben (zum Richtwert der Börse bewertet), den der Bot in Einheiten steckt. */
export const MILITARY_SHARE = 0.45;

/**
 * Doktrin: Zielanteile am Rüstungswert je Einheitentyp und ab wann der Typ gebaut wird
 * (Stufe des Baugebäudes). Landungsschiffe stehen nicht in der Liste, sie folgen dem Truppenbedarf.
 */
export type Doctrine = { id: string; share: number; fromLevel: number }[];

export const DOCTRINE: Doctrine = [
  { id: "korvette", share: 0.22, fromLevel: 1 },
  { id: "zerstoerer", share: 0.12, fromLevel: 3 },
  { id: "schuetzen", share: 0.3, fromLevel: 1 },
  { id: "pioniere", share: 0.1, fromLevel: 2 },
  { id: "kampfpanzer", share: 0.08, fromLevel: 4 },
  { id: "jagdbomber", share: 0.18, fromLevel: 1 },
];

/** Gegenprobe ab v1.2: U-Boote statt Zerstörer (gleicher Anteil, ebenfalls ab Werft 3). */
export const UBOOT_DOCTRINE: Doctrine = DOCTRINE.map((d) => (d.id === "zerstoerer" ? { ...d, id: "uboot" } : d));

/** Gegenprobe ab v1.2: schwere U-Boot-Rüstung (30 % U-Boote statt Zerstörern und Jagdbombern). */
export const UBOOT_HEAVY_DOCTRINE: Doctrine = [
  ...DOCTRINE.filter((d) => d.id !== "zerstoerer" && d.id !== "jagdbomber"),
  { id: "uboot", share: 0.3, fromLevel: 3 },
];

/** Gebäude, die der Bot ausbaut (Radar und Börse braucht er für Nester nicht). */
const BUILD_ORDER = [
  "stahlwerk", "raffinerie", "versorgungshof", "chipfabrik", "kraftwerk", "lagerkomplex",
  "kommandozentrale", "kaserne", "werft", "flugfeld", "hafenkommandantur", "tiefbunker",
];

/** Losgröße je Ausbildungsauftrag. */
const BATCH: Record<string, number> = { schuetzen: 10, pioniere: 5 };

export interface BotSnapshot {
  day: number;
  base: BaseState;
  /** Ausgaben zum Richtwert: Gebäude und Einheiten. */
  spentBuild: number;
  spentMil: number;
}

export function value(cost: ResourceMap, balance: Balance): number {
  let v = 0;
  for (const [r, n] of Object.entries(cost)) v += n * (balance.market.refPrice[r] ?? 0);
  return v;
}

function sum(m: Record<string, number>): number {
  return Object.values(m).reduce((a, b) => a + b, 0);
}

/** Einheiten daheim plus in Ausbildung. */
function armyWithQueue(base: BaseState): Counts {
  const all: Counts = { ...base.units };
  for (const o of base.trainingQueue) if (o.kind === "unit") all[o.id] = (all[o.id] ?? 0) + o.count;
  return all;
}

/** Mögliche Ausbildungsaufträge nach Doktrin, größtes Defizit zuerst. */
function nextOrders(base: BaseState, spentByType: Record<string, number>, balance: Balance, doctrine: Doctrine): { id: string; count: number }[] {
  const army = armyWithQueue(base);
  const totals = fleetTotals(army, balance);
  // Erst Transportraum für vorhandene Truppen.
  if (totals.troopSize > totals.troopSpace) return [{ id: "landungsschiff", count: 1 }];
  const open = doctrine.filter((d) => (base.buildings[balance.units[d.id].builtIn ?? ""] ?? 0) >= d.fromLevel);
  const shareSum = open.reduce((a, d) => a + d.share, 0);
  const spent = open.reduce((a, d) => a + (spentByType[d.id] ?? 0), 0);
  const ranked = open
    .map((d) => ({ id: d.id, deficit: (d.share / shareSum) * (spent + 1) - (spentByType[d.id] ?? 0) }))
    .sort((a, b) => b.deficit - a.deficit);
  const out: { id: string; count: number }[] = [];
  for (const { id } of ranked) {
    const count = BATCH[id] ?? 1;
    const def = balance.units[id];
    // Truppen nur mit Transportraum, sonst zuerst ein Landungsschiff.
    if (def.branch === "land" && totals.troopSize + (def.size ?? 0) * count > totals.troopSpace) {
      out.push({ id: "landungsschiff", count: 1 });
    } else out.push({ id, count });
  }
  return out;
}

/** Würde der Auftrag die Kommandopunkte oder die Proviantbilanz sprengen? */
function affordableArmy(base: BaseState, id: string, count: number, balance: Balance): boolean {
  const army = armyWithQueue(base);
  army[id] = (army[id] ?? 0) + count;
  if (fleetTotals(army, balance).commandPointsUsed > commandPoints(base, balance) + 1e-9) return false;
  const upkeep = (balance.units[id].upkeepPerHour ?? 0) * count;
  return productionRates(base, balance).perHour.proviant - upkeep >= 0;
}

/**
 * Lässt den Bot `days` Tage laufen und gibt Momentaufnahmen nach den Tagen in `checkpoints` zurück.
 * militaryShare 0 ergibt den reinen Wirtschafts-Bot.
 */
export function runBot(
  balance: Balance,
  days: number,
  checkpoints: number[],
  militaryShare = MILITARY_SHARE,
  doctrine: Doctrine = DOCTRINE,
  /** Optional: greift je Schritt in den Zustand ein (z. B. Belohnungen des Auftragsbuchs, sim/guide.ts). */
  onStep?: (base: BaseState, t: number) => BaseState,
  /** Strom (v1.6): Lage des Hafens (Wetter), Startzeit und Kraftwerkstypen bei Strommangel (billigster zuerst). */
  power: { site?: GeoPoint; startMs?: number; plants?: string[] } = {},
): BotSnapshot[] {
  const t0 = power.startMs ?? 0;
  let base: BaseState = createBase(balance, t0, power.site);
  let spentBuild = 0;
  let spentMil = 0;
  const spentByType: Record<string, number> = {};
  const out: BotSnapshot[] = [];
  const marks = [...checkpoints].sort((a, b) => a - b);
  let t = t0;
  for (; t <= t0 + days * 24 * HOUR; t += STEP) {
    if (base.buildQueue[0] && base.buildQueue[0].finishesAt <= t) {
      const c = completeUpgrade(base, t, balance);
      if (c.ok) base = c.base;
    }
    if (base.trainingQueue.some((o) => o.finishesAt <= t)) {
      const c = completeTraining(base, t, balance);
      if (c.ok) base = c.base;
    }
    base = settle(base, t, balance);
    if (onStep) base = onStep(base, t);
    const militaryFirst = spentMil <= militaryShare * (spentMil + spentBuild);
    // Ist die Rüstung an der Reihe und fehlt Geld dafür, wird für sie gespart.
    if (militaryFirst) {
      if (train() !== "saving") build();
    } else {
      build();
      train();
    }
    if (marks.length > 0 && t - t0 >= marks[0] * 24 * HOUR) {
      out.push({ day: marks.shift()!, base: settle(base, t, balance), spentBuild, spentMil });
    }
  }
  return out;

  function build(): void {
    if (base.buildQueue.length > 0) return;
    const rates = productionRates(base, balance);
    const order = power.plants ? [...BUILD_ORDER.filter((id) => id !== "kraftwerk"), ...power.plants] : BUILD_ORDER;
    let candidates = order.filter((id) => (base.buildings[id] ?? 0) < maxAllowedLevel(base, id, balance));
    // Strommangel in Produktion oder Ausbildung (v1.6): erst ein Kraftwerk (bzw. die gewählten Quellen).
    const plants = (power.plants ?? ["kraftwerk"]).filter((id) => (base.buildings[id] ?? 0) < maxAllowedLevel(base, id, balance));
    if ((rates.powerFactor < 1 || rates.grid.served.training < 1) && plants.length > 0) candidates = plants;
    // Wer rüsten will, braucht zuerst Kaserne und Werft.
    else if (militaryShare > 0) {
      const missing = ["kaserne", "werft"].filter((id) => (base.buildings[id] ?? 0) === 0);
      if (missing.length > 0) candidates = missing;
    }
    candidates.sort((a, b) => sum(upgradeCost(a, base.buildings[a] ?? 0, balance)) - sum(upgradeCost(b, base.buildings[b] ?? 0, balance)));
    // Nur der billigste Ausbau; reicht es nicht, wird gespart.
    const id = candidates[0];
    if (id === undefined) return;
    const cost = upgradeCost(id, base.buildings[id] ?? 0, balance);
    const r = startUpgrade(base, id, t, balance);
    if (r.ok) {
      base = r.base;
      spentBuild += value(cost, balance);
    }
  }

  function train(): "trained" | "saving" | "idle" {
    if (militaryShare <= 0) return "idle";
    // Über dem Anteil nur, wenn das Lager überzulaufen droht.
    const full = base.resources.stahl > 0.8 * storageCapacity(base, balance);
    if (spentMil > militaryShare * (spentMil + spentBuild) && !full) return "idle";
    for (const order of nextOrders(base, spentByType, balance, doctrine)) {
      if (!affordableArmy(base, order.id, order.count, balance)) continue;
      const r = startTraining(base, order.id, order.count, t, balance);
      // Fehlt Geld für den dringendsten Auftrag, wird gespart; andere Hindernisse überspringen.
      if (!r.ok && r.code === "insufficient_resources") return "saving";
      if (!r.ok) continue;
      base = r.base;
      const v = value(trainingCost(order.id, order.count, balance), balance);
      spentMil += v;
      spentByType[order.id] = (spentByType[order.id] ?? 0) + v;
      return "trained";
    }
    return "idle";
  }
}
