// Zwischenspeicher der geteilten Weltdaten für world.map (Häfen aller Spieler mit Zustand). Viele Ereignisse melden
// "map" an alle Spieler; die Clients laden dann (gestreut) neu. Ohne Zwischenspeicher liest jede dieser Abfragen alle
// Häfen. Mit ihm liest nur die erste innerhalb von ttlMs, die übrigen filtern pro Spieler auf denselben Daten
// (Sichtlogik in intel-map.ts bleibt unverändert, der Speicher ist nur eine Hülle um die Datenbeschaffung).
// Jede Kartenmeldung (bumpMapGeneration, API main.ts beim Empfang über Valkey) macht den Speicher sofort ungültig,
// damit eigene Änderungen nicht bis zu ttlMs verspätet erscheinen. Aus (Vorgabe, z. B. in Tests): direkt lesen.

let ttlMs = 0;
let generation = 0;
let entry: { gen: number; atMs: number; data: Promise<unknown> } | null = null;

/** API: Zwischenspeicher einschalten (ttlMs > 0) oder aus (0). */
export function enableMapCache(ms: number): void {
  ttlMs = Math.max(0, ms);
  entry = null;
}

/** Kartenmeldung empfangen: zwischengespeicherte Weltdaten verwerfen. */
export function bumpMapGeneration(): void {
  generation++;
  entry = null;
}

/** Geteilte Weltdaten über den Speicher holen; load() liest aus der Datenbank. Die Daten nicht verändern. */
export async function cachedWorld<T>(load: () => Promise<T>, nowMs = Date.now()): Promise<T> {
  if (ttlMs <= 0) return load();
  if (entry && entry.gen === generation && nowMs - entry.atMs < ttlMs) return entry.data as Promise<T>;
  const mine = { gen: generation, atMs: nowMs, data: load() as Promise<unknown> };
  entry = mine;
  // Fehler nicht zwischenspeichern.
  mine.data.catch(() => { if (entry === mine) entry = null; });
  return mine.data as Promise<T>;
}
