// KI-Spieler (Bots): Spielweisen, Einstellungen, Namen, Aktivitätszeiten, Hafenwahl, Anlegen und Entfernen.
// Bots sind normale Spieler (Zeile in player mit bot_profile); sie handeln ausschließlich über die Befehle
// (bots-run.ts) und können sich nicht anmelden. Regeln: docs/REGELN-KI.md.
import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { market as marketCore, mulberry32 } from "@tidefront/game-core";
import { COLS, ROWS, hexDistanceKm, isCoast, isTradePortHex } from "@tidefront/world";
import { tables, type DbOrTx } from "@tidefront/db";
import { balance, marketBalance, type Engine } from "./context.ts";
import { chooseBase, recallOwnMission } from "./commands.ts";
import { basesOfPlayer, homeBaseOf } from "./store.ts";
import { getSetting, setSetting } from "./settings.ts";
import { resetBotCache } from "./bots-flag.ts";
import { abandonBlockers, abandonColony } from "./harbors.ts";
import { withdrawOffer } from "./player-trade.ts";
import { fieldRecall } from "./fields-missions.ts";
import { ownedBy } from "./fields-core.ts";
import { FOUNDING_FAIL_TEXT } from "./expansion-arrive.ts";

export const BOT_PROFILES = ["haendler", "festung", "freibeuter"] as const;
export type BotProfile = (typeof BOT_PROFILES)[number];

export const PROFILE_TEXT: Record<BotProfile, string> = { haendler: "Händler", festung: "Festung", freibeuter: "Freibeuter" };

export interface ProfileConfig {
  /** Aktive Stunden (Ortszeit, Ende > 24 = nach Mitternacht). */
  activeHours: [number, number];
  /** Abstand zwischen zwei Zügen in Minuten (zufällig dazwischen). */
  turnMinutes: [number, number];
  nightShieldStartHour: number | null;
  /** Ungenauigkeit: Anteil der Entscheidungen, die zufällig statt gut fallen. */
  noise: number;
  /** Zielanteil von Einheiten und Anlagen am Gesamtwert (Rest: Gebäude). */
  militaryShare: number;
  /** Höchstanteil der Forschungsausgaben am Gebäudewert. */
  researchShare: number;
  /** Anteil der Kampfeinheiten, der bei Angriffen daheim bleibt. */
  homeGuardShare: number;
  attackNests: boolean;
  /** Neigung zu Angriffen auf Spieler (0 = nie, 1 = sobald lohnend). */
  attackPlayers: number;
  /** Bauaufträge, die der Bot höchstens in der Schlange hält (leicht 1, stark 3). */
  buildQueue: number;
  /** Probekampf vor Angriffen: Durchläufe (wenige = ungenau) und nötige Siegquote. */
  probeRuns: number;
  probeWinRate: number;
  expandFromCommandLevel: number;
  fields: "free" | "all" | "none";
  trade: boolean;
}

export interface BotsConfig {
  timeZone: string;
  maxBotsDefault: number;
  turnsPerMinute: number;
  turnBudgetMs: number;
  humanAttackCooldownHours: number;
  logSize: number;
  reconMaxAgeHours: number;
  profiles: Record<BotProfile, ProfileConfig>;
}

export function botsConfig(): BotsConfig {
  return (balance as unknown as { bots: BotsConfig }).bots;
}

export interface BotSettings {
  active: boolean;
  /** Darf menschliche Spieler angreifen (Vorgabe: aus). */
  attackHumans: boolean;
  /** Entfernen angefordert: der Bot räumt seine Häfen und wird dann gelöscht. */
  removing?: boolean;
}

export interface BotLogEntry { atMs: number; text: string }

export interface BotState {
  nextActAt?: number;
  log?: BotLogEntry[];
  lastTurnAtMs?: number;
  lastTurnMs?: number;
  /** Aufklärung unterwegs: Ziel-Hafen-ID → Startzeit. */
  recon?: Record<string, number>;
  /** Ziele, die nach dem Probekampf eine Weile gemieden werden: Hafen-ID → bis. */
  avoid?: Record<string, number>;
  /** Fehler in Folge (für den Abstand des nächsten Versuchs). */
  errors?: number;
  /** Rohstofffeld, für das Schiffe fehlen: Überfälle lassen diesen Verband daheim, die Rüstung legt Schiffe nach. */
  fieldTarget?: { fieldId: number; baseId: number; units: Record<string, number>; untilMs: number };
}

