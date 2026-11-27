// Lieferverträge (v1.31, docs/REGELN.md Abschnitt Lieferverträge): gemeinsame Bausteine für KI- und Spielerverträge –
// Konfiguration, Preis-Eingaben (Kurs, Richtwert, angekündigte Nachrichten), Taler in Cent, Journal, Grenzen
// (offene Verträge, Abschlüsse je Stunde, Tageslimit-Fenster, Kasse). Abschluss: contracts-sign.ts,
// Abwicklung: contracts-run.ts, Angebote der KI: contracts-ki.ts, Verträge zwischen Spielern: contracts-player.ts.
import { and, eq, gt, inArray, or, sql } from "drizzle-orm";
import { market as marketCore } from "@tidefront/game-core";
import { tables, type DbOrTx, type Tx } from "@tidefront/db";
import { balance, GameError, marketBalance } from "./context.ts";
import { marketRefs } from "./market-news.ts";
import { homeStorageCapacity, maxHarborLevel } from "./player-wide.ts";

export const CONTRACT_EVENT = "contract_due";
export type ContractRow = typeof tables.marketContract.$inferSelect;
export type ResourceId = marketCore.ResourceId;
type Trader = Omit<marketCore.TraderState, "stock">;

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** Laufende Verträge (Fälligkeit steht noch aus). */
export const RUNNING = ["offen", "nachfrist"];
/** Zählen als offene Verträge des Spielers (eigene Angebote an Spieler eingeschlossen). */
export const ACTIVE = ["angeboten", "offen", "nachfrist"];

export function contractsCfg(): marketCore.ContractsBalance | null {
  return marketCore.contractsOf(marketBalance);
}

export function cfgOrFail(): marketCore.ContractsBalance {
  const c = contractsCfg();
  if (!c) throw new GameError("no_contracts");
  return c;
}

export function fail(code: string): never {
  throw new GameError(code);
}

export const isResource = (r: string): r is ResourceId => balance.resources.includes(r);

/** Ende der laufenden Saison (ms) oder null. */
export async function seasonEndMs(db: DbOrTx): Promise<number | null> {
  const [s] = await db.select({ endsAt: tables.season.endsAt }).from(tables.season).where(eq(tables.season.status, "running")).limit(1);
  return s ? s.endsAt.getTime() : null;
}

export interface PriceInputs {
  /** Kurs jetzt (nach Rückkehr). */
  k: number;
  /** Effektiver Richtwert jetzt. */
  r: number;
  /** Handelspause der Ressource. */
  halted: boolean;
  /** Richtwert bei Fälligkeit: heutiger plus angekündigte Saisonend-Nachricht. */
  rAt: (dueMs: number) => number;
}

/** Kurs, Richtwert und R_T einer Ressource (angekündigt ist die tageweise steigende Saisonend-Nachricht). */
export async function priceInputs(db: DbOrTx, resource: ResourceId, nowMs: number): Promise<PriceInputs> {
  const [row] = await db.select().from(tables.market).where(eq(tables.market.resource, resource));
  const refs = await marketRefs(db, nowMs);
  const r = refs.refs[resource] ?? balance.market.refPrice[resource];
  const st = row?.state as marketCore.ResourceMarketState | undefined;
  const k = st ? marketCore.currentPrice(st, resource, marketBalance, nowMs, refs.refs as marketCore.RefPrices) : r;
  const se = balance.market.news?.seasonEnd;
  const endMs = se ? await seasonEndMs(db) : null;
  const baseRef = balance.market.refPrice[resource];
  const pct = se?.pct[resource] ?? 0;
  const now = endMs !== null && se ? marketCore.seasonEndFactor(nowMs, endMs, se.days) : 0;
  return {
    k, r, halted: (st?.haltedUntilMs ?? 0) > nowMs,
    rAt: (dueMs) => {
      if (endMs === null || !se || pct === 0) return r;
      const later = marketCore.seasonEndFactor(dueMs, endMs, se.days);
      return r + baseRef * pct * Math.max(0, later - now);
    },
  };
}

// ---------------------------------------------------------------- Taler und Journal

export const cents = (credits: number) => Math.round(credits * 100);
export const credits = (c: number) => c / 100;
export const amt = (c: number) => (c / 100).toFixed(2);

