// Double-entry journal lines for trades and a balance check.
import type { LedgerEntry, ResourceId, TradeSide } from "./types.ts";
import { centsToCredits, creditsToCents } from "./pricing.ts";

export const MARKET_ACCOUNT = "market";
export const FEES_ACCOUNT = "fees";

export function playerAccount(playerId: string): string {
  return `player:${playerId}`;
}

export function deliveryAccount(deliveryId: string): string {
  return `delivery:${deliveryId}`;
}

export interface TradeLedgerInput {
  tradeId: string;
  tMs: number;
  side: TradeSide;
  playerId: string;
  /** Needed for buys: the goods go to "delivery:<id>". */
  deliveryId: string;
  resource: ResourceId;
  qty: number;
  baseCents: number;
  feeCents: number;
  totalCents: number;
}

/**
 * Buy:  player pays total; market receives base, fees receive fee;
 *       market hands qty to the delivery.
 * Sell: market pays base; player receives total, fees receive fee;
 *       player hands qty to the market.
 */
export function buildTradeLedger(input: TradeLedgerInput): LedgerEntry[] {
  const { tradeId, tMs, side, resource, qty } = input;
  const player = playerAccount(input.playerId);
  const line = (account: string, asset: LedgerEntry["asset"], amount: number): LedgerEntry => ({
    tradeId,
    tMs,
    account,
    asset,
    amount,
  });
  const total = centsToCredits(input.totalCents);
  const base = centsToCredits(input.baseCents);
  const fee = centsToCredits(input.feeCents);
  if (side === "buy") {
    return [
      line(player, "credits", -total),
      line(MARKET_ACCOUNT, "credits", base),
      line(FEES_ACCOUNT, "credits", fee),
      line(MARKET_ACCOUNT, resource, -qty),
      line(deliveryAccount(input.deliveryId), resource, qty),
    ];
  }
  return [
    line(MARKET_ACCOUNT, "credits", -base),
    line(player, "credits", total),
    line(FEES_ACCOUNT, "credits", fee),
    line(player, resource, -qty),
    line(MARKET_ACCOUNT, resource, qty),
  ];
}

export interface LedgerCheck {
  ok: boolean;
  /** Sum per asset; credits in credits (two decimals), resources in units. */
  sums: Record<string, number>;
}

/** Confirms that the entries sum to 0 for credits and for every resource. */
export function verifyLedger(entries: readonly LedgerEntry[]): LedgerCheck {
  // Credits are summed in whole cents so that the check is exact.
  const raw: Record<string, number> = {};
  for (const entry of entries) {
    const value = entry.asset === "credits" ? creditsToCents(entry.amount) : entry.amount;
    raw[entry.asset] = (raw[entry.asset] ?? 0) + value;
  }
  const sums: Record<string, number> = {};
  let ok = true;
  for (const asset of Object.keys(raw)) {
    const sum = raw[asset];
    if (!(sum === 0)) ok = false;
    sums[asset] = asset === "credits" ? centsToCredits(sum) : sum;
  }
  return { ok, sums };
}
