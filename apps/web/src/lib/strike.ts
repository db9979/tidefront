// Truppen → Einsatz: Rechenhilfen für den Kopf „Flotte daheim“ und die Karte „Lohnende Ziele“.
// Reine Funktionen auf Basis- und Kartendaten, ohne Serveraufruf.
import type { MapNestLagebild } from "./nest-intel.ts"; // Lebendige Nester
import { hexDistanceKm } from "@tidefront/world";
import type { Balance, BaseData, MapData } from "./trpc.ts";

export type Counts = Record<string, number>;
export type Branch = "see" | "land" | "luft";
export const BRANCHES: { id: Branch; text: string; icon: string }[] = [
  { id: "see", text: "See", icon: "zerstoerer" },
  { id: "land", text: "Land", icon: "kampfpanzer" },
  { id: "luft", text: "Luft", icon: "abfangjaeger" },
];

/** Hilfsschiffe, die ein Überfall-Vorschlag nicht mitnimmt (kämpfen kaum, werden anderswo gebraucht). */
const NOT_FOR_RAID = new Set(["kolonieschiff", "minenleger", "minenraeumer", "aufklaerungsdrohne"]);

/** Einheiten daheim je Gattung (ohne verdeckte wie Spione), nur Typen mit Bestand. */
export function homeByBranch(base: BaseData, balance: Balance): Record<Branch, Counts> {
  const out: Record<Branch, Counts> = { see: {}, land: {}, luft: {} };
  for (const u of base.units) {
    const d = balance.units[u.id];
    if (!d || d.covert || u.home <= 0) continue;
    const b = d.branch as Branch;
    if (out[b]) out[b][u.id] = u.home;
  }
  return out;
}

/** Kommandopunkte einer Zählung. */
export function commandPointsOf(units: Counts, balance: Balance): number {
  let cp = 0;
  for (const [id, n] of Object.entries(units)) cp += (balance.units[id]?.commandPoints ?? 0) * n;
  return cp;
}

const attackSum = (balance: Balance, id: string) => Object.values((balance.units[id]?.attack ?? {}) as Record<string, number>).reduce((s, v) => s + v, 0);

/**
 * Vorschlag für einen Überfall aus dem, was daheim liegt: Kampfschiffe, Landtruppen nur mit Platz auf
 * Landungsschiffen, Flugzeuge nur in Reichweite. Bleibt unter den Kommandopunkten (stärkste Typen zuerst).
 */
export function suggestRaid(base: BaseData, balance: Balance, distanceKm: number): Counts {
  const home: Counts = Object.fromEntries(base.units.map((u) => [u.id, u.home]));
  let cpLeft = base.commandPoints;
  const out: Counts = {};
  const add = (id: string, want: number) => {
    const per = balance.units[id]?.commandPoints ?? 0;
    const n = Math.max(0, Math.min(want, home[id] ?? 0, per > 0 ? Math.floor((cpLeft + 1e-9) / per) : Infinity));
    if (n <= 0) return 0;
    out[id] = (out[id] ?? 0) + n;
    cpLeft -= per * n;
    return n;
  };
  const ids = Object.keys(home).filter((id) => {
    const d = balance.units[id];
    return d && !d.covert && !NOT_FOR_RAID.has(id) && home[id] > 0 && attackSum(balance, id) > 0;
  });
  const byStrength = (a: string, b: string) => attackSum(balance, b) / Math.max(0.1, balance.units[b].commandPoints ?? 1) - attackSum(balance, a) / Math.max(0.1, balance.units[a].commandPoints ?? 1);
  // 1) Kampfschiffe (ohne Landungsschiffe) und Flugzeuge in Reichweite
  for (const id of ids.filter((x) => balance.units[x].branch === "see" && !(balance.units[x].troopSpace ?? 0)).sort(byStrength)) add(id, home[id]);
  for (const id of ids.filter((x) => balance.units[x].branch === "luft" && distanceKm <= (balance.units[x].rangeKm ?? 0)).sort(byStrength)) add(id, home[id]);
  // 2) Landtruppen mit Landungsschiffen, solange Platz und Kommandopunkte reichen
  const land = ids.filter((x) => balance.units[x].branch === "land").sort(byStrength);
  const carriers = Object.keys(home).filter((id) => (balance.units[id]?.troopSpace ?? 0) > 0 && home[id] > 0);
  if (land.length > 0 && carriers.length > 0) {
    let space = 0;
    for (const c of carriers) space += add(c, home[c]) * (balance.units[c].troopSpace ?? 0);
    for (const id of land) {
      const size = balance.units[id].size ?? 1;
      space -= add(id, size > 0 ? Math.floor(space / size) : home[id]) * size;
    }
    // Landungsschiffe ohne Truppen wieder abgeben
    if (land.every((id) => !out[id])) for (const c of carriers) { cpLeft += (balance.units[c].commandPoints ?? 0) * (out[c] ?? 0); delete out[c]; }
  }
  return out;
}

