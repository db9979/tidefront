// Weltpolitik, Fundament (docs/REGELN-WELTPOLITIK.md, Abschnitt 1): wirksame Balance zu einem Zeitpunkt.
// balanceAt(base, plan, ms) verschiebt befristet vorhandene Regler (Gebühr, Tageslimit, Vertragsbonus, Feldertrag,
// Überfallintervall, Kartellchancen, Ereignisgewichte) nach den Fenstern des Saisonplans (Gezeit und Beschlüsse des
// Seerats). Ohne wirkendes Fenster kommt dieselbe Balance (gleiche Referenz) zurück. Rein und deterministisch:
// Server, Worker, Bot-Zug und Client (Plan aus `meta`) rechnen damit dasselbe.
import type { Balance } from "./types.ts";

export const GEZEIT_KINDS = ["handelskrise", "rohstoffboom", "kartellfehde"] as const;
export type GezeitKind = (typeof GEZEIT_KINDS)[number];
export const BESCHLUSS_KINDS = ["handelsfrieden", "geleitschutz", "gebuehrensenkung", "gemeinsame_aktion"] as const;
export type BeschlussKind = (typeof BESCHLUSS_KINDS)[number];
export type WirkungKind = GezeitKind | BeschlussKind;
/** Was in einem Fenster gilt: eine Wirkung oder „Ruhige See“ (nichts). */
export type FensterEffect = WirkungKind | "ruhig";

/** Faktoren einer Wirkung (fehlend = 1 bzw. 0 bei kiBonus). */
export interface EffectDef {
  fee?: number;
  dailyLimit?: number;
  /** Additiv auf den Vertragsbonus aller KI-Profile (0,02 = + 2 Prozentpunkte). */
  kiBonus?: number;
  production?: number;
  fieldYield?: number;
  /** Kursverschiebung des Booms als Marktnachricht (z. B. −0,1). */
  pricePct?: number;
  raidInterval?: number;
  fieldCartelChance?: number;
  convoyCartelChance?: number;
  kindWeights?: Record<string, number>;
  playerTradeFee?: number;
  contractFee?: number;
  worldEventLoot?: number;
}

export interface PolitikBalance {
  referenceSeasonDays: number;
  /** Alles endet spätestens so viele Stunden vor der Finale-Ankündigung. */
  finaleGapHours: number;
  clamp: { min: number; max: number; raidIntervalMax: number; bonusMaxDelta: number };
  gezeit: {
    windowStartDays: number[];
    spreadDays: number;
    durationHours: number;
    earliestStartDays: number;
    minGapDays: number;
    latestEndDays: number;
    announceHours: number;
    kinds: GezeitKind[];
    notFirst: GezeitKind[];
    boomGoods: string[];
  };
  effects: Record<WirkungKind, EffectDef>;
  seerat: {
    openBeforeHours: number;
    closeBeforeHours: number;
    windowCatalog: BeschlussKind[];
    weeklyDays: number[];
    weeklyVoteHours: number;
    weeklyEffectHours: number;
    /** Kürzer darf eine (an einer Gezeit gekürzte) Wirkzeit nicht sein, sonst entfällt sie. */
    weeklyMinEffectHours: number;
    weeklyCatalog: BeschlussKind[];
    kiTotalWeight: number;
    allianceMaxShare: number;
    quorumShare: number;
    activeHours: number;
    kiPreference: Record<string, string[]>;
    /** Ächtung (kommt mit dem globalen Ruf): vorbereitet, aus. */
    aechtung: boolean;
  };
  ansehen: import("./politik-ansehen.ts").AnsehenBalance;
  gesuche: import("./politik-gesuche.ts").GesucheBalance;
}

export function politikOf(balance: Balance): PolitikBalance | null {
  return (balance as { politik?: PolitikBalance }).politik ?? null;
}

/** Ein Fenster des Saisonplans, wie es `meta` ausliefert. */
export interface PolitikWindow {
  id: number;
  /** gezeit: eines der 3 Gezeit-Fenster; woche: Wirkzeit eines Wochenbeschlusses. */
  slot: "gezeit" | "woche";
  idx: number;
  startMs: number;
  endMs: number;
  /** Ausgewürfelte Gezeit-Art (nur slot gezeit). */
  planKind: GezeitKind | null;
  /** Gut des Rohstoffbooms. */
  good: string | null;
  effect: FensterEffect;
  source: "plan" | "seerat" | "admin";
}

