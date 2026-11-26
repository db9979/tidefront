// Types for the market core (stage 1: instant buy and sell).
// Only erasable type syntax: this file is executed by Node's type stripping.

export type ResourceId = "stahl" | "treibstoff" | "elektronik" | "proviant";

export type TradeSide = "buy" | "sell";

export type RejectionCode =
  | "locked"
  | "halted"
  | "bad_qty"
  | "impact"
  | "rate"
  | "daily_limit"
  | "under_attack"
  | "credit_limit"
  | "funds"
  | "slippage"
  | "price_bounds"
  | "band";

/** The part of balance.json the market reads. The full balance object satisfies it. */
export interface MarketBalance {
  buildings: {
    hafenkommandantur: {
      marketFromLevel: number;
      creditLimitPerLevel: number;
    };
  };
  market: {
    refPrice: Record<string, number>;
    depth: Record<string, number>;
    fee: number;
    maxImpactPerTrade: number;
    hourBand: number;
    dayBand: number;
    haltMinutes: number;
    floorFactor: number;
    ceilFactor: number;
    reversionHalfLifeHours: number;
    dailyLimitShareOfStorage: number;
    slippageTolerance: number;
    tradesPerMinute: number;
    convoySpeedKmh: number;
  };
}

/** One point of the price history: the price right after a trade (or at market creation). */
export interface PricePoint {
  tMs: number;
  price: number;
}

/** Market state of a single resource. */
export interface ResourceMarketState {
  /** Price as of lastUpdateMs (reversion to the reference is applied lazily). */
  price: number;
  lastUpdateMs: number;
  /** Trading is halted while nowMs < haltedUntilMs. 0 = never halted. */
  haltedUntilMs: number;
  /** Ascending by tMs; covers at least the last 24 hours (hour and day band). */
  history: PricePoint[];
}

/** Market state: one entry per resource. */
export type MarketState = Record<ResourceId, ResourceMarketState>;

export interface TraderState {
  /** Credits with two decimals. */
  credits: number;
  stock: Record<ResourceId, number>;
  /** UTC day index (floor(ms / 86_400_000)) the volumes below belong to. */
  dailyDayIndex: number;
  /** Traded quantity (buys plus sells) per resource on dailyDayIndex. */
  dailyVolume: Record<ResourceId, number>;
  /** Timestamps of recent successful trades (for the per-minute limit). */
  recentTradeTimesMs: number[];
}

export interface TradeRequest {
  side: TradeSide;
  resource: ResourceId;
  qty: number;
  /** Execution price the player saw in the quote. */
  expectedPrice: number;
}

/** Everything the market needs from the rest of the game, as plain values. */
export interface TradeContext {
  playerId: string;
  /** Unique id of this trade, chosen by the caller; also the delivery id. */
  tradeId: string;
  /** Level of the Hafenkommandantur of the trading base. */
  harborLevel: number;
  /** Storage capacity per resource of the trading base. */
  storageCapacity: Record<ResourceId, number>;
  /** True while an incoming attack on the base has been detected. */
  attackDetected: boolean;
  /** Distance from the base to the trade port in km. */
  distanceToPortKm: number;
}

export interface Quote {
  side: TradeSide;
  resource: ResourceId;
  qty: number;
  /** Price after reversion, before the trade. */
  priceBefore: number;
  /** Price after the trade. */
  priceAfter: number;
  executionPrice: number;
  impact: number;
  /** qty * executionPrice without fee, in credits. */
  baseCredits: number;
  feeCredits: number;
  /** Buy: what the player pays. Sell: what the player receives. */
  totalCredits: number;
}

export type QuoteResult =
  | ({ ok: true } & Quote)
  | { ok: false; code: "bad_qty" };

export interface Delivery {
  id: string;
  playerId: string;
  resource: ResourceId;
  qty: number;
  departMs: number;
  arriveMs: number;
}

export type LedgerAsset = "credits" | ResourceId;

/** One line of the double-entry journal. Positive amount = account receives. */
export interface LedgerEntry {
  tradeId: string;
  tMs: number;
  /** "player:<id>", "market", "fees" or "delivery:<id>". */
  account: string;
  asset: LedgerAsset;
  /** Credits with two decimals, or whole resource units. */
  amount: number;
}

export interface TradeSuccess {
  ok: true;
  market: MarketState;
  trader: TraderState;
  quote: Quote;
  /** Set for buys, null for sells. */
  delivery: Delivery | null;
  ledger: LedgerEntry[];
}

export interface TradeRejection {
  ok: false;
  code: RejectionCode;
  /** Unchanged, except for code "band": then haltedUntilMs of the resource is set. */
  market: MarketState;
  /** Always the unchanged input trader. */
  trader: TraderState;
}

export type TradeResult = TradeSuccess | TradeRejection;
