// Missionsplanung von überall öffnen („Wiederholen“ an Berichten und heimgekehrten Missionen).
// App.tsx hört auf die Anfrage und öffnet die Planung mit Ziel und Zusammensetzung.
import { useEffect, useRef } from "react";
import type { Target } from "../App.tsx";

export type PlanType = "ueberfall" | "aufklaerung" | "transport";

export interface PlanPreset {
  type?: PlanType;
  /** Gewünschte Zusammensetzung; die Planung kürzt auf die Einheiten daheim. */
  units?: Record<string, number>;
}

export interface PlanRequest extends PlanPreset {
  target: Target | null;
}

const EVENT = "tf-plan";

export function requestPlan(r: PlanRequest): void {
  window.dispatchEvent(new CustomEvent<PlanRequest>(EVENT, { detail: r }));
}

export function usePlanRequests(onRequest: (r: PlanRequest) => void): void {
  const cb = useRef(onRequest);
  cb.current = onRequest;
  useEffect(() => {
    const h = (e: Event) => cb.current((e as CustomEvent<PlanRequest>).detail);
    window.addEventListener(EVENT, h);
    return () => window.removeEventListener(EVENT, h);
  }, []);
}

export function isPlanType(t: string | null | undefined): t is PlanType {
  return t === "ueberfall" || t === "aufklaerung" || t === "transport";
}

/** Kürzt eine Zusammensetzung auf die Einheiten daheim; short: gekürzte Typen. */
export function fitUnits(wanted: Record<string, number>, home: Record<string, number>) {
  const units: Record<string, number> = {};
  const short: { id: string; wanted: number; available: number }[] = [];
  for (const [id, n] of Object.entries(wanted)) {
    const available = Math.max(0, Math.floor(home[id] ?? 0));
    const k = Math.min(n, available);
    if (k > 0) units[id] = k;
    if (k < n) short.push({ id, wanted: n, available });
  }
  return { units, short };
}
