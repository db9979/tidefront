// Lagezentrum: was der Spieler beim letzten Öffnen gesehen hat (Gerät). Neue Einträge werden markiert, die Zahl am
// Navigationszeichen zählt nur Dringendes, das seitdem dazugekommen ist (Angriffe zählen immer, bis sie vorbei sind).
import { useEffect, useState } from "react";

const KEY = "tf-lage-seen-v1";
const EVENT = "tf-lage-seen";

export interface LageSeen { keys: string[]; atMs: number }

export function readLageSeen(): LageSeen | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as LageSeen) : null;
  } catch { return null; }
}

export function writeLageSeen(keys: string[], atMs: number): void {
  try { localStorage.setItem(KEY, JSON.stringify({ keys: [...new Set(keys)].slice(0, 500), atMs })); } catch { /* voll */ }
  window.dispatchEvent(new Event(EVENT));
}

/** Gesehene Schlüssel, aktualisiert sich beim Öffnen der Lage (auch in anderen Teilen der Oberfläche). */
export function useLageSeen(): Set<string> {
  const [seen, setSeen] = useState(() => new Set(readLageSeen()?.keys ?? []));
  useEffect(() => {
    const on = () => setSeen(new Set(readLageSeen()?.keys ?? []));
    window.addEventListener(EVENT, on);
    window.addEventListener("storage", on);
    return () => { window.removeEventListener(EVENT, on); window.removeEventListener("storage", on); };
  }, []);
  return seen;
}
