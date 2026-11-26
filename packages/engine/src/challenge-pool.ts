// Tagesbefehle: Pool der Arten, Auswahl passend zum Fortschritt, Ziele, Belohnungen, Serienbonus, Spieltag.
// Reine Funktionen (keine Datenbank); die Datenbankseite steht in challenges.ts.
import {
  mulberry32,
  productionRates,
  storageCapacity,
  upgradeDurationMs,
  type BaseState,
  type ResourceMap,
} from "@tidefront/game-core";
import { balance } from "./context.ts";

// ---------------------------------------------------------------- Spieltag (Tageswechsel 0:00 Uhr Ortszeit)

const DAY_MS = 86400000;

/** Zeitzone des Spieltags: TZ der Umgebung, sonst Europe/Berlin. */
export function gameTimeZone(): string {
  const tz = process.env.TZ;
  if (tz && !tz.startsWith(":")) {
    try {
      new Intl.DateTimeFormat("en-CA", { timeZone: tz });
      return tz;
    } catch {
      /* ungültig: Vorgabe */
    }
  }
  return "Europe/Berlin";
}

function parts(ms: number): { y: number; m: number; d: number; h: number; min: number; s: number } {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: gameTimeZone(), year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), h: Number(p.hour), min: Number(p.minute), s: Number(p.second) };
}

