// Felder: Rohstofffelder auf See einnehmen (docs/REGELN-FELDER.md). Reine, deterministische Regeln; Werte aus dem
// Block `fields` der Balance. Fehlt der Block, ist das System aus.
import type { Balance, Counts, DefenderInput, GeoPoint, ResourceMap, Result } from "./types.ts";
import { mulberry32 } from "./rng.ts";
import { distanceKm } from "./geo.ts";

export interface FieldKindBalance {
  /** Ressource, die das Feld liefert. */
  resource: string;
  /** Ertrag je Stunde nach Stufe (Index 0 = Stufe 1). */
  yieldPerHour: number[];
  /** Anteil an der Verteilung (relativ). */
  share: number;
}

export interface FieldsBalance {
  /** Angestrebte Zahl der Felder auf der Karte. */
  count: number;
  /** Seed der festen Kandidatenliste (packages/world fieldSites). */
  siteSeed: number;
  /** Mindestabstand eines Felds zum nächsten Hafen (km); näher gelegene neutrale Felder ziehen um. */
  minKmFromBase: number;
  /** Häfen bis zu dieser Entfernung zählen für „zwischen den Häfen“ (Vorrang bei der Auswahl). */
  preferKm: number;
  kinds: Record<string, FieldKindBalance>;
  /** Anteile der Stufen 1, 2, 3 an der Kandidatenliste. */
  tierShares: number[];
  /** Kartell-Wache neutraler Felder je Stufe. */
  guard: Counts[];
  /** Nach Sieg über die Wache oder Räumung: neue Wache nach so vielen Stunden. */
  guardRespawnHours: number;
  /** Mindest-Kommandopunkte der Besatzung (nur bewaffnete Schiffe). */
  minGarrisonCommandPoints: number;
  /** Höchstzahl Felder: base + 1 je perHarborLevels Stufen der Hafenkommandantur, höchstens max (Stufe 0: keines). */
  maxFieldsBase: number;
  maxFieldsPerHarborLevels: number;
  maxFields: number;
  /** Ertragsfaktor des 1., 2., … Felds eines Spielers (nach Einnahme geordnet). */
  yieldFactors: number[];
  /** Unterhalt in Proviant je Stunde und Feld (nach Stufe), zusätzlich zum Unterhalt der Besatzung. */
  upkeepProviantPerHour: number[];
  /** Alle so viele Stunden läuft ein Konvoi mit dem gesammelten Ertrag zum Heimathafen. */
  deliveryHours: number;
  /** Tempo der Ertragskonvois (km/h). */
  convoySpeedKmh: number;
  /** Chance je Lieferzyklus, dass das Kartell ein besetztes Feld angreift. */
  cartelRaidChance: number;
  /** Vorwarnzeit des Kartellangriffs (Minuten). */
  cartelRaidLeadMinutes: number;
  /** Kartellverband je Stufe; Stärke schwankt um ± spread. */
  cartelRaid: Counts[];
  cartelRaidSpread: number;
  /** Allianz-Einflusszone: Felder derselben Allianz mit Abstand ≤ zoneLinkKm sind verbunden. */
  zoneLinkKm: number;
  zoneMinFields: number;
  /** Ertragsbonus je Feld in einer Zone mit mindestens zoneMinFields Feldern. */
  zoneBonus: number;
  /** Allianzwertung: Punkte je Feld und Tag (Saisonbeitrag). */
  alliancePointsPerFieldDay: number;
}

export function fieldsOf(b: Balance): FieldsBalance | null {
  return (b as { fields?: FieldsBalance }).fields ?? null;
}

/** Höchstzahl eigener Felder nach Stufe der Hafenkommandantur. */
export function maxFieldsFor(harborLevel: number, balance: Balance): number {
  const f = fieldsOf(balance);
  if (!f || harborLevel <= 0) return 0;
  return Math.min(f.maxFields, f.maxFieldsBase + Math.floor(harborLevel / f.maxFieldsPerHarborLevels));
}

