// Kriegsglück (seit v1.4): Jede Seite würfelt je Kampfphase einen Würfel (W20). Der Wurf ist ein Faktor auf
// den gesamten Schaden dieser Seite in dieser Phase. Der Rundenzufall (combat.randomSpread) bleibt daneben bestehen.
//
// Abbildung (combat.luck = { die: 20, min: 0.8, max: 1.2, innerMin: 0.85, innerMax: 1.15 }):
//   1        → min       (Panne, −20 %)
//   die      → max       (Volltreffer, +20 %)
//   2 … die−1 linear von innerMin bis innerMax (2 → −15 % … 19 → +15 %)
// Mittelwert exakt 1, wenn min + max = 2 und innerMin + innerMax = 2: Die Stufen 2 … die−1 liegen symmetrisch
// um 1 (Paare k und die+1−k ergeben zusammen 2), ebenso 1 und die. Nachweis: luckMean() und test/luck.test.ts.
import type { Balance, LuckBalance } from "./types.ts";
import type { Rng } from "./rng.ts";
import { mulberry32, randomInt } from "./rng.ts";

/** Versatz des Würfelstroms gegenüber dem Kampf-Seed ("LUCK"), damit der Rundenzufall unverändert bleibt. */
export const LUCK_SEED_SALT = 0x4c55434b;

/** Faktor eines Wurfs 1..die. Würfe außerhalb werden auf 1..die begrenzt. */
export function luckFactor(roll: number, luck: LuckBalance): number {
  const die = Math.max(2, Math.floor(luck.die));
  const r = Math.min(die, Math.max(1, Math.round(roll)));
  if (r === 1) return luck.min;
  if (r === die) return luck.max;
  if (die === 3) return (luck.innerMin + luck.innerMax) / 2;
  return luck.innerMin + ((r - 2) * (luck.innerMax - luck.innerMin)) / (die - 3);
}

/** Erwartungswert des Faktors über alle Seiten des Würfels (Gleichverteilung). */
export function luckMean(luck: LuckBalance): number {
  let sum = 0;
  for (let r = 1; r <= luck.die; r++) sum += luckFactor(r, luck);
  return sum / luck.die;
}

/** Würfelstrom eines Kampfs: unabhängig vom Rundenzufall, aber deterministisch aus demselben Seed. */
export function luckRng(seed: number): Rng {
  return mulberry32((seed ^ LUCK_SEED_SALT) >>> 0);
}

/** Ein Wurf 1..die. */
export function rollDie(rng: Rng, die: number): number {
  return randomInt(rng, 1, die);
}

/** Würfelkonfiguration der Balance oder null (ohne `combat.luck` kein Kriegsglück, alles wie vor v1.4). */
export function luckOf(balance: Balance): LuckBalance | null {
  return balance.combat.luck ?? null;
}

/** Bezeichnung eines Wurfs für Berichte. */
export function luckLabel(roll: number, luck: LuckBalance): "panne" | "volltreffer" | null {
  if (roll <= 1) return "panne";
  if (roll >= luck.die) return "volltreffer";
  return null;
}
