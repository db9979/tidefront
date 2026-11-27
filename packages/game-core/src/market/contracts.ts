// Lieferverträge (Termingeschäfte, seit v1.31; docs/VORLAGE-LIEFERVERTRAEGE.md, REGELN.md Abschnitt Lieferverträge).
// Rein: Preisformel, Abwicklung mit Nachfrist und Strafe, Tageslimit-Fenster, KI-Kontingente. Zeit kommt als Wert.
//
// Preis (K = Kurs jetzt, R = effektiver Richtwert jetzt, R_T = Richtwert bei Fälligkeit mit angekündigten
// Nachrichten, T = Laufzeit): E = R_T + (K − R) · 0,5^(T / Halbwertszeit); a = Grundaufschlag + perDay · Tage +
// Menge / (depthDivisor · Tiefe) − Charakterbonus; Kauf: max(K, E) · (1 + a), Verkauf: min(K, E) · (1 − a).
import type { ContractKiProfile, ContractsBalance, MarketBalance, ResourceId } from "./types.ts";
import { ceilToCents, floorToCents } from "./pricing.ts";

const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

/** Seite aus Sicht des Spielers: "buy" = der Spieler kauft (bekommt Ware), "sell" = der Spieler liefert. */
export type ContractSide = "buy" | "sell";

export function contractsOf(balance: MarketBalance): ContractsBalance | null {
  return balance.market.contracts ?? null;
}

/** Erwarteter Kurs bei Fälligkeit: E = R_T + (K − R) · 0,5^(T / Halbwertszeit). */
export function expectedPriceAt(k: number, r: number, rT: number, termMs: number, halfLifeHours: number): number {
  if (!(halfLifeHours > 0)) return rT;
  const t = Math.max(0, termMs) / (halfLifeHours * MS_PER_HOUR);
  return rT + (k - r) * Math.pow(0.5, t);
}

/** Aufschlag a = Grundaufschlag + perDay · Tage + Menge / (depthDivisor · Tiefe) − bonus (nie negativ). */
export function contractSurcharge(cfg: ContractsBalance, termMs: number, qty: number, depth: number, bonus = 0): number {
  const days = Math.max(0, termMs) / MS_PER_DAY;
  const qtyPart = depth > 0 && cfg.depthDivisor > 0 ? qty / (cfg.depthDivisor * depth) : 0;
  return Math.max(0, cfg.baseFee + cfg.perDay * days + qtyPart - (bonus > 0 ? bonus : 0));
}

export interface ContractPriceInput {
  side: ContractSide;
  resource: ResourceId;
  qty: number;
  /** Kurs jetzt (nach Rückkehr). */
  k: number;
  /** Effektiver Richtwert jetzt. */
  r: number;
  /** Richtwert bei Fälligkeit (heutiger plus angekündigte Nachrichten). */
  rT: number;
  termMs: number;
  /** Charakterbonus der KI (2 Prozentpunkte = 0,02). */
  bonus?: number;
}

export interface ContractPrice {
  /** Preis je Einheit aus Sicht des Spielers (Kauf: zahlt; Verkauf: bekommt). */
  price: number;
  /** Bezugskurs: Kauf max(K, E), Verkauf min(K, E). */
  basis: number;
  expected: number;
  surcharge: number;
  /** Gebühr je Einheit (Grundaufschlag × Bezugskurs) für den Gebührentopf. */
  feePerUnit: number;
  /** Käufer zahlt je Einheit. */
  buyerUnit: number;
  /** Verkäufer bekommt je Einheit. */
  sellerUnit: number;
}

/** Preis eines KI-Vertrags. Immer innerhalb floorFactor … ceilFactor × Grundrichtwert. */
export function contractPrice(input: ContractPriceInput, balance: MarketBalance): ContractPrice {
  const cfg = contractsOf(balance);
  if (!cfg) throw new Error("contracts: keine Konfiguration");
  const m = balance.market;
  const expected = expectedPriceAt(input.k, input.r, input.rT, input.termMs, m.reversionHalfLifeHours);
  const a = contractSurcharge(cfg, input.termMs, input.qty, m.depth[input.resource] ?? 0, input.bonus);
  const baseRef = m.refPrice[input.resource];
  const clamp = (p: number) => Math.min(m.ceilFactor * baseRef, Math.max(m.floorFactor * baseRef, p));
  if (input.side === "buy") {
    const basis = Math.max(input.k, expected);
    const price = clamp(basis * (1 + a));
    const feePerUnit = Math.min(price, cfg.baseFee * basis);
    return { price, basis, expected, surcharge: a, feePerUnit, buyerUnit: price, sellerUnit: price - feePerUnit };
  }
  const basis = Math.min(input.k, expected);
  const price = clamp(basis * (1 - a));
  const feePerUnit = cfg.baseFee * basis;
  return { price, basis, expected, surcharge: a, feePerUnit, buyerUnit: price + feePerUnit, sellerUnit: price };
}