export interface BotRow { id: number; name: string; profile: BotProfile; settings: BotSettings; state: BotState }

export const DEFAULT_SETTINGS: BotSettings = { active: true, attackHumans: false };

/** Namen je Spielweise; der erste freie wird genommen, danach mit „II“, „III“ … */
export const BOT_NAMES: Record<BotProfile, string[]> = {
  haendler: ["Reederei Albers", "Kontor Hansen", "Handelshaus Brandt", "Reederei Möller", "Kontor Lindqvist", "Handelshaus Vogt", "Reederei Petersen", "Kontor Larsen"],
  festung: ["Bastion Falkenberg", "Kommandant Steiner", "Feste Nordwacht", "Kommandant Harms", "Bastion Klippenstein", "Feste Sturmhaken", "Kommandant Ewers", "Bastion Leuchtfeuer"],
  freibeuter: ["Kapitän Rotbart", "Kaperfahrer Grimm", "Freibeuterin Mara", "Kapitän Haifisch", "Kaperfahrer Vasco", "Seewolf Jansen", "Kapitänin Sturmvogel", "Seewolf Brodersen"],
};

/** Kein scrypt-Hash: verifyPassword schlägt immer fehl, login lehnt Bots zusätzlich ausdrücklich ab. */
export const BOT_PASS_HASH = "bot$kein-login";

export const BOTS_ENABLED_KEY = "bots_enabled";
export const BOTS_MAX_KEY = "bots_max";

/** Server-Einstellung: Bots laufen (Vorgabe an). */
export async function botsEnabled(db: DbOrTx): Promise<boolean> {
  return (await getSetting(db, BOTS_ENABLED_KEY)) !== "0";
}

export async function botsMax(db: DbOrTx): Promise<number> {
  const raw = await getSetting(db, BOTS_MAX_KEY);
  const n = raw === null || raw.trim() === "" ? NaN : Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : botsConfig().maxBotsDefault;
}

export async function setBotsServer(db: DbOrTx, input: { enabled?: boolean; max?: number }): Promise<void> {
  if (input.enabled !== undefined) await setSetting(db, BOTS_ENABLED_KEY, input.enabled ? "1" : "0");
  if (input.max !== undefined) await setSetting(db, BOTS_MAX_KEY, String(Math.max(0, Math.min(50, Math.floor(input.max)))));
}

function rowOf(r: { id: number; name: string; botProfile: string | null; botSettings: unknown; botState: unknown }): BotRow {
  return {
    id: r.id, name: r.name, profile: r.botProfile as BotProfile,
    settings: { ...DEFAULT_SETTINGS, ...((r.botSettings as Partial<BotSettings>) ?? {}) },
    state: (r.botState as BotState) ?? {},
  };
}

const botCols = { id: tables.player.id, name: tables.player.name, botProfile: tables.player.botProfile, botSettings: tables.player.botSettings, botState: tables.player.botState };

export async function loadBots(db: DbOrTx): Promise<BotRow[]> {
  const rows = await db.select(botCols).from(tables.player).where(isNotNull(tables.player.botProfile)).orderBy(asc(tables.player.id));
  return rows.filter((r) => (BOT_PROFILES as readonly string[]).includes(r.botProfile!)).map(rowOf);
}

export async function loadBot(db: DbOrTx, id: number): Promise<BotRow | null> {
  const [r] = await db.select(botCols).from(tables.player).where(and(eq(tables.player.id, id), isNotNull(tables.player.botProfile)));
  return r ? rowOf(r) : null;
}

export async function saveBotState(db: DbOrTx, id: number, state: BotState): Promise<void> {
  await db.update(tables.player).set({ botState: state }).where(eq(tables.player.id, id));
}

export function appendLog(state: BotState, atMs: number, texts: string[]): BotState {
  if (texts.length === 0) return state;
  const log = [...texts.map((text) => ({ atMs, text })).reverse(), ...(state.log ?? [])].slice(0, botsConfig().logSize);
  return { ...state, log };
}

// ---------------------------------------------------------------- Aktivitätszeiten