/** Sperrt Spieler (aufsteigend) und liefert ihren Handelszustand. */
export async function lockTraders(tx: Tx, ids: number[]): Promise<Map<number, Trader>> {
  const uniq = [...new Set(ids)].sort((a, b) => a - b);
  if (uniq.length === 0) return new Map();
  const rows = await tx.select({ id: tables.player.id, trader: tables.player.trader }).from(tables.player)
    .where(inArray(tables.player.id, uniq)).orderBy(tables.player.id).for("update");
  return new Map(rows.map((r) => [r.id, r.trader as Trader]));
}

export async function saveTrader(tx: Tx, id: number, trader: Trader): Promise<void> {
  await tx.update(tables.player).set({ trader }).where(eq(tables.player.id, id));
}

/** Taler ändern (ganze Cent). */
export function withCredits(t: Trader, deltaCents: number): Trader {
  return { ...t, credits: credits(cents(t.credits) + deltaCents) };
}

/** Journalzeile: Taler in Cent (asset "credits"), Ressourcen in Einheiten. */
export type Line = [account: string, asset: string, amount: number];

export async function journal(tx: Tx, tradeId: string, tMs: number, lines: Line[]): Promise<void> {
  const rows = lines.filter(([, , a]) => a !== 0).map(([account, asset, a]) => ({
    tradeId, tMs, account, asset, amount: asset === "credits" ? amt(a) : a.toFixed(2),
  }));
  if (rows.length > 0) await tx.insert(tables.tradeLedger).values(rows);
}

export const escrowAccount = (id: number) => `escrow:mc-${id}`;
export const playerAcc = (id: number) => `player:${id}`;

// ---------------------------------------------------------------- Grenzen

/** Beteiligte Menschen eines Vertrags: Käufer bzw. Verkäufer, die kein KI-Spieler sind. */
export function humansOf(c: Pick<ContractRow, "kind" | "buyerId" | "sellerId" | "proposerId">, kiId: number | null): number[] {
  return [c.buyerId, c.sellerId].filter((x): x is number => x !== null && x !== kiId);
}

/** Offene Verträge eines Spielers (Abo = einer; eigene Angebote an Spieler zählen mit). */
export async function openCount(db: DbOrTx, playerId: number): Promise<number> {
  const t = tables.marketContract;
  const [r] = await db.select({ n: sql<number>`count(distinct coalesce(${t.aboId}, ${t.id}))::int` }).from(t)
    .where(and(inArray(t.status, ACTIVE), or(eq(t.buyerId, playerId), eq(t.sellerId, playerId), eq(t.proposerId, playerId))));
  return r?.n ?? 0;
}

/** Abschlüsse (und Angebote) des Spielers in der letzten Stunde. */
export async function signedLastHour(db: DbOrTx, playerId: number, nowMs: number): Promise<number> {
  const t = tables.marketContract;
  const [r] = await db.select({ n: sql<number>`count(distinct coalesce(${t.aboId}, ${t.id}))::int` }).from(t)
    .where(and(gt(t.createdAt, new Date(nowMs - HOUR_MS)), eq(t.proposerId, playerId)));
  const [s] = await db.select({ n: sql<number>`count(distinct coalesce(${t.aboId}, ${t.id}))::int` }).from(t)
    .where(and(gt(t.signedAt, new Date(nowMs - HOUR_MS)), sql`${t.proposerId} <> ${playerId}`, or(eq(t.buyerId, playerId), eq(t.sellerId, playerId))));
  return (r?.n ?? 0) + (s?.n ?? 0);
}

/** Laufende Vertragslieferungen einer Ressource, an denen der Spieler beteiligt ist (Abwicklungszeitpunkte). */
export async function duePoints(db: DbOrTx, playerId: number, resource?: string): Promise<(marketCore.DuePoint & { resource: string })[]> {
  const t = tables.marketContract;
  const rows = await db.select({ at: t.settleAt, qty: t.qty, resource: t.resource }).from(t)
    .where(and(inArray(t.status, RUNNING), or(eq(t.buyerId, playerId), eq(t.sellerId, playerId)), resource ? eq(t.resource, resource) : undefined));
  return rows.map((r) => ({ atMs: r.at.getTime(), qty: r.qty, resource: r.resource }));
}

