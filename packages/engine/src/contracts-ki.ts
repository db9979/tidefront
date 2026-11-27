// Lieferverträge mit KI-Spielern (v1.31): Kontingente aus den echten Lagern, Charakter (Händler, Festung, Freibeuter),
// Angriffssperre, Preis eines Angebots (auch Abo) und der Vergleich mit der Börse. Kontingente werden bei jedem Abruf
// aus Lager und laufenden Verträgen berechnet (nichts gespeichert). Abschluss: contracts-sign.ts.
import { and, eq, gt, inArray, isNotNull } from "drizzle-orm";
import { settle, storageCapacity, market as marketCore } from "@tidefront/game-core";
import { tables, type DbOrTx } from "@tidefront/db";
import { balance, marketBalance } from "./context.ts";
import { modsOf } from "./modifiers.ts";
import { homeBaseOf, type BaseRow } from "./store.ts";
import { travelMs } from "./player-trade.ts";
import { cfgOrFail, dayMs, fail, isResource, priceInputs, RUNNING, seasonEndMs, type PriceInputs, type ResourceId } from "./contracts-core.ts";

const HOUR_MS = 3_600_000;
const PROFILE_TEXT: Record<string, string> = { haendler: "Händler", festung: "Festung", freibeuter: "Freibeuter" };

export interface KiPartner {
  id: number;
  name: string;
  profile: string;
  cfg: marketCore.ContractKiProfile;
}

/** Aktive KI-Spieler mit Vertragscharakter (abgeschaltete und gerade entfernte bieten nichts an). */
export async function contractKis(db: DbOrTx): Promise<KiPartner[]> {
  const cfg = cfgOrFail();
  const rows = await db.select({ id: tables.player.id, name: tables.player.name, profile: tables.player.botProfile, settings: tables.player.botSettings })
    .from(tables.player).where(isNotNull(tables.player.botProfile)).orderBy(tables.player.id);
  const out: KiPartner[] = [];
  for (const r of rows) {
    const s = (r.settings ?? {}) as { active?: boolean; removing?: boolean };
    const p = marketCore.kiProfile(cfg, r.profile);
    if (p && s.active !== false && !s.removing) out.push({ id: r.id, name: r.name, profile: r.profile!, cfg: p });
  }
  return out;
}

export async function contractKi(db: DbOrTx, id: number): Promise<KiPartner> {
  const ki = (await contractKis(db)).find((k) => k.id === id);
  if (!ki) fail("no_ki");
  return ki;
}

/** Händler und Festung schließen nichts mit einem Spieler ab, der sie in den letzten Stunden überfallen hat. */
export async function kiRefuses(db: DbOrTx, ki: KiPartner, humanId: number, nowMs: number): Promise<boolean> {
  if (ki.profile === "freibeuter") return false;
  const hours = cfgOrFail().ki.attackBlockHours;
  const [r] = await db.select({ id: tables.battleReport.id }).from(tables.battleReport).where(and(
    eq(tables.battleReport.kind, "ueberfall"), eq(tables.battleReport.attackerPlayerId, humanId), eq(tables.battleReport.defenderPlayerId, ki.id),
    gt(tables.battleReport.createdAt, new Date(nowMs - hours * HOUR_MS)),
  )).limit(1);
  return !!r;
}

/** Lager der KI (Heimathafen) je Ressource mit zugesagten Mengen; humanId: Anteil dieses Menschen. */
export async function kiStocks(db: DbOrTx, kiId: number, humanId: number, nowMs: number, home?: BaseRow | null): Promise<{ base: BaseRow; sell: Record<string, marketCore.KiStock>; buy: Record<string, marketCore.KiStock> } | null> {
  const base = home ?? (await homeBaseOf(db, kiId));
  if (!base) return null;
  const mods = await modsOf(db, base, nowMs);
  const state = settle(base.state, nowMs, balance, mods);
  const capacity = storageCapacity(state, balance, mods);
  const t = tables.marketContract;
  const rows = await db.select({ resource: t.resource, qty: t.qty, escrowQty: t.escrowQty, sellerId: t.sellerId, buyerId: t.buyerId })
    .from(t).where(and(eq(t.kind, "ki"), inArray(t.status, RUNNING)));
  const sell: Record<string, marketCore.KiStock> = {};
  const buy: Record<string, marketCore.KiStock> = {};
  for (const r of balance.resources) {
    const stock = Math.floor(state.resources[r] ?? 0);
    const mine = rows.filter((x) => x.resource === r);
    const escrowed = mine.filter((x) => x.sellerId === kiId).reduce((s, x) => s + x.escrowQty, 0);
    const incoming = mine.filter((x) => x.buyerId === kiId).reduce((s, x) => s + x.qty, 0);
    // „Kauf“ aus Sicht des Spielers: die KI verkauft; „Verkauf“: die KI kauft.
    sell[r] = { stock, capacity, escrowed, incoming, humanCommitted: mine.filter((x) => x.sellerId === kiId && x.buyerId === humanId).reduce((s, x) => s + x.escrowQty, 0) };
    buy[r] = { stock, capacity, escrowed, incoming, humanCommitted: mine.filter((x) => x.buyerId === kiId && x.sellerId === humanId).reduce((s, x) => s + x.qty, 0) };
  }
  return { base, sell, buy };
}