function zoneParts(ms: number, timeZone: string): { hour: number; minute: number; day: number; offsetMin: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric",
  }).formatToParts(new Date(ms));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const localAsUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  return { hour: get("hour"), minute: get("minute"), day: Math.floor(localAsUtc / 86400000), offsetMin: Math.round((localAsUtc - Math.floor(ms / 60000) * 60000) / 60000) };
}

/** Abweichung des Tagesbeginns je Bot und Tag (−45 … +45 Minuten), damit der Tag nicht immer gleich aussieht. */
function dayShiftMin(botId: number, day: number): number {
  return Math.floor(mulberry32((botId * 7919 + day * 104729) >>> 0)() * 91) - 45;
}

/** Liegt `nowMs` in der aktiven Zeit des Bots? */
export function isActiveTime(profile: BotProfile, botId: number, nowMs: number): boolean {
  const cfg = botsConfig();
  const p = zoneParts(nowMs, cfg.timeZone);
  const h = p.hour + p.minute / 60;
  const shift = dayShiftMin(botId, p.day) / 60;
  const [s0, e0] = cfg.profiles[profile].activeHours;
  const s = s0 + shift, e = e0 + shift;
  if (h >= s && h < e) return true;
  // Fenster über Mitternacht: Rest am frühen Morgen (mit der Verschiebung des Vortags).
  const prevShift = dayShiftMin(botId, p.day - 1) / 60;
  return e0 > 24 && h < e0 - 24 + prevShift;
}

/** Zeitpunkt des nächsten Zugs: in der aktiven Zeit nach turnMinutes, sonst zu Beginn der nächsten aktiven Zeit. */
export function nextTurnAt(profile: BotProfile, botId: number, nowMs: number, rand: () => number): number {
  const cfg = botsConfig().profiles[profile];
  const [a, b] = cfg.turnMinutes;
  const step = (a + rand() * (b - a)) * 60000;
  if (isActiveTime(profile, botId, nowMs + step)) return Math.round(nowMs + step);
  // In Viertelstunden vorwärts suchen (höchstens ein Tag), dann etwas Streuung.
  for (let t = nowMs + 15 * 60000; t < nowMs + 26 * 3600000; t += 15 * 60000) {
    if (isActiveTime(profile, botId, t)) return Math.round(t + rand() * 20 * 60000);
  }
  return Math.round(nowMs + step);
}

/** Zeitzonen-Versatz der Bot-Zeitzone in Minuten (für den Nachtschild). */
export function zoneOffsetMinutes(nowMs: number): number {
  return zoneParts(nowMs, botsConfig().timeZone).offsetMin;
}

// ---------------------------------------------------------------- Heimathafen

let coastCache: { col: number; row: number }[] | null = null;
export function coastFields(): { col: number; row: number }[] {
  if (!coastCache) {
    coastCache = [];
    for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) if (isCoast(col, row)) coastCache.push({ col, row });
  }
  return coastCache;
}

/** Freies Küstenfeld mit möglichst großem Abstand zu allen Häfen, Nestern und Rohstofffeldern (zufällig unter den besten). */
export async function freeHomeField(db: DbOrTx, seed: number): Promise<{ col: number; row: number } | null> {
  const bases = await db.select({ col: tables.base.col, row: tables.base.row }).from(tables.base);
  const nests = await db.select({ col: tables.nest.col, row: tables.nest.row }).from(tables.nest);
  const fields = await db.select({ col: tables.resourceField.col, row: tables.resourceField.row }).from(tables.resourceField);
  const blocked = new Set([...bases, ...nests, ...fields].map((x) => `${x.col},${x.row}`));
  const scored: { col: number; row: number; d: number }[] = [];
  for (const c of coastFields()) {
    if (blocked.has(`${c.col},${c.row}`) || isTradePortHex(c.col, c.row)) continue;
    let d = 5000;
    for (const b of bases) d = Math.min(d, hexDistanceKm(c, b));
    for (const n of nests) if (hexDistanceKm(c, n) < 120) d = 0;
    if (d > 0) scored.push({ ...c, d });
  }
  if (scored.length === 0) return null;
  // Nicht immer der entfernteste Winkel: zufällig unter den Feldern mit mindestens 70 % des besten Abstands.
  scored.sort((x, y) => y.d - x.d);
  const good = scored.filter((x) => x.d >= Math.min(600, scored[0].d * 0.7));
  const pick = good[Math.floor(mulberry32(seed >>> 0)() * good.length)] ?? scored[0];
  return { col: pick.col, row: pick.row };
}

