// Deterministischer Zufall. Einzige Zufallsquelle des Regelkerns.

export type Rng = () => number;

/** mulberry32: liefert bei gleichem Seed dieselbe Folge von Zahlen in [0, 1). */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Zufallsfaktor in [1 - spread, 1 + spread). */
export function randomFactor(rng: Rng, spread: number): number {
  return 1 - spread + rng() * 2 * spread;
}

/** Ganzzahl in [min, max] (einschließlich). */
export function randomInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}