export interface PolitikPlan {
  windows: PolitikWindow[];
}

export const EMPTY_PLAN: PolitikPlan = Object.freeze({ windows: [] }) as PolitikPlan;

/** Zusammengefasste Faktoren aller zum Zeitpunkt wirkenden Fenster (nach der Klemme). */
export interface PolitikNow {
  /** Wirkende Fenster (ids), für Anzeige und Tests. */
  active: number[];
  fee: number;
  dailyLimit: number;
  kiBonus: number;
  /** Je Gut: Produktion und Feldertrag. */
  production: Record<string, number>;
  fieldYield: Record<string, number>;
  raidInterval: number;
  fieldCartelChance: number;
  convoyCartelChance: number;
  kindWeights: Record<string, number>;
  playerTradeFee: number;
  contractFee: number;
  worldEventLoot: number;
}

/** Wirkende Fenster zum Zeitpunkt ms (Beginn eingeschlossen, Ende ausgeschlossen), ohne „Ruhige See“. */
export function activeWindows(plan: PolitikPlan | null | undefined, ms: number): PolitikWindow[] {
  if (!plan) return [];
  return plan.windows.filter((w) => w.effect !== "ruhig" && w.startMs <= ms && ms < w.endMs);
}

const clampTo = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Faktoren der wirkenden Fenster (multiplikativ gestapelt, je Regler geklemmt); null ohne Wirkung. */
export function politikNow(base: Balance, plan: PolitikPlan | null | undefined, ms: number): PolitikNow | null {
  const cfg = politikOf(base);
  const active = activeWindows(plan, ms);
  if (!cfg || active.length === 0) return null;
  const n: PolitikNow = {
    active: active.map((w) => w.id), fee: 1, dailyLimit: 1, kiBonus: 0, production: {}, fieldYield: {}, raidInterval: 1,
    fieldCartelChance: 1, convoyCartelChance: 1, kindWeights: {}, playerTradeFee: 1, contractFee: 1, worldEventLoot: 1,
  };
  for (const w of active) {
    const e = cfg.effects[w.effect as WirkungKind];
    if (!e) continue;
    n.fee *= e.fee ?? 1;
    n.dailyLimit *= e.dailyLimit ?? 1;
    n.kiBonus += e.kiBonus ?? 0;
    if (w.good && e.production !== undefined) n.production[w.good] = (n.production[w.good] ?? 1) * e.production;
    if (w.good && e.fieldYield !== undefined) n.fieldYield[w.good] = (n.fieldYield[w.good] ?? 1) * e.fieldYield;
    n.raidInterval *= e.raidInterval ?? 1;
    n.fieldCartelChance *= e.fieldCartelChance ?? 1;
    n.convoyCartelChance *= e.convoyCartelChance ?? 1;
    for (const [k, f] of Object.entries(e.kindWeights ?? {})) n.kindWeights[k] = (n.kindWeights[k] ?? 1) * f;
    n.playerTradeFee *= e.playerTradeFee ?? 1;
    n.contractFee *= e.contractFee ?? 1;
    n.worldEventLoot *= e.worldEventLoot ?? 1;
  }
  const { min, max } = cfg.clamp;
  const c = (x: number) => clampTo(x, min, max);
  n.fee = c(n.fee);
  n.dailyLimit = c(n.dailyLimit);
  n.kiBonus = clampTo(n.kiBonus, -cfg.clamp.bonusMaxDelta, cfg.clamp.bonusMaxDelta);
  for (const k of Object.keys(n.production)) n.production[k] = c(n.production[k]);
  for (const k of Object.keys(n.fieldYield)) n.fieldYield[k] = c(n.fieldYield[k]);
  n.raidInterval = clampTo(n.raidInterval, min, cfg.clamp.raidIntervalMax);
  n.fieldCartelChance = c(n.fieldCartelChance);
  n.convoyCartelChance = c(n.convoyCartelChance);
  n.playerTradeFee = c(n.playerTradeFee);
  n.contractFee = c(n.contractFee);
  n.worldEventLoot = c(n.worldEventLoot);
  return n;
}

/** Wirksame Balance mit Angabe der Faktoren (nur auf Kopien gesetzt). */
export type EffectiveBalance = Balance & { politikNow?: PolitikNow };

const memo = new WeakMap<Balance, Map<string, EffectiveBalance>>();

