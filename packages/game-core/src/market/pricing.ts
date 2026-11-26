// Price formulas of the market. Pure functions, no state.
import type { TradeSide } from "./types.ts";

const MS_PER_HOUR = 3_600_000;

/** p(t) = ref + (p - ref) * 0.5^(dt / halfLife). Negative dt counts as 0. */
export function revertToReference(
  price: number,
  refPrice: number,
  elapsedMs: number,
  halfLifeHours: number,
): number {
  if (!(elapsedMs > 0)) return price;
  if (!(halfLifeHours > 0)) return refPrice;
  const halfLives = elapsedMs / (halfLifeHours * MS_PER_HOUR);
  return refPrice + (price - refPrice) * Math.pow(0.5, halfLives);
}

/** i = q / depth */
export function priceImpact(qty: number, depth: number): number {
  return qty / depth;
}

/** Buy: p' = p * (1 + i). Sell: p' = p / (1 + i). */
export function priceAfterTrade(side: TradeSide, price: number, impact: number): number {
  return side === "buy" ? price * (1 + impact) : price / (1 + impact);
}

/** Mean of the price before and after the trade. */
export function executionPrice(priceBefore: number, priceAfter: number): number {
  return (priceBefore + priceAfter) / 2;
}

// --- Credits in whole hundredths ("cents") ---------------------------------

// A product like 100 * 1.04 yields 104.00000000000001 in floating point. Values
// closer than this to a whole cent are taken as that cent, so such noise does
// not cost the player an extra cent (and never gains one worth mentioning).
const CENT_SNAP = 1e-7;

function snap(cents: number): number | null {
  const nearest = Math.round(cents);
  return Math.abs(cents - nearest) < CENT_SNAP ? nearest : null;
}

/** Credits to cents, rounded up (for amounts the player pays). */
export function ceilToCents(credits: number): number {
  const cents = credits * 100;
  return snap(cents) ?? Math.ceil(cents);
}

/** Credits to cents, rounded down (for amounts the player receives). */
export function floorToCents(credits: number): number {
  const cents = credits * 100;
  return snap(cents) ?? Math.floor(cents);
}

/** Credits that already have two decimals to whole cents. */
export function creditsToCents(credits: number): number {
  return Math.round(credits * 100);
}

export function centsToCredits(cents: number): number {
  return cents / 100;
}

export interface TradeAmounts {
  /** qty * executionPrice, the market's share. */
  baseCents: number;
  /** Share of the fee account. Never negative. */
  feeCents: number;
  /** Buy: paid by the player (base + fee). Sell: received by the player (base - fee). */
  totalCents: number;
}

/**
 * Buy costs q * exec * (1 + fee), rounded up. Sell yields q * exec * (1 - fee),
 * rounded down. The rounding difference goes to the fee account.
 */
export function tradeAmounts(
  side: TradeSide,
  qty: number,
  execPrice: number,
  fee: number,
): TradeAmounts {
  const base = qty * execPrice;
  if (side === "buy") {
    const totalCents = ceilToCents(base * (1 + fee));
    const baseCents = Math.min(totalCents, Math.round(base * 100));
    return { baseCents, feeCents: totalCents - baseCents, totalCents };
  }
  const totalCents = Math.max(0, floorToCents(base * (1 - fee)));
  const baseCents = Math.max(totalCents, Math.round(base * 100));
  return { baseCents, feeCents: baseCents - totalCents, totalCents };
}