/** Ertragsfaktor des n-ten eigenen Felds (0-basiert); jenseits der Liste gilt der letzte Wert. */
export function yieldFactor(rank: number, balance: Balance): number {
  const list = fieldsOf(balance)?.yieldFactors ?? [1];
  return list[Math.min(Math.max(0, rank), list.length - 1)] ?? 1;
}

/** Grundertrag je Stunde eines Felds (Art, Stufe 1–3). */
export function fieldBaseYield(kind: string, tier: number, balance: Balance): ResourceMap {
  const k = fieldsOf(balance)?.kinds[kind];
  if (!k) return {};
  const v = k.yieldPerHour[Math.min(Math.max(1, tier), k.yieldPerHour.length) - 1] ?? 0;
  return { [k.resource]: v };
}

/** Ertrag über `hours` Stunden mit Rang (abnehmender Ertrag) und Zonenbonus; ganze Einheiten abgerundet. */
export function fieldYield(kind: string, tier: number, hours: number, rank: number, inZone: boolean, balance: Balance): ResourceMap {
  const f = fieldsOf(balance);
  const out: ResourceMap = {};
  if (!f || !(hours > 0)) return out;
  const factor = yieldFactor(rank, balance) * (inZone ? 1 + f.zoneBonus : 1);
  for (const [r, v] of Object.entries(fieldBaseYield(kind, tier, balance))) {
    const q = Math.floor(v * hours * factor);
    if (q > 0) out[r] = q;
  }
  return out;
}

/** Unterhalt (Proviant) eines Felds über `hours` Stunden. */
export function fieldUpkeep(tier: number, hours: number, balance: Balance): number {
  const list = fieldsOf(balance)?.upkeepProviantPerHour ?? [];
  const v = list[Math.min(Math.max(1, tier), Math.max(1, list.length)) - 1] ?? 0;
  return Math.max(0, v * hours);
}

/** Besatzung prüfen: nur Schiffe, mindestens eines bewaffnet, Kommandopunkte ≥ Mindestwert. Codes: field_ships_only, garrison_too_weak. */
export function garrisonCheck(units: Counts, balance: Balance): Result<{ commandPoints: number }> {
  const f = fieldsOf(balance);
  if (!f) return { ok: false, code: "no_fields" };
  let cp = 0;
  let armed = false;
  for (const [id, n] of Object.entries(units)) {
    if (n <= 0) continue;
    const d = balance.units[id];
    if (!d || d.branch !== "see") return { ok: false, code: "field_ships_only" };
    cp += (d.commandPoints ?? 0) * n;
    if (d.attack.see > 0) armed = true;
  }
  if (!armed || cp + 1e-9 < f.minGarrisonCommandPoints) return { ok: false, code: "garrison_too_weak" };
  return { ok: true, commandPoints: cp };
}

/**
 * Teilt einen siegreichen Verband in Besatzung und Heimkehrer. Die Besatzung ist die kleinste Auswahl bewaffneter
 * Schiffe (günstigste Kommandopunkte zuerst), die den Mindestwert erreicht; `all` = alles bleibt.
 * null, wenn die Überlebenden keine gültige Besatzung bilden.
 */
