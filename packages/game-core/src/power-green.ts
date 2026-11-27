// Ökostrom, Elektrolyse und Seekabel (v1.21, docs/REGELN-STROM.md). Reine Hilfen für die Fortschreibung in power.ts:
// - Ökostrom ist Strom aus Wind und Sonne (und was ein Seekabel liefert, denn es trägt nur Ökostrom). Er deckt den
//   Bedarf zuerst, lädt dann den Speicher; das Kraftwerk deckt den Rest. Der Speicher merkt sich, wie viel seiner
//   Ladung aus Ökostrom stammt (powerLog.storedGreen), und gibt sie anteilig wieder ab.
// - Elektrolyse wandelt nur Ökostrom-Überschuss (nach Bedarf und Speicher) in Treibstoff; Kraftwerksstrom nie,
//   sonst würde Treibstoff zu mehr Treibstoff.
// - Seekabel: Der abgebende Hafen schickt seinen restlichen Ökostrom-Überschuss (nach der Elektrolyse) bis zur
//   Leistung seiner Kabelstation ins Kabel (cable.sent). Der Server rechnet alle tickMinutes ab: Leitungsverlust,
//   Preis, Gutschrift in den Kabelpuffer des Empfängers (cable.buffer). Der Empfänger zieht bei Mangel aus dem Puffer,
//   vor dem Speicher. Kabelstrom wird weder gespeichert noch elektrolysiert noch weitergeleitet.
// - Grüner Hafen: Ökostrom-Anteil am gedeckten Bedarf der letzten windowHours Stunden ≥ shareMin → Produktion +bonus.
import type { Balance, BaseState } from "./types.ts";
import type { Modifiers } from "./modifiers.ts";
import { buildingLevel } from "./economy.ts";

const HOUR_MS = 3600000;

/** Werte unter `power.green` in balance.json. */
export interface GreenBalance {
  /** Mindestanteil Ökostrom am gedeckten Bedarf (0,6 = 60 %). */
  shareMin: number;
  /** Produktionsbonus als Anteil (0,03 = +3 %). */
  bonus: number;
  /** Betrachtungsfenster in Stunden. */
  windowHours: number;
  /** Mindestbedarf im Fenster (Strom-Stunden), damit der Anteil zählt. */
  minTotal: number;
}

/** Werte unter `power.cable` in balance.json. */
export interface CableBalance {
  /** Höchste Entfernung der beiden Häfen in km. */
  maxKm: number;
  /** Leitungsverlust je 100 km (0,1 = 10 %). */
  lossPer100Km: number;
  /** Kabelpuffer des Empfängers in Stunden Kabelleistung. */
  bufferHours: number;
  /** Abrechnung alle … Minuten. */
  tickMinutes: number;
  /** Höchstpreis in Krediten je Strom-Stunde. */
  maxPrice: number;
}

/** Ein Hafen hat höchstens ein Kabel: als Abgebender (out) oder als Empfänger (in). */
export interface CableLink {
  id: number;
  role: "out" | "in";
  /** Abgebender: seit der letzten Abrechnung ins Kabel geschickt (Strom-Stunden). */
  sent?: number;
  /** Empfänger: gelieferter, noch nicht genutzter Strom (Strom-Stunden). */
  buffer?: number;
}

/** Zähler des Stromnetzes je Hafen (Saison). */
export interface PowerLog {
  /** Anteil der Speicherladung aus Ökostrom (Strom-Stunden). */
  storedGreen: number;
  /** Stundenwerte [Stunde seit Epoche, Ökostrom genutzt, Bedarf gedeckt] der letzten windowHours + 1 Stunden. */
  hours: [number, number, number][];
  /** Genutzter Ökostrom insgesamt (Bedarf, Elektrolyse, Kabel; Strom-Stunden). */
  greenUsed: number;
  /** Treibstoff aus Elektrolyse insgesamt. */
  fuelMade: number;
  /** Ins Kabel geschickt insgesamt (vor Verlust). */
  sent: number;
  /** Aus dem Kabelpuffer genutzt insgesamt. */
  drawn: number;
  /** Verfallener Überschuss insgesamt. */
  wasted: number;
}