export function harborNameOf(name: string): string {
  const last = name.split(" ").pop() ?? name;
  return `Hafen ${last}`.slice(0, 32);
}

/** Heimathafen anlegen, falls keiner besteht (auch nach dem Saisonwechsel). Rückgabe: Logtext oder null. */
export async function ensureHome(engine: Engine, bot: BotRow, nowMs: number): Promise<string | null> {
  if (await homeBaseOf(engine.db, bot.id)) return null;
  const cfg = botsConfig().profiles[bot.profile];
  for (let attempt = 0; attempt < 3; attempt++) {
    const f = await freeHomeField(engine.db, bot.id * 31 + Math.floor(nowMs / 60000) + attempt);
    if (!f) return "Kein freies Küstenfeld für einen Hafen gefunden.";
    const r = await chooseBase(engine, bot.id, `bot-home-${nowMs}-${attempt}`, {
      ...f, name: harborNameOf(bot.name), nightShieldStartHour: cfg.nightShieldStartHour, tzOffsetMinutes: zoneOffsetMinutes(nowMs),
    });
    if (r.ok) return `Hafen gegründet auf Feld ${f.col}/${f.row}.`;
    if (r.code !== "field_taken" && r.code !== "resource_field") return `Hafengründung abgelehnt (${FOUNDING_FAIL_TEXT[r.code] ?? r.code}).`;
  }
  return "Hafengründung: Feld jeweils schon belegt.";
}

// ---------------------------------------------------------------- Anlegen, ändern, entfernen

async function freeName(db: DbOrTx, profile: BotProfile): Promise<string> {
  const taken = new Set((await db.select({ name: tables.player.name }).from(tables.player)).map((r) => r.name.toLowerCase()));
  const roman = ["", " II", " III", " IV", " V", " VI"];
  for (const suffix of roman) {
    for (const n of BOT_NAMES[profile]) if (!taken.has(`${n}${suffix}`.toLowerCase())) return `${n}${suffix}`;
  }
  return `${PROFILE_TEXT[profile]} ${Date.now() % 100000}`;
}