function memoKey(plan: PolitikPlan, ms: number): string {
  return activeWindows(plan, ms).map((w) => `${w.id}:${w.effect}:${w.good ?? ""}`).join("|");
}

/**
 * Wirksame Balance zum Zeitpunkt ms. Ohne wirkendes Fenster: `base` selbst. Sonst eine (zwischengespeicherte) Kopie
 * mit verschobenen Reglern und `politikNow` (Faktoren für Stellen, die nicht in der Balance stehen: Produktion,
 * Spielerhandelsgebühr, Beute der Weltereignisse).
 */
export function balanceAt(base: Balance, plan: PolitikPlan | null | undefined, ms: number): EffectiveBalance {
  const now = politikNow(base, plan, ms);
  if (!now) return base;
  const key = memoKey(plan!, ms);
  let byKey = memo.get(base);
  if (!byKey) memo.set(base, (byKey = new Map()));
  const hit = byKey.get(key);
  if (hit) return hit;
  const b = structuredClone(base) as EffectiveBalance;
  applyNow(b, now);
  b.politikNow = now;
  if (byKey.size > 64) byKey.clear();
  byKey.set(key, b);
  return b;
}

function applyNow(b: EffectiveBalance, n: PolitikNow): void {
  b.market.fee *= n.fee;
  b.market.dailyLimitShareOfStorage *= n.dailyLimit;
  const contracts = b.market.contracts;
  if (contracts) {
    contracts.baseFee *= n.contractFee;
    for (const p of Object.values(contracts.ki.profiles)) p.bonus = (p.bonus ?? 0) + n.kiBonus;
  }
  b.pirates.raidIntervalHours *= n.raidInterval;
  const fields = (b as { fields?: { cartelRaidChance: number; kinds: Record<string, { resource: string; yieldPerHour: number[] }> } }).fields;
  if (fields) {
    fields.cartelRaidChance *= n.fieldCartelChance;
    for (const k of Object.values(fields.kinds)) {
      const f = n.fieldYield[k.resource];
      if (f !== undefined) k.yieldPerHour = k.yieldPerHour.map((y) => y * f);
    }
  }
  const c = b.convoys;
  if (c && n.convoyCartelChance !== 1) {
    const f = n.convoyCartelChance;
    c.cartelBaseChance *= f;
    c.cartelChancePer100Km *= f;
    c.cartelChancePer1000Value *= f;
    c.cartelMaxChance *= f;
    if (c.marketMaxChance !== undefined) c.marketMaxChance *= f;
  }
  const we = (b as { worldEvents?: { kindWeights: Record<string, number> } }).worldEvents;
  if (we) for (const [k, f] of Object.entries(n.kindWeights)) we.kindWeights[k] = (we.kindWeights[k] ?? 0) * f;
}

/** Nächster Zeitpunkt nach ms, an dem sich die wirksame Balance ändert (Beginn oder Ende eines Fensters), sonst null. */
export function nextChangeMs(plan: PolitikPlan | null | undefined, ms: number): number | null {
  let next: number | null = null;
  for (const w of plan?.windows ?? []) {
    if (w.effect === "ruhig") continue;
    for (const t of [w.startMs, w.endMs]) if (t > ms && (next === null || t < next)) next = t;
  }
  return next;
}

/** Name und ein Satz je Wirkung (Spielertext). */
export const WIRKUNG_TEXT: Record<FensterEffect, { name: string; satz: string }> = {
  handelskrise: { name: "Handelskrise", satz: "Börse teurer – Lieferverträge mit den KI-Spielern lohnen jetzt mehr." },
  rohstoffboom: { name: "Rohstoffboom", satz: "Ein Gut im Überfluss – jetzt fördern, Felder besetzen, später verkaufen." },
  kartellfehde: { name: "Kartellfehde", satz: "Das Kartell bekämpft sich selbst – weniger Überfälle, Zeit zum Aufholen." },
  handelsfrieden: { name: "Handelsfrieden", satz: "Börse und Spielerhandel kosten weniger Gebühr." },
  geleitschutz: { name: "Geleitschutz", satz: "Das Kartell fängt Konvois nur halb so oft ab." },
  gebuehrensenkung: { name: "Gebührensenkung", satz: "Börse und Lieferverträge kosten weniger Gebühr." },
  gemeinsame_aktion: { name: "Gemeinsame Aktion", satz: "Neue Weltereignisse tragen mehr Beute." },
  ruhig: { name: "Ruhige See", satz: "Nichts ändert sich." },
};