/** Freies Kontingent der KI für diesen Menschen (Richtung aus Sicht des Spielers). */
export function quotaOf(stocks: NonNullable<Awaited<ReturnType<typeof kiStocks>>>, side: marketCore.ContractSide, resource: string, ki: KiPartner): number {
  const s = side === "buy" ? stocks.sell[resource] : stocks.buy[resource];
  return s ? marketCore.kiQuota(side, s, cfgOrFail(), ki.cfg) : 0;
}

export interface KiDealInput {
  kiId: number;
  side: marketCore.ContractSide;
  resource: string;
  qty: number;
  days: number;
  abo?: boolean;
}

export interface Tranche {
  dueMs: number;
  settleMs: number;
  qty: number;
  price: marketCore.ContractPrice;
}

export interface KiDeal {
  ki: KiPartner;
  resource: ResourceId;
  tranches: Tranche[];
  /** Durchschnittspreis je Einheit aus Sicht des Spielers. */
  avgPrice: number;
  totalQty: number;
  /** Spieler zahlt (Kauf) bzw. bekommt (Verkauf) insgesamt, in Cent. */
  totalCents: number;
  /** Anzahlung bzw. Pfand in Cent. */
  securityCents: number;
  delivery: "abstrakt" | "konvoi";
  travelMs: number;
  inputs: PriceInputs;
}

/** Tranchen und Preise eines KI-Vertrags (ohne Grenzen und Kontingente). Codes: bad_qty, not_offered, no_abo, bad_term. */
export async function kiDeal(db: DbOrTx, ki: KiPartner, input: KiDealInput, humanBase: { col: number; row: number }, kiBase: { col: number; row: number }, nowMs: number): Promise<KiDeal> {
  const cfg = cfgOrFail();
  if (!isResource(input.resource) || (input.side !== "buy" && input.side !== "sell")) fail("bad_qty");
  if (!Number.isInteger(input.qty) || input.qty < cfg.minQty) fail("bad_qty");
  if (ki.cfg.maxQty !== undefined && input.qty > ki.cfg.maxQty) fail("quota");
  if (!marketCore.kiOffers(ki.cfg, input.side, input.resource)) fail("not_offered");
  if (input.abo && !ki.cfg.abo) fail("no_abo");
  const allowed = marketCore.allowedDays(input.abo ? cfg.aboDays : ki.cfg.days, nowMs, await seasonEndMs(db), cfg.seasonEndBufferHours);
  if (!allowed.includes(input.days)) fail("bad_term");
  const inputs = await priceInputs(db, input.resource, nowMs);
  const dues = input.abo ? marketCore.aboDueTimes(nowMs, input.days) : [nowMs + dayMs(input.days)];
  const convoy = !!ki.cfg.convoy;
  const travel = convoy ? travelMs(kiBase, humanBase) : 0;
  const tranches = dues.map((dueMs) => ({
    dueMs, settleMs: Math.max(nowMs + 60_000, dueMs - travel), qty: input.qty,
    price: marketCore.contractPrice({ side: input.side, resource: input.resource as ResourceId, qty: input.qty, k: inputs.k, r: inputs.r, rT: inputs.rAt(dueMs), termMs: dueMs - nowMs, bonus: ki.cfg.bonus }, marketBalance),
  }));
  const totalQty = tranches.reduce((s, t) => s + t.qty, 0);
  const own = (t: Tranche) => (input.side === "buy" ? t.price.buyerUnit : t.price.sellerUnit);
  const totalCents = tranches.reduce((s, t) => s + (input.side === "buy" ? marketCore.ceilToCents(t.qty * own(t)) : marketCore.floorToCents(t.qty * own(t))), 0);
  const securityCents = tranches.reduce((s, t) => s + marketCore.depositCents(t.qty, own(t), cfg.depositShare), 0);
  return {
    ki, resource: input.resource, tranches, avgPrice: tranches.reduce((s, t) => s + t.qty * own(t), 0) / totalQty, totalQty, totalCents, securityCents,
    delivery: convoy ? "konvoi" : "abstrakt", travelMs: travel, inputs,
  };
}

/** Angebotskarten aller KI-Spieler für diesen Menschen: je KI und Richtung die Ressourcen mit freiem Kontingent. */
export async function kiOffersView(db: DbOrTx, playerId: number, nowMs: number) {
  const cfg = cfgOrFail();
  const kis = await contractKis(db);
  const endMs = await seasonEndMs(db);
  const out = [];
  for (const ki of kis) {
    const stocks = await kiStocks(db, ki.id, playerId, nowMs);
    if (!stocks) continue;
    const refused = await kiRefuses(db, ki, playerId, nowMs);
    const offers: { side: "buy" | "sell"; resource: string; quota: number }[] = [];
    for (const side of ["buy", "sell"] as const) {
      for (const r of side === "buy" ? ki.cfg.sells : ki.cfg.buys) {
        if (!isResource(r)) continue;
        offers.push({ side, resource: r, quota: refused ? 0 : quotaOf(stocks, side, r, ki) });
      }
    }
    out.push({
      id: ki.id, name: ki.name, profile: ki.profile, profileText: PROFILE_TEXT[ki.profile] ?? ki.profile,
      days: marketCore.allowedDays(ki.cfg.days, nowMs, endMs, cfg.seasonEndBufferHours),
      aboDays: ki.cfg.abo ? marketCore.allowedDays(cfg.aboDays, nowMs, endMs, cfg.seasonEndBufferHours) : [],
      bonus: ki.cfg.bonus, maxQty: ki.cfg.maxQty ?? null, convoy: !!ki.cfg.convoy, refused,
      col: stocks.base.col, row: stocks.base.row,
      offers,
    });
  }
  return out;
}
