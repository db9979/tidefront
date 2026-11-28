// Weltpolitik Stufe 2: Sturmzeit im Wetterfeld (docs/REGELN-WELTPOLITIK.md, Abschnitt 2). Eine Sturmzeit verschiebt nur
// die Sturmschwelle (weather.stormFrom 0,8 → 0,7) und verstärkt den Wind der Tiefs (Sturmstärke) – nie systemEveryHours:
// Die Wettersysteme bleiben dieselben, Karte und Vorhersage springen nicht. Die Fenster kommen aus dem Saisonplan
// (stormWindowsOf); Server (politik-core) und Oberfläche (meta) tragen sie hier ein, damit jede Wetterabfrage zu jedem
// Zeitpunkt (Route, Kampf, Vorhersage, Karte) dasselbe rechnet. Ohne Eintrag ist das Wetter unverändert.

export interface StormWindow {
  startMs: number;
  endMs: number;
  /** Sturmschwelle im Fenster (absolut). */
  stormFrom: number;
  /** Faktor auf den Wind der Tiefs. */
  strength: number;
}

let windows: StormWindow[] = [];
let baseStormFrom: number | null = null;
let version = 0;

/** Sturmzeit-Fenster eintragen (ersetzt die bisherigen); base = Sturmschwelle der Grundbalance. */
export function setStormWindows(list: readonly StormWindow[], base: number | null = null): void {
  const next = [...list].sort((a, b) => a.startMs - b.startMs);
  const same = next.length === windows.length && next.every((w, i) => {
    const o = windows[i];
    return o.startMs === w.startMs && o.endMs === w.endMs && o.stormFrom === w.stormFrom && o.strength === w.strength;
  });
  baseStormFrom = base;
  if (same) return;
  windows = next;
  version++;
}

/** Eingetragene Fenster (Anzeige, Tests). */
export function stormWindows(): readonly StormWindow[] {
  return windows;
}

/** Sturmzeit zum Zeitpunkt ms (Beginn eingeschlossen, Ende ausgeschlossen), sonst null. */
export function stormAt(ms: number): StormWindow | null {
  for (const w of windows) if (w.startMs <= ms && ms < w.endMs) return w;
  return null;
}

/** Sturmschwelle zum Zeitpunkt ms: im Fenster dessen Wert, sonst die Grundschwelle. */
export function stormFromAt(wb: { stormFrom: number }, ms: number): number {
  return stormAt(ms)?.stormFrom ?? baseStormFrom ?? wb.stormFrom;
}

/** Schlüsselteil für Zwischenspeicher des Wetterfelds (ändert sich mit den Fenstern). */
export function stormKey(ms: number): string {
  const w = stormAt(ms);
  return w ? `s${version}:${w.strength}` : "";
}