/** Preisband für Verträge zwischen Spielern: [(1 − band) · min(K, E), (1 + band) · max(K, E)]. */
export function playerPriceBand(k: number, expected: number, band: number): { min: number; max: number } {
  return { min: (1 - band) * Math.min(k, expected), max: (1 + band) * Math.max(k, expected) };
}

/** Spielervertrag: Käufer zahlt den Preis, Verkäufer bekommt ihn abzüglich Grundaufschlag (Gebührentopf). */
export function playerContractUnits(price: number, cfg: ContractsBalance): { buyerUnit: number; sellerUnit: number } {
  return { buyerUnit: price, sellerUnit: price * (1 - cfg.baseFee) };
}

/** Anzahlung bzw. Pfand in Cent: depositShare des Vertragswerts, aufgerundet. */
export function depositCents(qty: number, unit: number, share: number): number {
  return ceilToCents(qty * unit * share);
}

// ---------------------------------------------------------------- Abwicklung

export interface SettleInput {
  qty: number;
  buyerUnit: number;
  sellerUnit: number;
  /** Anzahlung des Käufers in Treuhand (KI als Käufer: der volle Kaufpreis). */
  buyerDepositCents: number;
  /** Pfand des Verkäufers in Treuhand (KI als Verkäuferin: 0, ihre Ware liegt in Treuhand). */
  sellerPledgeCents: number;
  /** Ware, die der Verkäufer liefern kann (KI: die Treuhandware). */
  goodsAvailable: number;
  /** Kredite des Käufers auf dem Konto (ohne Anzahlung). */
  buyerCreditsCents: number;
  penaltyShare: number;
}

export interface SettleResult {
  /** Erfüllte Menge. */
  qty: number;
  /** Nicht erfüllt, weil die Kredite des Käufers nicht reichten. */
  buyerShort: number;
  /** Nicht erfüllt, weil die Ware des Verkäufers fehlte. */
  sellerShort: number;
  /** Kaufpreis der erfüllten Menge (aus Anzahlung und Konto). */
  buyerPaysCents: number;
  /** Davon vom Konto des Käufers. */
  fromAccountCents: number;
  buyerRefundCents: number;
  buyerPenaltyCents: number;
  sellerGetsCents: number;
  sellerPledgeRefundCents: number;
  sellerPenaltyCents: number;
  /** Gebührentopf: Differenz Käuferpreis − Verkäufererlös. */
  feeCents: number;
  full: boolean;
}

