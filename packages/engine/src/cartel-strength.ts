// Verwaltung: Stärke des Kartells als Regler (server_setting cartel_strength, Prozent der Balance-Grundstärke).
// Wirkt beim Auslaufen eines Kartell-Überfalls auf raidStrengthShareOfDefense (Boote und Miliz gleichermaßen);
// laufende Überfälle bleiben unverändert. 100 % = Balance-Datei.
import type { Balance } from "@tidefront/game-core";
import type { DbOrTx } from "@tidefront/db";
import { getSetting, setSetting } from "./settings.ts";

export const CARTEL_STRENGTH_SETTING = "cartel_strength";
export const CARTEL_STRENGTH_MIN = 25;
export const CARTEL_STRENGTH_MAX = 300;
export const CARTEL_STRENGTH_DEFAULT = 100;

export function clampCartelStrength(pct: number): number {
  if (!Number.isFinite(pct)) return CARTEL_STRENGTH_DEFAULT;
  return Math.max(CARTEL_STRENGTH_MIN, Math.min(CARTEL_STRENGTH_MAX, Math.round(pct)));
}

/** Eingestellte Kartell-Stärke in Prozent (ohne Eintrag 100). */
export async function cartelStrength(db: DbOrTx): Promise<number> {
  const raw = await getSetting(db, CARTEL_STRENGTH_SETTING);
  return raw === null ? CARTEL_STRENGTH_DEFAULT : clampCartelStrength(Number(raw));
}

export async function setCartelStrength(db: DbOrTx, pct: number): Promise<{ ok: true; pct: number }> {
  const v = clampCartelStrength(pct);
  await setSetting(db, CARTEL_STRENGTH_SETTING, String(v));
  return { ok: true, pct: v };
}

/** Balance mit skalierter Überfallstärke (bei 100 % dasselbe Objekt). */
export function scaledRaidBalance(balance: Balance, pct: number): Balance {
  const v = clampCartelStrength(pct);
  if (v === 100) return balance;
  return {
    ...balance,
    pirates: { ...balance.pirates, raidStrengthShareOfDefense: balance.pirates.raidStrengthShareOfDefense * (v / 100) },
  };
}