/** Für Verträge vorgemerkte Mengen der nächsten 24 h je Ressource (freier Rahmen der Börse). */
export async function reservedNext24h(db: DbOrTx, playerId: number, nowMs: number): Promise<Record<string, number>> {
  const pts = await duePoints(db, playerId);
  const out: Record<string, number> = Object.fromEntries(balance.resources.map((r) => [r, 0]));
  for (const r of balance.resources) out[r] = marketCore.reservedNext24h(pts.filter((p) => p.resource === r), nowMs);
  return out;
}

/** Tageslimit des Spielers (Anteil des Heimatlagers) in Einheiten. */
export async function dailyLimitOf(db: DbOrTx, playerId: number, nowMs: number): Promise<number> {
  return Math.floor(balance.market.dailyLimitShareOfStorage * (await homeStorageCapacity(db, playerId, nowMs)));
}

/** Prüft: Vertragslieferungen der Ressource in jedem 24-h-Fenster ≤ limitShare × Tageslimit (Code daily_limit). */
export async function checkWindow(db: DbOrTx, playerId: number, resource: string, added: marketCore.DuePoint[], nowMs: number): Promise<void> {
  const cfg = cfgOrFail();
  const limit = cfg.limitShare * (await dailyLimitOf(db, playerId, nowMs));
  if (marketCore.maxWindowLoad(await duePoints(db, playerId, resource), added) > limit) fail("daily_limit");
}

/** Kasse des Spielers (Stufe der höchsten Hafenkommandantur). */
export async function creditLimitCents(db: DbOrTx, playerId: number): Promise<number> {
  return cents((balance.buildings.hafenkommandantur.creditLimitPerLevel ?? 0) * (await maxHarborLevel(db, playerId)));
}

/** Offene Restzahlungen (Käufer) und offene Verkaufserlöse (Verkäufer) laufender Verträge in Cent. */
export async function openCommitments(db: DbOrTx, playerId: number): Promise<{ payCents: number; proceedsCents: number }> {
  const t = tables.marketContract;
  const rows = await db.select({ buyerId: t.buyerId, sellerId: t.sellerId, qty: t.qty, bu: t.buyerUnit, su: t.sellerUnit, dep: t.buyerDepositCents })
    .from(t).where(and(inArray(t.status, RUNNING), or(eq(t.buyerId, playerId), eq(t.sellerId, playerId))));
  let payCents = 0;
  let proceedsCents = 0;
  for (const r of rows) {
    if (r.buyerId === playerId) payCents += Math.max(0, marketCore.ceilToCents(r.qty * r.bu) - r.dep);
    if (r.sellerId === playerId) proceedsCents += marketCore.floorToCents(r.qty * r.su);
  }
  return { payCents, proceedsCents };
}

/**
 * Kasse beim Abschluss: Käufer – offene Restzahlungen + neue ≤ Limit; Verkäufer – Taler + offene Erlöse + neue
 * ≤ Limit (Code credit_limit).
 */
export async function checkCreditLimit(db: DbOrTx, playerId: number, role: "buyer" | "seller", newCents: number, creditsNow: number): Promise<void> {
  const limit = await creditLimitCents(db, playerId);
  const open = await openCommitments(db, playerId);
  if (role === "buyer" && open.payCents + newCents > limit) fail("credit_limit");
  if (role === "seller" && cents(creditsNow) + open.proceedsCents + newCents > limit) fail("credit_limit");
}

/** Grenzen eines Abschlusses für einen Menschen: offene Verträge, Abschlüsse je Stunde (Codes too_many_contracts, rate). */
export async function checkCounts(db: DbOrTx, playerId: number, nowMs: number, ownNew: boolean): Promise<void> {
  const cfg = cfgOrFail();
  if ((await openCount(db, playerId)) >= cfg.maxOpen) fail("too_many_contracts");
  if (ownNew && (await signedLastHour(db, playerId, nowMs)) >= cfg.perHour) fail("rate");
}

/** Laufzeit in Tagen erlaubt (Charakter bzw. Liste) und Fälligkeit ≤ Saisonende − Puffer (Code bad_term). */
export async function checkTerm(db: DbOrTx, days: number, allowed: readonly number[], nowMs: number): Promise<void> {
  const cfg = cfgOrFail();
  const ok = marketCore.allowedDays(allowed, nowMs, await seasonEndMs(db), cfg.seasonEndBufferHours);
  if (!ok.includes(days)) fail("bad_term");
}

export const dayMs = (days: number) => days * DAY_MS;
