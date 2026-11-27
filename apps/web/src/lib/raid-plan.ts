// „Lohnende Ziele“: Vorschlag je Nest aus dem Probekampf (kleinster Verband mit ≥ 90 % Sieg, game-core raid-plan).
// Wird nur nachgeladen (dynamischer Import aus Targets.tsx), damit der Regelkern nicht im Startpaket landet.
import { extraNeeded, smallestWinningRaid, type Balance as CoreBalance } from "@tidefront/game-core";
import type { Balance } from "./trpc.ts";

export type Counts = Record<string, number>;

export interface NestPlan {
  units: Counts;
  winRate: number | null;
  enough: boolean;
  /** Reicht der Bestand nicht: so viele Einheiten `extraId` mehr bräuchte es (null: auch das reicht nicht). */
  extra: number | null;
  extraId: string | null;
}

/** Billigste Bodentruppe, die aus eigener Kraft kämpft (für den Hinweis „noch N … ausbilden“). */
function basicLandUnit(balance: Balance): string | null {
  const land = Object.entries(balance.units).filter(([, d]) => d.branch === "land" && !d.covert && Object.values(d.attack ?? {}).some((v) => (v as number) > 0));
  land.sort((a, b) => Object.values(a[1].cost ?? {}).reduce((s, v) => s + (v as number), 0) - Object.values(b[1].cost ?? {}).reduce((s, v) => s + (v as number), 0));
  return land[0]?.[0] ?? null;
}

export function planNestRaid(full: Counts, level: number, balance: Balance, opts: { versorgungsmangel?: boolean; modifiers?: unknown }): NestPlan {
  const b = balance as unknown as CoreBalance;
  const o = { versorgungsmangel: opts.versorgungsmangel, ...(opts.modifiers ? { modifiers: opts.modifiers as never } : {}) };
  const p = smallestWinningRaid(full, level, b, o);
  if (p.enough || Object.keys(full).length === 0) return { ...p, extra: null, extraId: null };
  const id = basicLandUnit(balance);
  return { ...p, extraId: id, extra: id ? extraNeeded(full, id, level, b, o) : null };
}
