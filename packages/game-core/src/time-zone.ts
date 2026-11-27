// Spielzeitzone (TE-07, Abschlussprüfung 0.38): eine einzige Quelle für Tageswechsel, Uhrzeiten in Meldungen und
// Mails. TZ der Umgebung (Server), wenn sie ein gültiger IANA-Name ist; sonst Europe/Berlin. Werte wie
// ":/etc/localtime" (POSIX-Form, Intl kennt sie nicht und wirft RangeError) fallen auf die Vorgabe zurück.

/** Vorgabe, wenn TZ fehlt oder unbrauchbar ist. */
export const DEFAULT_GAME_TIME_ZONE = "Europe/Berlin";

let cache: { raw: string | undefined; tz: string } | null = null;

/** Gültiger IANA-Zeitzonenname, den Intl kennt? */
function usable(tz: string | undefined): tz is string {
  if (!tz || tz.startsWith(":") || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Spielzeitzone: TZ der Umgebung, sonst Europe/Berlin (Ergebnis je TZ-Wert zwischengespeichert). */
export function gameTimeZone(): string {
  const raw = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.TZ;
  if (cache && cache.raw === raw) return cache.tz;
  const tz = usable(raw) ? raw : DEFAULT_GAME_TIME_ZONE;
  cache = { raw, tz };
  return tz;
}
