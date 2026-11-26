// Bestände im Client fortschreiben (Produktion bis zur Kapazität, nie unter 0).
import type { BaseData } from "./trpc.ts";

export const RES_ORDER = ["stahl", "treibstoff", "elektronik", "proviant"] as const;

export function liveAmount(base: BaseData, asOf: number, now: number, r: string): number {
  const rate = base.rates[r] ?? 0;
  const raw = base.resources[r] ?? 0;
  const grown = raw + (rate * Math.max(0, now - asOf)) / 3600000;
  if (rate >= 0) return raw >= base.capacity ? raw : Math.min(base.capacity, grown);
  return Math.max(0, grown);
}

export function liveResources(base: BaseData, asOf: number, now: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of RES_ORDER) out[r] = liveAmount(base, asOf, now, r);
  return out;
}