/** Aufklärungsvorschlag: eine Drohne, sonst das schnellste Schiff (je eines). */
export function suggestScout(base: BaseData, balance: Balance, distanceKm: number): Counts {
  const home = base.units.filter((u) => u.home > 0 && !balance.units[u.id]?.covert);
  const drone = home.find((u) => u.id === "aufklaerungsdrohne" && distanceKm <= (balance.units[u.id].rangeKm ?? 0));
  if (drone) return { [drone.id]: 1 };
  const ships = home.filter((u) => balance.units[u.id]?.branch === "see" && u.id !== "kolonieschiff")
    .sort((a, b) => (balance.units[b.id].speedKmh ?? 0) - (balance.units[a.id].speedKmh ?? 0));
  return ships[0] ? { [ships[0].id]: 1 } : {};
}

/** Langsamste maßgebliche Geschwindigkeit (wie im Regelkern: Schiffe vor Flugzeugen). */
function speedKmh(units: Counts, balance: Balance, mods: BaseData["modifiers"] | undefined): number | null {
  let ship: number | null = null, air: number | null = null;
  const speedMod = (mods as { speed?: Record<string, number> } | undefined)?.speed;
  for (const [id, n] of Object.entries(units)) {
    const d = balance.units[id];
    if (!d || n <= 0 || d.speedKmh === undefined) continue;
    const v = d.speedKmh * (speedMod?.[d.branch] ?? 1);
    if (d.branch === "see") ship = ship === null ? v : Math.min(ship, v);
    if (d.branch === "luft") air = air === null ? v : Math.min(air, v);
  }
  return ship ?? air;
}

/** Fahrzeit in Millisekunden (einfach), null ohne Schiffe und Flugzeuge. Wetter nicht eingerechnet. */
export function travelMs(units: Counts, distanceKm: number, balance: Balance, mods?: BaseData["modifiers"]): number | null {
  const v = speedKmh(units, balance, mods);
  return v && v > 0 ? (distanceKm / v) * 3600_000 : null;
}

export type NestInfo = {
  id: number; col: number; row: number; distanceKm: number; level: number | null; empty: boolean; respawnAtMs: number | null;
  /** Lebendige Nester: genaues Lagebild (null: nur Erkennung bzw. unbekannt) und Stand der Erkennung. */
  lagebild?: MapNestLagebild | null;
  intel?: { age: string; atMs: number; source: string; level: string } | null;
};

/**
 * Nächste Piratennester (nicht verlassen) ab dem Hafen. Die Stufe kann künftig fehlen (Kartennebel):
 * dann level = null – „Stufe unbekannt“.
 */
export function nearestNests(map: MapData | undefined, base: { col: number; row: number }, count = 3): NestInfo[] {
  const nests = (map?.nests ?? []) as unknown as { id: number; col: number; row: number; level?: number | null; empty?: boolean; respawnAtMs?: number | null; lagebild?: MapNestLagebild | null; intel?: NestInfo["intel"] }[];
  return nests
    .filter((n) => !n.empty)
    .map((n) => ({
      id: n.id, col: n.col, row: n.row,
      distanceKm: hexDistanceKm(base, n),
      level: typeof n.level === "number" ? n.level : null,
      empty: !!n.empty,
      respawnAtMs: n.respawnAtMs ?? null,
      lagebild: n.lagebild ?? null,
      intel: n.intel ?? null,
    }))
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, count);
}
