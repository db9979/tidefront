// Saisonfinale „Leviathan“ (docs/REGELN.md, Abschnitt Saisonfinale; Vorlage docs/VORLAGE-SAISONFINALE.md): eine
// Kartell-Armada aus Geschwadern (Schnellboote mit Miliz) und einem Flaggschiff aus Sektionen, die alle gemeinsam
// versenken. Rein: Zeitplan, Stärke, Zusammensetzung, Abschnitt je Angriff, Beute, Probekampf. Werte unter
// balance.worldEvents.finale; das Flaggschiff ist die NPC-Einheit `flaggschiff` (eine Sektion).
import type { AttackerInput, Balance, Counts, ResourceMap } from "./types.ts";
import { resolveBattle } from "./combat.ts";
import { worldEventsBalance } from "./world-events.ts";

const HOUR_MS = 3600000;
const DAY_MS = 24 * HOUR_MS;

export interface FinaleBalance {
  /** Saisonlänge, auf die sich die Tage beziehen; bei anderer Länge werden alle Zeiten proportional umgerechnet. */
  referenceSeasonDays: number;
  /** Ankündigung so viele Tage nach Saisonbeginn (35,5 = Tag 36, 12:00). */
  announceAfterDays: number;
  /** Erscheinen der Armada (37,5 = Tag 38, 12:00). */
  appearAfterDays: number;
  /** Dauer bis zum Abzug in Stunden (bei 42 Tagen Saison). */
  durationHours: number;
  /** Teilnehmer: in den letzten so vielen Stunden aktiv (KI-Spieler zählen immer). */
  activeHours: number;
  /** Stärke H = referenceFactor × Σ K der Teilnehmer, mindestens minHp, mal Kartellstärke-Regler. */
  referenceFactor: number;
  minHp: number;
  /** Anteil der Geschwader an H (Rest: Flaggschiff). */
  squadronShare: number;
  milizPerBoat: number;
  /** Abschnitt je Angriff: sectorFactor × K des Verbands in Schnellbooten, mindestens minSectorBoats. */
  sectorFactor: number;
  minSectorBoats: number;
  /** Beute je vernichtetem Lebenspunkt (Richtwert), Mischung wie der Beutepool der Großflotte. */
  lootPerHp: number;
  lootMix: ResourceMap;
  /** Flaggschiff versenkt: Schatz von treasureShare × H (Richtwert). */
  treasureShare: number;
  /** Nicht im Bezug K (Kriegsschiffe und Flugzeuge ohne diese). */
  excludeUnits: string[];
  /** Vorhuten: liegen zwei Teilnehmerhäfen weiter auseinander, bekommt jeder Hafen weiter als vanguardKm vom Sammelpunkt eine Vorhut. */
  vanguardSpreadKm: number;
  vanguardKm: number;
  /** Probekampf (Vorschau, KI): Durchläufe. */
  probeRuns: number;
  /** KI-Spieler: höchstens alle botIntervalHours ein Angriff. */
  botIntervalHours: number;
  /** Marktnachricht während der Armada (wie Kriegslage). */
  market?: { pct: Record<string, number>; fadeHours: number };
  /** v1.35 (Nutzerentscheid 10A): KI-Spieler zählen mit diesem Anteil ihres K zur Stärke H (fehlt er: voll). */
  botKFactor?: number;
  /**
   * v1.35 (Nutzerentscheid 1C): U-Jagd der Armada-Geschwader (Wasserbomben je Schnellboot gegen getauchte U-Boote). Gilt
   * nur in Kämpfen gegen die Armada (finaleBattleBalance); Kartell, Nester und übrige Weltereignisse bleiben ohne U-Jagd.
   */
  squadronUJagd?: number;
  /** v1.35 (Nutzerentscheid 9C): gewöhnliche Weltereignisse bis zu diesem Saisontag (fehlt er: bis zur Ankündigung). */
  ordinaryEventsUntilDays?: number;
}

export function finaleBalance(balance: Balance): FinaleBalance | null {
  return (worldEventsBalance(balance) as { finale?: FinaleBalance }).finale ?? null;
}

function need(balance: Balance): FinaleBalance {
  const f = finaleBalance(balance);
  if (!f) throw new Error("balance.worldEvents.finale fehlt");
  return f;
}

// ---------------------------------------------------------------- Zeitplan

export interface FinaleSchedule {
  announceMs: number;
  appearMs: number;
  endMs: number;
}