export function splitGarrison(survivors: Counts, all: boolean, balance: Balance): { garrison: Counts; rest: Counts } | null {
  const f = fieldsOf(balance);
  if (!f) return null;
  const ships = Object.entries(survivors).filter(([id, n]) => n > 0 && balance.units[id]?.branch === "see");
  const fleet = Object.fromEntries(ships);
  if (!garrisonCheck(fleet, balance).ok) return null;
  const rest: Counts = {};
  for (const [id, n] of Object.entries(survivors)) if (n > 0 && balance.units[id]?.branch !== "see") rest[id] = n;
  if (all) return { garrison: fleet, rest };
  // Kampfschiffe vor schwach bewaffneten (Landungsschiff, Minenleger), innerhalb davon günstigste Kommandopunkte zuerst.
  const weak = (id: string) => ((balance.units[id].attack.see ?? 0) < 3 * (balance.units[id].commandPoints ?? 1) ? 1 : 0);
  const order = ships
    .filter(([id]) => (balance.units[id].attack.see ?? 0) > 0)
    .sort((a, b) => weak(a[0]) - weak(b[0]) || (balance.units[a[0]].commandPoints ?? 0) - (balance.units[b[0]].commandPoints ?? 0) || a[0].localeCompare(b[0]));
  const garrison: Counts = {};
  let cp = 0;
  for (const [id, n] of order) {
    const per = balance.units[id].commandPoints ?? 0;
    for (let i = 0; i < n && cp + 1e-9 < f.minGarrisonCommandPoints; i++) {
      garrison[id] = (garrison[id] ?? 0) + 1;
      cp += per;
    }
  }
  for (const [id, n] of ships) {
    const left = n - (garrison[id] ?? 0);
    if (left > 0) rest[id] = (rest[id] ?? 0) + left;
  }
  return { garrison, rest };
}

/** Kartell-Wache eines neutralen Felds als Verteidiger. */
export function guardOf(tier: number, balance: Balance): Counts {
  const g = fieldsOf(balance)?.guard ?? [];
  return { ...(g[Math.min(Math.max(1, tier), Math.max(1, g.length)) - 1] ?? {}) };
}

export function guardDefender(units: Counts): DefenderInput {
  return { units: { ...units }, defenses: {} };
}

/** Würfel je Lieferzyklus: greift das Kartell an, und mit welchem Verband (Stärke ± spread)? */
export function cartelFieldRaid(tier: number, seed: number, balance: Balance): Counts | null {
  const f = fieldsOf(balance);
  if (!f) return null;
  const rng = mulberry32(seed);
  if (rng() >= f.cartelRaidChance) return null;
  const base = f.cartelRaid[Math.min(Math.max(1, tier), Math.max(1, f.cartelRaid.length)) - 1] ?? {};
  const k = 1 + (rng() * 2 - 1) * f.cartelRaidSpread;
  const out: Counts = {};
  for (const [id, n] of Object.entries(base)) out[id] = Math.max(1, Math.round(n * k));
  return out;
}

/**
 * Allianz-Einflusszonen: Felder derselben Allianz, die über Ketten mit Abstand ≤ zoneLinkKm verbunden sind.
 * Rückgabe: Feld-ID → Zone (kleinste Feld-ID der Zone) und Größe. Felder ohne Allianz bilden keine Zone.
 */
export function fieldZones(
  fields: { id: number; allianceId: number | null; at: GeoPoint }[],
  balance: Balance,
): Map<number, { zone: number; size: number; bonus: boolean }> {
  const f = fieldsOf(balance);
  const out = new Map<number, { zone: number; size: number; bonus: boolean }>();
  if (!f) return out;
  const list = fields.filter((x) => x.allianceId !== null).sort((a, b) => a.id - b.id);
  const parent = new Map<number, number>(list.map((x) => [x.id, x.id]));
  const find = (id: number): number => {
    let r = id;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(id, r);
    return r;
  };
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      if (list[i].allianceId !== list[j].allianceId) continue;
      if (distanceKm(list[i].at, list[j].at) > f.zoneLinkKm) continue;
      const a = find(list[i].id), b = find(list[j].id);
      if (a !== b) parent.set(Math.max(a, b), Math.min(a, b));
    }
  }
  const size = new Map<number, number>();
  for (const x of list) size.set(find(x.id), (size.get(find(x.id)) ?? 0) + 1);
  for (const x of list) {
    const z = find(x.id);
    const n = size.get(z)!;
    out.set(x.id, { zone: z, size: n, bonus: n >= f.zoneMinFields });
  }
  return out;
}
