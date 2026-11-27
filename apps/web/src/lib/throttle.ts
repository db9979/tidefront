// Ratenbegrenzung (HTTP 429, TOO_MANY_REQUESTS) bemerken: Ladeanzeigen zeigen dann einen Hinweis mit „Erneut
// versuchen“ statt endlos „Lädt …“. Merkt nur den Zeitpunkt der letzten Drosselung (im Speicher).
import { useEffect, useSyncExternalStore } from "react";
import { queryClient } from "./trpc.ts";

let lastAt = 0;
const subs = new Set<() => void>();
const notify = () => { for (const f of subs) f(); };

export function isThrottled(err: unknown): boolean {
  return (err as { data?: { code?: string } | null } | null)?.data?.code === "TOO_MANY_REQUESTS";
}

let wired = false;
function wire() {
  if (wired) return;
  wired = true;
  queryClient.getQueryCache().subscribe((e) => {
    if (e.type !== "updated") return;
    if (e.action.type === "error" && isThrottled(e.action.error)) { lastAt = Date.now(); notify(); }
    else if (e.action.type === "success" && lastAt) { lastAt = 0; notify(); }
  });
}

/** Zeitpunkt der letzten Drosselung (0 = keine offene). */
export function useThrottled(): number {
  useEffect(wire, []);
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => lastAt);
}

/** Alle sichtbaren Abfragen ohne Daten oder mit Fehler neu laden. */
export function retryFailed(): void {
  lastAt = 0;
  notify();
  void queryClient.refetchQueries({ type: "active", predicate: (q) => q.state.status === "error" || q.state.data === undefined });
}
