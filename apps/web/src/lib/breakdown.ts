// Wertaufschlüsselung für Info-Blätter: effektiver Wert = Grundwert × Faktoren je Quelle (Forschung, Veteranen, …).
// Die Quellen kommen getrennt vom Server (base.modifierSources); hier wird nur angezeigt, gerechnet wird im Server.
// Beispiel: „Angriff See 40 → 46“ mit „Grundwert 40 · Forschung +10 % · Veteranen +5 %“.
import type { Balance, BaseData } from "./trpc.ts";
import { fmtNum } from "./names.ts";
import { modFactor, pctText } from "./research.ts";

export type Sources = BaseData["modifierSources"];

export interface BreakdownRow {
  label: string;
  base: number;
  value: number;
  /** Anzeige von Grund- und Endwert (z. B. mit Einheit „km/h“). */
  unit?: string;
  /** Teile: „Grundwert 40“, „Forschung +10 %“, … */
  parts: string[];
}

/** Faktor einer Quelle als Produkt über mehrere Pfade (z. B. attack.see × attackVs.see × attackUnit.korvette). */
function sourceFactor(mods: Sources[number]["mods"], paths: string[]): number {
  return paths.reduce((f, p) => f * modFactor(mods, p), 1);
}

/** Eine Zeile: Grundwert, Faktoren der Quellen, die wirken; null, wenn der Grundwert 0 ist. */
export function breakdownRow(label: string, base: number, sources: Sources | undefined, paths: string[], unit?: string, digits = 0): BreakdownRow | null {
  if (!(base > 0)) return null;
  const parts = [`Grundwert ${fmtNum(base, digits)}`];
  let value = base;
  for (const s of sources ?? []) {
    const f = sourceFactor(s.mods, paths);
    if (Math.abs(f - 1) < 1e-9) continue;
    value *= f;
    parts.push(`${s.label} ${pctText(f)}`);
  }
  return { label, base, value, unit, parts };
}

/** Text „40 → 46“ bzw. „40“ ohne Änderung. */
export function rowValue(r: BreakdownRow, digits = 0): string {
  const u = r.unit ? ` ${r.unit}` : "";
  return Math.abs(r.value - r.base) < 1e-9 ? `${fmtNum(r.base, digits)}${u}` : `${fmtNum(r.base, digits)} → ${fmtNum(r.value, digits)}${u}`;
}

const KEY_LABEL: Record<string, string> = { see: "See", luft: "Luft", land: "Land", anlage: "Anlagen", uboot: "U-Jagd" };

/** Kampf- und Reisewerte einer Einheit oder Anlage mit Aufschlüsselung (nur Werte, die wirken oder > 0 sind). */
export function unitBreakdown(balance: Balance, sources: Sources | undefined, id: string): BreakdownRow[] {
  const u = balance.units[id];
  const d = balance.defenses[id];
  const branch = d ? "anlage" : u?.branch ?? "";
  const a = (u?.attack ?? d?.attack ?? {}) as Record<string, number | undefined>;
  const rows: (BreakdownRow | null)[] = [breakdownRow("Lebenspunkte", u?.hp ?? d?.hp ?? 0, sources, [`hp.${branch}`])];
  for (const k of ["see", "luft", "land", "anlage", "uboot"]) {
    const name = k === "uboot" ? "U-Jagd" : `Angriff ${KEY_LABEL[k]}`;
    rows.push(breakdownRow(name, a[k] ?? 0, sources, [`attack.${branch}`, `attackVs.${k}`, `attackUnit.${id}`]));
  }
  if (u?.speedKmh) rows.push(breakdownRow("Tempo", u.speedKmh, sources, [`speed.${branch}`], "km/h"));
  if (u?.cargo) rows.push(breakdownRow("Ladung", u.cargo, sources, ["cargo"]));
  if (u?.fuelPer100Km) rows.push(breakdownRow("Treibstoff je 100 km", u.fuelPer100Km, sources, ["fuel"], undefined, 1));
  return rows.filter((r): r is BreakdownRow => r !== null);
}

/** Wirkung eines Gebäudes auf Stufe L mit Aufschlüsselung (Produktion, Lager, Bunker, Radar, Ausbildung). */
export function buildingBreakdown(balance: Balance, sources: Sources | undefined, id: string, level: number): BreakdownRow[] {
  const def = balance.buildings[id];
  if (!def || level < 1) return [];
  const rows: (BreakdownRow | null)[] = [];
  if (def.produces && def.perHour) {
    rows.push(breakdownRow("Produktion je Stunde", def.perHour * balance.building.productionGrowth ** (level - 1), sources, [`production.${def.produces}`]));
  }
  if (def.capacityBase) rows.push(breakdownRow("Lager je Ressource", def.capacityBase * (def.capacityGrowth ?? 1) ** level, sources, ["storage"]));
  if (def.protectedBase) rows.push(breakdownRow("Geschützt je Ressource", def.protectedBase * (def.protectedGrowth ?? 1) ** level, sources, ["bunker"]));
  if (def.warningMinutesBase !== undefined) {
    rows.push(breakdownRow("Vorwarnzeit", def.warningMinutesBase + (def.warningMinutesPerLevel ?? 0) * level, sources, ["radarWarning"], "min", 1));
  }
  if (["werft", "kaserne", "flugfeld"].includes(id)) rows.push(breakdownRow("Ausbildungszeit (Faktor)", 100, sources, [`trainingTime.${id}`], "%"));
  return rows.filter((r): r is BreakdownRow => r !== null);
}
