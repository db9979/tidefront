// Anbindung an den Simulator-Worker (sim.worker.ts): je Aufgabe ein Worker („win“, „plans“), Antworten über eine
// laufende Nummer; Abbrechen beendet nur den Worker dieser Aufgabe.
// Ohne Worker (alte Browser) rechnet der Haupt-Thread nach einem Takt – langsamer, aber gleiches Ergebnis.
import type { WinSearchInput, WinSearchResult } from "@tidefront/game-core";
import type { Balance } from "./trpc.ts";
import type { NestPlan, PlanJob } from "./raid-plan.ts";

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; progress?: (p: number) => void };

type Lane = { worker: Worker | null; pending: Map<number, Pending> };
const lanes: Record<"win" | "plans", Lane> = { win: { worker: null, pending: new Map() }, plans: { worker: null, pending: new Map() } };
let seq = 0;

function getWorker(lane: Lane): Worker | null {
  if (lane.worker) return lane.worker;
  if (typeof Worker === "undefined") return null;
  let worker: Worker;
  try {
    worker = new Worker(new URL("./sim.worker.ts", import.meta.url), { type: "module" });
  } catch {
    return null;
  }
  lane.worker = worker;
  const pending = lane.pending;
  worker.onmessage = (e: MessageEvent<{ id: number; progress?: number; result?: unknown; error?: string }>) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    if (e.data.progress !== undefined) return p.progress?.(e.data.progress);
    pending.delete(e.data.id);
    if (e.data.error) p.reject(new Error(e.data.error));
    else p.resolve(e.data.result);
  };
  worker.onerror = (e) => {
    for (const p of pending.values()) p.reject(new Error(e.message || "worker"));
    pending.clear();
    worker.terminate();
    lane.worker = null;
  };
  return worker;
}

/**
 * cancel: Antwort verwerfen (der Worker rechnet zu Ende, sein nächster Auftrag wartet so lange); abort: zusätzlich den
 * Worker beenden („Abbrechen“ einer langen Suche). Beim Abbau einer Ansicht nur cancel – React baut im Entwicklungsmodus
 * Effekte doppelt auf, ein beendeter Worker müsste jedes Mal neu laden.
 */
function call<T>(name: "win" | "plans", msg: Record<string, unknown>, progress?: (p: number) => void, fallback?: () => Promise<T>): { promise: Promise<T>; cancel: () => void; abort: () => void } {
  const lane = lanes[name];
  const pending = lane.pending;
  const w = getWorker(lane);
  if (!w) {
    const promise = new Promise<T>((resolve, reject) => setTimeout(() => fallback!().then(resolve, reject), 0));
    return { promise, cancel: () => {}, abort: () => {} };
  }
  const id = ++seq;
  const promise = new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject, progress });
    w.postMessage({ ...msg, id });
  });
  const cancel = () => {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    p.reject(new Error("cancelled"));
  };
  const abort = () => {
    cancel();
    for (const p of pending.values()) p.reject(new Error("cancelled"));
    pending.clear();
    lane.worker?.terminate();
    lane.worker = null;
  };
  return { promise, cancel, abort };
}

/** „Was fehlt zum Sieg?“ im Worker, mit Fortschritt (0…1). */
export function runWinSearch(input: WinSearchInput, balance: Balance, progress: (p: number) => void) {
  return call<WinSearchResult>("win", { kind: "win", input, balance }, progress, async () => {
    const { searchWinningForce } = await import("@tidefront/game-core");
    return searchWinningForce(input, balance as never, progress);
  });
}

/** Vorschläge für „Lohnende Ziele“ im Worker. */
export function runPlans(jobs: PlanJob[], balance: Balance) {
  return call<{ key: string; plan: NestPlan }[]>("plans", { kind: "plans", jobs, balance }, undefined, async () => {
    const { planNestRaid } = await import("./raid-plan.ts");
    return jobs.map((j) => ({ key: j.key, plan: planNestRaid(j.full, j.level, balance, j.opts) }));
  });
}