/** Zeitplan einer Saison: Tage relativ zu referenceSeasonDays, bei anderer Saisonlänge proportional; endet vor dem Saisonende. */
export function finaleSchedule(seasonStartMs: number, seasonEndMs: number, balance: Balance): FinaleSchedule {
  const f = need(balance);
  const scale = Math.max(0, seasonEndMs - seasonStartMs) / (f.referenceSeasonDays * DAY_MS);
  const announceMs = Math.round(seasonStartMs + f.announceAfterDays * DAY_MS * scale);
  const appearMs = Math.round(seasonStartMs + f.appearAfterDays * DAY_MS * scale);
  const endMs = Math.min(seasonEndMs - 1, Math.round(appearMs + f.durationHours * HOUR_MS * scale));
  return { announceMs, appearMs, endMs };
}

/** Ende der gewöhnlichen Weltereignisse (ordinaryEventsUntilDays, sonst die Ankündigung), proportional zur Saisonlänge. */
export function finaleOrdinaryUntil(seasonStartMs: number, seasonEndMs: number, balance: Balance): number {
  const f = need(balance);
  const sch = finaleSchedule(seasonStartMs, seasonEndMs, balance);
  if (f.ordinaryEventsUntilDays === undefined) return sch.announceMs;
  const scale = Math.max(0, seasonEndMs - seasonStartMs) / (f.referenceSeasonDays * DAY_MS);
  return Math.min(sch.appearMs, Math.round(seasonStartMs + f.ordinaryEventsUntilDays * DAY_MS * scale));
}

/**
 * Balance für Kämpfe gegen die Armada: mit squadronUJagd bekommen die Schnellboote (nur hier) Wasserbomben gegen
 * getauchte U-Boote. Ohne Wert dasselbe Objekt.
 */
export function finaleBattleBalance(balance: Balance): Balance {
  const u = finaleBalance(balance)?.squadronUJagd;
  if (!u) return balance;
  const sb = balance.npcUnits.schnellboot;
  return { ...balance, npcUnits: { ...balance.npcUnits, schnellboot: { ...sb, attack: { ...sb.attack, uboot: u } } } };
}

/** Summe der K für die Stärke: KI-Spieler zählen × botKFactor (v1.35), Menschen voll. */
export function finaleSumK(parts: { k: number; bot: boolean }[], balance: Balance): number {
  const bf = need(balance).botKFactor ?? 1;
  return parts.reduce((s, p) => s + p.k * (p.bot ? bf : 1), 0);
}

// ---------------------------------------------------------------- Stärke und Zusammensetzung

/** Kriegsschiffe und Flugzeuge eines Verbands (ohne Truppen, Anlagen und die ausgeschlossenen Schiffe). */
export function finaleWarUnits(units: Counts, balance: Balance): Counts {
  const ex = new Set(need(balance).excludeUnits);
  const out: Counts = {};
  for (const [id, n] of Object.entries(units)) {
    const u = balance.units[id];
    if (n > 0 && u && u.branch !== "land" && !ex.has(id)) out[id] = n;
  }
  return out;
}

/** Bezug K: Lebenspunkte der Kriegsschiffe und Flugzeuge. */
export function finaleWarHp(units: Counts, balance: Balance): number {
  let s = 0;
  for (const [id, n] of Object.entries(finaleWarUnits(units, balance))) s += balance.units[id].hp * n;
  return s;
}

/** Stärke H aus der Summe der K aller Teilnehmer und dem Kartellstärke-Regler (Prozent). */
export function finaleStrength(sumK: number, cartelPct: number, balance: Balance): number {
  const f = need(balance);
  return Math.round(Math.max(f.minHp, f.referenceFactor * Math.max(0, sumK)) * (cartelPct / 100));
}

/** Lebenspunkte eines Geschwaderboots mit seiner Miliz. */
export function boatHp(balance: Balance): number {
  return balance.npcUnits.schnellboot.hp + need(balance).milizPerBoat * balance.npcUnits.piratenmiliz.hp;
}

export function sectionHp(balance: Balance): number {
  return balance.npcUnits.flaggschiff?.hp ?? 1000;
}

/** Armada aus H: squadronShare in Schnellbooten mit Miliz, der Rest Flaggschiff-Sektionen. */
export function composeFinale(totalHp: number, balance: Balance): Counts {
  const f = need(balance);
  const boats = Math.max(1, Math.round((f.squadronShare * totalHp) / boatHp(balance)));
  const sections = Math.max(1, Math.round(((1 - f.squadronShare) * totalHp) / sectionHp(balance)));
  return { schnellboot: boats, piratenmiliz: boats * f.milizPerBoat, flaggschiff: sections };
}

