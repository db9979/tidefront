// Erfolge und Wochenziele: reine Funktionen (keine Datenbank). Definitionen der Erfolge in balance.json
// (Block achievements), Spielwoche (Montag 0:00 Uhr in der Spielzeitzone), Pool und Auswahl der Wochenziele,
// Belohnungen. Die Datenbankseite steht in achievements.ts und weekly.ts.
import { mulberry32, type AchievementDef, type AchievementReward, type ResourceMap } from "@tidefront/game-core";
import { balance } from "./context.ts";
import { addDays, dayKey, dayStartMs, resourcePackage, type PoolContext } from "./challenge-pool.ts";

// ---------------------------------------------------------------- Erfolge

export const TIER_NAMES = ["Bronze", "Silber", "Gold"] as const;
/** Ab dieser Gebäudestufe gilt ein Gebäude als Prachtbau (Ausbaubild „Prachtbau“). */
export const PRACHTBAU_FROM = 18;

export interface Achievement extends AchievementDef {
  id: string;
}

/** Alle Erfolge in der Reihenfolge der Balance. */
export function achievementList(): Achievement[] {
  return Object.entries(balance.achievements?.list ?? {}).map(([id, d]) => ({ id, ...d }));
}

export function achievementById(id: string): Achievement | null {
  const d = balance.achievements?.list[id];
  return d ? { id, ...d } : null;
}

/** Erreichte Stufe (0 = keine, 1 Bronze, 2 Silber, 3 Gold) bei Zählerstand value. */
export function tierFor(value: number, thresholds: readonly number[]): number {
  let t = 0;
  for (const thr of thresholds) if (value >= thr) t++;
  return t;
}

/** Belohnung einer Stufe (1–3): eigene des Erfolgs, sonst die gemeinsame. */
export function tierReward(a: AchievementDef, tier: number): AchievementReward {
  return { ...(a.rewards?.[tier - 1] ?? balance.achievements?.rewards[tier - 1] ?? {}) };
}

/** Kurzer Text einer Stufe, z. B. „25 Kartell-Nester ausgehoben“ oder „Saisonsieg“. */
export function tierText(a: AchievementDef, tier: number): string {
  const custom = a.tierTexts?.[tier - 1];
  if (custom) return custom;
  return `${a.thresholds[tier - 1].toLocaleString("de-DE")} – ${a.description}`;
}

/** Stufe der Saisonplatzierung als Zählerwert: 3 Sieg, 2 Platz 1–3, 1 Platz 1–10, sonst 0. */
export function placementScore(rank: number, total: number): number {
  if (total <= 0) return 0;
  return rank === 1 ? 3 : rank <= 3 ? 2 : rank <= 10 ? 1 : 0;
}

/** Ressourcen und Kredite einer Belohnung getrennt. */
export function splitReward(r: AchievementReward | Record<string, number>): { credits: number; resources: ResourceMap } {
  const resources: ResourceMap = {};
  for (const res of balance.resources) if ((r[res] ?? 0) > 0) resources[res] = r[res]!;
  return { credits: Math.max(0, Number(r.credits ?? 0)), resources };
}

// ---------------------------------------------------------------- Spielwoche

