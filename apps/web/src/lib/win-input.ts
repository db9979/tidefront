// „Was fehlt zum Sieg?“: Eingaben der Suche aus dem eigenen Hafen (Bestand daheim, ausbildbare Arten nach Baugebäude
// und Stufe, Kommandopunkte, freie Stellplätze, Ausbildungszeit je Stück) und Übergabe an Truppen → Ausbilden.
import type { AttackerInput, CombatWeather, DefenderInput, LootRule, VictoryRule, WinSearchInput } from "@tidefront/game-core";
import type { Balance, BaseData } from "./trpc.ts";

export interface WinTarget {
  /** Kampfbedingungen der eigenen Seite (Modifikatoren, Versorgungsmangel), ohne Einheiten. */
  attacker: Omit<AttackerInput, "units">;
  defenders: DefenderInput[];
  weather?: CombatWeather;
  rule?: VictoryRule;
  loot?: LootRule;
}

/** Ausbildbare Kampf-Arten: Baugebäude steht in der nötigen Stufe (Kolonieschiff und Spione kämpfen nicht). */
export function trainableIds(base: BaseData, balance: Balance): string[] {
  const level = (id: string) => base.buildings.find((x) => x.id === id)?.level ?? 0;
  return base.units.filter((u) => {
    const d = balance.units[u.id];
    if (!d || d.covert || u.secondsEach === null) return false;
    return level(d.builtIn ?? "") >= (d.requiresLevel ?? 1);
  }).map((u) => u.id);
}

export function winInput(t: WinTarget, base: BaseData, balance: Balance, target: number): WinSearchInput {
  const have = Object.fromEntries(base.units.filter((u) => u.home > 0 && !balance.units[u.id]?.covert).map((u) => [u.id, u.home]));
  const secondsEach = Object.fromEntries(base.units.filter((u) => u.secondsEach !== null).map((u) => [u.id, u.secondsEach as number]));
  return {
    attacker: t.attacker,
    defenders: t.defenders,
    ...(t.weather ? { weather: t.weather } : {}),
    ...(t.rule ? { rule: t.rule } : {}),
    ...(t.loot ? { loot: t.loot } : {}),
    have,
    allowed: trainableIds(base, balance),
    maxExtraAir: Math.max(0, base.aircraftSlots.total - base.aircraftSlots.used),
    commandPoints: base.commandPoints,
    target,
    secondsEach,
  };
}
