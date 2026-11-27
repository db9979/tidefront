// Admin-Kennzahlen: Laufzeit je tRPC-Prozedur, nur im Speicher des API-Prozesses (Ringpuffer der letzten
// RPC_RING Messungen je Prozedur). Gemessen per Middleware in apps/api/src/trpc.ts; nach einem Neustart leer.

/** Messungen je Prozedur im Ringpuffer. */
export const RPC_RING = 256;
/** Obergrenze verschiedener Prozeduren (Schutz gegen unbegrenztes Wachstum). */
export const RPC_MAX_PATHS = 500;

interface Ring {
  buf: Float64Array;
  /** Nächste Schreibposition. */
  next: number;
  /** Belegte Plätze (höchstens RPC_RING). */
  size: number;
  /** Aufrufe seit Start des Prozesses. */
  count: number;
  errors: number;
}

const rings = new Map<string, Ring>();
let since = Date.now();

export function recordRpc(path: string, ms: number, ok = true): void {
  if (!Number.isFinite(ms) || ms < 0) return;
  let r = rings.get(path);
  if (!r) {
    if (rings.size >= RPC_MAX_PATHS) return;
    r = { buf: new Float64Array(RPC_RING), next: 0, size: 0, count: 0, errors: 0 };
    rings.set(path, r);
  }
  r.buf[r.next] = ms;
  r.next = (r.next + 1) % RPC_RING;
  r.size = Math.min(RPC_RING, r.size + 1);
  r.count++;
  if (!ok) r.errors++;
}

/** Perzentil nach dem Nearest-Rank-Verfahren aus aufsteigend sortierten Werten (leer: 0). */
export function percentile(sorted: ArrayLike<number>, q: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil(q * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

export interface RpcTiming {
  path: string;
  /** Aufrufe seit Prozessstart. */
  count: number;
  errors: number;
  /** Messungen im Ringpuffer (Grundlage der Perzentile). */
  samples: number;
  p50: number;
  p95: number;
  max: number;
}

const r1 = (v: number) => Math.round(v * 10) / 10;

/** Laufzeiten je Prozedur, langsamste (p95) zuerst. */
export function rpcTimings(): { since: string; rows: RpcTiming[] } {
  const rows: RpcTiming[] = [];
  for (const [path, r] of rings) {
    const xs = Float64Array.from(r.buf.subarray(0, r.size)).sort();
    rows.push({ path, count: r.count, errors: r.errors, samples: r.size, p50: r1(percentile(xs, 0.5)), p95: r1(percentile(xs, 0.95)), max: r1(xs[xs.length - 1] ?? 0) });
  }
  rows.sort((a, b) => b.p95 - a.p95 || b.count - a.count || a.path.localeCompare(b.path));
  return { since: new Date(since).toISOString(), rows };
}

export function resetRpcTimings(): void {
  rings.clear();
  since = Date.now();
}