/** Größte Menge q ≤ qty, die der Käufer bezahlen kann: Preis(q) ≤ Anzahlung − Strafe(qty − q) + Konto. */
function payableQty(i: SettleInput): number {
  const ok = (q: number) =>
    ceilToCents(q * i.buyerUnit) <= i.buyerDepositCents - penaltyCents(i.qty - q, i.buyerUnit, i.penaltyShare, i.buyerDepositCents) + i.buyerCreditsCents;
  if (ok(i.qty)) return i.qty;
  let lo = 0;
  let hi = i.qty;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (ok(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

function penaltyCents(units: number, unit: number, share: number, capCents: number): number {
  if (!(units > 0)) return 0;
  return Math.min(capCents, floorToCents(units * unit * share));
}

/**
 * Abwicklung bei Fälligkeit (bzw. nach der Nachfrist): erfüllt wird, so weit Ware und Kredite reichen. Für den nicht
 * erfüllten Teil verfällt penaltyShare seines Werts aus Anzahlung bzw. Pfand der säumigen Seite (beide, wenn beide
 * säumig sind); der Rest von Anzahlung und Pfand geht zurück. Alles in ganzen Cent; die Summe geht auf.
 */
export function settleContract(i: SettleInput): SettleResult {
  const goods = Math.max(0, Math.min(i.qty, Math.floor(i.goodsAvailable)));
  const payable = payableQty(i);
  const qty = Math.min(goods, payable);
  const sellerShort = i.qty - goods;
  const buyerShort = i.qty - payable;
  const buyerPenaltyCents = penaltyCents(buyerShort, i.buyerUnit, i.penaltyShare, i.buyerDepositCents);
  const sellerPenaltyCents = penaltyCents(sellerShort, i.sellerUnit, i.penaltyShare, i.sellerPledgeCents);
  const depositLeft = i.buyerDepositCents - buyerPenaltyCents;
  const buyerPaysCents = ceilToCents(qty * i.buyerUnit);
  const fromDeposit = Math.min(depositLeft, buyerPaysCents);
  const sellerGetsCents = Math.min(buyerPaysCents, floorToCents(qty * i.sellerUnit));
  return {
    qty, buyerShort, sellerShort, buyerPaysCents,
    fromAccountCents: buyerPaysCents - fromDeposit,
    buyerRefundCents: depositLeft - fromDeposit,
    buyerPenaltyCents,
    sellerGetsCents,
    sellerPledgeRefundCents: i.sellerPledgeCents - sellerPenaltyCents,
    sellerPenaltyCents,
    feeCents: buyerPaysCents - sellerGetsCents,
    full: qty === i.qty,
  };
}

/** Kündigung: penaltyShare des gekündigten Werts verfällt aus der Sicherheit der kündigenden Seite, der Rest geht zurück. */
export function cancelPenaltyCents(qty: number, unit: number, share: number, securityCents: number): number {
  return penaltyCents(qty, unit, share, securityCents);
}

// ---------------------------------------------------------------- Laufzeiten, Abos, Saisonende

/** Fälligkeiten eines Abos: Tranche k nach k Tagen (k = 1 … days). */
export function aboDueTimes(nowMs: number, days: number): number[] {
  return Array.from({ length: Math.max(0, Math.floor(days)) }, (_, i) => nowMs + (i + 1) * MS_PER_DAY);
}

/** Laufzeiten (Tage), deren Fälligkeit spätestens bufferHours vor Saisonende liegt. Ohne Saisonende: alle. */
export function allowedDays(days: readonly number[], nowMs: number, seasonEndMs: number | null, bufferHours: number): number[] {
  if (seasonEndMs === null) return [...days];
  const last = seasonEndMs - bufferHours * MS_PER_HOUR;
  return days.filter((d) => nowMs + d * MS_PER_DAY <= last);
}

// ---------------------------------------------------------------- Tageslimit

export interface DuePoint {
  atMs: number;
  qty: number;
}

/**
 * Höchste Summe in einem 24-h-Fenster [s, s + 24 h), das einen der neuen Punkte enthält (bestehende Punkte
 * eingerechnet). Das Maximum über alle Fenster wird bei einem Fenster erreicht, das an einem Punkt beginnt.
 */
export function maxWindowLoad(existing: readonly DuePoint[], added: readonly DuePoint[], windowMs = 24 * MS_PER_HOUR): number {
  const all = [...existing, ...added].filter((p) => p.qty > 0).sort((a, b) => a.atMs - b.atMs);
  let max = 0;
  for (const s of all) {
    const end = s.atMs + windowMs;
    if (!added.some((n) => n.atMs >= s.atMs && n.atMs < end)) continue;
    let sum = 0;
    for (const p of all) if (p.atMs >= s.atMs && p.atMs < end) sum += p.qty;
    max = Math.max(max, sum);
  }
  return max;
}

/** Vertragslieferungen der nächsten 24 h (für den freien Rahmen der Börse). */
export function reservedNext24h(points: readonly DuePoint[], nowMs: number): number {
  return points.filter((p) => p.atMs >= nowMs && p.atMs < nowMs + 24 * MS_PER_HOUR).reduce((s, p) => s + p.qty, 0);
}

// ---------------------------------------------------------------- KI-Kontingente

export interface KiStock {
  /** Bestand im Hafen der KI (ohne Treuhand). */
  stock: number;
  capacity: number;
  /** Ware der KI in Treuhand (zugesagte Verkäufe). */
  escrowed: number;
  /** Zugesagte, noch nicht gelieferte Käufe der KI. */
  incoming: number;
  /** Davon mit diesem Menschen (Verkauf bzw. Kauf, je nach Richtung). */
  humanCommitted: number;
}

/**
 * Freies Kontingent einer KI für einen Menschen in Einheiten, abgerundet auf quotaStep. Richtung aus Sicht des
 * Spielers: "buy" = die KI verkauft (ab sellFromFill, quotaShare des Bestands einschließlich Treuhand abzüglich
 * zugesagter Mengen), "sell" = die KI kauft (bis buyToFill, quotaShare des freien Platzes abzüglich zugesagter Käufe).
 * Je Mensch höchstens 1/perHumanDivisor des Kontingents.
 */
export function kiQuota(side: ContractSide, s: KiStock, cfg: ContractsBalance, profile?: ContractKiProfile): number {
  const ki = cfg.ki;
  if (!(s.capacity > 0)) return 0;
  let total: number;
  let used: number;
  if (side === "buy") {
    const holding = s.stock + s.escrowed;
    if (holding / s.capacity < ki.sellFromFill) return 0;
    total = ki.quotaShare * holding;
    used = s.escrowed;
  } else {
    const filled = s.stock + s.incoming;
    if (filled / s.capacity > ki.buyToFill) return 0;
    total = ki.quotaShare * Math.max(0, s.capacity - s.stock);
    used = s.incoming;
  }
  const perHuman = total / Math.max(1, ki.perHumanDivisor) - s.humanCommitted;
  let free = Math.max(0, Math.min(total - used, perHuman));
  if (profile?.maxQty !== undefined) free = Math.min(free, profile.maxQty);
  const step = Math.max(1, ki.quotaStep);
  return Math.floor(free / step) * step;
}

/** Charakter einer KI (null: bietet keine Verträge an). */
export function kiProfile(cfg: ContractsBalance, profile: string | null | undefined): ContractKiProfile | null {
  return profile ? (cfg.ki.profiles[profile] ?? null) : null;
}

/** Bietet die KI diese Richtung für diese Ressource an? Richtung aus Sicht des Spielers. */
export function kiOffers(p: ContractKiProfile, side: ContractSide, resource: string): boolean {
  return side === "buy" ? p.sells.includes(resource) : p.buys.includes(resource);
}
