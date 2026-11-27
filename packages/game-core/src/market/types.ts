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
    /** Feste Lieferzeit jedes Börsenkaufs in Stunden (seit 0.35, delivery.ts); fehlt: nach Seeweg und convoySpeedKmh. */
    deliveryHours?: number;
    /** Marktnachrichten (seit v1.5); fehlt der Eintrag, gibt es keine. */
    news?: MarketNewsBalance;
    /** Lieferverträge (seit v1.31, contracts.ts); fehlt der Eintrag, gibt es keine. */
    contracts?: ContractsBalance;
  };
}

/** Charakter eines KI-Spielers als Vertragspartner (balance.json market.contracts.ki.profiles). */
export interface ContractKiProfile {
  /** Ressourcen, die die KI verkauft (der Spieler kauft auf Termin). */
  sells: string[];
  /** Ressourcen, die die KI kauft (der Spieler liefert auf Termin). */
  buys: string[];
  /** Erlaubte Laufzeiten in Tagen. */
  days: number[];
  /** Abos (tägliche Tranchen) möglich. */
  abo: boolean;
  /** Aufschlag bzw. Abschlag um so viel kleiner (0,02 = 2 Prozentpunkte). */
  bonus: number;
  /** Höchstmenge je Vertrag bzw. Tranche (fehlt: nur das Kontingent begrenzt). */
  maxQty?: number;
  /** Lieferung als Konvoi über die Seewege (sonst abstrakt wie die Börsenlieferung). */
  convoy?: boolean;
}

/** Lieferverträge (seit v1.31): Preisformel, Sicherheiten, Grenzen, KI-Kontingente, Verträge zwischen Spielern. */
export interface ContractsBalance {
  /** Grundaufschlag (wie Börsengebühr); geht in den Gebührentopf. */
  baseFee: number;
  /** Aufschlag je Tag Laufzeit. */
  perDay: number;
  /** Mengenaufschlag = Menge ÷ (depthDivisor × Tiefe). */
  depthDivisor: number;
  durationsDays: number[];
  /** Mögliche Abo-Längen in Tagen (eine Tranche je Tag, erste nach 24 h). */
  aboDays: number[];
  minQty: number;
  /** Offene Verträge je Spieler (ein Abo zählt als einer; eigene Vertragsangebote an Spieler zählen mit). */
  maxOpen: number;
  /** Abschlüsse je Stunde und Spieler. */
  perHour: number;
  /** Anzahlung (Käufer) bzw. Pfand (Verkäufer) als Anteil des Vertragswerts. */
  depositShare: number;
  /** Verfall je nicht erfülltem bzw. gekündigtem Teil als Anteil seines Werts. */
  penaltyShare: number;
  graceHours: number;
  /** Erinnerung so viele Stunden vor Fälligkeit, wenn Taler bzw. Ware nicht reichen. */
  remindHours: number;
  /** Vertragslieferungen einer Ressource je 24-h-Fenster höchstens dieser Anteil des Tageslimits. */
  limitShare: number;
  /** Fälligkeit spätestens so viele Stunden vor Saisonende. */
  seasonEndBufferHours: number;
  /** Belagerung/Blockade des Hafens hält eine fällige Lieferung höchstens so lange zurück. */
  holdHours: number;
  ki: {
    /** KI verkauft nur ab diesem Lagerfüllstand. */
    sellFromFill: number;
    /** KI kauft nur bis zu diesem Lagerfüllstand. */
    buyToFill: number;
    /** Kontingent: Anteil des Bestands (Verkauf) bzw. des freien Lagerplatzes (Kauf). */
    quotaShare: number;
    /** Je Mensch höchstens 1/perHumanDivisor des Kontingents einer KI je Ressource und Richtung. */
    perHumanDivisor: number;
    /** Kontingente in Stufen dieser Größe (verrät den Lagerstand nur grob). */
    quotaStep: number;
    /** Händler und Festung schließen so lange nichts mit einem Spieler ab, der sie überfallen hat. */
    attackBlockHours: number;
    profiles: Record<string, ContractKiProfile>;
  };
  player: {
    /** Preisband: Preis ≥ (1 − band) × min(K, E) und ≤ (1 + band) × max(K, E). */
    band: number;
    /** Höchster Börsenwert aller Verträge eines Spielerpaars in 7 Tagen (Paarbremse). */
    pairWeekValue: number;
    /** Ein Vertragsangebot an Spieler gilt so viele Stunden. */
    offerHours: number;
  };
}

