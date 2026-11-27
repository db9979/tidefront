// Lieferverträge (v1.31): Kündigung vor Fälligkeit (auch in der Nachfrist). Für den gekündigten Teil verfällt
// penaltyShare seines Werts aus der Sicherheit der kündigenden Seite (an die KI bzw. bei Spielerverträgen in den
// Gebührentopf); der Rest und die Sicherheit der Gegenseite gehen zurück (Treuhandware der KI in ihr Lager).
// Ein Abo wird ganz gekündigt (alle noch offenen Tranchen).
import { and, eq, inArray } from "drizzle-orm";
import { deliverCargo, market as marketCore } from "@tidefront/game-core";
import { tables } from "@tidefront/db";
import { balance, type Engine } from "./context.ts";
import { runCommand, type Ctx } from "./commands.ts";
import { homeBaseOf, lockBases, readBase, saveBase } from "./store.ts";
import { systemMessage } from "./alliance-core.ts";
import { fmtInt, nameOf } from "./names.ts";
import { cfgOrFail, escrowAccount, fail, journal, lockTraders, playerAcc, RUNNING, saveTrader, withCredits, type ContractRow, type Line } from "./contracts-core.ts";
import { kiOf } from "./contracts-run.ts";

/** Strafe einer Kündigung durch playerId (Cent), für Anzeige und Abwicklung. */
export function cancelPenalty(c: ContractRow, playerId: number): number {
  const cfg = cfgOrFail();
  const buyer = c.buyerId === playerId;
  return marketCore.cancelPenaltyCents(c.qty, buyer ? c.buyerUnit : c.sellerUnit, cfg.penaltyShare, buyer ? c.buyerDepositCents : c.sellerPledgeCents);
}

/** Laufenden Vertrag (bzw. ein ganzes Abo) kündigen. Codes: contract_gone, no_rights. */
export function cancelContract(engine: Engine, playerId: number, key: string, contractId: number) {
  return runCommand<{ ok: true; penaltyCredits: number; cancelled: number }>(engine, playerId, key, "contractCancel", async (ctx: Ctx) => {
    const { tx, nowMs } = ctx;
    const [first] = await tx.select().from(tables.marketContract).where(eq(tables.marketContract.id, contractId)).for("update");
    if (!first || !RUNNING.includes(first.status)) fail("contract_gone");
    const ki = kiOf(first);
    if ((first.buyerId !== playerId && first.sellerId !== playerId) || playerId === ki) fail("no_rights");
    const rows = first.aboId === null ? [first] : await tx.select().from(tables.marketContract)
      .where(and(eq(tables.marketContract.aboId, first.aboId), inArray(tables.marketContract.status, RUNNING))).orderBy(tables.marketContract.id).for("update");
    // Treuhandware einer KI-Verkäuferin geht zurück in ihr Lager.
    const kiSeller = ki !== null && first.sellerId === ki;
    let kiBase = null;
    if (kiSeller) {
      const row = (first.sellerBaseId !== null ? await readBase(tx, first.sellerBaseId) : null) ?? (await homeBaseOf(tx, ki));
      if (row && row.playerId === ki) kiBase = (await lockBases(tx, [row.id])).get(row.id) ?? null;
    }
    const other = first.buyerId === playerId ? first.sellerId : first.buyerId;
    const traders = await lockTraders(tx, [playerId, ...(other !== null ? [other] : [])]);
    const credit = new Map<number, number>();
    const add = (id: number, v: number) => credit.set(id, (credit.get(id) ?? 0) + v);
    let penaltyTotal = 0;
    let goodsBack = 0;
    for (const c of rows) {
      const iBuy = c.buyerId === playerId;
      const security = iBuy ? c.buyerDepositCents : c.sellerPledgeCents;
      const pen = cancelPenalty(c, playerId);
      const otherSecurity = iBuy ? c.sellerPledgeCents : c.buyerDepositCents;
      const lines: Line[] = [
        [escrowAccount(c.id), "credits", -(c.buyerDepositCents + c.sellerPledgeCents)],
        [playerAcc(playerId), "credits", security - pen],
        [ki !== null ? playerAcc(ki) : "fees", "credits", pen],
      ];
      add(playerId, security - pen);
      if (ki !== null) add(ki, pen);
      if (other !== null && otherSecurity > 0) {
        lines.push([playerAcc(other), "credits", otherSecurity]);
        add(other, otherSecurity);
      }
      if (c.escrowQty > 0) {
        lines.push([escrowAccount(c.id), c.resource, -c.escrowQty], [playerAcc(c.sellerId!), c.resource, c.escrowQty]);
        goodsBack += c.escrowQty;
      }
      await journal(tx, `mc-${c.id}:cancel`, nowMs, lines);
      await tx.update(tables.marketContract).set({
        status: "gekuendigt", closedAt: new Date(nowMs), buyerPenaltyCents: iBuy ? pen : 0, sellerPenaltyCents: iBuy ? 0 : pen,
      }).where(eq(tables.marketContract.id, c.id));
      penaltyTotal += pen;
    }
    if (kiBase && goodsBack > 0) await saveBase(tx, kiBase.id, deliverCargo(kiBase.state, { [first.resource]: goodsBack }, nowMs, balance));
    for (const [id, delta] of credit) {
      const t = traders.get(id) ?? (await lockTraders(tx, [id])).get(id);
      if (t) await saveTrader(tx, id, withCredits(t, delta));
    }
    if (other !== null && other !== ki) {
      await systemMessage(tx, ctx.notify, [other], "Liefervertrag gekündigt",
        `Dein Vertragspartner hat den Liefervertrag über ${fmtInt(first.qty)} ${nameOf(first.resource)}${rows.length > 1 ? ` (Abo, ${rows.length} Tranchen)` : ""} gekündigt. ` +
        "Deine Sicherheit ist zurück auf dem Konto; die Strafe des Kündigenden geht in den Gebührentopf.");
    }
    ctx.notify.push([[playerId, ...(other !== null ? [other] : [])], "base"], [null, "market"]);
    return { ok: true as const, penaltyCredits: penaltyTotal / 100, cancelled: rows.length };
  });
}
