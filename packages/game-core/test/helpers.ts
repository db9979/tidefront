import { readFileSync } from "node:fs";
import type { Balance, BaseState } from "../src/index.ts";
import { createBase } from "../src/index.ts";

export const HOUR = 3600000;
export const DAY = 24 * HOUR;
export const T0 = Date.UTC(2026, 0, 10, 12, 0, 0);

export function loadBalance(): Balance {
  const url = new URL("../../balance/v1/balance.json", import.meta.url);
  return JSON.parse(readFileSync(url, "utf8")) as Balance;
}

/** Stützpunkt mit überschreibbaren Feldern. */
export function makeBase(balance: Balance, patch: Partial<BaseState> = {}): BaseState {
  const base = createBase(balance, T0);
  return {
    ...base,
    ...patch,
    resources: { ...base.resources, ...(patch.resources ?? {}) },
    buildings: { ...base.buildings, ...(patch.buildings ?? {}) },
  };
}

export function approx(actual: number, expected: number, eps = 1e-6): boolean {
  return Math.abs(actual - expected) <= eps;
}