/**
 * Abschnitt für einen Verband mit Bezug K: sectorFactor × K / LP eines Schnellboots (mindestens minSectorBoats, höchstens
 * der Rest) mit ihrer Miliz. Sind die Geschwader versenkt, steht das ganze Flaggschiff (flagship = true).
 */
export function finaleSector(units: Counts, attackerK: number, balance: Balance): { defender: Counts; flagship: boolean } {
  const f = need(balance);
  const boats = units.schnellboot ?? 0;
  if (boats <= 0) return { defender: (units.flaggschiff ?? 0) > 0 ? { flaggschiff: units.flaggschiff } : {}, flagship: true };
  const n = Math.min(boats, Math.max(f.minSectorBoats, Math.round((f.sectorFactor * attackerK) / balance.npcUnits.schnellboot.hp)));
  const miliz = Math.min(units.piratenmiliz ?? 0, n * f.milizPerBoat);
  return { defender: miliz > 0 ? { schnellboot: n, piratenmiliz: miliz } : { schnellboot: n }, flagship: false };
}

/** Armada nach einem Kampf: Rest = vorher − Abschnitt + Überlebende des Abschnitts. */
export function afterSector(units: Counts, sector: Counts, survivors: Counts): Counts {
  const out: Counts = {};
  for (const id of new Set([...Object.keys(units), ...Object.keys(sector)])) {
    const n = (units[id] ?? 0) - (sector[id] ?? 0) + (survivors[id] ?? 0);
    if (n > 0) out[id] = n;
  }
  // Miliz ohne Boote gibt es nicht (sie ertrinkt mit den Booten).
  if ((out.schnellboot ?? 0) <= 0) delete out.piratenmiliz;
  return out;
}

/** Armada versenkt: weder Boote noch Sektionen übrig. */
export function finaleSunk(units: Counts): boolean {
  return (units.schnellboot ?? 0) <= 0 && (units.flaggschiff ?? 0) <= 0;
}

/** Ressourcen im Wert `value` (Richtwert, market.refPrice) in der Mischung lootMix, abgerundet. */
export function finaleLootValue(value: number, balance: Balance): ResourceMap {
  const f = need(balance);
  const price = balance.market.refPrice;
  const mixValue = Object.entries(f.lootMix).reduce((s, [r, v]) => s + v * (price[r] ?? 1), 0);
  const out: ResourceMap = {};
  for (const [r, v] of Object.entries(f.lootMix)) out[r] = mixValue > 0 ? Math.floor((v * Math.max(0, value)) / mixValue + 1e-9) : 0;
  return out;
}

/** Beute für vernichtete Lebenspunkte (ohne Laderaumgrenze; Gutschrift bei der Heimkehr). */
export function finaleLoot(destroyedHp: number, balance: Balance): ResourceMap {
  return finaleLootValue(need(balance).lootPerHp * destroyedHp, balance);
}

/** Schatz für das Versenken des Flaggschiffs. */
export function finaleTreasure(totalHp: number, balance: Balance): ResourceMap {
  return finaleLootValue(need(balance).treasureShare * totalHp, balance);
}

/** Probekampf mit festen Seeds: Siegquote (alle Schiffe des Abschnitts versenkt) und mittlerer Schaden in LP. */
export function finaleProbe(attacker: AttackerInput, sector: Counts, balance: Balance, runs = need(balance).probeRuns): { winRate: number; damageHp: number } {
  const all = { ...balance.units, ...balance.npcUnits };
  const hp = (c: Counts) => Object.entries(c).reduce((s, [id, n]) => s + (all[id]?.hp ?? 0) * n, 0);
  const before = hp(sector);
  let wins = 0, dmg = 0;
  const n = Math.max(1, runs);
  for (let i = 0; i < n; i++) {
    const r = resolveBattle(attacker, { units: sector, defenses: {} }, finaleBattleBalance(balance), Math.imul(i + 1, 0x9e3779b1) >>> 0);
    if (!r.ok) return { winRate: 0, damageHp: 0 };
    const left = r.report.defender.final;
    const ships = Object.entries(left).some(([id, k]) => k > 0 && all[id]?.branch === "see");
    if (!ships) wins++;
    dmg += before - (ships ? hp(left) : 0);
  }
  return { winRate: wins / n, damageHp: dmg / n };
}

/** Anteil am Gesamtschaden in ganzen Prozent (Erfolg „Armada-Jäger“). */
export function damageSharePct(hp: number, total: number): number {
  return total > 0 ? Math.floor((100 * Math.max(0, hp)) / total + 1e-9) : 0;
}