/** Kalendertag des Zeitpunkts in der Spielzeitzone, z. B. "2026-11-26". */
export function dayKey(ms: number): string {
  const p = parts(ms);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

/** Tag um n Tage verschoben. */
export function addDays(key: string, n: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Beginn des Tages (0:00 Uhr Ortszeit) in ms seit Epoche. */
export function dayStartMs(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  const wall = Date.UTC(y, m - 1, d);
  let guess = wall;
  // Versatz zweimal bestimmen (Sommerzeitwechsel am selben Tag).
  for (let i = 0; i < 2; i++) {
    const p = parts(guess);
    const offset = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - guess;
    guess = wall - offset;
  }
  return guess;
}

/** Nächster Tageswechsel nach ms. */
export function nextDayStartMs(ms: number): number {
  return dayStartMs(addDays(dayKey(ms), 1));
}

// ---------------------------------------------------------------- Pool

export type Tier = 0 | 1 | 2;
export const TIER_NAMES = ["leicht", "mittel", "schwer"] as const;

/** Was über den Spieler bekannt ist, um passende Befehle zu wählen. */
export interface PoolContext {
  /** Stufe der Kommandozentrale: Maß für den Fortschritt. */
  stage: number;
  levels: Record<string, number>;
  /** Stückzahl je Einheit (daheim und unterwegs). */
  units: Record<string, number>;
  resources: ResourceMap;
  capacity: number;
  /** Gebäudeproduktion plus Grundrate je Stunde. */
  production: ResourceMap;
  marketOpen: boolean;
  /** Anfängerschutz vorbei: das Kartell greift an. */
  raidsPossible: boolean;
  /** Es gibt andere Spieler mit Hafen. */
  others: boolean;
}

export interface Spec {
  param: string | null;
  target: number;
}

interface KindDef {
  /** Ziel je Stufe; null = in dieser Stufe nicht im Angebot oder gerade nicht passend. */
  spec: (tier: Tier, c: PoolContext, rnd: () => number) => Spec | null;
  /** Anzeigetext (Deutsch). */
  text: (target: number, param: string | null) => string;
  icon: string;
}

const RES_NAME: Record<string, string> = { stahl: "Stahl", treibstoff: "Treibstoff", elektronik: "Elektronik", proviant: "Proviant" };
const PRODUCER: Record<string, string> = { stahl: "stahlwerk", treibstoff: "raffinerie", elektronik: "chipfabrik", proviant: "versorgungshof" };
const fmt = (n: number) => n.toLocaleString("de-DE");
const lvl = (c: PoolContext, id: string) => c.levels[id] ?? 0;
const growth = (c: PoolContext, per: number) => 1 + c.stage / per;
const round = (n: number, step: number) => Math.max(step, Math.round(n / step) * step);
const pick = <T,>(xs: T[], tier: Tier): T | null => xs[tier] ?? null;
const canLand = (c: PoolContext) => lvl(c, "werft") >= 1 && lvl(c, "kaserne") >= 1;
const canSail = (c: PoolContext) => lvl(c, "werft") >= 1 || lvl(c, "flugfeld") >= 1;
const one = (n: number, a: string, b: string) => (n === 1 ? a : b);

/** Höchste Nest-Stufe, die zum Fortschritt passt (1 bis 5). */
function nestCap(c: PoolContext): number {
  return Math.max(1, Math.min(5, 1 + Math.floor(c.stage / 3)));
}

/** Der Pool: mindestens 15 Arten. Schlüssel = kind in der Tabelle daily_challenge. */
export const KINDS: Record<string, KindDef> = {
  ausbau: {
    icon: "kommandozentrale",
    spec: (t) => ({ param: null, target: [1, 2, 3][t] }),
    text: (n) => `Schließe ${n} ${one(n, "Ausbau", "Ausbauten")} ab`,
  },
  bauschlange: {
    icon: "uhr",
    spec: (t) => (t < 2 ? { param: null, target: t === 0 ? Math.min(2, balance.building.queueSlots) : balance.building.queueSlots } : null),
    text: (n) => `Nutze die Bauschlange voll aus (${n} Aufträge gleichzeitig)`,
  },
  ausbildung_land: {
    icon: "schuetzen",
    spec: (t, c) => (lvl(c, "kaserne") >= 1 ? { param: "land", target: round([15, 40, 100][t] * growth(c, 4), 5) } : null),
    text: (n) => `Bilde ${fmt(n)} Bodentruppen aus`,
  },
  ausbildung_see: {
    icon: "korvette",
    spec: (t, c) => (lvl(c, "werft") >= 1 ? { param: "see", target: [1, 2, 4][t] + Math.floor(c.stage / 6) } : null),
    text: (n) => `Stelle ${n} ${one(n, "Schiff", "Schiffe")} in Dienst`,
  },
  ausbildung_luft: {
    icon: "abfangjaeger",
    spec: (t, c) => (lvl(c, "flugfeld") >= 1 ? { param: "luft", target: [1, 2, 4][t] + Math.floor(c.stage / 6) } : null),
    text: (n) => `Bilde ${n} ${one(n, "Flugzeug", "Flugzeuge")} aus`,
  },
  anlagen: {
    icon: "kuestenbatterie",
    spec: (t, c) => ({ param: null, target: [1, 2, 3][t] + (t === 2 ? Math.floor(c.stage / 5) : 0) }),
    text: (n) => `Errichte ${n} ${one(n, "Verteidigungsanlage", "Verteidigungsanlagen")}`,
  },
  lager: {
    icon: "lagerkomplex",
    spec: (t, c) => {
      // Die am wenigsten gefüllte Ressource; Ziel über dem aktuellen Bestand, höchstens 95 % des Lagers.
      const r = balance.resources.reduce((a, b) => ((c.resources[b] ?? 0) < (c.resources[a] ?? 0) ? b : a));
      const have = Math.floor(c.resources[r] ?? 0);
      const want = round(have + c.capacity * [0.15, 0.3, 0.5][t], 100);
      const target = Math.min(want, round(c.capacity * 0.95, 100));
      return target > have ? { param: r, target } : null;
    },
    text: (n, p) => `Lege einen Vorrat von ${fmt(n)} ${RES_NAME[p ?? ""] ?? p} an`,
  },
  produktion: {
    icon: "stahlwerk",
    spec: (t, c, rnd) => {
      if (t === 0) return null;
      const options = balance.resources.filter((r) => lvl(c, PRODUCER[r]) >= 1);
      if (options.length === 0) return null;
      const r = options[Math.floor(rnd() * options.length)];
      const rate = c.production[r] ?? 0;
      return { param: r, target: Math.max(Math.ceil(rate) + 1, Math.ceil(rate * (t === 1 ? 1.15 : 1.35))) };
    },
    text: (n, p) => `Steigere die ${RES_NAME[p ?? ""] ?? p}-Produktion auf ${fmt(n)} je Stunde`,
  },
  kommando: {
    icon: "kommandozentrale",
    spec: (t, c) => {
      // Nur solange der nächste Ausbau der Kommandozentrale höchstens 12 Stunden dauert.
      const next = c.stage + 1;
      if (t !== 2 || next > balance.building.maxLevel || upgradeDurationMs("kommandozentrale", next, balance) > 12 * 3600000) return null;
      return { param: null, target: next };
    },
    text: (n) => `Bringe die Kommandozentrale auf Stufe ${n}`,
  },
  nest: {
    icon: "kartell",
    spec: (t, c) => (t === 0 || !canLand(c) ? null : { param: String(t === 1 ? Math.max(1, nestCap(c) - 1) : nestCap(c)), target: 1 }),
    text: (_n, p) => `Besiege ein Piratennest der Stufe ${p} oder höher`,
  },
  kartell_abwehr: {
    icon: "schild",
    spec: (t, c) => (t === 2 && c.raidsPossible ? { param: null, target: 1 } : null),
    text: () => "Wehre einen Überfall des Kartells ab",
  },
  aufklaerung: {
    icon: "aufklaerung",
    spec: (t, c) => (canSail(c) ? pick([{ param: null, target: 1 }, { param: null, target: 2 }], t) : null),
    text: (n) => `Führe ${n} ${one(n, "Aufklärung", "Aufklärungen")} durch`,
  },
  transport: {
    icon: "transport",
    spec: (t, c) => (t > 0 && c.others && lvl(c, "werft") >= 1 ? { param: null, target: t } : null),
    text: (n) => `Bringe ${n} ${one(n, "Transport", "Transporte")} zu Mitspielern ans Ziel`,
  },
  handel: {
    icon: "credits",
    spec: (t, c) => (c.marketOpen ? { param: null, target: round([300, 1000, 3000][t] * (1 + Math.max(0, lvl(c, "hafenkommandantur") - 3) / 2), 50) } : null),
    text: (n) => `Handle an der Börse für ${fmt(n)} Kredite`,
  },
  wrack: {
    icon: "stahl",
    spec: (t, c) => (t > 0 && canSail(c) ? { param: null, target: round([0, 300, 1000][t] * growth(c, 5), 50) } : null),
    text: (n) => `Berge ${fmt(n)} Wrackgut`,
  },
  nachricht: {
    icon: "nav-bericht",
    spec: (t, c) => (t === 0 && c.others ? { param: null, target: 1 } : null),
    text: () => "Schreibe einem Mitspieler eine Nachricht",
  },
  beute: {
    icon: "ueberfall",
    spec: (t, c) => (t > 0 && canLand(c) ? { param: null, target: round([0, 1500, 4000][t] * growth(c, 4), 100) } : null),
    text: (n) => `Erbeute ${fmt(n)} Ressourcen bei Überfällen`,
  },
  sieg_ohne_verluste: {
    icon: "zerstoerer",
    spec: (t, c) => (t === 2 && canLand(c) ? { param: null, target: 1 } : null),
    text: () => "Gewinne einen Überfall ohne eigene Verluste",
  },
  forschung: {
    icon: "forschungsamt",
    spec: (t, c) => (t === 1 && lvl(c, "forschungsamt") >= 1 ? { param: null, target: 1 } : null),
    text: () => "Schließe eine Forschung ab",
  },
};

/** Arten, deren Fortschritt aus dem Zustand gelesen wird (beim Abruf), nicht aus Ereignissen. */
export const DERIVED_KINDS = new Set(["lager", "produktion", "nachricht", "kommando"]);

export function challengeText(kind: string, target: number, param: string | null): string {
  return KINDS[kind]?.text(target, param) ?? kind;
}

export function challengeIcon(kind: string): string {
  return KINDS[kind]?.icon ?? "anker";
}

// ---------------------------------------------------------------- Auswahl und Belohnung

/** Kontext aus dem (fortgeschriebenen) Stützpunkt. */
export function poolContext(state: BaseState, extra: { others: boolean; raidsPossible: boolean }): PoolContext {
  const units: Record<string, number> = {};
  for (const src of [state.units, state.unitsAway]) for (const [id, n] of Object.entries(src ?? {})) units[id] = (units[id] ?? 0) + n;
  const rates = productionRates(state, balance);
  const production: ResourceMap = {};
  for (const r of balance.resources) production[r] = (rates.buildingPerHour[r] ?? 0) + (balance.baseTricklePerHour[r] ?? 0);
  const harbor = state.buildings.hafenkommandantur ?? 0;
  return {
    stage: state.buildings.kommandozentrale ?? 0,
    levels: { ...state.buildings },
    units,
    resources: { ...state.resources },
    capacity: storageCapacity(state, balance),
    production,
    marketOpen: harbor >= (balance.buildings.hafenkommandantur.marketFromLevel ?? 3),
    raidsPossible: extra.raidsPossible,
    others: extra.others,
  };
}

function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

export interface Draw {
  kind: string;
  param: string | null;
  target: number;
}

/**
 * Zieht für eine Stufe eine Art, die zum Fortschritt passt und nicht in `exclude` steht. Gleiche Eingabe,
 * gleiches Ergebnis (Seed aus Spieler, Tag, Slot und Wurf).
 */
export function drawChallenge(c: PoolContext, tier: Tier, exclude: Set<string>, seedText: string): Draw | null {
  const rnd = mulberry32(hashSeed(seedText));
  const options: Draw[] = [];
  for (const kind of Object.keys(KINDS).sort()) {
    if (exclude.has(kind)) continue;
    const s = KINDS[kind].spec(tier, c, rnd);
    if (s && s.target > 0) options.push({ kind, ...s });
  }
  if (options.length === 0) return null;
  return options[Math.floor(rnd() * options.length)];
}

/** Drei Befehle für einen Tag: leicht, mittel, schwer, jede Art höchstens einmal. */
export function drawDay(c: PoolContext, seedText: string): (Draw & { slot: Tier })[] {
  const used = new Set<string>();
  const out: (Draw & { slot: Tier })[] = [];
  for (const tier of [0, 1, 2] as Tier[]) {
    const d = drawChallenge(c, tier, used, `${seedText}|${tier}`) ?? { kind: "ausbau", param: null, target: tier + 1 };
    used.add(d.kind);
    out.push({ ...d, slot: tier });
  }
  return out;
}

/** Punkte der Kategorie Befehle je Stufe. */
export const TIER_POINTS = [3, 6, 12];
const TIER_VALUE = [400, 1000, 2500];
const SHARE: Record<string, number> = { stahl: 0.4, treibstoff: 0.25, elektronik: 0.15, proviant: 0.2 };

/** Ressourcenpaket im Gesamtwert `value`, aufgeteilt nach festem Schlüssel, auf 10 gerundet. */
export function resourcePackage(value: number): ResourceMap {
  const out: ResourceMap = {};
  for (const r of balance.resources) out[r] = Math.round((value * (SHARE[r] ?? 0.25)) / 10) * 10;
  return out;
}

/** Belohnung eines Befehls: wächst mit der Kommandozentrale. */
export function challengeReward(tier: Tier, stage: number): { reward: ResourceMap; points: number } {
  return { reward: resourcePackage(TIER_VALUE[tier] * (1 + stage * 0.3)), points: TIER_POINTS[tier] };
}

/**
 * Serienbonus beim Abschluss eines Tages (alle drei Befehle abgeholt). Steigend: Tag 3 +10 Punkte,
 * Tag 7 +25, danach jeder 7. Tag 10 mehr (14: +35, 21: +45, …), dazu ein Ressourcenpaket.
 */
export function streakBonus(length: number, stage: number): { points: number; reward: ResourceMap } | null {
  let points = 0;
  if (length === 3) points = 10;
  else if (length >= 7 && length % 7 === 0) points = 25 + 10 * (length / 7 - 1);
  if (points === 0) return null;
  return { points, reward: resourcePackage(points * 150 * (1 + stage * 0.3)) };
}

/** Nächster Serientag mit Bonus. */
export function nextStreakMilestone(length: number): number {
  if (length < 3) return 3;
  if (length < 7) return 7;
  return (Math.floor(length / 7) + 1) * 7;
}
