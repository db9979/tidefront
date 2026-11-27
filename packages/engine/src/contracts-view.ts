// Lieferverträge (v1.31): Lesemodell für den Reiter „Verträge“ der Börse – Angebote der KI-Spieler, offene
// Vertragsangebote von Spielern, eigene Verträge mit Status, Fälligkeit, Lieferung und Kündigungsstrafe.
import { and, desc, eq, gt, inArray, isNull, or } from "drizzle-orm";
import { market as marketCore } from "@tidefront/game-core";
import { tables } from "@tidefront/db";
import { balance, type Engine } from "./context.ts";
import { ownBase } from "./store.ts";
import {
  ACTIVE, contractsCfg, dailyLimitOf, openCount, priceInputs, reservedNext24h, RUNNING, seasonEndMs, signedLastHour, type ContractRow,
  type PriceInputs,
} from "./contracts-core.ts";
import { kiOffersView } from "./contracts-ki.ts";
import { kiOf } from "./contracts-run.ts";
import { cancelPenalty } from "./contracts-cancel.ts";
import { pairWeekValue, playerBand } from "./contracts-player.ts";

const DAY_MS = 86_400_000;

export async function contractsView(engine: Engine, playerId: number, baseId?: number) {
  const nowMs = Date.now();
  const cfg = contractsCfg();
  const db = engine.db;
  if (baseId !== undefined) await ownBase(db, playerId, baseId);
  if (!cfg) return { serverNow: nowMs, enabled: false as const };
  const t = tables.marketContract;
  const mineRows = await db.select().from(t).where(and(
    or(eq(t.buyerId, playerId), eq(t.sellerId, playerId), eq(t.proposerId, playerId)),
    or(inArray(t.status, ACTIVE), gt(t.closedAt, new Date(nowMs - 7 * DAY_MS))),
  )).orderBy(desc(t.id)).limit(60);
  const proposals = await db.select().from(t).where(and(
    eq(t.status, "angeboten"), gt(t.offerUntil, new Date(nowMs)), or(isNull(t.targetId), eq(t.targetId, playerId)),
  )).orderBy(desc(t.id)).limit(40);
  const ids = new Set<number>();
  for (const r of [...mineRows, ...proposals]) for (const x of [r.buyerId, r.sellerId, r.proposerId, r.targetId]) if (x !== null) ids.add(x);
  const names = new Map((ids.size === 0 ? [] : await db.select({ id: tables.player.id, name: tables.player.name }).from(tables.player)
    .where(inArray(tables.player.id, [...ids]))).map((r) => [r.id, r.name]));
  const [p] = await db.select({ trader: tables.player.trader }).from(tables.player).where(eq(tables.player.id, playerId));
  const endMs = await seasonEndMs(db);
  const limit = await dailyLimitOf(db, playerId, nowMs);

  // Kündigung eines Abos betrifft alle offenen Tranchen: Strafe zusammengezählt.
  const aboPenalty = new Map<number, number>();
  for (const c of mineRows) if (c.aboId !== null && RUNNING.includes(c.status)) aboPenalty.set(c.aboId, (aboPenalty.get(c.aboId) ?? 0) + cancelPenalty(c, playerId));
  const shape = (c: ContractRow) => {
    const ki = kiOf(c);
    const iBuy = c.buyerId === playerId || (c.buyerId === null && c.proposerId === playerId && c.sellerId === null);
    const partnerId = iBuy ? c.sellerId : c.buyerId;
    const unit = iBuy ? c.buyerUnit : c.sellerUnit;
    return {
      id: c.id, kind: c.kind as "ki" | "spieler", status: c.status, side: (iBuy ? "buy" : "sell") as "buy" | "sell",
      partner: partnerId !== null ? names.get(partnerId) ?? "?" : null, partnerIsKi: partnerId !== null && partnerId === ki,
      target: c.targetId !== null ? names.get(c.targetId) ?? "?" : null, own: c.proposerId === playerId,
      resource: c.resource, qty: c.qty, unitPrice: unit,
      totalCredits: (iBuy ? marketCore.ceilToCents(c.qty * unit) : marketCore.floorToCents(c.qty * unit)) / 100,
      securityCredits: (iBuy ? c.buyerDepositCents : c.sellerPledgeCents) / 100,
      dueAtMs: c.dueAt.getTime(), settleAtMs: c.settleAt.getTime(), graceUntilMs: c.graceUntil?.getTime() ?? null,
      offerUntilMs: c.offerUntil?.getTime() ?? null, closedAtMs: c.closedAt?.getTime() ?? null,
      deliveredQty: c.deliveredQty, penaltyCredits: (iBuy ? c.buyerPenaltyCents : c.sellerPenaltyCents) / 100,
      cancelPenaltyCredits: RUNNING.includes(c.status) ? (c.aboId !== null ? aboPenalty.get(c.aboId) ?? 0 : cancelPenalty(c, playerId)) / 100 : null,
      aboId: c.aboId, tranche: c.tranche, tranches: c.tranches, delivery: c.delivery as "abstrakt" | "konvoi", deliveryId: c.deliveryId,
      counts: c.counts, escort: (c.escort as Record<string, number> | null) ?? {},
    };
  };

  // Preisband je Ressource einmal rechnen (Kurs, Richtwert), dann je Angebot nur noch E zur Fälligkeit.
  const inputs = new Map<string, PriceInputs>();
  const inBand = async (c: ContractRow) => {
    if (!inputs.has(c.resource)) inputs.set(c.resource, await priceInputs(db, c.resource as marketCore.ResourceId, nowMs));
    const pi = inputs.get(c.resource)!;
    const e = marketCore.expectedPriceAt(pi.k, pi.r, pi.rAt(c.dueAt.getTime()), c.dueAt.getTime() - nowMs, balance.market.reversionHalfLifeHours);
    const b = marketCore.playerPriceBand(pi.k, e, cfg.player.band);
    return c.buyerUnit >= b.min - 1e-9 && c.buyerUnit <= b.max + 1e-9;
  };
  const pairLeft = new Map<number, number>();
  const open = [];
  for (const c of proposals) {
    if (c.proposerId === playerId) continue;
    // Aus Sicht des Lesers: bietet der andere Verkauf an, kauft der Leser.
    const iBuy = c.buyerId === null;
    open.push({
      id: c.id, from: names.get(c.proposerId) ?? "?", personal: c.targetId === playerId, side: (iBuy ? "buy" : "sell") as "buy" | "sell",
      resource: c.resource, qty: c.qty, unitPrice: iBuy ? c.buyerUnit : c.sellerUnit,
      totalCredits: (iBuy ? marketCore.ceilToCents(c.qty * c.buyerUnit) : marketCore.floorToCents(c.qty * c.sellerUnit)) / 100,
      securityCredits: marketCore.depositCents(c.qty, iBuy ? c.buyerUnit : c.sellerUnit, cfg.depositShare) / 100,
      dueAtMs: c.dueAt.getTime(), offerUntilMs: c.offerUntil?.getTime() ?? null, course: c.course,
      inBand: await inBand(c),
      pairLeft: pairLeft.get(c.proposerId) ?? pairLeft.set(c.proposerId, Math.max(0, cfg.player.pairWeekValue - (await pairWeekValue(db, playerId, c.proposerId, nowMs)))).get(c.proposerId)!,
    });
  }
  const days = marketCore.allowedDays(cfg.durationsDays, nowMs, endMs, cfg.seasonEndBufferHours);
  return {
    serverNow: nowMs, enabled: true as const,
    cfg: {
      minQty: cfg.minQty, maxOpen: cfg.maxOpen, perHour: cfg.perHour, depositShare: cfg.depositShare, penaltyShare: cfg.penaltyShare,
      graceHours: cfg.graceHours, baseFee: cfg.baseFee, perDay: cfg.perDay, band: cfg.player.band, pairWeekValue: cfg.player.pairWeekValue,
      offerHours: cfg.player.offerHours, limitShare: cfg.limitShare, days,
    },
    credits: (p?.trader as { credits?: number } | undefined)?.credits ?? 0,
    openCount: await openCount(db, playerId), signedLastHour: await signedLastHour(db, playerId, nowMs),
    dailyLimit: limit, contractLimit: Math.floor(cfg.limitShare * limit), reserved: await reservedNext24h(db, playerId, nowMs),
    seasonEndMs: endMs,
    kis: await kiOffersView(db, playerId, nowMs),
    proposals: open,
    mine: mineRows.map(shape),
    resources: balance.resources,
  };
}

/** Preisband für ein eigenes Angebot an Spieler (Eingabehilfe). */
export async function contractBandView(engine: Engine, resource: string, days: number) {
  return playerBand(engine.db, resource, days, Date.now());
}