/** Wochentag eines Tages (1 Montag … 7 Sonntag). */
function weekday(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return ((new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7) + 1;
}

/** Woche des Zeitpunkts als Montag (JJJJ-MM-TT) in der Spielzeitzone. */
export function weekKey(ms: number): string {
  const day = dayKey(ms);
  return addDays(day, 1 - weekday(day));
}

/** Beginn der Woche (Montag 0:00 Uhr Ortszeit) in ms. */
export function weekStartMs(week: string): number {
  return dayStartMs(week);
}

/** Nächster Wochenwechsel nach ms. */
export function nextWeekStartMs(ms: number): number {
  return dayStartMs(addDays(weekKey(ms), 7));
}

// ---------------------------------------------------------------- Wochenziele: Pool

export interface WeeklyContext extends PoolContext {
  /** Mitglied einer Allianz mit mindestens einem weiteren Mitglied. */
  allied: boolean;
}

interface WeeklyKind {
  spec: (c: WeeklyContext) => { param: string | null; target: number } | null;
  text: (target: number, param: string | null) => string;
  icon: string;
}

const lvl = (c: PoolContext, id: string) => c.levels[id] ?? 0;
const round = (n: number, step: number) => Math.max(step, Math.round(n / step) * step);
const fmt = (n: number) => n.toLocaleString("de-DE");
const canLand = (c: PoolContext) => lvl(c, "werft") >= 1 && lvl(c, "kaserne") >= 1;
const canSail = (c: PoolContext) => lvl(c, "werft") >= 1 || lvl(c, "flugfeld") >= 1;
const nestCap = (c: PoolContext) => Math.max(1, Math.min(5, 1 + Math.floor(c.stage / 3)));

function canSpy(c: PoolContext): boolean {
  const e = balance.espionage;
  if (!e) return false;
  const level = lvl(c, e.building);
  return level >= e.kinds.erkunden.minLevel && (c.others || level >= (e.kinds.kartell?.minLevel ?? Infinity));
}

/**
 * Pool der Wochenziele. Schlüssel = Zähler (wie in recordAchievement), damit derselbe Aufruf Erfolge und
 * Wochenziele fortschreibt. tagesbefehle wird aus den abgeholten Tagesbefehlen der Woche gelesen.
 */
export const WEEKLY_KINDS: Record<string, WeeklyKind> = {
  nester: {
    icon: "kartell",
    spec: (c) => (canLand(c) ? { param: String(nestCap(c)), target: 3 } : null),
    text: (n, p) => `Hebe ${n} Piratennester der Stufe ${p} oder höher aus`,
  },
  beute: {
    icon: "ueberfall",
    spec: (c) => (canLand(c) ? { param: null, target: round(15000 * (1 + c.stage / 3), 1000) } : null),
    text: (n) => `Erbeute ${fmt(n)} Ressourcen bei Überfällen`,
  },
  gebaeudestufen: {
    icon: "kommandozentrale",
    spec: (c) => ({ param: null, target: 5 + Math.floor(c.stage / 3) }),
    text: (n) => `Schließe ${n} Gebäudestufen ab`,
  },
  missionen: {
    icon: "transport",
    spec: (c) => (canSail(c) ? { param: null, target: 10 } : null),
    text: (n) => `Bringe ${n} Missionen erfolgreich zu Ende (Siege, Aufklärung, Transporte, Spionage)`,
  },
  spionage: {
    icon: "spionage",
    spec: (c) => (canSpy(c) ? { param: null, target: 3 } : null),
    text: (n) => `Führe ${n} Aufträge des Nachrichtendienstes erfolgreich aus`,
  },
  allianz_hilfe: {
    icon: "anker",
    spec: (c) => (c.allied && lvl(c, "werft") >= 1 ? { param: null, target: 3 } : null),
    text: (n) => `Unterstütze deine Allianz: ${n} Transporte an Mitglieder ans Ziel bringen`,
  },
  forschung: {
    icon: "forschungsamt",
    spec: (c) => (lvl(c, "forschungsamt") >= 1 ? { param: null, target: 3 } : null),
    text: (n) => `Schließe ${n} Forschungen ab`,
  },
  handel: {
    icon: "credits",
    spec: (c) => (c.marketOpen ? { param: null, target: 5 } : null),
    text: (n) => `Schließe ${n} Geschäfte an der Börse ab`,
  },
  abwehr: {
    icon: "schild",
    spec: (c) => (c.raidsPossible ? { param: null, target: 2 } : null),
    text: (n) => `Wehre ${n} Angriffe auf deine Häfen ab`,
  },
  wrack: {
    icon: "stahl",
    spec: (c) => (canSail(c) ? { param: null, target: round(3000 * (1 + c.stage / 5), 500) } : null),
    text: (n) => `Berge ${fmt(n)} Wrackgut`,
  },
  anlagen: {
    icon: "kuestenbatterie",
    spec: (c) => ({ param: null, target: 5 + Math.floor(c.stage / 2) }),
    text: (n) => `Errichte ${n} Verteidigungsanlagen`,
  },
  tagesbefehle: {
    icon: "uhr",
    spec: () => ({ param: null, target: 12 }),
    text: (n) => `Hole ${n} Tagesbefehle ab`,
  },
};

/** Wochenziele, deren Stand aus dem Zustand gelesen wird (beim Abruf). */
export const WEEKLY_DERIVED = new Set(["tagesbefehle"]);

export function weeklyText(kind: string, target: number, param: string | null): string {
  return WEEKLY_KINDS[kind]?.text(target, param) ?? kind;
}

export function weeklyIcon(kind: string): string {
  return WEEKLY_KINDS[kind]?.icon ?? "anker";
}

function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

export interface WeeklyDraw {
  slot: number;
  kind: string;
  param: string | null;
  target: number;
}

/**
 * Drei verschiedene Wochenziele, passend zum Ausbaustand. Gleiche Eingabe (Kontext, Seed aus Spieler und
 * Woche), gleiches Ergebnis. gebaeudestufen, anlagen und tagesbefehle passen immer.
 */
export function drawWeek(c: WeeklyContext, seedText: string): WeeklyDraw[] {
  const rnd = mulberry32(hashSeed(seedText));
  const options = Object.keys(WEEKLY_KINDS).sort()
    .map((kind) => ({ kind, s: WEEKLY_KINDS[kind].spec(c) }))
    .filter((o): o is { kind: string; s: { param: string | null; target: number } } => !!o.s && o.s.target > 0);
  const out: WeeklyDraw[] = [];
  for (let slot = 0; slot < 3 && options.length > 0; slot++) {
    const [o] = options.splice(Math.floor(rnd() * options.length), 1);
    out.push({ slot, kind: o.kind, ...o.s });
  }
  return out;
}

const growth = (stage: number) => 1 + stage * (balance.achievements?.weekly.stageGrowth ?? 0.3);
const round10 = (n: number) => Math.round(n / 10) * 10;

/** Belohnung eines Wochenziels: Ressourcenpaket und Kredite, wächst mit der Kommandozentrale. */
export function weeklyReward(stage: number): Record<string, number> {
  const w = balance.achievements?.weekly;
  if (!w) return {};
  return { ...resourcePackage(w.goalValue * growth(stage)), credits: round10(w.goalCredits * (1 + stage * 0.1)) };
}

/** Wochenbonus bei allen drei abgeholten Zielen. */
export function weeklyBonus(stage: number): Record<string, number> {
  const w = balance.achievements?.weekly;
  if (!w) return {};
  return { ...resourcePackage(w.bonusValue * growth(stage)), credits: round10(w.bonusCredits * (1 + stage * 0.1)) };
}