/** Werte der Marktnachrichten (balance.json market.news), siehe news.ts und REGELN.md. */
export interface MarketNewsBalance {
  /** Summe aller Einflüsse je Ressource höchstens ± diesen Anteil am Grundrichtwert. */
  maxTotal: number;
  /** Der effektive Richtwert ändert sich höchstens um diesen Anteil des Grundrichtwerts je Stunde. */
  maxChangePerHour: number;
  /** Kleinere Wirkungen erzeugen keine Nachricht. */
  minPct: number;
  /** Push „Marktnachricht“ erst ab diesem Betrag. */
  pushMinPct: number;
  worldEvents: {
    grossflotte: { pct: Record<string, number>; maxPct: number; fadeHours: number };
    belagerung: { pct: Record<string, number>; fadeHours: number };
    schatzschiffErbeutet: { pct: Record<string, number>; holdHours: number; fadeHours: number };
    schatzschiffEntkommen: { pct: Record<string, number>; holdHours: number; fadeHours: number };
  };
  war: { resource: string; calm: number; perWar: number; perRaid: number; max: number; holdHours: number };
  scarcity: {
    max: number;
    neutralFill: number;
    fillWeight: number;
    deficitWeight: number;
    minBases: number;
    window: number;
    activeDays: number;
    holdHours: number;
  };
  seasonEnd: { days: number; pct: Record<string, number> };
  /**
   * Handelsbilanz (seit v1.30; fehlt der Eintrag, gibt es sie nicht): Ziel = factor × gedeckelte Netto-Käufe aller
   * Spieler der letzten windowHours ÷ (depthMultiple × Tiefe), höchstens ±max; erst ab minPorts aktiven Häfen; je
   * Spieler zählt höchstens 1/playerShareDivisor der gesamten Netto-Bewegung (news.ts, tradeBalancePct).
   */
  tradeBalance?: {
    factor: number;
    windowHours: number;
    depthMultiple: number;
    max: number;
    minPorts: number;
    /** Je Spieler zählt höchstens 1/playerShareDivisor der gesamten Netto-Bewegung (3 = ein Drittel). */
    playerShareDivisor: number;
    holdHours: number;
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

/** Ein Fach des gleitenden 24-h-Fensters (window.ts): gehandelte Menge (Kauf + Verkauf) je Ressource in einer Stunde. */
export interface TradeHour {
  /** Stundennummer floor(ms / 3_600_000). */
  h: number;
  q: Partial<Record<ResourceId, number>>;
}

export interface TraderState {
  /** Credits with two decimals. */
  credits: number;
  stock: Record<ResourceId, number>;
  /**
   * Gleitendes 24-h-Fenster des Handelslimits (seit v1.30): Fächer je volle Stunde, aufsteigend, nur die letzten 24
   * Stunden. Fehlt bei Zuständen von vor v1.30 (dann gelten dailyDayIndex/dailyVolume, siehe tradeWindow).
   */
  tradeHours?: TradeHour[];
  /** @deprecated Vor v1.30: Tagesnummer (Spielzeit) der Zähler in dailyVolume; nur noch gelesen (Überführung). */
  dailyDayIndex?: number;
  /** @deprecated Vor v1.30: gehandelte Menge je Ressource am Tag dailyDayIndex; nur noch gelesen (Überführung). */
  dailyVolume?: Record<ResourceId, number>;
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
  /** Lieferverträge (v1.31): für Vertragslieferungen der nächsten 24 h vorgemerkte Menge dieser Ressource. */
  reservedQty?: number;
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
