// Lage „Nächster lohnender Besuch“ (UX-0.43 B8, L-5/W-4): wann sich das Wiederkommen lohnt – die früheste anstehende
// Gelegenheit, zu handeln, und was in den folgenden VISIT_GROUP_MS dazukommt („13:52 · Verband zurück, Bauhof frei“).
// Anlässe: Bauhof frei (letzter Ausbau eines Hafens fertig), Ausbildung fertig, Forschung fertig, Verband am Ziel bzw.
// zurück, Lager voll (Rohstoff erreicht die Lagergrenze), nächste Seerat-Sitzung. „Erinnern“ setzt die Oberfläche um
// (Push zur Zeit über lage-remind.ts, sonst Kalenderdatei). Rechnet nur aus schon geladenen Zeilen und dem Hafenstand.
import { and, asc, eq, gt } from "drizzle-orm";
import { productionRates, settle, storageCapacity, type Modifiers } from "@tidefront/game-core";
import { tables, type DbOrTx } from "@tidefront/db";
import { balance } from "./context.ts";
import type { BaseRow } from "./store.ts";
import { nameOf } from "./names.ts";
import { HOUR_MS, type LageRow } from "./lage-types.ts";

/** Anlässe, die so dicht nach dem ersten liegen, gehören zum selben Besuch. */
export const VISIT_GROUP_MS = 20 * 60_000;
/** Weiter voraus wird kein Besuch vorgeschlagen. */
export const VISIT_HORIZON_MS = 36 * HOUR_MS;
/** Frühestens so weit in der Zukunft (sonst ist es schon „jetzt“ und steht unter „Wartet auf dich“). */
export const VISIT_MIN_MS = 60_000;

export interface VisitReason { atMs: number; text: string }
export interface LageVisit {
  atMs: number;
  /** Anlässe in Reihenfolge, ohne Doppelte (z. B. „Verband zurück“, „Bauhof frei“). */
  reasons: string[];
}

/** Frühester Anlass im Fenster und alle Anlässe bis VISIT_GROUP_MS danach (rein). */
export function pickVisit(cands: readonly VisitReason[], nowMs: number): LageVisit | null {
  const ok = cands.filter((c) => c.atMs >= nowMs + VISIT_MIN_MS && c.atMs <= nowMs + VISIT_HORIZON_MS).sort((a, b) => a.atMs - b.atMs);
  if (ok.length === 0) return null;
  const first = ok[0].atMs;
  const group = ok.filter((c) => c.atMs <= first + VISIT_GROUP_MS);
  return { atMs: first, reasons: [...new Set(group.map((c) => c.text))] };
}

/** Wann erreicht ein Rohstoff die Lagergrenze? null, wenn er nicht steigt oder schon voll ist (rein). */
export function fullAtMs(amount: number, cap: number, perHour: number, nowMs: number): number | null {
  if (!(perHour > 0) || amount >= cap) return null;
  return nowMs + ((cap - amount) / perHour) * HOUR_MS;
}

const ROW_TEXT: Record<string, string> = { rueckkehr: "Verband zurück", ankunft: "Verband am Ziel" };

/** Anlässe aus dem Hafenstand und den Lagezeilen (soon vor dem 24-h-Schnitt). */
export async function visitCandidates(db: DbOrTx, bases: BaseRow[], mods: Map<number, Modifiers>, soon: readonly LageRow[], nowMs: number): Promise<VisitReason[]> {
  const out: VisitReason[] = [];
  for (const b of bases) {
    const last = b.state.buildQueue.reduce((m, o) => Math.max(m, o.finishesAt), 0);
    if (last > 0) out.push({ atMs: last, text: "Bauhof frei" });
    for (const o of b.state.trainingQueue) out.push({ atMs: o.finishesAt, text: "Ausbildung fertig" });
    const r = b.isHome ? b.state.research?.order : null;
    if (r) out.push({ atMs: r.finishesAt, text: "Forschung fertig" });
    const st = settle(b.state, nowMs, balance, mods.get(b.id));
    const cap = storageCapacity(st, balance, mods.get(b.id));
    const rates = productionRates(st, balance, mods.get(b.id), nowMs).perHour;
    let best: { at: number; res: string } | null = null;
    for (const res of balance.resources) {
      const at = fullAtMs(st.resources[res] ?? 0, cap, rates[res] ?? 0, nowMs);
      if (at !== null && (!best || at < best.at)) best = { at, res };
    }
    if (best) out.push({ atMs: best.at, text: `Lager voll (${nameOf(best.res)})` });
  }
  for (const row of soon) if (ROW_TEXT[row.kind] && row.atMs !== null) out.push({ atMs: row.atMs, text: ROW_TEXT[row.kind] });
  const t = tables.seeratSitzung;
  const [next] = await db.select({ opensAt: t.opensAt }).from(t).where(and(eq(t.status, "geplant"), gt(t.opensAt, new Date(nowMs)))).orderBy(asc(t.opensAt)).limit(1);
  if (next) out.push({ atMs: next.opensAt.getTime(), text: "Seerat tagt" });
  return out;
}