export const DEFAULT_GREEN: GreenBalance = { shareMin: 0.6, bonus: 0.03, windowHours: 24, minTotal: 24 };

export function greenBalance(balance: Balance): GreenBalance | null {
  return balance.power?.green ?? null;
}

export function cableBalance(balance: Balance): CableBalance | null {
  return balance.power?.cable ?? null;
}

export function emptyPowerLog(): PowerLog {
  return { storedGreen: 0, hours: [], greenUsed: 0, fuelMade: 0, sent: 0, drawn: 0, wasted: 0 };
}

export function clonePowerLog(l: PowerLog | undefined): PowerLog {
  return l ? { ...l, hours: l.hours.map((h) => [h[0], h[1], h[2]] as [number, number, number]) } : emptyPowerLog();
}

/** Elektrolyse: Aufnahme in Strom je Stunde und Strom je Treibstoff. */
export function electrolysisSpecs(base: BaseState, balance: Balance): { rate: number; ratio: number } {
  let rate = 0;
  let ratio = 10;
  for (const [id, def] of Object.entries(balance.buildings)) {
    if (!def.electrolysisPerLevel) continue;
    rate += def.electrolysisPerLevel * buildingLevel(base, id);
    ratio = def.electrolysisRatio ?? ratio;
  }
  return { rate, ratio };
}

/** Gebäude-ID der Kabelstation (erstes Gebäude mit cablePerLevel), null ohne. */
export function cableBuilding(balance: Balance): string | null {
  for (const [id, def] of Object.entries(balance.buildings)) if (def.cablePerLevel) return id;
  return null;
}

/** Läuft zum Zeitpunkt t eine Sabotage an der Kabelstation? */
export function cableSabotaged(base: BaseState, t: number, balance: Balance): boolean {
  const s = base.intel?.sabotage;
  const id = cableBuilding(balance);
  return !!s && !!id && s.target === id && s.fromMs <= t && t < s.untilMs;
}

/** Leistung der Kabelstation (Strom je Stunde) zum Zeitpunkt t; 0 ohne Station oder bei Sabotage. */
export function cableCapacity(base: BaseState, t: number, balance: Balance): number {
  const id = cableBuilding(balance);
  if (!id) return 0;
  const l = buildingLevel(base, id);
  if (l < 1 || cableSabotaged(base, t, balance)) return 0;
  return (balance.buildings[id].cablePerLevel ?? 0) * l;
}

/** Kabelpuffer des Empfängers (Strom-Stunden). */
export function cableBufferCap(base: BaseState, balance: Balance): number {
  const c = cableBalance(balance);
  const id = cableBuilding(balance);
  if (!c || !id) return 0;
  return (balance.buildings[id].cablePerLevel ?? 0) * buildingLevel(base, id) * c.bufferHours;
}

/** Anteil, der nach `km` ankommt (1 − Verlust, nie unter 0). */
export function cableDelivered(km: number, balance: Balance): number {
  const c = cableBalance(balance);
  if (!c) return 0;
  return Math.max(0, 1 - (c.lossPer100Km * km) / 100);
}

/** Verteilt Ökostrom und gedeckten Bedarf eines Stücks [from, to) mit konstanten Raten auf die Stundenwerte. */
export function logHours(log: PowerLog, from: number, to: number, greenRate: number, totalRate: number, windowHours: number): void {
  let x = from;
  while (x < to) {
    const h = Math.floor(x / HOUR_MS);
    const end = Math.min(to, (h + 1) * HOUR_MS);
    const hours = (end - x) / HOUR_MS;
    const last = log.hours[log.hours.length - 1];
    if (last && last[0] === h) {
      last[1] += greenRate * hours;
      last[2] += totalRate * hours;
    } else log.hours.push([h, greenRate * hours, totalRate * hours]);
    x = end;
  }
  const keepFrom = Math.floor(to / HOUR_MS) - windowHours;
  if (log.hours.length > 0 && log.hours[0][0] < keepFrom) log.hours = log.hours.filter((e) => e[0] >= keepFrom);
}

