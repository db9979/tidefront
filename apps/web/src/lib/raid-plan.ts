// „Lohnende Ziele“: Vorschlag je Nest aus dem Probekampf (kleinster Verband mit ≥ 90 % Sieg, game-core raid-plan).
// Lebendige Nester: mit genauem Lagebild gegen die hochgerechnete Besatzung, sonst im Mittel über die Spanne (Würfe aus
// der Verteilung) – dazu die Spanne der Siegchance und eine einfache Bewertung „lohnend?“ (Beute zum Richtpreis gegen
// Treibstoff hin und zurück und erwartete Verluste).
// Wird nur nachgeladen (dynamischer Import aus Targets.tsx), damit der Regelkern nicht im Startpaket landet.
import {
  extraNeeded, fleetTotals, fuelCost, nestLootTimes, nestWinRange, raidPlanSeed, resolveBattle, smallestWinningRaid, trainingCost,
  type Balance as CoreBalance, type DefenderInput, type Modifiers,
} from "@tidefront/game-core";
import type { Balance } from "./trpc.ts";
import { nestProbeDefenders, nestView, type MapNestLagebild } from "./nest-intel.ts";

export type Counts = Record<string, number>;

export interface NestPlan {
  units: Counts;
  winRate: number | null;
  enough: boolean;
  /** Reicht der Bestand nicht: so viele Einheiten `extraId` mehr bräuchte es (null: auch das reicht nicht). */
  extra: number | null;
  extraId: string | null;
  /** Ohne Lagebild (schwankende Stufe): Siegchance des Vorschlags vom ungünstigsten bis zum günstigsten Wurf. */
  range: { min: number; mean: number; max: number } | null;
  /** Bewertung zum Richtpreis: Beute (bei Sieg, Laderaum), erwartete Verluste, Treibstoff; netto lo … hi. */
  worth: { loot: [number, number]; loss: number; fuel: number; net: [number, number] } | null;
}

/** Billigste Bodentruppe, die aus eigener Kraft kämpft (für den Hinweis „noch N … ausbilden“). */
function basicLandUnit(balance: Balance): string | null {
  const land = Object.entries(balance.units).filter(([, d]) => d.branch === "land" && !d.covert && Object.values(d.attack ?? {}).some((v) => (v as number) > 0));
  land.sort((a, b) => Object.values(a[1].cost ?? {}).reduce((s, v) => s + (v as number), 0) - Object.values(b[1].cost ?? {}).reduce((s, v) => s + (v as number), 0));
  return land[0]?.[0] ?? null;
}

const priced = (m: Record<string, number>, b: CoreBalance) => Object.entries(m).reduce((s, [r, v]) => s + v * (b.market.refPrice[r] ?? 0), 0);

/** Erwartete Bewertung eines Überfalls (Richtpreis): Beute lo/hi je Beutefaktor, Verluste aus dem Probekampf, Treibstoff. */
function worthOf(units: Counts, level: number, defs: DefenderInput[], lootFactor: [number, number], travelKm: number, b: CoreBalance, mods?: Modifiers): NestPlan["worth"] {
  const runs = 60;
  let wins = 0, loss = 0;
  for (let i = 0; i < runs; i++) {
    const r = resolveBattle({ units, ...(mods ? { modifiers: mods } : {}) }, defs[i % defs.length], b, raidPlanSeed(i));
    if (!r.ok) return null;
    if (r.report.winner === "attacker") wins++;
    for (const [id, n] of Object.entries(r.report.attacker.losses)) {
      const gone = n - (r.report.attacker.returned[id] ?? 0);
      if (gone > 0 && b.units[id]) loss += priced(trainingCost(id, gone, b), b);
    }
  }
  const cargo = fleetTotals(units, b, mods).cargoCapacity;
  const lootValue = (f: number) => {
    const l = nestLootTimes(level, f, b);
    const total = Object.values(l).reduce((s, v) => s + v, 0);
    return priced(l, b) * (total > cargo ? cargo / total : 1);
  };
  const p = wins / runs;
  const lo = p * lootValue(lootFactor[0]), hi = p * lootValue(lootFactor[1]);
  const lossAvg = loss / runs;
  const fuel = fuelCost(units, travelKm, b, mods) * (b.market.refPrice.treibstoff ?? 0);
  return { loot: [lo, hi], loss: lossAvg, fuel, net: [lo - lossAvg - fuel, hi - lossAvg - fuel] };
}

export function planNestRaid(full: Counts, level: number, balance: Balance, opts: { versorgungsmangel?: boolean; modifiers?: unknown; lagebild?: MapNestLagebild | null; nowMs?: number; travelKm?: number }): NestPlan {
  const b = balance as unknown as CoreBalance;
  const now = opts.nowMs ?? Date.now();
  const defenders = nestProbeDefenders(level, opts.lagebild, now, balance);
  const mods = opts.modifiers as Modifiers | undefined;
  const o = { versorgungsmangel: opts.versorgungsmangel, ...(mods ? { modifiers: mods } : {}), defenders };
  const p = smallestWinningRaid(full, level, b, o);
  const view = nestView(level, opts.lagebild, now, balance);
  const range = !opts.lagebild && !view.exact && Object.keys(p.units).length > 0 ? nestWinRange(p.units, level, b, { versorgungsmangel: opts.versorgungsmangel, ...(mods ? { modifiers: mods } : {}) }) : null;
  const worth = Object.keys(p.units).length > 0 && opts.travelKm !== undefined ? worthOf(p.units, level, defenders, view.lootFactor, opts.travelKm, b, mods) : null;
  if (p.enough || Object.keys(full).length === 0) return { ...p, extra: null, extraId: null, range, worth };
  const id = basicLandUnit(balance);
  return { ...p, extraId: id, extra: id ? extraNeeded(full, id, level, b, o) : null, range, worth };
}
