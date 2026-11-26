// Felder: feste Kandidatenliste für Rohstofffelder auf See (docs/REGELN-FELDER.md). Welche Kandidaten in einer
// Saison aktiv sind, wählt der Server (packages/engine/src/fields-core.ts) nach Lage der Häfen.
import { COLS, ROWS, hexDistanceKm, hexIndex, neighbors, terrainMap, type Hex } from "./index.ts";

export interface FieldSite extends Hex {
  /** Fester Index in der Liste (gleicher Seed, gleiche Liste). */
  index: number;
  /** Feldart (Schlüssel aus balance.fields.kinds). */
  kind: string;
  tier: number;
}

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const cache = new Map<string, FieldSite[]>();

/**
 * Kandidaten: Seefelder mit Küste in der Nähe (Nachbar oder übernächstes Feld), untereinander mindestens `spacingKm`
 * entfernt. Art nach Anteilen (`kinds`: Art → Gewicht), Stufe nach `tierShares`. Gleicher Seed, gleiche Liste.
 */
export function fieldSites(seed: number, kinds: Record<string, number>, tierShares: number[], spacingKm = 230): FieldSite[] {
  const key = JSON.stringify([seed, kinds, tierShares, spacingKm]);
  const hit = cache.get(key);
  if (hit) return hit;
  const t = terrainMap();
  const sea: Hex[] = [];
  for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) {
    if (t[hexIndex(col, row)] !== "sea") continue;
    const near = neighbors(col, row);
    const ring = near.flatMap((n) => neighbors(n.col, n.row));
    if ([...near, ...ring].some((n) => t[hexIndex(n.col, n.row)] === "coast")) sea.push({ col, row });
  }
  const rand = rng(seed);
  for (let i = sea.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [sea[i], sea[j]] = [sea[j], sea[i]];
  }
  const chosen: Hex[] = [];
  for (const h of sea) if (!chosen.some((c) => hexDistanceKm(c, h) < spacingKm)) chosen.push(h);
  const kindList = Object.entries(kinds).filter(([, w]) => w > 0);
  const totalW = kindList.reduce((s, [, w]) => s + w, 0);
  const totalT = tierShares.reduce((s, w) => s + w, 0) || 1;
  const out = chosen.map((h, index) => {
    let r = rand() * totalW;
    let kind = kindList[kindList.length - 1]?.[0] ?? "";
    for (const [k, w] of kindList) { if ((r -= w) < 0) { kind = k; break; } }
    let q = rand() * totalT;
    let tier = tierShares.length;
    for (let i = 0; i < tierShares.length; i++) { if ((q -= tierShares[i]) < 0) { tier = i + 1; break; } }
    return { ...h, index, kind, tier };
  });
  cache.set(key, out);
  return out;
}