/** Ökostrom-Anteil der letzten windowHours Stunden bis nowMs (einschließlich der laufenden Stunde). */
export function greenShare(base: BaseState | null | undefined, nowMs: number, balance: Balance): { share: number; green: number; total: number } {
  const g = greenBalance(balance) ?? DEFAULT_GREEN;
  const from = Math.floor(nowMs / HOUR_MS) - g.windowHours;
  let green = 0;
  let total = 0;
  for (const [h, gr, tot] of base?.powerLog?.hours ?? []) {
    if (h < from) continue;
    green += gr;
    total += tot;
  }
  return { share: total > 0 ? Math.min(1, green / total) : 0, green, total };
}

/** Grüner Hafen? (Anteil ≥ shareMin bei genug Bedarf im Fenster.) */
export function isGreenHarbor(base: BaseState | null | undefined, nowMs: number, balance: Balance): boolean {
  const g = greenBalance(balance);
  if (!g || !base) return false;
  const s = greenShare(base, nowMs, balance);
  return s.total >= g.minTotal && s.share >= g.shareMin - 1e-9;
}

/** Modifikator-Quelle „Ökostrom“: Grüner Hafen → Gebäudeproduktion aller Ressourcen +bonus. */
export function greenModifiers(base: BaseState | null | undefined, nowMs: number, balance: Balance): Modifiers {
  const g = greenBalance(balance);
  if (!g || !isGreenHarbor(base, nowMs, balance)) return {};
  const production: Record<string, number> = {};
  for (const r of balance.resources) production[r] = 1 + g.bonus;
  return { production };
}

export interface CableTransfer {
  out: BaseState;
  in: BaseState;
  /** Im Kabelpuffer angekommen (Strom-Stunden). */
  delivered: number;
  /** Unterwegs verloren oder verfallen (Puffer voll, Sabotage, Kredite reichen nicht). */
  lost: number;
  /** Preis der Lieferung in Krediten (auf Cent abgerundet). */
  cost: number;
}

/**
 * Abrechnung eines Kabels: Beide Häfen sind bis nowMs fortgeschrieben. Das seit der letzten Abrechnung Gesendete
 * kommt mit Leitungsverlust an, höchstens bis der Puffer voll ist und nur so viel, wie der Empfänger bezahlen kann
 * (`credits`, Preis `price` je Strom-Stunde). Sabotage an einer der Stationen: die Sendung geht verloren.
 */
export function transferCable(out: BaseState, inn: BaseState, km: number, price: number, credits: number, nowMs: number, balance: Balance): CableTransfer {
  const o = { ...out, cable: out.cable ? { ...out.cable } : null };
  const i = { ...inn, cable: inn.cable ? { ...inn.cable } : null };
  const sent = Math.max(0, o.cable?.sent ?? 0);
  if (o.cable) o.cable.sent = 0;
  let delivered = 0;
  if (o.cable?.role === "out" && i.cable?.role === "in" && !cableSabotaged(out, nowMs, balance) && !cableSabotaged(inn, nowMs, balance)) {
    const buffer = Math.max(0, i.cable.buffer ?? 0);
    delivered = Math.min(sent * cableDelivered(km, balance), Math.max(0, cableBufferCap(inn, balance) - buffer));
    if (price > 0) delivered = Math.min(delivered, Math.max(0, credits) / price);
    delivered = Math.floor(delivered * 1000) / 1000;
    i.cable.buffer = buffer + delivered;
  }
  const cost = price > 0 ? Math.floor(delivered * price * 100) / 100 : 0;
  return { out: o as BaseState, in: i as BaseState, delivered, lost: Math.max(0, sent - delivered), cost };
}
