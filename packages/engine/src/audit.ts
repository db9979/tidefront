// Prüflauf: Journal der Börse gegen Talerstände und offene Lieferungen.
import { eq, sql } from "drizzle-orm";
import { tables } from "@tidefront/db";
import type { Engine } from "./context.ts";
import { pruneMarketNews } from "./market-news.ts";

export interface AuditResult {
  ok: boolean;
  unbalancedTrades: { tradeId: string; asset: string; sum: string }[];
  creditMismatches: { playerId: number; ledger: string; state: number }[];
  deliveryMismatches: { id: string; ledger: string; expected: number }[];
  /** Handel zwischen Spielern: Treuhand je Angebot (offen: Menge, sonst 0). */
  escrowMismatches: { offerId: number; ledger: string; expected: number }[];
}

export async function auditLedger(engine: Engine): Promise<AuditResult> {
  const unbalanced = await engine.db.execute<{ trade_id: string; asset: string; sum: string }>(sql`
    select trade_id, asset, sum(amount)::text as sum from trade_ledger
    group by trade_id, asset having sum(amount) <> 0 limit 50`);
  const ledgerCredits = await engine.db.execute<{ account: string; sum: string }>(sql`
    select account, sum(amount)::text as sum from trade_ledger
    where asset = 'credits' and account like 'player:%' group by account`);
  const byPlayer = new Map(ledgerCredits.map((r) => [Number(r.account.slice(7)), r.sum]));
  const players = await engine.db.select({ id: tables.player.id, trader: tables.player.trader }).from(tables.player);
  const creditMismatches: AuditResult["creditMismatches"] = [];
  for (const p of players) {
    const state = (p.trader as { credits: number }).credits;
    const ledger = byPlayer.get(p.id) ?? "0";
    if (Math.round(Number(ledger) * 100) !== Math.round(state * 100)) creditMismatches.push({ playerId: p.id, ledger, state });
  }
  const deliveries = await engine.db.execute<{ id: string; qty: number; status: string; sum: string | null }>(sql`
    select d.id, d.qty, d.status, (select sum(amount)::text from trade_ledger l where l.account = 'delivery:' || d.id) as sum
    from delivery d`);
  const deliveryMismatches: AuditResult["deliveryMismatches"] = [];
  for (const d of deliveries) {
    const expected = d.status === "underway" ? d.qty : 0;
    if (Number(d.sum ?? 0) !== expected) deliveryMismatches.push({ id: d.id, ledger: d.sum ?? "0", expected });
  }
  const offers = await engine.db.execute<{ id: number; give_qty: number; status: string; sum: string | null }>(sql`
    select o.id, o.give_qty, o.status, (select sum(amount)::text from trade_ledger l where l.account = 'escrow:po-' || o.id) as sum
    from player_offer o`);
  const escrowMismatches: AuditResult["escrowMismatches"] = [];
  for (const o of offers) {
    const expected = o.status === "open" ? Number(o.give_qty) : 0;
    if (Number(o.sum ?? 0) !== expected) escrowMismatches.push({ offerId: o.id, ledger: o.sum ?? "0", expected });
  }
  const result: AuditResult = {
    ok: unbalanced.length === 0 && creditMismatches.length === 0 && deliveryMismatches.length === 0 && escrowMismatches.length === 0,
    unbalancedTrades: unbalanced.map((r) => ({ tradeId: r.trade_id, asset: r.asset, sum: r.sum })),
    creditMismatches,
    deliveryMismatches,
    escrowMismatches,
  };
  await engine.db.insert(tables.auditRun).values({ ok: result.ok ? 1 : 0, details: result });
  return result;
}

/** Abgelaufene Wracks, Sitzungen, erledigte Ereignisse, alte Prüfläufe und ausgeklungene Marktnachrichten entfernen. */
export async function cleanup(engine: Engine, nowMs: number, wreckHours: number): Promise<void> {
  await engine.db.execute(sql`delete from wreck where created_at < ${new Date(nowMs - wreckHours * 3600000).toISOString()}::timestamptz`);
  await engine.db.execute(sql`delete from session where expires_at < now()`);
  await engine.db.execute(sql`delete from command_log where created_at < now() - interval '7 days'`);
  await engine.db.execute(sql`delete from game_event where status = 'done' and processed_at < now() - interval '3 days'`);
  // Prüfläufe (alle 10 min eine Zeile): 14 Tage aufheben, den jüngsten immer (Betriebsstatus ops.ts).
  await engine.db.execute(sql`delete from audit_run where created_at < now() - interval '14 days' and id < (select max(id) from audit_run)`);
  // Marktnachrichten: seit 48 h ausgeklungene Zeilen löschen (Hotfix 0.38.1, AN-02).
  await pruneMarketNews(engine.db, nowMs);
  void eq;
}
