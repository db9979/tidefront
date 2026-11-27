// Lebendige Nester im Browser (game-core nest-living.ts): Was die Erkennung bzw. das Lagebild über ein Nest zeigt –
// Besatzung als Spanne oder genau (hochgerechnet: Erholung nach einer Abwehr), Anlagen (unbekannt ohne Lagebild),
// Beute (100–130 % bzw. hochgerechnetes Wachstum). Dieselben Formeln wie der Server (docs/REGELN.md „Piratennester“).
import {
  garrisonAt, garrisonFull, liveNestDefender, lootFactorAt, nestDefenders, nestLootTimes, nestSpan, nestVaries, rolledGarrison,
  type Balance as CoreBalance, type DefenderInput, type NestLiveState, type NestRoll,
} from "@tidefront/game-core";
import type { Balance } from "./trpc.ts";

/** Lagebild eines Nests aus world.map (nur wenn genau: ≤ 24 h, keine Wiederbesetzung seither). */
export interface MapNestLagebild {
  atMs: number;
  roll: NestRoll | null;
  garrison: NestLiveState["garrison"];
  garrisonAtMs: number | null;
  lootAtMs: number | null;
}

export interface Span {
  id: string;
  lo: number;
  hi: number;
}

export interface NestView {
  /** Genaues Lagebild (hochgerechnet) statt Spannen. */
  exact: boolean;
  /** Stand des Lagebilds. */
  atMs: number | null;
  units: Span[];
  /** null: Anlagen unbekannt (ohne Lagebild bei schwankenden Stufen); `defenseSpan` für den Tipp. */
  defenses: Span[] | null;
  defenseSpan: Span[];
  /** Beutefaktor lo … hi und Beute in Rohstoffen (lo … hi). */
  lootFactor: [number, number];
  loot: { id: string; lo: number; hi: number }[];
  /** Mit Lagebild: geschwächt (erholt sich noch) und wann wieder voll (ms, null = voll). */
  recovering: boolean;
  fullAtMs: number | null;
}

const core = (b: Balance) => b as unknown as CoreBalance;
const spans = (m: Record<string, [number, number]>): Span[] => Object.entries(m).filter(([, [, hi]]) => hi > 0).map(([id, [lo, hi]]) => ({ id, lo, hi }));

const stateOfLagebild = (lb: MapNestLagebild): NestLiveState => ({ roll: lb.roll, garrison: lb.garrison, garrisonAtMs: lb.garrisonAtMs, lootAtMs: lb.lootAtMs });

/** Ansicht eines besetzten Nests der Stufe `level` mit oder ohne Lagebild. */
export function nestView(level: number, lagebild: MapNestLagebild | null | undefined, nowMs: number, balance: Balance): NestView {
  const b = core(balance);
  const span = nestSpan(level, b);
  const lootOf = (lo: number, hi: number) => {
    const a = nestLootTimes(level, lo, b), z = nestLootTimes(level, hi, b);
    return Object.keys(a).filter((r) => (z[r] ?? 0) > 0).map((r) => ({ id: r, lo: a[r] ?? 0, hi: z[r] ?? 0 }));
  };
  const defenseSpan = spans(span.defenses);
  if (lagebild) {
    const st = stateOfLagebild(lagebild);
    const g = garrisonAt(level, st, nowMs, b);
    const f = lootFactorAt(st.lootAtMs, nowMs, b);
    const exact = (c: Record<string, number>) => Object.entries(c).filter(([, n]) => n > 0).map(([id, n]) => ({ id, lo: n, hi: n }));
    const full = garrisonFull(level, st, nowMs, b);
    let fullAtMs: number | null = null;
    if (!full) for (let h = 1; h <= 24 && fullAtMs === null; h++) if (garrisonFull(level, st, nowMs + h * 3600000, b)) fullAtMs = nowMs + h * 3600000;
    return { exact: true, atMs: lagebild.atMs, units: exact(g.units), defenses: exact(g.defenses), defenseSpan, lootFactor: [f, f], loot: lootOf(f, f), recovering: !full, fullAtMs };
  }
  const varies = nestVaries(level, b);
  return {
    exact: !varies, atMs: null, units: spans(span.units), defenses: varies ? null : spans(span.defenses), defenseSpan,
    lootFactor: span.loot, loot: lootOf(span.loot[0], span.loot[1]), recovering: false, fullAtMs: null,
  };
}

/** Verteidiger für Probekampf und „Lohnende Ziele“: Lagebild genau, sonst Würfe aus der Verteilung. */
export function nestProbeDefenders(level: number, lagebild: MapNestLagebild | null | undefined, nowMs: number, balance: Balance): DefenderInput[] {
  const b = core(balance);
  if (lagebild) return [liveNestDefender(level, stateOfLagebild(lagebild), nowMs, b)];
  return nestDefenders(level, b, "range");
}

/** Volle Besatzung eines Wurfs (Simulator-Vorlagen). */
export function rollGarrison(level: number, roll: NestRoll | null, balance: Balance) {
  return rolledGarrison(level, roll, core(balance));
}

/** „18–26“ bzw. „24“. */
export function spanText(s: { lo: number; hi: number }, fmt: (n: number) => string): string {
  return s.lo === s.hi ? fmt(s.lo) : `${fmt(s.lo)}–${fmt(s.hi)}`;
}