/** Legt einen Bot an (mit Hafen). Codes: bad_profile, bot_limit. */
export async function addBot(engine: Engine, profile: string, nowMs = Date.now()): Promise<{ ok: true; playerId: number; name: string; home: string | null } | { ok: false; code: string }> {
  if (!(BOT_PROFILES as readonly string[]).includes(profile)) return { ok: false, code: "bad_profile" };
  const p = profile as BotProfile;
  const created = await engine.db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(7340031)`);
    const [c] = await tx.select({ n: sql<number>`count(*)::int` }).from(tables.player).where(isNotNull(tables.player.botProfile));
    if ((c?.n ?? 0) >= (await botsMax(tx))) return null;
    const name = await freeName(tx, p);
    const { stock: _s, ...trader } = marketCore.createTraderState(marketBalance, 0, {}, nowMs);
    const state: BotState = { nextActAt: nowMs, log: [{ atMs: nowMs, text: `Angelegt als ${PROFILE_TEXT[p]}.` }] };
    const [row] = await tx.insert(tables.player).values({
      name, passHash: BOT_PASS_HASH, trader, botProfile: p, botSettings: DEFAULT_SETTINGS, botState: state,
    }).returning({ id: tables.player.id });
    return { id: row.id, name };
  });
  if (!created) return { ok: false, code: "bot_limit" };
  resetBotCache();
  const bot = (await loadBot(engine.db, created.id))!;
  const home = await ensureHome(engine, bot, nowMs);
  if (home) await saveBotState(engine.db, bot.id, appendLog(bot.state, nowMs, [home]));
  engine.notify(null, "map");
  return { ok: true, playerId: created.id, name: created.name, home };
}

/** Startbesetzung: je Spielweise ein Bot, falls es noch gar keine Bots gibt. Idempotent. */
export async function ensureStartBots(engine: Engine, nowMs = Date.now()): Promise<{ created: string[] }> {
  const existing = await loadBots(engine.db);
  const created: string[] = [];
  for (const p of BOT_PROFILES) {
    if (existing.some((b) => b.profile === p)) continue;
    const r = await addBot(engine, p, nowMs);
    if (r.ok) created.push(r.name);
  }
  return { created };
}

/** Verwaltung: Aktiv und Angriffserlaubnis gegen Menschen setzen. */
export async function updateBot(db: DbOrTx, id: number, patch: { active?: boolean; attackHumans?: boolean }): Promise<boolean> {
  const bot = await loadBot(db, id);
  if (!bot || bot.settings.removing) return false;
  const settings: BotSettings = { ...bot.settings };
  if (patch.active !== undefined) settings.active = patch.active;
  if (patch.attackHumans !== undefined) settings.attackHumans = patch.attackHumans;
  await db.update(tables.player).set({ botSettings: settings }).where(eq(tables.player.id, id));
  return true;
}

/**
 * Entfernen: Angebote zurückziehen, Felder und Verbände zurückrufen, Außenposten aufgeben (dieselben Befehle wie
 * für Menschen). Erst wenn nichts mehr unterwegs ist (Hinderungsgründe wie beim Aufgeben einer Kolonie), werden
 * Heimathafen und Spieler gelöscht. Bis dahin ruft der Worker diese Funktion bei jedem Takt erneut auf.
 * Rückgabe: "removed" oder die offenen Hinderungsgründe.
 */
export async function removeBotStep(engine: Engine, id: number, nowMs = Date.now()): Promise<{ removed: boolean; waiting: string[] }> {
  const bot = await loadBot(engine.db, id);
  if (!bot) return { removed: true, waiting: [] };
  if (!bot.settings.removing) {
    await engine.db.update(tables.player).set({ botSettings: { ...bot.settings, active: false, removing: true } }).where(eq(tables.player.id, id));
  }
  const key = (s: string) => `bot-rm-${s}-${nowMs}`;
  const offers = await engine.db.select({ id: tables.playerOffer.id }).from(tables.playerOffer)
    .where(and(eq(tables.playerOffer.sellerId, id), eq(tables.playerOffer.status, "open")));
  for (const o of offers) await withdrawOffer(engine, id, key(`o${o.id}`), o.id);
  for (const f of await ownedBy(engine.db, id)) await fieldRecall(engine, id, key(`f${f.id}`), f.id);
  const outbound = await engine.db.select({ id: tables.mission.id }).from(tables.mission)
    .where(and(eq(tables.mission.playerId, id), eq(tables.mission.status, "outbound")));
  for (const m of outbound) await recallOwnMission(engine, id, key(`m${m.id}`), m.id);
  const bases = await basesOfPlayer(engine.db, id);
  for (const b of bases.filter((x) => !x.isHome)) await abandonColony(engine, id, key(`b${b.id}`), b.id);
  const left = await basesOfPlayer(engine.db, id);
  const waiting = new Set<string>();
  if (left.some((b) => !b.isHome)) waiting.add("colonies");
  const home = left.find((b) => b.isHome);
  if (home) for (const w of await abandonBlockers(engine.db, id, { ...home, isHome: false }, nowMs)) waiting.add(w);
  const [busy] = await engine.db.select({ n: sql<number>`count(*)::int` }).from(tables.mission)
    .where(and(eq(tables.mission.playerId, id), inArray(tables.mission.status, ["outbound", "returning", "staged", "stationed", "holding"])));
  if ((busy?.n ?? 0) > 0) waiting.add("missions_out");
  if (waiting.size > 0) return { removed: false, waiting: [...waiting] };
  await engine.db.transaction(async (tx) => {
    if (home) {
      await tx.update(tables.mission).set({ status: "done" }).where(and(
        sql`${tables.mission.playerId} is null`, eq(tables.mission.targetKind, "base"), eq(tables.mission.targetId, home.id), eq(tables.mission.status, "outbound"),
      ));
      await tx.delete(tables.gameEvent).where(and(eq(tables.gameEvent.baseId, home.id), eq(tables.gameEvent.status, "pending"),
        inArray(tables.gameEvent.type, ["build_complete", "training_complete", "raid_launch", "attack_warning", "research_complete"])));
      await tx.update(tables.minefield).set({ baseId: null }).where(eq(tables.minefield.baseId, home.id));
    }
    // Spieler löschen: Häfen, Missionen, Sitzungen usw. fallen per Kaskade; Berichte und Journal bleiben.
    await tx.delete(tables.player).where(and(eq(tables.player.id, id), isNotNull(tables.player.botProfile)));
  });
  resetBotCache();
  engine.notify(null, "map");
  return { removed: true, waiting: [] };
}
